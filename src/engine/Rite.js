// Rite.js - the Rite (docs/specs/act-v-descent.md §4, §9.5): how many words the court circle has
// spoken by the time the army reaches the finale. A run-level count, pure: no Phaser, no
// Math.random, no scene. The numbers are data/descent.json `rite` (DEFAULT_RITE_CONFIG stands in
// when a build has none).
//
// run.rite = { v: 1, words, start, log: [{ source, delta, requested?, nodeId?, eventId? }] } | null
//   - created once, in RunManager.advanceAct, only when the act it enters is the Descent's route
//     (after beginActShadow, before applyEclipseNow), from the Eclipse's global phase at entry
//     (`startByPhase`; 0 with the Eclipse off); null on every other act, run and old save;
//   - raised or lowered only at a victory's commit (RunManager.completeBattle: the Vigil's words,
//     `options.riteWords`, gated on the locked config carrying `vigil`; a node `underPar` names,
//     won at or under par) and by an Act V event's `rite` effect (EventEffects); a battle never
//     writes it, so a suspend, a Vision rewind or Continue from Map needs nothing, and a node
//     already done is refused before anything is counted;
//   - never below 0 (a lowering past 0 is logged with what it asked for).
//
// Tiers (`bands`, contiguous from 0, the last open): Broken / Spoken / Answered. The tier is a
// state, read wherever a finale is generated, never a charge:
//   riteModsFor(run, node) -> the `riteMods` RunManager.getBattleParams hands a boss node of the
//   Descent (a `riteTarget`, a gate or a finale): the band's mods for that boss (`lieutenant` |
//   `entity`), whitelisted here and again where they are written (RiteBattleMods.js). Keys only
//   when non-empty.
//
// What the Rite never touches (§4): the Entity's HP, Revival Stones on the Entity, its hinge (first
// wound -> silence -> the answer -> the finale), the hum's HP contract and the rally. The only mods
// an Entity may carry are `splashDelta` and `waveHollowed` (RITE_MOD_KEYS); validateRiteConfig
// refuses anything else, and the writers ignore it.

import { HOLLOWED_LEVEL_CAP, HOLLOWED_PER_WORD_LEVEL, hollowedLevelBonus } from './Vigil.js';

export const RITE_VERSION = 1;
/** Where a word comes from (§9.5): the Eclipse at entry, the Vigil, an event, a battle's par. */
export const RITE_SOURCES = Object.freeze(['eclipse', 'vigil', 'event', 'battle']);
/** The bosses a tier speaks to (a boss node's kind: RiteBattleMods writes them). */
export const RITE_TARGETS = Object.freeze(['lieutenant', 'entity']);
/** The mods each target may carry, with their bounds. Nothing else is ever written. */
export const RITE_MOD_KEYS = Object.freeze({
  lieutenant: Object.freeze({
    // His escort (the map's non-boss foes) loses its N highest-level members.
    escortDrop: Object.freeze({ min: 0, max: 6 }),
    // Revival Stones over his rung's own (SeatedBoss.resolveSeatedBoss).
    revivalStones: Object.freeze({ min: 0, max: 3 }),
    // N Hollowed at the reinforcement edge on turn `waveTurn` (default RITE_WAVE_TURN).
    waveHollowed: Object.freeze({ min: 0, max: 6 }),
    waveTurn: Object.freeze({ min: 1, max: 20 }),
  }),
  entity: Object.freeze({
    // The splash's tile count, ENTITY_SPLASH_COUNT +- N (clamped 0..4 by the reader).
    splashDelta: Object.freeze({ min: -4, max: 4 }),
    // N Hollowed beside each of the template's waves, on its turn and at its edges.
    waveHollowed: Object.freeze({ min: 0, max: 6 }),
  }),
});
/** The turn the Lieutenant's Answered wave lands when the data names none (§4: "the T4 wave"). */
export const RITE_WAVE_TURN = 4;
/** A save's log keeps at most this many entries (the newest). */
export const RITE_LOG_MAX = 64;
/** The most words one victory commits (a sanity bound on a hand-edited count). */
export const RITE_MAX_WORDS_PER_COMMIT = 999;

/** The spec's numbers (§4 *tune*), for a build whose descent.json has no `rite` block. */
export const DEFAULT_RITE_CONFIG = Object.freeze({
  startByPhase: Object.freeze({ pale: 0, waning: 1, umbral: 2, totality: 4, hollow: 6 }),
  bands: Object.freeze([
    Object.freeze({ id: 'broken', min: 0, max: 4 }),
    Object.freeze({ id: 'spoken', min: 5, max: 11 }),
    Object.freeze({ id: 'answered', min: 12 }),
  ]),
  mods: Object.freeze({}),
  underPar: Object.freeze({}),
  perWordLevel: HOLLOWED_PER_WORD_LEVEL,
  levelCap: HOLLOWED_LEVEL_CAP,
});

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const whole = (v) => Math.max(0, Math.trunc(Number(v) || 0));
const ID = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * The rite numbers: from a run (its gameData's descent.json), descent.json itself or its `rite`
 * block; the defaults when there is none.
 */
export function riteConfigOf(source) {
  for (const rite of [source?.gameData?.descent?.rite, source?.rite, source])
    if (isObject(rite) && Array.isArray(rite.bands)) return rite;
  return DEFAULT_RITE_CONFIG;
}

// ── State ───────────────────────────────────────────────────────────────

/** A fresh Rite at `start` words (the Eclipse's, logged as its first entry). */
export function createRite({ start = 0 } = {}) {
  const words = whole(start);
  return { v: RITE_VERSION, words, start: words, log: [{ source: 'eclipse', delta: words }] };
}

/**
 * The words the Rite starts at: the Eclipse's global phase at Act V entry (`startByPhase`), 0
 * when the Eclipse is off or the phase is unknown.
 * @param {{ active: boolean, phaseId: string|null }} eclipse
 */
export function riteStartFromEclipse({ active = false, phaseId = null } = {}, config) {
  if (!active || typeof phaseId !== 'string') return 0;
  return whole(riteConfigOf(config).startByPhase?.[phaseId]);
}

/**
 * The Rite after `delta` words (a new object; the input is untouched). Never below 0: the log
 * keeps the change that happened (`delta`) and, when the floor cut it, what was asked
 * (`requested`). A zero change is logged only when something asked for one.
 * @param {object} rite
 * @param {number} delta
 * @param {{ source: string, nodeId?: string, eventId?: string }} meta
 */
export function applyRiteDelta(rite, delta, { source, nodeId, eventId } = {}) {
  const base = sanitizeRite(rite);
  if (!base) return null;
  const requested = Math.trunc(Number(delta) || 0);
  const words = Math.max(0, base.words + requested);
  const entry = {
    source: RITE_SOURCES.includes(source) ? source : 'event',
    delta: words - base.words,
    ...(words - base.words !== requested ? { requested } : {}),
    ...(typeof nodeId === 'string' && nodeId ? { nodeId } : {}),
    ...(typeof eventId === 'string' && eventId ? { eventId } : {}),
  };
  return { ...base, words, log: [...base.log, entry].slice(-RITE_LOG_MAX) };
}

/** A saved Rite made whole, or null (no Rite: not the Descent, an old save, a broken record). */
export function sanitizeRite(raw) {
  if (!isObject(raw) || raw.v !== RITE_VERSION) return null;
  const log = (Array.isArray(raw.log) ? raw.log : [])
    .filter((e) => isObject(e) && RITE_SOURCES.includes(e.source) && isInt(e.delta))
    .map((e) => ({
      source: e.source,
      delta: e.delta,
      ...(isInt(e.requested) ? { requested: e.requested } : {}),
      ...(typeof e.nodeId === 'string' && e.nodeId ? { nodeId: e.nodeId } : {}),
      ...(typeof e.eventId === 'string' && e.eventId ? { eventId: e.eventId } : {}),
    }))
    .slice(-RITE_LOG_MAX);
  return { v: RITE_VERSION, words: whole(raw.words), start: whole(raw.start), log };
}

// ── Tiers ───────────────────────────────────────────────────────────────

/** The tier `words` (or a Rite) stands in: a band id of the config ('broken' | 'spoken' | ...). */
export function riteBand(wordsOrRite, config) {
  const words = isObject(wordsOrRite) ? whole(wordsOrRite.words) : whole(wordsOrRite);
  const bands = riteConfigOf(config).bands;
  let id = bands[0]?.id || null;
  for (const band of bands) if (words >= whole(band?.min)) id = band.id;
  return id;
}

/** A band's label for the player ("Spoken"). */
export function riteBandLabel(band) {
  return typeof band === 'string' && band ? band[0].toUpperCase() + band.slice(1) : '';
}

/**
 * Which boss a tier speaks to at `node`: a boss node of the Descent (a `riteTarget`, or a gate or
 * finale) seating the Lieutenant -> 'lieutenant', the Entity -> 'entity'; anything else null.
 */
export function riteTargetOf(node, gameData) {
  const params = node?.battleParams;
  const bossNode = node?.type === 'boss' || params?.isBoss === true;
  if (!bossNode) return null;
  if (node.riteTarget !== true && !['gate', 'finale'].includes(params?.bossRole)) return null;
  const act = params?.act || 'finalBoss';
  const def = (gameData?.enemies?.bosses?.[act] || []).find((b) => b?.name === params?.bossName);
  return riteTargetOfBoss(def);
}

/** The target a boss definition is: the Entity, the Lieutenant, else null. */
export function riteTargetOfBoss(def) {
  if (def?.isEntity === true) return 'entity';
  return def?.name === 'The Lieutenant' ? 'lieutenant' : null;
}

/** A target's mods with only its whitelisted keys, each a whole number in bounds; zeros dropped. */
export function sanitizeRiteMods(mods, target) {
  const allowed = RITE_MOD_KEYS[target];
  if (!allowed || !isObject(mods)) return {};
  const out = {};
  for (const [key, bounds] of Object.entries(allowed)) {
    const n = Math.trunc(Number(mods[key]));
    if (!Number.isFinite(n) || n === 0) continue;
    out[key] = Math.max(bounds.min, Math.min(bounds.max, n));
  }
  // A wave turn means nothing without a wave.
  if (!out.waveHollowed) delete out.waveTurn;
  return out;
}

/**
 * The mods the run's Rite puts on `node`'s battle (getBattleParams' `riteMods`), or {} when it
 * puts none: no Rite, not a boss node of the Descent, or a tier with nothing for that boss.
 * `{ band, target, ...mods, waveLevelBonus? }`: a wave's Hollowed add the Vigil's level rule
 * (`perWordLevel`, `levelCap`) over the words as they stand.
 */
export function riteModsFor(run, node) {
  const rite = sanitizeRite(run?.rite);
  if (!rite) return {};
  const target = riteTargetOf(node, run?.gameData);
  if (!target) return {};
  const config = riteConfigOf(run);
  const band = riteBand(rite.words, config);
  const mods = sanitizeRiteMods(config.mods?.[band]?.[target], target);
  if (Object.keys(mods).length === 0) return {};
  return {
    band,
    target,
    ...mods,
    ...(mods.waveHollowed
      ? {
          waveLevelBonus: hollowedLevelBonus({
            riteAtEntry: rite.words,
            perWordLevel: config.perWordLevel,
            levelCap: config.levelCap,
          }),
        }
      : {}),
  };
}

/** The Hollowed level rule the run's Rite sets (written into a locked vigil at generation). */
export function riteLevelRuleOf(run) {
  const config = riteConfigOf(run);
  return {
    perWordLevel: isInt(config.perWordLevel) && config.perWordLevel > 0 ? config.perWordLevel : 4,
    levelCap: isInt(config.levelCap) && config.levelCap >= 0 ? config.levelCap : 4,
  };
}

/**
 * The change a won battle at `node` makes on par (`underPar`, keyed by the node's `descentKey`:
 * the Mortuary Column's -1), or 0: only at or under a known par.
 */
export function riteUnderParDelta(config, node, { turnCount, turnPar } = {}) {
  const key = node?.descentKey;
  const delta = Math.trunc(Number(riteConfigOf(config).underPar?.[key]) || 0);
  if (!delta || typeof key !== 'string') return 0;
  const turns = Math.trunc(Number(turnCount));
  const par = Number(turnPar);
  if (!Number.isFinite(par) || !(turns > 0) || turns > par) return 0;
  return delta;
}

// ── Words for the UI ─────────────────────────────────────────────────────

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One plain line per mod, in a fixed order (what a tier does to that boss). */
export function riteModLines(mods, target) {
  const m = sanitizeRiteMods(mods, target);
  const lines = [];
  if (target === 'lieutenant') {
    if (m.escortDrop)
      lines.push(
        m.escortDrop === 1
          ? "The Lieutenant's strongest guard is gone from his side"
          : `The Lieutenant's ${m.escortDrop} strongest guards are gone from his side`,
      );
    if (m.revivalStones)
      lines.push(
        `The Lieutenant gains ${plural(m.revivalStones, 'Revival Stone')}: ${plural(m.revivalStones, 'more health bar')}`,
      );
    if (m.waveHollowed)
      lines.push(
        `${plural(m.waveHollowed, 'Hollowed', 'Hollowed')} ${m.waveHollowed === 1 ? 'joins' : 'join'} him on turn ${m.waveTurn || RITE_WAVE_TURN}`,
      );
  } else if (target === 'entity') {
    if (m.splashDelta)
      lines.push(
        `The Entity's splash strikes ${plural(Math.abs(m.splashDelta), 'tile')} ${m.splashDelta > 0 ? 'more' : 'fewer'}`,
      );
    if (m.waveHollowed)
      lines.push(
        `Each of the Entity's waves brings ${plural(m.waveHollowed, 'more Hollowed', 'more Hollowed')}`,
      );
  }
  return lines;
}

/**
 * What the UI shows of the Rite (the route map's chip, the finale's node preview), or null with
 * no Rite. With `node`, `effects` is that boss's only; else every boss the route still meets
 * (the route's finale, and on an Entity road the Lieutenant's gate first).
 * @returns {{ words: number, start: number, band: string, label: string, chip: string,
 *   next: { band: string, label: string, at: number }|null,
 *   effects: { target: string, lines: string[] }[], log: object[] }|null}
 */
export function riteView(run, { node = null } = {}) {
  const rite = sanitizeRite(run?.rite);
  if (!rite) return null;
  const config = riteConfigOf(run);
  const band = riteBand(rite.words, config);
  const index = config.bands.findIndex((b) => b.id === band);
  const nextBand = config.bands[index + 1] || null;
  const targets = node
    ? [riteTargetOf(node, run?.gameData)].filter(Boolean)
    : run?.nodeMap?.descent?.finale === 'entity'
      ? ['lieutenant', 'entity']
      : run?.nodeMap?.descent?.finale === 'lieutenant'
        ? ['lieutenant']
        : [];
  const label = riteBandLabel(band);
  return {
    words: rite.words,
    start: rite.start,
    band,
    label,
    chip: `The Rite: ${plural(rite.words, 'word')} · ${label}`,
    next: nextBand
      ? { band: nextBand.id, label: riteBandLabel(nextBand.id), at: whole(nextBand.min) }
      : null,
    effects: targets.map((target) => {
      const lines = riteModLines(config.mods?.[band]?.[target], target);
      return { target, lines: lines.length ? lines : ['No change'] };
    }),
    log: rite.log.map((entry) => ({ ...entry })),
  };
}

// ── Validation ──────────────────────────────────────────────────────────

/** Words that would reach the Entity's HP, stones, hinge, hum or rally: never a Rite mod. */
const ENTITY_FORBIDDEN = /hp|health|stone|hinge|hum|rally|enrage|finale|wound/i;

/**
 * The `rite` block of data/descent.json (`npm run validate:data`, through
 * Descent.validateDescentConfig). Refuses: unknown keys; a phase of the Eclipse with no start (or
 * a start for no phase); tiers not contiguous from 0 or a last tier with a max; mods for an
 * unknown tier or boss, a mod a boss may not carry or out of bounds (RITE_MOD_KEYS), and above
 * all anything that touches the Entity's HP, stones, hinge, hum or rally; an `underPar` key that
 * names no battle node of a route, or a change that is not a small non-zero whole number; the
 * Hollowed level rule.
 * @param {object|undefined} rite
 * @param {{ err: (where: string, message: string) => void, eclipse?: object,
 *   battleKeys?: Set<string> }} ctx
 */
export function validateRiteConfig(rite, { err, eclipse, battleKeys = null }) {
  if (rite === undefined) return;
  if (!isObject(rite)) {
    err('rite', 'must be an object');
    return;
  }
  for (const key of Object.keys(rite))
    if (!['startByPhase', 'bands', 'mods', 'underPar', 'perWordLevel', 'levelCap'].includes(key))
      err('rite', `unknown key "${key}"`);
  const phases = (eclipse?.phases || []).map((p) => p?.id).filter(Boolean);
  const start = rite.startByPhase;
  if (!isObject(start)) err('rite.startByPhase', 'must map Eclipse phases to words');
  else {
    for (const [phase, n] of Object.entries(start)) {
      if (phases.length && !phases.includes(phase))
        err('rite.startByPhase', `"${phase}" is not a phase`);
      if (!(isInt(n) && n >= 0)) err(`rite.startByPhase.${phase}`, 'must be a whole number >= 0');
    }
    for (const phase of phases)
      if (start[phase] === undefined) err('rite.startByPhase', `names no words for "${phase}"`);
  }
  const bands = Array.isArray(rite.bands) ? rite.bands : null;
  const bandIds = new Set();
  if (!bands || bands.length === 0) err('rite.bands', 'must list the tiers');
  else {
    let expected = 0;
    bands.forEach((band, i) => {
      const bw = `rite.bands[${i}]`;
      if (!isObject(band) || typeof band.id !== 'string' || !ID.test(band.id)) {
        err(bw, 'must be { id, min, max? }');
        return;
      }
      if (bandIds.has(band.id)) err(bw, `id "${band.id}" is used twice`);
      bandIds.add(band.id);
      if (band.min !== expected)
        err(bw, `min must be ${expected} (the tiers are contiguous from 0)`);
      const isLastBand = i === bands.length - 1;
      if (isLastBand) {
        if (band.max !== undefined) err(bw, 'the last tier is open (no max)');
      } else if (!(isInt(band.max) && band.max >= band.min))
        err(bw, 'max must be a whole number >= min');
      else expected = band.max + 1;
    });
  }
  if (rite.mods !== undefined) {
    if (!isObject(rite.mods)) err('rite.mods', 'must be keyed by tier');
    else
      for (const [band, mod] of Object.entries(rite.mods)) {
        if (!bandIds.has(band)) err('rite.mods', `"${band}" is not a tier`);
        if (!isObject(mod)) {
          err(`rite.mods.${band}`, 'must be an object');
          continue;
        }
        for (const [target, mods] of Object.entries(mod))
          validateTargetMods(`rite.mods.${band}.${target}`, target, mods, err);
      }
  }
  if (rite.underPar !== undefined) {
    if (!isObject(rite.underPar)) err('rite.underPar', 'must map node keys to a change');
    else
      for (const [key, delta] of Object.entries(rite.underPar)) {
        if (battleKeys && !battleKeys.has(key))
          err('rite.underPar', `"${key}" is no battle node of a route`);
        if (!(isInt(delta) && delta !== 0 && Math.abs(delta) <= 3))
          err(`rite.underPar.${key}`, 'must be a whole number from -3 to 3, not 0');
      }
  }
  if (!(isInt(rite.perWordLevel) && rite.perWordLevel > 0))
    err('rite.perWordLevel', 'must be a whole number > 0');
  if (!(isInt(rite.levelCap) && rite.levelCap >= 0))
    err('rite.levelCap', 'must be a whole number >= 0');
}

function validateTargetMods(where, target, mods, err) {
  const allowed = RITE_MOD_KEYS[target];
  if (!allowed) {
    err(where, `"${target}" is not a boss the Rite reads (${RITE_TARGETS.join(', ')})`);
    return;
  }
  if (!isObject(mods)) {
    err(where, 'must be an object');
    return;
  }
  for (const [key, value] of Object.entries(mods)) {
    const bounds = allowed[key];
    if (!bounds) {
      if (target === 'entity' && ENTITY_FORBIDDEN.test(key))
        err(where, `"${key}": the Rite never touches the Entity's HP, stones, hinge, hum or rally`);
      else err(where, `"${key}" is not a mod the ${target} takes`);
      continue;
    }
    if (!(isInt(value) && value >= bounds.min && value <= bounds.max))
      err(`${where}.${key}`, `must be a whole number from ${bounds.min} to ${bounds.max}`);
  }
  if (mods.waveTurn !== undefined && !mods.waveHollowed)
    err(where, 'waveTurn needs a waveHollowed');
}

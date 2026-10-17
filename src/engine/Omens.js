// Omens.js - opt-in challenge modifiers, Hades Heat style (docs/specs/omens.md).
//
// difficulty.json `omens` = { unlock, rungs, list: [{ id, name, lore, ranks: [{ heat, text,
// effects }] }] }. Each rank lists its WHOLE effect and heat (rank 2's entry, not rank 2 minus
// rank 1). A run's choice is `{ [omenId]: rank }`; its Heat is the sum of the chosen ranks' heat.
//
// At run start (RunManager.startRun) the choice is resolved once into
//   run.omens = { v: 1, ranks: { id: rank }, heat, effects }   (saved; null for no Omens)
// and the `effects` that are difficulty levers are laid over the run's difficulty modifiers
// (applyOmenModifiers: saved with the run, so every existing reader, scene, scout and harness
// alike, plays them with no change). The rest are read from `run.omens.effects` by the code they
// change (omenEffect). A run keeps the Omens and the numbers it started with.
//
// Pure. No Math.random.
import { withEchoBossStones } from './NgPlusEcho.js';

export const OMENS_VERSION = 1;

/** Effects that are additions to difficulty levers (and to any act override that sets them). */
export const OMEN_MODIFIER_ADDS = Object.freeze([
  'enemyStatBonus',
  'enemyCountBonus',
  'enemySkillChance',
  'deployLimitBonus',
  'parInflation',
]);
/** Effects that multiply difficulty levers. */
export const OMEN_MODIFIER_MULTS = Object.freeze(['goldMultiplier', 'shopPriceMultiplier']);
/** Effects read from `run.omens.effects` by the code they change. */
export const OMEN_RUN_EFFECTS = Object.freeze([
  'bossStones', // +N Revival Stones on every boss and elite captain (never the Entity)
  'visionDelta', // Vision charges at run start (negative)
  'noRuinsRevive', // true: the Ruins give back none of the fallen
  'riteStartDelta', // the Descent's Rite starts this many words higher
  'huntedWave', // { turn, count: [min, max], xpMultiplier }: every non-boss battle is hunted
  'shadowGainDelta', // the Eclipse's gain grows by this share (0.25 steps)
  'affixChanceMultiplier', // foes roll affixes this much more often
  'affixMaxBonus', // +N affixes a foe may carry
]);
export const OMEN_EFFECT_KEYS = Object.freeze([
  ...OMEN_MODIFIER_ADDS,
  ...OMEN_MODIFIER_MULTS,
  ...OMEN_RUN_EFFECTS,
]);

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const whole = (v) => Math.max(0, Math.floor(Number(v) || 0));

/** The game data's Omens block, or null. */
export function omensConfigOf(gameData) {
  const block = gameData?.difficulty?.omens;
  return isObject(block) && Array.isArray(block.list) ? block : null;
}

/** Every Omen definition (empty when the data has none). */
export function omenList(gameData) {
  return omensConfigOf(gameData)?.list || [];
}

/** The rungs Omens may be chosen on. */
export function omenRungs(gameData) {
  const rungs = omensConfigOf(gameData)?.rungs;
  return Array.isArray(rungs) ? rungs : [];
}

/** True when Omens can be chosen for a run on this rung. */
export function omensAllowedOn(gameData, difficultyId) {
  return omenRungs(gameData).includes(difficultyId);
}

/**
 * A choice cleaned against the data: known Omens only, ranks clamped to 1..max, rank 0 dropped.
 * @returns {{ [id: string]: number }}
 */
export function sanitizeOmenRanks(raw, gameData) {
  const out = {};
  if (!isObject(raw)) return out;
  for (const omen of omenList(gameData)) {
    const rank = Math.min(whole(raw[omen.id]), omen.ranks.length);
    if (rank > 0) out[omen.id] = rank;
  }
  return out;
}

/** The Vision charges an Omen's rank takes at run start (0 for none). */
export function omenVisionCost(omen, rank) {
  if (!rank) return 0;
  return Math.max(0, -Math.trunc(Number(omen?.ranks?.[rank - 1]?.effects?.visionDelta) || 0));
}

/**
 * A choice with every rank its start can pay for (the review of #444): Spent Thread takes
 * Vision charges at run start, and a rank that would take more than the start holds costs
 * nothing more, so it must not count more Heat. Each Omen that takes Vision keeps its highest
 * rank the charges left can pay; the rest are untouched. `startVision` null: no cap.
 * @returns {{ [id: string]: number }}
 */
export function payableOmenRanks(ranks, gameData, startVision = null) {
  const clean = sanitizeOmenRanks(ranks, gameData);
  if (startVision === null || startVision === undefined) return clean;
  let left = whole(startVision);
  for (const omen of omenList(gameData)) {
    let rank = clean[omen.id] || 0;
    while (rank > 0 && omenVisionCost(omen, rank) > left) rank -= 1;
    if (rank > 0) clean[omen.id] = rank;
    else delete clean[omen.id];
    left -= omenVisionCost(omen, rank);
  }
  return clean;
}

/** The highest rank of an Omen a start with `startVision` charges can pay (its max for null). */
export function payableOmenMax(omen, startVision = null) {
  let rank = omen?.ranks?.length || 0;
  if (startVision === null || startVision === undefined) return rank;
  while (rank > 0 && omenVisionCost(omen, rank) > whole(startVision)) rank -= 1;
  return rank;
}

/** The Heat of a choice. */
export function heatOf(ranks, gameData) {
  let heat = 0;
  for (const omen of omenList(gameData)) {
    const rank = whole(ranks?.[omen.id]);
    if (rank > 0) heat += whole(omen.ranks[Math.min(rank, omen.ranks.length) - 1]?.heat);
  }
  return heat;
}

/** The combined effects of a choice: additions summed, multipliers multiplied, flags or'd. */
export function effectsOf(ranks, gameData) {
  const effects = {};
  for (const omen of omenList(gameData)) {
    const rank = whole(ranks?.[omen.id]);
    if (!rank) continue;
    const entry = omen.ranks[Math.min(rank, omen.ranks.length) - 1]?.effects || {};
    for (const [key, value] of Object.entries(entry)) {
      if (OMEN_MODIFIER_MULTS.includes(key) || key === 'affixChanceMultiplier')
        effects[key] = (effects[key] ?? 1) * value;
      else if (key === 'noRuinsRevive') effects[key] = effects[key] || value === true;
      else if (key === 'huntedWave') effects[key] = structuredClone(value);
      else effects[key] = (effects[key] || 0) + value;
    }
  }
  return effects;
}

/** A run's Omens record for a choice, or null when nothing is chosen (or not allowed). */
export function createOmensRecord(rawRanks, gameData, difficultyId) {
  if (!omensAllowedOn(gameData, difficultyId)) return null;
  const ranks = sanitizeOmenRanks(rawRanks, gameData);
  if (!Object.keys(ranks).length) return null;
  return {
    v: OMENS_VERSION,
    ranks,
    heat: heatOf(ranks, gameData),
    effects: effectsOf(ranks, gameData),
  };
}

/** A saved `run.omens`, or null for anything that is not a whole v1 record. */
export function sanitizeOmensRecord(raw) {
  if (!isObject(raw) || raw.v !== OMENS_VERSION || !isObject(raw.ranks)) return null;
  const ranks = {};
  for (const [id, rank] of Object.entries(raw.ranks)) if (whole(rank) > 0) ranks[id] = whole(rank);
  if (!Object.keys(ranks).length) return null;
  const effects = {};
  if (isObject(raw.effects))
    for (const key of OMEN_EFFECT_KEYS)
      if (raw.effects[key] !== undefined) effects[key] = raw.effects[key];
  return { v: OMENS_VERSION, ranks, heat: whole(raw.heat), effects };
}

/** The run's Heat (0 with no Omens). */
export function runHeat(run) {
  return whole(run?.omens?.heat);
}

/** One of the run's Omen effects, or the fallback. */
export function omenEffect(run, key, fallback = null) {
  const value = run?.omens?.effects?.[key];
  return value === undefined ? fallback : value;
}

/**
 * The run's deploy cut (the Thin Ranks Knot, 0 or below). It is laid on the rung's lever by
 * overlayRunOmens but cuts after a set piece's cap (resolveDeployLimits' `deployCut`), so the
 * deploy bonus leaves it out (RunManager.getDeployBonus) and runDeployLimits adds it back.
 */
export function omenDeployCut(run) {
  return Math.min(0, Math.trunc(Number(omenEffect(run, 'deployLimitBonus', 0)) || 0));
}

/**
 * Lay a run's Omens over its difficulty modifiers (a copy is returned; the input is untouched):
 * additions to each lever and to every act override that sets it, multipliers on the rung's
 * value, and Stone-hearted's boss stones on the Revival Stones table.
 * @param {object} modifiers - the run's resolved difficulty modifiers
 * @param {object} effects - run.omens.effects
 * @param {object} [defaults] - fallbacks for a lever the rung leaves null (turnBonus' parInflation)
 */
export function applyOmenModifiers(modifiers, effects, defaults = {}) {
  const out = structuredClone(modifiers || {});
  if (!isObject(effects)) return out;
  for (const key of OMEN_MODIFIER_ADDS) {
    const delta = Number(effects[key]);
    if (!Number.isFinite(delta) || delta === 0) continue;
    const base = Number.isFinite(out[key]) ? out[key] : Number(defaults[key]) || 0;
    out[key] = clampLever(key, base + delta);
    for (const over of Object.values(isObject(out.actOverrides) ? out.actOverrides : {}))
      if (isObject(over) && Number.isFinite(over[key]))
        over[key] = clampLever(key, over[key] + delta);
  }
  for (const key of OMEN_MODIFIER_MULTS) {
    const mult = Number(effects[key]);
    if (!Number.isFinite(mult) || mult === 1) continue;
    out[key] = (Number.isFinite(out[key]) ? out[key] : 1) * mult;
  }
  const stones = whole(effects.bossStones);
  if (stones) {
    // Stone-hearted: every boss and elite captain (never the Entity: it has no stone kind).
    out.revivalStones = withEchoBossStones(out.revivalStones, stones);
    out.revivalStones.eliteCaptain = whole(out.revivalStones.eliteCaptain) + stones;
  }
  return out;
}

function clampLever(key, value) {
  if (key === 'enemySkillChance') return Math.min(1, Math.max(0, value));
  if (key === 'parInflation') return Math.max(0, value);
  return value;
}

/** Validate difficulty.json `omens` (absent is valid). */
export function validateOmensConfig(block) {
  const errors = [];
  if (block === undefined) return { valid: true, errors };
  if (!isObject(block)) return { valid: false, errors: ['omens must be an object'] };
  if (!Array.isArray(block.rungs) || !block.rungs.length)
    errors.push('omens.rungs must list rungs');
  if (!Array.isArray(block.list))
    return { valid: false, errors: [...errors, 'omens.list must be a list'] };
  const ids = new Set();
  block.list.forEach((omen, i) => {
    const at = `omens.list[${i}]`;
    if (!isObject(omen)) return errors.push(`${at} must be an object`);
    if (typeof omen.id !== 'string' || !/^[a-z_]+$/.test(omen.id))
      errors.push(`${at}.id must be snake_case`);
    if (ids.has(omen.id)) errors.push(`${at}.id repeats`);
    ids.add(omen.id);
    if (typeof omen.name !== 'string' || !omen.name) errors.push(`${at}.name is required`);
    if (!Array.isArray(omen.ranks) || !omen.ranks.length)
      return errors.push(`${at}.ranks must list ranks`);
    let lastHeat = 0;
    omen.ranks.forEach((rank, r) => {
      const ra = `${at}.ranks[${r}]`;
      if (!Number.isInteger(rank?.heat) || rank.heat <= lastHeat)
        errors.push(`${ra}.heat must be an integer above the rank before`);
      lastHeat = Number(rank?.heat) || lastHeat;
      if (typeof rank?.text !== 'string' || !rank.text || rank.text.length > 90)
        errors.push(`${ra}.text must be 1-90 characters`);
      if (!isObject(rank?.effects) || !Object.keys(rank.effects).length)
        errors.push(`${ra}.effects must name an effect`);
      for (const [key, value] of Object.entries(rank?.effects || {})) {
        if (!OMEN_EFFECT_KEYS.includes(key))
          errors.push(`${ra}.effects.${key} is not an Omen effect`);
        else if (!effectPointsHarder(key, value))
          errors.push(`${ra}.effects.${key} must make the run harder`);
      }
      // A rank the start cannot pay is dropped at run start (payableOmenRanks), after the
      // levers were laid: so a Vision rank holds Vision alone.
      if (rank?.effects?.visionDelta !== undefined && Object.keys(rank.effects).length > 1)
        errors.push(`${ra}.effects: visionDelta must be the rank's only effect`);
    });
  });
  return { valid: errors.length === 0, errors };
}

/** True when an effect's value makes the run harder (an Omen is never a boon). */
function effectPointsHarder(key, value) {
  switch (key) {
    case 'deployLimitBonus':
    case 'parInflation':
    case 'visionDelta':
      return Number.isInteger(value) && value < 0;
    case 'enemySkillChance':
    case 'shadowGainDelta':
      return Number.isFinite(value) && value > 0 && value <= 1;
    case 'goldMultiplier':
      return Number.isFinite(value) && value > 0 && value < 1;
    case 'shopPriceMultiplier':
    case 'affixChanceMultiplier':
      return Number.isFinite(value) && value > 1 && value <= 5;
    case 'noRuinsRevive':
      return value === true;
    case 'huntedWave':
      return (
        isObject(value) &&
        Number.isInteger(value.turn) &&
        value.turn >= 1 &&
        Array.isArray(value.count) &&
        value.count.length === 2 &&
        value.count.every((n) => Number.isInteger(n) && n >= 1) &&
        value.count[0] <= value.count[1] &&
        Number.isFinite(value.xpMultiplier) &&
        value.xpMultiplier >= 0 &&
        value.xpMultiplier <= 1
      );
    default:
      return Number.isInteger(value) && value > 0 && value <= 10;
  }
}

/**
 * Start a run's Omens (RunManager.startRun, right after the rung is applied): the record from
 * the chosen ranks, saved on `run.omens`, and the difficulty levers laid over the run's
 * modifiers. A choice that is empty or not allowed on the rung leaves the run without Omens.
 */
export function overlayRunOmens(run, choice) {
  run.omens = createOmensRecord(choice, run.gameData, run.difficultyId);
  if (run.omens)
    run.difficultyModifiers = applyOmenModifiers(run.difficultyModifiers, run.omens.effects, {
      parInflation: run.gameData?.turnBonus?.parInflation,
    });
  return run.omens;
}

/**
 * The Omens that change the run's opening state (RunManager.startRun, once Vision and the
 * blessing modifiers exist): Spent Thread's Vision, Long Night's faster Eclipse (laid on the same
 * quarter-step share Darkened Dawn raises, so its saved carry keeps the gain exact).
 */
export function applyOmensAtStart(run) {
  // Only the ranks the opening Vision can pay count (Heat included); a rank above is dropped
  // here, before anything is taken. Only a rank whose one effect is Vision can be dropped, so
  // the levers already laid over the difficulty (overlayRunOmens) are unchanged.
  if (run.omens) {
    const paid = payableOmenRanks(run.omens.ranks, run.gameData, run.visionChargesRemaining || 0);
    const same =
      Object.keys(paid).length === Object.keys(run.omens.ranks).length &&
      Object.entries(paid).every(([id, rank]) => run.omens.ranks[id] === rank);
    if (!same) run.omens = createOmensRecord(paid, run.gameData, run.difficultyId);
  }
  const vision = Math.trunc(Number(omenEffect(run, 'visionDelta', 0)) || 0);
  if (vision) run.visionChargesRemaining = Math.max(0, (run.visionChargesRemaining || 0) + vision);
  const shadow = Number(omenEffect(run, 'shadowGainDelta', 0)) || 0;
  if (shadow > 0 && run.blessingRuntimeModifiers)
    run.blessingRuntimeModifiers.eclipseGainDelta =
      (Number(run.blessingRuntimeModifiers.eclipseGainDelta) || 0) + shadow;
}

/** Grave Road's refusal at the Ruins, or ''. */
export const GRAVE_ROAD_LINE = 'Grave Road: the Ruins give back none of the fallen.';
export function omenRuinsReviveBlock(run) {
  return omenEffect(run, 'noRuinsRevive') === true ? GRAVE_ROAD_LINE : '';
}

// ── Records ─────────────────────────────────────────────────────────────
// A win's Heat is kept as a meta milestone `heat:<rung>:<heat>` (milestones are a set the cloud
// and every copy union, so a record is never lost to a stale write), and on the run's record.

const HEAT_MILESTONE = /^heat:([a-z]+):(\d+)$/;

/** The milestone a won run's Heat earns, or null (no Omens, or not a win). */
export function heatVictoryMilestone(run, summary) {
  const heat = runHeat(run);
  return summary?.result === 'victory' && heat > 0 ? `heat:${run.difficultyId}:${heat}` : null;
}

/** The best Heat won on a rung, from the meta milestones (0 when none). */
export function bestHeatOn(milestones, difficultyId) {
  let best = 0;
  for (const m of milestones || []) {
    const match = HEAT_MILESTONE.exec(m);
    if (match && match[1] === difficultyId) best = Math.max(best, Number(match[2]));
  }
  return best;
}

/** Omens open after a Black Sun win (the `beatLunatic` milestone). */
export const OMENS_UNLOCK_MILESTONE = 'beatLunatic';

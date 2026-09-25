// DeedSystem — deeds and epithets (docs/specs/deeds-epithets.md).
//
// Units earn deeds from what they actually do: holding a bridge through three
// enemy phases, landing the blow that ends a boss, surviving on one hit point.
// A deed carries an epithet ("Elara, Who Held the Bridge") that follows the
// unit through the roster, the ceremonies and the run's records, and may
// leave an Oath on promotion (a skill the unit could not otherwise learn).
//
// Pure: no Phaser, no DOM and never the RNG (the battle RNG is Math.random
// during a battle; nothing here may draw from it).
//
// State:
//  - `unit._battleDeeds` — battle scratch (plain JSON on the unit). Vision
//    rewind and suspend restore it with the unit; `serializeUnit` strips it,
//    so an abandoned battle ("Continue from Map") leaves nothing behind.
//  - `unit.deeds` — `{ stats, earned, epithet, oath?, lastBattle? }`, run
//    state, written only by `commitBattleDeeds` at victory (before the save)
//    and by `applyPromotionOath`. Legacy units without it read as empty.
//  - `enemy._slewAllies` — names of player units an enemy killed this battle
//    (for the Avenger deed); it lives and rolls back with the enemy.
//
// `unit.name` is identity: epithets never go into it. Render titles through
// `unitDisplayName` / `titledName` / `sentenceName`.

import { getXpEffectiveLevel, learnSkill } from './UnitManager.js';
import { DEED_FORMS, titledName, unitEpithet } from './DeedTitles.js';

// Display helpers live in DeedTitles (dependency-free); re-exported here.
export {
  DEED_FORMS,
  epithetText,
  isAppositive,
  sentenceName,
  sentenceTitle,
  titledName,
  unitDisplayName,
  unitEpithet,
} from './DeedTitles.js';

const DEFAULT_TUNING = Object.freeze({ heldPhaseMinAttacks: 2, shieldPhaseMinAttacks: 1 });

// Battle counters merged into the run tallies at victory.
const RUN_SUM_KEYS = Object.freeze(['kills', 'crits', 'healed', 'refreshes', 'bossKills']);
const RUN_MAP_KEYS = Object.freeze(['killsByTerrain', 'killsByWeapon']);
const BATTLE_NUMBER_KEYS = Object.freeze([
  'kills',
  'crits',
  'strikesFaced',
  'woundsTaken',
  'brink',
  'bossKills',
  'avenged',
  'maxKillLevelGap',
  'healed',
  'refreshes',
  'phaseAttacks',
  'heldPhases',
  'heldStreak',
  'shieldPhases',
  'lastStanding',
]);
const MAX_LIST = 32;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const count = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);

/** Only the player's army earns deeds. */
export function isDeedUnit(unit) {
  return Boolean(unit) && unit.faction === 'player';
}

function isFoe(unit) {
  return Boolean(unit) && unit.faction === 'enemy';
}

// ── Battle scratch ───────────────────────────────────────────────────────

export function emptyBattleDeeds() {
  return {
    v: 1,
    kills: 0,
    crits: 0,
    strikesFaced: 0,
    woundsTaken: 0,
    brink: 0,
    bossKills: 0,
    bossNames: [],
    avenged: 0,
    maxKillLevelGap: 0,
    killsByTerrain: {},
    killsByWeapon: {},
    healed: 0,
    refreshes: 0,
    phaseAttacks: 0,
    heldPhases: 0,
    heldStreak: 0,
    heldPlaces: [],
    heldBestPlaces: [],
    shieldPhases: 0,
    lastPhaseEnd: null,
  };
}

function sanitizeCountMap(map) {
  const out = {};
  if (!isObject(map)) return out;
  for (const [key, value] of Object.entries(map)) {
    if (typeof key !== 'string' || !key) continue;
    const n = count(value);
    if (n > 0) out[key] = n;
  }
  return out;
}

function sanitizeStringList(list) {
  return (Array.isArray(list) ? list : [])
    .filter((v) => v === null || typeof v === 'string')
    .slice(-MAX_LIST);
}

/** A clean copy of battle scratch (unknown/garbled fields dropped). */
export function sanitizeBattleDeeds(raw) {
  const out = emptyBattleDeeds();
  if (!isObject(raw)) return out;
  for (const key of BATTLE_NUMBER_KEYS) out[key] = count(raw[key]);
  out.killsByTerrain = sanitizeCountMap(raw.killsByTerrain);
  out.killsByWeapon = sanitizeCountMap(raw.killsByWeapon);
  out.bossNames = sanitizeStringList(raw.bossNames).filter(Boolean);
  out.heldPlaces = sanitizeStringList(raw.heldPlaces);
  out.heldBestPlaces = sanitizeStringList(raw.heldBestPlaces);
  out.lastPhaseEnd = Number.isFinite(raw.lastPhaseEnd) ? Math.trunc(raw.lastPhaseEnd) : null;
  return out;
}

/** Ensure (and return) the unit's battle scratch. Null for non-player units. */
export function beginBattleDeeds(unit) {
  if (!isDeedUnit(unit)) return null;
  const b = unit._battleDeeds;
  // Garbled or partial scratch (an older checkpoint) is normalized in place of
  // letting a counter become NaN.
  const complete =
    isObject(b) &&
    b.v === 1 &&
    BATTLE_NUMBER_KEYS.every((key) => Number.isFinite(b[key])) &&
    ['bossNames', 'heldPlaces', 'heldBestPlaces'].every((key) => Array.isArray(b[key])) &&
    isObject(b.killsByTerrain) &&
    isObject(b.killsByWeapon);
  if (!complete) unit._battleDeeds = isObject(b) ? sanitizeBattleDeeds(b) : emptyBattleDeeds();
  return unit._battleDeeds;
}

function bump(map, key, by = 1) {
  if (typeof key !== 'string' || !key) return;
  map[key] = count(map[key]) + by;
}

/**
 * One resolved combat (call after the final HP is applied to both units).
 * Reads the engine's strike events, never the fog-filtered timeline.
 * @param {{events: object[]}} result  resolveCombat result
 * @param {{phase?: 'player'|'enemy'}} ctx
 */
export function recordCombat(result, attacker, defender, ctx = {}) {
  const events = Array.isArray(result?.events) ? result.events : [];
  const woundedNow = new Set();
  const miracle = new Set();
  for (const event of events) {
    if (event?.type !== 'strike') continue;
    const striker = event.attackerSide === 'defender' ? defender : attacker;
    const target = striker === attacker ? defender : attacker;
    if (isDeedUnit(striker) && isFoe(target) && !event.miss && event.isCrit)
      beginBattleDeeds(striker).crits++;
    if (isDeedUnit(target) && isFoe(striker)) {
      const b = beginBattleDeeds(target);
      b.strikesFaced++;
      if (!event.miss && count(event.damage) > 0) {
        b.woundsTaken++;
        woundedNow.add(target);
      }
    }
    if (isDeedUnit(target) && event.skillActivations?.some?.((a) => a?.id === 'miracle'))
      miracle.add(target);
  }
  // Brink: a wounded unit that ends the exchange on its last hit point (or
  // was held up by Miracle). Starting at 1 HP and not being hit does not count.
  for (const unit of [attacker, defender]) {
    if (!isDeedUnit(unit) || !(Number(unit.currentHP) > 0)) continue;
    if (miracle.has(unit) || (woundedNow.has(unit) && Number(unit.currentHP) === 1))
      beginBattleDeeds(unit).brink++;
  }
  // Held / Lord's Shield: an enemy attacking the unit in the enemy phase.
  if (ctx.phase === 'enemy' && isDeedUnit(defender) && isFoe(attacker))
    beginBattleDeeds(defender).phaseAttacks++;
}

/**
 * A unit left the field dead. `ctx.terrain` is the killer's terrain name.
 * An enemy that kills a player unit remembers the name (Avenger).
 */
export function recordKill(victim, killer, ctx = {}) {
  if (!victim || !killer) return;
  if (isDeedUnit(victim) && isFoe(killer)) {
    const slain = Array.isArray(killer._slewAllies) ? killer._slewAllies : [];
    if (typeof victim.name === 'string') killer._slewAllies = [...slain, victim.name].slice(-8);
    return;
  }
  if (!isFoe(victim) || !isDeedUnit(killer)) return;
  const b = beginBattleDeeds(killer);
  b.kills++;
  if (typeof ctx.terrain === 'string') bump(b.killsByTerrain, ctx.terrain);
  bump(b.killsByWeapon, typeof killer.weapon?.type === 'string' ? killer.weapon.type : null);
  const gap = getXpEffectiveLevel(victim) - getXpEffectiveLevel(killer);
  if (gap > b.maxKillLevelGap) b.maxKillLevelGap = gap;
  if (victim.isBoss) {
    b.bossKills++;
    if (typeof victim.name === 'string' && victim.name)
      b.bossNames = [...b.bossNames, victim.name].slice(-MAX_LIST);
  }
  const slain = Array.isArray(victim._slewAllies) ? victim._slewAllies : [];
  if (slain.some((name) => name !== killer.name)) b.avenged++;
}

/** HP actually restored to someone else by a staff or a healing ability. */
export function recordHeal(healer, amount) {
  const n = count(amount);
  if (!isDeedUnit(healer) || n <= 0) return;
  beginBattleDeeds(healer).healed += n;
}

/** A dance / refresh that gave an ally another action. */
export function recordRefresh(dancer) {
  if (!isDeedUnit(dancer)) return;
  beginBattleDeeds(dancer).refreshes++;
}

function manhattan(a, b) {
  return Math.abs((a?.col ?? NaN) - (b?.col ?? NaN)) + Math.abs((a?.row ?? NaN) - (b?.row ?? NaN));
}

/**
 * The enemy phase ended (call before any player turn-start effect). Units
 * attacked often enough this phase held their ground; next to the living
 * commander they were its shield. Idempotent per turn.
 * @param {object[]} units  living player units
 * @param {{turn?: number, terrainAt?: (unit) => string|null, commander?: object,
 *          deedsData?: object}} ctx
 */
export function recordEnemyPhaseEnd(units, ctx = {}) {
  const tuning = { ...DEFAULT_TUNING, ...(ctx.deedsData?.tuning || {}) };
  const turn = Number.isFinite(ctx.turn) ? Math.trunc(ctx.turn) : null;
  const commander = ctx.commander && Number(ctx.commander.currentHP) > 0 ? ctx.commander : null;
  for (const unit of Array.isArray(units) ? units : []) {
    if (!isDeedUnit(unit) || !(Number(unit.currentHP) > 0)) continue;
    if (!isObject(unit._battleDeeds)) continue; // never attacked this battle
    const b = beginBattleDeeds(unit);
    if (turn !== null && b.lastPhaseEnd === turn) continue;
    if (turn !== null) b.lastPhaseEnd = turn;
    const attacks = count(b.phaseAttacks);
    b.phaseAttacks = 0;
    // Held: enemy phases in a row under attack. `heldPhases` is the longest
    // run this battle; `heldBestPlaces` where it stood through it.
    if (attacks >= tuning.heldPhaseMinAttacks) {
      let place;
      try {
        place = ctx.terrainAt?.(unit) ?? null;
      } catch {
        place = null;
      }
      b.heldStreak++;
      b.heldPlaces = [...b.heldPlaces, typeof place === 'string' ? place : null].slice(-MAX_LIST);
      if (b.heldStreak > b.heldPhases) {
        b.heldPhases = b.heldStreak;
        b.heldBestPlaces = [...b.heldPlaces];
      }
    } else {
      b.heldStreak = 0;
      b.heldPlaces = [];
    }
    if (attacks <= 0) continue;
    if (
      attacks >= tuning.shieldPhaseMinAttacks &&
      commander &&
      commander !== unit &&
      manhattan(unit, commander) === 1
    )
      b.shieldPhases++;
  }
}

// ── Run state ────────────────────────────────────────────────────────────

function sanitizeEarned(entry) {
  if (!isObject(entry) || typeof entry.id !== 'string' || !entry.id) return null;
  if (typeof entry.epithet !== 'string' || !entry.epithet.trim()) return null;
  const out = {
    id: entry.id.slice(0, 64),
    epithet: entry.epithet.trim().slice(0, 80),
    form: DEED_FORMS.includes(entry.form) ? entry.form : 'the',
    prestige: Math.min(5, Math.max(1, count(entry.prestige) || 1)),
    seq: count(entry.seq),
  };
  if (typeof entry.oath === 'string' && entry.oath.trim())
    out.oath = entry.oath.trim().slice(0, 80);
  const at = entry.awardedAt;
  out.awardedAt = {
    act: typeof at?.act === 'string' ? at.act.slice(0, 32) : null,
    battle: Number.isFinite(at?.battle) ? Math.max(0, Math.trunc(at.battle)) : null,
  };
  return out;
}

/**
 * A clean copy of `unit.deeds`, or null when absent/unusable (legacy units).
 * Saves go through this on load; the result is stable under a second pass.
 */
export function sanitizeUnitDeeds(raw) {
  if (!isObject(raw)) return null;
  const stats = {};
  const rawStats = isObject(raw.stats) ? raw.stats : {};
  for (const key of [...RUN_SUM_KEYS, 'battles']) {
    const n = count(rawStats[key]);
    if (n > 0) stats[key] = n;
  }
  for (const key of RUN_MAP_KEYS) {
    const map = sanitizeCountMap(rawStats[key]);
    if (Object.keys(map).length) stats[key] = map;
  }
  const seen = new Set();
  const earned = [];
  for (const entry of Array.isArray(raw.earned) ? raw.earned : []) {
    const clean = sanitizeEarned(entry);
    if (!clean || seen.has(clean.id)) continue;
    seen.add(clean.id);
    earned.push(clean);
  }
  const out = { stats, earned, epithet: pickEpithet(earned) };
  if (typeof raw.lastBattle === 'string' && raw.lastBattle)
    out.lastBattle = raw.lastBattle.slice(0, 160);
  const oath = raw.oath;
  if (isObject(oath) && typeof oath.skillId === 'string' && typeof oath.deedId === 'string') {
    out.oath = {
      deedId: oath.deedId.slice(0, 64),
      skillId: oath.skillId.slice(0, 64),
      name: typeof oath.name === 'string' ? oath.name.slice(0, 80) : '',
      className: typeof oath.className === 'string' ? oath.className.slice(0, 80) : '',
    };
  }
  return out;
}

/** Load-time normalizer for a saved unit (returns the unit). */
export function normalizeUnitDeeds(unit) {
  if (!unit || typeof unit !== 'object') return unit;
  if (unit.deeds === undefined) return unit;
  const clean = sanitizeUnitDeeds(unit.deeds);
  if (clean) unit.deeds = clean;
  else delete unit.deeds;
  return unit;
}

/** Earned deeds of a unit (empty for legacy/no deeds). */
export function earnedDeeds(unit) {
  return Array.isArray(unit?.deeds?.earned) ? unit.deeds.earned : [];
}

/** Run tallies of a unit ({} when none). */
export function deedStats(unit) {
  return isObject(unit?.deeds?.stats) ? unit.deeds.stats : {};
}

/** "14 kills · 3 critical hits · 120 HP healed · 6 battles" (empty when none). */
export function deedTallyText(unit) {
  const s = deedStats(unit);
  const parts = [];
  const add = (n, one, many) => {
    const v = count(n);
    if (v > 0) parts.push(`${v} ${v === 1 ? one : many}`);
  };
  add(s.kills, 'kill', 'kills');
  add(s.crits, 'critical hit', 'critical hits');
  if (count(s.healed) > 0) parts.push(`${count(s.healed)} HP healed`);
  add(s.refreshes, 'dance', 'dances');
  add(s.battles, 'battle', 'battles');
  return parts.join(' · ');
}

/** A deed's definition by id (null when the data no longer has it). */
export function deedDefinition(deedsData, id) {
  return (deedsData?.deeds || []).find((d) => d?.id === id) || null;
}

/**
 * Earned deeds for display, the title first then newest: `{id, name, epithet, form, lore,
 * oath, awardedAt, isTitle}`. Text comes from the stored award (it never
 * changes); name and lore from the data when present.
 */
export function deedsForDisplay(unit, deedsData) {
  const title = unitEpithet(unit);
  const rank = (entry) => (entry.id === title?.id ? 1 : 0);
  return [...earnedDeeds(unit)]
    .sort((a, b) => rank(b) - rank(a) || b.seq - a.seq)
    .map((entry) => {
      const def = deedDefinition(deedsData, entry.id);
      return {
        id: entry.id,
        name: typeof def?.name === 'string' ? def.name : entry.id,
        epithet: entry.epithet,
        form: entry.form,
        lore: typeof def?.lore === 'string' ? def.lore : '',
        oath: entry.oath || null,
        awardedAt: entry.awardedAt || null,
        isTitle: title?.id === entry.id,
      };
    });
}

/**
 * The displayed title: highest prestige; ties go to the most recent deed.
 * @returns {{id, text, form} | null}
 */
export function pickEpithet(earned) {
  let best = null;
  for (const entry of Array.isArray(earned) ? earned : []) {
    if (!entry?.epithet) continue;
    if (
      !best ||
      entry.prestige > best.prestige ||
      (entry.prestige === best.prestige && entry.seq >= best.seq)
    )
      best = entry;
  }
  return best ? { id: best.id, text: best.epithet, form: best.form } : null;
}

// ── Conditions and tokens ────────────────────────────────────────────────

function placePhrase(terrainName, deedsData) {
  const places = deedsData?.places || {};
  if (typeof terrainName === 'string' && typeof places[terrainName] === 'string')
    return places[terrainName];
  return typeof places.default === 'string' ? places.default : 'the Line';
}

/** "the Emperor", "the Iron Captain", "the Sleeper" (data overrides first). */
export function bossPhrase(name, deedsData = null) {
  if (typeof name !== 'string' || !name.trim()) return 'the Foe';
  const trimmed = name.trim();
  const override = deedsData?.bosses?.[trimmed];
  if (typeof override === 'string' && override) return override;
  if (/^the\s/i.test(trimmed)) return trimmed.replace(/^the/i, 'the');
  return `the ${trimmed}`;
}

/** Most frequent terrain among held phases; ties go to the most recent. */
function heldPlace(places) {
  const list = (Array.isArray(places) ? places : []).map((p) => (typeof p === 'string' ? p : ''));
  const tally = new Map();
  list.forEach((p, i) => {
    const t = tally.get(p) || { n: 0, last: -1 };
    t.n++;
    t.last = i;
    tally.set(p, t);
  });
  let best = null;
  for (const [place, t] of tally) {
    if (!best || t.n > best.n || (t.n === best.n && t.last > best.last)) best = { place, ...t };
  }
  return best?.place || null;
}

function statOk(value, cond) {
  const n = count(value);
  if (Number.isFinite(cond.min) && n < cond.min) return false;
  if (Number.isFinite(cond.max) && n > cond.max) return false;
  return true;
}

/**
 * Evaluate a deed condition. Returns the resolved tokens (an object, possibly
 * empty) when met, or null.
 */
export function evaluateDeedCondition(cond, { battle, run }, deedsData = null) {
  if (!isObject(cond)) return null;
  switch (cond.type) {
    case 'all': {
      const tokens = {};
      for (const part of Array.isArray(cond.of) ? cond.of : []) {
        const t = evaluateDeedCondition(part, { battle, run }, deedsData);
        if (!t) return null;
        Object.assign(tokens, t);
      }
      return Array.isArray(cond.of) && cond.of.length ? tokens : null;
    }
    case 'battleStat': {
      if (!statOk(battle?.[cond.stat], cond)) return null;
      const tokens = {};
      if (cond.stat === 'heldPhases') {
        const where = battle.heldBestPlaces?.length ? battle.heldBestPlaces : battle.heldPlaces;
        tokens.place = placePhrase(heldPlace(where), deedsData);
      }
      if (cond.stat === 'bossKills')
        tokens.boss = bossPhrase(battle.bossNames?.at?.(-1), deedsData);
      return tokens;
    }
    case 'runStat':
      return statOk(run?.[cond.stat], cond) ? {} : null;
    case 'runStatMap': {
      const map = isObject(run?.[cond.stat]) ? run[cond.stat] : {};
      const keys = Array.isArray(cond.keys) ? cond.keys : Object.keys(map);
      const total = keys.reduce((sum, key) => sum + count(map[key]), 0);
      return statOk(total, cond) ? {} : null;
    }
    case 'runStatBest': {
      // The single key with the most counts (ties: alphabetical) that has a
      // phrase in `deedsData[cond.tokens]`; its phrase becomes {weapon}.
      const map = isObject(run?.[cond.stat]) ? run[cond.stat] : {};
      const phrases = isObject(deedsData?.[cond.tokens]) ? deedsData[cond.tokens] : {};
      const ranked = Object.entries(map)
        .filter(([key]) => typeof phrases[key] === 'string')
        .sort((a, b) => count(b[1]) - count(a[1]) || a[0].localeCompare(b[0]));
      const top = ranked[0];
      if (!top || !statOk(top[1], cond)) return null;
      return { weapon: phrases[top[0]] };
    }
    default:
      return null;
  }
}

function resolveTokens(text, tokens) {
  return String(text || '')
    .replace(/\{place\}/g, tokens.place || 'the Line')
    .replace(/\{boss\}/g, tokens.boss || 'the Foe')
    .replace(/\{weapon\}/g, tokens.weapon || 'the Blade')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeRunStats(stats, battle) {
  for (const key of RUN_SUM_KEYS) {
    const n = count(stats[key]) + count(battle[key]);
    if (n > 0) stats[key] = n;
  }
  for (const key of RUN_MAP_KEYS) {
    const merged = sanitizeCountMap(stats[key]);
    for (const [k, v] of Object.entries(battle[key] || {})) bump(merged, k, count(v));
    if (Object.keys(merged).length) stats[key] = merged;
  }
  stats.battles = count(stats.battles) + 1;
}

/** Fresh deeds state for a unit (legacy units seed battles from mastery counts). */
function freshDeeds(unit) {
  const fought = isObject(unit?.classBattles)
    ? Object.values(unit.classBattles).reduce((sum, n) => sum + count(n), 0)
    : 0;
  return { stats: fought > 0 ? { battles: fought } : {}, earned: [], epithet: null };
}

/**
 * Victory: fold each surviving unit's battle scratch into its run tallies,
 * award every deed newly met, recompute the displayed title and clear the
 * scratch. Idempotent per `ctx.battleKey`. Call BEFORE serializing units for
 * the save; present the returned announcements AFTER the save.
 * @param {object[]} units  every living player unit of the battle (incl. escaped)
 * @param {{deeds: object[]}} deedsData
 * @param {{battleKey?: string, act?: string, battle?: number, deployedCount?: number}} ctx
 * @returns {{unit, deedId, name, epithet, form, lore, prestige, oath, oathSkill,
 *            titled: string, isTitle: boolean}[]}
 */
export function commitBattleDeeds(units, deedsData, ctx = {}) {
  const deeds = Array.isArray(deedsData?.deeds) ? deedsData.deeds : [];
  const living = (Array.isArray(units) ? units : []).filter(
    (u) => isDeedUnit(u) && Number(u.currentHP) > 0,
  );
  const nonLords = living.filter((u) => !u.isLord);
  const deployed = count(ctx.deployedCount);
  const announcements = [];
  for (const unit of living) {
    const state = sanitizeUnitDeeds(unit.deeds) || freshDeeds(unit);
    if (ctx.battleKey && state.lastBattle === ctx.battleKey) {
      delete unit._battleDeeds;
      continue;
    }
    const battle = sanitizeBattleDeeds(unit._battleDeeds);
    if (nonLords.length === 1 && nonLords[0] === unit && deployed > 0)
      battle.lastStanding = deployed;
    mergeRunStats(state.stats, battle);
    const have = new Set(state.earned.map((e) => e.id));
    let seq = state.earned.reduce((max, e) => Math.max(max, e.seq), 0);
    const fresh = [];
    for (const deed of deeds) {
      if (!deed?.id || have.has(deed.id) || !deed.epithet?.text) continue;
      const tokens = evaluateDeedCondition(deed.condition, { battle, run: state.stats }, deedsData);
      if (!tokens) continue;
      const entry = sanitizeEarned({
        id: deed.id,
        epithet: resolveTokens(deed.epithet.text, tokens),
        form: deed.epithet.form,
        prestige: deed.prestige,
        seq: ++seq,
        oath: deed.oathName ? resolveTokens(deed.oathName, tokens) : undefined,
        awardedAt: { act: ctx.act ?? null, battle: ctx.battle ?? null },
      });
      if (!entry) continue;
      have.add(entry.id);
      state.earned.push(entry);
      fresh.push({ entry, deed });
    }
    if (ctx.battleKey) state.lastBattle = String(ctx.battleKey).slice(0, 160);
    state.epithet = pickEpithet(state.earned);
    unit.deeds = state;
    delete unit._battleDeeds;
    for (const { entry, deed } of fresh) {
      announcements.push({
        unit,
        unitName: unit.name,
        deedId: entry.id,
        name: typeof deed.name === 'string' ? deed.name : entry.id,
        epithet: entry.epithet,
        form: entry.form,
        lore: typeof deed.lore === 'string' ? deed.lore : '',
        prestige: entry.prestige,
        oath: entry.oath || null,
        oathSkill: typeof deed.oathSkill === 'string' ? deed.oathSkill : null,
        titled: titledName(unit.name, entry),
        isTitle: state.epithet?.id === entry.id,
      });
    }
  }
  return announcements;
}

// ── Oaths ────────────────────────────────────────────────────────────────

/**
 * The Oath a promotion would swear: the highest-prestige earned deed (ties:
 * most recent) whose oath skill exists and the unit does not already know.
 * Units swear one Oath per run.
 * @returns {null | {deedId, deedName, skillId, skillName, skillDescription, name}}
 */
export function promotionOath(unit, deedsData, skillsData = []) {
  if (!isDeedUnit(unit) || unit.deeds?.oath) return null;
  const defs = new Map((deedsData?.deeds || []).map((d) => [d?.id, d]));
  const earned = [...earnedDeeds(unit)].sort((a, b) => b.prestige - a.prestige || b.seq - a.seq);
  const known = new Set(Array.isArray(unit.skills) ? unit.skills : []);
  for (const entry of earned) {
    const def = defs.get(entry.id);
    const skillId = def?.oathSkill;
    if (typeof skillId !== 'string' || known.has(skillId)) continue;
    const skill = (skillsData || []).find((s) => s?.id === skillId);
    if (!skill) continue;
    return {
      deedId: entry.id,
      deedName: typeof def.name === 'string' ? def.name : entry.id,
      skillId,
      skillName: skill.name || skillId,
      skillDescription: skill.description || '',
      name: entry.oath || (def.oathName ? resolveTokens(def.oathName, {}) : `Oath of ${def.name}`),
    };
  }
  return null;
}

/**
 * Swear the Oath on a player promotion (battle seal, church, roster seal).
 * Call right after promoteUnit so class innates count as known. Silent
 * engine promotions (recruit spawns, colosseum, boss recruits) never call it.
 * @returns {null | {..., learned: boolean, dropped: boolean}}
 */
export function applyPromotionOath(unit, gameData = {}) {
  const oath = promotionOath(unit, gameData.deeds, gameData.skills);
  if (!oath) return null;
  if (!Array.isArray(unit.skills)) unit.skills = [];
  const result = learnSkill(unit, oath.skillId);
  if (result.learned) {
    const state = sanitizeUnitDeeds(unit.deeds) || freshDeeds(unit);
    state.oath = {
      deedId: oath.deedId,
      skillId: oath.skillId,
      name: oath.name,
      className: typeof unit.className === 'string' ? unit.className : '',
    };
    unit.deeds = state;
  }
  return { ...oath, learned: result.learned === true, dropped: result.reason === 'at_cap' };
}

// LevelUpReroll — Branching Threads' second use: roll a level-up's stat gains again while
// its card is up (the first use is the battle-reward reroll, engine/PendingBattleRewards.js).
//
// One shared pool (engine/RerollPool.js): both spend `run.rewardRerollsSpent` against the
// run's granted `metaEffects.rewardRerolls` (the names are save data and stay). The prologue
// run applies no meta effects and has none.
//
// The rules (pure, no Phaser; the only writes are to the unit, the record and the count):
//   - The new roll is made by the same `levelUp()` / `extendedLevelUp()` the original used,
//     on a probe of the unit as it stood just before that level (the level before it, the
//     card's gains taken off, the streak flag it was rolled with), so every rule those
//     functions keep (the guaranteed gain, the streak guard) holds for a reroll too; the
//     unit's streak flag (`lastLevelUpThin`) is then set from the new gains.
//   - It REPLACES the old gains (never keep-better): the old gains come off and the new go
//     on, exactly. Max HP moves by the difference; current HP loses the old gain's heal and
//     takes the new one's, through UnitHealth, never below 1 nor above max (a unit already
//     down stays down). Skills learned at the level are untouched.
//   - It never draws from Math.random (in battle that is the battle's stream, and every
//     later roll would change): the caller hands a keyed stream (`battleLevelUpRerollRng`
//     in battle, `runLevelUpRerollRng` between battles), keyed by the unit, the level and
//     the count already spent. A Vision rewind that refunds the charge therefore rerolls to
//     the same result: rewinding cannot fish for a better one.
//   - One atomic commit (`rerollLevelUp`): swap, record and count change together, then
//     `persist` writes them; when it fails, everything is put back as it was.
import { XP_STAT_NAMES } from '../utils/constants.js';
import { extendedLevelUp, levelUp, statsGained } from './UnitManager.js';
import { setUnitHP } from './UnitHealth.js';
import { keyedBattleRandom } from './BattleRng.js';
import { unitIdentityKey } from './UnitIdentity.js';
import {
  rerollsGranted as rewardRerollsGranted,
  rerollsLeft as rewardRerollsLeft,
  rerollsSpent as rewardRerollsSpent,
} from './RerollPool.js';

export const LEVEL_UP_REROLL_BLOCKS = Object.freeze({
  none: 'none', // no Branching Threads this run (or the prologue)
  invalid: 'invalid', // not a level-up this unit holds (or not a unit that can reroll)
  spent: 'spent', // every reroll this run is spent
});

const gainOf = (gains, stat) => {
  const n = Math.trunc(Number(gains?.[stat]) || 0);
  return n > 0 ? n : 0;
};

/** The gains of a level-up record as a full stat table (missing stats are 0). */
export function levelUpGainTable(gains) {
  const table = {};
  for (const stat of XP_STAT_NAMES) table[stat] = gainOf(gains, stat);
  return table;
}

/**
 * The level a record raised the unit to, as a key: "7", or "20+3" for an extended level
 * (promoted past the cap). null for anything that is not a level-up record.
 */
export function levelUpLabel(record) {
  if (!record || typeof record !== 'object' || !record.gains || typeof record.gains !== 'object')
    return null;
  const level = Math.trunc(Number(record.newLevel));
  if (!Number.isFinite(level) || level < 1) return null;
  if (record.isExtended === true) {
    const ext = Math.trunc(Number(record.extendedLevel));
    return Number.isFinite(ext) && ext >= 1 ? `${level}+${ext}` : null;
  }
  return level >= 2 ? String(level) : null;
}

/** The key of one reroll's stream: the unit, the level and the reroll's ordinal. */
export function levelUpRerollKey(unitKey, record, ordinal) {
  return `levelup-reroll:${unitKey}:${levelUpLabel(record)}:${Math.max(0, Math.trunc(Number(ordinal) || 0))}`;
}

/** The ordinal of the next reroll: the shared count already spent. */
export function nextRerollOrdinal(run) {
  return rewardRerollsSpent(run);
}

/**
 * The stream of a reroll in battle: keyed on the battle's seed and the unit's battle id,
 * never the battle stream, so no later roll of the battle moves.
 */
export function battleLevelUpRerollRng(seed, unit, record, ordinal) {
  return keyedBattleRandom(
    Number(seed) >>> 0,
    levelUpRerollKey(unit?.battleEntityId || unitIdentityKey(unit), record, ordinal),
  );
}

/** The stream of a reroll between battles (team XP, the arena): keyed on the run seed. */
export function runLevelUpRerollRng(run, unit, record, ordinal) {
  return keyedBattleRandom(
    Math.trunc(Number(run?.runSeed) || 0) >>> 0,
    levelUpRerollKey(unitIdentityKey(unit), record, ordinal),
  );
}

/** Whether `unit` holds the level-up `record` (its level reached, its gains in its stats). */
function holdsLevelUp(unit, record) {
  if (!unit || typeof unit !== 'object' || !unit.stats || typeof unit.stats !== 'object')
    return false;
  if (unit.faction === 'enemy' || unit.faction === 'npc') return false;
  if (!levelUpLabel(record)) return false;
  const level = Math.trunc(Number(unit.level) || 0);
  if (record.isExtended === true) {
    if (level !== Math.trunc(Number(record.newLevel))) return false;
    if (Math.trunc(Number(unit.extendedLevels) || 0) < Math.trunc(Number(record.extendedLevel)))
      return false;
  } else if (level < Math.trunc(Number(record.newLevel))) return false;
  for (const stat of XP_STAT_NAMES) {
    const value = Number(unit.stats[stat]);
    if (!Number.isFinite(value) || value - gainOf(record.gains, stat) < 0) return false;
  }
  return true;
}

/**
 * Why this level-up cannot be rerolled now, or '' when it can. Pure.
 * @returns {'' | keyof LEVEL_UP_REROLL_BLOCKS}
 */
export function levelUpRerollBlock(run, unit, record) {
  if (rewardRerollsGranted(run) <= 0) return LEVEL_UP_REROLL_BLOCKS.none;
  if (!holdsLevelUp(unit, record)) return LEVEL_UP_REROLL_BLOCKS.invalid;
  if (rewardRerollsLeft(run) <= 0) return LEVEL_UP_REROLL_BLOCKS.spent;
  return '';
}

/** What a level-up card shows about rerolls (the shared pool). Pure. */
export function levelUpRerollStatus(run, unit, record) {
  return {
    granted: rewardRerollsGranted(run),
    left: rewardRerollsLeft(run),
    block: levelUpRerollBlock(run, unit, record),
  };
}

/**
 * Roll the level again (no write): the same levelUp()/extendedLevelUp() the original came
 * from, on a probe of the unit just before that level. null when the roll does not land on
 * the same level (a record the unit does not hold).
 */
export function rollLevelUpReplacement(unit, record, rng) {
  if (typeof rng !== 'function' || !levelUpLabel(record)) return null;
  const stats = { ...unit.stats };
  for (const stat of XP_STAT_NAMES)
    stats[stat] = (Number(stats[stat]) || 0) - gainOf(record.gains, stat);
  const probe = { ...unit, stats, growths: { ...(unit.growths || {}) } };
  let next;
  if (record.isExtended === true) {
    probe.extendedLevels = Math.trunc(Number(record.extendedLevel)) - 1;
    next = extendedLevelUp(probe, rng);
    if (next?.extendedLevel !== Math.trunc(Number(record.extendedLevel))) return null;
  } else {
    probe.level = Math.trunc(Number(record.newLevel)) - 1;
    // A guarded level (a player unit's, UnitManager.levelUp) rolls again with the streak flag
    // it was first rolled with, so the guard decides it by the same rule.
    const guard = record.guard === true;
    if (guard) probe.lastLevelUpThin = record.thinBefore === true;
    next = levelUp(probe, rng, { guard });
  }
  if (!next || next.newLevel !== record.newLevel) return null;
  return next;
}

/**
 * Take one level's gains off a unit and put others on, exactly. Max HP moves by the
 * difference; current HP loses the old HP gain's heal and takes the new one's (through
 * UnitHealth), never below 1 nor above max. A unit at 0 HP stays at 0.
 */
export function swapLevelUpGains(unit, oldGains, newGains) {
  const before = Number(unit.currentHP) || 0;
  for (const stat of XP_STAT_NAMES)
    unit.stats[stat] =
      (Number(unit.stats[stat]) || 0) - gainOf(oldGains, stat) + gainOf(newGains, stat);
  if (before <= 0) return;
  const max = Math.max(1, Number(unit.stats.HP) || 1);
  const hp = Math.min(max, Math.max(1, before - gainOf(oldGains, 'HP') + gainOf(newGains, 'HP')));
  setUnitHP(unit, hp, { disturbs: false });
}

/** What a reroll can change on a unit, for its rollback. */
function unitState(unit) {
  const has = (key) => Object.prototype.hasOwnProperty.call(unit, key);
  return {
    unit,
    stats: { ...unit.stats },
    hp: unit.currentHP,
    hasOwed: has('_accessoryHpOwed'),
    owed: unit._accessoryHpOwed,
    hasThin: has('lastLevelUpThin'),
    thin: unit.lastLevelUpThin,
  };
}

function restoreUnit(state) {
  const { unit } = state;
  for (const stat of XP_STAT_NAMES) unit.stats[stat] = state.stats[stat];
  setUnitHP(unit, state.hp, { disturbs: false });
  if (state.hasOwed) unit._accessoryHpOwed = state.owed;
  else delete unit._accessoryHpOwed;
  if (state.hasThin) unit.lastLevelUpThin = state.thin;
  else delete unit.lastLevelUpThin;
}

/**
 * The streak flag after a reroll: set from the new gains when the level is the unit's latest
 * guarded one (an earlier level of a two-level gain leaves the later level's flag standing).
 */
function settleStreakFlag(unit, record, gains) {
  if (record.guard !== true || record.isExtended === true) return;
  if (Math.trunc(Number(unit.level)) !== Math.trunc(Number(record.newLevel))) return;
  unit.lastLevelUpThin = statsGained(gains) === 1;
}

/**
 * Reroll one level-up: one atomic commit. The level is rolled again on `rng`, the old gains
 * come off `unit` (and off each of `mirrors`: another copy of the same unit that must agree,
 * such as its roster record after a victory) and the new go on, the record is rewritten in
 * place to the new gains (its `gains` object kept, so every view of it agrees), a charge is
 * spent, and `persist` writes it all; when it fails, every one of them is put back.
 * @param {object} run
 * @param {object} unit - the unit the level-up card is about
 * @param {object} record - the level-up record ({ gains, newLevel, extendedLevel?, isExtended? })
 * @param {{ rng: () => number, persist?: () => boolean, mirrors?: object[] }} options
 * @returns {{ ok: true, levelUp: object, previous: object, gains: object }
 *   | { ok: false, reason: string, saveFailed?: boolean }}
 */
export function rerollLevelUp(run, unit, record, { rng, persist = null, mirrors = [] } = {}) {
  const block = levelUpRerollBlock(run, unit, record);
  if (block) return { ok: false, reason: block };
  const next = rollLevelUpReplacement(unit, record, rng);
  if (!next) return { ok: false, reason: LEVEL_UP_REROLL_BLOCKS.invalid };
  const previous = levelUpGainTable(record.gains);
  const gains = levelUpGainTable(next.gains);
  const targets = [unit, ...(mirrors || []).filter((m) => m && m !== unit && m.stats)];
  const states = targets.map(unitState);
  const recordBefore = { ...record };
  const gainsBefore = { ...record.gains };
  const spentBefore = run.rewardRerollsSpent;
  for (const target of targets) {
    swapLevelUpGains(target, previous, gains);
    settleStreakFlag(target, record, gains);
  }
  for (const [key, value] of Object.entries(next)) if (key !== 'gains') record[key] = value;
  for (const stat of XP_STAT_NAMES) record.gains[stat] = gains[stat];
  run.rewardRerollsSpent = rewardRerollsSpent(run) + 1;
  if (persist && !persist()) {
    for (const state of states) restoreUnit(state);
    for (const key of Object.keys(record)) if (!(key in recordBefore)) delete record[key];
    for (const [key, value] of Object.entries(recordBefore))
      if (key !== 'gains') record[key] = value;
    for (const stat of Object.keys(record.gains)) delete record.gains[stat];
    Object.assign(record.gains, gainsBefore);
    run.rewardRerollsSpent = spentBefore;
    return { ok: false, reason: 'save', saveFailed: true };
  }
  return { ok: true, levelUp: record, previous, gains };
}

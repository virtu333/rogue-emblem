// BattleFeats — what a battle did that only the achievements ask about
// (docs/specs/achievements.md), and the won battle's facts for their rules.
//
// The battle's scratch (`scene._battleFeats`) rides captureBattleWorldState, so a suspend
// keeps it and a Vision rewind takes it back with the battle. Nothing reaches the meta save
// until the victory commit hands `battleAchievementFacts(...)` to
// MetaProgressionManager.recordAchievementFacts. The rest of what a battle did (kills, wounds,
// the bosses a unit felled) is read from the deeds' scratch (`unit._battleDeeds`) and the
// fallen units' records, before the deeds commit clears it.
//
// A boss's stones broken in a player phase are stamped on the boss (`_stoneBreakTurns`, a
// list of turns), which a snapshot keeps with the unit.
//
// Pure: no Phaser, no DOM, never the RNG.

import { XP_STAT_NAMES } from '../utils/constants.js';

export const BATTLE_FEAT_KEYS = Object.freeze([
  'maxStrike',
  'entityCrits',
  'shatters',
  'ballistaBossKills',
  'cleanNecromancerKills',
  'maxRefreshBurst',
  'maxPushTiles',
  'steals',
  'perfectLevelUps',
]);
const MAX_KEYS = new Set(['maxStrike', 'maxRefreshBurst', 'maxPushTiles']);
const MAX = 999_999;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const whole = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);
const list = (v) => (Array.isArray(v) ? v : []);
const isPlayer = (u) => u?.faction === 'player';
const isFoe = (u) => u?.faction === 'enemy';

export function emptyBattleFeats() {
  const out = { v: 1 };
  for (const key of BATTLE_FEAT_KEYS) out[key] = 0;
  return out;
}

/** A clean copy (garbled or missing counters read as 0). */
export function sanitizeBattleFeats(raw) {
  const out = emptyBattleFeats();
  if (!isObject(raw)) return out;
  for (const key of BATTLE_FEAT_KEYS) out[key] = Math.min(MAX, whole(raw[key]));
  return out;
}

function bump(feats, key, value = 1) {
  if (!isObject(feats) || !BATTLE_FEAT_KEYS.includes(key)) return;
  const v = whole(value);
  feats[key] = Math.min(
    MAX,
    MAX_KEYS.has(key) ? Math.max(whole(feats[key]), v) : whole(feats[key]) + v,
  );
}

/**
 * One resolved combat (after its HP is applied). Reads the engine's strike events.
 * @param {{ phase?: string|null, turn?: number|null }} ctx
 */
export function featsRecordCombat(feats, result, attacker, defender, ctx = {}) {
  for (const event of list(result?.events)) {
    if (event?.type !== 'strike' || event.miss) continue;
    const striker = event.attackerSide === 'defender' ? defender : attacker;
    const target = striker === attacker ? defender : attacker;
    if (!isPlayer(striker) || !isFoe(target)) continue;
    bump(feats, 'maxStrike', event.damage);
    if (event.isCrit && target.isEntity === true) bump(feats, 'entityCrits');
    if (event.stoneBroken && target.isBoss && ctx.phase === 'player' && Number.isFinite(ctx.turn))
      target._stoneBreakTurns = [...list(target._stoneBreakTurns), Math.trunc(ctx.turn)].slice(-8);
  }
}

/**
 * A foe fell to a player unit. A boss whose every stone broke in the player phase it fell in
 * is shattered; a Necromancer that raised none died clean.
 */
export function featsRecordKill(feats, victim, killer, ctx = {}) {
  if (!isFoe(victim) || !isPlayer(killer)) return;
  const stones = whole(victim.revivalStonesMax);
  if (victim.isBoss && stones > 0 && ctx.phase === 'player' && Number.isFinite(ctx.turn)) {
    const breaks = list(victim._stoneBreakTurns).filter((t) => t === Math.trunc(ctx.turn));
    if (breaks.length >= stones) bump(feats, 'shatters');
  }
  if (victim.className === 'Necromancer' && whole(victim._raisedCount) === 0)
    bump(feats, 'cleanNecromancerKills');
}

/** A player-owned ballista's bolt felled `victim`. */
export function featsRecordBallistaKill(feats, victim) {
  if (isFoe(victim) && victim.isBoss) bump(feats, 'ballistaBossKills');
}

/** One dance refreshed `count` allies at once. */
export function featsRecordRefreshBurst(feats, count) {
  bump(feats, 'maxRefreshBurst', count);
}

/** A foe was sent `tiles` tiles by one forced move (its ice slide included). */
export function featsRecordPush(feats, mover, tiles) {
  if (isFoe(mover)) bump(feats, 'maxPushTiles', tiles);
}

export function featsRecordSteal(feats) {
  bump(feats, 'steals');
}

/** A level-up that raised every stat (an extended level never can). */
export function isPerfectLevelUp(levelUp) {
  if (!isObject(levelUp?.gains) || levelUp.isExtended) return false;
  return XP_STAT_NAMES.every((stat) => whole(levelUp.gains[stat]) > 0);
}

export function featsRecordLevelUps(feats, unit, levelUps) {
  if (!isPlayer(unit)) return;
  for (const levelUp of list(levelUps))
    if (isPerfectLevelUp(levelUp)) bump(feats, 'perfectLevelUps');
}

/** The deeds' battle scratch of everyone who took part: survivors, then the fallen's records. */
function scratchOf(survivors, fallenRecords) {
  return [
    ...list(survivors).map((u) => u?._battleDeeds),
    ...list(fallenRecords).map((r) => r?.battleDeeds),
  ].filter(isObject);
}

/**
 * The won battle's facts for the achievement rules (engine/Achievements.js). Call at the
 * victory, before the deeds commit clears their scratch.
 * @param {object} input
 * @param {object} input.run             the RunManager
 * @param {object} input.battleParams
 * @param {object} input.battleConfig
 * @param {string|number} input.nodeId
 * @param {object} input.feats            the battle's scratch (emptyBattleFeats shape)
 * @param {object[]} input.survivors      player units alive at victory (on the field or escaped)
 * @param {number} input.onField          player units still on the field
 * @param {number} input.escaped          player units that escaped
 * @param {object[]} input.fallenRecords  DeedSystem fallen battle records
 * @param {number} input.alliesFallen     player units that fell this battle
 * @param {number} input.recruits         units that joined mid-battle (a Talk)
 * @param {number} input.turn             the turn the battle ended on
 * @param {number|null} input.par
 * @param {boolean} [input.isBoss]       a boss node's battle
 * @param {object|null} input.vigilState
 * @param {object|null} input.entityKitState
 * @param {(name: string) => number} [input.defeatsBy]  how often a boss has beaten this save
 * @param {boolean} [input.standard]      a run's own battle (not the prologue, not scripted)
 * @param {boolean} [input.ngPlusVeteran]
 * @param {boolean} [input.heraldHeard]
 */
export function battleAchievementFacts(input = {}) {
  const run = input.run || {};
  const params = input.battleParams || {};
  const config = input.battleConfig || {};
  const feats = sanitizeBattleFeats(input.feats);
  const scratch = scratchOf(input.survivors, input.fallenRecords);
  const bossesSlain = [
    ...new Set(scratch.flatMap((b) => list(b.bossNames)).filter((n) => typeof n === 'string')),
  ];
  const kills = scratch.map((b) => whole(b.kills));
  const actId = typeof run.currentAct === 'string' ? run.currentAct : null;
  const objective = config.objective || params.objective || null;
  const alliesFallen = whole(input.alliesFallen);
  const survivors = list(input.survivors);
  const recruits = whole(input.recruits);
  const deployed = survivors.length + list(input.fallenRecords).length - recruits;
  const defeatsBy = typeof input.defeatsBy === 'function' ? input.defeatsBy : () => 0;
  return {
    standard: input.standard === true,
    // One won battle of one run (the run's seed tells two runs' same node apart).
    key: `${Number(run.runSeed) >>> 0}:${actId || ''}:${input.nodeId ?? ''}:${whole(run.completedBattles)}`,
    actId,
    actBoss: input.isBoss === true && params.bossRole !== 'gate',
    gateBoss: params.bossRole === 'gate',
    descent: actId === 'finalBoss' && isObject(run.nodeMap?.descent),
    bossesSlain,
    ngPlusVeteran: input.ngPlusVeteran === true,
    objective,
    turn: whole(input.turn),
    par: whole(input.par),
    foesDefeated: kills.reduce((a, b) => a + b, 0),
    maxUnitKills: Math.max(0, ...kills),
    alliesWounded: scratch.reduce((sum, b) => sum + whole(b.woundsTaken), 0),
    alliesFallen,
    allEscaped:
      objective === 'escape' &&
      alliesFallen === 0 &&
      whole(input.onField) === 0 &&
      whole(input.escaped) > 0,
    ...feats,
    talkRecruits: recruits,
    vigil: isObject(config.vigil),
    vigilSummoned: whole(input.vigilState?.summoned),
    limbsEnabled: isObject(config.entityKit?.limbs),
    limbsSprouted: whole(input.entityKitState?.sprouted),
    loneCommander:
      deployed === 1 &&
      survivors.length === 1 &&
      survivors[0]?.isCommander === true &&
      recruits === 0,
    eclipsedElite: params.isEclipsed === true && params.isElite === true,
    bossBeatenAfterLosses: Math.max(0, ...bossesSlain.map((name) => whole(defeatsBy(name)))),
    heraldHeard: input.heraldHeard === true,
  };
}

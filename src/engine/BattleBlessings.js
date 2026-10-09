// BattleBlessings — the earned blessings that act inside one battle (docs/specs/blessings-v3.md §6).
//
//   Unbroken Banner   (`lastStand`)    the first player unit a blow would fell survives at 1 HP,
//                                      `lastStand` times a battle (1 while held). Order: Miracle,
//                                      then Revival Stones, then the banner (UnitHealth.absorbLethal).
//   Ember Lantern     (`firstKillHeal`) the army's first kill of the battle heals the killer this
//                                      much, through healUnit; spent even when it heals nothing
//                                      (PostCombatEffects.earnedOnKill).
//   Captain's Whistle (`firstTurnMov`)  +N MOV to every player unit as turn 1's player phase
//                                      starts: a timed buff that ends as turn 1's enemy phase
//                                      starts, so it never stacks with Mark of the Road (timed
//                                      buffs keep the strongest per stat) and never outlives the
//                                      battle (serializeUnit takes it back).
//
// The state is one plain object per battle, `{ lastStand, firstKillHeal, firstTurnMov, spent }`,
// or null when the run holds none of the three (then nothing anywhere changes: no event key,
// no checkpoint key, no draw). `spent` lists what this battle has used ('banner', 'lantern');
// it rides the battle world snapshot (BattleSnapshotState), so a suspend keeps it spent, a
// Vision rewind to before a hold makes the banner ready again, and Continue from Map (a fresh
// battle) starts with nothing spent. The numbers themselves are read from the run once, at the
// battle's start (RunManager.getBattleBlessingEffects).
//
// Pure: no Phaser, no RNG, no unit state but what the callers hand over.

import { isScriptedBattle } from './ScriptedBattle.js';

export const BANNER = 'banner';
export const LANTERN = 'lantern';
const SPENDABLE = new Set([BANNER, LANTERN]);

export const BANNER_NAME = 'Unbroken Banner';
export const LANTERN_NAME = 'Ember Lantern';
export const WHISTLE_NAME = "Captain's Whistle";
export const WHISTLE_BUFF_PREFIX = 'blessing_captains_whistle::';

const count = (value) => Math.max(0, Math.trunc(Number(value)) || 0);

function sanitizeSpent(list) {
  return Array.isArray(list) ? list.filter((key) => SPENDABLE.has(key)) : [];
}

/**
 * The battle's state from the run's numbers (`{ lastStand, firstKillHeal, firstTurnMov }`),
 * or null when all are 0. `spent` restores what a snapshot had used.
 */
export function createBattleBlessings(effects, { spent = [] } = {}) {
  const lastStand = count(effects?.lastStand);
  const firstKillHeal = count(effects?.firstKillHeal);
  const firstTurnMov = count(effects?.firstTurnMov);
  if (lastStand <= 0 && firstKillHeal <= 0 && firstTurnMov <= 0) return null;
  return { lastStand, firstKillHeal, firstTurnMov, spent: sanitizeSpent(spent) };
}

/**
 * The state a fresh battle starts with: the run's held numbers (or `fallback`, the numbers a
 * sim hands the harness in its battle params), none for a scripted chapter (the prologue
 * teaches its lessons without them).
 */
export function battleBlessingsAtStart({ run = null, battleParams = null, fallback = null } = {}) {
  if (isScriptedBattle(battleParams)) return null;
  const effects =
    typeof run?.getBattleBlessingEffects === 'function'
      ? run.getBattleBlessingEffects()
      : fallback || battleParams?.battleBlessings || null;
  return createBattleBlessings(effects);
}

export function spentCount(state, key) {
  return (state?.spent || []).filter((entry) => entry === key).length;
}

/** The banner can still hold `unit`: one of the army's own (never an NPC ally or a foe). */
export function bannerReadyFor(state, unit) {
  if (!state || unit?.faction !== 'player') return false;
  return count(state.lastStand) > spentCount(state, BANNER);
}

/** The lantern has not been lit by a kill this battle. */
export function lanternReady(state) {
  return Boolean(state) && count(state.firstKillHeal) > 0 && spentCount(state, LANTERN) <= 0;
}

export function spendBattleBlessing(state, key) {
  if (!state || !SPENDABLE.has(key)) return;
  if (!Array.isArray(state.spent)) state.spent = [];
  state.spent.push(key);
}

/** What the snapshot keeps: the spent list (a copy). */
export function snapshotBattleBlessings(state) {
  return [...(state?.spent || [])];
}

/** Put a snapshot's spent list back (in place: the battle keeps its one state object). */
export function restoreBattleBlessings(state, spent) {
  if (!state) return state;
  state.spent = sanitizeSpent(spent);
  return state;
}

/**
 * Captain's Whistle at a player-phase start: on turn 1 only, one timed buff for each living
 * player unit, ending as turn 1's enemy phase starts. Same shape as Mark of the Road's
 * (SkillSystem.getTurnStartEffects), so both pipelines apply it with applyTimedBuffEntry.
 */
export function blessingTurnStartEffects(units, state, turn) {
  const mov = count(state?.firstTurnMov);
  if (mov <= 0 || Math.trunc(Number(turn)) !== 1) return [];
  const effects = [];
  for (const unit of units || []) {
    if (!unit || unit.faction !== 'player' || !(unit.currentHP > 0)) continue;
    effects.push({
      type: 'buff',
      target: unit,
      source: WHISTLE_NAME,
      blessing: 'captains_whistle',
      entry: {
        key: `${WHISTLE_BUFF_PREFIX}${String(unit.name || '')}`,
        artId: null,
        sourceName: WHISTLE_NAME,
        sourceFaction: unit.faction,
        expiryPhase: 'enemy',
        expiryTurn: 1,
        stats: { MOV: mov },
      },
    });
  }
  return effects;
}

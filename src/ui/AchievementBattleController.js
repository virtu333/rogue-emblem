// AchievementBattleController — the battle's seam into the achievements
// (docs/specs/achievements.md; rules in engine/Achievements.js).
//
// The scene and its controllers call one line at each engine outcome an achievement asks
// about (a resolved combat, a fall, a ballista kill, a dance, a forced move, a steal, the
// level-ups). Each records a count on the battle's scratch (`scene._battleFeats`,
// engine/BattleFeats.js), which rides the checkpoint, so a Vision rewind takes it back and a
// resume keeps it. Nothing reaches the meta save until the victory: `victoryFacts` reads the
// won battle before the deeds commit clears their scratch, and `recordVictory` hands those
// facts (with the run's) to MetaProgressionManager.recordAchievementFacts once
// completeBattle has applied the win.
//
// A run's battles only: a prologue chapter or a standalone replay records nothing.
// Recording never throws and never touches the RNG: achievements are decoration.

import {
  battleAchievementFacts,
  emptyBattleFeats,
  featsRecordBallistaKill,
  featsRecordCombat,
  featsRecordKill,
  featsRecordLevelUps,
  featsRecordPush,
  featsRecordRefreshBurst,
  featsRecordSteal,
} from '../engine/BattleFeats.js';
import { achievementTotals, runAchievementFacts } from '../engine/AchievementFacts.js';
import { heraldHeard } from '../engine/FinaleRally.js';
import { isNgPlusRun } from '../engine/NgPlusRun.js';
import { isPrologueRun, isScriptedBattle } from '../engine/ScriptedBattle.js';
import { normalizeBattleRecruits } from '../engine/BattleRecruits.js';

const warn = (where, error) =>
  console.warn(`[Achievements] ${where} skipped:`, error?.message || error);

/** A run's own battle: a run, not the prologue, not a scripted chapter. */
export function achievementsActive(scene) {
  return Boolean(
    scene?.runManager && !isPrologueRun(scene.runManager) && !isScriptedBattle(scene.battleParams),
  );
}

function feats(scene) {
  return (scene._battleFeats ||= emptyBattleFeats());
}

function context(scene) {
  const tm = scene?.turnManager;
  return { phase: tm?.currentPhase || null, turn: tm?.turnNumber ?? null };
}

function guarded(where, fn) {
  return (scene, ...args) => {
    if (!achievementsActive(scene)) return;
    try {
      fn(scene, ...args);
    } catch (error) {
      warn(where, error);
    }
  };
}

/** The scene's recording calls (each a no-op outside a run's own battle). */
export const battleFeats = Object.freeze({
  /** After a resolveCombat result is applied. */
  combat: guarded('combat', (scene, attacker, defender, result) =>
    featsRecordCombat(feats(scene), result, attacker, defender, context(scene)),
  ),
  /** From removeUnit, the single death funnel. */
  kill: guarded('kill', (scene, victim, killer) =>
    featsRecordKill(feats(scene), victim, killer, context(scene)),
  ),
  /** A player-owned ballista's bolt felled `victim`. */
  ballistaKill: guarded('ballista', (scene, victim) =>
    featsRecordBallistaKill(feats(scene), victim),
  ),
  /** One dance refreshed `count` allies. */
  refreshBurst: guarded('dance', (scene, count) => featsRecordRefreshBurst(feats(scene), count)),
  /** A forced move sent `mover` `tiles` tiles (its slide included). */
  push: guarded('push', (scene, mover, tiles) => featsRecordPush(feats(scene), mover, tiles)),
  steal: guarded('steal', (scene) => featsRecordSteal(feats(scene))),
  /** The level-ups a gain just applied: `levelUp` records (UnitManager.levelUp), or entries
   *  carrying one (`{ levelUp }`, as awardScaledXP holds them). */
  levelUps: guarded('level-up', (scene, unit, levelUps) =>
    featsRecordLevelUps(
      feats(scene),
      unit,
      (Array.isArray(levelUps) ? levelUps : []).map((entry) => entry?.levelUp ?? entry),
    ),
  ),
});

/** Is a veteran riding again among `survivors` (an NG+ run's Barracks member or lord kit)? */
function veteranRides(run, survivors) {
  if (!isNgPlusRun(run)) return false;
  const uids = new Set((run.ngPlus.members || []).map((m) => m.uid));
  const lords = new Set((run.ngPlus.lordKits || []).map((r) => r?.name).filter(Boolean));
  return survivors.some((u) => uids.has(u?.uid) || (u?.isLord && lords.has(u.name)));
}

/**
 * The won battle's facts. Call at the victory, before the deeds commit (it clears the deeds'
 * battle scratch this reads). Null outside a run's own battle; never throws.
 */
export function victoryFacts(scene, survivors) {
  if (!achievementsActive(scene)) return null;
  try {
    const run = scene.runManager;
    const meta = scene.registry?.get?.('meta');
    const units = Array.isArray(survivors) ? survivors : [];
    return battleAchievementFacts({
      run,
      battleParams: scene.battleParams,
      battleConfig: scene.battleConfig,
      nodeId: scene.nodeId,
      feats: scene._battleFeats,
      survivors: units,
      onField: (scene.playerUnits || []).length,
      escaped: (scene.escapedUnits || []).length,
      fallenRecords: scene._fallenBattleRecords,
      alliesFallen: scene._playerDeathsThisBattle,
      recruits: normalizeBattleRecruits(scene._battleRecruits).length,
      turn: scene.turnManager?.turnNumber,
      par: scene.turnPar,
      isBoss: scene.isBoss === true,
      vigilState: scene._vigilState,
      entityKitState: scene._entityKitState,
      defeatsBy: (name) => meta?.getDefeatedByCount?.(name) || 0,
      standard: true,
      ngPlusVeteran: veteranRides(run, units),
      heraldHeard: heraldHeard(run.storyFlags, run.difficultyId),
    });
  } catch (error) {
    warn('victory facts', error);
    return null;
  }
}

/**
 * Once completeBattle has applied the win: the battle's and the run's facts into the meta
 * save (its write announces what was earned). Returns the newly earned ids.
 */
export function recordVictory(scene, facts) {
  const meta = scene?.registry?.get?.('meta');
  if (!facts || typeof meta?.recordAchievementFacts !== 'function') return [];
  try {
    const gameData = scene.gameData || scene.runManager?.gameData;
    return meta.recordAchievementFacts({
      battle: facts,
      run: runAchievementFacts(scene.runManager, gameData),
      totals: achievementTotals(gameData),
    });
  } catch (error) {
    warn('victory', error);
    return [];
  }
}

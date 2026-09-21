import { captureBattleWorldState } from '../engine/BattleSnapshotState.js';
import { serializeBattleUnit } from '../engine/BattleUnitState.js';

// Read-only scene adapter. No RNG, ID allocation, writes or history embedding.
export function captureBattleState(scene, { checkpointIndex = 0, rngSeed = 0 } = {}) {
  for (const group of ['playerUnits', 'enemyUnits', 'npcUnits']) {
    if (!Array.isArray(scene[group])) throw new Error(`Invalid battle group: ${group}`);
  }
  const fog = scene.grid?.fogEnabled
    ? { visible: [...(scene.grid.visibleSet || [])], everSeen: [...(scene.grid.everSeenSet || [])] }
    : null;
  return structuredClone({
    version: 2,
    rewindPolicy: scene._battleRewindPolicy || 'legacy-v1',
    rngState: scene._battleRng?.getState?.() || null,
    decisionRngState: scene._battleDecisionRngState || scene._battleRng?.getState?.() || null,
    phase: scene.turnManager?.currentPhase === 'enemy' ? 'enemy' : 'player',
    ...captureBattleWorldState(scene),
    checkpointIndex,
    rngSeed: rngSeed >>> 0,
    visionBaseSeed: Number(scene.visionBaseSeed) >>> 0,
    nextEntityId: scene._nextBattleEntityId || 1,
    turnNumber: scene.turnManager?.turnNumber || 1,
    turnPar: scene.turnPar ?? null,
    playerUnits: (scene.playerUnits || []).map(serializeBattleUnit),
    enemyUnits: (scene.enemyUnits || []).map(serializeBattleUnit),
    npcUnits: (scene.npcUnits || []).map(serializeBattleUnit),
    escapedUnits: (scene.escapedUnits || []).map(serializeBattleUnit),
    nonDeployedUnits: (scene.nonDeployedUnits || []).map(serializeBattleUnit),
    pendingActionCompletion: scene._pendingActionCompletion || null,
    antiTurtleState: scene.antiTurtleState || {},
    fog,
    ballistas: scene.ballistas || [],
    zombieTombstones: scene._zombieTombstones || [],
    goldEarned: scene.goldEarned || 0,
    bossName: scene._bossName || null,
    caravanExited: scene._caravanExited === true,
    villageState: scene._villageState || null,
    runBattleState: scene.runManager
      ? {
          convoy: scene.runManager.convoy || { weapons: [], consumables: [] },
          accessories: scene.runManager.accessories || [],
          gold: scene.runManager.gold ?? 0,
        }
      : null,
  });
}

export function classifyBattleBoundary(scene) {
  if (scene.battleState === 'BATTLE_END') return 'closed';
  if (scene._pendingActionCompletion || scene._pendingLevelUpPopups?.length) return 'recovery';
  if (scene.turnManager?.currentPhase !== 'player') return 'recovery';
  if (scene.battleState !== 'PLAYER_IDLE' || scene.selectedUnit || scene.preMoveLoc)
    return 'recovery';
  return 'destination';
}

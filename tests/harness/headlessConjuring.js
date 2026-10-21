// The harness's enemy-phase-start conjurings, out of HeadlessBattle.js (its line budget): the
// Necromancer's raise, the Vigil's words and calls and the Entity's Grasping Limbs. Each mirrors
// its scene controller with no banner and no graphics, and drives the same pure rules
// (engine/Necromancy.js, engine/Vigil.js, engine/EntityKit.js), so the two cannot drift.

import { isNecromancer, raiseFor, raisers } from '../../src/engine/Necromancy.js';
import {
  applyVigilWards,
  isVoiceOf,
  unweavableCircleAt,
  unweaveCircle,
  vigilPhaseStep,
} from '../../src/engine/Vigil.js';
import { limbPhaseStep, severLimb, witherLimbs } from '../../src/engine/EntityKit.js';
import { entityKitOf } from '../../src/engine/EntityKitConfig.js';
import { isEntity, isEntityLimb } from '../../src/engine/EntitySystem.js';
import { registerBattleEntity } from '../../src/engine/BattleEntityIdentity.js';
import {
  hammerfallOf,
  livingHammerfallUnit,
  runHammerfallPhaseSync,
  sanitizeHammerfallState,
  standableAt,
} from '../../src/engine/IronGuardian.js';
import { armyAndNpcAllies } from '../../src/engine/RecruitNpc.js';

/** What every conjuring reads of the board. */
function board(b) {
  return {
    cols: b.battleConfig.cols,
    rows: b.battleConfig.rows,
    isOccupied: (c, r) => Boolean(b.getUnitAt(c, r)),
    moveCostAt: (c, r, moveType) => b.grid.getTerrainAt(c, r)?.moveCost?.[moveType],
    classes: b.gameData.classes,
    weapons: b.gameData.weapons,
    seed: b._getReinforcementSeed(),
    difficultyConfig: b._getEnemyDifficultyConfig(),
  };
}

/**
 * Mirrors NecromancyController.processRaises: each living Necromancer with fewer than two
 * living Skeletons raises one onto its first free passable neighbour, from the keyed stream
 * (never Math.random).
 */
export function processNecromancy(b) {
  const turn = b.turnManager?.turnNumber ?? 1;
  // The harness never hands out battle entity ids; a Necromancer needs one to own its raises.
  for (const unit of b.enemyUnits) if (isNecromancer(unit)) registerBattleEntity(b, unit);
  for (const necromancer of raisers(b.enemyUnits)) {
    const raised = raiseFor(necromancer, { enemyUnits: b.enemyUnits, ...board(b), turn });
    if (!raised) continue;
    registerBattleEntity(b, raised.unit);
    b.enemyUnits.push(raised.unit);
  }
}

/**
 * Mirrors VigilController.processPhase: the Voices on their sigils speak, then each open circle
 * calls a Hollowed, from the keyed stream. The words are counted in `_vigilState.words`,
 * committed to the run's Rite only at victory.
 */
export function processVigil(b) {
  const vigil = b.battleConfig?.vigil;
  if (!vigil) return;
  const step = vigilPhaseStep({
    vigil,
    state: b._vigilState,
    enemyUnits: b.enemyUnits,
    playerUnits: b.playerUnits,
    npcUnits: b.npcUnits,
    ...board(b),
    turn: b.turnManager?.turnNumber ?? 1,
    riteAtEntry: b.battleParams?.riteAtEntry ?? 0,
  });
  b._vigilState = step.state;
  for (const { unit } of step.summons) {
    registerBattleEntity(b, unit);
    b.enemyUnits.push(unit);
  }
  // Re-stamp the wards from the state kept (as VigilController.processPhase).
  applyVigilWards(vigil, b._vigilState, b.enemyUnits);
}

/** Mirrors VigilController's ward stamps at the battle's start and at a Voice's fall. */
export function settleVigilWards(b, fallen = null) {
  const vigil = b.battleConfig?.vigil;
  if (!vigil || (fallen && !isVoiceOf(vigil, fallen))) return;
  applyVigilWards(vigil, b._vigilState, b.enemyUnits);
}

/** Mirrors VigilController.canUnweave: a living Voice's unbroken circle under this unit. */
export function canUnweave(b, unit) {
  const vigil = b.battleConfig?.vigil;
  if (!vigil || !b.playerUnits.includes(unit) || unit.hasActed) return false;
  return Boolean(unweavableCircleAt(vigil, b._vigilState, b.enemyUnits, unit));
}

/** Mirrors VigilController.unweave: the circle breaks now, the wards re-stamped, then the
 *  caller ends the unit's action (no Canto, as the scene's). Returns what broke. */
export function unweaveVigilCircle(b, unit) {
  if (!canUnweave(b, unit)) throw new Error('Nothing to unweave here');
  const vigil = b.battleConfig.vigil;
  const result = unweaveCircle({
    vigil,
    state: b._vigilState,
    enemyUnits: b.enemyUnits,
    unit,
    turn: b.turnManager?.turnNumber ?? 1,
  });
  b._vigilState = result.state;
  applyVigilWards(vigil, b._vigilState, b.enemyUnits);
  return result.broke;
}

/** Mirrors EntityLimbController.processPhase: a limb rises where the army struck from. */
export function processEntityLimbs(b) {
  const kit = entityKitOf(b.battleConfig);
  if (!kit?.limbs) return;
  const step = limbPhaseStep({
    kit,
    state: b._entityKitState,
    enemyUnits: b.enemyUnits,
    ...board(b),
    turn: b.turnManager?.turnNumber ?? 1,
  });
  if (step.skipped) return;
  b._entityKitState = step.state;
  for (const { unit } of step.sprouts) {
    registerBattleEntity(b, unit);
    b.enemyUnits.push(unit);
  }
}

/** Mirrors EntityLimbController.onEnemyFell: a cut limb wounds the Entity; its fall withers them. */
export function entityLimbsOnFall(b, unit, killer) {
  const kit = entityKitOf(b.battleConfig);
  if (!kit?.limbs) return;
  if (isEntity(unit)) witherLimbs(b.enemyUnits);
  else if (isEntityLimb(unit))
    severLimb(unit, { kit, state: b._entityKitState, enemyUnits: b.enemyUnits, killer });
}

/**
 * Mirrors HammerfallController.processPhase: the Iron Guardian's standing marks fall (a fallen
 * victim removed before the next), then its next marks are set (engine/IronGuardian.js).
 */
export function processHammerfall(b) {
  if (!hammerfallOf(b.battleConfig)) return;
  const step = runHammerfallPhaseSync(
    {
      state: b._hammerfallState,
      enemyUnits: b.enemyUnits,
      army: armyAndNpcAllies(b.playerUnits, b.npcUnits),
      cols: b.battleConfig.cols,
      rows: b.battleConfig.rows,
      standable: (c, r) => standableAt(b.grid, c, r),
      turn: b.turnManager?.turnNumber ?? 1,
      battleBlessings: b._battleBlessings,
    },
    { remove: (victim, options) => b._removeUnit(victim, options) },
  );
  if (!step.skipped) b._hammerfallState = step.state;
}

/** Mirrors HammerfallController.onEnemyFell: the Guardian's fall clears its marks. */
export function hammerfallOnFall(b, unit) {
  if (!hammerfallOf(b.battleConfig) || !unit?.hammerfall) return;
  if (livingHammerfallUnit(b.enemyUnits)) return;
  b._hammerfallState = { ...sanitizeHammerfallState(b._hammerfallState), marks: [], pattern: null };
}

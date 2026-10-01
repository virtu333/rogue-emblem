import {
  addToInventory,
  canReclass,
  equipIfUnarmed,
  reclassUnit,
  removeFromConsumables,
} from '../engine/UnitManager.js';
import { UI_PALETTE } from '../utils/uiStyles.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { captureResolvedAction } from './BattlePresentationCheckpoint.js';

const ended = (scene, session) =>
  scene._battleSession !== session ||
  scene._sceneShutdownCleanedUp ||
  scene.sys?.isActive?.() === false;

export class ReclassController {
  constructor(scene) {
    this.scene = scene;
    this.pending = new WeakSet();
  }

  async executeReclass(unit, seal, newClassData) {
    const scene = this.scene;
    const session = scene._battleSession;
    if (
      ended(scene, session) ||
      !canReclass(unit) ||
      !unit.consumables?.includes(seal) ||
      (seal?.uses ?? 0) <= 0 ||
      this.pending.has(unit)
    )
      return false;
    const oldClassData = scene.gameData.classes.find((c) => c.name === unit.className);
    if (!oldClassData) {
      await scene.showBriefBanner('Reclass data missing.', UI_PALETTE.bad);
      if (ended(scene, session)) return false;
      scene.battleState = 'UNIT_ACTION_MENU';
      scene.showActionMenu(unit);
      return false;
    }
    this.pending.add(unit);
    let applied = false;
    try {
      scene.hideActionMenu();
      scene.battleState = 'COMBAT_RESOLVING';
      const oldTypes = new Set(unit.proficiencies.map((p) => p.type));
      reclassUnit(
        unit,
        newClassData,
        oldClassData,
        scene.gameData.classes,
        scene.gameData.skills,
        scene.gameData.traits || null,
      );
      applied = true;
      seal.uses -= 1;
      if (seal.uses <= 0) removeFromConsumables(unit, seal);
      for (const prof of unit.proficiencies) {
        if (oldTypes.has(prof.type)) continue;
        const weapon = scene.gameData.weapons.find(
          (w) => w.type === prof.type && w.tier === 'Iron',
        );
        if (weapon && !unit.inventory.some((w) => w.name === weapon.name)) {
          if (addToInventory(unit, weapon)) equipIfUnarmed(unit, unit.inventory.at(-1));
        }
      }
      observeHistoryAction(scene, 'reclassed', unit, null, newClassData.name);
      // Capture once: a retry re-persists this checkpoint, never reclassifies or
      // captures a new legacy RNG seed. Resume only finishes the action.
      captureResolvedAction(
        scene,
        {
          kind: 'finish',
          unitName: unit.name,
          ...(unit.battleEntityId ? { unitId: unit.battleEntityId } : {}),
        },
        { session },
      );
      try {
        scene.removeUnitGraphic(unit);
        scene.addUnitGraphic(unit);
        scene.updateHPBar(unit);
        await scene.showBriefBanner(
          `${unit.name} reclassed to ${newClassData.name}!`,
          UI_PALETTE.info,
        );
      } catch (error) {
        if (!ended(scene, session)) console.warn('[ReclassController] presentation failed:', error);
      }
      if (ended(scene, session)) return true;
      scene.finishUnitAction(unit);
      return true;
    } catch (error) {
      if (ended(scene, session)) return applied;
      if (applied) scene._recoverUnitActionError(unit, 'reclass', error, { session });
      else {
        console.error('[ReclassController] reclass failed:', error);
        scene.battleState = 'UNIT_ACTION_MENU';
        scene.showActionMenu(unit);
      }
      return applied;
    } finally {
      this.pending.delete(unit);
    }
  }

  destroy() {
    this.scene = null;
  }
}

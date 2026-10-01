import {
  addToInventory,
  canApplyReclass,
  getReclassTargets,
  equipIfUnarmed,
  reclassUnit,
  removeFromConsumables,
} from '../engine/UnitManager.js';
import { UI_PALETTE } from '../utils/uiStyles.js';
import { reportAsyncError } from '../utils/errorReporter.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { captureResolvedAction } from './BattlePresentationCheckpoint.js';
import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { replaceUnitGraphic } from './replaceUnitGraphic.js';

export class ReclassController {
  constructor(scene) {
    this.scene = scene;
    this.pending = new WeakSet();
  }

  async executeReclass(unit, seal, newClassData) {
    const scene = this.scene;
    const session = battleSession(scene);
    if (!unit || unit.hasActed) return false;
    const oldClassData = scene.gameData.classes.find((c) => c.name === unit?.className);
    if (
      !isCurrentBattleSession(scene, session) ||
      !canApplyReclass(unit, newClassData, oldClassData, scene.gameData.classes) ||
      seal?.effect !== 'reclass' ||
      !getReclassTargets(unit, scene.gameData.classes, seal?.subEffect).includes(newClassData) ||
      !unit.consumables?.includes(seal) ||
      !Number.isFinite(seal?.uses) ||
      seal.uses <= 0 ||
      this.pending.has(unit)
    ) {
      if (isCurrentBattleSession(scene, session) && !this.pending.has(unit)) {
        await scene.showBriefBanner(
          'Reclass is unavailable for this unit and seal.',
          UI_PALETTE.bad,
        );
        if (isCurrentBattleSession(scene, session)) {
          scene.battleState = 'UNIT_ACTION_MENU';
          scene.showActionMenu(unit);
        }
      }
      return false;
    }
    this.pending.add(unit);
    let applied = false;
    let sealSpent = false;
    let captured = false;
    const spendSeal = () => {
      if (sealSpent) return;
      seal.uses -= 1;
      if (seal.uses <= 0) removeFromConsumables(unit, seal);
      sealSpent = true;
    };
    const capture = () => {
      if (captured) return;
      captureResolvedAction(
        scene,
        {
          kind: 'finish',
          unitName: unit.name,
          ...(unit.battleEntityId ? { unitId: unit.battleEntityId } : {}),
        },
        { session },
      );
      captured = true;
    };
    try {
      scene.hideActionMenu();
      scene.battleState = 'COMBAT_RESOLVING';
      const oldTypes = new Set(unit.proficiencies.map((p) => p.type));
      applied = true; // Inputs are validated; any later throw may have mutated the unit.
      const result = reclassUnit(
        unit,
        newClassData,
        oldClassData,
        scene.gameData.classes,
        scene.gameData.skills,
        scene.gameData.traits || null,
      );
      if (result === null) {
        applied = false;
        scene.battleState = 'UNIT_ACTION_MENU';
        scene.showActionMenu(unit);
        return false;
      }
      spendSeal();
      for (const prof of unit.proficiencies) {
        if (oldTypes.has(prof.type)) continue;
        const weapon = scene.gameData.weapons.find(
          (w) => w.type === prof.type && w.tier === 'Iron',
        );
        if (weapon && !unit.inventory.some((w) => w.name === weapon.name)) {
          if (addToInventory(unit, weapon)) equipIfUnarmed(unit, unit.inventory.at(-1));
        }
      }
      try {
        observeHistoryAction(scene, 'reclassed', unit, null, newClassData.name);
      } catch (error) {
        reportAsyncError('reclassed_history_failed', error, { unit: unit.name });
      }
      capture();
      try {
        replaceUnitGraphic(scene, unit);
        scene.updateHPBar(unit);
        await scene.showBriefBanner(
          `${unit.name} reclassed to ${newClassData.name}!`,
          UI_PALETTE.info,
        );
      } catch (error) {
        if (isCurrentBattleSession(scene, session))
          console.warn('[ReclassController] presentation failed:', error);
      }
      if (!isCurrentBattleSession(scene, session)) return true;
      scene.finishUnitAction(unit, { session });
      return true;
    } catch (error) {
      if (!isCurrentBattleSession(scene, session)) return applied;
      if (applied) {
        spendSeal();
        try {
          capture();
        } catch (saveError) {
          console.error('[ReclassController] recovery save failed:', saveError);
        }
        scene._recoverUnitActionError(unit, 'reclass', error, { session });
      } else {
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

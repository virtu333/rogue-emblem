// HealController -- staff heal flow extracted from BattleScene.
// Owns staff selection, heal target selection, and heal resolution/animation.
// Cross-cutting seams (finishUnitAction, awardScaledXP, showActionMenu,
// showBriefBanner, and the heal-flow entry points themselves) are invoked via
// the scene's delegating wrappers so tests and other systems can intercept
// them on the scene as before.

import { TILE_SIZE, XP_BASE_HEAL } from '../utils/constants.js';
import {
  resolveHeal,
  getStaffRemainingUses,
  getStaffMaxUses,
  getEffectiveStaffRange,
  spendStaffUse,
  gridDistance,
} from '../engine/Combat.js';
import { equipWeapon, canEquip, hasStaff, getCombatWeapons } from '../engine/UnitManager.js';
import { showMinorHint } from './HintDisplay.js';

export class HealController {
  constructor(scene) {
    this.scene = scene;
  }

  getUsableStaves(unit) {
    return unit.inventory.filter(
      (w) => w.type === 'Staff' && canEquip(unit, w) && getStaffRemainingUses(w, unit) > 0,
    );
  }

  getActiveHealStaff(unit, usableStaves = null) {
    const usable = usableStaves || this.scene.getUsableStaves(unit);
    if (usable.length === 0) return null;
    if (unit.weapon && usable.includes(unit.weapon)) return unit.weapon;
    return usable[0];
  }

  findHealTargets(unit, staffOverride = null) {
    const scene = this.scene;
    if (!hasStaff(unit)) return [];
    const staff = staffOverride || scene.getActiveHealStaff(unit);
    if (!staff) return [];
    const range = getEffectiveStaffRange(staff, unit);
    const targets = [];
    for (const ally of scene.playerUnits) {
      if (ally === unit) continue; // Can't heal self
      if (ally.currentHP >= ally.stats.HP) continue; // Full HP
      const dist = gridDistance(unit.col, unit.row, ally.col, ally.row);
      if (dist >= range.min && dist <= range.max) {
        targets.push(ally);
      }
    }
    return targets;
  }

  startHealTargetSelection(unit, targets, chosenStaff = null) {
    const scene = this.scene;
    // Auto-equip staff
    const staff = chosenStaff || scene.getActiveHealStaff(unit);
    if (staff) equipWeapon(unit, staff);
    if (!staff) {
      scene.showActionMenu(unit);
      return;
    }

    // First-heal tutorial hint (one-time per save slot)
    const hints = scene.registry.get('hints');
    if (hints?.shouldShow('battle_heal_uses')) {
      showMinorHint(
        scene,
        'Staves have limited uses per battle. Uses reset each battle. Higher MAG grants bonus uses.',
      );
    }

    // Fortify: auto-heal all targets, no selection needed
    if (staff.healAll) {
      scene.executeHealAll(unit, targets);
      return;
    }

    scene.healTargets = targets;
    const healTiles = targets.map((a) => ({ col: a.col, row: a.row }));
    scene.grid.showHealRange(healTiles);
    scene.battleState = 'SELECTING_HEAL_TARGET';
  }

  showStaffPicker(unit, usableStaves) {
    const scene = this.scene;
    scene.hideActionMenu();
    scene.inEquipMenu = true;
    scene.battleState = 'UNIT_ACTION_MENU';

    const pos = scene.grid.gridToPixel(unit.col, unit.row);
    const menuX = unit.col < scene.grid.cols - 3 ? pos.x + TILE_SIZE : pos.x - TILE_SIZE - 210;
    const menuY = pos.y - 10;

    scene.actionMenu = [];
    const menuWidth = 210;
    const itemHeight = scene.isMobileInput ? 42 : 36;
    const menuHeight = usableStaves.length * itemHeight + 12;
    const menuPos = scene._clampMenuPosition(menuX, menuY, menuWidth, menuHeight);

    const bg = scene.add
      .rectangle(
        menuPos.x + menuWidth / 2,
        menuPos.y + menuHeight / 2,
        menuWidth,
        menuHeight,
        0x000000,
        0.85,
      )
      .setDepth(400)
      .setStrokeStyle(1, 0x666666);
    scene.actionMenu.push(bg);

    usableStaves.forEach((staff, i) => {
      const itemY = menuPos.y + 6 + i * itemHeight + itemHeight / 2;
      const itemX = menuPos.x + 8;
      const marker = staff === unit.weapon ? '\u25b6 ' : '  ';
      const rem = getStaffRemainingUses(staff, unit);
      const max = getStaffMaxUses(staff, unit);
      const rng = getEffectiveStaffRange(staff, unit);
      const label = `${marker}${staff.name}\n   ${rem}/${max} uses  Rng ${rng.min}-${rng.max}`;
      const defaultColor = staff === unit.weapon ? '#ffdd44' : '#e0e0e0';

      const text = scene._makeMenuTextButton(
        itemX,
        itemY,
        label,
        {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: defaultColor,
          lineSpacing: 1,
        },
        defaultColor,
        async () => {
          const audio = scene.registry.get('audio');
          if (audio) audio.playSFX('sfx_confirm');
          equipWeapon(unit, staff);
          const healTargets = scene.findHealTargets(unit, staff);
          if (healTargets.length === 0) {
            await scene.showBriefBanner('No heal targets in range for that staff.', '#ff8888');
            scene.showStaffPicker(unit, usableStaves);
            return;
          }
          scene.inEquipMenu = false;
          scene.hideActionMenu();
          scene.startHealTargetSelection(unit, healTargets, staff);
        },
        { originX: 0, originY: 0.5, hitWidth: menuWidth - 12, hitHeight: itemHeight },
      );

      scene.actionMenu.push(text);
    });
    scene._pinToScreen(scene.actionMenu);
  }

  handleHealTargetClick(gp) {
    const scene = this.scene;
    const target = scene.healTargets.find((a) => a.col === gp.col && a.row === gp.row);
    if (target) {
      scene.executeHeal(scene.selectedUnit, target);
    }
  }

  async executeHeal(healer, target) {
    const scene = this.scene;
    scene.battleState = 'HEAL_RESOLVING';
    scene.grid.clearAttackHighlights();

    try {
      const staff = healer.weapon; // Should already be equipped
      const healOpts = {
        healingMultiplier:
          scene.runManager?.blessingRuntimeModifiers?.healingEffectivenessMultiplier ?? 1,
      };
      const result = resolveHeal(staff, healer, target, healOpts);

      // Apply heal
      target.currentHP = result.targetHPAfter;
      scene.updateHPBar(target);

      // Animate
      await scene.animateHeal(target, result.healAmount);

      // Spend a use and check depletion
      spendStaffUse(staff);
      if (getStaffRemainingUses(staff, healer) <= 0) {
        const combatWpn = getCombatWeapons(healer)[0];
        if (combatWpn) equipWeapon(healer, combatWpn);
      }

      try {
        await scene.awardScaledXP(healer, XP_BASE_HEAL);
      } finally {
        scene.finishUnitAction(healer);
      }
    } catch (err) {
      scene._recoverUnitActionError(healer, 'heal', err);
    }
  }

  async executeHealAll(healer, targets) {
    const scene = this.scene;
    scene.battleState = 'HEAL_RESOLVING';
    scene.grid.clearAttackHighlights();

    try {
      const staff = healer.weapon;
      const healOpts = {
        healingMultiplier:
          scene.runManager?.blessingRuntimeModifiers?.healingEffectivenessMultiplier ?? 1,
      };

      for (const target of targets) {
        const result = resolveHeal(staff, healer, target, healOpts);
        target.currentHP = result.targetHPAfter;
        scene.updateHPBar(target);
        await scene.animateHeal(target, result.healAmount);
      }

      // Single use spent for all targets
      spendStaffUse(staff);
      if (getStaffRemainingUses(staff, healer) <= 0) {
        const combatWpn = getCombatWeapons(healer)[0];
        if (combatWpn) equipWeapon(healer, combatWpn);
      }

      try {
        await scene.awardScaledXP(healer, XP_BASE_HEAL);
      } finally {
        scene.finishUnitAction(healer);
      }
    } catch (err) {
      scene._recoverUnitActionError(healer, 'healAll', err);
    }
  }

  async animateHeal(target, healAmount) {
    const scene = this.scene;
    const reduced = scene._isReducedEffects();
    const audio = scene.registry.get('audio');
    if (audio) audio.playSFX('sfx_heal');
    // Flash target green
    if (target.graphic.setTint) target.graphic.setTint(0x44ff44);

    const pos = scene.grid.gridToPixel(target.col, target.row);
    const healText = scene.add
      .text(pos.x, pos.y - 16, `+${healAmount}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#44ff44',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(300);

    scene.tweens.add({
      targets: healText,
      y: pos.y - 36,
      alpha: 0,
      duration: reduced ? 260 : 600,
      onComplete: () => healText.destroy(),
    });

    await scene._awaitSceneDelay(reduced ? 120 : 250, { label: 'animate_heal_tint_clear' });
    if (target.graphic.clearTint) target.graphic.clearTint();
    await scene._awaitSceneDelay(reduced ? 100 : 250, { label: 'animate_heal_tail' });
  }

  destroy() {
    this.scene = null;
  }
}

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
import { isCureStaff, clearAllConditions } from '../engine/StatusConditionSystem.js';
import {
  isRelocateStaff,
  findRelocateTargets,
  getRelocationDestinations,
} from '../engine/StaffRelocation.js';
import { showMinorHint } from './HintDisplay.js';
import { CombatFxController } from './CombatFxController.js';

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
    if (isRelocateStaff(staff)) {
      // Warp/Rescue: phase-1 ally targets (destination legality by the
      // ALLY's moveType is checked inside findRelocateTargets).
      return findRelocateTargets(staff, unit, scene.playerUnits, scene.grid, (c, r) =>
        scene.getUnitAt(c, r),
      );
    }
    const range = getEffectiveStaffRange(staff, unit);
    const cure = isCureStaff(staff);
    const targets = [];
    for (const ally of scene.playerUnits) {
      if (ally === unit) continue; // Can't staff self
      if (cure) {
        if (ally.currentHP <= 0 || ally._removing) continue;
        if ((ally._conditions || []).length === 0) continue; // Nothing to cure
      } else if (ally.currentHP >= ally.stats.HP) {
        continue; // Full HP
      }
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

    // Warp/Rescue: two-phase targeting — pick the ally first, then the tile.
    if (isRelocateStaff(staff)) {
      scene.staffRelocateTargets = targets;
      scene.staffRelocateAlly = null;
      scene.staffRelocateTiles = [];
      scene.grid.showHealRange(targets.map((a) => ({ col: a.col, row: a.row })));
      scene.battleState = 'SELECTING_STAFF_ALLY';
      return;
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
            const message = isRelocateStaff(staff)
              ? 'No valid allies in range for that staff.'
              : 'No heal targets in range for that staff.';
            await scene.showBriefBanner(message, '#ff8888');
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

  // --- Warp/Rescue relocation flow ---

  /** Phase 1 (SELECTING_STAFF_ALLY): pick the ally to relocate. */
  handleStaffAllyClick(gp) {
    const scene = this.scene;
    const ally = (scene.staffRelocateTargets || []).find(
      (a) => a.col === gp.col && a.row === gp.row,
    );
    if (!ally) return;
    const caster = scene.selectedUnit;
    const staff = caster?.weapon; // equipped by startHealTargetSelection
    if (!caster || !isRelocateStaff(staff)) return;
    const tiles = getRelocationDestinations(staff, caster, ally, scene.grid, (c, r) =>
      scene.getUnitAt(c, r),
    );
    if (tiles.length === 0) return; // phase-1 filter should prevent this
    scene.staffRelocateAlly = ally;
    scene.staffRelocateTiles = tiles;
    scene.grid.showAttackRange(tiles, 0x66ccff, 0.4);
    scene.battleState = 'SELECTING_STAFF_TILE';
  }

  /** Phase 2 (SELECTING_STAFF_TILE): pick the destination tile. */
  handleStaffTileClick(gp) {
    const scene = this.scene;
    const tile = (scene.staffRelocateTiles || []).find((t) => t.col === gp.col && t.row === gp.row);
    if (!tile) return;
    const ally = scene.staffRelocateAlly;
    if (!ally) return;
    scene.executeRelocate(scene.selectedUnit, ally, tile);
  }

  /**
   * Resolve a Warp/Rescue relocation: fade the ally to the destination
   * (executeWarp pattern), spend a staff use, award staff XP, finish the
   * CASTER's action. The moved ally's acted state is deliberately untouched
   * (FE-classic: an un-acted ally can still act after being moved).
   */
  async executeRelocate(healer, ally, dest) {
    const scene = this.scene;
    scene.battleState = 'HEAL_RESOLVING';
    scene.grid.clearAttackHighlights();
    scene.staffRelocateTargets = [];
    scene.staffRelocateAlly = null;
    scene.staffRelocateTiles = [];

    try {
      const staff = healer.weapon; // Should already be equipped

      await this.animateRelocate(ally, dest);

      // A long-range landing can change fog visibility.
      if (scene.grid.fogEnabled) {
        scene.grid.updateFogOfWar(scene.playerUnits);
        scene.updateEnemyVisibility();
      }

      // Spend a use and check depletion (same pattern as executeHeal)
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
      scene._recoverUnitActionError(healer, 'staffRelocate', err);
    }
  }

  /** Fade-out → move → fade-in (BattleScene.executeWarp pattern). */
  async animateRelocate(ally, dest) {
    const scene = this.scene;
    const audio = scene.registry.get('audio');
    if (audio) audio.playSFX('sfx_heal');

    const targets = [
      ally.graphic,
      ally.label,
      ally.factionIndicator,
      ally.hpBar?.bg,
      ally.hpBar?.fill,
    ].filter(Boolean);

    if (targets.length > 0) {
      await scene._awaitSceneTween(
        { targets, alpha: 0, duration: 180 },
        { label: 'staff_relocate_fade_out' },
      );
    }
    ally.col = dest.col;
    ally.row = dest.row;
    scene.updateUnitPosition(ally);
    if (targets.length > 0) {
      await scene._awaitSceneTween(
        { targets, alpha: ally.hasActed ? 0.5 : 1, duration: 180 },
        { label: 'staff_relocate_fade_in' },
      );
    }
  }

  async executeHeal(healer, target) {
    const scene = this.scene;
    scene.battleState = 'HEAL_RESOLVING';
    scene.grid.clearAttackHighlights();

    try {
      const staff = healer.weapon; // Should already be equipped

      if (isCureStaff(staff)) {
        // Restore-style staff: cleanse instead of heal. A slept ally cured
        // during player phase can act this turn (selection reads conditions live).
        clearAllConditions(target);
        scene._removeAllConditionIcons(target);
        // Un-dim only sleepers that can still act — keep the acted-grey on
        // allies that already moved this phase (same pattern as Swap).
        if (!target.hasActed) scene.undimUnit(target);
        await this.animateCure(target);

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
        return;
      }

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

  async animateCure(target) {
    const scene = this.scene;
    const reduced = scene._isReducedEffects();
    const audio = scene.registry.get('audio');
    if (audio) audio.playSFX('sfx_heal');
    if (target.graphic.setTint) target.graphic.setTint(0x88ffcc);

    const pos = scene.grid.gridToPixel(target.col, target.row);
    (scene._combatFx ||= new CombatFxController(scene)).playHeal(pos.x, pos.y);
    const cureText = scene.add
      .text(pos.x, pos.y - 16, 'Cured!', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#88ffcc',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(300);

    scene.tweens.add({
      targets: cureText,
      y: pos.y - 36,
      alpha: 0,
      duration: reduced ? 260 : 600,
      onComplete: () => cureText.destroy(),
    });

    await scene._awaitSceneDelay(reduced ? 120 : 250, { label: 'animate_cure_tint_clear' });
    if (target.graphic.clearTint) target.graphic.clearTint();
    await scene._awaitSceneDelay(reduced ? 100 : 250, { label: 'animate_cure_tail' });
  }

  async animateHeal(target, healAmount) {
    const scene = this.scene;
    const reduced = scene._isReducedEffects();
    const audio = scene.registry.get('audio');
    if (audio) audio.playSFX('sfx_heal');
    // Flash target green
    if (target.graphic.setTint) target.graphic.setTint(0x44ff44);

    const pos = scene.grid.gridToPixel(target.col, target.row);
    (scene._combatFx ||= new CombatFxController(scene)).playHeal(pos.x, pos.y);
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

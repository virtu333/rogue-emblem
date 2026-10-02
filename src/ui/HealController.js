import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { TutorialController } from './TutorialController.js';
import { settleAndPresent } from './BattleActionSettlement.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
import {
  validateStaffAction,
  settleStaffHeal,
  settleStaffCure,
  settleStaffRelocation,
} from '../engine/StaffSettlement.js';
import { deedsFor } from './DeedController.js';
// HealController -- staff heal flow extracted from BattleScene.
// Owns staff selection, heal target selection, and heal resolution/animation.
// Cross-cutting seams (finishUnitAction, awardScaledXP, showActionMenu,
// showBriefBanner, and the heal-flow entry points themselves) are invoked via
// the scene's delegating wrappers so tests and other systems can intercept
// them on the scene as before.

import { TILE_SIZE, XP_BASE_HEAL } from '../utils/constants.js';
import { hasRoomRightOf } from '../utils/boardOrientation.js';
import {
  resolveHeal,
  getStaffRemainingUses,
  getStaffMaxUses,
  getEffectiveStaffRange,
  gridDistance,
} from '../engine/Combat.js';
import {
  equipWeapon,
  canEquip,
  hasStaff,
  getCombatWeapons,
  normalizeEquippedFirst,
  inventoryDisplayOrder,
} from '../engine/UnitManager.js';
import { isCureStaff } from '../engine/StatusConditionSystem.js';
import {
  isRelocateStaff,
  findRelocateTargets,
  getRelocationDestinations,
} from '../engine/StaffRelocation.js';
import { staffAllyCandidates } from '../engine/RecruitNpc.js';
import { canInspectUnit, seenTileOccupant } from '../engine/BattleInformation.js';
import { showContextualHint } from './HintDisplay.js';
import { CombatFxController } from './CombatFxController.js';
import { UI_PALETTE, UI_HEX } from '../utils/uiStyles.js';
import { EQUIPPED_MARKER } from './equippedBadge.js';

/** Heal motes cross from a visible healer to the target (presentation only). */
function healSource(source, target, scene) {
  const g = source?.graphic;
  if (!g || source === target || g.visible === false) return {};
  return {
    from: { x: g.x, y: g.y - 6 },
    seed: (scene.turnManager?.turnNumber || 0) * 31 + (target?.col || 0) * 7 + (target?.row || 0),
  };
}

export class HealController {
  constructor(scene) {
    this.scene = scene;
    this.session = battleSession(scene);
    this.previousCombatWeapons = new WeakMap();
  }

  // Using a staff is not an equipment change: the staff is held provisionally
  // (no inventory reorder) and the prior equipment comes back afterwards, so the
  // equipped-first bag order survives a heal or a cancelled staff pick.
  rememberCombatWeapon(unit) {
    const held = this.previousCombatWeapons.get(unit);
    // Re-entering the flow while the staff is still held keeps the true prior.
    if (held && held.staff && held.staff === unit.weapon) return;
    this.previousCombatWeapons.set(unit, { prior: unit.weapon || null, staff: null });
  }

  holdStaff(unit, staff) {
    this.rememberCombatWeapon(unit);
    equipWeapon(unit, staff, { reorder: false });
    const held = this.previousCombatWeapons.get(unit);
    if (held && unit.weapon === staff) held.staff = staff;
  }

  restoreCombatWeapon(unit) {
    if (!unit) return;
    const prior = this.previousCombatWeapons.get(unit)?.prior ?? null;
    this.previousCombatWeapons.delete(unit);
    const inventory = Array.isArray(unit.inventory) ? unit.inventory : [];
    const weapons = inventory.length ? getCombatWeapons(unit) : [];
    // Counter-ready: prefer the prior combat weapon, else the first carried one
    // (a unit that had a staff equipped switches to a weapon — a real equip).
    const weapon = weapons.includes(prior) ? prior : weapons[0];
    if (weapon) equipWeapon(unit, weapon);
    else if (prior && inventory.includes(prior) && canEquip(unit, prior)) equipWeapon(unit, prior);
    else normalizeEquippedFirst(unit);
  }

  /** Resolver options for player staff heals (run blessing heal multiplier). */
  getHealOptions() {
    return {
      healingMultiplier:
        this.scene.runManager?.blessingRuntimeModifiers?.healingEffectivenessMultiplier ?? 1,
    };
  }

  getUsableStaves(unit) {
    return inventoryDisplayOrder(unit).filter(
      (w) => w.type === 'Staff' && canEquip(unit, w) && getStaffRemainingUses(w, unit) > 0,
    );
  }

  getActiveHealStaff(unit, usableStaves = null) {
    const usable = usableStaves || this.scene.getUsableStaves(unit);
    if (usable.length === 0) return null;
    if (unit.weapon && usable.includes(unit.weapon)) return unit.weapon;
    return usable[0];
  }

  /**
   * Heal/cure targets for `unit`'s staff. `from` (a tile) measures reach from there
   * instead of where the unit stands: what the staff would offer after moving.
   */
  findHealTargets(unit, staffOverride = null, { from = null } = {}) {
    const scene = this.scene;
    if (!hasStaff(unit)) return [];
    const staff = staffOverride || scene.getActiveHealStaff(unit);
    if (!staff) return [];
    if (isRelocateStaff(staff)) {
      // Warp/Rescue: phase-1 ally targets (destination legality by the
      // ALLY's moveType is checked inside findRelocateTargets). Army only: a
      // warped caravan could skip its escort walk, a warped recruit its rescue.
      return findRelocateTargets(
        staff,
        unit,
        scene.playerUnits,
        scene.grid,
        seenTileOccupant(scene.grid, (c, r) => scene.getUnitAt(c, r)),
      );
    }
    const range = getEffectiveStaffRange(staff, unit);
    const origin = from || unit;
    const healOpts = this.getHealOptions();
    const targets = [];
    // Heal and cure staves mend green units too (recruit NPCs, the merchant
    // caravan), listed after the army.
    for (const ally of staffAllyCandidates(scene.playerUnits, scene.npcUnits)) {
      if (!this.wouldMend(unit, staff, ally, healOpts)) continue;
      const dist = gridDistance(origin.col, origin.row, ally.col, ally.row);
      if (dist >= range.min && dist <= range.max) {
        targets.push(ally);
      }
    }
    return targets;
  }

  /**
   * Would `staff` in `unit`'s hands do something for `ally` (reach aside)? A heal
   * staff needs a hurt ally it would restore HP to (never a use spent on 0); a cure
   * staff, an ally with a status. Fog hides an NPC the army cannot see, so a
   * long-range staff (or a coaching note) never reveals one by offering it.
   */
  wouldMend(unit, staff, ally, healOpts = this.getHealOptions()) {
    if (!ally || ally === unit) return false; // Can't staff self
    if (ally.currentHP <= 0 || ally._removing) return false;
    if (!canInspectUnit(this.scene.grid, ally)) return false;
    if (isCureStaff(staff)) return (ally._conditions || []).length > 0; // Nothing to cure
    if (ally.currentHP >= ally.stats.HP) return false; // Full HP
    return resolveHeal(staff, unit, ally, healOpts).healAmount > 0;
  }

  startHealTargetSelection(unit, targets, chosenStaff = null) {
    const scene = this.scene;
    // Auto-equip staff
    const staff = chosenStaff || scene.getActiveHealStaff(unit);
    if (staff && scene.battleParams?.tutorialMode && scene._tutorialStrictGateReleased) {
      const tutorial = (scene._tutorialController ||= new TutorialController(scene));
      if (!tutorial.taught.has('battle_staff_scope'))
        return tutorial.showResourceLesson([{ item: staff }]).then((shown) => {
          if (shown && !scene._sceneShutdownCleanedUp && scene.sys?.isActive?.() !== false)
            this.startHealTargetSelection(unit, targets, chosenStaff);
        });
    }
    if (staff) this.holdStaff(unit, staff);
    if (!staff) {
      scene.showActionMenu(unit);
      return;
    }

    // First-heal tutorial hint (one-time per save slot)
    const hints = scene.registry.get('hints');
    if (hints && !hints.hasSeen('battle_heal_uses')) {
      showContextualHint(
        scene,
        'battle_heal_uses',
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
    const menuX = hasRoomRightOf(scene.grid, unit.col, unit.row)
      ? pos.x + TILE_SIZE
      : pos.x - TILE_SIZE - 210;
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
      .setStrokeStyle(1, UI_HEX.line);
    scene.actionMenu.push(bg);

    usableStaves.forEach((staff, i) => {
      const itemY = menuPos.y + 6 + i * itemHeight + itemHeight / 2;
      const itemX = menuPos.x + 8;
      const marker = staff === unit.weapon ? EQUIPPED_MARKER : '  ';
      const rem = getStaffRemainingUses(staff, unit);
      const max = getStaffMaxUses(staff, unit);
      const rng = getEffectiveStaffRange(staff, unit);
      const label = `${marker}${staff.name}\n   ${rem}/${max} uses  Rng ${rng.min}-${rng.max}`;
      const defaultColor = staff === unit.weapon ? UI_PALETTE.accentText : UI_PALETTE.text;

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
          this.holdStaff(unit, staff);
          const healTargets = scene.findHealTargets(unit, staff);
          if (healTargets.length === 0) {
            this.restoreCombatWeapon(unit);
            const message = isRelocateStaff(staff)
              ? 'No valid allies in range for that staff.'
              : 'No heal targets in range for that staff.';
            await scene.showBriefBanner(message, UI_PALETTE.bad);
            scene.showStaffPicker(unit, usableStaves);
            return;
          }
          scene.inEquipMenu = false;
          scene.hideActionMenu();
          scene.startHealTargetSelection(unit, healTargets, staff);
        },
        { originX: 0, originY: 0.5, hitWidth: menuWidth - 12, hitHeight: itemHeight },
      );

      text._menuItem = staff;
      text._menuDescription = `${staff.special || staff.description || 'Healing staff'} · Uses refill each battle`;
      scene.actionMenu.push(text);
    });
    scene._pinToScreen(scene.actionMenu);
    scene._registerActionMenu();
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
    const tiles = getRelocationDestinations(
      staff,
      caster,
      ally,
      scene.grid,
      seenTileOccupant(scene.grid, (c, r) => scene.getUnitAt(c, r)),
    );
    if (tiles.length === 0) return; // phase-1 filter should prevent this
    scene.staffRelocateAlly = ally;
    scene.staffRelocateTiles = tiles;
    scene.grid.showRelocateGuide(ally, tiles, {
      reduceMotion: Boolean(scene._reduceMotion?.()),
      fill: UI_HEX.accent,
      edge: UI_HEX.accentText,
    });
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
  executeRelocate(healer, ally, dest) {
    const scene = this.scene;
    const staff = healer?.weapon;
    return this._runStaff(healer, 'staffRelocate', {
      validate: () =>
        validateStaffAction({
          staff,
          healer,
          targets: [ally],
          usable: this.findHealTargets(healer, staff),
          dest,
          destinations: getRelocationDestinations(
            staff,
            healer,
            ally,
            scene.grid,
            seenTileOccupant(scene.grid, (c, r) => scene.getUnitAt(c, r)),
          ),
        }),
      settle: () => {
        const facts = settleStaffRelocation({ staff, ally, dest });
        observeHistoryAction(scene, 'relocated', healer, ally, staff.name);
        scene.staffRelocateTargets = [];
        scene.staffRelocateAlly = null;
        scene.staffRelocateTiles = [];
        return facts;
      },
      present: async (facts, { session }) => {
        await safeBattlePresentation('staff relocation', () => this.animateRelocate(ally, dest), {
          scene,
        });
        if (!isCurrentBattleSession(scene, session)) return;
        safeBattlePresentation('staff danger', () => scene.refreshVisibleDangerZone?.(), { scene });
      },
    });
  }

  _runStaff(healer, label, { validate, settle, present }) {
    const scene = this.scene;
    const session = battleSession(scene);
    if (session !== this.session) return false;
    return settleAndPresent(scene, {
      session,
      unit: healer,
      label,
      validate: () =>
        (scene.playerUnits || []).includes(healer) && healer.faction === 'player' && validate(),
      onInvalid: () => this.restoreCombatWeapon(healer),
      settle: () => {
        // The staff this action spends (equipped for it; restored to the combat
        // weapon right after).
        const staff = healer.weapon;
        const facts = settle();
        // Its use count, once per use spent, inside the settlement: a checkpoint
        // keeps it with the item, so a resume or a rewind never counts it twice.
        if (facts?.usesSpent > 0) deedsFor(scene).onStaffUse(healer, staff);
        this.restoreCombatWeapon(healer);
        const xp = scene.awardScaledXP(healer, XP_BASE_HEAL, { present: false });
        if (xp && typeof xp.then === 'function') {
          Promise.resolve(xp).catch(() => {});
          throw new TypeError('Battle action XP settlement must be synchronous');
        }
        facts.xp = xp;
        return facts;
      },
      present: async (facts, options) => {
        safeBattlePresentation('staff XP', () => scene._presentScaledXP?.(healer, facts.xp), {
          scene,
        });
        await present(facts, options);
      },
    });
  }

  /** Fade-out → move → fade-in (BattleScene.executeWarp pattern). */
  async animateRelocate(ally, _dest) {
    const scene = this.scene;
    const session = battleSession(scene);
    if (session !== this.session) return false;
    if (!isCurrentBattleSession(scene, session)) return;
    const audio = scene.registry.get('audio');
    if (audio) audio.playSFX('sfx_heal');

    const targets = [
      ally.graphic,
      ally.label,
      ally.factionIndicator,
      ally.hpBar?.bg,
      ally.hpBar?.fill,
    ].filter(Boolean);
    // Spent units use a sprite tint, label alpha and a separately styled ring.
    // A blanket 0.5 also dims the sprite/HP bar beyond the next turn's reset.
    const originalAlpha = new Map(targets.map((target) => [target, target.alpha ?? 1]));

    try {
      if (targets.length > 0) {
        await scene._awaitSceneTween(
          { targets, alpha: 0, duration: 180 },
          { label: 'staff_relocate_fade_out' },
        );
        if (!isCurrentBattleSession(scene, session)) return;
      }
      scene.updateUnitPosition(ally);
      if (targets.length > 0) {
        await scene._awaitSceneTween(
          { targets, alpha: (target) => originalAlpha.get(target), duration: 180 },
          { label: 'staff_relocate_fade_in' },
        );
        if (!isCurrentBattleSession(scene, session)) return;
      }
    } finally {
      if (isCurrentBattleSession(scene, session)) {
        for (const target of targets)
          safeBattlePresentation(
            'staff opacity cleanup',
            () => target.setAlpha?.(originalAlpha.get(target)),
            { scene },
          );
      }
    }
  }

  executeHeal(healer, target) {
    return this._executeHealing(healer, [target], false);
  }

  executeHealAll(healer, targets) {
    return this._executeHealing(healer, targets, true);
  }

  _executeHealing(healer, targets, all) {
    const scene = this.scene;
    const staff = healer?.weapon;
    // Fortify's supplied list can contain a full-health ally; recompute the
    // same menu targets and settle only the still-mendable supplied allies.
    let selected;
    return this._runStaff(healer, all ? 'healAll' : 'heal', {
      validate: () => {
        if (!staff || isRelocateStaff(staff)) return false;
        const usable = this.findHealTargets(healer, staff);
        selected = all ? usable.filter((target) => targets?.includes(target)) : targets;
        return (
          (!all || staff?.healAll) &&
          validateStaffAction({ staff, healer, targets: selected, usable })
        );
      },
      settle: () => {
        if (isCureStaff(staff)) {
          const facts = settleStaffCure({ staff, target: selected[0] });
          observeHistoryAction(scene, 'cured', healer, facts.target, staff.name);
          return facts;
        }
        return settleStaffHeal({
          staff,
          healer,
          targets: selected,
          healOpts: this.getHealOptions(),
          traits: scene.gameData?.traits,
          turn: scene.turnManager?.turnNumber,
          phase: scene.turnManager?.currentPhase,
          onTarget: ({ unit, hpBefore, healAmount }) => {
            deedsFor(scene).onHeal(healer, unit, hpBefore);
            observeHistoryAction(scene, 'healed', healer, unit, `${healAmount} HP`, {
              amount: healAmount,
            });
          },
        });
      },
      present: async (facts, { session }) => {
        if (facts.kind === 'cure') {
          safeBattlePresentation(
            'staff condition icons',
            () => scene._removeAllConditionIcons(facts.target),
            { scene },
          );
          if (!facts.target.hasActed)
            safeBattlePresentation('staff undim', () => scene.undimUnit(facts.target), { scene });
          await safeBattlePresentation('staff cure', () => this.animateCure(facts.target, healer), {
            scene,
          });
          return;
        }
        for (const result of facts.targets) {
          if (!isCurrentBattleSession(scene, session)) return;
          safeBattlePresentation('staff HP', () => scene.updateHPBar(result.unit), { scene });
          if (result.selfHeal)
            safeBattlePresentation('staff grace HP', () => scene.updateHPBar(healer), { scene });
          await safeBattlePresentation(
            'staff heal',
            () => scene.animateHeal(result.unit, result.healAmount, healer),
            { scene },
          );
          if (!isCurrentBattleSession(scene, session)) return;
          if (result.selfHeal)
            await safeBattlePresentation(
              'staff grace',
              () => scene.animateHeal(healer, result.selfHeal),
              { scene },
            );
        }
      },
    });
  }

  async animateCure(target, source = null) {
    const scene = this.scene;
    const session = battleSession(scene);
    if (session !== this.session) return false;
    if (!isCurrentBattleSession(scene, session)) return;
    const reduced = scene._reduceMotion();
    const audio = scene.registry.get('audio');
    if (audio) audio.playSFX('sfx_heal');
    if (target.graphic?.setTint) target.graphic.setTint(0x88ffcc);

    const pos = scene.grid.gridToPixel(target.col, target.row);
    (scene._combatFx ||= new CombatFxController(scene)).playHeal(
      pos.x,
      pos.y,
      healSource(source, target, scene),
    );
    const cureText = scene.add
      .text(pos.x, pos.y - 16, 'Cured!', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: UI_PALETTE.good,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(300);

    scene.tweens.add({
      targets: cureText,
      y: reduced ? pos.y - 16 : pos.y - 36,
      alpha: 0,
      duration: 600,
      onComplete: () => cureText.destroy(),
    });

    await scene._awaitSceneDelay(reduced ? 120 : 250, { label: 'animate_cure_tint_clear' });
    if (!isCurrentBattleSession(scene, session)) return;
    if (target.graphic?.clearTint) target.graphic.clearTint();
    await scene._awaitSceneDelay(reduced ? 100 : 250, { label: 'animate_cure_tail' });
    if (!isCurrentBattleSession(scene, session)) return;
  }

  async animateHeal(target, healAmount, source = null) {
    const scene = this.scene;
    const session = battleSession(scene);
    if (session !== this.session) return false;
    if (!isCurrentBattleSession(scene, session)) return;
    const reduced = scene._reduceMotion();
    const audio = scene.registry.get('audio');
    if (audio) audio.playSFX('sfx_heal');
    // Flash target green
    if (target.graphic?.setTint) target.graphic.setTint(UI_HEX.hpHigh);

    const pos = scene.grid.gridToPixel(target.col, target.row);
    (scene._combatFx ||= new CombatFxController(scene)).playHeal(
      pos.x,
      pos.y,
      healSource(source, target, scene),
    );
    const healText = scene.add
      .text(pos.x, pos.y - 16, `+${healAmount}`, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: UI_PALETTE.good,
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(300);

    scene.tweens.add({
      targets: healText,
      y: reduced ? pos.y - 16 : pos.y - 36,
      alpha: 0,
      duration: 600,
      onComplete: () => healText.destroy(),
    });

    await scene._awaitSceneDelay(reduced ? 120 : 250, { label: 'animate_heal_tint_clear' });
    if (!isCurrentBattleSession(scene, session)) return;
    if (target.graphic?.clearTint) target.graphic.clearTint();
    await scene._awaitSceneDelay(reduced ? 100 : 250, { label: 'animate_heal_tail' });
    if (!isCurrentBattleSession(scene, session)) return;
  }

  destroy() {
    this.scene = null;
  }
}

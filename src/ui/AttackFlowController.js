// AttackFlowController — the target-first Attack sequence, extracted from
// BattleScene.
//
//   Attack ─▶ SELECTING_TARGET ─(pick)─▶ SHOWING_FORECAST ─(confirm)─▶ combat
//      ▲            │  ▲                        │
//      └── Back ────┘  └──── Cancel (same target focused) ┘
//
// Target selection highlights every enemy the unit can attack from its tile
// with ANY usable weapon (AttackOptions.planAttackTargets, via
// scene.findAttackTargets). Picking a target opens the forecast on the default
// weapon — the equipped one when it can hit that target, else the first in
// inventory order that can — and the player can switch weapons (◀ ▶, swipe,
// Left/Right, L1/R1) or targets (▲ ▼, tapping another target) without leaving
// the forecast. Every weapon change before confirm is a provisional preview
// (WeaponPreviewSession): the bag order never shifts while cycling, Cancel puts
// the equipped weapon back, and confirming commits the chosen weapon, which then
// moves to the top of the inventory.
//
// The controller owns no Phaser objects of its own: ForecastOverlay renders the
// canvas panel and MobileBattleHUD the phone panel. It never draws RNG — the
// forecast is the pure getCombatForecast.

import { ForecastOverlay } from './ForecastOverlay.js';
import { TutorialController } from './TutorialController.js';
import { getCombatForecast } from '../engine/Combat.js';
import { combatDistance, getFootprint, isEntity } from '../engine/EntitySystem.js';
import {
  getAttackWeapons,
  weaponsForDistance,
  orderAttackTargets,
  stepTarget,
} from '../engine/AttackOptions.js';
import { TILE_SIZE } from '../utils/constants.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';
import { UI_HEX } from '../utils/uiStyles.js';
import { withPresentationRandom } from '../utils/presentationRandom.js';
import {
  beginWeaponPreview,
  baselineWeapon,
  equipForAttackPlanning,
  resetWeaponPreview,
} from './WeaponPreviewSession.js';

const ATTACK_STATES = new Set(['SELECTING_TARGET', 'SHOWING_FORECAST']);

const TARGET_KEYS = {
  ArrowLeft: -1,
  ArrowUp: -1,
  ArrowRight: 1,
  ArrowDown: 1,
};

export class AttackFlowController {
  constructor(scene) {
    this.scene = scene;
    this.focusedTarget = null;
    this._lastTargetByUnit = new WeakMap();
  }

  distance(unit, target) {
    return combatDistance(unit, target);
  }

  /** Weapons that can attack `defender` from where `attacker` stands, equipped first. */
  weaponsForTarget(attacker, defender) {
    const scene = this.scene;
    const weapons = getAttackWeapons(attacker, { equipped: baselineWeapon(scene, attacker) });
    return weaponsForDistance(attacker, weapons, this.distance(attacker, defender), {
      skillsData: scene.gameData?.skills || null,
    });
  }

  // --- Target selection ------------------------------------------------------

  /** Action-menu Attack (optionally straight to a tapped target's forecast). */
  begin(unit, { target = null } = {}) {
    const scene = this.scene;
    if (!unit) return false;
    // Attack always acts for the menu's unit (the flow reads selectedUnit).
    if (scene.selectedUnit !== unit) scene.selectedUnit = unit;
    beginWeaponPreview(scene, unit);
    scene._clearSelectedWeaponArtIfInvalid?.(unit);
    return this.beginTargetSelection(unit, { target });
  }

  /**
   * Enter SELECTING_TARGET. With a selected weapon art the targets are the ones
   * that art's weapon reaches; otherwise the union over every usable weapon.
   */
  beginTargetSelection(unit, { target = null } = {}) {
    const scene = this.scene;
    const selectedArt = scene._getSelectedWeaponArtForUnit(unit, { isInitiating: true });
    const selectedEntry = selectedArt ? scene._resolveSelectedWeaponArtEntry(unit) : null;
    const targets = selectedEntry
      ? scene.findAttackTargets(unit, { weapon: selectedEntry.weapon, weaponArt: selectedArt })
      : scene.findAttackTargets(unit);
    if (targets.length <= 0) {
      scene.showActionMenu(unit);
      return false;
    }
    scene.hideActionMenu();
    scene.inEquipMenu = false;
    scene.attackTargets = orderAttackTargets(unit, targets, (t) => this.distance(unit, t));
    this.showTargetHighlights();
    scene.battleState = 'SELECTING_TARGET';
    const direct = target && scene.attackTargets.includes(target) ? target : null;
    const remembered = this._lastTargetByUnit.get(unit);
    this.focusTarget(
      direct ||
        (scene.attackTargets.includes(remembered) ? remembered : null) ||
        scene.attackTargets[0],
    );
    if (direct) void this.openForecast(unit, direct);
    scene._mobileBattleHud?.sync?.();
    return true;
  }

  showTargetHighlights() {
    const scene = this.scene;
    scene.grid?.clearAttackHighlights?.();
    // Every tile of every target (multi-tile entities included).
    scene.grid?.showAttackRange?.((scene.attackTargets || []).flatMap((t) => getFootprint(t)));
  }

  /** Put the (keyboard/pad/phone) cursor on a target and remember it. */
  focusTarget(target) {
    const scene = this.scene;
    if (!target) return;
    this.focusedTarget = target;
    if (scene.selectedUnit) this._lastTargetByUnit.set(scene.selectedUnit, target);
    scene._gridCursor?.snapTo?.(target.col, target.row);
    this.showReticle(target);
    scene._mobileBattleHud?.sync?.();
  }

  // --- Target reticle (presentation only) ------------------------------------

  /**
   * Ember corner brackets on the focused target, pulsing unless reduced motion.
   * Built under the presentation RNG so no Phaser construction can advance the
   * battle stream; hidden automatically once the attack flow is left.
   */
  showReticle(target) {
    const scene = this.scene;
    if (!target || !scene?.add?.graphics || !scene.grid?.gridToPixel) return;
    if (!this._reticle) {
      withPresentationRandom(() => {
        const g = scene.add.graphics().setDepth(UI_DEPTHS.UNITS + 5);
        const h = TILE_SIZE / 2;
        const arm = 8;
        g.lineStyle(3, UI_HEX.sunken, 0.9);
        this._drawBrackets(g, h + 1, arm);
        g.lineStyle(2, UI_HEX.accentText, 1);
        this._drawBrackets(g, h, arm);
        this._reticle = g;
        if (!scene._reduceMotion?.() && scene.tweens?.add)
          this._reticleTween = scene.tweens.add({
            targets: g,
            alpha: { from: 1, to: 0.45 },
            duration: 520,
            yoyo: true,
            repeat: -1,
          });
      });
      this._onUpdate = () => {
        if (this._reticle?.visible && !this.isAttacking()) this.hideReticle();
      };
      scene.events?.on?.('update', this._onUpdate);
    }
    // Multi-tile entities: frame the whole footprint.
    const tiles = isEntity(target) ? getFootprint(target) : [target];
    const cols = tiles.map((t) => t.col);
    const rows = tiles.map((t) => t.row);
    const [c0, c1, r0, r1] = [
      Math.min(...cols),
      Math.max(...cols),
      Math.min(...rows),
      Math.max(...rows),
    ];
    const a = scene.grid.gridToPixel(c0, r0);
    const b = scene.grid.gridToPixel(c1, r1);
    this._reticle
      .setPosition((a.x + b.x) / 2, (a.y + b.y) / 2)
      .setScale(c1 - c0 + 1, r1 - r0 + 1)
      .setVisible(true);
    this._reticleTween?.resume?.();
  }

  _drawBrackets(g, h, arm) {
    for (const [sx, sy] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      g.beginPath();
      g.moveTo(sx * h, sy * (h - arm));
      g.lineTo(sx * h, sy * h);
      g.lineTo(sx * (h - arm), sy * h);
      g.strokePath();
    }
  }

  hideReticle() {
    this._reticle?.setVisible?.(false);
    this._reticleTween?.pause?.();
  }

  isAttacking() {
    const scene = this.scene;
    return Boolean(scene?.selectedUnit && ATTACK_STATES.has(scene.battleState));
  }

  /** Step the focused target (target selection) or the forecast's target. */
  cycleTarget(direction) {
    const scene = this.scene;
    if (scene.isStoryInputLocked?.()) return false;
    const targets = scene.attackTargets || [];
    if (targets.length < 1 || !scene.selectedUnit) return false;
    if (scene.battleState === 'SELECTING_TARGET') {
      const next = stepTarget(targets, this.focusedTarget, direction);
      if (!next) return false;
      if (next !== this.focusedTarget) scene.registry?.get?.('audio')?.playSFX?.('sfx_cursor');
      this.focusTarget(next);
      return true;
    }
    if (scene.battleState === 'SHOWING_FORECAST') {
      const current = scene.forecastTarget;
      const next = stepTarget(targets, current, direction);
      if (!next || next === current) return false;
      scene.registry?.get?.('audio')?.playSFX?.('sfx_cursor');
      this.switchForecastTarget(next);
      return true;
    }
    return false;
  }

  /** Open the forecast for the focused target (Enter / pad confirm). */
  confirmFocusedTarget() {
    const scene = this.scene;
    const target = this.focusedTarget;
    if (scene.battleState !== 'SELECTING_TARGET' || !target) return false;
    if (!(scene.attackTargets || []).includes(target)) return false;
    void this.openForecast(scene.selectedUnit, target);
    return true;
  }

  /** A target was picked: forecast on the default weapon for that target. */
  openForecast(unit, target) {
    const scene = this.scene;
    if (!unit || !target) return undefined;
    // FE convention: every target starts from the equipped weapon.
    resetWeaponPreview(scene);
    this.focusTarget(target);
    scene.registry?.get?.('audio')?.playSFX?.('sfx_confirm');
    return scene.showForecast(unit, target);
  }

  /** Forecast shown; the player picked a different target (tap / ▲▼). */
  switchForecastTarget(target) {
    const scene = this.scene;
    const unit = scene.selectedUnit;
    if (!unit || !target || !(scene.attackTargets || []).includes(target)) return undefined;
    resetWeaponPreview(scene);
    this.focusTarget(target);
    return this.showForecast(unit, target, { rerender: true });
  }

  /** Forecast Cancel: back to target selection on the same target. */
  cancelForecast() {
    const scene = this.scene;
    const target = scene.forecastTarget;
    scene.hideForecast();
    scene._clearCombatRollSession();
    resetWeaponPreview(scene);
    scene.battleState = 'SELECTING_TARGET';
    if (scene.attackTargets?.length) this.showTargetHighlights();
    if (target) this.focusTarget(target);
  }

  /** Target-selection Back: return to the action menu (restores the weapon). */
  cancelTargetSelection() {
    const scene = this.scene;
    scene.grid.clearAttackHighlights();
    scene.attackTargets = [];
    this.focusedTarget = null;
    this.hideReticle();
    scene.showActionMenu(scene.selectedUnit);
  }

  // --- Forecast --------------------------------------------------------------

  /**
   * Build and render the forecast. `weapon` selects a specific valid weapon
   * (weapon cycling); otherwise the default for this target is used.
   */
  async showForecast(attacker, defender, { weapon = null, rerender = false } = {}) {
    const scene = this.scene;
    if (attacker?.faction === 'player') beginWeaponPreview(scene, attacker);
    scene.forecastTarget = defender;
    scene.battleState = 'SHOWING_FORECAST';
    scene._clearSelectedWeaponArtIfInvalid(attacker);

    // Shared context: distance, terrain, roll session, weapon art selection
    const {
      dist,
      atkTerrain,
      defTerrain,
      selectedArt: weaponArt,
      rollSession,
    } = scene._prepareCombatContext(attacker, defender, { isPlayerInitiator: true });

    // Art attacks stay bound to the art's weapon; normal attacks may use any
    // usable weapon that reaches this target (equipped first).
    const selectedEntry = weaponArt ? scene._resolveSelectedWeaponArtEntry(attacker) : null;
    const validWeapons = selectedEntry
      ? [selectedEntry.weapon]
      : this.weaponsForTarget(attacker, defender);
    const chosen =
      selectedEntry?.weapon ||
      (weapon && validWeapons.includes(weapon) ? weapon : validWeapons[0]) ||
      null;
    if (chosen && attacker.weapon !== chosen) equipForAttackPlanning(scene, attacker, chosen);

    scene._forecastWeaponArt = weaponArt;
    if (
      attacker?.accessory?.combatEffects?.gambler ||
      attacker?.accessory?.combatEffects?.gamblerCoin
    ) {
      const delta = scene._getGamblerAtkDelta(attacker, rollSession);
      const signed = delta >= 0 ? `+${delta}` : `${delta}`;
      scene._forecastGamblerLine = `GAMBLER: ATK ${signed} (locked)`;
    } else {
      scene._forecastGamblerLine = null;
    }
    const skillCtx = scene._buildForecastSkillCtx(attacker, defender, weaponArt);

    const forecast = getCombatForecast(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      dist,
      atkTerrain,
      defTerrain,
      skillCtx,
    );

    scene._forecastValidWeapons = validWeapons;
    const targets = scene.attackTargets || [];
    const targetIndex = targets.indexOf(defender);

    // Swap panels in one frame (no empty frame between old and new) and keep
    // the phone panel's focused control and scroll position across rebuilds.
    const hud = scene._mobileBattleHud;
    const keep = rerender ? hud?.captureForecastView?.() : null;
    if (scene._forecastOverlay) {
      scene._forecastOverlay.destroy();
      scene._forecastOverlay = null;
    }
    scene._forecastOverlay = new ForecastOverlay(scene);
    scene._forecastOverlay.render({
      attacker,
      defender,
      forecast,
      weaponArt: scene._forecastWeaponArt,
      gamblerLine: scene._forecastGamblerLine,
      validWeapons,
      equippedWeapon: baselineWeapon(scene, attacker),
      targetIndex,
      targetCount: targetIndex >= 0 ? targets.length : 0,
    });
    if (keep) hud?.restoreForecastView?.(keep);
    scene.forecastObjects = scene._forecastOverlay.displayObjects;
    scene._pinToScreen(scene.forecastObjects);

    if (scene.battleParams?.tutorialMode) {
      if (scene.tutorialStep === 4) scene.tutorialStep = 5;
      await (scene._tutorialController ||= new TutorialController(scene)).showForecastLesson(
        forecast,
      );
    }
    return forecast;
  }

  /** ◀ ▶ / swipe / Left-Right / L1-R1 in the forecast. */
  cycleWeapon(direction) {
    const scene = this.scene;
    if (scene.isStoryInputLocked?.()) return false;
    if (scene.battleState !== 'SHOWING_FORECAST' || !scene.selectedUnit) return false;
    const validWeapons = scene._forecastValidWeapons;
    if (!validWeapons || validWeapons.length < 2) return false;
    const currentIdx = validWeapons.indexOf(scene.selectedUnit.weapon);
    if (currentIdx < 0) return false;
    const step = direction < 0 ? -1 : 1;
    const next = validWeapons[(currentIdx + step + validWeapons.length) % validWeapons.length];
    scene.registry?.get?.('audio')?.playSFX?.('sfx_cursor');
    void this.showForecast(scene.selectedUnit, scene.forecastTarget, {
      weapon: next,
      rerender: true,
    });
    return true;
  }

  // --- Input -----------------------------------------------------------------

  /**
   * Desktop keyboard: in target selection arrows cycle targets and Enter/Space
   * opens the forecast; in the canvas forecast Up/Down cycle targets and
   * Enter/Space confirm (Left/Right weapons are bound by the scene). The phone
   * forecast is a DOM dialog that keeps its own keys.
   */
  handleKey(event) {
    const scene = this.scene;
    if (!event || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey)
      return false;
    const state = scene.battleState;
    if (state !== 'SELECTING_TARGET' && state !== 'SHOWING_FORECAST') return false;
    if (state === 'SHOWING_FORECAST' && scene._mobileBattleHud?.forecast) return false;
    if (event.target?.closest?.('input, textarea, select, button, [contenteditable="true"]'))
      return false;
    const confirm = event.key === 'Enter' || event.key === ' ';
    if (state === 'SELECTING_TARGET') {
      if (TARGET_KEYS[event.key]) {
        event.preventDefault?.();
        return this.cycleTarget(TARGET_KEYS[event.key]);
      }
      if (confirm && !event.repeat) {
        event.preventDefault?.();
        return this.confirmFocusedTarget();
      }
      return false;
    }
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault?.();
      return this.cycleTarget(TARGET_KEYS[event.key]);
    }
    if (confirm && !event.repeat) {
      event.preventDefault?.();
      scene.registry?.get?.('audio')?.playSFX?.('sfx_confirm');
      scene.confirmForecastCombat();
      return true;
    }
    return false;
  }

  /**
   * Controller actions while attacking (canvas forecast / target selection).
   * Returns true when consumed; the phone forecast owns its own input scope.
   */
  handleInputAction(action, payload, InputAction) {
    const scene = this.scene;
    const state = scene.battleState;
    if (state === 'SELECTING_TARGET') {
      if (action === InputAction.NAVIGATE) {
        const d = payload?.dx || payload?.dy || 0;
        if (d) this.cycleTarget(d);
        return true;
      }
      if (action === InputAction.PREV_UNIT || action === InputAction.NEXT_UNIT) {
        this.cycleTarget(action === InputAction.PREV_UNIT ? -1 : 1);
        return true;
      }
      if (action === InputAction.CONFIRM) return this.confirmFocusedTarget();
      return false;
    }
    if (state === 'SHOWING_FORECAST' && !scene._mobileBattleHud?.forecast) {
      if (action === InputAction.NAVIGATE) {
        if (payload?.dx) this.cycleWeapon(payload.dx);
        else if (payload?.dy) this.cycleTarget(payload.dy);
        return true;
      }
      if (action === InputAction.PREV_UNIT || action === InputAction.NEXT_UNIT) {
        this.cycleWeapon(action === InputAction.PREV_UNIT ? -1 : 1);
        return true;
      }
      if (action === InputAction.CONFIRM) {
        scene.confirmForecastCombat();
        return true;
      }
    }
    return false;
  }

  destroy() {
    if (this._onUpdate) this.scene?.events?.off?.('update', this._onUpdate);
    this._onUpdate = null;
    this._reticleTween?.remove?.();
    this._reticleTween = null;
    this._reticle?.destroy?.();
    this._reticle = null;
    this.focusedTarget = null;
    this.scene = null;
  }
}

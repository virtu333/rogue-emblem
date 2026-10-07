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
// the forecast. The forecast is read-only for equipment: the weapon it shows is
// only planned (scene._forecastWeapon), so the equipped weapon and the bag never
// change while planning, cycling, switching targets or backing out. Confirming
// equips the planned weapon, which then moves to the top of the inventory.
//
// The controller owns no Phaser objects of its own: ForecastOverlay renders the
// canvas panel and MobileBattleHUD the phone panel. It never draws RNG — the
// forecast is the pure getCombatForecast (via scene._computePlayerForecast).

import { ForecastOverlay } from './ForecastOverlay.js';
import { AreaPreviewController } from './AreaPreviewController.js';
import { areaForecastLines, previewAreaArt } from '../engine/AreaPreview.js';
import {
  combatStrikeMods,
  forecastRawDamage,
  forecastStrikeGroups,
  usesMagic,
} from '../engine/Combat.js';
import { guidanceText, isArmoredFoe } from '../engine/Guidance.js';
import { playerKnowledgeOf } from './battleKnowledge.js';
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
    this._affixLessonsShown = new Set();
  }

  distance(unit, target) {
    return combatDistance(unit, target);
  }

  /** Weapons that can attack `defender` from where `attacker` stands, equipped first. */
  weaponsForTarget(attacker, defender) {
    const scene = this.scene;
    const weapons = getAttackWeapons(attacker);
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
    // An area art shows where it reaches and whom (numbers wait for the forecast).
    if (scene.battleState === 'SELECTING_TARGET') this.showAreaPreview(target, { numbers: false });
    scene._mobileBattleHud?.sync?.();
  }

  // --- Area preview (docs/specs/aoe-weapon-arts.md §5) ------------------------

  /** The board as the player knows it (the scene's own view, battleKnowledge.js). */
  knowledge() {
    return playerKnowledgeOf(this.scene);
  }

  /** The world an area preview reads: board size, terrain and affix data, never units. */
  previewWorld() {
    const scene = this.scene;
    return {
      cols: scene.grid?.cols ?? 0,
      rows: scene.grid?.rows ?? 0,
      getMoveCost: (col, row, moveType) => scene.grid?.getMoveCost?.(col, row, moveType) ?? 1,
      getTerrainAt: (col, row) => scene.grid.getTerrainAt?.(col, row) ?? null,
      affixes: scene.gameData?.affixes,
    };
  }

  /**
   * The selected art's preview against `target`, or null when no area art is selected.
   * `strikeMods` are the forecast's merged mods; without them the art's own mods stand
   * in (target selection draws no numbers). The blows are struck with the art's weapon,
   * which confirming equips, whatever is equipped now.
   */
  areaPreviewFor(target, { strikeMods = null, blows = 1, dealt = 0, weapon = null } = {}) {
    const scene = this.scene;
    const unit = scene.selectedUnit;
    const art = unit ? scene._getSelectedWeaponArtForUnit?.(unit, { isInitiating: true }) : null;
    if (!art || !target) return null;
    const artWeapon =
      weapon || scene._resolveSelectedWeaponArtEntry?.(unit)?.weapon || unit.weapon || null;
    const preview = previewAreaArt({
      attacker: unit,
      art,
      target,
      knowledge: this.knowledge(),
      world: this.previewWorld(),
      strikeMods: strikeMods || combatStrikeMods({ atkWeaponArtMods: art.combatMods }, artWeapon),
      weapon: artWeapon,
      blows,
      dealt,
    });
    const empty =
      !preview ||
      (preview.tiles.length === 0 &&
        preview.heals.length === 0 &&
        !preview.push &&
        !preview.pushes?.length);
    return empty ? null : preview;
  }

  showAreaPreview(target, opts = {}) {
    const scene = this.scene;
    const preview = this.areaPreviewFor(target, opts);
    if (!preview) {
      this.clearAreaPreview();
      return null;
    }
    (this._areaPreview ||= new AreaPreviewController(scene)).show(preview, {
      numbers: opts.numbers !== false,
    });
    return preview;
  }

  clearAreaPreview() {
    this._areaPreview?.clear();
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
        if (this._areaPreview?.preview && !this.isAttacking()) this.clearAreaPreview();
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
      // A prologue chapter's first forecast is read as it is: Confirm or Cancel only.
      if (scene._prologue?.allowsForecastCycling() === false) return false;
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
    // FE convention: every target starts from the equipped weapon (showForecast's default).
    this.focusTarget(target);
    scene.registry?.get?.('audio')?.playSFX?.('sfx_confirm');
    return scene.showForecast(unit, target);
  }

  /** Forecast shown; the player picked a different target (tap / ▲▼). */
  switchForecastTarget(target) {
    const scene = this.scene;
    const unit = scene.selectedUnit;
    if (!unit || !target || !(scene.attackTargets || []).includes(target)) return undefined;
    this.focusTarget(target);
    return this.showForecast(unit, target, { rerender: true });
  }

  /** Forecast Cancel: back to target selection on the same target. */
  cancelForecast() {
    const scene = this.scene;
    const target = scene.forecastTarget;
    scene.hideForecast({ acknowledge: true, cancelled: true });
    scene._clearCombatRollSession();
    scene.battleState = 'SELECTING_TARGET';
    if (scene.attackTargets?.length) this.showTargetHighlights();
    if (target) this.focusTarget(target);
  }

  /** Target-selection Back: return to the action menu. */
  cancelTargetSelection() {
    const scene = this.scene;
    scene.grid.clearAttackHighlights();
    scene.attackTargets = [];
    this.focusedTarget = null;
    this.hideReticle();
    this.clearAreaPreview();
    scene.showActionMenu(scene.selectedUnit);
  }

  // --- Forecast --------------------------------------------------------------

  /**
   * Build and render the forecast. `weapon` selects a specific valid weapon
   * (weapon cycling); otherwise the default for this target is used. The
   * chosen weapon is only planned (scene._forecastWeapon): nothing is equipped.
   */
  async showForecast(attacker, defender, { weapon = null, rerender = false } = {}) {
    const scene = this.scene;
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
    scene._forecastWeapon = chosen;

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
    // Computed in the state resolution uses (after a weapon art's HP cost,
    // Recoil Guard buff and Phoenix Brooch heal); see BattleScene._computePlayerForecast.
    const forecast = scene._computePlayerForecast(attacker, defender, weaponArt, {
      weapon: chosen,
      dist,
      atkTerrain,
      defTerrain,
    });
    // An area art: its full preview, with the combat's merged mods, and its forecast lines.
    if (weaponArt) {
      const strikeMods = combatStrikeMods(
        scene._buildForecastSkillCtx?.(attacker, defender, weaponArt, { weapon: chosen }),
        chosen,
      );
      // An art's follow-up is a plain strike: it adds damage but no area blows.
      const hits = Math.max(1, Number(forecastStrikeGroups(forecast.attacker)[0]?.count) || 1);
      const dealt = Math.min(
        forecastRawDamage(forecast.attacker),
        Math.max(0, Number(defender.currentHP) || 0),
      );
      const preview = this.showAreaPreview(defender, {
        strikeMods,
        blows: hits,
        dealt,
        weapon: chosen,
      });
      forecast.attacker.areaNotes = areaForecastLines(preview);
    } else {
      this.clearAreaPreview();
    }
    const hints = scene.registry?.get?.('hints');
    for (const info of [forecast.attacker, forecast.defender]) {
      info.affixNotes = (info.affixNotes || []).map((note) => {
        const id = `affix_${note.affixId}`;
        const showDescription = Boolean(note.description) && !hints?.hasSeen?.(id);
        if (showDescription) this._affixLessonsShown.add(id);
        return { ...note, showDescription };
      });
    }

    // The armor lesson (§7): the first forecast of a blade against armour says so, on the
    // forecast itself (never over it), and is read when the player confirms or cancels.
    const armor = this.armorLesson(attacker, defender, chosen);
    if (armor) {
      forecast.defender.lessonNote = armor;
      this._affixLessonsShown.add('guide_armor');
    }
    // A prologue chapter's forecast tip (reinforcement, never over the forecast): its
    // beats are matched before the first render, and the line stays in the attacker's
    // notes, re-renders included, until the forecast closes (read on Confirm / Cancel).
    if (scene._prologue && !rerender) scene._prologue.prepareForecast?.(attacker, defender, forecast, chosen); // prettier-ignore
    const prologueTip = scene._prologue?.forecastTipText?.();
    if (prologueTip) forecast.attacker.lessonNote = prologueTip;

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
      weapon: chosen || attacker.weapon || null,
      equippedWeapon: attacker.weapon || null,
      targetIndex,
      targetCount: targetIndex >= 0 ? targets.length : 0,
    });
    if (keep) hud?.restoreForecastView?.(keep);
    scene.forecastObjects = scene._forecastOverlay.displayObjects;
    scene._pinToScreen(scene.forecastObjects);

    // A prologue chapter's forecast notes read over the open forecast (first open only).
    if (scene._prologue && !rerender) {
      await scene._prologue.onForecastOpened(attacker, defender, forecast, chosen);
    }
    return forecast;
  }

  /**
   * The armor note's text for this forecast, or null: a player unit striking an
   * armoured foe (Guidance.isArmoredFoe) with a weapon that hits DEF, while the slot has
   * not read it and the Guidance level allows it (GuidanceController.allows; off in a
   * prologue chapter).
   */
  armorLesson(attacker, defender, weapon) {
    const guidance = this.scene._guidance;
    if (attacker?.faction !== 'player' || !weapon || usesMagic(weapon)) return null;
    if (!isArmoredFoe(defender) || !guidance?.allows?.('guide_armor')) return null;
    return guidanceText('guide_armor', {
      knight: defender.moveType === 'Armored',
      target: defender,
    });
  }

  /**
   * The forecast closed. Only the player's own Confirm or Cancel acknowledges the rules it
   * showed (cycled targets included); End Turn, a rewind or a scene shutdown (the phone
   * turning) closes it unread, so the rules show in full next time.
   */
  closeForecast({ acknowledge = false } = {}) {
    if (acknowledge) {
      const hints = this.scene.registry?.get?.('hints');
      for (const id of this._affixLessonsShown) hints?.markSeen?.(id);
    }
    this._affixLessonsShown.clear();
  }

  /** ◀ ▶ / swipe / Left-Right / L1-R1 in the forecast. */
  cycleWeapon(direction) {
    const scene = this.scene;
    if (scene.isStoryInputLocked?.()) return false;
    if (scene.battleState !== 'SHOWING_FORECAST' || !scene.selectedUnit) return false;
    if (scene._prologue?.allowsForecastCycling() === false) return false;
    const validWeapons = scene._forecastValidWeapons;
    if (!validWeapons || validWeapons.length < 2) return false;
    const currentIdx = validWeapons.indexOf(scene._forecastWeapon);
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
    this._areaPreview?.destroy();
    this._areaPreview = null;
    this.focusedTarget = null;
    this.scene = null;
  }
}

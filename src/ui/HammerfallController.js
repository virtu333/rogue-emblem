// HammerfallController — the battle side of the Iron Guardian's Hammerfall (rules:
// engine/IronGuardian.js; the headless harness drives the same rules without any of this drawing).
//
//   sync           each frame: the marks the Guardian's next slam will cover, drawn on the board
//   processPhase   at each enemy-phase start, after the Entity's limbs: the standing marks fall
//                  (each victim's HP first, then its presentation, a fallen one removed before
//                  the next), then the next marks are planned
//   onEnemyFell    at a foe's fall: the Guardian's fall clears its marks
//
// As VigilController: the state first, then the drawing, every piece inside
// safeBattlePresentation, so a failed graphic never costs a slam or the enemy phase. Nothing here
// draws from Math.random (the marks follow from the board), and nothing leaks the fog: the marks,
// the banner and the impact play only while the player sees the Guardian.
// BattleScene owns one instance on a map that fields a Guardian (destroyed with the scene).

import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { CombatFxController } from './CombatFxController.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
import { floatCombatNumber } from './CombatNumberFloat.js';
import {
  hammerfallOf,
  hammerfallPhase,
  livingHammerfallUnit,
  sanitizeHammerfallState,
  standableAt,
} from '../engine/IronGuardian.js';
import { canInspectUnit } from '../engine/BattleInformation.js';
import { armyAndNpcAllies } from '../engine/RecruitNpc.js';
import { TILE_SIZE } from '../utils/constants.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';
import { UI_HEX, UI_PALETTE } from '../utils/uiStyles.js';

export const HAMMERFALL_BANNERS = Object.freeze({
  slam: 'Hammerfall!',
  front: 'It raises the hammer.',
  shock: 'The floor groans.',
});

const INSET = 2;

export class HammerfallController {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    /** The marks drawn now: [{ col, row, x, y }]. */
    this.shown = [];
    this._key = null;
  }

  create() {
    this.sync();
    return this;
  }

  destroy() {
    this._clear();
    this._key = null;
    this.scene = null;
  }

  get enabled() {
    return hammerfallOf(this.scene?.battleConfig);
  }

  /** The fog's one rule (canInspectUnit: Seer's Eye shows it). */
  seesUnit(unit) {
    return canInspectUnit(this.scene?.grid, unit);
  }

  _fx() {
    const scene = this.scene;
    return scene ? (scene._combatFx ||= new CombatFxController(scene)) : null;
  }

  /** The marks the player is shown: none while the Guardian stands unseen (or is gone). */
  visibleMarks() {
    const scene = this.scene;
    const guardian = livingHammerfallUnit(scene?.enemyUnits);
    if (!guardian || !this.seesUnit(guardian)) return [];
    return sanitizeHammerfallState(scene._hammerfallState).marks;
  }

  /** Per-frame reconciliation; redrawn only when the marks change. Presentation only. */
  sync() {
    const scene = this.scene;
    if (!scene?.grid || !this.enabled) return;
    safeBattlePresentation(
      'hammerfall marks',
      () => {
        const marks = this.visibleMarks();
        const key = marks.map((t) => `${t.col},${t.row}`).join(';');
        if (key === this._key) return;
        this._key = null; // set only once drawn, so a failed draw is retried
        this._clear();
        for (const tile of marks) this._drawMark(tile);
        this._key = key;
        scene._cameraFilterDirty = true;
      },
      { scene },
    );
  }

  /** Enemy-phase start: the marks fall, then the next ones are set (engine/IronGuardian.js). */
  async processPhase() {
    const scene = this.scene;
    if (!scene || !this.enabled) return;
    const session = battleSession(scene);
    const before = sanitizeHammerfallState(scene._hammerfallState);
    const guardian = livingHammerfallUnit(scene.enemyUnits);
    const seen = guardian ? this.seesUnit(guardian) : false;
    const steps = hammerfallPhase({
      state: before,
      enemyUnits: scene.enemyUnits,
      army: armyAndNpcAllies(scene.playerUnits, scene.npcUnits),
      cols: scene.battleConfig?.cols ?? scene.grid?.cols ?? 0,
      rows: scene.battleConfig?.rows ?? scene.grid?.rows ?? 0,
      standable: (c, r) => standableAt(scene.grid, c, r),
      turn: scene.turnManager?.turnNumber ?? 1,
      battleBlessings: scene._battleBlessings,
    });
    let bannered = false;
    for (;;) {
      const { value, done } = steps.next();
      if (done) {
        if (!value.skipped) scene._hammerfallState = value.state;
        if (value.slam && guardian)
          observeHistoryAction(
            scene,
            'brought the hammer down',
            guardian,
            null,
            value.slam.hits.length > 0 ? `${value.slam.hits.length} struck` : 'nobody there',
          );
        break;
      }
      const { victim, damage, stoneBroken, bannerHeld } = value;
      if (bannerHeld) scene._noteBannerHold?.(victim);
      if (seen && !bannered) {
        bannered = true;
        await safeBattlePresentation(
          'hammerfall banner',
          () => scene.showBriefBanner?.(HAMMERFALL_BANNERS.slam, UI_PALETTE.bad),
          { scene },
        );
        if (!isCurrentBattleSession(scene, session)) return;
      }
      await safeBattlePresentation(
        'hammerfall hit',
        async () => {
          scene.updateHPBar?.(victim);
          if (stoneBroken) scene._stoneBreakFx?.().playBreak(victim);
          if (bannerHeld) scene._bannerHoldFx?.().playHold(victim);
          const pos = scene.grid.gridToPixel(victim.col, victim.row);
          scene.registry?.get?.('audio')?.playSFX?.('sfx_hammerfall');
          scene.shakeScreen?.('crash');
          floatCombatNumber(scene, {
            kind: 'strike',
            value: damage,
            x: pos.x,
            y: pos.y - 16,
            reducedMotion: scene._reduceMotion?.(),
          });
          await scene._awaitSceneDelay?.(220, { label: 'hammerfall_tick' });
        },
        { scene },
      );
      if (!isCurrentBattleSession(scene, session)) return;
      if (victim.currentHP <= 0) {
        await scene.removeUnit(victim, { killer: value.guardian });
        if (!isCurrentBattleSession(scene, session)) return;
      }
    }
    scene.dangerZoneStale = true;
    this.sync();
    const after = sanitizeHammerfallState(scene._hammerfallState);
    const g = livingHammerfallUnit(scene.enemyUnits);
    if (g && after.marks.length > 0 && this.seesUnit(g))
      await safeBattlePresentation(
        'hammerfall marked',
        () => scene.showMinorHintAt?.(...hintAt(scene, g), HAMMERFALL_BANNERS[after.pattern]),
        { scene },
      );
    await scene._sweepFallenUnits?.();
  }

  /** A foe fell (already off the roster): the Guardian's fall clears its marks. */
  onEnemyFell(unit) {
    const scene = this.scene;
    if (!scene || !this.enabled || !isRecordedGuardian(unit)) return;
    if (livingHammerfallUnit(scene.enemyUnits)) return;
    const state = sanitizeHammerfallState(scene._hammerfallState);
    scene._hammerfallState = { ...state, marks: [], pattern: null };
    this.sync();
  }

  _reduced() {
    return Boolean(this.scene?._reduceMotion?.());
  }

  /**
   * A marked tile: a dark-red wash, a heavy edge and a cross of cracks, pulsing (still under
   * Reduce motion). Its own shape, never hue alone: the cracks read on any palette.
   */
  _drawMark(tile) {
    const scene = this.scene;
    if (!scene?.grid?.gridToPixel) return;
    const { x, y } = scene.grid.gridToPixel(tile.col, tile.row);
    this.shown.push({ col: tile.col, row: tile.row, x, y });
    if (!scene.add?.graphics) return;
    try {
      const g = scene.add.graphics();
      g.setDepth?.(UI_DEPTHS.OBJECTIVE_TILE);
      g.name = 'hammerfall-mark';
      const half = TILE_SIZE / 2 - INSET;
      g.fillStyle?.(UI_HEX.bloodDeep, 0.42);
      g.fillRect?.(x - half, y - half, half * 2, half * 2);
      g.lineStyle?.(3, UI_HEX.void, 0.8);
      g.strokeRect?.(x - half, y - half, half * 2, half * 2);
      g.lineStyle?.(1.5, UI_HEX.bad, 1);
      g.strokeRect?.(x - half, y - half, half * 2, half * 2);
      // Cracks from the centre: the slam's shape on the stone.
      g.lineStyle?.(1.5, UI_HEX.emberPale, 0.9);
      g.lineBetween?.(x - 7, y - 5, x, y);
      g.lineBetween?.(x, y, x + 8, y - 3);
      g.lineBetween?.(x, y, x - 3, y + 8);
      g.lineBetween?.(x, y, x + 5, y + 6);
      this.objects.push(g);
      if (!this._reduced())
        scene.tweens?.add?.({
          targets: g,
          alpha: 0.55,
          duration: 700,
          yoyo: true,
          repeat: -1,
          ease: 'Sine.easeInOut',
        });
    } catch {
      /* cosmetic only */
    }
  }

  _clear() {
    for (const obj of this.objects) {
      try {
        this.scene?.tweens?.killTweensOf?.(obj);
        obj.destroy?.();
      } catch {
        /* already destroyed */
      }
    }
    this.objects = [];
    this.shown = [];
  }
}

function isRecordedGuardian(unit) {
  return unit && typeof unit.hammerfall === 'object' && unit.hammerfall !== null;
}

function hintAt(scene, unit) {
  const pos = scene.grid.gridToPixel(unit.col, unit.row);
  return [pos.x + TILE_SIZE / 2, pos.y - 12];
}

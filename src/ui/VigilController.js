// VigilController — the battle side of the Vigil (rules: engine/Vigil.js; the headless
// harness drives the same rules through `_processVigil` without any of this drawing).
//
//   processPhase   at each enemy-phase start, right after the Necromancer's raise: the Voices
//                  on their sigils speak (counted in scene._vigilState), then each open circle
//                  calls a Hollowed onto the board
//   onVoiceFell    at a Voice's fall (BattleScene.removeUnit): "A Voice falls silent." and the
//                  `voice_silenced` cue (ui/ceremonyMusic.js, in the key of the Vigil's theme)
//   sync          every frame (BattleScene.update): the sigil and circle markers re-derived
//                  from the board, redrawn only when what they show changes
//
// Rendering never changes game state: the step's result is applied to the roster and the state
// first, in one go, and only then presented; nothing here writes HP. Nothing here draws from
// Math.random (the call has its own keyed stream).
//
// The fog (the one rule, BattleInformation.canInspectUnit / isUnitSeenAt):
//   - "The Voices speak." plays once a phase, only when a speaking Voice is seen;
//   - "The circle calls." plays once a phase, only when a called Hollowed is seen (with the
//     rising effect on each one seen); a Hollowed called in fog stays hidden like any enemy;
//   - "A Voice falls silent." plays only for a fall the player saw;
//   - a sigil is lit only while its Voice is seen standing on it; an unseen Voice's sigil is dim,
//     as is a seen one moved off it. A fallen Voice's sigil goes dark and its circle closes:
//     the objective's count (BattleObjectives.statusView) already tells how many have fallen.
// The markers' tiles are the map's (the set piece places them), so drawing them leaks nothing.
// They sit with the objective tiles (UI_DEPTHS.OBJECTIVE_TILE, as the escape EXIT: above the fog,
// the night's darkness and the ranges, below the units), so they read in a dark hall; a fogged
// sigil is only ever dim. Placed with grid.gridToPixel, they turn with a portrait board.
// BattleScene owns one instance on a Vigil map (destroyed with the scene).

import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { CombatFxController } from './CombatFxController.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
import { playCue } from './ceremonyMusic.js';
import { vigilBoardView, vigilPhaseStep, voiceUnit } from '../engine/Vigil.js';
import { enemyDifficultyConfigFromParams } from '../engine/UnitManager.js';
import { canInspectUnit, isUnitSeenAt } from '../engine/BattleInformation.js';
import { TILE_SIZE } from '../utils/constants.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';
import { UI_HEX, UI_PALETTE } from '../utils/uiStyles.js';

export const VIGIL_BANNERS = Object.freeze({
  words: 'The Voices speak.',
  call: 'The circle calls.',
  silenced: 'A Voice falls silent.',
});

/** The stinger a seen Voice's fall plays (musicStingers.js; act-v-descent §8). */
export const VOICE_SILENCED_CUE = 'voice_silenced';

export class VigilController {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    /** What is drawn: { sigils: [{ id, col, row, state, waking }], circles: [{ id, col, row, state }] }. */
    this.shown = { sigils: [], circles: [] };
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

  get vigil() {
    return this.scene?.battleConfig?.vigil || null;
  }

  /** Is this unit in the player's view? The fog's one rule (canInspectUnit: Seer's Eye shows it). */
  seesUnit(unit) {
    return canInspectUnit(this.scene?.grid, unit);
  }

  /** The scene's combat effects (made on first use, as removeUnit makes them). */
  _fx() {
    const scene = this.scene;
    return scene ? (scene._combatFx ||= new CombatFxController(scene)) : null;
  }

  /**
   * What each marker shows, as the player knows it:
   * sigils `lit` (its Voice seen on it) | `dim` (unseen, or seen off it) | `silent` (fallen);
   * circles `open` | `covered` (a player or NPC unit stands on it) | `closed` (its Voice fell).
   */
  markerStates() {
    const scene = this.scene;
    const vigil = this.vigil;
    if (!scene || !vigil) return { sigils: [], circles: [] };
    const view = vigilBoardView(vigil, {
      enemyUnits: scene.enemyUnits,
      playerUnits: scene.playerUnits,
      npcUnits: scene.npcUnits,
    });
    return {
      sigils: view.sigils.map((s) => ({
        id: s.id,
        col: s.col,
        row: s.row,
        waking: s.waking,
        state: !s.voice ? 'silent' : s.onSigil && this.seesUnit(s.voice) ? 'lit' : 'dim',
      })),
      circles: view.circles.map((c) => ({
        id: c.id,
        col: c.col,
        row: c.row,
        state: !c.voice ? 'closed' : c.covered ? 'covered' : 'open',
      })),
    };
  }

  /** Cheap per-frame reconciliation with the board and the fog. */
  sync() {
    const scene = this.scene;
    if (!scene?.grid || !this.vigil) return;
    const states = this.markerStates();
    const key = [...states.sigils, ...states.circles]
      .map((m) => `${m.id}:${m.col},${m.row}:${m.state}`)
      .join(';');
    if (key === this._key) return;
    this._key = key;
    this._clear();
    for (const circle of states.circles) this._drawCircle(circle);
    for (const sigil of states.sigils) this._drawSigil(sigil);
    // Pinned-UI camera filters need to learn about new world objects.
    scene._cameraFilterDirty = true;
  }

  /** Enemy-phase start: the words, then the calls (engine/Vigil.js). */
  async processPhase() {
    const scene = this.scene;
    const vigil = this.vigil;
    if (!scene || !vigil) return;
    const session = battleSession(scene);
    if (!isCurrentBattleSession(scene, session)) return;
    const step = vigilPhaseStep({
      vigil,
      state: scene._vigilState,
      enemyUnits: scene.enemyUnits,
      playerUnits: scene.playerUnits,
      npcUnits: scene.npcUnits,
      cols: scene.battleConfig?.cols ?? scene.grid?.cols ?? 0,
      rows: scene.battleConfig?.rows ?? scene.grid?.rows ?? 0,
      // Execution sees every unit; previews never come through here.
      isOccupied: (c, r) => Boolean(scene.getUnitAt(c, r)),
      moveCostAt: (c, r, moveType) => scene.grid.getTerrainAt(c, r)?.moveCost?.[moveType],
      turn: scene.turnManager?.turnNumber ?? 1,
      seed: scene.getReinforcementSeed(),
      riteAtEntry: scene.battleParams?.riteAtEntry ?? 0,
      classes: scene.gameData?.classes,
      weapons: scene.gameData?.weapons,
      difficultyConfig: enemyDifficultyConfigFromParams(scene.battleParams),
    });
    if (step.skipped) return;

    // The state and the roster first, in one go; presentation follows and can fail harmlessly.
    scene._vigilState = step.state;
    for (const { unit, voiceId } of step.summons) {
      scene.enemyUnits.push(unit);
      scene.addUnitGraphic(unit);
      observeHistoryAction(scene, 'called', voiceUnit(voiceId, scene.enemyUnits), unit);
    }
    if (step.summons.length > 0) {
      if (scene.grid?.fogEnabled) scene.updateEnemyVisibility?.();
      scene.dangerZoneStale = true;
      scene._pinnedThreats?.invalidate?.();
    }
    this.sync();

    const heard = step.words.some((word) =>
      this.seesUnit(voiceUnit(word.voiceId, scene.enemyUnits)),
    );
    if (heard) {
      await safeBattlePresentation(
        'vigil words',
        () => scene.showBriefBanner?.(VIGIL_BANNERS.words, UI_PALETTE.mark),
        { scene },
      );
      if (!isCurrentBattleSession(scene, session)) return;
    }
    const seen = step.summons.map((s) => s.unit).filter((unit) => this.seesUnit(unit));
    if (seen.length > 0) {
      await safeBattlePresentation(
        'vigil call',
        async () => {
          await scene.showBriefBanner?.(VIGIL_BANNERS.call, UI_PALETTE.rarityEpic);
          if (!isCurrentBattleSession(scene, session)) return;
          await Promise.all(seen.map((unit) => this._fx()?.raise?.(unit)));
        },
        { scene },
      );
      if (!isCurrentBattleSession(scene, session)) return;
    }
    scene.updateObjectiveText?.();
  }

  /** A Voice fell at `tile` (already off the roster): its circle is closed for good. */
  async onVoiceFell(unit, tile = { col: unit?.col, row: unit?.row }) {
    const scene = this.scene;
    if (!scene) return;
    const session = battleSession(scene);
    this.sync();
    if (!isUnitSeenAt(scene.grid, unit, tile.col, tile.row)) return;
    // The cue is heard only for a fall the player saw (as the banner): sound tells no secrets.
    void playCue(scene, VOICE_SILENCED_CUE, { duck: 0.3 });
    await safeBattlePresentation(
      'vigil silenced',
      () => scene.showBriefBanner?.(VIGIL_BANNERS.silenced, UI_PALETTE.muted),
      { scene },
    );
    if (!isCurrentBattleSession(scene, session)) return;
  }

  _reduced() {
    return Boolean(this.scene?._reduceMotion?.());
  }

  _pulse(targets, low) {
    if (this._reduced()) return;
    this.scene?.tweens?.add?.({
      targets,
      alpha: low,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });
  }

  /** A sigil: a ring with four points (the Waking's with a second, gold ring). */
  _drawSigil(sigil) {
    const scene = this.scene;
    if (!scene?.grid?.gridToPixel) return;
    const { x, y } = scene.grid.gridToPixel(sigil.col, sigil.row);
    this.shown.sigils.push({ ...sigil, x, y });
    if (!scene.add?.graphics) return;
    try {
      const g = scene.add.graphics();
      g.setDepth?.(UI_DEPTHS.OBJECTIVE_TILE);
      g.name = `vigil-sigil-${sigil.state}`;
      const r = TILE_SIZE / 2 - 3;
      const lit = sigil.state === 'lit';
      const dim = sigil.state === 'dim';
      const tone = lit ? UI_HEX.mark : dim ? UI_HEX.lineStrong : UI_HEX.mutedDim;
      const alpha = lit ? 1 : dim ? 0.75 : 0.55;
      g.fillStyle?.(lit ? UI_HEX.rarityEpic : UI_HEX.void, lit ? 0.3 : 0.25);
      g.fillCircle?.(x, y, r);
      g.lineStyle?.(2, tone, alpha);
      g.strokeCircle?.(x, y, r);
      g.lineStyle?.(1, tone, alpha);
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ])
        g.lineBetween?.(x + dx * (r - 4), y + dy * (r - 4), x + dx * (r + 2), y + dy * (r + 2));
      if (sigil.waking && sigil.state !== 'silent') {
        g.lineStyle?.(1, UI_HEX.accent, lit ? 0.9 : 0.5);
        g.strokeCircle?.(x, y, r - 5);
      }
      if (sigil.state === 'silent') {
        g.lineStyle?.(2, UI_HEX.mutedDim, 0.8);
        g.lineBetween?.(x - r / 2, y - r / 2, x + r / 2, y + r / 2);
      }
      this.objects.push(g);
      if (lit) this._pulse([g], 0.55);
    } catch {
      /* cosmetic only */
    }
  }

  /** A summoning circle: two rings and a hollow centre; green-edged while a unit blocks it. */
  _drawCircle(circle) {
    const scene = this.scene;
    if (!scene?.grid?.gridToPixel) return;
    const { x, y } = scene.grid.gridToPixel(circle.col, circle.row);
    this.shown.circles.push({ ...circle, x, y });
    if (!scene.add?.graphics) return;
    try {
      const g = scene.add.graphics();
      g.setDepth?.(UI_DEPTHS.OBJECTIVE_TILE);
      g.name = `vigil-circle-${circle.state}`;
      const r = TILE_SIZE / 2 - 2;
      const open = circle.state === 'open';
      const tone = open ? UI_HEX.mark : circle.state === 'covered' ? UI_HEX.good : UI_HEX.lineDim;
      g.fillStyle?.(open ? UI_HEX.rarityEpic : UI_HEX.void, open ? 0.28 : 0.3);
      g.fillCircle?.(x, y, r);
      g.lineStyle?.(2, tone, open ? 1 : 0.7);
      g.strokeCircle?.(x, y, r);
      g.lineStyle?.(1, open ? UI_HEX.threatStatus : tone, open ? 0.9 : 0.5);
      g.strokeCircle?.(x, y, r - 5);
      g.strokeCircle?.(x, y, r - 10);
      this.objects.push(g);
      if (open) this._pulse([g], 0.6);
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
    this.shown = { sigils: [], circles: [] };
  }
}

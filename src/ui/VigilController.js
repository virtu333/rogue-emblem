// VigilController — the battle side of the Vigil (rules: engine/Vigil.js; the headless
// harness drives the same rules through `_processVigil` without any of this drawing).
//
//   processPhase   at each enemy-phase start, right after the Necromancer's raise: the Voices
//                  on their sigils speak (counted in scene._vigilState), then each open circle
//                  calls a Hollowed onto the board
//   onVoiceFell    at a Voice's fall (BattleScene.removeUnit): "A Voice falls silent.", the
//                  `voice_silenced` cue (ui/ceremonyMusic.js, in the key of the Vigil's theme) and
//                  the Voice's last line (the first to fall in the dialogue box, each later one
//                  floating over its tile)
//   sync          every frame (BattleScene.update): the sigil and circle markers and the
//                  Voices' wards re-derived from the board, redrawn only when what they show
//                  changes
//
// The shields (engine/Vigil.js: wards and the choir): the phase step breaks a circle a unit
// stands on, then `applyVigilWards` re-stamps every Voice before anything is drawn (and again at
// a Voice's fall, which may lift the Waking's choir ward). A broken circle seen plays "A circle
// breaks." with the shatter sound; a Voice seen losing its ward floats "Ward broken". A warded
// Voice wears a pale hexagon (a second, inner ring while the choir alone holds it).
//
// What the court says (engine/VigilWords.js, dialogue.json `vigil`): each Voice heard speaking
// says the next of its verse over itself, one called Hollowed seen rising answers the roll, and a
// Voice seen falling says its last line (the first Voice to fall in the dialogue box, as a
// commander's last words; each later one floats over its tile). Each
// pick is a count the state already keeps, so a replayed phase says the same words.
//
// Rendering never changes game state: the step's result (the state, the roster with each called
// unit's battle identity, the history's records) is applied first, in one go, and only then
// presented, every piece of the drawing inside safeBattlePresentation, so a failed graphic, banner
// or marker can neither cut a call short nor stop the enemy phase. Nothing here writes HP.
// Nothing here draws from Math.random (the call has its own keyed stream).
//
// The fog (the one rule, BattleInformation.canInspectUnit / isUnitSeenAt / isUnitTileSeen):
//   - "The Voices speak." plays once a phase, only when a speaking Voice is seen;
//   - "The circle calls." plays once a phase, only when a called Hollowed is seen (with the
//     rising effect on each one seen); a Hollowed called in fog stays hidden like any enemy;
//   - "A Voice falls silent." and the Voice's last line play only for a fall the player saw;
//   - a word floats only over a Voice the player sees, the roll call only over a seen Hollowed;
//   - a marker is drawn only on a tile the player sees (isUnitTileSeen: Seer's Eye shows them
//     all): a Voice stands on its sigil from the first turn, so a sigil drawn in the fog would
//     name where an unseen foe is. On a seen tile a sigil is lit while its Voice stands on it
//     (and is seen: always, on a seen tile) and empty when it does not.
// What a marker says is told by its SHAPE and fill, never by hue alone (a colour-blind player
// reads the same board): a sigil is a diamond, a circle is a round seal; a lit sigil is filled
// and wears corner brackets, an empty one is a hollow socket; an open circle is a solid ring with
// spokes, a blocked one a dashed ring, a closed one a thin ring struck through; a Waking sigil
// has a second, inner diamond. Every stroke is laid over a dark one, so it reads on pale stone
// and in a dark hall alike. The corners and tips stay visible around a unit standing on the tile.
// They sit with the objective tiles (UI_DEPTHS.OBJECTIVE_TILE, as the escape EXIT: below the
// units), and are placed with grid.gridToPixel, so they turn with a portrait board (every shape
// is symmetric under a quarter turn).
// BattleScene owns one instance on a Vigil map (destroyed with the scene).

import { battleSession, isCurrentBattleSession } from './BattleSession.js';
import { observeHistoryAction } from './BattleHistoryRecorder.js';
import { CombatFxController } from './CombatFxController.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
import { drawArrivalGraphic } from './arrivalGraphic.js';
import { playCue } from './ceremonyMusic.js';
import {
  applyVigilWards,
  sanitizeVigilState,
  vigilBoardView,
  vigilPhaseStep,
  voiceUnit,
  voicesFallen,
} from '../engine/Vigil.js';
import { registerBattleEntity } from '../engine/BattleEntityIdentity.js';
import { vigilCallLine, vigilSilencedLine, vigilSpokenWords } from '../engine/VigilWords.js';
import { BattleBeatsController } from './BattleBeatsController.js';
import { enemyDifficultyConfigFromParams } from '../engine/UnitManager.js';
import { canInspectUnit, isUnitSeenAt, isUnitTileSeen } from '../engine/BattleInformation.js';
import { TILE_SIZE } from '../utils/constants.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';
import { UI_HEX, UI_PALETTE } from '../utils/uiStyles.js';

/** What a marker's ground reads as to the fog: a foe's tile (the Eye shows it, the fog may not). */
const GROUND = Object.freeze({ faction: 'enemy' });
/** Marker geometry, in world pixels of a TILE_SIZE tile. */
const MARKER_INSET = 2;
const WAKING_GAP = 5;
const CIRCLE_DASHES = 10;

/**
 * Stroke a shape twice: a dark line a little wider beneath, the tone over it, so a marker reads
 * on pale stone and on a dark floor alike. `draw` strokes the shape with the style just set.
 */
function underlaid(g, width, tone, alpha, draw) {
  g.lineStyle?.(width + 2.5, UI_HEX.void, Math.min(0.9, alpha));
  draw();
  g.lineStyle?.(width, tone, alpha);
  draw();
}

export const VIGIL_BANNERS = Object.freeze({
  words: 'The Voices speak.',
  call: 'The circle calls.',
  silenced: 'A Voice falls silent.',
  broken: 'A circle breaks.',
});

/** What floats over a Voice whose ward just fell. */
export const WARD_FALLS_LINE = 'Ward broken';
/** The sound a circle's breaking and a ward's fall make (sfxConfig COMBAT_SFX). */
export const WARD_BREAK_SFX = 'sfx_ward_break';

/** The stinger a seen Voice's fall plays (musicStingers.js; act-v-descent §8). */
export const VOICE_SILENCED_CUE = 'voice_silenced';

/** The Voices' words come one after another, so four over one ring stay readable. */
const WORD_STAGGER_MS = 350;
/** How long a word or the roll call stays up (shorter than the rally's lines: a phase moves on). */
const WORD_HOLD_MS = 1800;

export class VigilController {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    /** What is drawn: { sigils: [{ id, col, row, state, waking }], circles: [{ id, col, row, state }],
     *  wards: [{ id, col, row, state }] }. */
    this.shown = { sigils: [], circles: [], wards: [] };
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

  /** What the court says (dialogue.json `vigil`), or null. */
  get words() {
    return this.scene?.gameData?.dialogue?.vigil || null;
  }

  /** The scene's floating lines (BattleBeatsController.speakOver), made on first use. */
  _beats() {
    const scene = this.scene;
    return scene ? (scene._battleBeats ||= new BattleBeatsController(scene)) : null;
  }

  /** The scene's combat effects (made on first use, as removeUnit makes them). */
  _fx() {
    const scene = this.scene;
    return scene ? (scene._combatFx ||= new CombatFxController(scene)) : null;
  }

  /**
   * Does the fog show the ground a marker sits on? The one rule for a foe's tile (isUnitTileSeen,
   * Seer's Eye included), asked for the sigil's Voice when it lives.
   */
  seesTile(col, row, voice = null) {
    return isUnitTileSeen(this.scene?.grid, voice || GROUND, col, row);
  }

  /**
   * What each marker shows, as the player knows it:
   * sigils `lit` (its Voice seen on it) | `dim` (empty: unseen, or seen off it) | `silent`
   * (fallen); circles `open` | `covered` (a player or NPC unit stands on it) | `closed` (its
   * Voice fell) | `broken` (shattered: it calls no more and holds no ward); wards, one per seen
   * warded Voice, `circle` (a circle holds it) | `choir` (only the choir does).
   * `seen`: the fog shows the tile; only a marker on a seen tile is drawn.
   */
  markerStates() {
    const scene = this.scene;
    const vigil = this.vigil;
    if (!scene || !vigil) return { sigils: [], circles: [], wards: [] };
    const view = vigilBoardView(vigil, {
      enemyUnits: scene.enemyUnits,
      playerUnits: scene.playerUnits,
      npcUnits: scene.npcUnits,
      state: scene._vigilState,
    });
    return {
      sigils: view.sigils.map((s) => ({
        id: s.id,
        col: s.col,
        row: s.row,
        waking: s.waking,
        seen: this.seesTile(s.col, s.row, s.voice),
        state: !s.voice ? 'silent' : s.onSigil && this.seesUnit(s.voice) ? 'lit' : 'dim',
      })),
      circles: view.circles.map((c) => ({
        id: c.id,
        col: c.col,
        row: c.row,
        seen: this.seesTile(c.col, c.row, c.voice),
        state: c.broken ? 'broken' : !c.voice ? 'closed' : c.covered ? 'covered' : 'open',
      })),
      // A living Voice's ward, only while the player sees the Voice (the fog's one rule).
      wards: view.sigils
        .filter((s) => s.voice && (s.ward?.circle || s.ward?.choir) && this.seesUnit(s.voice))
        .map((s) => ({
          id: s.voiceId,
          col: s.voice.col,
          row: s.voice.row,
          seen: true,
          state: s.ward.circle ? 'circle' : 'choir',
          choir: s.ward.choir,
        })),
    };
  }

  /**
   * Cheap per-frame reconciliation with the board and the fog. Presentation only, and contained:
   * a marker that fails to draw never reaches its caller (the frame, a Voice's fall, the phase
   * step), and is tried again on the next call.
   */
  sync() {
    const scene = this.scene;
    if (!scene?.grid || !this.vigil) return;
    safeBattlePresentation(
      'vigil markers',
      () => {
        const all = this.markerStates();
        const states = {
          sigils: all.sigils.filter((m) => m.seen),
          circles: all.circles.filter((m) => m.seen),
          wards: all.wards.filter((m) => m.seen),
        };
        const key = [...states.sigils, ...states.circles, ...states.wards]
          .map((m) => `${m.id}:${m.col},${m.row}:${m.state}${m.choir ? '+' : ''}`)
          .join(';');
        if (key === this._key) return;
        this._key = null; // set only once drawn, so a failed draw is retried
        this._clear();
        for (const circle of states.circles) this._drawCircle(circle);
        for (const sigil of states.sigils) this._drawSigil(sigil);
        for (const ward of states.wards) this._drawWard(ward);
        this._key = key;
        // Pinned-UI camera filters need to learn about new world objects.
        scene._cameraFilterDirty = true;
      },
      { scene },
    );
  }

  /** Enemy-phase start: the words, then the calls (engine/Vigil.js). */
  async processPhase() {
    const scene = this.scene;
    const vigil = this.vigil;
    if (!scene || !vigil) return;
    const session = battleSession(scene);
    if (!isCurrentBattleSession(scene, session)) return;
    const spokenBefore = sanitizeVigilState(scene._vigilState).byVoice;
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

    // The domain first, in one go and before anything is drawn: the state, every called Hollowed
    // on the roster with its battle identity (as the harness's _processVigil), and the history's
    // record of each call. A drawing that fails below costs only that drawing: never a Hollowed
    // left off the roster (the turn guard would never call it again) nor the enemy phase.
    scene._vigilState = step.state;
    for (const { unit } of step.summons) {
      registerBattleEntity(scene, unit);
      scene.enemyUnits.push(unit);
    }
    for (const { unit, voiceId } of step.summons)
      observeHistoryAction(scene, 'called', voiceUnit(voiceId, scene.enemyUnits), unit);
    if (step.summons.length > 0) scene.dangerZoneStale = true;
    // The Voices' wards from the state just kept: a circle broken this phase may drop one.
    const wards = applyVigilWards(vigil, scene._vigilState, scene.enemyUnits);

    // Then the presentation, each piece in its own boundary.
    for (const { unit } of step.summons) drawArrivalGraphic(scene, unit, 'vigil summon');
    if (step.summons.length > 0) {
      if (scene.grid?.fogEnabled)
        safeBattlePresentation('vigil fog', () => scene.updateEnemyVisibility?.(), { scene });
      safeBattlePresentation('vigil threats', () => scene._pinnedThreats?.invalidate?.(), {
        scene,
      });
    }
    this.sync();

    // A circle seen breaking, then any Voice seen losing its ward: before the words, as it
    // happened first.
    await this._presentBreaks(step.breaks || [], wards.dropped);
    if (!isCurrentBattleSession(scene, session)) return;

    const heardWords = step.words.filter((word) =>
      this.seesUnit(voiceUnit(word.voiceId, scene.enemyUnits)),
    );
    const seen = step.summons.map((s) => s.unit).filter((unit) => this.seesUnit(unit));
    // The notice bands first, then the court's lines: a line floats above its speaker, and a
    // Voice standing high on the board (an upright phone turns the ring) would put its line and
    // its name under a band still on screen.
    if (heardWords.length > 0) {
      await safeBattlePresentation(
        'vigil words',
        () => scene.showBriefBanner?.(VIGIL_BANNERS.words, UI_PALETTE.mark),
        { scene },
      );
      if (!isCurrentBattleSession(scene, session)) return;
    }
    if (seen.length > 0) {
      await safeBattlePresentation(
        'vigil call',
        async () => {
          await scene.showBriefBanner?.(VIGIL_BANNERS.call, UI_PALETTE.rarityEpic);
          if (!isCurrentBattleSession(scene, session)) return;
          // Each rising in its own boundary: one that fails (a Hollowed whose graphic never
          // drew) never cuts the others short.
          await Promise.all(
            seen.map((unit) =>
              safeBattlePresentation('vigil rise', () => this._fx()?.raise?.(unit), { scene }),
            ),
          );
        },
        { scene },
      );
      if (!isCurrentBattleSession(scene, session)) return;
    }
    if (heardWords.length > 0) {
      safeBattlePresentation('vigil voices', () => this._sayWords(heardWords, spokenBefore), {
        scene,
      });
    }
    if (seen.length > 0) {
      // The first seen answers the roll, by how many the circles had called before it.
      const first = step.summons.findIndex((s) => s.unit === seen[0]);
      const ordinal = step.state.summoned - step.summons.length + first;
      safeBattlePresentation(
        'vigil call line',
        () => this._say(seen[0], vigilCallLine(this.words, ordinal), { delayMs: 0 }),
        { scene },
      );
    }
    safeBattlePresentation('vigil objective', () => scene.updateObjectiveText?.(), { scene });
  }

  /** A Voice fell at `tile` (already off the roster): its circle is closed for good. */
  async onVoiceFell(unit, tile = { col: unit?.col, row: unit?.row }) {
    const scene = this.scene;
    if (!scene) return;
    const session = battleSession(scene);
    // Which fall this is, read now, as the Voice leaves the roster and before anything awaits:
    // only Voices already off the roster count (voicesFallen), never one an area art has also
    // dropped to 0 HP and removeUnit has yet to take, so of two felled by one strike the first
    // removed is the first fall.
    const fallen = voicesFallen(scene.battleConfig?.vigil, scene.enemyUnits);
    // The domain before anything is drawn: a Voice's fall may lift the Waking's choir ward.
    const wards = applyVigilWards(scene.battleConfig?.vigil, scene._vigilState, scene.enemyUnits);
    this.sync();
    if (!isUnitSeenAt(scene.grid, unit, tile.col, tile.row)) {
      await this._presentBreaks([], wards.dropped);
      return;
    }
    // The cue is heard only for a fall the player saw (as the banner): sound tells no secrets.
    void playCue(scene, VOICE_SILENCED_CUE, { duck: 0.3 });
    await safeBattlePresentation(
      'vigil silenced',
      () => scene.showBriefBanner?.(VIGIL_BANNERS.silenced, UI_PALETTE.muted),
      { scene },
    );
    if (!isCurrentBattleSession(scene, session)) return;
    // Its last line. The first Voice to fall gets the dialogue box (auto-dismissing, as a
    // commander's last words); each later one says its line over the spot it fell, short and
    // never awaited, so four falls in a turn do not stack four boxes. "First" is the roster's:
    // no Voice had left it before this one (voicesFallen counts it), so a resume or a rewind to
    // before that fall chooses as it did the first time.
    const line = vigilSilencedLine(this.words, unit?.authoredId);
    if (!line) return;
    if (fallen > 1) {
      safeBattlePresentation(
        'vigil last line',
        () => this._beats()?.speakOver(unit, line, { foe: true, tile }),
        { scene },
      );
      return;
    }
    if (scene.dialogueOverlay) {
      await safeBattlePresentation(
        'vigil last line',
        () => scene.dialogueOverlay.show(unit.name, line, scene._getPortraitKey?.(unit) ?? null),
        { scene },
      );
      if (!isCurrentBattleSession(scene, session)) return;
    }
    await this._presentBreaks([], wards.dropped);
  }

  /**
   * Present what the shields lost (state already settled): each circle seen breaking (a banner
   * once, the shatter sound, a burst on the seal) and each Voice seen whose ward fell ("Ward
   * broken" over it). Presentation only, each piece in its own boundary.
   */
  async _presentBreaks(breaks, dropped) {
    const scene = this.scene;
    if (!scene) return;
    const seenBreaks = (breaks || []).filter((b) => this.seesTile(b.col, b.row));
    const seenDropped = (dropped || []).filter((voice) => this.seesUnit(voice));
    if (seenBreaks.length === 0 && seenDropped.length === 0) return;
    const session = battleSession(scene);
    safeBattlePresentation(
      'vigil ward sound',
      () => scene.registry?.get?.('audio')?.playSFX?.(WARD_BREAK_SFX),
      { scene },
    );
    for (const brk of seenBreaks)
      safeBattlePresentation('vigil shatter', () => this._shatterAt(brk.col, brk.row), { scene });
    for (const voice of seenDropped) {
      safeBattlePresentation(
        'vigil ward falls',
        () => {
          this._shatterAt(voice.col, voice.row);
          const pos = scene.grid?.gridToPixel?.(voice.col, voice.row);
          if (pos) scene.showMinorHintAt?.(pos.x, pos.y - 24, WARD_FALLS_LINE, UI_PALETTE.info);
        },
        { scene },
      );
    }
    if (seenBreaks.length > 0) {
      await safeBattlePresentation(
        'vigil broken',
        () => scene.showBriefBanner?.(VIGIL_BANNERS.broken, UI_PALETTE.info),
        { scene },
      );
      if (!isCurrentBattleSession(scene, session)) return;
    }
  }

  /**
   * Shards flying off a tile: eight short strokes thrown outward and faded. Seeded geometry (no
   * Math.random); under Reduce motion it is skipped (the marker's own change says it).
   */
  _shatterAt(col, row) {
    const scene = this.scene;
    if (!scene?.grid?.gridToPixel || !scene.add?.graphics || this._reduced()) return;
    const { x, y } = scene.grid.gridToPixel(col, row);
    const shards = [];
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4 + ((col * 7 + row * 13 + i * 5) % 9) * 0.07;
      const g = scene.add.graphics();
      g.setDepth?.(UI_DEPTHS.WARD);
      g.lineStyle?.(2, UI_HEX.info, 1);
      g.lineBetween?.(0, 0, Math.cos(a) * 5, Math.sin(a) * 5);
      g.setPosition?.(x, y);
      shards.push(g);
      scene.tweens?.add?.({
        targets: g,
        x: x + Math.cos(a) * (TILE_SIZE * 0.75),
        y: y + Math.sin(a) * (TILE_SIZE * 0.75),
        alpha: 0,
        duration: 420,
        ease: 'Cubic.easeOut',
        onComplete: () => g.destroy?.(),
      });
    }
    scene._cameraFilterDirty = true;
    if (!scene.tweens?.add) for (const g of shards) g.destroy?.();
  }

  /** Each heard Voice says what it spoke this phase over itself, one after another. */
  _sayWords(words, spokenBefore) {
    const said = vigilSpokenWords(words, spokenBefore, this.words);
    said.forEach(({ voiceId, text }, i) => {
      this._say(voiceUnit(voiceId, this.scene?.enemyUnits), text, { delayMs: i * WORD_STAGGER_MS });
    });
  }

  /** One short line over a foe; presentation only, never awaited. */
  _say(unit, text, { delayMs = 0 } = {}) {
    if (!unit || !text) return;
    const speak = () => {
      if (!this.scene) return;
      this._beats()?.speakOver(unit, text, { foe: true, holdMs: WORD_HOLD_MS });
    };
    if (delayMs > 0 && this.scene?.time?.delayedCall) this.scene.time.delayedCall(delayMs, speak);
    else speak();
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

  /**
   * A sigil: a diamond on the tile. Lit (its Voice stands on it): filled, in the court's violet,
   * with a bracket at each corner. Empty: a hollow dark socket in pale outline, no brackets.
   * Silent (its Voice fell): a faint socket struck through. The Waking's has a second, inner
   * diamond in gold in every state it is not silent.
   */
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
      const lit = sigil.state === 'lit';
      const silent = sigil.state === 'silent';
      const tone = lit ? UI_HEX.mark : silent ? UI_HEX.mutedDim : UI_HEX.parchment;
      const alpha = lit ? 1 : silent ? 0.6 : 0.9;
      const half = TILE_SIZE / 2 - MARKER_INSET;
      const diamond = (r) => [
        { x, y: y - r },
        { x: x + r, y },
        { x, y: y + r },
        { x: x - r, y },
      ];
      // The body: a filled violet diamond when lit, a dark socket when not.
      g.fillStyle?.(lit ? UI_HEX.rarityEpic : UI_HEX.void, lit ? 0.5 : silent ? 0.4 : 0.55);
      g.fillPoints?.(diamond(half), true);
      underlaid(g, 2.5, tone, alpha, () => g.strokePoints?.(diamond(half), true));
      if (sigil.waking && !silent)
        underlaid(g, 1.5, UI_HEX.accent, lit ? 1 : 0.85, () =>
          g.strokePoints?.(diamond(half - WAKING_GAP), true),
        );
      if (lit) {
        // Corner brackets: the part of the tile a unit on the sigil leaves in view.
        const reach = TILE_SIZE / 2 - 1;
        const arm = 7;
        underlaid(g, 2, UI_HEX.parchment, 1, () => {
          for (const [sx, sy] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ]) {
            g.lineBetween?.(x + sx * reach, y + sy * reach, x + sx * (reach - arm), y + sy * reach);
            g.lineBetween?.(x + sx * reach, y + sy * reach, x + sx * reach, y + sy * (reach - arm));
          }
        });
      }
      if (silent)
        underlaid(g, 2, UI_HEX.mutedDim, 0.7, () => {
          g.lineBetween?.(x - half / 2, y - half / 2, x + half / 2, y + half / 2);
          g.lineBetween?.(x + half / 2, y - half / 2, x - half / 2, y + half / 2);
        });
      this.objects.push(g);
      if (lit) this._pulse([g], 0.6);
    } catch {
      /* cosmetic only */
    }
  }

  /**
   * A summoning circle: a round seal. Open: a solid ring and an inner ring joined by eight
   * spokes, filled violet. Blocked (a unit stands on it): a dashed ring in green. Broken: the
   * ring in four arcs with a crack across. Closed (its Voice fell): a thin faint ring struck
   * through.
   */
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
      const r = TILE_SIZE / 2 - MARKER_INSET;
      const inner = r - 6;
      if (circle.state === 'open') {
        g.fillStyle?.(UI_HEX.rarityEpic, 0.4);
        g.fillCircle?.(x, y, r);
        underlaid(g, 2.5, UI_HEX.mark, 1, () => g.strokeCircle?.(x, y, r));
        underlaid(g, 1.5, UI_HEX.mark, 0.95, () => {
          g.strokeCircle?.(x, y, inner);
          for (let i = 0; i < 8; i++) {
            const a = (i * Math.PI) / 4;
            g.lineBetween?.(
              x + Math.cos(a) * inner,
              y + Math.sin(a) * inner,
              x + Math.cos(a) * r,
              y + Math.sin(a) * r,
            );
          }
        });
        this._pulse([g], 0.6);
      } else if (circle.state === 'covered') {
        g.fillStyle?.(UI_HEX.void, 0.35);
        g.fillCircle?.(x, y, r);
        underlaid(g, 2.5, UI_HEX.good, 1, () => {
          const step = (Math.PI * 2) / CIRCLE_DASHES;
          for (let i = 0; i < CIRCLE_DASHES; i++) {
            g.beginPath?.();
            g.arc?.(x, y, r, i * step, i * step + step * 0.55, false);
            g.strokePath?.();
          }
        });
      } else if (circle.state === 'broken') {
        // Shattered: the ring in four arcs with gaps, a crack across, no spokes.
        g.fillStyle?.(UI_HEX.void, 0.3);
        g.fillCircle?.(x, y, r);
        underlaid(g, 2, UI_HEX.info, 0.8, () => {
          for (let i = 0; i < 4; i++) {
            const a0 = (i * Math.PI) / 2 + 0.25;
            g.beginPath?.();
            g.arc?.(x, y, r, a0, a0 + Math.PI / 2 - 0.5, false);
            g.strokePath?.();
          }
          g.lineBetween?.(x - r * 0.6, y - r * 0.2, x - r * 0.05, y + r * 0.1);
          g.lineBetween?.(x - r * 0.05, y + r * 0.1, x + r * 0.6, y - r * 0.3);
        });
      } else {
        g.fillStyle?.(UI_HEX.void, 0.35);
        g.fillCircle?.(x, y, r);
        underlaid(g, 1.5, UI_HEX.lineDim, 0.7, () => {
          g.strokeCircle?.(x, y, r);
          g.lineBetween?.(x - r / 2, y - r / 2, x + r / 2, y + r / 2);
          g.lineBetween?.(x + r / 2, y - r / 2, x - r / 2, y + r / 2);
        });
      }
      this.objects.push(g);
    } catch {
      /* cosmetic only */
    }
  }

  /**
   * A Voice's ward: a pale hexagon around its tile, over the sprite but faint enough to see it
   * through. Held by a circle: one ring. Held by the choir alone (the Waking with its circle
   * broken): two rings, the inner in the Waking's gold.
   */
  _drawWard(ward) {
    const scene = this.scene;
    if (!scene?.grid?.gridToPixel) return;
    const { x, y } = scene.grid.gridToPixel(ward.col, ward.row);
    this.shown.wards.push({ ...ward, x, y });
    if (!scene.add?.graphics) return;
    try {
      const g = scene.add.graphics();
      g.setDepth?.(UI_DEPTHS.WARD);
      g.name = `vigil-ward-${ward.state}`;
      const hex = (r) =>
        Array.from({ length: 6 }, (_, i) => {
          const a = Math.PI / 6 + (i * Math.PI) / 3;
          return { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r };
        });
      const r = TILE_SIZE / 2 + 1;
      g.fillStyle?.(UI_HEX.info, 0.14);
      g.fillPoints?.(hex(r), true);
      underlaid(g, 1.5, UI_HEX.info, 0.95, () => g.strokePoints?.(hex(r), true));
      if (ward.state === 'choir' || ward.choir)
        underlaid(g, 1.5, UI_HEX.accent, 0.95, () => g.strokePoints?.(hex(r - 4), true));
      this.objects.push(g);
      this._pulse([g], 0.55);
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
    this.shown = { sigils: [], circles: [], wards: [] };
  }
}

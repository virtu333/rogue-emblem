// PrologueController — extracted from BattleScene (CLAUDE.md: create(scene) / destroy()).
//
// Owns a prologue chapter's teaching while the battle runs (docs/specs/prologue-chapter.md
// §9): the coach (PrologueCoach), the guided-step gates, the highlights, the field notes
// and the spoken lines, all driven by the chapter's authored beats through
// `prologueBeatsFor` (engine/Prologue.js). The scene feeds it events from small hooks
// (unit selected, moved, forecast opened, combat resolved, action ending, phase start,
// level-up, holders woke, unit defeated, victory) and asks it two things: whether an
// input is allowed right now, and what to do when the commander falls.
//
// A beat's actions apply in two passes: gates, the coach goal, highlights and the lesson
// ledger at once, then its notes and lines one at a time, so what a note points at is on
// screen while it shows. Notes are modal "Field notes" (battleState TUTORIAL_HINT, the
// rail inert); on the enemy phase a note is a coach nudge instead, and a note raised at
// a phase start waits until the player can act.
//
// Two modes (engine/ScriptedBattle.js). In the prologue run (scene.runManager, mode
// 'prologue') the chapter is a node of a real run: notes mark the slot's hints, a won
// chapter records its practised lessons on the slot's meta, and a named unit's fall
// restarts the chapter from its entry (RunManager.restartPrologueBattle) after an
// unspent Vision charge, if any, was offered. Standalone (the title's replay, no
// RunManager) nothing is saved: a fall rebuilds the authored roster and restarts the
// scene. In both, the "Not this thread" line plays and onDefeat is never reached.

import {
  prologueBeatsFor,
  forecastConcepts,
  buildPrologueRoster,
  prologueProtectedNames,
} from '../engine/Prologue.js';
import { isStandaloneScriptedBattle, prologueChapterOf } from '../engine/ScriptedBattle.js';
import { finishPrologue, offerSkipRetry } from './PrologueEnding.js';
import { prologueBattleLaunchData } from '../utils/firstRunFastPath.js';
import {
  computeDangerTiles,
  enemyThreatTiles,
  isThreatSourceVisible,
} from '../engine/ThreatForecast.js';
import { DangerZoneOverlay } from './DangerZoneOverlay.js';
import { PrologueCoach } from './PrologueCoach.js';
import {
  NOTE_HINT_IDS,
  PROLOGUE_NOTE_ACTIONS,
  prologueCoachGoal,
  prologueHandoff,
  prologueNoteText,
  prologueNudgeText,
} from '../data/prologueContent.js';
import { recordTaughtLessons } from './prologueLessons.js';
import { showImportantHint } from './HintDisplay.js';
import { hasDOMHost } from '../utils/domUI.js';
import { transitionToScene, restartScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { TILE_SIZE } from '../utils/constants.js';
import { gridDistance } from '../engine/Combat.js';
import { UI_HEX } from '../utils/uiStyles.js';
import { battleSession, isCurrentBattleSession } from './BattleSession.js';

// States where the pause menu (and so the chapter's exits) can open safely.
const PAUSABLE_STATES = new Set(['PLAYER_IDLE', 'UNIT_SELECTED', 'UNIT_ACTION_MENU']);
// The battle state a modal note holds (input and the rail wait on it).
export const PROLOGUE_NOTE_STATE = 'TUTORIAL_HINT';
const UNIT_RING = 0x4aa3ff;
const SYNC_ACTIONS = [
  'coach',
  'gateSelect',
  'gateMove',
  'gateConfirm',
  'highlight',
  'markLesson',
  'grantVision',
  'clearCoach',
];
// Notes raised here wait for a playable player turn (the phase banner, turn-start effects).
const DEFERRED_EVENTS = new Set(['battleStart', 'turnStart']);

export class PrologueController {
  constructor(scene) {
    this.scene = scene;
    this.chapter = prologueChapterOf(scene.battleParams, scene.gameData);
    // The prologue run this chapter belongs to, or null for a standalone replay.
    this.run = isStandaloneScriptedBattle(scene.battleParams, scene.runManager)
      ? null
      : scene.runManager || null;
    // Names whose fall restarts the chapter (every unit of its roster, and the commander).
    this.protectedNames = new Set(prologueProtectedNames(this.chapter, scene.gameData));
    this.beatState = { fired: [] };
    // { kind: 'select', unit } | { kind: 'move', col, row } | { kind: 'confirm' } | null
    this.gate = null;
    this.gatesSkipped = false;
    this.coachGoal = null; // the live guided step's coach id (prologueContent)
    this.taught = new Set(); // HintManager ids whose notes were shown
    this.lessons = { shown: new Set(), practised: new Set() }; // the markLesson ledger
    this.forecastCount = 0;
    this.hpSeen = new Map(); // unit name -> HP % last seen; hpBelow fires on a change
    this.markers = [];
    this.reach = null;
    this.anchorMarker = null;
    this.anchorKey = '';
    this.lessonOpen = false;
    this.activeLessonId = null;
    this.notes = Promise.resolve(); // notes show one at a time, in order
    this.deferred = [];
    this.blockingPromptActive = false;
    this.started = false;
    this.restarting = false;
    this.offeredRewind = false;
    this.rewound = false; // a Vision rewind was spent this battle (afterRewind beats)
    this.leaving = null;
    this.coach = null;
    this.created = false;
    this.destroyed = false;
  }

  create() {
    if (this.created || this.destroyed) return this;
    this.created = true;
    const scene = this.scene;
    for (const unit of scene.playerUnits || []) this.hpSeen.set(unit.name, this.hpPct(unit));
    if (hasDOMHost()) {
      this.coach = new PrologueCoach(scene, {
        onLeave: () => this.requestLeave(),
        onSkipStep: () => this.skipStep(),
        scripted: () => this.scripted(),
        gated: () => this.isGateActive(),
        onAnchor: (anchor) => this.markAnchor(anchor),
        leaveLabel: this.run ? 'Skip' : 'Leave',
        leaveAria: this.run ? 'Skip the rest of the prologue' : 'Leave prologue',
      });
    }
    this._tick = () => this.flushDeferred();
    scene.events?.on?.('update', this._tick);
    return this;
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events?.off?.('update', this._tick);
    this.deferred = [];
    this.clearHighlights();
    this.reach?.destroy?.();
    this.reach = null;
    this.coach?.destroy();
    this.coach = null;
  }

  // --- Beats -----------------------------------------------------------------------

  /** The chapter's actions for an event (the beat state advances; `once` beats spend). */
  match(event, options = {}) {
    if (this.destroyed || !this.chapter) return [];
    const { actions, state } = prologueBeatsFor(this.chapter, event, this.beatState, options);
    this.beatState = state;
    return actions;
  }

  /** Match and run. Resolves true when a note or a line held the screen. */
  emit(event, extra = {}, options = {}) {
    const actions = this.match(event, options);
    return actions.length ? this.runActions(actions, event, extra) : Promise.resolve(false);
  }

  async runActions(actions, event = {}, extra = {}) {
    let held = false;
    const sync = actions.filter((a) => SYNC_ACTIONS.some((key) => key in a));
    const blocking = actions.filter((a) => 'note' in a || 'dialogue' in a);
    for (const action of sync) this.applySync(action);
    for (const action of blocking) {
      if (this.destroyed) break;
      if ('note' in action) held = (await this.note(action.note, event, extra)) || held;
      else held = (await this.dialogue(action.dialogue)) || held;
    }
    return held;
  }

  applySync(action) {
    if ('coach' in action) this.coachGoal = action.coach;
    else if ('gateSelect' in action) this.setGate({ kind: 'select', unit: action.gateSelect.unit });
    else if ('gateMove' in action)
      this.setGate({ kind: 'move', col: action.gateMove.col, row: action.gateMove.row });
    else if ('gateConfirm' in action) this.setGate({ kind: 'confirm' });
    else if ('highlight' in action) this.highlight(action.highlight);
    else if ('markLesson' in action) {
      const { id, kind } = action.markLesson;
      (kind === 'practised' ? this.lessons.practised : this.lessons.shown).add(id);
    } else if ('grantVision' in action) this.grantVision();
    else if ('clearCoach' in action) {
      if (!this.gate) this.coachGoal = null;
    }
  }

  /**
   * P3's exercise: the prologue's one Vision charge. In the run it is the run's charge
   * (RunManager.grantPrologueVision: once per run, saved with the next checkpoint);
   * standalone, the scene's own store gets it once. Returns true when granted.
   */
  grantVision() {
    const scene = this.scene;
    let granted = false;
    if (this.run) granted = Boolean(this.run.grantPrologueVision?.());
    else if (!this.standaloneVisionGranted) {
      const host = (scene._standaloneVisionState ||= { visionChargesRemaining: 0, visionCount: 0 });
      host.visionChargesRemaining += 1;
      this.standaloneVisionGranted = true;
      granted = true;
    }
    if (granted) {
      try {
        scene.updateVisionHud?.();
      } catch {
        /* presentation only */
      }
    }
    return granted;
  }

  // --- Gates and the coach ---------------------------------------------------------

  setGate(gate) {
    if (this.gatesSkipped) return;
    this.gate = gate;
    this.scene.refreshEndTurnControl?.();
  }

  /** The guided step's gate blocks free play (select or move); a confirm gate only cycling. */
  isGateActive() {
    return Boolean(
      !this.destroyed &&
      !this.gatesSkipped &&
      (this.gate?.kind === 'select' || this.gate?.kind === 'move'),
    );
  }

  allowsSelect(unit) {
    if (!this.isGateActive() || this.gate.kind !== 'select') return true;
    return Boolean(unit && unit.name === this.gate.unit);
  }

  allowsMoveTo(col, row) {
    if (!this.isGateActive() || this.gate.kind !== 'move') return true;
    return col === this.gate.col && row === this.gate.row;
  }

  /** The first forecast: only Confirm or Cancel, no weapon or target cycling. */
  allowsForecastCycling() {
    return this.destroyed || this.gatesSkipped || this.gate?.kind !== 'confirm';
  }

  /** The step's goal is done: the gate lifts, its goal and highlights go. */
  releaseGate() {
    this.gate = null;
    this.coachGoal = null;
    this.clearMarkers();
    this.scene.refreshEndTurnControl?.();
  }

  /** Release the guided steps (Skip step) and play freely. */
  skipStep() {
    if (this.destroyed || this.gatesSkipped) return false;
    if (this.scene.battleState === PROLOGUE_NOTE_STATE) return false;
    this.gatesSkipped = true;
    this.releaseGate();
    this.scene._mobileBattleHud?.sync?.();
    this.coach?.reveal();
    return true;
  }

  /** The live guided step's coach goal (prologueContent), or null. */
  scripted() {
    return this.coachGoal ? prologueCoachGoal(this.coachGoal, this.ctx()) : null;
  }

  rejectSelect() {
    return this.nudge('gate_select');
  }

  rejectMove() {
    return this.nudge('gate_move');
  }

  rejectStep() {
    return this.nudge('gate_step');
  }

  /** A correction: a coach nudge, or (canvas builds) a blocking note. */
  nudge(id) {
    const text = prologueNudgeText(id, this.ctx());
    if (!text) return false;
    if (this.coach?.nudge(text)) {
      this.scene.refreshEndTurnControl?.();
      return true;
    }
    void this.blockingInstruction(text);
    return true;
  }

  async blockingInstruction(text) {
    const scene = this.scene;
    if (this.blockingPromptActive) return false;
    this.blockingPromptActive = true;
    try {
      await this.withHintState(() => showImportantHint(scene, text));
    } finally {
      this.blockingPromptActive = false;
      scene.refreshEndTurnControl?.();
    }
    return true;
  }

  ctx(extra = {}) {
    const scene = this.scene;
    const commander = (scene.playerUnits || []).find((u) => u?.isCommander);
    const veteran = (scene.playerUnits || []).find((u) => u?.specialCharId);
    return {
      touch: Boolean(scene.isMobileInput),
      lord: commander?.name || 'Edric',
      veteran: veteran?.name || 'Gaspar',
      npc: this.chapter?.npc?.unit || null,
      npcClass: this.chapter?.npc?.className || null,
      ally: this.mostHurtAlly()?.name || null,
      gateTile: this.gate?.kind === 'move' ? { col: this.gate.col, row: this.gate.row } : null,
      ...extra,
    };
  }

  // --- Notes and lines -------------------------------------------------------------

  /**
   * A field note by id (prologueContent). Marks the in-run hints it stands in for as
   * taught. On the enemy phase it is a coach nudge; raised at a phase start it waits for
   * a playable turn; otherwise it shows now and resolves when read (false on shutdown).
   */
  note(id, event = {}, extra = {}) {
    const text = prologueNoteText(id, this.ctx(extra.ctx));
    if (!text) return Promise.resolve(false);
    for (const hint of NOTE_HINT_IDS[id] || []) {
      this.taught.add(hint);
      // In the run the slot is real: the in-run note this one stands in for is read.
      if (this.run) this.scene.registry?.get?.('hints')?.markSeen?.(hint);
    }
    if (event.type === 'turnStart' && event.phase === 'enemy') {
      const line = text.replace(/\s*\n\s*/g, ' ');
      if (!this.coach?.nudge(line, 'info')) void this.scene.showBriefBanner?.(line);
      return Promise.resolve(true);
    }
    const run = () => this.showNote(id, text);
    return DEFERRED_EVENTS.has(event.type) ? this.defer(run) : run();
  }

  /** The most hurt living player unit (lowest HP %), or null when nobody is hurt. */
  mostHurtAlly(exclude = null) {
    let best = null;
    for (const unit of this.scene.playerUnits || []) {
      if (unit === exclude) continue;
      if (!(unit?.currentHP > 0) || !(unit.currentHP < unit.stats?.HP)) continue;
      if (!best || this.hpPct(unit) < this.hpPct(best)) best = unit;
    }
    return best;
  }

  /** True while any living player unit is below full HP. */
  anyHurt() {
    return Boolean(this.mostHurtAlly());
  }

  async showNote(id, text) {
    const scene = this.scene;
    if (!this.sceneLive()) return false;
    const previous = this.notes;
    let release;
    this.notes = new Promise((resolve) => (release = resolve));
    await previous;
    try {
      if (!this.sceneLive()) return false;
      this.lessonOpen = true;
      this.activeLessonId = id;
      const result = await this.withHintState(() => this.fieldNote(text, id));
      return result !== false && this.sceneLive();
    } finally {
      this.lessonOpen = false;
      this.activeLessonId = null;
      release();
      scene.refreshEndTurnControl?.();
    }
  }

  /** A Field note with Continue, plus a way out (choosing it opens the confirmation). */
  async fieldNote(message, id = null) {
    const scene = this.scene;
    const extra = (id && PROLOGUE_NOTE_ACTIONS[id]) || [];
    const actions = hasDOMHost()
      ? [
          ...extra.map((a) => ({ ...a, primary: true })),
          { label: 'Continue', value: true, primary: !extra.length },
          { label: this.run ? 'Skip prologue' : 'Leave prologue', value: 'leave' },
        ]
      : null;
    const result = actions
      ? await showImportantHint(scene, message, { actions })
      : await showImportantHint(scene, message);
    if (result === 'leave') setTimeout(() => this.requestLeave(), 0);
    // The rewind exercise: the note opens Rewind once its battle state is back.
    if (result === 'rewind') setTimeout(() => this.openRewind(), 0);
    return result;
  }

  /** Open the Rewind surface (the exercise's button); false when it can't open now. */
  openRewind() {
    if (this.destroyed || !this.sceneLive()) return false;
    try {
      return Boolean(this.scene.requestVisionRewind?.());
    } catch {
      return false;
    }
  }

  async withHintState(fn) {
    const scene = this.scene;
    const prevState = scene.battleState;
    scene.battleState = PROLOGUE_NOTE_STATE;
    try {
      return await fn();
    } finally {
      if (
        !this.destroyed &&
        !scene._sceneShutdownCleanedUp &&
        scene.sys?.isActive?.() !== false &&
        scene.battleState === PROLOGUE_NOTE_STATE
      ) {
        scene.battleState = prevState;
      }
    }
  }

  defer(run) {
    return new Promise((resolve) => {
      this.deferred.push(() => run().then(resolve, () => resolve(false)));
    });
  }

  /** Each frame: a deferred note shows once the player can act. */
  flushDeferred() {
    if (!this.deferred.length || this.lessonOpen || this.destroyed) return;
    const scene = this.scene;
    if (
      scene.battleState !== 'PLAYER_IDLE' ||
      scene.turnManager?.currentPhase === 'enemy' ||
      scene.isStoryInputLocked?.()
    )
      return;
    const next = this.deferred.shift();
    next();
  }

  /** A dialogue.json `prologue` line set, spoken through the scene's overlay. */
  async dialogue(key) {
    const scene = this.scene;
    const entries = scene.gameData?.dialogue?.prologue?.[key];
    if (!Array.isArray(entries) || !entries.length || !scene.dialogueOverlay) return false;
    const sequence = entries.map((entry) => ({
      speaker: entry?.speaker || null,
      line: entry?.line || '',
      portrait: this.portraitFor(entry?.speaker),
    }));
    try {
      await scene.dialogueOverlay.showSequence(sequence, { category: 'prologue', key });
    } catch {
      /* a line is presentation: the chapter goes on without it */
    }
    return true;
  }

  /** A speaker's face: a unit on the field, or a special character (Gaspar) by name. */
  portraitFor(name) {
    if (!name || name === '???') return null;
    const scene = this.scene;
    const onField = [
      ...(scene.playerUnits || []),
      ...(scene.npcUnits || []),
      ...(scene.enemyUnits || []),
    ].find((u) => u?.name === name);
    const special = (scene.gameData?.specialChars || []).find((s) => s?.name === name);
    const unit =
      onField ||
      (special
        ? { name, className: special.class, faction: 'player', specialCharId: special.id }
        : null);
    return unit ? scene._getPortraitKey?.(unit) || null : null;
  }

  sceneLive() {
    const scene = this.scene;
    return Boolean(
      !this.destroyed && !scene._sceneShutdownCleanedUp && scene.sys?.isActive?.() !== false,
    );
  }

  // --- Hooks from the scene --------------------------------------------------------

  unitKey(unit) {
    return unit?.authoredId || unit?.name || null;
  }

  turn() {
    return this.scene.turnManager?.turnNumber ?? 1;
  }

  /**
   * A phase begins. The first player phase raises `battleStart` at once (the gate is
   * live from the first frame) and reveals the coach once the banner clears, through
   * the phase's guarded runner (`schedule(delayMs, key, fn)`).
   */
  onPhaseStart(phase, turn, { schedule = null } = {}) {
    if (this.destroyed) return;
    this.clearHighlights();
    if (phase === 'player' && !this.started) {
      this.started = true;
      // battleStart belongs to turn 1 of a fresh battle only: a scene that comes up
      // later (a resume without teaching state) never replays the opening.
      if (turn === 1) void this.emit({ type: 'battleStart' });
      const reveal = async () => this.coach?.reveal();
      if (schedule) schedule(1500, 'prologue_coach_reveal', reveal);
      else void reveal();
    }
    void this.emit({ type: 'turnStart', turn, phase, hurt: this.anyHurt() });
  }

  // --- Suspend and resume ------------------------------------------------------------

  /**
   * The teaching state a suspend checkpoint carries (BattleSuspendController), so a
   * Resume Battle or a rotation's re-open continues the chapter where it was: the
   * spent beats, the guided step (gate and goal), the lesson ledger.
   */
  snapshot() {
    return {
      version: 1,
      started: this.started,
      fired: [...(this.beatState?.fired || [])],
      gatesSkipped: this.gatesSkipped,
      gate: this.gate ? { ...this.gate } : null,
      coachGoal: this.coachGoal,
      forecastCount: this.forecastCount,
      taught: [...this.taught],
      shown: [...this.lessons.shown],
      practised: [...this.lessons.practised],
      rewound: this.rewound,
      standaloneVisionGranted: Boolean(this.standaloneVisionGranted),
    };
  }

  /**
   * A resumed battle (Resume Battle, a rotation's re-open): restore the teaching state
   * the checkpoint carried, then reveal the coach. A checkpoint without one (saved
   * before this existed) resumes as a started chapter: nothing replays. A checkpoint
   * from before the opening ran (turn 1, nothing fired) opens it now, since no phase
   * start will.
   */
  onResume(state, { turn = 1, phase = 'player' } = {}) {
    if (this.destroyed) return;
    const valid = state && typeof state === 'object' && state.version === 1;
    if (valid) {
      this.started = state.started === true;
      this.beatState = { fired: Array.isArray(state.fired) ? [...state.fired] : [] };
      this.gatesSkipped = state.gatesSkipped === true;
      this.gate = state.gate && typeof state.gate === 'object' ? { ...state.gate } : null;
      this.coachGoal = typeof state.coachGoal === 'string' ? state.coachGoal : null;
      this.forecastCount = Number.isInteger(state.forecastCount) ? state.forecastCount : 0;
      this.taught = new Set(Array.isArray(state.taught) ? state.taught : []);
      this.lessons = {
        shown: new Set(Array.isArray(state.shown) ? state.shown : []),
        practised: new Set(Array.isArray(state.practised) ? state.practised : []),
      };
      this.rewound = state.rewound === true;
      this.standaloneVisionGranted = state.standaloneVisionGranted === true;
    } else {
      this.started = true;
    }
    for (const unit of this.scene.playerUnits || []) this.hpSeen.set(unit.name, this.hpPct(unit));
    if (!this.started && phase === 'player' && turn === 1) {
      this.started = true;
      void this.emit({ type: 'battleStart' });
    }
    this.started = true;
    // The guided step's tile ring comes back with its gate.
    if (this.gate?.kind === 'move') this.markTile(this.gate.col, this.gate.row, UI_HEX.accent);
    if (this.gate?.kind === 'select') this.highlight({ unit: this.gate.unit });
    this.scene.refreshEndTurnControl?.();
    this.coach?.reveal();
  }

  onUnitSelected(unit) {
    if (this.destroyed || unit?.faction !== 'player') return;
    if (this.gate?.kind === 'select' && unit.name === this.gate.unit) this.releaseGate();
    this.clearReach();
    const ally = this.mostHurtAlly(unit);
    void this.emit(
      { type: 'unitSelected', unit: unit.name, turn: this.turn(), hurt: Boolean(ally) },
      { ctx: { ally: ally?.name || null } },
    );
  }

  /** A player unit finished moving (before its action). Resolves once its notes are read. */
  onAfterMove(unit) {
    if (this.destroyed || unit?.faction !== 'player') return Promise.resolve(false);
    const scene = this.scene;
    if (this.gate?.kind === 'move' && unit.col === this.gate.col && unit.row === this.gate.row)
      this.releaseGate();
    const terrain = scene.grid?.getTerrainAt?.(unit.col, unit.row) || null;
    const dangerFrom = this.dangerSources(unit.col, unit.row);
    const event = {
      type: 'afterMove',
      unit: unit.name,
      tile: { col: unit.col, row: unit.row },
      terrain: terrain?.name || null,
      dangerFrom,
      turn: this.turn(),
      inRange: this.foeInReach(unit),
      foeDistances: this.foeDistances(unit),
      besideAlly: this.besideAlly(unit),
      afterRewind: this.rewound,
    };
    // One concept per decision: the first note that matches shows, the rest wait.
    const actions = this.match(event, { oneNote: true });
    if (!actions.length) return Promise.resolve(false);
    if (actions.some((a) => a.note === 'battle_terrain')) {
      // The preview shows the arrived tile before the note points at it.
      scene._mobileTerrainFocus = { col: unit.col, row: unit.row };
      scene._inputController?.refreshTileInfo?.(unit.col, unit.row);
      scene._mobileBattleHud?.sync?.();
    }
    return this.runActions(actions, event, {
      ctx: { terrain, count: dangerFrom.length, unit: unit.name },
    });
  }

  /** A foe the unit could attack from where it stands (its weapons' reach). */
  foeInReach(unit) {
    try {
      const targets = this.scene.findAttackTargets?.(unit);
      return Array.isArray(targets) && targets.length > 0;
    } catch {
      return false;
    }
  }

  /** The unit's distance to every foe the player can see. */
  foeDistances(unit) {
    const grid = this.scene.grid;
    return (this.scene.enemyUnits || [])
      .filter((e) => e?.currentHP > 0 && (!grid?.fogEnabled || grid.isVisible?.(e.col, e.row)))
      .map((e) => gridDistance(unit.col, unit.row, e.col, e.row));
  }

  /** Another player unit stands next to it. */
  besideAlly(unit) {
    return (this.scene.playerUnits || []).some(
      (u) => u !== unit && u?.currentHP > 0 && gridDistance(u.col, u.row, unit.col, unit.row) === 1,
    );
  }

  /** Enemy ids whose Danger tiles (what the player knows) hold a tile. */
  dangerSources(col, row) {
    const scene = this.scene;
    const ctx = scene.threatContext?.();
    if (!ctx?.grid) return [];
    const key = `${col},${row}`;
    let positions = null;
    const out = [];
    for (const enemy of scene.enemyUnits || []) {
      if (!isThreatSourceVisible(ctx.grid, enemy)) continue;
      positions ||= ctx.positions();
      if (enemyThreatTiles(ctx, enemy, positions).damage.has(key)) out.push(this.unitKey(enemy));
    }
    return out;
  }

  /**
   * An attack forecast opened (not a re-render). Resolves once its notes are read.
   * One concept per forecast: only the first note beat that matches fires here, the
   * others wait for a later forecast (prologueBeatsFor's oneNote).
   */
  onForecastOpened(attacker, defender, forecast, weapon = null) {
    if (this.destroyed || attacker?.faction !== 'player') return Promise.resolve(false);
    this.forecastCount += 1;
    return this.emit(
      {
        type: 'forecastOpened',
        unit: attacker.name,
        target: this.unitKey(defender),
        nth: this.forecastCount,
        concepts: forecastConcepts(forecast, { weapon }),
        turn: this.turn(),
      },
      {},
      { oneNote: true },
    );
  }

  onForecastClosed() {
    if (this.gate?.kind === 'confirm') this.gate = null;
  }

  /**
   * A combat resolved (HP applied, before deaths are removed). A player-started combat
   * raises `combatResolved`; a player unit whose HP changed raises `hpBelow`.
   */
  async onCombatResolved(attacker, defender, { initiator = 'player' } = {}) {
    if (this.destroyed) return false;
    let held = false;
    if (initiator === 'player' && attacker?.faction === 'player') {
      held = await this.emit({
        type: 'combatResolved',
        unit: attacker.name,
        target: this.unitKey(defender),
        turn: this.turn(),
        kill: Boolean(defender) && !(defender.currentHP > 0),
      });
    }
    for (const unit of [attacker, defender]) {
      if (unit?.faction !== 'player' || !(unit.currentHP > 0)) continue;
      held = (await this.checkHp(unit)) || held;
    }
    return held;
  }

  hpPct(unit) {
    const max = Number(unit?.stats?.HP) || 0;
    if (max <= 0) return 100;
    return Math.round((100 * (Number(unit.currentHP) || 0)) / max);
  }

  checkHp(unit) {
    const pct = this.hpPct(unit);
    const last = this.hpSeen.get(unit.name);
    this.hpSeen.set(unit.name, pct);
    if (last === pct) return Promise.resolve(false);
    return this.emit(
      { type: 'hpBelow', unit: unit.name, hpPct: pct },
      { ctx: { consumable: (unit.consumables || [])[0] || null } },
    );
  }

  /**
   * A player unit's action is about to complete (Wait, an attack...). Returns a promise
   * when a note holds the completion until it is read, else null.
   */
  beforeUnitActionCompletes(unit) {
    if (this.destroyed || unit?.faction !== 'player') return null;
    const event = { type: 'unitActed', unit: unit.name, turn: this.turn() };
    const actions = this.match(event);
    if (!actions.length) return null;
    const promise = this.runActions(actions, event);
    return actions.some((a) => 'note' in a || 'dialogue' in a) ? promise : null;
  }

  /** A Talk resolved (the recruit joined and its card closed). Resolves once its notes are read. */
  onTalk(lord, npc) {
    if (this.destroyed || !lord || !npc) return Promise.resolve(false);
    for (const unit of this.scene.playerUnits || []) this.hpSeen.set(unit.name, this.hpPct(unit));
    return this.emit({ type: 'talk', unit: lord.name, target: this.unitKey(npc) });
  }

  /** A staff heal resolved. Resolves once its notes are read. */
  onHealed(healer, target) {
    if (this.destroyed || !healer) return Promise.resolve(false);
    return this.emit({ type: 'healed', unit: healer.name, target: this.unitKey(target) });
  }

  /** The authored line an NPC's Talk card reads (chapter.npc.line), or null. */
  talkLine(npc) {
    const key = this.chapter?.npc?.unit === npc?.name ? this.chapter?.npc?.line : null;
    const entries = key ? this.scene.gameData?.dialogue?.prologue?.[key] : null;
    const line = Array.isArray(entries) ? entries[0]?.line : null;
    return typeof line === 'string' && line ? line : null;
  }

  /**
   * A Vision rewind was spent and the board restored. The exercise watches the next
   * move (afterRewind); the fall that offered the charge is forgotten, so a later
   * fall offers a remaining charge again.
   */
  onRewound() {
    if (this.destroyed) return Promise.resolve(false);
    this.rewound = true;
    this.offeredRewind = false;
    this.restarting = false;
    this.scene._prologueFallen = null;
    this.deferred = [];
    this.clearHighlights();
    return this.emit({ type: 'rewound' });
  }

  /** A level-up card closed. Resolves once its note is read. */
  onLevelUp(unit) {
    if (this.destroyed || unit?.faction !== 'player') return Promise.resolve(false);
    return this.emit({ type: 'levelUp', unit: unit.name });
  }

  /** Holding enemies left their post ({ unit } entries). */
  async onHoldersWoke(woken) {
    if (this.destroyed) return false;
    let held = false;
    for (const { unit } of woken || []) {
      held = (await this.emit({ type: 'holdWoken', unit: this.unitKey(unit) })) || held;
    }
    return held;
  }

  /**
   * A unit fell. A protected player unit (every named unit of the chapter: the
   * commander, Gaspar, later Sera and Tamsin) restarts the chapter as the commander's
   * fall does; checkBattleEnd never sees a non-commander's fall.
   */
  onUnitDefeated(unit) {
    if (this.destroyed || !unit) return;
    void this.emit({ type: 'unitDefeated', unit: this.unitKey(unit) });
    // Sera is protected green or blue: her fall as an NPC restarts the chapter too.
    if ((unit.faction === 'player' || unit.faction === 'npc') && this.isProtected(unit))
      this.onDefeatIntercept({ fallen: unit });
  }

  isProtected(unit) {
    return Boolean(unit && (unit.isCommander || this.protectedNames.has(unit.name)));
  }

  /**
   * A protected unit fell. Never a settled defeat: in the run, an unspent Vision
   * charge is offered first (the lord-death prompt; its Accept Fate comes back here
   * through onDefeat); then the screen is held, the "Not this thread" line plays, and
   * the chapter restarts from its entry. Returns true (the fall is handled).
   * @param {{ fallen?: object, accepted?: boolean }} [options] - `accepted`: the rewind
   *   was declined (or none could be offered), restart now
   */
  onDefeatIntercept({ fallen = null, accepted = false } = {}) {
    const scene = this.scene;
    if (this.destroyed) return false;
    if (this.restarting) return true;
    if (fallen && !fallen.isCommander) {
      // The fate prompt names whoever fell; the commander's identity is never touched
      // (a later prompt or fatal checkpoint must still name the commander).
      scene._prologueFallen = { name: fallen.name, className: fallen.className, epithet: null };
    }
    if (!accepted && this.run && !this.offeredRewind && this.canOfferRewind()) {
      this.offeredRewind = true;
      if (scene.showLordDeathVisionPrompt?.()) return true;
    }
    this.restarting = true;
    const session = battleSession(scene);
    scene._reinforcementsPendingThisTurn = false;
    // Ends the enemy phase (phaseSuperseded) and closes input while the line plays.
    scene.battleState = 'BATTLE_END';
    this.deferred = [];
    this.clearHighlights();
    try {
      scene.clearInspectionVisuals?.();
      scene.hideActionMenu?.();
      scene.dangerZone?.hide?.();
    } catch {
      /* presentation only */
    }
    void (async () => {
      await this.dialogue('not_this_thread');
      if (!isCurrentBattleSession(scene, session) || !this.sceneLive()) return;
      this.restartChapter();
    })();
    return true;
  }

  /** An unspent Vision charge the run could offer against the fall. */
  canOfferRewind() {
    const scene = this.scene;
    try {
      return Number(scene.getVisionChargesRemaining?.()) > 0;
    } catch {
      return false;
    }
  }

  /**
   * Re-enter the chapter from its start. In the run: the battle's entry state is
   * restored (the roster never changed; the convoy, gold, Vision and RNG come back from
   * the entry snapshot, a fatal checkpoint included), the save is rewritten without the
   * battle flag, and the node re-opens from its locked config. Standalone: the same
   * params with freshly built authored units.
   */
  restartChapter() {
    const scene = this.scene;
    const gameData = scene.gameData;
    const session = battleSession(scene);
    if (this.run) {
      const rm = this.run;
      const nodeId = rm.battleInProgress?.nodeId || scene.nodeId;
      const node = rm.nodeMap?.nodes?.find((n) => n.id === nodeId);
      rm.restartPrologueBattle();
      scene._fatalDecision = null;
      scene._fatalCapturePending = false;
      scene._defeatDecision = null;
      scene._pendingCommittedAction = null;
      scene._persistBattleRunState?.(null, { session });
      if (!node) return false;
      return restartScene(scene, prologueBattleLaunchData(rm, node, gameData), {
        reason: TRANSITION_REASONS.RETRY,
      });
    }
    const roster = buildPrologueRoster(gameData.prologue, gameData, this.chapter);
    return restartScene(
      scene,
      { gameData, roster, battleParams: { ...scene.battleParams } },
      { reason: TRANSITION_REASONS.RETRY },
    );
  }

  /**
   * The chapter is won (after the victory band): its last lines and notes. In the run
   * the records land on the slot (the practised lessons, the chapter) and the device
   * (the lessons shown), and the run's own victory flow goes on (loot, the route map,
   * the ending). Standalone: the record, then the handoff to the title.
   */
  async onVictory() {
    const scene = this.scene;
    const session = battleSession(scene);
    const live = () => isCurrentBattleSession(scene, session) && this.sceneLive();
    if (!live()) return;
    this.clearHighlights();
    await this.emit({ type: 'victory' });
    if (!live()) return;
    this.taught.add('battle_first_turn');
    if (this.run) {
      this.recordChapterWon();
      return;
    }
    await showImportantHint(
      scene,
      prologueHandoff({ title: this.chapter?.title || 'The prologue' }),
      {
        actions: [{ label: 'Back to title', value: 'title', primary: true }],
      },
    );
    if (!live()) return;
    this.recordCompletion();
    return this.leave('title');
  }

  // --- Records ---------------------------------------------------------------------

  /** The device-wide completion flag and the lessons actually shown (never a slot write). */
  recordCompletion() {
    return recordTaughtLessons(this.taught);
  }

  /** The run: the chapter and its practised lessons on the slot's meta, the lessons on the device. */
  recordChapterWon() {
    const meta = this.scene.registry?.get?.('meta');
    if (this.chapter?.id) meta?.recordPrologueChapter?.(this.chapter.id);
    if (this.lessons.practised.size) meta?.recordProloguePractised?.([...this.lessons.practised]);
    recordTaughtLessons(this.taught);
  }

  // --- Exits -----------------------------------------------------------------------

  canPause() {
    const scene = this.scene;
    return Boolean(
      !this.destroyed &&
      !scene._sceneShutdownCleanedUp &&
      PAUSABLE_STATES.has(scene.battleState) &&
      scene.turnManager?.currentPhase !== 'enemy' &&
      !scene.visionDialog &&
      !scene.isStoryInputLocked?.(),
    );
  }

  /**
   * Pause menu exits. The run: "Skip the rest of the prologue" (the ending, then Home
   * Base with the grant); the run's own Save & Return stays. Standalone: Leave
   * Prologue (nothing to save).
   */
  pauseOptions() {
    const title = this.chapter?.title || null;
    if (this.run) return { title, onSkipRest: () => this.skipRest() };
    return { title, onLeave: () => this.leave('title') };
  }

  /** Skip the rest of the prologue from this battle: the ending, then Home Base. */
  skipRest() {
    if (this.leaving) return this.leaving;
    const scene = this.scene;
    const resumeState = PAUSABLE_STATES.has(scene.battleState) ? scene.battleState : 'PLAYER_IDLE';
    scene._reinforcementsPendingThisTurn = false;
    scene.battleState = 'BATTLE_END';
    this.deferred = [];
    this.clearHighlights();
    this.coach?.hide?.();
    this.leaving = finishPrologue(scene, {
      taught: this.taught,
      practised: this.lessons.practised,
      onCommitFailed: () => {},
    }).then((started) => {
      if (started || this.destroyed || !this.sceneLive()) return started;
      // Nothing left: the chapter is playable again, and the skip can be retried.
      this.leaving = null;
      scene.battleState = resumeState;
      this.coach?.reveal();
      scene.refreshEndTurnControl?.();
      return offerSkipRetry(scene, () => this.skipRest());
    });
    return this.leaving;
  }

  /** Open the pause menu straight onto the exit confirmation (leave, or skip the rest). */
  requestLeave() {
    const scene = this.scene;
    if (!scene.pauseOverlay?.visible) {
      if (!this.canPause()) {
        this.coach?.nudge(prologueNudgeText('gate_pause', this.ctx()));
        return false;
      }
      scene.showPauseMenu();
    }
    return Boolean(scene.pauseOverlay?.requestLeavePrologue?.());
  }

  /** Leave a standalone chapter for the title. Nothing is saved. */
  leave() {
    if (this.leaving) return this.leaving;
    this.coach?.destroy();
    this.coach = null;
    this.leaving = this.transitionToTitle(null);
    return this.leaving;
  }

  transitionToTitle(extra = null) {
    const scene = this.scene;
    const audio = scene.registry?.get?.('audio');
    if (audio) audio.releaseMusic(scene, 0);
    return transitionToScene(
      scene,
      'Title',
      { gameData: scene.gameData, ...(extra || {}) },
      { reason: TRANSITION_REASONS.BACK },
    );
  }

  // --- Highlights ------------------------------------------------------------------

  highlight(spec) {
    const scene = this.scene;
    if ('tile' in spec) this.markTile(spec.tile.col, spec.tile.row, UI_HEX.accent);
    else if ('unit' in spec) {
      const unit = [...(scene.playerUnits || []), ...(scene.npcUnits || [])].find(
        (u) => u?.name === spec.unit,
      );
      if (unit) this.markTile(unit.col, unit.row, UNIT_RING);
    } else if ('reachOf' in spec) this.showReach(spec.reachOf);
  }

  drawRing(col, row, color) {
    const scene = this.scene;
    if (!scene.grid?.gridToPixel || !scene.add?.rectangle) return null;
    const pos = scene.grid.gridToPixel(col, row);
    const marker = scene.add
      .rectangle(pos.x, pos.y, TILE_SIZE - 2, TILE_SIZE - 2, 0x000000, 0)
      .setStrokeStyle(2, color, 1)
      .setDepth(52);
    if (!scene._reduceMotion?.()) {
      scene.tweens?.add?.({
        targets: marker,
        alpha: { from: 0.45, to: 1 },
        duration: 450,
        yoyo: true,
        repeat: -1,
      });
    }
    return marker;
  }

  markTile(col, row, color) {
    const marker = this.drawRing(col, row, color);
    if (marker) this.markers.push(marker);
  }

  /** An enemy's Danger tiles (what the player knows), as a focus overlay. */
  showReach(enemyId) {
    const scene = this.scene;
    const enemy = (scene.enemyUnits || []).find((u) => this.unitKey(u) === enemyId);
    if (!enemy || !scene.grid || !scene.threatContext) return;
    const tiles = computeDangerTiles(scene.threatContext(), { onlyEnemy: enemy });
    this.reach ||= new DangerZoneOverlay(scene, scene.grid, { variant: 'focus', depth: 4.5 });
    this.reach.show(tiles);
  }

  /** The coach's unit anchor outside the guided steps: a gold ring on that unit's tile. */
  markAnchor(anchor) {
    const scene = this.scene;
    const unit =
      anchor?.kind === 'unit'
        ? (scene.playerUnits || []).find((u) => u?.name === anchor.name) || null
        : null;
    const key = unit ? `${unit.name}@${unit.col},${unit.row}` : '';
    if (key === this.anchorKey) return;
    this.anchorKey = key;
    this.anchorMarker?.destroy?.();
    this.anchorMarker = unit ? this.drawRing(unit.col, unit.row, UI_HEX.accent) : null;
  }

  clearMarkers() {
    for (const marker of this.markers) marker?.destroy?.();
    this.markers = [];
  }

  clearReach() {
    this.reach?.hide?.();
  }

  clearHighlights() {
    this.clearMarkers();
    this.clearReach();
    this.markAnchor(null);
  }
}

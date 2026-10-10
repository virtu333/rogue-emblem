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
// rail inert): a chapter's few core lessons, at their decision points. Tips are the
// reinforcement (docs/specs/prologue-chapter.md §2): non-blocking, docked beside the map
// (PrologueTip) or, raised by a forecast, a line in its notes; they mark the hints they
// stand in for only once read. On the enemy phase a note or a tip is a coach nudge, and
// one raised at a phase start waits until the player can act.
//
// The Guidance setting (engine/Guidance.js prologueGuidanceAllows, read live, so a change
// in Settings mid-chapter applies to what comes next): Full shows everything, Light no
// tips, Off no tips, no field notes and no guided steps (as Skip step). The spoken lines,
// the coach's goal line and the exits always stay.
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
import { guidanceLevelOf } from './guidanceGate.js';
import { prologueGuidanceAllows } from '../engine/Guidance.js';
import { showPrologueTip, tipText } from './PrologueTip.js';
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
const DEFERRED_EVENTS = new Set(['battleStart', 'turnStart', 'deployed']);
// A tip raised by these is about one unit's moment: it steps aside (unread, unless it
// was already read) when that unit moves again or acts, another unit is selected, or
// the phase changes. Other tips stay until read, dismissed or replaced.
const SCOPED_TIP_EVENTS = new Set(['afterMove', 'unitSelected']);
// The unit's own planning (GuidanceController's UNIT_TURN_STATES): a scoped tip holds
// only while its unit is selected in one of these, on the player phase.
const TIP_SCOPE_STATES = new Set(['UNIT_SELECTED', 'UNIT_MOVING', 'UNIT_ACTION_MENU']);

/** The unit's first consumable that restores HP (a Vulnerary, an Elixir), or null. */
function healingItem(unit) {
  return (
    (unit?.consumables || []).find((c) => c && (c.effect === 'heal' || c.effect === 'healFull')) ||
    null
  );
}

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
    // Who damaged which foe this battle: foe key -> Set of player unit names
    // (combatResolved's damagedBy: P2's chip-then-finish needs Gaspar's chip first).
    // Saved with the snapshot. foeHpSeen backs it when a caller gives no hpBefore.
    this.damaged = new Map();
    this.foeHpSeen = new Map();
    this.markers = [];
    this.reach = null;
    this.anchorMarker = null;
    this.anchorKey = '';
    this.lessonOpen = false;
    this.activeLessonId = null;
    this.notes = Promise.resolve(); // notes show one at a time, in order
    // Notes and line sets not yet read, in order: { seq, beat, kind, id, text, event,
    // status: 'scheduled' | 'displayed' }. Data, so a suspend checkpoint carries
    // them (snapshot) and a resume shows them again (onResume) instead of counting
    // them as taught; a record leaves the list when the player acknowledges it.
    this.pending = [];
    this.pendingSeq = 0;
    this.deferred = []; // { run, resolve, cancelled, ready }: tasks waiting for a playable turn
    // Presentation on screen now (a note, a line set, a nudge note): the scene's
    // turn-start pipeline waits for idle() before it reads the battle state.
    this.presenting = 0;
    this.idleWaiters = [];
    this.blockingPromptActive = false;
    // The non-blocking tip on screen ({ close, isRead, onClose }) and the unit it is
    // about (a scoped tip), or null.
    this.tipHandle = null;
    this.tipScope = null;
    // A forecast's tip: { id, text }, a line in the open forecast's notes until it
    // closes (read when the player confirms or cancels). `prepared` is the forecast's
    // matched beats, taken before it renders (prepareForecast) so the tip is drawn in.
    this.forecastTip = null;
    this.prepared = null;
    this.openForecast = null; // the open forecast's two units, for forecastCancelled
    this.started = false;
    this.restarting = false;
    this.offeredRewind = false;
    this.rewound = false; // a Vision rewind was spent this battle (afterRewind beats)
    this.leaving = null;
    // An exit asked for where the confirmation can't open yet (flushLeave opens it).
    this.leaveQueued = false;
    this.coach = null;
    this.created = false;
    this.destroyed = false;
  }

  create() {
    if (this.created || this.destroyed) return this;
    this.created = true;
    const scene = this.scene;
    for (const unit of scene.playerUnits || []) this.hpSeen.set(unit.name, this.hpPct(unit));
    this.seedFoeHp();
    // The deploy screen's note (P4) was read before this controller existed.
    for (const id of scene._prologueDeployTaught || []) this.taught.add(id);
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
    this._tick = () => {
      this.syncTip();
      // A queued exit first: the player asked to leave; a deferred note can wait.
      this.flushLeave();
      this.flushDeferred();
    };
    scene.events?.on?.('update', this._tick);
    // The deploy screen was confirmed before this controller existed (P4's deploy
    // lesson is practised by that choice, never by the battle merely starting; an
    // auto-deploy or a resumed battle confirms nothing).
    const deployed = scene._deployConfirmation;
    // Read once: a controller made again on this scene confirms nothing new.
    scene._deployConfirmation = null;
    if (deployed && typeof deployed === 'object')
      void this.emit({ type: 'deployed', count: Number(deployed.count) || 0 });
    return this;
  }

  /** The foes' HP as last seen (the damage ledger's fallback when no hpBefore is given). */
  seedFoeHp() {
    for (const foe of this.scene.enemyUnits || [])
      this.foeHpSeen.set(this.unitKey(foe), Number(foe.currentHP) || 0);
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.scene.events?.off?.('update', this._tick);
    this.cancelDeferred();
    this.pending = [];
    this.presenting = 0;
    this.releaseIdle();
    this.closeTip();
    this.forecastTip = null;
    this.prepared = null;
    this.openForecast = null;
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
    // A Danger reach drawn for a beat's note or tip (reachOf) explains nothing once the
    // Guidance setting hides that teaching: it goes with it.
    const teaches = (a) => 'note' in a || 'tip' in a;
    const shows = (a) => ('note' in a && this.allows('note')) || ('tip' in a && this.allows('tip'));
    const teachingBeats = new Set(actions.filter(teaches).map((a) => a.beat));
    const shownBeats = new Set(actions.filter(shows).map((a) => a.beat));
    const reachHidden = (a) =>
      Boolean(a.highlight?.reachOf) && teachingBeats.has(a.beat) && !shownBeats.has(a.beat);
    const sync = actions.filter((a) => SYNC_ACTIONS.some((key) => key in a) && !reachHidden(a));
    const blocking = actions.filter((a) => 'note' in a || 'dialogue' in a);
    // Tips never hold anything: after the beat's notes and lines (a tip that follows
    // a line shows once the line is read), and never awaited.
    const tips = actions.filter((a) => 'tip' in a);
    for (const action of sync) this.applySync(action);
    const showTips = () => {
      for (const action of tips) this.tip(action.tip, event, extra, action.beat || null);
    };
    if (!blocking.length) {
      showTips();
      return false;
    }
    // A sequence raised now (not one whose notes wait for a playable turn) owns the
    // screen from its first line to its last note: between them nothing of the
    // scene's reads the battle state (idle()).
    const owns = !DEFERRED_EVENTS.has(event.type);
    // The whole sequence is pending from the start (a checkpoint taken under its
    // first line carries the notes behind it), then each piece shows in order.
    const records = blocking.map(
      (action) =>
      'note' in action
        ? this.scheduleNote(action.note, event, extra, action.beat || null)
        : this.schedule({ kind: 'dialogue', id: action.dialogue, text: null, beat: action.beat || null, event: null }), // prettier-ignore
    );
    if (owns) this.beginPresentation();
    try {
      for (const record of records) {
        if (this.destroyed) break;
        if (!record) continue;
        if (record.kind === 'note') held = (await this.presentNote(record)) || held;
        else held = (await this.dialogue(record.id, record.beat, record)) || held;
      }
    } finally {
      if (owns) this.endPresentation();
    }
    if (!this.destroyed) showTips();
    return held;
  }

  // --- Presentation ownership ----------------------------------------------------
  //
  // Every hook the scene calls returns a promise that settles once the beat's notes
  // and lines are read (or at once when nothing shows). The scene awaits it through
  // safeBattlePresentation at the point the beat belongs to (a fall before the death's
  // side effects, a move before its action menu, a combat before its casualties leave),
  // so a blocking sequence owns that interval of the simulation. What is on screen
  // right now is counted here, so a pipeline that must read the battle state (the
  // player turn start) can wait for idle() instead of mistaking a note's TUTORIAL_HINT
  // state for a superseded turn.

  beginPresentation() {
    this.presenting += 1;
  }

  endPresentation() {
    this.presenting = Math.max(0, this.presenting - 1);
    if (this.presenting === 0) this.releaseIdle();
  }

  releaseIdle() {
    const waiters = this.idleWaiters;
    this.idleWaiters = [];
    for (const resolve of waiters) resolve();
  }

  /** Resolves once nothing of the chapter's is on screen (at once when idle or destroyed). */
  idle() {
    if (this.destroyed || this.presenting === 0) return Promise.resolve();
    return new Promise((resolve) => this.idleWaiters.push(resolve));
  }

  /** True while a note or a line set is on screen. */
  isPresenting() {
    return !this.destroyed && this.presenting > 0;
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

  /** The Guidance setting lets this kind ('tip' | 'note' | 'guided') show now. */
  allows(kind) {
    return prologueGuidanceAllows(guidanceLevelOf(this.scene), kind);
  }

  // --- Gates and the coach ---------------------------------------------------------

  setGate(gate) {
    // Skipped steps stay skipped: a later step's goal (set by its beat just before its
    // gate) goes with the gate, so no goal is left that nothing can complete or clear.
    // Guidance Off plays the chapter as if every guided step were skipped.
    if (this.gatesSkipped || !this.allows('guided')) {
      this.coachGoal = null;
      return;
    }
    this.gate = gate;
    this.scene.refreshEndTurnControl?.();
  }

  /** The guided step's gate blocks free play (select or move); a confirm gate only cycling. */
  isGateActive() {
    return Boolean(
      !this.destroyed &&
      !this.gatesSkipped &&
      (this.gate?.kind === 'select' || this.gate?.kind === 'move') &&
      this.allows('guided'),
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
    return (
      this.destroyed || this.gatesSkipped || this.gate?.kind !== 'confirm' || !this.allows('guided')
    );
  }

  /** The step's goal is done: the gate lifts, its goal and highlights go. */
  releaseGate() {
    this.gate = null;
    this.coachGoal = null;
    this.clearMarkers();
    this.scene.refreshEndTurnControl?.();
  }

  /**
   * Release the guided steps (Skip step) and play freely. It always dismisses the goal
   * on screen, also one set after an earlier skip (a gateless goal such as P3's).
   */
  skipStep() {
    if (this.destroyed) return false;
    if (this.scene.battleState === PROLOGUE_NOTE_STATE) return false;
    if (this.gatesSkipped && !this.gate && !this.coachGoal) return false;
    this.gatesSkipped = true;
    this.releaseGate();
    this.scene._mobileBattleHud?.sync?.();
    this.coach?.reveal();
    return true;
  }

  /** The live guided step's coach goal (prologueContent), or null. */
  scripted() {
    // A guided step's goal goes with its gate once Guidance is Off (set Off mid-step).
    if (this.gate && !this.allows('guided')) return null;
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
    this.beginPresentation();
    try {
      await this.withHintState(() => showImportantHint(scene, text));
    } finally {
      this.blockingPromptActive = false;
      this.endPresentation();
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
      // P4: the boss the chapter names, and the par its note explains.
      boss: (this.chapter?.enemies || []).find((e) => e?.isBoss)?.name || null,
      par: Number.isFinite(scene.turnPar) ? scene.turnPar : null,
      ...extra,
    };
  }

  // --- Notes and lines -------------------------------------------------------------

  /**
   * A field note by id (prologueContent). Marks the in-run hints it stands in for as
   * taught. On the enemy phase it is a coach nudge; raised at a phase start it waits for
   * a playable turn; otherwise it shows now and resolves when read (false on shutdown).
   */
  note(id, event = {}, extra = {}, beat = null) {
    const record = this.scheduleNote(id, event, extra, beat);
    return record ? this.presentNote(record) : Promise.resolve(false);
  }

  /**
   * Schedule a note: its text is fixed now (the context it points at is on screen
   * now). On the enemy phase it is a coach nudge, shown at once and never pending.
   * Returns the pending record, or null when nothing is left to show.
   */
  scheduleNote(id, event = {}, extra = {}, beat = null) {
    if (!this.allows('note')) return null;
    const text = prologueNoteText(id, this.ctx(extra.ctx));
    if (!text) return null;
    if (event.type === 'turnStart' && event.phase === 'enemy') {
      // A nudge is never acknowledged: shown is read.
      this.markTaught(id);
      const line = text.replace(/\s*\n\s*/g, ' ');
      if (!this.coach?.nudge(line, 'info')) void this.scene.showBriefBanner?.(line);
      return null;
    }
    return this.schedule({
      kind: 'note',
      id,
      text,
      beat,
      event: { type: event.type || null, phase: event.phase ?? null, turn: event.turn ?? null },
    });
  }

  /** Show a scheduled note: now, or (raised at a phase start) once the player can act. */
  presentNote(record) {
    const run = () => this.showNote(record);
    return DEFERRED_EVENTS.has(record.event?.type) ? this.defer(run) : run();
  }

  /**
   * The in-run hints a note stands in for are read (NOTE_HINT_IDS): on the device's
   * record at the chapter's end, and in the run on the slot now. Only an acknowledged
   * note (Continue pressed) or a nudge marks them: a note the checkpoint caught
   * scheduled or on screen is shown again on resume, and marks them then.
   */
  markTaught(id) {
    for (const hint of NOTE_HINT_IDS[id] || []) {
      this.taught.add(hint);
      if (this.run) this.scene.registry?.get?.('hints')?.markSeen?.(hint);
    }
  }

  // --- Tips (non-blocking reinforcement) ------------------------------------------

  /**
   * A tip by id (prologueContent). Never holds input or the simulation. On the enemy
   * phase it is a coach nudge (shown is read); raised by a forecast it is a line in
   * that forecast's notes; raised at a phase start it waits for a playable turn;
   * otherwise it docks beside the map now. Returns true when something will show.
   */
  tip(id, event = {}, extra = {}, beat = null) {
    if (this.destroyed || !this.allows('tip')) return false;
    const text = prologueNoteText(id, this.ctx(extra.ctx));
    if (!text) return false;
    if (event.type === 'turnStart' && event.phase === 'enemy') {
      this.markTaught(id);
      const line = tipText(text);
      if (!this.coach?.nudge(line, 'info')) void this.scene.showBriefBanner?.(line);
      return true;
    }
    if (event.type === 'forecastOpened') {
      this.forecastTip = { id, text: tipText(text), beat };
      return true;
    }
    if (DEFERRED_EVENTS.has(event.type)) {
      // It waits for a playable turn, and for an unread tip already up (one raised in
      // the enemy phase, the Vulnerary's) to be read or to step aside: never replaces it.
      void this.defer(
        async () => {
          this.openTip(id, text, event);
          return false;
        },
        { ready: () => !this.unreadTipOpen() },
      );
      return true;
    }
    return Boolean(this.openTip(id, text, event));
  }

  /** Dock a tip beside the map (one at a time: a new one replaces the last, unread). */
  openTip(id, text, event = {}) {
    if (!this.sceneLive() || !this.allows('tip')) return null;
    this.closeTip();
    const name = SCOPED_TIP_EVENTS.has(event.type) && event.unit ? event.unit : null;
    const unit = name ? (this.scene.playerUnits || []).find((u) => u?.name === name) : null;
    // A tip about a tile (afterMove) holds while the unit stands there.
    const scope = name
      ? { unit: name, tile: event.type === 'afterMove' && unit ? { col: unit.col, row: unit.row } : null } // prettier-ignore
      : null;
    const actions = (PROLOGUE_NOTE_ACTIONS[id] || []).map((a) => ({
      label: a.label,
      onClick: () => this.tipAction(a.value),
    }));
    const handle = showPrologueTip(this.scene, {
      id,
      text,
      unit,
      actions,
      onRead: () => {
        if (!this.destroyed) this.markTaught(id);
      },
    });
    if (!handle) return null;
    this.tipHandle = handle;
    this.tipScope = scope;
    handle.onClose = () => {
      if (this.tipHandle !== handle) return;
      this.tipHandle = null;
      this.tipScope = null;
    };
    return handle;
  }

  /** A tip's extra button (the rewind exercise's Open Rewind). */
  tipAction(value) {
    if (value === 'rewind') return this.openRewind();
    return false;
  }

  /**
   * Close the tip on screen (unread: only a tip already read keeps its mark). With
   * `unit`, only a tip scoped to that unit; with `scoped`, only a scoped one.
   */
  closeTip({ unit = null, scoped = false } = {}) {
    const handle = this.tipHandle;
    if (!handle) return false;
    if (unit && this.tipScope?.unit !== unit) return false;
    if (scoped && !this.tipScope) return false;
    this.tipHandle = null;
    this.tipScope = null;
    try {
      handle.close(false);
    } catch {
      /* presentation only */
    }
    return true;
  }

  /**
   * Each frame: a scoped tip steps aside once its unit's moment is over (the unit
   * deselected or acted, another state such as an open forecast, the enemy phase, or
   * Back to another tile), read or not, as GuidanceController's scoped notes do.
   */
  syncTip() {
    const scope = this.tipScope;
    if (!this.tipHandle || !scope) return;
    const s = this.scene;
    const unit = s.selectedUnit;
    const holds =
      unit?.name === scope.unit &&
      !unit.hasActed &&
      TIP_SCOPE_STATES.has(s.battleState) &&
      (s.turnManager?.currentPhase ?? 'player') === 'player' &&
      (!scope.tile || (unit.col === scope.tile.col && unit.row === scope.tile.row));
    if (!holds) this.closeTip();
  }

  /** The open forecast's tip line (AttackFlowController draws it in), or null. */
  forecastTipText() {
    return this.destroyed ? null : this.forecastTip?.text || null;
  }

  // --- Pending presentation (what a checkpoint carries) ----------------------------

  /** A note or a line set the player has not read yet, in order. */
  schedule(record) {
    const entry = { ...record, seq: ++this.pendingSeq, status: 'scheduled' };
    this.pending.push(entry);
    return entry;
  }

  /** The record was acknowledged (or settled): it leaves the pending list. */
  settlePending(record) {
    const index = this.pending.indexOf(record);
    if (index >= 0) this.pending.splice(index, 1);
  }

  /** The pending list as plain data (snapshot). */
  pendingRecords() {
    return this.pending.map((r) => ({
      beat: r.beat ?? null,
      kind: r.kind,
      id: r.id,
      text: r.kind === 'note' ? r.text : null,
      event: r.event ? { ...r.event } : null,
      status: r.status,
    }));
  }

  /**
   * A resume: the checkpoint's unread notes and lines show again, in order, once the
   * player can act, as one sequence. A line set replays whole (its lines are
   * presentation; the dialogue's seen-key is marked only when it completes); a note
   * shows with the text it had. Settled gameplay (the beats spent, the coach, the
   * gate, the lesson ledger, the Vision grant) is never replayed: it came back with
   * the snapshot.
   */
  resumePending(entries) {
    const records = entries
      .filter((e) => e && (e.kind === 'note' || e.kind === 'dialogue') && typeof e.id === 'string')
      .map((e) =>
        this.schedule({
          kind: e.kind,
          id: e.id,
          text: e.kind === 'note' ? (typeof e.text === 'string' && e.text) || null : null,
          beat: typeof e.beat === 'string' ? e.beat : null,
          event: e.event && typeof e.event === 'object' ? { ...e.event } : null,
        }),
      );
    if (!records.length) return;
    void this.defer(async () => {
      this.beginPresentation();
      try {
        for (const record of records) {
          if (this.destroyed) break;
          if (record.kind === 'dialogue') await this.dialogue(record.id, record.beat, record);
          else await this.showNote(record);
        }
      } finally {
        this.endPresentation();
      }
      return true;
    });
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

  /**
   * Show a pending note (one at a time, in order). Resolves true once the player
   * acknowledged it: only then are the hints it stands in for marked read and the
   * record settled. A note torn down unread (a shutdown mid-note resolves false)
   * stays pending, 'displayed', for the next checkpoint and resume.
   */
  async showNote(record) {
    const scene = this.scene;
    if (!this.sceneLive()) return false;
    // Guidance set Off after it was scheduled (or a resume's pending note): dropped
    // unread, so the lessons it stands in for stay unmarked.
    if (!this.allows('note')) {
      this.settlePending(record);
      return false;
    }
    const previous = this.notes;
    let release;
    this.notes = new Promise((resolve) => (release = resolve));
    await previous;
    try {
      if (!this.sceneLive()) return false;
      const id = record.id;
      const text = record.text || prologueNoteText(id, this.ctx());
      if (!text) {
        this.settlePending(record);
        return false;
      }
      record.text = text;
      record.status = 'displayed';
      // One thing on screen: a tip under a modal note is not being read.
      this.closeTip();
      this.lessonOpen = true;
      this.activeLessonId = id;
      this.beginPresentation();
      const result = await this.withHintState(() => this.fieldNote(text, id));
      const acknowledged = result !== false && this.sceneLive();
      if (acknowledged) {
        this.markTaught(id);
        this.settlePending(record);
      }
      return acknowledged;
    } finally {
      this.lessonOpen = false;
      this.activeLessonId = null;
      this.endPresentation();
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

  /**
   * Run `run` once the player can act (flushDeferred). The promise settles with
   * `run`'s result, or false when the task is cancelled (cancelDeferred: a restart, a
   * rewind, a skip, destroy) — a cancelled task never runs, so it can never touch a
   * replacement session.
   */
  defer(run, { ready = null } = {}) {
    return new Promise((resolve) => {
      this.deferred.push({ run, resolve, cancelled: false, ready });
    });
  }

  /** A tip is beside the map and the player has not read it yet. */
  unreadTipOpen() {
    const handle = this.tipHandle;
    if (!handle) return false;
    try {
      return !handle.isRead?.();
    } catch {
      return false;
    }
  }

  /** Settle every waiting task as cancelled (false) and drop it. */
  cancelDeferred() {
    const waiting = this.deferred;
    this.deferred = [];
    for (const entry of waiting) {
      entry.cancelled = true;
      entry.resolve(false);
    }
  }

  /** Each frame: a deferred note shows once the player can act. */
  flushDeferred() {
    if (!this.deferred.length || this.lessonOpen || this.presenting > 0 || this.destroyed) return;
    const scene = this.scene;
    if (
      scene.battleState !== 'PLAYER_IDLE' ||
      scene.turnManager?.currentPhase === 'enemy' ||
      scene.isStoryInputLocked?.()
    )
      return;
    // In order: the next task waits while its own condition holds it back.
    if (!this.deferred[0].cancelled && this.deferred[0].ready && !this.deferred[0].ready()) return;
    const next = this.deferred.shift();
    if (next.cancelled) return;
    let result;
    try {
      result = next.run();
    } catch {
      next.resolve(false);
      return;
    }
    Promise.resolve(result).then(next.resolve, () => next.resolve(false));
  }

  /**
   * A dialogue.json `prologue` line set, spoken through the scene's overlay. Pending
   * while it plays; a set torn down before its last line (the overlay reports it
   * incomplete) stays pending and replays whole on resume.
   */
  async dialogue(key, beat = null, record = null) {
    const scene = this.scene;
    const entries = scene.gameData?.dialogue?.prologue?.[key];
    if (!Array.isArray(entries) || !entries.length || !scene.dialogueOverlay) {
      if (record) this.settlePending(record);
      return false;
    }
    const sequence = entries.map((entry) => ({
      speaker: entry?.speaker || null,
      line: entry?.line || '',
      portrait: this.portraitFor(entry?.speaker),
    }));
    const pending = record || this.schedule({ kind: 'dialogue', id: key, text: null, beat, event: null }); // prettier-ignore
    pending.status = 'displayed';
    this.closeTip();
    this.beginPresentation();
    let completed = true;
    try {
      completed = await scene.dialogueOverlay.showSequence(sequence, { category: 'prologue', key });
    } catch {
      /* a line is presentation: the chapter goes on without it */
    } finally {
      this.endPresentation();
    }
    if (completed !== false && this.sceneLive()) this.settlePending(pending);
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
    this.closeTip({ scoped: true });
    if (phase === 'player' && !this.started) {
      this.started = true;
      // battleStart belongs to turn 1 of a fresh battle only: a scene that comes up
      // later (a resume without teaching state) never replays the opening.
      const opening = turn === 1 ? this.emit({ type: 'battleStart' }) : null;
      const reveal = async () => this.coach?.reveal();
      if (schedule) schedule(1500, 'prologue_coach_reveal', reveal);
      else void reveal();
      // An opening that holds the turn (lines, a note: P2, P3) outlasts the banner,
      // and the scheduled reveal, finding the battle busy, never runs: the coach
      // comes up when the opening ends instead.
      if (opening)
        void Promise.resolve(opening)
          .then((held) => {
            if (held && !this.destroyed) this.coach?.reveal();
          })
          .catch(() => {});
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
      version: 2,
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
      // Who damaged which foe (combatResolved's damagedBy), by foe key.
      damaged: [...this.damaged].map(([key, names]) => [key, [...names]]),
      // Unread teaching, as data: shown again on resume, never counted as taught.
      pending: this.pendingRecords(),
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
    const valid =
      state && typeof state === 'object' && (state.version === 1 || state.version === 2);
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
      this.damaged = new Map(
        (Array.isArray(state.damaged) ? state.damaged : [])
          .filter((e) => Array.isArray(e) && typeof e[0] === 'string' && Array.isArray(e[1]))
          .map(([key, names]) => [key, new Set(names.filter((n) => typeof n === 'string'))]),
      );
    } else {
      this.started = true;
    }
    for (const unit of this.scene.playerUnits || []) this.hpSeen.set(unit.name, this.hpPct(unit));
    this.seedFoeHp();
    if (!this.started && phase === 'player' && turn === 1) {
      this.started = true;
      void this.emit({ type: 'battleStart' });
    }
    this.started = true;
    // The guided step's tile ring comes back with its gate.
    if (this.gate?.kind === 'move') this.markTile(this.gate.col, this.gate.row, UI_HEX.accent);
    if (this.gate?.kind === 'select') this.highlight({ unit: this.gate.unit });
    // The checkpoint's unread notes and lines (version 2) show again, in order.
    if (valid && Array.isArray(state.pending)) this.resumePending(state.pending);
    this.scene.refreshEndTurnControl?.();
    this.coach?.reveal();
  }

  onUnitSelected(unit) {
    if (this.destroyed || unit?.faction !== 'player') return;
    if (this.tipScope && this.tipScope.unit !== unit.name) this.closeTip();
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
    // A tip about this unit's last tile steps aside: it stands somewhere else now.
    this.closeTip({ unit: unit.name });
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
    if (actions.some((a) => a.note === 'battle_terrain' || a.tip === 'battle_terrain')) {
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
    let prepared = this.prepared;
    this.prepared = null;
    if (!prepared || prepared.attacker !== attacker || prepared.defender !== defender) {
      this.prepareForecast(attacker, defender, forecast, weapon);
      prepared = this.prepared;
      this.prepared = null;
    }
    // The tip is already in the forecast's notes (prepareForecast); the rest runs now.
    const actions = (prepared?.actions || []).filter((a) => !('tip' in a));
    return actions.length ? this.runActions(actions, prepared.event) : Promise.resolve(false);
  }

  /**
   * A forecast is about to render (its first open, not a re-render): match its beats
   * now, so a beat's tip is drawn into the forecast's notes. One concept per forecast:
   * only the first beat that says something fires (oneNote). Returns the tip's line or
   * null; onForecastOpened then runs the beats' notes and the rest.
   */
  prepareForecast(attacker, defender, forecast, weapon = null) {
    this.prepared = null;
    this.openForecast = null;
    if (this.destroyed || attacker?.faction !== 'player') return null;
    this.forecastTip = null;
    this.forecastCount += 1;
    const event = {
      type: 'forecastOpened',
      unit: attacker.name,
      target: this.unitKey(defender),
      nth: this.forecastCount,
      concepts: forecastConcepts(forecast, { weapon }),
      turn: this.turn(),
      targetTerrain: this.scene.grid?.getTerrainAt?.(defender?.col, defender?.row)?.name || null,
    };
    const actions = this.match(event, { oneNote: true });
    this.prepared = { attacker, defender, event, actions };
    this.openForecast = { attacker, defender };
    for (const action of actions)
      if ('tip' in action) this.tip(action.tip, event, {}, action.beat || null);
    return this.forecastTipText();
  }

  /**
   * The forecast closed. `acknowledge`: the player confirmed or cancelled (having read
   * it), so its tip is read; End Turn, a rewind or a shutdown closes it unread.
   * `cancelled`: the player backed out, which raises `forecastCancelled` (P3's "open
   * it, then Cancel" step ends on it, from every cancel input).
   */
  onForecastClosed({ acknowledge = false, cancelled = false } = {}) {
    if (this.gate?.kind === 'confirm') this.gate = null;
    const tip = this.forecastTip;
    const open = this.openForecast;
    this.forecastTip = null;
    this.prepared = null;
    this.openForecast = null;
    if (tip && acknowledge && this.sceneLive()) this.markTaught(tip.id);
    if (cancelled && open && !this.destroyed && this.sceneLive()) {
      const event = {
        type: 'forecastCancelled',
        unit: open.attacker?.name,
        target: this.unitKey(open.defender),
        turn: this.turn(),
      };
      void this.emit(event);
    }
  }

  /**
   * A combat resolved (HP applied, before deaths are removed). A player-started combat
   * raises `combatResolved`; a player unit whose HP changed raises `hpBelow`.
   */
  async onCombatResolved(attacker, defender, { initiator = 'player', hpBefore = null } = {}) {
    if (this.destroyed) return false;
    let held = false;
    // The committed facts of this exchange, read before the ledger takes it in: the
    // distance the strike was made from, and who had damaged the foe before now.
    const foe = [attacker, defender].find((u) => u?.faction === 'enemy') || null;
    const striker = [attacker, defender].find((u) => u?.faction === 'player') || null;
    const foeKey = foe ? this.unitKey(foe) : null;
    const damagedBy = foeKey ? [...(this.damaged.get(foeKey) || [])] : [];
    const distance =
      attacker && defender ? gridDistance(attacker.col, attacker.row, defender.col, defender.row) : null; // prettier-ignore
    if (foe && striker) this.recordDamage(foe, striker, attacker === foe ? hpBefore?.attacker : hpBefore?.defender); // prettier-ignore
    if (initiator === 'player' && attacker?.faction === 'player') {
      held = await this.emit({
        type: 'combatResolved',
        unit: attacker.name,
        target: this.unitKey(defender),
        turn: this.turn(),
        kill: Boolean(defender) && !(defender.currentHP > 0),
        distance,
        damagedBy,
      });
    }
    for (const unit of [attacker, defender]) {
      if (unit?.faction !== 'player' || !(unit.currentHP > 0)) continue;
      held = (await this.checkHp(unit)) || held;
    }
    return held;
  }

  /**
   * The foe lost HP in this exchange: the striker (the player unit it fought, as the
   * attacker or as the one who countered) damaged it. `hpBefore` is the foe's HP when
   * the combat began (the scene's); without it the HP last seen here stands in.
   */
  recordDamage(foe, striker, hpBefore = null) {
    const key = this.unitKey(foe);
    const before = Number.isFinite(Number(hpBefore)) && hpBefore !== null ? Number(hpBefore) : this.foeHpSeen.get(key); // prettier-ignore
    const now = Number(foe.currentHP) || 0;
    this.foeHpSeen.set(key, now);
    if (!Number.isFinite(before) || now >= before) return false;
    const names = this.damaged.get(key) || new Set();
    names.add(striker.name);
    this.damaged.set(key, names);
    return true;
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
    const donor = this.healDonor(unit);
    return this.emit(
      { type: 'hpBelow', unit: unit.name, hpPct: pct },
      {
        ctx: {
          unit: unit.name,
          consumable: (unit.consumables || [])[0] || null,
          healing: healingItem(unit),
          donor: donor ? { name: donor.unit.name, item: donor.item.name } : null,
        },
      },
    );
  }

  /** Another fielded player unit carrying a healing item the hurt unit could Trade for. */
  healDonor(unit) {
    for (const ally of this.scene.playerUnits || []) {
      if (!ally || ally === unit || !(ally.currentHP > 0)) continue;
      const item = healingItem(ally);
      if (item) return { unit: ally, item };
    }
    return null;
  }

  /**
   * A player unit's action is about to complete (Wait, an attack...). Returns a promise
   * when a note holds the completion until it is read, else null.
   */
  beforeUnitActionCompletes(unit) {
    if (this.destroyed || unit?.faction !== 'player') return null;
    this.closeTip({ unit: unit.name });
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

  /** A lord chose Seize (P4): the chapter's seize beats, before the victory flow. */
  onSeize(unit) {
    if (this.destroyed || !unit) return Promise.resolve(false);
    return this.emit({ type: 'seize', unit: unit.name });
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
    this.cancelDeferred();
    this.pending = [];
    this.closeTip();
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
   * A unit fell (it has left its roster). Resolves once the fall's beats are read: the
   * scene awaits it in removeUnit, before the death's side effects and before combat
   * or the enemy phase go on, so a sequence such as Varro's (his line, then the seize
   * note) owns that interval instead of racing it. A protected player unit (every
   * named unit of the chapter: the commander, Gaspar, later Sera and Tamsin) restarts
   * the chapter as the commander's fall does; checkBattleEnd never sees a
   * non-commander's fall.
   */
  onUnitDefeated(unit) {
    if (this.destroyed || !unit) return Promise.resolve(false);
    const beats = this.emit({ type: 'unitDefeated', unit: this.unitKey(unit) });
    // Sera is protected green or blue: her fall as an NPC restarts the chapter too.
    if ((unit.faction === 'player' || unit.faction === 'npc') && this.isProtected(unit))
      this.onDefeatIntercept({ fallen: unit });
    return beats;
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
    this.cancelDeferred();
    this.pending = [];
    this.closeTip();
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
    // A level-up card or EXP gauge recorded before the fall never plays over the
    // restarted chapter (the re-opened scene starts with empty queues too).
    scene._pendingLevelUpPopups = [];
    scene._pendingXpGauges = [];
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

  // --- The board under the coach -----------------------------------------------------

  /**
   * The strip of the battle camera's view the coach covers, in camera viewport px
   * ({ top } or { bottom }), or null when it covers none. The camera lets the map pan
   * out from under it (BattleCameraController `getInsets`): on an upright phone the
   * coach docks over the map, and without this the row under it could not be tapped.
   */
  coveredInsets() {
    const root = this.coach?.root;
    const scene = this.scene;
    if (this.destroyed || !root?.isConnected || root.hidden) return null;
    const canvas = scene.game?.canvas?.getBoundingClientRect?.();
    const cam = scene.cameras?.main;
    const box = root.getBoundingClientRect?.();
    if (!canvas?.height || !canvas?.width || !cam || !box?.height) return null;
    const pxY = (Number(scene.scale?.height) || canvas.height) / canvas.height;
    const pxX = (Number(scene.scale?.width) || canvas.width) / canvas.width;
    const top = canvas.top + (Number(cam.y) || 0) / pxY;
    const bottom = top + (Number(cam.height) || 0) / pxY;
    const left = canvas.left + (Number(cam.x) || 0) / pxX;
    const right = left + (Number(cam.width) || 0) / pxX;
    if (box.right <= left || box.left >= right || box.bottom <= top || box.top >= bottom)
      return null;
    if (root.classList?.contains?.('is-bottom'))
      return { bottom: Math.max(0, bottom - box.top) * pxY };
    return { top: Math.max(0, box.bottom - top) * pxY };
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
    this.cancelDeferred();
    this.pending = [];
    this.closeTip();
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

  /**
   * Open the pause menu straight onto the exit confirmation (leave, or skip the rest).
   * An explicit exit is a request to honour, never a best effort: an uncommitted
   * forecast or target choice (a note read over the forecast) steps back to the action
   * menu, nothing committed, and the confirmation opens; mid-action (the note before
   * the turn passes to the enemy, the enemy phase) the request waits and opens the
   * confirmation at the next point the player can act. Nothing is committed or advanced
   * to make room for it.
   */
  requestLeave() {
    const scene = this.scene;
    if (this.destroyed || this.leaving) return false;
    if (!scene.pauseOverlay?.visible) {
      this.backOutOfPlanning();
      if (!this.canPause()) {
        if (!this.leaveQueued) this.coach?.nudge(prologueNudgeText('gate_pause', this.ctx()));
        this.leaveQueued = true;
        return false;
      }
      this.leaveQueued = false;
      scene.showPauseMenu();
    }
    this.leaveQueued = false;
    return Boolean(scene.pauseOverlay?.requestLeavePrologue?.());
  }

  /**
   * The player's own plan, still uncommitted (an open forecast, a target choice), backs
   * out to the action menu the way Cancel would: the forecast closes unread, no attack
   * is made, the unit keeps its turn.
   */
  backOutOfPlanning() {
    const scene = this.scene;
    if (scene.turnManager?.currentPhase === 'enemy') return;
    try {
      if (scene.battleState === 'SHOWING_FORECAST') {
        scene.hideForecast?.({ acknowledge: false });
        scene._clearCombatRollSession?.();
        scene.battleState = 'SELECTING_TARGET';
      }
      if (scene.battleState === 'SELECTING_TARGET') {
        scene._attackFlow?.().cancelTargetSelection();
        scene._mobileBattleHud?.sync?.();
      }
    } catch {
      /* the exit still opens if it can; a failed back-out leaves the request queued */
    }
  }

  /** Each frame: a queued exit opens once the player can act and nothing is on screen. */
  flushLeave() {
    if (!this.leaveQueued || this.destroyed || this.leaving) return;
    if (this.lessonOpen || this.presenting > 0 || this.scene.pauseOverlay?.visible) return;
    if (this.scene.battleState !== 'PLAYER_IDLE' || !this.canPause()) return;
    this.requestLeave();
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

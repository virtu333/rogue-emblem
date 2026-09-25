// PortraitBattleController — portrait battles (beta) on phones.
//
// Owns the battle's upright presentation: decides whether the board is drawn turned
// (player side at the bottom), keeps the page classes that switch the phone layout
// and suppress the rotate prompt, and follows the phone when it turns mid-battle.
//
// Turning the phone never re-lays out a live battle. At the player's next clean idle
// boundary the controller saves the battle exactly as it stands (same RNG position,
// no reseed) and re-opens it through the existing Resume battle path in the other
// orientation — the same restore a refresh performs, so no outcome can change.
// Deployment and the post-battle flow stay landscape (the rotate prompt returns).
//
// Rules and saves are untouched: the board turn is Grid presentation only.

import { classifyBattleBoundary } from './BattleCheckpointAdapter.js';
import { BattleSuspendController } from './BattleSuspendController.js';
import { battlefieldLabEnabled } from './BattlefieldLab.js';
import { canUseTouchUI } from '../utils/domUI.js';
import { hasInputFocus } from '../utils/inputFocus.js';
import { rotationForPlayerSide } from '../utils/boardOrientation.js';
import { restartScene } from '../utils/SceneRouter.js';
import { TRANSITION_REASONS } from '../utils/sceneLoader.js';
import {
  PORTRAIT_BATTLE_CHANGE_EVENT,
  PORTRAIT_BATTLE_CLASS,
  canSwitchBattlePresentation,
  getPortraitBattlePreference,
  isPortraitViewport,
  wantsPortraitBattle,
} from '../utils/portraitBattle.js';

export const PORTRAIT_CAPABLE_CLASS = 'portrait-battle-capable';
const NOTICE_MS = 4000;

function docRoot() {
  return typeof document !== 'undefined' ? document.documentElement : null;
}

export class PortraitBattleController {
  constructor(scene) {
    this.scene = scene;
    this.rotated = false;
    this.enabled = false;
    this.capable = false;
    this.pending = false;
    this.switching = false;
    this.ended = false;
    // Set when this battle cannot re-open (no run save, e.g. the tutorial): the layout
    // still follows the phone, the board keeps its orientation.
    this.locked = false;
    this.notice = null;
    this._listeners = [];
  }

  /** Phone battle layout (full-height map + command rail) with a movable camera. */
  phoneLayout() {
    const s = this.scene;
    return Boolean(s.mobileCameraEnabled && canUseTouchUI(s) && battlefieldLabEnabled());
  }

  /**
   * Called in beginBattle before the Grid exists. Returns the Grid presentation
   * option ({ rotation }) or null for the classic landscape board.
   */
  resolvePresentation(battleConfig) {
    this._refreshEnabled();
    this.rotated = this.wantsRotated();
    if (!this.rotated) return null;
    return { rotation: rotationForPlayerSide(battleConfig?.playerSpawns, battleConfig?.cols) };
  }

  _refreshEnabled() {
    this.enabled = Boolean(getPortraitBattlePreference() && this.phoneLayout());
    // An upright board keeps the upright layout until it turns back.
    this.capable = this.enabled || this.rotated;
  }

  /** What the phone asks for right now. */
  wantsRotated() {
    return wantsPortraitBattle({
      enabled: this.enabled,
      phoneLayout: true,
      portrait: isPortraitViewport(),
    });
  }

  /** After the grid and HUD exist: apply page classes and start following the phone. */
  create() {
    this._applyClasses();
    if (typeof window === 'undefined' || !this.phoneLayout()) return this;
    const onChange = () => this.check();
    const onPreference = () => {
      this._refreshEnabled();
      this._applyClasses();
      this.check();
    };
    window.addEventListener(PORTRAIT_BATTLE_CHANGE_EVENT, onPreference);
    this._listeners.push(() =>
      window.removeEventListener(PORTRAIT_BATTLE_CHANGE_EVENT, onPreference),
    );
    for (const [target, type] of [
      [window, 'resize'],
      [window, 'orientationchange'],
      [window.visualViewport, 'resize'],
    ]) {
      if (!target?.addEventListener) continue;
      target.addEventListener(type, onChange);
      this._listeners.push(() => target.removeEventListener(type, onChange));
    }
    return this;
  }

  _applyClasses() {
    const root = docRoot();
    if (!root) return;
    const live = !this.ended;
    root.classList.toggle(PORTRAIT_BATTLE_CLASS, live && this.rotated);
    root.classList.toggle(PORTRAIT_CAPABLE_CLASS, live && this.capable);
  }

  /** The presentation the phone asks for right now differs from the one on screen. */
  mismatch() {
    if (this.ended || this.locked) return false;
    return this.wantsRotated() !== this.rotated;
  }

  _modalOpen() {
    const s = this.scene;
    const hud = s._mobileBattleHud;
    return Boolean(
      !hasInputFocus(s) ||
      s.isStoryInputLocked?.() ||
      s.pauseOverlay?.visible ||
      s.unitDetailOverlay?.visible ||
      s.rosterOverlay?.visible ||
      s.visionDialog ||
      s.lootSettingsOverlay ||
      s.lootRosterVisible ||
      s._inputController?.isSelectionMenu?.() ||
      hud?.modal ||
      hud?.menu ||
      hud?.endTurnPending ||
      (typeof document !== 'undefined' && document.querySelector('.mp-backdrop:not([hidden])')),
    );
  }

  switchState() {
    const s = this.scene;
    return {
      hasRunCheckpoint: Boolean(s.runManager?.battleInProgress && !s.battleParams?.tutorialMode),
      boundary: classifyBattleBoundary(s),
      phase: s.turnManager?.currentPhase,
      battleState: s.battleState,
      transitioning: Boolean(this.switching || s.isTransitioningOut),
      modalOpen: this._modalOpen(),
    };
  }

  /** Per frame (cheap): finish a pending switch once the battle reaches a safe point. */
  update() {
    if (this.switching) return;
    const over = this.scene.battleState === 'BATTLE_END';
    if (over !== this.ended) {
      // Rewards hand the phone back to landscape; a rewind out of a defeat returns it.
      if (over) this.onBattleEnd();
      else this._reopen();
      return;
    }
    if (!this.ended && this.pending) this.check();
  }

  _reopen() {
    this.ended = false;
    this._applyClasses();
    this.check();
  }

  check() {
    if (this.ended || this.switching) return false;
    const mismatch = this.mismatch();
    if (!mismatch) {
      this.pending = false;
      if (!this.locked) this._showNotice(null);
      return false;
    }
    this.pending = true;
    const state = this.switchState();
    if (!state.hasRunCheckpoint) {
      this._lock();
      return false;
    }
    if (!canSwitchBattlePresentation(state)) {
      this._showNotice(
        this.wantsRotated()
          ? 'The board turns upright when your turn is ready.'
          : 'The board turns back when your turn is ready.',
      );
      return false;
    }
    return this._switch();
  }

  _switch() {
    const s = this.scene;
    const rm = s.runManager;
    const before = Number(rm?.battleInProgress?.checkpoint?.checkpointIndex) || 0;
    // Save exactly the state on screen: the RNG stream is kept, not reseeded.
    const suspend = (s._battleSuspendController ||= new BattleSuspendController(s));
    suspend.captureCheckpoint({ preserveRng: true });
    const bip = rm?.battleInProgress;
    const checkpoint = bip?.checkpoint;
    if (!checkpoint || (Number(checkpoint.checkpointIndex) || 0) <= before) {
      // Nothing current to resume from: keep playing on the present board.
      this._lock();
      return false;
    }
    this.switching = true;
    this._showNotice(null);
    if (s.input) s.input.enabled = false;
    const ok = restartScene(
      s,
      {
        gameData: s.gameData,
        runManager: rm,
        battleParams: bip.battleParams || s.battleParams,
        roster: rm.getRoster?.() || s.roster,
        nodeId: bip.nodeId ?? s.nodeId,
        isBoss: bip.isBoss === true,
        isElite: bip.isElite === true,
        resumeCheckpoint: checkpoint,
        presentationSwitch: true,
      },
      { reason: TRANSITION_REASONS.CONTINUE },
    );
    if (!ok) {
      this.switching = false;
      if (s.input) s.input.enabled = true;
    }
    return ok;
  }

  _lock() {
    this.locked = true;
    this.pending = false;
    this._showNotice('The board keeps its orientation for this battle.');
  }

  /** Rewards, promotions and the route stay landscape: hand the phone back. */
  onBattleEnd() {
    if (this.ended) return;
    this.ended = true;
    this.pending = false;
    this._showNotice(null);
    this._applyClasses();
  }

  // A quiet line over the top of the map. Each message shows once for a few seconds
  // (update() re-checks every frame while a switch is pending) and never takes input.
  _showNotice(text) {
    if (typeof document === 'undefined') return;
    if (!text) {
      clearTimeout(this._noticeTimer);
      this._noticeTimer = null;
      this._noticeText = null;
      this.notice?.remove();
      this.notice = null;
      return;
    }
    if (this._noticeText === text) return;
    this._noticeText = text;
    clearTimeout(this._noticeTimer);
    this._noticeTimer = setTimeout(() => {
      this.notice?.remove();
      this.notice = null;
    }, NOTICE_MS);
    if (!this.notice) {
      this.notice = document.createElement('div');
      this.notice.className = 'portrait-battle-notice';
      this.notice.setAttribute('role', 'status');
      this.notice.setAttribute('aria-live', 'polite');
      document.body.append(this.notice);
    }
    if (this.notice.textContent !== text) this.notice.textContent = text;
  }

  destroy() {
    for (const off of this._listeners) off();
    this._listeners = [];
    this._showNotice(null);
    const root = docRoot();
    root?.classList.remove(PORTRAIT_BATTLE_CLASS, PORTRAIT_CAPABLE_CLASS);
    this.scene = null;
  }
}

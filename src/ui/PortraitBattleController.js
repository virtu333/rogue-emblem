// PortraitBattleController — portrait battles on phones.
//
// Owns the battle's upright presentation: decides whether the board is drawn turned
// (player side at the bottom), keeps the page classes that switch the phone layout
// and suppress the rotate prompt, and follows the phone when it turns mid-battle.
//
// Turning the phone never re-lays out a live battle. At the player's next clean idle
// boundary the controller saves the battle exactly as it stands (same RNG position,
// no reseed) and re-opens it through the existing Resume battle path in the other
// orientation — the same restore a refresh performs, so no outcome can change.
// Once the battle is decided the board stays as it is through the rewards.
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
  isPortraitViewport,
  portraitBattlesEnabled,
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
    // Set when a switch's save did not reach storage (full, private mode): the request
    // that failed (phone upright?, portrait mode on?). The board keeps its orientation
    // and nothing retries per frame; the next request (turning the phone, or the
    // Settings toggle) tries once more, so a player never needs a refresh.
    this.saveFailed = null;
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
    // Never in a landscape-locked shell (iOS app, installed web app), whatever is stored.
    this.enabled = Boolean(portraitBattlesEnabled() && this.phoneLayout());
    // An upright board keeps the upright layout until it turns back.
    this.capable = this.enabled || this.rotated;
  }

  /** The request a failed save is held against: which way the phone is, which mode. */
  _request() {
    return `${isPortraitViewport()}:${this.enabled}`;
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

  // The classes stay through the battle's end: in portrait mode the rewards, and the
  // map behind them ("View map"), stay upright. destroy() clears them with the scene.
  _applyClasses() {
    const root = docRoot();
    if (!root) return;
    root.classList.toggle(PORTRAIT_BATTLE_CLASS, this.rotated);
    root.classList.toggle(PORTRAIT_CAPABLE_CLASS, this.capable);
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

  /**
   * A press or camera gesture is under way on the board (wait for its release). A press
   * begun before the phone turned no longer counts: the turn dropped it (its release acts
   * on nothing), and iOS may never deliver that release, which left the board waiting
   * for another tap (playtest, build 24).
   */
  _gestureActive() {
    const s = this.scene;
    const pointerDown = s.input?.activePointer?.isDown && !s._inputController?.hasStalePress?.();
    return Boolean(
      s._battleCamera?.hasActiveTouches?.() || s._touchTapDown || s._touchHoldStart || pointerDown,
    );
  }

  switchState() {
    const s = this.scene;
    return {
      // Only fixed-v1 battles keep one RNG stream across saves. A battle begun under
      // the legacy policy reseeds by save count, so an extra save would change later
      // outcomes: it keeps its board. A battle without a save slot (dev routes) has
      // nowhere to write the save it would re-open from.
      hasRunCheckpoint: Boolean(
        s.runManager?.battleInProgress &&
        !s.battleParams?.tutorialMode &&
        s._battleRewindPolicy === 'fixed-v1' &&
        Number.isInteger(s.registry?.get?.('activeSlot')),
      ),
      boundary: classifyBattleBoundary(s),
      phase: s.turnManager?.currentPhase,
      battleState: s.battleState,
      transitioning: Boolean(this.switching || s.isTransitioningOut),
      modalOpen: this._modalOpen(),
      gestureActive: this._gestureActive(),
    };
  }

  /** Per frame (cheap): finish a pending switch once the battle reaches a safe point. */
  update() {
    if (this.notice) this._placeNotice();
    if (this.switching) return;
    const over = this.scene.battleState === 'BATTLE_END';
    if (over !== this.ended) {
      // A decided battle stops following the phone; a rewind out of a defeat resumes it.
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
      // The phone is back in the board's orientation: a later turn tries again.
      this.saveFailed = null;
      if (!this.locked) this._showNotice(null);
      return false;
    }
    // A save just failed: hold until the player asks again.
    if (this.saveFailed === this._request()) return false;
    this.saveFailed = null;
    this.pending = true;
    const state = this.switchState();
    if (!state.hasRunCheckpoint) {
      this._lock();
      return false;
    }
    if (!canSwitchBattlePresentation(state)) {
      // The note stays up for the whole wait (an enemy phase can outlast a timed note)
      // and names what the board waits for.
      const upright = this.wantsRotated();
      const text =
        state.battleState === 'DEPLOY_POSITIONING'
          ? upright
            ? 'The board turns upright when the battle begins.'
            : 'The board turns back when the battle begins.'
          : state.phase !== 'player'
            ? upright
              ? 'The board turns upright when your turn begins.'
              : 'The board turns back when your turn begins.'
            : upright
              ? 'The board turns upright when this action is done.'
              : 'The board turns back when this action is done.';
      this._showNotice(text, { persist: true });
      return false;
    }
    return this._switch();
  }

  _switch() {
    const s = this.scene;
    const rm = s.runManager;
    const before = Number(rm?.battleInProgress?.checkpoint?.checkpointIndex) || 0;
    // Save exactly the state on screen: the RNG stream is kept, not reseeded.
    // The switch re-opens only from a save that reached storage, so a refresh
    // during or after it restores the same battle. captureCheckpoint updates
    // the in-memory checkpoint before writing, so its result, not the index,
    // says whether the save is durable.
    const suspend = (s._battleSuspendController ||= new BattleSuspendController(s));
    const saved = suspend.captureCheckpoint({ preserveRng: true }) === true;
    const bip = rm?.battleInProgress;
    const checkpoint = bip?.checkpoint;
    if (!saved || !checkpoint || (Number(checkpoint.checkpointIndex) || 0) <= before) {
      // No durable save to re-open from: keep playing on the present board. Storage
      // can recover (space freed, a transient error), so this is not for good.
      this.saveFailed = this._request();
      this.pending = false;
      this._showNotice(
        'The battle could not be saved, so the board stays as it is. Turn the phone again to retry.',
      );
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

  /** The battle is decided: stop following the phone (no switch over the rewards). */
  onBattleEnd() {
    if (this.ended) return;
    this.ended = true;
    this.pending = false;
    this._showNotice(null);
  }

  // A quiet line over the top of the map. Each message shows once for a few seconds
  // (update() re-checks every frame while a switch is pending) and never takes input.
  _showNotice(text, { persist = false } = {}) {
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
    // A waiting note clears when the switch happens or the phone turns back.
    this._noticeTimer = persist
      ? null
      : setTimeout(() => {
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
    this._placeNotice();
  }

  // The note sits over the map, never over the rail: centred on the map's area (the
  // landscape rail stands beside it) and no wider than it. The tutorial guide docks
  // over the map too (top or bottom, and it re-docks as the layout turns): where the
  // note's own place would cover it, the note sits just below the guide instead,
  // never over its Skip step / Leave buttons. Checked every frame while the note
  // shows (a few seconds).
  _placeNotice() {
    const notice = this.notice;
    if (!notice?.isConnected) return;
    const map = document.getElementById('game-container')?.getBoundingClientRect();
    const left = map?.width > 0 ? `${Math.round(map.left + map.width / 2)}px` : '';
    const room = map?.width > 0 ? Math.max(160, Math.floor(map.width - 16)) : 0;
    const maxWidth = room ? `min(92vw, 420px, ${room}px)` : '';
    if (notice.style.left !== left) notice.style.left = left;
    if (notice.style.maxWidth !== maxWidth) notice.style.maxWidth = maxWidth;
    const coach = document.querySelector('.re-coach:not([hidden])')?.getBoundingClientRect();
    let top = '';
    if (coach && coach.height > 0) {
      const previous = notice.style.top;
      notice.style.top = '';
      const own = notice.getBoundingClientRect();
      notice.style.top = previous;
      const covers =
        own.top < coach.bottom &&
        own.bottom > coach.top &&
        own.left < coach.right &&
        own.right > coach.left;
      if (covers) top = `${Math.round(coach.bottom + 8)}px`;
    }
    if (notice.style.top !== top) notice.style.top = top;
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

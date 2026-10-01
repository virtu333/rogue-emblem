import { classifySaveResult } from '../engine/SavePersistenceStatus.js';
import { isCurrentBattleSession } from './BattleSession.js';
import { popInputScope } from '../utils/inputFocus.js';
import { removeOverlay } from '../utils/overlayStack.js';
import { MenuSurface, element, button } from './MenuSurface.js';
import { safeBattlePresentation } from './safeBattlePresentation.js';
import { reportAsyncError } from '../utils/errorReporter.js';

export const SAVE_RETRY_COPY = Object.freeze({
  title: 'Battle not saved',
  quota: "This device's storage is full.",
  write_error: 'This device refused the save.',
  risk: ['If the game closes now, you go back', 'to your last save.'],
  free: 'Free space on this device, then Retry.',
  automatic: 'Keep playing retries after each action.',
  exitTitle: 'Exit without saving?',
  exitRisk: ['Your latest moves are not saved.', 'Exit now and they are lost.'],
  pill: 'Not saved',
});

// Owns the dialog and its wait, never battleState, RNG, or action settlement.
export class SaveRetryController {
  constructor(scene) {
    this.scene = scene;
    this.state = 'idle';
    this.episode = null;
    this.surface = null;
    this.pill = null;
    this.wait = null;
    this.exitWait = null;
    this.toast = null;
    this.toastTimer = null;
  }
  create() {
    return this;
  }
  _current() {
    return !!this.episode && isCurrentBattleSession(this.scene, this.episode.session);
  }
  isBlocking() {
    return this._current() && this.state === 'pending';
  }
  isUnsaved() {
    return this._current() && this.state !== 'idle';
  }
  onCheckpointResult(result, { session, progress = true } = {}) {
    if (!isCurrentBattleSession(this.scene, session)) return;
    const kind = classifySaveResult(result, {
      hasCandidate: this.scene._battleSuspendController?.hasRetryCandidate(),
      progress,
    });
    if (kind === 'durable') return this.onDurableWrite({ session });
    if (kind === 'capture_error') {
      reportAsyncError('battle_checkpoint_capture_error', new Error(result.reason), { session });
      if (!this.episode) {
        this.episode = { session, reason: result.reason, attempts: 0, startedAt: Date.now() };
        this.state = 'degraded';
        this._placePill();
      }
      return;
    }
    if (kind !== 'retryable') return;
    if (!this.episode) {
      this.episode = { session, reason: result.reason, attempts: 0, startedAt: Date.now() };
      // Publish the block synchronously: unitActed can hand off the phase now.
      this.state = 'pending';
      queueMicrotask(() => {
        if (this.isBlocking()) this._showSafely();
      });
    } else {
      this.episode.reason = result.reason;
      this.episode.captures = (this.episode.captures || 0) + 1;
    }
  }
  onDurableWrite({ session } = {}) {
    if (!isCurrentBattleSession(this.scene, session)) return;
    this.scene._battleSuspendController?.dropRetryCandidate();
    const episode = this._current() ? this.episode : null;
    // Durability and continuation ownership settle before DOM presentation.
    this.state = 'idle';
    this.episode = null;
    this._release(true);
    safeBattlePresentation('save retry close', () => this._close(), { scene: this.scene });
    if (episode) {
      reportAsyncError('battle_save_recovered', new Error('Battle saved'), {
        attempts: episode.attempts,
        captures: episode.captures || 0,
        ms: Date.now() - episode.startedAt,
      });
      safeBattlePresentation('save recovery notice', () => this._toast('Battle saved.'), {
        scene: this.scene,
      });
    }
  }
  whenSettled(session) {
    if (!isCurrentBattleSession(this.scene, session)) return new Promise(() => {});
    if (!this.isBlocking()) return null;
    this.wait ||= this.scene._createLifecycleAwaitGuard({ label: 'save_retry', timeoutMs: null });
    return this.wait.promise;
  }
  async retry() {
    const episode = this.episode;
    if (!this._current() || episode.busy) return;
    episode.busy = true;
    episode.attempts++;
    this._showSafely();
    // Let the saving state paint; double activation observes busy immediately.
    await Promise.resolve();
    if (!isCurrentBattleSession(this.scene, episode.session) || this.episode !== episode) return;
    const result = this.scene._battleSuspendController?.retryCheckpoint({
      session: episode.session,
    }) || {
      ok: false,
      reason: 'no_candidate',
    };
    episode.busy = false;
    if (result.ok) {
      // Unit fixtures may supply a writer without the scene's durability hook.
      this.onDurableWrite({ session: episode.session });
      return result;
    }
    if (['quota', 'write_error'].includes(result.reason)) {
      reportAsyncError('battle_save_retry_failed', new Error(result.reason), {
        attempt: episode.attempts,
      });
      this._showSafely();
    } else {
      reportAsyncError('battle_save_retry_rejected', new Error(result.reason));
      this.state = ['unstable_boundary', 'no_battle'].includes(result.reason) ? 'idle' : 'degraded';
      this._close();
      this._release(false);
      if (this.state === 'idle') this.episode = null;
      this._placePill();
    }
    return result;
  }
  keepPlaying() {
    if (!this.isBlocking() || this.episode.busy) return;
    this.state = 'degraded';
    reportAsyncError('battle_save_continue_unsaved', new Error('Keep playing'));
    this._close();
    this._release(false);
    this._placePill();
  }
  async ensureDurableForExit({ session } = {}) {
    if (!isCurrentBattleSession(this.scene, session)) return false;
    if (!this.isUnsaved()) return true;
    if (this.scene._battleSuspendController?.hasRetryCandidate()) {
      const result = await this.retry();
      if (!isCurrentBattleSession(this.scene, session)) return false;
      if (result?.reason === 'unstable_boundary') return false;
      if (result?.ok || !this.isUnsaved()) return true;
    }
    // A serialization bug can leave unsaved state without a retryable candidate.
    this.state = 'pending';
    this.exitWait ||= this.scene._createLifecycleAwaitGuard({
      label: 'save_retry_exit',
      timeoutMs: null,
    });
    const pendingExit = this.exitWait.promise;
    this._showSafely(true);
    const outcome = await pendingExit;
    return outcome?.allowExit === true;
  }
  stay() {
    if (!this._current() || this.episode.busy) return;
    this.state = 'degraded';
    this._close();
    this.exitWait?.guard.resolve({ allowExit: false });
    this.exitWait = null;
    this._placePill();
  }
  exitAnyway() {
    if (!this._current() || this.episode.busy) return;
    reportAsyncError('battle_save_exit_unsaved', new Error('Exit anyway'));
    this._close();
    this.state = 'degraded';
    this.exitWait?.guard.resolve({ allowExit: true });
    this.exitWait = null;
  }
  _release(value) {
    this.wait?.guard.resolve({ saved: value });
    this.wait = null;
    if (value) {
      this.exitWait?.guard.resolve({ allowExit: true });
      this.exitWait = null;
    }
  }
  _close() {
    const surface = this.surface;
    const pill = this.pill;
    this.surface = null;
    this.pill = null;
    safeBattlePresentation(
      'save retry UI teardown',
      () => {
        try {
          surface?.destroy();
        } finally {
          // Even a failed teardown releases this dialog's input and shield.
          const cleanup = [
            ...(surface
              ? [
                  ['save retry input cleanup', () => popInputScope(surface)],
                  ['save retry overlay cleanup', () => removeOverlay(this.scene, surface.token)],
                  ['save retry panel cleanup', () => surface.root?.remove()],
                  ['save retry shield cleanup', () => surface.shield?.remove()],
                ]
              : []),
            ['save retry pill cleanup', () => pill?.remove()],
          ];
          for (const [label, release] of cleanup)
            safeBattlePresentation(label, release, { scene: this.scene });
        }
      },
      { scene: this.scene },
    );
  }
  _showSafely(exit = !!this.exitWait) {
    const rendered = safeBattlePresentation(
      'save retry dialog',
      () => {
        this._show(exit);
        return true;
      },
      { scene: this.scene },
    );
    if (rendered === true) return;
    // A broken renderer must not trap the player behind inaccessible controls.
    // A document-less harness is a normal no-op and remains manually controllable.
    this._close();
    // Retry owns the boundary until its writer returns, even without a repaint.
    if (this.episode?.busy) return;
    this.state = 'degraded';
    this._release(false);
    this.exitWait?.guard.resolve({ allowExit: false });
    this.exitWait = null;
    safeBattlePresentation('save retry fallback pill', () => this._placePill(), {
      scene: this.scene,
    });
  }
  _show(exit = !!this.exitWait) {
    if (
      !this.isBlocking() ||
      typeof document === 'undefined' ||
      !document.getElementById('game-wrapper')
    )
      return;
    this._close();
    const surface = new MenuSurface(
      this.scene,
      exit ? SAVE_RETRY_COPY.exitTitle : SAVE_RETRY_COPY.title,
      () => surface.focusContent(),
      { modal: true },
    );
    this.surface = surface;
    surface.root.dataset.saveRetry = exit ? 'exit' : 'action';
    surface.root.style.maxWidth = 'min(92vw, 420px)';
    surface.header.querySelector('button')?.remove();
    const lines = exit
      ? SAVE_RETRY_COPY.exitRisk
      : [
          SAVE_RETRY_COPY[this.episode.reason] || SAVE_RETRY_COPY.write_error,
          ...SAVE_RETRY_COPY.risk,
          ...(this.episode.reason === 'quota' ? [SAVE_RETRY_COPY.free] : []),
          SAVE_RETRY_COPY.automatic,
        ];
    for (const line of lines) surface.body.append(element('p', line));
    if (this.episode.attempts)
      surface.body.append(
        element(
          'p',
          this.episode.busy ? 'Saving...' : `Still not saved. Tries: ${this.episode.attempts}`,
        ),
      );
    const add = (label, action, callback) => {
      const b = button(label, callback);
      b.dataset.saveRetryAction = action;
      b.disabled = this.episode.busy === true;
      surface.body.append(b);
    };
    add('Retry', 'retry', () => void this.retry());
    if (exit) {
      add('Exit anyway', 'exit', () => this.exitAnyway());
      add('Stay', 'stay', () => this.stay());
    } else add('Keep playing', 'keep', () => this.keepPlaying());
    surface.focusContent();
  }
  _placePill() {
    if (this.state !== 'degraded' || !this._current() || typeof document === 'undefined') return;
    const host = document.getElementById('game-wrapper');
    const bounds = document.getElementById('game-container')?.getBoundingClientRect();
    if (!host || !bounds) return;
    if (!this.pill) {
      this.pill = element('div', SAVE_RETRY_COPY.pill, 'battle-save-status');
      this.pill.setAttribute('role', 'status');
      this.pill.setAttribute('aria-label', 'Battle not saved. It retries after each action.');
      host.append(this.pill);
    }
    const notice = document.querySelector('.portrait-battle-notice')?.getBoundingClientRect();
    this.pill.style.left = `${bounds.left + bounds.width / 2}px`;
    this.pill.style.top = `${Math.max(bounds.top + 8, (notice?.bottom || bounds.top) + 8)}px`;
  }
  _toast(text) {
    if (typeof document === 'undefined') return;
    const host = document.getElementById('game-wrapper');
    if (!host) return;
    this.toast?.remove();
    clearTimeout(this.toastTimer);
    const toast = element('div', text, 'battle-save-status');
    this.toast = toast;
    toast.setAttribute('role', 'status');
    host.append(toast);
    this.toastTimer = setTimeout(() => {
      toast.remove();
      if (this.toast === toast) this.toast = null;
    }, 2000);
  }
  update() {
    if (
      this._current() &&
      (this.scene.battleState === 'BATTLE_END' ||
        this.scene._fatalDecision ||
        this.scene._fatalCapturePending ||
        this.scene._defeatDecision)
    ) {
      this.state = 'idle';
      this._close();
      this._release(false);
      this.exitWait?.guard.resolve({ allowExit: false });
      this.exitWait = null;
      this.episode = null;
    } else this._placePill();
  }
  destroy() {
    clearTimeout(this.toastTimer);
    this.toast?.remove();
    this.toast = null;
    this.toastTimer = null;
    this._close();
    this.wait?.guard.cancel('scene_shutdown');
    this.exitWait?.guard.cancel('scene_shutdown');
    this.wait = null;
    this.exitWait = null;
    this.episode = null;
    this.state = 'idle';
  }
}

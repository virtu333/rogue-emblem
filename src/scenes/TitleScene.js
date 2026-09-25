import { showRunRecords } from '../ui/RunRecordsMenu.js';
import { applyCompletedTutorialHints } from '../ui/tutorialLessons.js';
import { getCloudSaveConflict } from '../engine/CloudSaveConflict.js';
import { MenuSurface, element, button } from '../ui/MenuSurface.js';
import { hasDOMHost } from '../utils/domUI.js';
import { inputHint } from '../utils/inputHint.js';
// TitleScene — The Hollow Sun key art behind a DOM lockup and reliquary menu.
// The scene owns the actions and transitions; TitleScreen (src/ui) owns presentation.

import Phaser from 'phaser';
import { SettingsOverlay } from '../ui/SettingsOverlay.js';
import { HowToPlayOverlay } from '../ui/HowToPlayOverlay.js';
import { HelpOverlay } from '../ui/HelpOverlay.js';
import { CompendiumOverlay } from '../ui/CompendiumOverlay.js';
import { TitleScreen } from '../ui/TitleScreen.js';
import { buildTitleMenu, pickResumeSlot } from '../ui/titleMenuModel.js';
import { readSlotMilestones, selectTitleVariant } from '../art/keyart/titleVariant.js';
import { MUSIC } from '../utils/musicConfig.js';
import { ensureAudioUnlocked } from '../utils/audioUnlock.js';
import { signOut } from '../cloud/supabaseClient.js';
import { backupAllLocalSlots, pushMeta } from '../cloud/CloudSync.js';
import {
  MAX_SLOTS,
  getSlotCount,
  getSlotSummary,
  getNextAvailableSlot,
  setActiveSlot,
  getMetaKey,
  clearAllSlotData,
} from '../engine/SlotManager.js';
import { buildTutorialRoster as _buildTutorialRoster } from '../engine/TutorialHelpers.js';
import { MetaProgressionManager } from '../engine/MetaProgressionManager.js';
import { HintManager } from '../engine/HintManager.js';
import { startFirstRunFastPath } from '../utils/firstRunFastPath.js';
import { logStartupSummary, markStartup } from '../utils/startupTelemetry.js';
import { startDeferredAssetWarmup } from '../utils/assetWarmup.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { MenuFocusController } from '../ui/MenuFocusController.js';
import { InputAction } from '../utils/InputActions.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { UI_PALETTE } from '../utils/uiStyles.js';
import { throttledRead } from '../utils/throttledRead.js';

const VERSION = 'v0.1.0';
const CLOUD_EXPIRED_NOTICE = 'Cloud unavailable - local saves only (re-auth required)';

function readFlag(key) {
  try {
    return Boolean(localStorage.getItem(key));
  } catch (_) {
    return false;
  }
}

// =============================================
// TitleScene
// =============================================

export class TitleScene extends Phaser.Scene {
  constructor() {
    super('Title');
  }

  init(data) {
    this.gameData = data.gameData || data;
    this.isTransitioning = false;
  }

  create() {
    markStartup('title_scene_create');
    requestAnimationFrame(() => {
      markStartup('first_interactive_frame');
      logStartupSummary({ reason: 'title_first_interactive' });
      startDeferredAssetWarmup(this);
    });

    // --- Music ---
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.title, this);

    // --- Cleanup on scene exit ---
    this.events.once('shutdown', () => {
      const audio = this.registry.get('audio');
      if (audio) audio.releaseMusic(this, 0);
      popInputScope(this);
      this._onInputActionBound = null;
      if (this._menuFocus) {
        this._menuFocus.destroy();
        this._menuFocus = null;
      }
      this._cleanupTitleOverlaysForShutdown();
      if (this._onAudioUnlock) {
        this.sound.off('unlocked', this._onAudioUnlock);
        this._onAudioUnlock = null;
      }
      if (this._messageTimer) {
        this._messageTimer.remove?.();
        this._messageTimer = null;
      }
      this.titleView?.destroy();
      this.titleView = null;
      this._menuButtons = [];
    });

    // The camera clears to ink under the DOM title (the desktop letterbox shows it).
    this.cameras?.main?.setBackgroundColor?.(UI_PALETTE.void);

    if (!hasDOMHost()) {
      // Headless / no-DOM environments have no title presentation to drive.
      this._menuButtons = [];
      return;
    }

    // --- Menu model ---
    const slotSummaries = Array.from({ length: MAX_SLOTS }, (_, index) =>
      getSlotSummary(index + 1),
    );
    const hasSlots = getSlotCount() > 0;
    this._resumeSlot = pickResumeSlot(slotSummaries);
    this._menuItems = buildTitleMenu({
      hasSlots,
      tutorialDone: readFlag('emblem_rogue_tutorial_completed'),
      resumeSlot: this._resumeSlot,
      seenHowToPlay: readFlag('emblem_rogue_seen_how_to_play'),
    });

    const cloud = this.registry.get('cloud');
    // Phaser reuses the scene instance: per-visit presentation state starts fresh.
    this._cloudNoticeShown = undefined;
    this._reducedMotionValue = this._reducedMotion();
    this.titleView = new TitleScreen(this, {
      items: this._menuItems,
      variant: selectTitleVariant(readSlotMilestones()),
      reducedMotion: () => this._reducedMotion(),
      cloud: cloud ? { displayName: cloud.displayName } : null,
      version: VERSION,
      onAction: (id) => this._runAction(id),
      onSettings: () => this._openSettings(),
      onLogout: cloud ? () => void this._handleLogout(cloud) : null,
      onFocusIndex: (i) => this._menuFocus?.focusIndex(i),
    });
    // Main actions in focus order (gamepad/keyboard); the corner Settings/Log Out
    // buttons follow them in the DOM tab order.
    this._menuButtons = this.titleView.buttons;

    // Browser autoplay policy: on a gesture-less boot (auto-login / offline) the audio
    // context is suspended, so music can't start until the first input. Phaser auto-
    // unlocks on any first tap/click/key — show a hint until then so the silence isn't a
    // mystery. Self-dismisses on the same 'unlocked' event the audio system already uses.
    if (this.sound.locked) {
      this.titleView.setSoundHint(true);
      this._onAudioUnlock = () => this.titleView?.setSoundHint(false);
      this.sound.once('unlocked', this._onAudioUnlock);
    }

    this._refreshCloudSyncStatusNotice();
    this._setupMenuGamepadFocus();
  }

  _reducedMotion() {
    // The settings read parses storage; update() and the art loop ask every frame.
    this._readReduced ||= throttledRead(
      () => !!this.registry?.get?.('settings')?.getReduceMotion?.(),
    );
    return this._readReduced();
  }

  _setMenuEnabled(enabled) {
    if (this.input) this.input.enabled = enabled;
    this.titleView?.setInteractive(enabled);
  }

  _runAction(id) {
    switch (id) {
      case 'newGame':
        return this.runMenuTransition(() => this.handleNewGame());
      case 'resume':
        return this.runMenuTransition(() =>
          transitionToScene(
            this,
            'SlotPicker',
            { gameData: this.gameData, resumeSlot: this._resumeSlot?.slot },
            { reason: TRANSITION_REASONS.CONTINUE },
          ),
        );
      case 'saveSlots':
        return this.runMenuTransition(() =>
          transitionToScene(
            this,
            'SlotPicker',
            { gameData: this.gameData },
            { reason: TRANSITION_REASONS.CONTINUE },
          ),
        );
      case 'tutorial':
        return this.runMenuTransition(() =>
          transitionToScene(
            this,
            'Battle',
            {
              gameData: this.gameData,
              roster: this.buildTutorialRoster(),
              battleParams: {
                tutorialMode: true,
                act: 'act1',
                objective: 'rout',
                battleSeed: 42,
                deployCount: 2,
              },
            },
            { reason: TRANSITION_REASONS.NEW_GAME, retryBlocked: true },
          ),
        );
      case 'howToPlay':
        if (this.howToPlayOverlay?.visible) return undefined;
        this.howToPlayOverlay = new HowToPlayOverlay(this, () => {
          this.howToPlayOverlay = null;
          try {
            localStorage.setItem('emblem_rogue_seen_how_to_play', '1');
          } catch (_) {}
        });
        this.howToPlayOverlay.show();
        return undefined;
      case 'compendium':
        if (this.compendiumOverlay?.visible) return undefined;
        this.compendiumOverlay = new CompendiumOverlay(this, this.gameData, () => {
          this.compendiumOverlay = null;
        });
        this.compendiumOverlay.show();
        return undefined;
      case 'moreInfo':
        if (this.helpOverlay?.visible) return undefined;
        this.helpOverlay = new HelpOverlay(this, () => {
          this.helpOverlay = null;
        });
        this.helpOverlay.show();
        return undefined;
      case 'records':
        showRunRecords(this);
        return undefined;
      default:
        return undefined;
    }
  }

  _openSettings() {
    if (this.settingsOverlay?.visible) return;
    this.settingsOverlay = new SettingsOverlay(this, null);
    this.settingsOverlay.show();
  }

  // Gamepad: drive a focus highlight over the main menu, sharing DOM focus with the
  // keyboard. Registered as the scene's input-focus scope; released on shutdown.
  _setupMenuGamepadFocus() {
    this._menuFocus = new MenuFocusController(this);
    this._menuFocus.setItems(
      (this._menuButtons || []).filter(Boolean).map((button, index) => ({
        button,
        onFocus: () => this.titleView?.setFocused(index, true),
        onBlur: () => this.titleView?.setFocused(index, false),
        onActivate: () => button.click(),
      })),
    );
    this._onInputActionBound = (action, payload) => this._onInputAction(action, payload);
    pushInputScope(this, this._onInputActionBound);
  }

  _titleOverlayOpen() {
    return Boolean(
      this.nativeMenu ||
      this.settingsOverlay?.visible ||
      this.howToPlayOverlay?.visible ||
      this.helpOverlay?.visible ||
      this.compendiumOverlay?.visible,
    );
  }

  _onInputAction(action, payload) {
    if (this.isTransitioning) return;
    // Settings/Help/Compendium now push their own input-focus scopes, so while one
    // is open the LIFO bus routes actions to it and this handler isn't reached.
    // This guard is a defensive fallback (and still load-bearing for
    // HowToPlayOverlay, which has no scope of its own yet).
    if (this._titleOverlayOpen()) return;
    switch (action) {
      case InputAction.NAVIGATE:
        if (payload?.dy) this._menuFocus?.move(payload.dy);
        break;
      case InputAction.CONFIRM:
        this._menuFocus?.activate();
        break;
    }
  }

  _cleanupTitleOverlaysForShutdown() {
    this.nativeMenu?.destroy();
    this.nativeMenu = null;
    this._hideTitleOverlay('settingsOverlay');
    this._hideTitleOverlay('howToPlayOverlay');
    this._hideTitleOverlay('helpOverlay');
    this._hideTitleOverlay('compendiumOverlay');
  }

  _hideTitleOverlay(key) {
    const overlay = this[key];
    if (overlay?.visible && typeof overlay.hide === 'function') overlay.hide();
    this[key] = null;
  }

  /**
   * Logout wipes all local slots (they belong to this account), so local data
   * must reach the cloud first. Push every local slot, wait for the queue, and
   * if the backup cannot be confirmed preserve local saves until an explicit
   * destructive confirmation, or retry the entire backup.
   */
  async _handleLogout(cloud) {
    if (this._logoutInProgress || this.nativeMenu) return;
    const conflicts = Array.from({ length: MAX_SLOTS }, (_, i) => i + 1).filter(
      getCloudSaveConflict,
    );
    if (conflicts.length) {
      this._setLogoutNotice(
        'Choose which save to keep in Continue before logging out. Both versions are still safe.',
        'warn',
      );
      if (hasDOMHost()) {
        const menu = this._openTitleMenu('Resolve saved versions first');
        menu.body.append(
          element(
            'p',
            `Slot ${conflicts.join(', ')} has both a device and cloud save. Logging out would remove the unchosen device version. Open Continue to choose which version to keep first.`,
          ),
        );
        menu.body.append(
          button('Stay signed in', () => this._closeTitleMenu(), 're-btn re-btn--primary'),
        );
        menu.body.append(
          button('Review saved versions', () => {
            this._closeTitleMenu();
            void this.runMenuTransition(() =>
              transitionToScene(
                this,
                'SlotPicker',
                { gameData: this.gameData },
                { reason: TRANSITION_REASONS.CONTINUE },
              ),
            );
          }),
        );
        menu.focusContent();
      }
      return;
    }
    this._logoutInProgress = true;
    this._setLogoutNotice('Backing up to cloud...', 'info');
    this._showLogoutProgress('Backing up saves', 'Checking that local progress reached the cloud…');
    let backupConfirmed = false;
    try {
      backupConfirmed = await backupAllLocalSlots(cloud.userId);
    } catch {
      /* Keep local data and offer a fresh, explicit decision. */
    }
    this._logoutInProgress = false;
    this._closeTitleMenu();
    if (!this.scene?.isActive?.()) return;
    if (!backupConfirmed) {
      this._setLogoutNotice(
        'Backup failed. Local progress is still safe. Retry when connected.',
        'bad',
      );
      if (hasDOMHost()) {
        const menu = this._openTitleMenu('Cloud backup failed');
        menu.body.append(
          element(
            'p',
            'Your local progress has not been deleted. Retry the backup, stay signed in, or explicitly discard all local slots and log out.',
          ),
        );
        menu.body.append(
          button('Stay signed in', () => this._closeTitleMenu(), 're-btn re-btn--primary'),
        );
        menu.body.append(
          button('Retry backup', () => {
            this._closeTitleMenu();
            void this._handleLogout(cloud);
          }),
        );
        menu.body.append(
          button('Discard local saves and log out', () => {
            this._closeTitleMenu();
            const confirm = this._openTitleMenu('Discard local saves?');
            confirm.body.append(
              element(
                'p',
                'The backup did not finish. Every local save slot will be deleted from this device. Progress not already in the cloud will be lost.',
              ),
            );
            confirm.body.append(
              button('Keep local saves', () => this._closeTitleMenu(), 're-btn re-btn--primary'),
            );
            confirm.body.append(
              button('Delete local saves and log out', () => {
                this._closeTitleMenu();
                void this._finishLogout();
              }),
            );
            confirm.focusContent();
          }),
        );
        menu.focusContent();
      }
      return;
    }
    await this._finishLogout();
  }

  async _finishLogout() {
    if (this._logoutInProgress) return;
    this._logoutInProgress = true;
    this._showLogoutProgress(
      'Signing out',
      'Finishing sign out before clearing this device’s account data…',
    );
    try {
      await signOut();
    } catch {
      this._logoutInProgress = false;
      this._closeTitleMenu();
      this._setLogoutNotice('Could not log out. Local saves were kept. Please retry.', 'bad');
      return;
    }
    clearAllSlotData();
    try {
      localStorage.removeItem('emblem_rogue_settings');
    } catch {
      /* retry on reload */
    }
    location.reload();
  }

  _showLogoutProgress(title, message) {
    if (!hasDOMHost()) return;
    this._closeTitleMenu();
    this.nativeMenu = new MenuSurface(this, title, () => {}, { modal: true });
    this.nativeMenu.header.querySelector('button').disabled = true;
    this.nativeMenu.body.append(element('p', message));
    this.nativeMenu.root.setAttribute('aria-busy', 'true');
  }

  _closeTitleMenu() {
    this.nativeMenu?.destroy();
    this.nativeMenu = null;
  }

  _openTitleMenu(title) {
    this._closeTitleMenu();
    this.nativeMenu = new MenuSurface(this, title, () => this._closeTitleMenu(), { modal: true });
    this.nativeMenu.root.classList.add('re-run-flow');
    return this.nativeMenu;
  }

  _setLogoutNotice(message, tone = 'info') {
    this.titleView?.setLogoutNotice(message || '', tone);
  }

  _refreshCloudSyncStatusNotice() {
    const cloud = this.registry.get('cloud');
    const showNotice = !!cloud?.syncStatus?.authExpired;
    if (showNotice === this._cloudNoticeShown) return;
    this._cloudNoticeShown = showNotice;
    this.titleView?.setCloudNotice(showNotice ? CLOUD_EXPIRED_NOTICE : '');
  }

  update() {
    this._refreshCloudSyncStatusNotice();
    const reduced = this._reducedMotion();
    if (reduced !== this._reducedMotionValue) {
      this._reducedMotionValue = reduced;
      this.titleView?.refreshMotion();
    }
  }

  async handleNewGame({ confirmed = false } = {}) {
    const nextSlot = getNextAvailableSlot();
    if (!nextSlot) {
      this.showMessage('All 3 save slots are full.\nDelete a slot from Continue to free space.');
      return false;
    }

    if (!confirmed && getSlotCount() > 0) {
      if (hasDOMHost()) {
        const menu = this._openTitleMenu('Start another run?');
        menu.body.append(
          element(
            'p',
            `A new run will use Slot ${nextSlot}. Your existing saves, including any suspended battle, stay in their current slots. Use Continue to return to them.`,
          ),
        );
        menu.body.append(
          button(
            'Keep playing my saves',
            () => {
              this._closeTitleMenu();
              void this.runMenuTransition(() =>
                transitionToScene(
                  this,
                  'SlotPicker',
                  { gameData: this.gameData },
                  { reason: TRANSITION_REASONS.CONTINUE },
                ),
              );
            },
            're-btn re-btn--primary',
          ),
        );
        menu.body.append(
          button(`Start new run in Slot ${nextSlot}`, () => {
            this._closeTitleMenu();
            void this.runMenuTransition(() => this.handleNewGame({ confirmed: true }));
          }),
        );
        menu.focusContent();
      } else this.showMessage(`Existing saves are preserved. Choose Continue to return to them.`);
      return false;
    }

    const prevMeta = this.registry.get('meta');
    const prevHints = this.registry.get('hints');
    const prevActiveSlot = this.registry.get('activeSlot');
    const hadPrevMeta = prevMeta !== undefined;
    const hadPrevHints = prevHints !== undefined;
    const hadPrevActiveSlot = prevActiveSlot !== undefined;
    const rollbackNewGameState = () => {
      if (hadPrevMeta) this.registry.set('meta', prevMeta);
      else if (typeof this.registry.remove === 'function') this.registry.remove('meta');
      else this.registry.set('meta', undefined);

      if (hadPrevHints) this.registry.set('hints', prevHints);
      else if (typeof this.registry.remove === 'function') this.registry.remove('hints');
      else this.registry.set('hints', undefined);

      if (hadPrevActiveSlot) this.registry.set('activeSlot', prevActiveSlot);
      else if (typeof this.registry.remove === 'function') this.registry.remove('activeSlot');
      else this.registry.set('activeSlot', undefined);
    };

    const meta = new MetaProgressionManager(this.gameData.metaUpgrades, getMetaKey(nextSlot));
    const cloud = this.registry.get('cloud');
    if (cloud) {
      meta.onSave = (payload) => pushMeta(cloud.userId, nextSlot, payload);
    }
    // Stage slot state in registry (meta/hints/activeSlot) the same way
    // SlotPickerScene does before its transition.
    this.registry.set('meta', meta);
    this.registry.set(
      'hints',
      new HintManager(nextSlot, () => this.registry.get('settings')?.getHints?.() !== false, meta),
    );
    applyCompletedTutorialHints(this.registry.get('hints'));
    this.registry.set('activeSlot', nextSlot);
    try {
      // A brand-new slot is always fresh: skip Home Base / Difficulty / Blessing
      // straight to the act-1 node map. The helper commits the run and (on
      // success) increments runsStarted, which persists the slot's meta.
      const transitioned = await startFirstRunFastPath(this, {
        gameData: this.gameData,
        slot: nextSlot,
      });
      if (!transitioned) {
        rollbackNewGameState();
        return false;
      }
    } catch (err) {
      rollbackNewGameState();
      throw err;
    }

    setActiveSlot(nextSlot);
    return true;
  }

  buildTutorialRoster() {
    return _buildTutorialRoster(this.gameData);
  }

  async runMenuTransition(action) {
    if (this.isTransitioning) return;
    this.isTransitioning = true;
    this._setMenuEnabled(false);

    try {
      // First click can be both "unlock audio" + "transition". Give unlock a moment.
      await ensureAudioUnlocked(this);

      // Hard-stop title music before scene change; avoids race with unlock/load.
      const audio = this.registry.get('audio');
      if (audio) audio.releaseMusic(this, 0);
      const transitioned = await action();
      if (transitioned === false) {
        this.isTransitioning = false;
        this._setMenuEnabled(true);
        const audio = this.registry.get('audio');
        if (audio) audio.playMusic(MUSIC.title, this);
      }
    } catch (err) {
      console.error('[TitleScene] transition failed', err);
      this.isTransitioning = false;
      this._setMenuEnabled(true);
      this.showMessage(
        inputHint(
          this,
          'Transition failed. Please click again.',
          'Transition failed. Please tap again.',
        ),
      );

      // Restore title music when transition fails and we remain in this scene.
      const audio = this.registry.get('audio');
      if (audio) audio.playMusic(MUSIC.title, this);
    }
  }

  showMessage(text) {
    this.titleView?.showMessage(text);
    this._messageTimer?.remove?.();
    this._messageTimer =
      this.time?.delayedCall?.(3000, () => {
        this._messageTimer = null;
        this.titleView?.showMessage('');
      }) || null;
  }
}

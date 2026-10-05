import { showRunRecords } from '../ui/RunRecordsMenu.js';
import { applyCompletedTutorialHints, TUTORIAL_COMPLETED_KEY } from '../ui/prologueLessons.js';
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
import { buildTitleMenu, pickResumeSlot, pickUpgradeSlot } from '../ui/titleMenuModel.js';
import { readSlotMilestones, selectTitleVariant } from '../art/keyart/titleVariant.js';
import { MUSIC } from '../utils/musicConfig.js';
import { ensureAudioUnlocked } from '../utils/audioUnlock.js';
import { signOut } from '../cloud/supabaseClient.js';
import { backupAllLocalSlots, listLocalOnlySaves, pushMeta } from '../cloud/CloudSync.js';
import {
  MAX_SLOTS,
  getSlotCount,
  getSlotSummary,
  getNextAvailableSlot,
  setActiveSlot,
  getMetaKey,
  clearAllSlotData,
  prepareRecoveryLogout,
} from '../engine/SlotManager.js';
import { buildPrologueRoster } from '../engine/Prologue.js';
import { prologueBattleParams } from '../engine/ScriptedBattle.js';
import { MetaProgressionManager } from '../engine/MetaProgressionManager.js';
import { HintManager } from '../engine/HintManager.js';
import {
  startFirstRunFastPath,
  startPrologueRun,
  skipPrologueToFirstRun,
} from '../utils/firstRunFastPath.js';
import { PROLOGUE_OFFER, PROLOGUE_TITLE_MENU } from '../data/prologueContent.js';
import { logStartupSummary, markStartup } from '../utils/startupTelemetry.js';
import { startDeferredAssetWarmup } from '../utils/assetWarmup.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { MenuFocusController } from '../ui/MenuFocusController.js';
import { InputAction } from '../utils/InputActions.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { UI_PALETTE } from '../utils/uiStyles.js';
import { throttledRead } from '../utils/throttledRead.js';
import { nativeCapacitor, getNativeSaveMirror } from '../utils/nativeSaveMirror.js';

const VERSION = 'v0.1.0';
const CLOUD_EXPIRED_NOTICE = 'Cloud unavailable - local saves only (re-auth required)';

/** "Slot 2", "Slots 1 and 3", "Slots 1, 2 and 3". */
function slotList(slots) {
  const names = slots.map(String);
  if (names.length === 1) return `Slot ${names[0]}`;
  return `Slots ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/**
 * What sign-out says about the saves it discards that no backup carries
 * (CloudSync.listLocalOnlySaves: an unfinished prologue's run save stays on the
 * device). Empty for none.
 * @param {Array<{ slot: number }>} localOnly
 */
export function localOnlyDiscardText(localOnly) {
  const slots = [...new Set((localOnly || []).map((save) => save?.slot))]
    .filter((slot) => Number.isInteger(slot))
    .sort((a, b) => a - b);
  if (!slots.length) return '';
  const one = slots.length === 1;
  return one
    ? `Your unfinished prologue on ${slotList(slots)} stays on this device and can't be backed up. Signing out discards it; it starts again from the beginning.`
    : `Your unfinished prologues on ${slotList(slots)} stay on this device and can't be backed up. Signing out discards them; they start again from the beginning.`;
}

function readFlag(key) {
  try {
    return Boolean(localStorage.getItem(key));
  } catch (_) {
    return false;
  }
}

// A standalone prologue replay sets the title's slot aside (registry) and restores it.
const SLOT_REGISTRY_KEYS = ['activeSlot', 'meta', 'hints'];
const PROLOGUE_REPLAY_STASH = 'prologueReplayStash';

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
    // Back from a standalone prologue chapter: the slot the title had is its again.
    this._restoreSlotRegistry();
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
      prologueDone: readFlag(TUTORIAL_COMPLETED_KEY),
      hasPrologue: Boolean(this.prologueChapter()),
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
            { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
          ),
        );
      case 'saveSlots':
        return this.runMenuTransition(() =>
          transitionToScene(
            this,
            'SlotPicker',
            { gameData: this.gameData },
            { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
          ),
        );
      case 'prologue': {
        // A fresh device (no saves) starts the prologue run in a new slot. With saves,
        // the item offers the prologue as a new save (or the unfinished one); replaying
        // one chapter standalone (the authored roster, no RunManager, nothing saved) is
        // the lesser choice behind it (docs/specs/prologue-chapter.md §4).
        if (!this.prologueChapters().length) return undefined;
        if (getSlotCount() === 0)
          return this.runMenuTransition(() =>
            this.handleNewGame({ confirmed: true, start: 'prologue' }),
          );
        if (hasDOMHost()) this._showPrologueMenu();
        return undefined;
      }
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
   * destructive confirmation, or retry the entire backup. A save no backup can
   * carry (an unfinished prologue: CloudSync.isLocalOnlyRunSave) is discarded only
   * after its own confirmation, even when the rest of the backup succeeded.
   */
  async _handleLogout(cloud) {
    if (this._logoutInProgress || this.nativeMenu) return;
    this._logoutUserId = cloud.userId;
    this._logoutInProgress = true;
    this._setLogoutNotice('Backing up to cloud...', 'info');
    this._showLogoutProgress('Backing up saves', 'Checking that local progress reached the cloud…');
    let backup = null;
    try {
      backup = await backupAllLocalSlots(cloud.userId, { skipRecovery: true });
    } catch {
      /* Keep local data and offer a fresh, explicit decision. */
    }
    const backupConfirmed = backup?.ok === true;
    let localOnly = Array.isArray(backup?.localOnly) ? backup.localOnly : null;
    if (!localOnly) {
      try {
        localOnly = listLocalOnlySaves();
      } catch {
        localOnly = [];
      }
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
                'The backup did not finish. Playable local save slots will be deleted from this device. Damaged saves and recovery copies are kept. Progress not already in the cloud will be lost.',
              ),
            );
            const localOnlyText = localOnlyDiscardText(localOnly);
            if (localOnlyText) confirm.body.append(element('p', localOnlyText));
            confirm.body.append(
              button('Keep local saves', () => this._closeTitleMenu(), 're-btn re-btn--primary'),
            );
            confirm.body.append(
              button('Delete local saves and log out', () => {
                this._closeTitleMenu();
                void this._finishLogout({ discardLocalOnly: localOnly });
              }),
            );
            confirm.focusContent();
          }),
        );
        menu.focusContent();
      }
      return;
    }
    if (localOnly.length) {
      this._confirmLocalOnlyDiscard(localOnly);
      return;
    }
    await this._finishLogout();
  }

  /**
   * The backup succeeded but cannot carry these saves (the prologue's run save stays
   * on the device), and sign-out clears the slot cache. Ask, plainly, before
   * discarding them; without a DOM there is no one to ask, so nothing is discarded.
   */
  _confirmLocalOnlyDiscard(localOnly) {
    this._setLogoutNotice('Signing out would discard a save kept only on this device.', 'bad');
    if (!hasDOMHost()) return;
    const menu = this._openTitleMenu('Sign out?');
    menu.body.append(element('p', localOnlyDiscardText(localOnly)));
    menu.body.append(
      button(
        'Keep playing',
        () => {
          this._closeTitleMenu();
          this._setLogoutNotice('');
        },
        're-btn re-btn--primary',
      ),
    );
    menu.body.append(
      button('Sign out anyway', () => {
        if (this.nativeMenu !== menu) return;
        this._closeTitleMenu();
        void this._finishLogout({ discardLocalOnly: localOnly });
      }),
    );
    menu.focusContent();
  }

  /**
   * `discardLocalOnly`: the local-only saves the player agreed to discard. Any other
   * one found now (another tab, a retry's newer state) is asked about first, never
   * cleared unseen.
   */
  async _finishLogout({ keepUndurableRecovery = false, discardLocalOnly = [] } = {}) {
    if (this._logoutInProgress) return;
    let unconfirmed;
    try {
      const agreed = new Set((discardLocalOnly || []).map((save) => save?.slot));
      unconfirmed = listLocalOnlySaves().filter((save) => !agreed.has(save.slot));
    } catch {
      this._setLogoutNotice('Could not check this device’s saves. Nothing was deleted.', 'bad');
      return;
    }
    if (unconfirmed.length) {
      this._confirmLocalOnlyDiscard([...(discardLocalOnly || []), ...unconfirmed]);
      return;
    }
    this._logoutInProgress = true;
    const prepared = prepareRecoveryLogout(
      this._logoutUserId || this.registry?.get?.('cloud')?.userId,
    );
    if (!prepared.ok) {
      this._logoutInProgress = false;
      this._setLogoutNotice(prepared.reason, 'bad');
      return;
    }
    if (nativeCapacitor() && prepared.markers.length && !keepUndurableRecovery) {
      this._showLogoutProgress('Keeping recovery data', 'Verifying save ownership on this device…');
      try {
        const mirror = getNativeSaveMirror();
        if (!mirror) throw new Error('Device backup is unavailable. Stay signed in and retry.');
        for (const { key, raw } of prepared.markers) {
          if (!(await mirror.ensureDurable(key, raw)))
            throw new Error(
              'Recovery ownership could not be saved to disk. Stay signed in and retry.',
            );
        }
      } catch (error) {
        this._logoutInProgress = false;
        this._closeTitleMenu();
        this._setLogoutNotice(error.message, 'bad');
        if (hasDOMHost()) {
          const menu = this._openTitleMenu('Keep recovery data on this device?');
          menu.body.append(
            element(
              'p',
              'The device backup could not be verified. Your recovery data and account ownership stay in this device’s local storage when you sign out. That copy can be lost if the device clears local storage. Stay signed in to retry the device backup, or explicitly keep this local copy and sign out.',
            ),
          );
          menu.body.append(
            button('Stay signed in', () => this._closeTitleMenu(), 're-btn re-btn--primary'),
          );
          menu.body.append(
            button('Keep recovery data on this device and sign out', () => {
              if (this.nativeMenu !== menu) return;
              this._closeTitleMenu();
              void this._finishLogout({ keepUndurableRecovery: true, discardLocalOnly });
            }),
          );
          menu.focusContent();
        }
        return;
      }
    }
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
    // Sign-out clears backed-up playable cache, preserving damaged/conflicting
    // slots and recovery copies. Those stay blocked from play and cloud upload.
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
    const message = cloud?.syncStatus?.authExpired
      ? CLOUD_EXPIRED_NOTICE
      : cloud?.syncStatus?.mode === 'local_only'
        ? cloud.syncStatus.message
        : '';
    if (message === this._cloudNoticeShown) return;
    this._cloudNoticeShown = message;
    this.titleView?.setCloudNotice(message);
  }

  update() {
    this._refreshCloudSyncStatusNotice();
    const reduced = this._reducedMotion();
    if (reduced !== this._reducedMotionValue) {
      this._reducedMotionValue = reduced;
      this.titleView?.refreshMotion();
    }
  }

  /** The slot whose upgrades a new run should keep (pickUpgradeSlot), or null. */
  _slotToKeepUpgrades() {
    const summaries = Array.from({ length: MAX_SLOTS }, (_, index) => {
      const summary = getSlotSummary(index + 1);
      return summary && { ...summary, cloudConflict: Boolean(getCloudSaveConflict(index + 1)) };
    });
    return pickUpgradeSlot(summaries);
  }

  /**
   * New Game into a fresh slot. `start`: 'prologue' plays the prologue run, 'skip'
   * records the skip and takes the first-run fast path; neither, with prologue data
   * and a DOM, asks first (the offer, §4), and without a DOM the offer is the skip.
   */
  async handleNewGame({ confirmed = false, start = null } = {}) {
    const nextSlot = getNextAvailableSlot();
    // A slot with upgrades and no run in progress: a new run there keeps them.
    const keepSlot = confirmed ? null : this._slotToKeepUpgrades();
    if (!nextSlot && !keepSlot) {
      this.showMessage('All 3 save slots are full.\nDelete a slot from Save Slots to free space.');
      return false;
    }

    if (!confirmed && getSlotCount() > 0) {
      if (hasDOMHost()) this._showNewRunChoice(nextSlot, keepSlot?.slot ?? null);
      else this.showMessage(`Existing saves are preserved. Choose Save Slots to return to them.`);
      return false;
    }
    const hasPrologue = this.prologueChapters().length > 0;
    if (hasPrologue && !start) {
      if (hasDOMHost()) {
        this._showPrologueChoice(nextSlot);
        return false;
      }
      start = 'skip';
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
      // A brand-new slot is always fresh: the prologue run, or (skipped, or no
      // prologue) straight to the act-1 node map past Home Base / Difficulty /
      // Blessing. The helpers commit the run; the first-run path increments
      // runsStarted on success, which persists the slot's meta.
      const begin =
        start === 'prologue'
          ? startPrologueRun
          : start === 'skip'
            ? skipPrologueToFirstRun
            : startFirstRunFastPath;
      const transitioned = await begin(this, {
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

  /**
   * "Start another run?": where a new run goes. A slot with upgrades and no run
   * in progress (keepSlot) comes first; it opens through Save Slots' own load
   * (SlotPicker `openSlot` → selectSlot → Home Base, where Begin Run lives). An
   * empty slot (nextSlot) starts fresh; Keep playing returns to the saves.
   */
  _showNewRunChoice(nextSlot, keepSlot) {
    const menu = this._openTitleMenu('Start another run?');
    const toSlots = (data = {}) => {
      this._closeTitleMenu();
      void this.runMenuTransition(() =>
        transitionToScene(
          this,
          'SlotPicker',
          { gameData: this.gameData, ...data },
          { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
        ),
      );
    };
    const startFresh = () =>
      button(`Start new run in Slot ${nextSlot}`, () => {
        this._closeTitleMenu();
        void this.runMenuTransition(() => this.handleNewGame({ confirmed: true }));
      });
    if (keepSlot) {
      menu.body.append(
        element(
          'p',
          `Slot ${keepSlot} has no run in progress. A new run there keeps its upgrades.${nextSlot ? ` Empty Slot ${nextSlot} starts without them.` : ''} Your other saves stay as they are.`,
        ),
        button(
          `New run in Slot ${keepSlot} · keeps upgrades`,
          () => toSlots({ openSlot: keepSlot }),
          're-btn re-btn--primary',
        ),
      );
      if (nextSlot) menu.body.append(startFresh());
      menu.body.append(button('Keep playing my saves', () => toSlots()));
    } else {
      menu.body.append(
        element(
          'p',
          `A new run will use Slot ${nextSlot}. Your existing saves, including any suspended battle, stay in their current slots. Use Save Slots to return to them.`,
        ),
        button('Keep playing my saves', () => toSlots(), 're-btn re-btn--primary'),
        startFresh(),
      );
    }
    menu.focusContent();
  }

  /**
   * The prologue's offer on a fresh slot (§4): play it (the highlighted default on a
   * device that has not finished it) or skip to the first run.
   */
  _showPrologueChoice(nextSlot) {
    const menu = this._openTitleMenu(PROLOGUE_OFFER.title);
    const pick = (start) => () => {
      this._closeTitleMenu();
      void this.runMenuTransition(() => this.handleNewGame({ confirmed: true, start }));
    };
    const playFirst = !readFlag(TUTORIAL_COMPLETED_KEY);
    const play = button(
      `${PROLOGUE_OFFER.play} · ${PROLOGUE_OFFER.playSub}`,
      pick('prologue'),
      playFirst ? 're-btn re-btn--primary' : 're-btn',
    );
    const skip = button(
      PROLOGUE_OFFER.skip,
      pick('skip'),
      playFirst ? 're-btn' : 're-btn re-btn--primary',
    );
    menu.body.append(
      element('p', `${PROLOGUE_OFFER.body} A new save will use Slot ${nextSlot}.`),
      ...(playFirst ? [play, skip] : [skip, play]),
    );
    menu.focusContent();
  }

  /** The prologue's chapters in route order (the title's chapter select). */
  prologueChapters() {
    const prologue = this.gameData?.prologue;
    const chapters = Array.isArray(prologue?.chapters) ? prologue.chapters : [];
    const nodes = Array.isArray(prologue?.route?.nodes) ? prologue.route.nodes : [];
    const ordered = [...nodes]
      .filter((n) => typeof n?.chapter === 'string')
      .sort((a, b) => (a.row || 0) - (b.row || 0))
      .map((n) => chapters.find((c) => c?.id === n.chapter))
      .filter(Boolean);
    return ordered.length ? ordered : chapters;
  }

  /** The title's practice chapter: the prologue's first (null without prologue data). */
  prologueChapter() {
    return this.prologueChapters()[0] || null;
  }

  /**
   * The Prologue item on a device with saves: continue the unfinished prologue run (a
   * slot whose run is the prologue's), or play it as a new save in the next free slot
   * (New Game's prologue start, without the offer); replaying a chapter comes last.
   */
  _showPrologueMenu() {
    const menu = this._openTitleMenu(PROLOGUE_TITLE_MENU.title);
    const unfinished =
      Array.from({ length: MAX_SLOTS }, (_, index) => getSlotSummary(index + 1)).find(
        (s) => s?.hasActiveRun && s.prologueRun && !s.runCorrupt,
      ) || null;
    const nextSlot = getNextAvailableSlot();
    menu.body.append(element('p', PROLOGUE_TITLE_MENU.body));
    if (unfinished) {
      menu.body.append(
        button(
          `${PROLOGUE_TITLE_MENU.continue} · Slot ${unfinished.slot}`,
          () => {
            this._closeTitleMenu();
            void this.runMenuTransition(() =>
              transitionToScene(
                this,
                'SlotPicker',
                { gameData: this.gameData, resumeSlot: unfinished.slot },
                { reason: TRANSITION_REASONS.CONTINUE, retryBlocked: true },
              ),
            );
          },
          're-btn re-btn--primary',
        ),
      );
    }
    if (nextSlot) {
      menu.body.append(
        button(
          `${PROLOGUE_TITLE_MENU.play} · new save in Slot ${nextSlot}`,
          () => {
            this._closeTitleMenu();
            void this.runMenuTransition(() =>
              this.handleNewGame({ confirmed: true, start: 'prologue' }),
            );
          },
          unfinished ? 're-btn' : 're-btn re-btn--primary',
        ),
      );
    } else if (!unfinished) {
      menu.body.append(element('p', PROLOGUE_TITLE_MENU.full));
    }
    menu.body.append(button(PROLOGUE_TITLE_MENU.replay, () => this._showChapterSelect(), 're-btn'));
    menu.focusContent();
  }

  /** Chapter select: each chapter replays standalone; nothing is saved. */
  _showChapterSelect() {
    const menu = this._openTitleMenu('Prologue');
    menu.body.append(
      element(
        'p',
        'Replay a chapter on its own. Nothing from a replay is kept; your saves stay as they are.',
      ),
    );
    this.prologueChapters().forEach((chapter, index) => {
      menu.body.append(
        button(
          chapter.title || chapter.id,
          () => {
            this._closeTitleMenu();
            void this.runMenuTransition(() => this.startStandaloneChapter(chapter));
          },
          index === 0 ? 're-btn re-btn--primary' : 're-btn',
        ),
      );
    });
    menu.focusContent();
  }

  /**
   * Play a chapter standalone: the authored roster at the chapter's expected levels
   * (buildPrologueRoster), no RunManager. The slot the title holds (activeSlot, meta,
   * hints) is set aside so the replay cannot touch it, and comes back with the title.
   */
  async startStandaloneChapter(chapter) {
    const prologue = this.gameData?.prologue;
    if (!prologue || !chapter) return false;
    const roster = buildPrologueRoster(prologue, this.gameData, chapter);
    this._stashSlotRegistry();
    const ok = await transitionToScene(
      this,
      'Battle',
      {
        gameData: this.gameData,
        roster,
        battleParams: prologueBattleParams(chapter, { seed: prologue.seed }),
      },
      { reason: TRANSITION_REASONS.NEW_GAME, retryBlocked: true },
    );
    if (!ok) this._restoreSlotRegistry();
    return ok;
  }

  _stashSlotRegistry() {
    const registry = this.registry;
    if (!registry?.get) return;
    if (registry.get(PROLOGUE_REPLAY_STASH)) return;
    const stash = {};
    for (const key of SLOT_REGISTRY_KEYS) {
      if (registry.get(key) === undefined) continue;
      stash[key] = registry.get(key);
      if (typeof registry.remove === 'function') registry.remove(key);
      else registry.set(key, undefined);
    }
    registry.set(PROLOGUE_REPLAY_STASH, stash);
  }

  _restoreSlotRegistry() {
    const registry = this.registry;
    const stash = registry?.get?.(PROLOGUE_REPLAY_STASH);
    if (!stash) return;
    for (const key of SLOT_REGISTRY_KEYS) if (key in stash) registry.set(key, stash[key]);
    if (typeof registry.remove === 'function') registry.remove(PROLOGUE_REPLAY_STASH);
    else registry.set(PROLOGUE_REPLAY_STASH, undefined);
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

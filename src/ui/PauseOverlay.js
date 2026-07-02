// PauseOverlay — In-game pause menu (Resume / Settings / Save & Exit / Abandon Run)
// Follows StatPanel show()/hide() pattern with this.objects[].

import { SettingsOverlay } from './SettingsOverlay.js';
import { HelpOverlay } from './HelpOverlay.js';
import { CampaignMapOverlay } from './CampaignMapOverlay.js';
import { CompendiumOverlay } from './CompendiumOverlay.js';
import { BoundingFocusController } from './BoundingFocusController.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';

export class PauseOverlay {
  /**
   * @param {Phaser.Scene} scene
   * @param {{ onResume: Function, onSaveAndExit?: Function, onAbandon?: Function, onSaveAndExitWarning?: string }} callbacks
   */
  constructor(
    scene,
    { onResume, onSaveAndExit, onAbandon, onSaveAndExitWarning, campaignMapData, gameData },
  ) {
    this.scene = scene;
    this.onResume = onResume;
    this.onSaveAndExit = onSaveAndExit || null;
    this.onSaveAndExitWarning = onSaveAndExitWarning || null;
    this.onAbandon = onAbandon;
    this.campaignMapData = campaignMapData || null;
    this.gameData = gameData || null;
    this.objects = [];
    this.visible = false;
    this.settingsOverlay = null;
    this.helpOverlay = null;
    this.campaignMapOverlay = null;
    this.compendiumOverlay = null;
    this.confirmObjects = [];
    // Gamepad/keyboard focus: a gold ring over the menu buttons (or the active
    // confirm modal). _menuButtons/_confirmButtons are the live focus targets.
    this._menuButtons = [];
    this._confirmButtons = [];
    this._focus = null;
    this._onInputActionBound = null;
    this._onTopChangeBound = null;
  }

  /** Returns true if any child overlay (Help, Settings, Compendium, CampaignMap) is open. */
  hasActiveSubOverlay() {
    return !!(
      this.helpOverlay?.visible ||
      this.settingsOverlay?.visible ||
      this.campaignMapOverlay?.visible ||
      this.compendiumOverlay?.visible
    );
  }

  /** Closes any active sub-overlay. Returns true if one was closed. */
  closeActiveSubOverlay() {
    if (this.compendiumOverlay?.visible) {
      this.compendiumOverlay.hide();
      return true;
    }
    if (this.helpOverlay?.visible) {
      this.helpOverlay.hide();
      return true;
    }
    if (this.settingsOverlay?.visible) {
      this.settingsOverlay.hide();
      return true;
    }
    if (this.campaignMapOverlay?.visible) {
      this.campaignMapOverlay.hide();
      return true;
    }
    return false;
  }

  show() {
    // Clean up stale objects without triggering onResume callback
    if (this.helpOverlay?.visible) this.helpOverlay.hide();
    if (this.settingsOverlay?.visible) this.settingsOverlay.hide();
    if (this.campaignMapOverlay?.visible) this.campaignMapOverlay.hide();
    if (this.compendiumOverlay?.visible) this.compendiumOverlay.hide();
    this._hideConfirm();
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this._menuButtons = [];
    this.visible = true;

    const cx = this.scene.cameras.main.centerX;
    const cy = this.scene.cameras.main.centerY;

    // Count buttons to size panel
    let buttonCount = 3; // Resume + Settings + Help always
    if (this.gameData) buttonCount++; // Compendium
    if (this.campaignMapData) buttonCount++;
    if (this.onSaveAndExit) buttonCount++;
    if (this.onAbandon) buttonCount++;
    const panelHeight = 100 + buttonCount * 40;

    // Dark background
    const bg = this.scene.add
      .rectangle(cx, cy, 640, 480, 0x000000, 0.8)
      .setDepth(800)
      .setInteractive();
    this.objects.push(bg);

    // Panel
    const panel = this.scene.add
      .rectangle(cx, cy, 260, panelHeight, 0x1a1a2e, 1)
      .setDepth(801)
      .setStrokeStyle(2, 0x888888);
    this.objects.push(panel);

    // Title
    const title = this.scene.add
      .text(cx, cy - panelHeight / 2 + 25, 'Paused', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(802);
    this.objects.push(title);

    // Buttons
    let btnY = cy - panelHeight / 2 + 65;

    // Resume
    this._addButton(cx, btnY, 'Resume', () => this.hide());
    btnY += 40;

    // Settings
    this._addButton(cx, btnY, 'Settings', () => {
      if (this.settingsOverlay?.visible) return;
      this._hideConfirm();
      this.settingsOverlay = new SettingsOverlay(this.scene, null);
      this.settingsOverlay.show();
    });
    btnY += 40;

    // More Info
    this._addButton(cx, btnY, 'More Info', () => {
      if (this.helpOverlay?.visible) return;
      this._hideConfirm();
      this.helpOverlay = new HelpOverlay(this.scene, () => {
        this.helpOverlay = null;
      });
      this.helpOverlay.show();
    });
    btnY += 40;

    // Compendium (only when gameData available)
    if (this.gameData) {
      this._addButton(cx, btnY, 'Compendium', () => {
        if (this.compendiumOverlay?.visible) return;
        this._hideConfirm(); // auto-dismiss any active confirm modal
        this.compendiumOverlay = new CompendiumOverlay(this.scene, this.gameData, () => {
          this.compendiumOverlay = null;
        });
        this.compendiumOverlay.show();
      });
      btnY += 40;
    }

    // Campaign Map (only when run data available)
    if (this.campaignMapData) {
      this._addButton(cx, btnY, 'Campaign Map', () => {
        if (this.campaignMapOverlay?.visible) return;
        this._hideConfirm();
        this.campaignMapOverlay = new CampaignMapOverlay(this.scene, {
          ...this.campaignMapData,
          onClose: () => {
            this.campaignMapOverlay = null;
          },
        });
        this.campaignMapOverlay.show();
      });
      btnY += 40;
    }

    // Save & Return to Title
    if (this.onSaveAndExit) {
      this._addButton(
        cx,
        btnY,
        'Save & Return to Title',
        () => {
          if (this.onSaveAndExitWarning) {
            this._showConfirm(
              this.onSaveAndExitWarning,
              () => {
                this.hideForTransition();
                Promise.resolve()
                  .then(() => this.onSaveAndExit())
                  .catch((err) => {
                    console.error('[PauseOverlay] onSaveAndExit rejected:', err);
                  });
              },
              '#88ccff',
            );
            return;
          }
          this.hideForTransition();
          Promise.resolve()
            .then(() => this.onSaveAndExit())
            .catch((err) => {
              console.error('[PauseOverlay] onSaveAndExit rejected:', err);
            });
        },
        '#88ccff',
      );
      btnY += 40;
    }

    // Abandon Run (only if callback provided)
    if (this.onAbandon) {
      this._addButton(
        cx,
        btnY,
        'Abandon Run',
        () => {
          this._showConfirm(
            'Abandon this run?\nProgress will be lost.',
            () => {
              this.hideForTransition();
              if (this.onAbandon) {
                Promise.resolve()
                  .then(() => this.onAbandon())
                  .catch((err) => {
                    console.error('[PauseOverlay] onAbandon rejected:', err);
                  });
              }
            },
            '#cc5555',
          );
        },
        '#cc5555',
      );
    }

    this._setupFocus();
  }

  // Build the focus ring over the menu buttons and claim the input-focus stack so
  // the pad drives the pause menu instead of the scene behind it. Popped in hide().
  _setupFocus() {
    if (!this._focus) this._focus = new BoundingFocusController(this.scene, 860);
    this._focus.setObjects(this._menuButtons, true);
    if (!this._onInputActionBound) {
      this._onInputActionBound = (action, payload) => this._onInputAction(action, payload);
    }
    // When a sub-overlay (Settings/Help/Compendium/Campaign Map) pushes its own scope
    // on top, hide the pause ring so it doesn't float over the sub-overlay (the
    // Campaign Map panel sits BELOW the ring's depth); restore it when re-exposed.
    if (!this._onTopChangeBound) {
      this._onTopChangeBound = (isTop) => this._focus?.setRingVisible(isTop);
    }
    pushInputScope(this, this._onInputActionBound, this._onTopChangeBound);
  }

  // Route device-independent input actions while the pause menu owns the stack.
  _onInputAction(action, payload) {
    if (!this.visible) return;
    // Each sub-overlay (Settings / More Info / Compendium / Campaign Map) now pushes
    // its own input-focus scope, so while one is open the LIFO bus routes actions to
    // it directly and this handler isn't reached. This block is a defensive fallback
    // (e.g. mid-transition) that confines the pad to backing out of the sub-overlay.
    if (this.hasActiveSubOverlay()) {
      if (action === InputAction.CANCEL || action === InputAction.PAUSE) {
        this.closeActiveSubOverlay();
      }
      return;
    }
    const onConfirm = this._confirmButtons.length > 0;
    switch (action) {
      case InputAction.NAVIGATE:
        // Main menu is a vertical list (dy); the confirm modal is Yes/Cancel side
        // by side (dx).
        this._focus?.move(onConfirm ? payload?.dx || 0 : payload?.dy || 0);
        break;
      case InputAction.CONFIRM:
        this._focus?.activate();
        break;
      case InputAction.CANCEL:
      case InputAction.PAUSE:
        // Back out of a confirm; otherwise Resume (Start un-pauses too).
        if (onConfirm) this._hideConfirm();
        else this.hide();
        break;
    }
  }

  _addButton(x, y, label, onClick, color = '#e0e0e0') {
    const btn = this.scene.add
      .text(x, y, label, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color,
        backgroundColor: '#333333',
        padding: { x: 16, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(802)
      .setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setColor('#ffdd44'));
    btn.on('pointerout', () => btn.setColor(color));
    btn.on('pointerdown', onClick);
    this.objects.push(btn);
    this._menuButtons.push(btn);
  }

  _showConfirm(message, onConfirm, confirmColor = '#cc5555') {
    this._hideConfirm();
    const cx = this.scene.cameras.main.centerX;
    const cy = this.scene.cameras.main.centerY;

    const bg = this.scene.add
      .rectangle(cx, cy, 320, 120, 0x1a1a2e, 1)
      .setDepth(850)
      .setStrokeStyle(2, 0xcc5555)
      .setInteractive();
    this.confirmObjects.push(bg);

    const msg = this.scene.add
      .text(cx, cy - 30, message, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#e0e0e0',
        align: 'center',
      })
      .setOrigin(0.5)
      .setDepth(851);
    this.confirmObjects.push(msg);

    const yesBtn = this.scene.add
      .text(cx - 50, cy + 25, 'Yes', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: confirmColor,
        backgroundColor: '#333333',
        padding: { x: 12, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(851)
      .setInteractive({ useHandCursor: true });
    yesBtn.on('pointerover', () => yesBtn.setColor('#ffdd44'));
    yesBtn.on('pointerout', () => yesBtn.setColor(confirmColor));
    yesBtn.on('pointerdown', () => onConfirm());
    this.confirmObjects.push(yesBtn);

    const cancelBtn = this.scene.add
      .text(cx + 50, cy + 25, 'Cancel', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#e0e0e0',
        backgroundColor: '#333333',
        padding: { x: 12, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(851)
      .setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setColor('#ffdd44'));
    cancelBtn.on('pointerout', () => cancelBtn.setColor('#e0e0e0'));
    cancelBtn.on('pointerdown', () => this._hideConfirm());
    this.confirmObjects.push(cancelBtn);

    // Hand the focus ring to the modal (Yes first).
    this._confirmButtons = [yesBtn, cancelBtn];
    this._focus?.setObjects(this._confirmButtons, true);
  }

  _hideConfirm() {
    const hadConfirm = this._confirmButtons.length > 0;
    this._confirmButtons = [];
    // Drop the ring's reference to the modal buttons BEFORE destroying them.
    if (hadConfirm && this._focus) this._focus.clear();
    for (const obj of this.confirmObjects) obj.destroy();
    this.confirmObjects = [];
    // Return focus to the main menu (unless we're tearing the whole overlay down).
    if (hadConfirm && this.visible) this._focus?.setObjects(this._menuButtons, true);
  }

  hide() {
    if (this.compendiumOverlay?.visible) this.compendiumOverlay.hide();
    if (this.helpOverlay?.visible) this.helpOverlay.hide();
    if (this.settingsOverlay?.visible) this.settingsOverlay.hide();
    if (this.campaignMapOverlay?.visible) this.campaignMapOverlay.hide();
    this._hideConfirm();
    this._teardownFocus();
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this._menuButtons = [];
    this.visible = false;
    if (this.onResume) this.onResume();
  }

  _teardownFocus() {
    if (this._onInputActionBound) {
      popInputScope(this);
      this._onInputActionBound = null;
    }
    this._onTopChangeBound = null;
    if (this._focus) {
      this._focus.destroy();
      this._focus = null;
    }
    this._confirmButtons = [];
  }

  /** Like hide(), but skips onResume — used before destructive transitions (Save & Exit, Abandon). */
  hideForTransition() {
    if (this.compendiumOverlay?.visible) this.compendiumOverlay.hide();
    if (this.helpOverlay?.visible) this.helpOverlay.hide();
    if (this.settingsOverlay?.visible) this.settingsOverlay.hide();
    if (this.campaignMapOverlay?.visible) this.campaignMapOverlay.hide();
    this._hideConfirm();
    this._teardownFocus();
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this._menuButtons = [];
    this.visible = false;
  }
}

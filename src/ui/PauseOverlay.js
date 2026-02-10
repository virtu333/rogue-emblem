// PauseOverlay — In-game pause menu (Resume / Settings / Save & Exit / Abandon Run)
// Follows StatPanel show()/hide() pattern with this.objects[].

import { SettingsOverlay } from './SettingsOverlay.js';
import { HelpOverlay } from './HelpOverlay.js';

export class PauseOverlay {
  /**
   * @param {Phaser.Scene} scene
   * @param {{ onResume: Function, onSaveAndExit?: Function, onAbandon?: Function, onSaveAndExitWarning?: string }} callbacks
   */
  constructor(scene, { onResume, onSaveAndExit, onAbandon, onSaveAndExitWarning }) {
    this.scene = scene;
    this.onResume = onResume;
    this.onSaveAndExit = onSaveAndExit || null;
    this.onSaveAndExitWarning = onSaveAndExitWarning || null;
    this.onAbandon = onAbandon;
    this.objects = [];
    this.visible = false;
    this.settingsOverlay = null;
    this.helpOverlay = null;
    this.confirmObjects = [];
  }

  show() {
    this.hide();
    this.visible = true;

    const cx = this.scene.cameras.main.centerX;
    const cy = this.scene.cameras.main.centerY;

    // Count buttons to size panel
    let buttonCount = 3; // Resume + Settings + Help always
    if (this.onSaveAndExit) buttonCount++;
    if (this.onAbandon) buttonCount++;
    const panelHeight = 100 + buttonCount * 40;

    // Dark background
    const bg = this.scene.add.rectangle(cx, cy, 640, 480, 0x000000, 0.8)
      .setDepth(800).setInteractive();
    this.objects.push(bg);

    // Panel
    const panel = this.scene.add.rectangle(cx, cy, 260, panelHeight, 0x1a1a2e, 1)
      .setDepth(801).setStrokeStyle(2, 0x888888);
    this.objects.push(panel);

    // Title
    const title = this.scene.add.text(cx, cy - panelHeight / 2 + 25, 'Paused', {
      fontFamily: 'monospace', fontSize: '20px', color: '#ffdd44',
    }).setOrigin(0.5).setDepth(802);
    this.objects.push(title);

    // Buttons
    let btnY = cy - panelHeight / 2 + 65;

    // Resume
    this._addButton(cx, btnY, 'Resume', () => this.hide());
    btnY += 40;

    // Settings
    this._addButton(cx, btnY, 'Settings', () => {
      if (this.settingsOverlay?.visible) return;
      this.settingsOverlay = new SettingsOverlay(this.scene, null);
      this.settingsOverlay.show();
    });
    btnY += 40;

    // Help
    this._addButton(cx, btnY, 'Help', () => {
      if (this.helpOverlay?.visible) return;
      this.helpOverlay = new HelpOverlay(this.scene, () => { this.helpOverlay = null; });
      this.helpOverlay.show();
    });
    btnY += 40;

    // Save & Return to Title
    if (this.onSaveAndExit) {
      this._addButton(cx, btnY, 'Save & Return to Title', () => {
        if (this.onSaveAndExitWarning) {
          this._showConfirm(this.onSaveAndExitWarning, () => {
            this.hide();
            this.onSaveAndExit();
          }, '#88ccff');
          return;
        }
        this.hide();
        this.onSaveAndExit();
      }, '#88ccff');
      btnY += 40;
    }

    // Abandon Run (only if callback provided)
    if (this.onAbandon) {
      this._addButton(cx, btnY, 'Abandon Run', () => {
        this._showConfirm('Abandon this run?\nProgress will be lost.', () => {
          this.hide();
          if (this.onAbandon) this.onAbandon();
        }, '#cc5555');
      }, '#cc5555');
    }
  }

  _addButton(x, y, label, onClick, color = '#e0e0e0') {
    const btn = this.scene.add.text(x, y, label, {
      fontFamily: 'monospace', fontSize: '14px', color,
      backgroundColor: '#333333', padding: { x: 16, y: 6 },
    }).setOrigin(0.5).setDepth(802).setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setColor('#ffdd44'));
    btn.on('pointerout', () => btn.setColor(color));
    btn.on('pointerdown', onClick);
    this.objects.push(btn);
  }

  _showConfirm(message, onConfirm, confirmColor = '#cc5555') {
    this._hideConfirm();
    const cx = this.scene.cameras.main.centerX;
    const cy = this.scene.cameras.main.centerY;

    const bg = this.scene.add.rectangle(cx, cy, 320, 120, 0x1a1a2e, 1)
      .setDepth(850).setStrokeStyle(2, 0xcc5555);
    this.confirmObjects.push(bg);

    const msg = this.scene.add.text(cx, cy - 30, message, {
      fontFamily: 'monospace', fontSize: '12px', color: '#e0e0e0', align: 'center',
    }).setOrigin(0.5).setDepth(851);
    this.confirmObjects.push(msg);

    const yesBtn = this.scene.add.text(cx - 50, cy + 25, 'Yes', {
      fontFamily: 'monospace', fontSize: '14px', color: confirmColor,
      backgroundColor: '#333333', padding: { x: 12, y: 4 },
    }).setOrigin(0.5).setDepth(851).setInteractive({ useHandCursor: true });
    yesBtn.on('pointerover', () => yesBtn.setColor('#ffdd44'));
    yesBtn.on('pointerout', () => yesBtn.setColor(confirmColor));
    yesBtn.on('pointerdown', () => onConfirm());
    this.confirmObjects.push(yesBtn);

    const cancelBtn = this.scene.add.text(cx + 50, cy + 25, 'Cancel', {
      fontFamily: 'monospace', fontSize: '14px', color: '#e0e0e0',
      backgroundColor: '#333333', padding: { x: 12, y: 4 },
    }).setOrigin(0.5).setDepth(851).setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setColor('#ffdd44'));
    cancelBtn.on('pointerout', () => cancelBtn.setColor('#e0e0e0'));
    cancelBtn.on('pointerdown', () => this._hideConfirm());
    this.confirmObjects.push(cancelBtn);
  }

  _hideConfirm() {
    for (const obj of this.confirmObjects) obj.destroy();
    this.confirmObjects = [];
  }

  hide() {
    if (this.helpOverlay?.visible) this.helpOverlay.hide();
    if (this.settingsOverlay?.visible) this.settingsOverlay.hide();
    this._hideConfirm();
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
    if (this.onResume) this.onResume();
  }
}

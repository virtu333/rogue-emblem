// DialogueOverlay.js — Lightweight dialogue box with portrait
// Blocking overlay with auto-dismiss timer and manual [X] or ESC to close.

const DEPTH = 960;

export class DialogueOverlay {
  /**
   * @param {Phaser.Scene} scene
   */
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    this.visible = false;
    this._timer = null;
  }

  /**
   * Show recruitment dialogue.
   * @param {string} name - unit name
   * @param {string} line - dialogue line
   * @param {string} portraitKey - key for portrait image
   * @returns {Promise<void>} resolves when dismissed
   */
  show(name, line, portraitKey) {
    return new Promise(resolve => {
      this.hide();
      this.visible = true;

      const cam = this.scene.cameras.main;
      const cx = cam.centerX;
      const cy = cam.centerY;

      // Blocking background (nearly invisible but intercepts input)
      const blocker = this.scene.add.rectangle(cx, cy, cam.width, cam.height, 0x000000, 0.01)
        .setDepth(DEPTH).setInteractive();
      this.objects.push(blocker);

      // Main box
      const boxW = 320;
      const boxH = 80;
      const boxY = cy + 100; // Positioned lower on screen
      const bg = this.scene.add.rectangle(cx, boxY, boxW, boxH, 0x000000, 0.9)
        .setStrokeStyle(2, 0x4466aa).setDepth(DEPTH + 1);
      this.objects.push(bg);

      // Portrait
      if (portraitKey && this.scene.textures.exists(portraitKey)) {
        const portrait = this.scene.add.image(cx - boxW / 2 + 40, boxY, portraitKey)
          .setDisplaySize(64, 64).setDepth(DEPTH + 2);
        this.objects.push(portrait);
      }

      // Name label
      const nameText = this.scene.add.text(cx - boxW / 2 + 80, boxY - boxH / 2 + 10, name, {
        fontFamily: 'monospace', fontSize: '12px', color: '#ffdd44', fontStyle: 'bold',
      }).setDepth(DEPTH + 2);
      this.objects.push(nameText);

      // Line text
      const lineText = this.scene.add.text(cx - boxW / 2 + 80, boxY - boxH / 2 + 28, line, {
        fontFamily: 'monospace', fontSize: '11px', color: '#ffffff',
        wordWrap: { width: boxW - 100 }, lineSpacing: 2,
      }).setDepth(DEPTH + 2);
      this.objects.push(lineText);

      // Close hint / [X]
      const closeHint = this.scene.add.text(cx + boxW / 2 - 10, boxY - boxH / 2 + 10, 'X', {
        fontFamily: 'monospace', fontSize: '12px', color: '#888888',
      }).setOrigin(1, 0).setDepth(DEPTH + 2).setInteractive({ useHandCursor: true });
      this.objects.push(closeHint);

      const onDismiss = () => {
        this.hide();
        resolve();
      };

      closeHint.on('pointerdown', onDismiss);
      blocker.on('pointerdown', onDismiss);

      // Timer
      this._timer = this.scene.time.delayedCall(3000, onDismiss);

      // Keyboard
      this._escKey = this.scene.input.keyboard.addKey('ESC');
      this._spaceKey = this.scene.input.keyboard.addKey('SPACE');
      this._enterKey = this.scene.input.keyboard.addKey('ENTER');

      this._escKey.once('down', onDismiss);
      this._spaceKey.once('down', onDismiss);
      this._enterKey.once('down', onDismiss);
    });
  }

  hide() {
    if (this._timer) {
      this._timer.remove();
      this._timer = null;
    }
    if (this._escKey) {
      this._escKey.off('down');
      this._spaceKey.off('down');
      this._enterKey.off('down');
    }
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
  }
}

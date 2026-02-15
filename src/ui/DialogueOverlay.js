// DialogueOverlay.js - Lightweight dialogue box with portrait support.
// Recruit dialogue auto-dismisses; story sequences are manual-advance.

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
    this._escKey = null;
    this._spaceKey = null;
    this._enterKey = null;
    this._dismissHandler = null;
    this._pendingResolve = null;
    this._sequenceSkipRequested = false;
    this._destroyed = false;

    this._onSceneShutdown = () => this.destroy();
    this.scene?.events?.once?.('shutdown', this._onSceneShutdown);
  }

  /**
   * Show recruitment dialogue (auto-dismiss after 3s).
   * @param {string} name
   * @param {string} line
   * @param {string|null} portraitKey
   * @returns {Promise<void>}
   */
  show(name, line, portraitKey) {
    return this._showEntry(name, line, portraitKey, true);
  }

  /**
   * Show a manual-advance story sequence.
   * @param {Array<{speaker?: string|null, portrait?: string|null, line?: string}>} entries
   * @returns {Promise<void>}
   */
  async showSequence(entries) {
    if (!Array.isArray(entries) || entries.length <= 0 || this._destroyed) return;
    this._sequenceSkipRequested = false;
    for (let i = 0; i < entries.length; i++) {
      if (this._sequenceSkipRequested || this._destroyed) break;
      const entry = entries[i] || {};
      const remaining = entries.length - i - 1;
      await this._showEntry(
        entry.speaker ?? null,
        entry.line ?? '',
        entry.portrait ?? null,
        false,
        {
          allowSkip: remaining > 0,
          onSkip: () => {
            this._sequenceSkipRequested = true;
          },
        }
      );
    }
    this._sequenceSkipRequested = false;
  }

  _showEntry(name, line, portraitKey, autoAdvance, options = {}) {
    if (this._destroyed || !this.scene) return Promise.resolve();
    const { allowSkip = false, onSkip = null } = options;
    this.hide();
    this.visible = true;

    const scene = this.scene;
    const cam = scene.cameras.main;
    const cx = cam.centerX;
    const cy = cam.centerY;
    const hasSpeaker = typeof name === 'string' && name.trim().length > 0;
    const hasPortrait = Boolean(
      hasSpeaker
      && portraitKey
      && scene.textures?.exists?.(portraitKey)
    );

    // Blocking background (nearly invisible but intercepts input).
    const blocker = scene.add.rectangle(cx, cy, cam.width, cam.height, 0x000000, 0.01)
      .setDepth(DEPTH)
      .setInteractive();
    this.objects.push(blocker);

    // Main box.
    const boxW = 360;
    const boxH = 96;
    const boxY = cy + 100;
    const bg = scene.add.rectangle(cx, boxY, boxW, boxH, 0x000000, 0.9)
      .setStrokeStyle(2, 0x4466aa)
      .setDepth(DEPTH + 1);
    this.objects.push(bg);

    const lineTop = boxY - boxH / 2 + 24;
    const textLeft = cx - boxW / 2 + 14;

    if (hasPortrait) {
      const portrait = scene.add.image(cx - boxW / 2 + 40, boxY, portraitKey)
        .setDisplaySize(64, 64)
        .setDepth(DEPTH + 2);
      this.objects.push(portrait);
    }

    if (hasSpeaker) {
      const nameX = hasPortrait ? cx - boxW / 2 + 80 : textLeft;
      const nameText = scene.add.text(nameX, boxY - boxH / 2 + 10, name, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffdd44',
        fontStyle: 'bold',
      }).setDepth(DEPTH + 2);
      this.objects.push(nameText);
    }

    if (hasSpeaker) {
      const lineX = hasPortrait ? cx - boxW / 2 + 80 : textLeft;
      const lineWrap = hasPortrait ? boxW - 100 : boxW - 28;
      const lineText = scene.add.text(lineX, lineTop, String(line || ''), {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffffff',
        wordWrap: { width: lineWrap },
        lineSpacing: 2,
      }).setDepth(DEPTH + 2);
      this.objects.push(lineText);
    } else {
      const lineText = scene.add.text(cx, boxY, String(line || ''), {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#ffffff',
        align: 'center',
        wordWrap: { width: boxW - 28 },
        lineSpacing: 2,
      }).setOrigin(0.5).setDepth(DEPTH + 2);
      this.objects.push(lineText);
    }

    const closeHint = scene.add.text(cx + boxW / 2 - 10, boxY - boxH / 2 + 10, 'X', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#888888',
    }).setOrigin(1, 0).setDepth(DEPTH + 2).setInteractive({ useHandCursor: true });
    this.objects.push(closeHint);

    let skipText = null;
    if (allowSkip) {
      skipText = scene.add.text(cx + boxW / 2 - 10, boxY + boxH / 2 - 10, '[Skip]', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#999999',
      }).setOrigin(1, 1).setDepth(DEPTH + 2).setInteractive({ useHandCursor: true });
      this.objects.push(skipText);
    }

    return new Promise((resolve) => {
      this._pendingResolve = resolve;
      let dismissed = false;

      const onDismiss = () => {
        if (dismissed) return;
        dismissed = true;
        this.hide();
      };

      const onSkipClick = () => {
        if (dismissed) return;
        if (typeof onSkip === 'function') onSkip();
        onDismiss();
      };

      this._dismissHandler = onDismiss;

      closeHint.on('pointerdown', onDismiss);
      blocker.on('pointerdown', onDismiss);
      if (skipText) skipText.on('pointerdown', onSkipClick);

      if (autoAdvance) {
        this._timer = scene.time.delayedCall(3000, onDismiss);
      }

      const keyboard = scene.input?.keyboard;
      if (keyboard?.addKey) {
        this._escKey = keyboard.addKey('ESC');
        this._spaceKey = keyboard.addKey('SPACE');
        this._enterKey = keyboard.addKey('ENTER');
        this._escKey?.once?.('down', this._dismissHandler);
        this._spaceKey?.once?.('down', this._dismissHandler);
        this._enterKey?.once?.('down', this._dismissHandler);
      }
    });
  }

  _resolvePending() {
    const resolve = this._pendingResolve;
    this._pendingResolve = null;
    if (resolve) resolve();
  }

  hide() {
    if (this._timer) {
      this._timer.remove();
      this._timer = null;
    }

    if (this._dismissHandler) {
      this._escKey?.off?.('down', this._dismissHandler);
      this._spaceKey?.off?.('down', this._dismissHandler);
      this._enterKey?.off?.('down', this._dismissHandler);
      this._dismissHandler = null;
    }

    this._escKey = null;
    this._spaceKey = null;
    this._enterKey = null;

    for (const obj of this.objects) {
      try {
        obj.destroy();
      } catch (_) {}
    }
    this.objects = [];
    this.visible = false;
    this._resolvePending();
  }

  destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this.hide();
    this.scene = null;
  }
}
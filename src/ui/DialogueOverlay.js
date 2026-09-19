import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import { UI_PALETTE, applyTextResolution } from '../utils/uiStyles.js';
import { dialoguePortraitKey } from './RebuiltPortraits.js';
import { hasDOMHost } from '../utils/domUI.js';
import { textureImageSource } from './textureImageSource.js';
import { MenuSurface, element, button } from './MenuSurface.js';
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
        },
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
    portraitKey = dialoguePortraitKey(scene, name, portraitKey);
    if (hasDOMHost()) return this._showDOM(name, line, portraitKey, autoAdvance, options);
    const cam = scene.cameras.main;
    const cx = cam.centerX;
    const cy = cam.centerY;
    const hasSpeaker = typeof name === 'string' && name.trim().length > 0;
    const hasPortrait = Boolean(hasSpeaker && portraitKey && scene.textures?.exists?.(portraitKey));

    // Blocking background (nearly invisible but intercepts input).
    const blocker = scene.add
      .rectangle(cx, cy, cam.width, cam.height, 0x000000, 0.01)
      .setDepth(DEPTH)
      .setInteractive();
    this.objects.push(blocker);

    // Main box.
    const boxW = 360;
    const boxH = 110;
    const boxY = cy + 100;
    const bg = scene.add
      .rectangle(cx, boxY, boxW, boxH, 0x000000, 0.9)
      .setStrokeStyle(2, 0x4466aa)
      .setDepth(DEPTH + 1);
    this.objects.push(bg);

    const lineTop = boxY - boxH / 2 + 24;
    const textLeft = cx - boxW / 2 + 14;

    if (hasPortrait) {
      const portrait = scene.add
        .image(cx - boxW / 2 + 40, boxY, portraitKey)
        .setDisplaySize(64, 64)
        .setDepth(DEPTH + 2);
      const source = scene.textures.get?.(portraitKey)?.getSourceImage?.();
      if (source?.width && source?.height) {
        const scale = Math.min(64 / source.width, 80 / source.height);
        portrait.setDisplaySize(source.width * scale, source.height * scale);
      }
      this.objects.push(portrait);
    }

    if (hasSpeaker) {
      const nameX = hasPortrait ? cx - boxW / 2 + 80 : textLeft;
      const nameText = applyTextResolution(
        scene.add.text(nameX, boxY - boxH / 2 + 10, name, {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: UI_PALETTE.accent,
          fontStyle: 'bold',
        }),
      ).setDepth(DEPTH + 2);
      this.objects.push(nameText);
    }

    if (hasSpeaker) {
      const lineX = hasPortrait ? cx - boxW / 2 + 80 : textLeft;
      const lineWrap = hasPortrait ? boxW - 100 : boxW - 28;
      const lineText = applyTextResolution(
        scene.add.text(lineX, lineTop, String(line || ''), {
          fontFamily: 'Arial',
          fontSize: '11px',
          color: UI_PALETTE.text,
          wordWrap: { width: lineWrap },
          lineSpacing: 2,
        }),
      ).setDepth(DEPTH + 2);
      this.objects.push(lineText);
    } else {
      const lineText = applyTextResolution(
        scene.add.text(cx, boxY, String(line || ''), {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: UI_PALETTE.text,
          align: 'center',
          wordWrap: { width: boxW - 28 },
          lineSpacing: 2,
        }),
      )
        .setOrigin(0.5)
        .setDepth(DEPTH + 2);
      this.objects.push(lineText);
    }

    const closeHint = applyTextResolution(
      scene.add.text(cx + boxW / 2 - 10, boxY - boxH / 2 + 10, 'X', {
        fontFamily: 'Arial',
        fontSize: '12px',
        color: UI_PALETTE.muted,
      }),
    )
      .setOrigin(1, 0)
      .setDepth(DEPTH + 2)
      .setInteractive({ useHandCursor: true });
    this.objects.push(closeHint);

    let skipText = null;
    if (allowSkip) {
      skipText = applyTextResolution(
        scene.add.text(cx + boxW / 2 - 10, boxY + boxH / 2 - 10, '[Skip]', {
          fontFamily: 'Arial',
          fontSize: '10px',
          color: UI_PALETTE.muted,
        }),
      )
        .setOrigin(1, 1)
        .setDepth(DEPTH + 2)
        .setInteractive({ useHandCursor: true });
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

  _showDOM(name, line, portraitKey, autoAdvance, { allowSkip, onSkip }) {
    return new Promise((resolve) => {
      this._pendingResolve = resolve;
      this.surface = new MenuSurface(this.scene, name || 'Story', () => this.hide());
      this.surface.root.className = 're re-screen re-dialogue';
      this.surface.root.style.setProperty('--re-z', DOM_UI_DEPTHS.DIALOGUE);
      this.surface.root.replaceChildren();
      const panel = element('div', null, 're-panel');
      const copy = element('div', null, 're-dialogue-copy');
      if (portraitKey && this.scene.textures.exists(portraitKey)) {
        const image = element('img');
        image.src = textureImageSource(this.scene.textures.get(portraitKey));
        image.alt = name || '';
        copy.append(image);
      }
      const text = element('div');
      if (name) text.append(element('h2', name));
      text.append(element('p', String(line || '')));
      copy.append(text);
      const footer = element('footer');
      if (allowSkip)
        footer.append(
          button(
            'Skip conversation',
            () => {
              onSkip?.();
              this.hide();
            },
            're-btn re-btn--quiet',
          ),
        );
      const next = button('Continue', () => this.hide(), 're-btn re-btn--primary');
      footer.append(next);
      panel.append(copy, footer);
      this.surface.root.append(panel);
      next.focus();
      if (autoAdvance) this._timer = this.scene.time.delayedCall(3000, () => this.hide());
    });
  }

  _resolvePending() {
    const resolve = this._pendingResolve;
    this._pendingResolve = null;
    if (resolve) resolve();
  }

  hide() {
    this.surface?.destroy();
    this.surface = null;
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

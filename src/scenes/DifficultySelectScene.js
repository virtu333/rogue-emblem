import { hasDOMHost } from '../utils/domUI.js';
import { RunSetupMenu } from '../ui/RunSetupMenu.js';
import { UI_PALETTE, UI_HEX, applyTextResolution } from '../utils/uiStyles.js';
import { inputHint } from '../utils/inputHint.js';
// DifficultySelectScene — Choose difficulty before starting a run

import Phaser from 'phaser';
import { MUSIC } from '../utils/musicConfig.js';
import { resolveStartingLordDefs } from '../engine/Commander.js';
import { DIFFICULTY_IDS, generateModifierSummary } from '../engine/DifficultyEngine.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { hasAnySlotMilestone } from '../engine/SlotManager.js';
import { InputAction } from '../utils/InputActions.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';

export class DifficultySelectScene extends Phaser.Scene {
  constructor() {
    super('DifficultySelect');
  }

  init(data) {
    this.gameData = data.gameData;
    this.isTransitioning = false;
    this._noMetaUpgrades = data.noMetaUpgrades === true;
  }

  create() {
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.homeBase, this);

    this._onKeyLeft = () => this._navigate(-1);
    this._onKeyRight = () => this._navigate(1);
    this._onKeyEnter = () => this._confirm();
    this._onKeyEsc = () => this._back();
    this._onKeyM = () => this._toggleMetaMode();

    this._onWheel = (_pointer, _gameObjects, _dx, dy) => {
      if (!this._cardScrollMaxes) return;
      if (dy === 0) return;
      const idx = this.selectedIndex;
      const max = this._cardScrollMaxes[idx] || 0;
      if (max <= 0) return;
      if (!this._cardScrollOffsets) this._cardScrollOffsets = {};
      const cur = this._cardScrollOffsets[idx] || 0;
      const next = Phaser.Math.Clamp(cur + (dy > 0 ? 30 : -30), 0, max);
      if (next !== cur) {
        this._cardScrollOffsets[idx] = next;
        this._draw();
      }
    };

    this.events.once('shutdown', () => {
      const keyboard = this.input?.keyboard;
      if (keyboard?.off) {
        keyboard.off('keydown-LEFT', this._onKeyLeft);
        keyboard.off('keydown-RIGHT', this._onKeyRight);
        keyboard.off('keydown-ENTER', this._onKeyEnter);
        keyboard.off('keydown-ESC', this._onKeyEsc);
        keyboard.off('keydown-M', this._onKeyM);
      }
      if (this.input) this.input.off('wheel', this._onWheel);
      popInputScope(this);
      this._onInputActionBound = null;
      this._onKeyLeft = null;
      this._onKeyRight = null;
      this._onKeyEnter = null;
      this._onKeyEsc = null;
      this._onKeyM = null;
      this._onWheel = null;
      if (this._maskGraphics) {
        this._maskGraphics.forEach((g) => g.destroy());
        this._maskGraphics = [];
      }
      const audio = this.registry.get('audio');
      if (audio) audio.releaseMusic(this, 0);
    });

    this.meta = this.registry.get('meta');
    this.selectedIndex = 0;
    this.modes = this._buildModes();

    this.input.keyboard.on('keydown-LEFT', this._onKeyLeft);
    this.input.keyboard.on('keydown-RIGHT', this._onKeyRight);
    this.input.keyboard.on('keydown-ENTER', this._onKeyEnter);
    this.input.keyboard.on('keydown-ESC', this._onKeyEsc);
    this.input.keyboard.on('keydown-M', this._onKeyM);
    this.input.on('wheel', this._onWheel);

    // Gamepad: route the action bus into the SAME methods the keyboard uses.
    // Cards are a horizontal row, so NAVIGATE.dx browses; X (DANGER) mirrors the
    // 'M' meta-upgrades toggle. Released on shutdown via popInputScope.
    this._onInputActionBound = (action, payload) => this._onInputAction(action, payload);
    pushInputScope(this, this._onInputActionBound);

    this._draw();
  }

  _onInputAction(action, payload) {
    switch (action) {
      case InputAction.NAVIGATE:
        if (payload?.dx) this._navigate(payload.dx);
        break;
      case InputAction.CONFIRM:
        this._confirm();
        break;
      case InputAction.CANCEL:
        this._back();
        break;
      case InputAction.DANGER:
        this._toggleMetaMode();
        break;
    }
  }

  _buildModes() {
    const config = this.gameData?.difficulty?.modes || {};
    const hardUnlocked = Boolean(this.meta?.hasMilestone?.('beatGame'));
    return DIFFICULTY_IDS.map((id) => {
      const mode = config[id] || {};
      const label = mode.label || id.charAt(0).toUpperCase() + id.slice(1);
      const color = mode.color || UI_PALETTE.muted;
      const summary = generateModifierSummary(mode);
      let locked = false;
      let lockReason = null;
      if (id === 'hard' && !hardUnlocked) {
        locked = true;
        lockReason = 'Beat the game to unlock';
      }
      const lunaticUnlocked = Boolean(
        this.meta?.hasMilestone?.('beatHard') ||
        this.meta?.hasMilestone?.('beatLunatic') ||
        hasAnySlotMilestone('beatHard') ||
        hasAnySlotMilestone('beatLunatic'),
      );
      if (id === 'lunatic' && !lunaticUnlocked) {
        locked = true;
        lockReason = 'Beat the game on Hard to unlock';
      }
      return { id, label, color, summary, locked, lockReason };
    });
  }

  _navigate(dir) {
    const next = this.selectedIndex + dir;
    if (next < 0 || next >= this.modes.length) return;
    this.selectedIndex = next;
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_cursor');
    this._draw();
  }

  _toggleMetaMode() {
    this._noMetaUpgrades = !this._noMetaUpgrades;
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_cursor');
    this._draw();
  }

  _confirm() {
    const mode = this.modes[this.selectedIndex];
    if (!mode || mode.locked) {
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_cancel');
      return;
    }
    if (this.isTransitioning) return;
    this.isTransitioning = true;
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_confirm');
    transitionToScene(
      this,
      'BlessingSelect',
      {
        gameData: this.gameData,
        difficultyId: mode.id,
        noMetaUpgrades: this._noMetaUpgrades || false,
      },
      { reason: TRANSITION_REASONS.BEGIN_RUN, retryBlocked: hasDOMHost() },
    ).then((ok) => {
      if (!ok) this.isTransitioning = false;
    });
  }

  _back() {
    if (this.isTransitioning) return;
    this.isTransitioning = true;
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_cancel');
    transitionToScene(
      this,
      'HomeBase',
      { gameData: this.gameData },
      { reason: TRANSITION_REASONS.BACK, retryBlocked: hasDOMHost() },
    ).then((ok) => {
      if (!ok) this.isTransitioning = false;
    });
  }

  _draw() {
    if (hasDOMHost()) {
      if (!this.domSetup || this.domSetup.surface.destroyed)
        this.domSetup = new RunSetupMenu(this, 'difficulty');
      this.domSetup.render();
      return;
    }
    // Destroy mask graphics before removing children (masks aren't auto-destroyed)
    if (this._maskGraphics) {
      this._maskGraphics.forEach((g) => g.destroy());
      this._maskGraphics = [];
    }
    this.children.removeAll(true);
    this._cardScrollMaxes = {};

    const w = this.cameras.main.width;
    const cx = w / 2;

    // Background
    this.add.rectangle(cx, 240, w, 480, UI_HEX.bg);

    // Title
    applyTextResolution(
      this.add.text(cx, 36, 'CHOOSE DIFFICULTY', {
        fontFamily: 'Arial',
        fontSize: '20px',
        color: UI_PALETTE.accent,
        fontStyle: 'bold',
      }),
    ).setOrigin(0.5);

    applyTextResolution(
      this.add.text(
        cx,
        62,
        inputHint(
          this,
          'Left/Right to browse, Enter to confirm, ESC to go back',
          'Tap a difficulty to select it. Tap Back to return.',
        ),
        {
          fontFamily: 'Arial',
          fontSize: '10px',
          color: UI_PALETTE.muted,
        },
      ),
    ).setOrigin(0.5);

    // Cards
    const cardW = 180;
    const cardGap = 16;
    const totalW = this.modes.length * cardW + (this.modes.length - 1) * cardGap;
    const startX = cx - totalW / 2 + cardW / 2;
    const cardTopY = 100;
    const cardH = 280;

    for (let i = 0; i < this.modes.length; i++) {
      const mode = this.modes[i];
      const mx = startX + i * (cardW + cardGap);
      const isSelected = i === this.selectedIndex;

      // Card background
      const borderColor = isSelected ? UI_HEX.accent : mode.locked ? UI_HEX.line : 0x666666;
      const bgColor = isSelected ? UI_HEX.panel : UI_HEX.panel;
      const card = this.add
        .rectangle(mx, cardTopY + cardH / 2, cardW, cardH, bgColor)
        .setStrokeStyle(isSelected ? 2 : 1, borderColor);

      card.setInteractive({ useHandCursor: true });
      card.on('pointerdown', () => {
        this.selectedIndex = i;
        const audio = this.registry.get('audio');
        if (audio) audio.playSFX(mode.locked ? 'sfx_cancel' : 'sfx_cursor');
        this._draw();
      });

      // Mode name
      const nameColor = mode.locked ? UI_PALETTE.muted : mode.color;
      applyTextResolution(
        this.add.text(mx, cardTopY + 20, mode.label, {
          fontFamily: 'Arial',
          fontSize: '16px',
          color: nameColor,
          fontStyle: 'bold',
        }),
      ).setOrigin(0.5);

      // Lock or summary
      if (mode.locked) {
        applyTextResolution(
          this.add.text(mx, cardTopY + 50, mode.lockReason, {
            fontFamily: 'Arial',
            fontSize: '10px',
            color: '#aa4444',
            wordWrap: { width: cardW - 20 },
          }),
        ).setOrigin(0.5, 0);
      } else if (mode.summary.length === 0) {
        applyTextResolution(
          this.add.text(mx, cardTopY + 50, 'Standard experience\n  no modifiers', {
            fontFamily: 'Arial',
            fontSize: '10px',
            color: '#88cc88',
            wordWrap: { width: cardW - 20 },
            lineSpacing: 4,
          }),
        ).setOrigin(0.5, 0);
      } else {
        const summaryText = mode.summary.map((s) => `\u2022 ${s}`).join('\n');
        const textTopY = cardTopY + 50;
        const viewportH = cardH - 80; // room for title + "Selected" label
        // Create text to measure
        const measurer = applyTextResolution(
          this.add.text(0, 0, summaryText, {
            fontFamily: 'Arial',
            fontSize: '9px',
            color: UI_PALETTE.muted,
            wordWrap: { width: cardW - 20 },
            lineSpacing: 3,
          }),
        );
        const textH = measurer.height;
        measurer.destroy();

        if (!this._cardScrollOffsets) this._cardScrollOffsets = {};
        const scrollOffset = this._cardScrollOffsets[i] || 0;
        const scrollMax = Math.max(0, textH - viewportH);
        this._cardScrollMaxes[i] = scrollMax;

        if (scrollMax <= 0) {
          // Fits without scroll
          applyTextResolution(
            this.add.text(mx, textTopY, summaryText, {
              fontFamily: 'Arial',
              fontSize: '9px',
              color: UI_PALETTE.muted,
              wordWrap: { width: cardW - 20 },
              lineSpacing: 3,
            }),
          ).setOrigin(0.5, 0);
        } else {
          // Needs scroll — use Container + GeometryMask
          const textObj = applyTextResolution(
            this.add.text(0, -scrollOffset, summaryText, {
              fontFamily: 'Arial',
              fontSize: '9px',
              color: UI_PALETTE.muted,
              wordWrap: { width: cardW - 20 },
              lineSpacing: 3,
            }),
          );
          textObj.setOrigin(0.5, 0);

          const container = this.add.container(mx, textTopY, [textObj]);

          // Mask to clip text within card bounds
          const maskGfx = this.make.graphics();
          maskGfx.fillRect(mx - cardW / 2 + 4, textTopY, cardW - 8, viewportH);
          const mask = maskGfx.createGeometryMask();
          container.setMask(mask);
          if (!this._maskGraphics) this._maskGraphics = [];
          this._maskGraphics.push(maskGfx);

          // Scroll arrows
          if (scrollOffset > 0) {
            const upArrow = applyTextResolution(
              this.add.text(mx + cardW / 2 - 14, textTopY - 2, '\u25b2', {
                fontFamily: 'Arial',
                fontSize: '10px',
                color: UI_PALETTE.accent,
              }),
            )
              .setOrigin(0.5)
              .setInteractive({ useHandCursor: true });
            upArrow.on('pointerdown', () => {
              this._cardScrollOffsets[i] = Math.max(0, scrollOffset - 30);
              this._draw();
            });
          }
          if (scrollOffset < scrollMax) {
            const downArrow = applyTextResolution(
              this.add.text(mx + cardW / 2 - 14, textTopY + viewportH - 4, '\u25bc', {
                fontFamily: 'Arial',
                fontSize: '10px',
                color: UI_PALETTE.accent,
              }),
            )
              .setOrigin(0.5)
              .setInteractive({ useHandCursor: true });
            downArrow.on('pointerdown', () => {
              this._cardScrollOffsets[i] = Math.min(scrollMax, scrollOffset + 30);
              this._draw();
            });
          }
        }
      }

      // Selection indicator
      if (isSelected && !mode.locked) {
        applyTextResolution(
          this.add.text(mx, cardTopY + cardH - 16, '\u25b6 Selected', {
            fontFamily: 'Arial',
            fontSize: '10px',
            color: UI_PALETTE.accent,
          }),
        ).setOrigin(0.5);
      }
    }

    // Bottom buttons
    const btnY = 420;
    const selected = this.modes[this.selectedIndex];
    const canConfirm = selected && !selected.locked;

    const confirmBtn = applyTextResolution(
      this.add.text(cx - 80, btnY, '[ Confirm ]', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: canConfirm ? '#88ff88' : '#555555',
        backgroundColor: '#000000aa',
        padding: { x: 14, y: 8 },
      }),
    )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: canConfirm });

    if (canConfirm) {
      confirmBtn.on('pointerover', () => confirmBtn.setColor(UI_PALETTE.accent));
      confirmBtn.on('pointerout', () => confirmBtn.setColor('#88ff88'));
      confirmBtn.on('pointerdown', () => this._confirm());
    }

    const backBtn = applyTextResolution(
      this.add.text(cx + 80, btnY, '[ Back ]', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: UI_PALETTE.text,
        backgroundColor: '#000000aa',
        padding: { x: 14, y: 8 },
      }),
    )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    backBtn.on('pointerover', () => backBtn.setColor(UI_PALETTE.accent));
    backBtn.on('pointerout', () => backBtn.setColor(UI_PALETTE.text));
    backBtn.on('pointerdown', () => this._back());

    // Meta upgrades toggle
    const metaLabel = this._noMetaUpgrades ? 'Meta Upgrades: OFF' : 'Meta Upgrades: ON';
    const metaColor = this._noMetaUpgrades ? '#ff8800' : '#88cc88';
    const metaToggle = applyTextResolution(
      this.add.text(cx, btnY + 36, metaLabel, {
        fontFamily: 'Arial',
        fontSize: '11px',
        color: metaColor,
        backgroundColor: '#000000aa',
        padding: { x: 10, y: 4 },
      }),
    )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    metaToggle.on('pointerover', () => metaToggle.setColor(UI_PALETTE.accent));
    metaToggle.on('pointerout', () => metaToggle.setColor(metaColor));
    metaToggle.on('pointerdown', () => this._toggleMetaMode());

    // Starting pair from Banner of Command (hidden when unpurchased; no-meta
    // runs always start Edric + Sera)
    if (!this._noMetaUpgrades && this.meta?.getCommanderChoiceTier?.() >= 1) {
      // Heal stale/corrupted saved names the same way run start will, so the
      // displayed pair always matches the roster the run actually builds.
      const [cmdDef, partnerDef] = resolveStartingLordDefs(
        { startingLords: this.meta.getLordSelection() },
        this.gameData?.lords,
      );
      applyTextResolution(
        this.add.text(cx, btnY + 56, `Commander: ${cmdDef?.name} · Partner: ${partnerDef?.name}`, {
          fontFamily: 'Arial',
          fontSize: '10px',
          color: '#88bbff',
        }),
      ).setOrigin(0.5);
    }
  }
}

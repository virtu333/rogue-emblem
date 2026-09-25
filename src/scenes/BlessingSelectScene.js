import { hasDOMHost } from '../utils/domUI.js';
import { RunSetupMenu } from '../ui/RunSetupMenu.js';
import { UI_PALETTE, UI_HEX, applyTextResolution } from '../utils/uiStyles.js';
// BlessingSelectScene — Choose a shrine blessing before the run begins

import Phaser from 'phaser';
import { MUSIC } from '../utils/musicConfig.js';
import { RunManager, clearSavedRun } from '../engine/RunManager.js';
import { deleteRunSave } from '../cloud/CloudSync.js';
import { recordBlessingSelection } from '../utils/blessingAnalytics.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { InputAction } from '../utils/InputActions.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';

const TIER_COLORS = {
  1: { label: '#88ffbb', border: 0x2c7a4a, bg: 0x14281f },
  2: { label: '#9ed5ff', border: 0x2f5c88, bg: 0x132234 },
  3: { label: '#ffd68a', border: 0x8c6430, bg: 0x302312 },
  4: { label: '#ff9ea7', border: 0x8e2f45, bg: 0x341521 },
};

export class BlessingSelectScene extends Phaser.Scene {
  constructor() {
    super('BlessingSelect');
  }

  init(data) {
    this.gameData = data.gameData;
    this.difficultyId = data.difficultyId || 'normal';
    this.noMetaUpgrades = data.noMetaUpgrades === true;
    this.isTransitioning = false;
    this._blessingCommitted = false;
    this._blessingRunSeed = null;
    this._pendingBlessingSelection = null;
  }

  create() {
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.shrine, this);

    this._onKeyUp = () => this._navigate(-1);
    this._onKeyDown = () => this._navigate(1);
    this._onKeyEnter = () => this._confirm();
    this._onKeyEsc = () => this._back();

    this.events.once('shutdown', () => {
      const keyboard = this.input?.keyboard;
      if (keyboard?.off) {
        keyboard.off('keydown-UP', this._onKeyUp);
        keyboard.off('keydown-DOWN', this._onKeyDown);
        keyboard.off('keydown-ENTER', this._onKeyEnter);
        keyboard.off('keydown-ESC', this._onKeyEsc);
      }
      popInputScope(this);
      this._onInputActionBound = null;
      this._onKeyUp = null;
      this._onKeyDown = null;
      this._onKeyEnter = null;
      this._onKeyEsc = null;
      const audio = this.registry.get('audio');
      if (audio) audio.releaseMusic(this, 0);
    });

    BlessingSelectScene.prototype._rebuildRunManager.call(this);
    this.selectedIndex = 0;

    this.input.keyboard.on('keydown-UP', this._onKeyUp);
    this.input.keyboard.on('keydown-DOWN', this._onKeyDown);
    this.input.keyboard.on('keydown-ENTER', this._onKeyEnter);
    this.input.keyboard.on('keydown-ESC', this._onKeyEsc);

    // Gamepad: blessings are a vertical list, so NAVIGATE.dy browses; route into
    // the SAME _navigate/_confirm/_back the keyboard uses. Released on shutdown.
    this._onInputActionBound = (action, payload) => this._onInputAction(action, payload);
    pushInputScope(this, this._onInputActionBound);

    this._draw();
  }

  _onInputAction(action, payload) {
    switch (action) {
      case InputAction.NAVIGATE:
        if (payload?.dy) this._navigate(payload.dy);
        break;
      case InputAction.CONFIRM:
        this._confirm();
        break;
      case InputAction.CANCEL:
        this._back();
        break;
    }
  }

  _rebuildRunManager() {
    const meta = this.registry.get('meta');
    const metaEffects =
      !this.noMetaUpgrades && meta
        ? meta.getActiveEffects({
            weaponArtCatalog: this.gameData?.weaponArts?.arts || [],
          })
        : null;
    this.runManager = new RunManager(this.gameData, metaEffects);
    this.runManager.noMetaMode = this.noMetaUpgrades;
    this.runManager.startRun({
      difficultyId: this.difficultyId,
      applyBlessingsAtStart: false,
      runSeed: this._blessingRunSeed,
    });
    if (!Number.isFinite(this._blessingRunSeed)) this._blessingRunSeed = this.runManager.runSeed;
    this.options = this.runManager.getBlessingOptions().slice(0, 4);
  }

  _rollbackBlessingCommit() {
    this._blessingCommitted = false;
    this._pendingBlessingSelection = null;
    if (!this.gameData) return;
    BlessingSelectScene.prototype._rebuildRunManager.call(this);
    this.selectedIndex = Math.min(this.selectedIndex, this.options.length);
    this._draw();
  }

  _select(index) {
    if (this._blessingCommitted) return; // selection locked after commit
    if (index === this.selectedIndex) return;
    this.selectedIndex = index;
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_cursor');
    this._draw();
  }

  _navigate(dir) {
    // +1 for skip option at the end
    const max = this.options.length; // 0..options.length where options.length = skip
    const next = this.selectedIndex + dir;
    if (next < 0 || next > max) return;
    this._select(next);
  }

  _confirm() {
    if (this.isTransitioning) return;

    if (!this._blessingCommitted) {
      const isSkip = this.selectedIndex >= this.options.length;
      const blessing = isSkip ? null : this.options[this.selectedIndex];
      const blessingId = blessing ? blessing.id : null;

      if (!this.runManager.chooseBlessing(blessingId)) return;
      this._blessingCommitted = true;
      this._pendingBlessingSelection = {
        offeredIds: this.runManager.blessingSelectionTelemetry?.offeredIds || [],
        chosenId: blessingId,
      };
    }

    this.isTransitioning = true;
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_confirm');
    transitionToScene(
      this,
      'NodeMap',
      {
        gameData: this.gameData,
        runManager: this.runManager,
      },
      { reason: TRANSITION_REASONS.BEGIN_RUN, retryBlocked: hasDOMHost() },
    )
      .then((ok) => {
        if (!ok) {
          this.isTransitioning = false;
          this._rollbackBlessingCommit();
          return;
        }
        // The run is committed: count the attempt (finished runs are counted
        // separately when the run settles).
        this.registry.get('meta')?.incrementRunsStarted?.();
        // Clear stale run save only after transition success.
        const cloud = this.registry.get('cloud');
        const slot = this.registry.get('activeSlot');
        clearSavedRun(
          cloud ? (resolvedSlot) => deleteRunSave(cloud.userId, resolvedSlot) : null,
          slot,
        );
        if (this._pendingBlessingSelection) {
          recordBlessingSelection(this._pendingBlessingSelection);
          this._pendingBlessingSelection = null;
        }
      })
      .catch((err) => {
        console.error('[BlessingSelectScene] transition failed:', err);
        this.isTransitioning = false;
        this._rollbackBlessingCommit();
      });
  }

  _back() {
    if (this.isTransitioning) return;
    this.isTransitioning = true;
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_cancel');
    transitionToScene(
      this,
      'DifficultySelect',
      { gameData: this.gameData, noMetaUpgrades: this.noMetaUpgrades === true },
      { reason: TRANSITION_REASONS.BACK, retryBlocked: hasDOMHost() },
    ).then((ok) => {
      if (!ok) this.isTransitioning = false;
    });
  }

  _draw() {
    if (hasDOMHost()) {
      if (!this.domSetup || this.domSetup.surface.destroyed)
        this.domSetup = new RunSetupMenu(this, 'blessing');
      this.domSetup.render();
      return;
    }
    this.children.removeAll(true);

    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const cx = w / 2;

    // Background
    this.add.rectangle(cx, h / 2, w, h, UI_HEX.bg);

    // Panel
    const panelW = Math.min(600, w - 40);
    const panelH = Math.min(410, h - 60);
    const panelTop = (h - panelH) / 2;
    const panelBottom = panelTop + panelH;
    this.add
      .rectangle(cx, h / 2, panelW, panelH, 0x0e1322, 0.96)
      .setStrokeStyle(2, UI_HEX.accent, 0.9);

    // Header
    const headerY = panelTop + 24;
    this.add.rectangle(cx, headerY, panelW - 24, 30, 0x1a2138).setStrokeStyle(1, 0x3d4a77);
    applyTextResolution(
      this.add.text(cx, headerY, 'Shrine Blessing', {
        fontFamily: 'Arial',
        fontSize: '17px',
        color: UI_PALETTE.accent,
        fontStyle: 'bold',
      }),
    ).setOrigin(0.5);

    const subtitleY = panelTop + 52;
    applyTextResolution(
      this.add.text(
        cx,
        subtitleY,
        'Select one blessing to shape this run. Or skip for a neutral start.',
        {
          fontFamily: 'Arial',
          fontSize: '11px',
          color: UI_PALETTE.muted,
        },
      ),
    ).setOrigin(0.5);

    const dividerY = panelTop + 68;
    this.add.rectangle(cx, dividerY, panelW - 28, 1, UI_HEX.lineSoft);

    // Blessing cards
    const cardW = panelW - 28;
    const skipY = panelBottom - 62;
    const cardsTop = dividerY + 16;
    const cardsBottom = skipY - 18;
    const cardGap = 10;
    const slotCount = Math.max(this.options.length, 1);
    const cardH = Math.min(
      86,
      Math.max(68, Math.floor((cardsBottom - cardsTop - cardGap * (slotCount - 1)) / slotCount)),
    );
    const totalCardsH = cardH * slotCount + cardGap * (slotCount - 1);
    let y = cardsTop + Math.floor((cardsBottom - cardsTop - totalCardsH) / 2);

    for (let i = 0; i < this.options.length; i++) {
      const blessing = this.options[i];
      const isSelected = i === this.selectedIndex;
      const tierStyle = TIER_COLORS[blessing.tier] || TIER_COLORS[1];
      const cardCY = y + cardH / 2;

      const card = this.add
        .rectangle(cx, cardCY, cardW, cardH, tierStyle.bg)
        .setStrokeStyle(isSelected ? 2 : 1, isSelected ? UI_HEX.accent : tierStyle.border);

      card.setInteractive({ useHandCursor: true });
      card.on('pointerdown', () => this._select(i));

      const left = cx - cardW / 2 + 12;
      const right = cx + cardW / 2 - 12;
      const row1Y = y + 10;

      // Tier badge
      applyTextResolution(
        this.add.text(left, row1Y, `T${blessing.tier}`, {
          fontFamily: 'Arial',
          fontSize: '10px',
          color: '#0b101f',
          backgroundColor: tierStyle.label,
          padding: { x: 5, y: 2 },
          fontStyle: 'bold',
        }),
      );

      // Name
      const nameX = left + 38;
      applyTextResolution(
        this.add.text(nameX, row1Y + 1, blessing.name, {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: UI_PALETTE.text,
          fontStyle: 'bold',
        }),
      );

      // Description
      const descWrapWidth = Math.max(150, cardW - 38 - 80);
      const hasCostLine =
        typeof blessing?.rolledCost?.label === 'string' &&
        blessing.rolledCost.label.trim().length > 0;
      const descFontSize = cardH < 76 ? '9px' : '10px';
      const desc = applyTextResolution(
        this.add.text(nameX, row1Y + 20, blessing.description || '-', {
          fontFamily: 'Arial',
          fontSize: descFontSize,
          color: UI_PALETTE.muted,
          wordWrap: { width: descWrapWidth, useAdvancedWrap: true },
        }),
      );
      // Truncate if too tall
      let guard = 0;
      const maxDescHeight = hasCostLine ? Math.max(12, cardH - 48) : Math.max(18, cardH - 34);
      while (desc.height > maxDescHeight && desc.text.length > 8 && guard < 40) {
        const next = `${desc.text.slice(0, -4).trimEnd()}...`;
        if (next === desc.text) break;
        desc.setText(next);
        guard++;
      }
      if (hasCostLine) {
        applyTextResolution(
          this.add.text(nameX, row1Y + cardH - 34, `Cost: ${blessing.rolledCost.label}`, {
            fontFamily: 'Arial',
            fontSize: '9px',
            color: '#c8a27b',
          }),
        );
      }

      // Select button
      const pickBtn = applyTextResolution(
        this.add.text(right, cardCY, isSelected ? '\u25b6 Selected' : '[Select]', {
          fontFamily: 'Arial',
          fontSize: '11px',
          color: isSelected ? UI_PALETTE.accent : UI_PALETTE.good,
          backgroundColor: isSelected ? '#2f5d39' : '#21442a',
          padding: { x: 8, y: 4 },
        }),
      )
        .setOrigin(1, 0.5)
        .setInteractive({ useHandCursor: true });

      pickBtn.on('pointerover', () => {
        pickBtn.setColor(UI_PALETTE.accent);
        card.setStrokeStyle(2, UI_HEX.accent);
      });
      pickBtn.on('pointerout', () => {
        if (i !== this.selectedIndex) {
          pickBtn.setColor(UI_PALETTE.good);
          card.setStrokeStyle(1, tierStyle.border);
        }
      });
      pickBtn.on('pointerdown', () => this._select(i));

      y += cardH + cardGap;
    }

    // Skip option
    const isSkipSelected = this.selectedIndex >= this.options.length;
    const skipBtn = applyTextResolution(
      this.add.text(
        cx,
        skipY,
        isSkipSelected ? '\u25b6 Skip Blessing (Selected)' : '[Skip Blessing]',
        {
          fontFamily: 'Arial',
          fontSize: '12px',
          color: isSkipSelected ? UI_PALETTE.accent : UI_PALETTE.text,
          backgroundColor: isSkipSelected ? '#3a4053' : '#2a2f3f',
          padding: { x: 10, y: 4 },
        },
      ),
    )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    skipBtn.on('pointerover', () => skipBtn.setColor(UI_PALETTE.accent));
    skipBtn.on('pointerout', () => {
      if (!isSkipSelected) skipBtn.setColor(UI_PALETTE.text);
    });
    skipBtn.on('pointerdown', () => this._select(this.options.length));

    // Bottom buttons
    const bottomY = panelBottom - 30;
    const confirmBtn = applyTextResolution(
      this.add.text(cx - 80, bottomY, '[ Confirm ]', {
        fontFamily: 'Arial',
        fontSize: '16px',
        color: UI_PALETTE.good,
        backgroundColor: '#000000aa',
        padding: { x: 14, y: 8 },
      }),
    )
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    confirmBtn.on('pointerover', () => confirmBtn.setColor(UI_PALETTE.accent));
    confirmBtn.on('pointerout', () => confirmBtn.setColor(UI_PALETTE.good));
    confirmBtn.on('pointerdown', () => this._confirm());

    const backBtn = applyTextResolution(
      this.add.text(cx + 80, bottomY, '[ Back ]', {
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
  }
}

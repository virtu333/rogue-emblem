// BlessingSelectScene — Choose a shrine blessing before the run begins

import Phaser from 'phaser';
import { MUSIC } from '../utils/musicConfig.js';
import { RunManager, clearSavedRun } from '../engine/RunManager.js';
import { deleteRunSave } from '../cloud/CloudSync.js';
import { recordBlessingSelection } from '../utils/blessingAnalytics.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';

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
  }

  create() {
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.homeBase, this);

    this.events.once('shutdown', () => {
      const audio = this.registry.get('audio');
      if (audio) audio.releaseMusic(this, 0);
    });

    // Create RunManager — not committed until we transition to NodeMap
    const meta = this.registry.get('meta');
    const metaEffects = meta ? meta.getActiveEffects({
      weaponArtCatalog: this.gameData?.weaponArts?.arts || [],
    }) : null;
    this.runManager = new RunManager(this.gameData, metaEffects);
    this.runManager.startRun({ difficultyId: this.difficultyId, applyBlessingsAtStart: false });

    this.options = this.runManager.getBlessingOptions().slice(0, 4);
    this.selectedIndex = 0;

    this.input.keyboard.on('keydown-UP', () => this._navigate(-1));
    this.input.keyboard.on('keydown-DOWN', () => this._navigate(1));
    this.input.keyboard.on('keydown-ENTER', () => this._confirm());
    this.input.keyboard.on('keydown-ESC', () => this._back());

    this._draw();
  }

  _navigate(dir) {
    // +1 for skip option at the end
    const max = this.options.length; // 0..options.length where options.length = skip
    const next = this.selectedIndex + dir;
    if (next < 0 || next > max) return;
    this.selectedIndex = next;
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_cursor');
    this._draw();
  }

  _confirm() {
    const isSkip = this.selectedIndex >= this.options.length;
    const blessing = isSkip ? null : this.options[this.selectedIndex];
    const blessingId = blessing ? blessing.id : null;

    if (!this.runManager.chooseBlessing(blessingId)) return;

    recordBlessingSelection({
      offeredIds: this.runManager.blessingSelectionTelemetry?.offeredIds || [],
      chosenId: blessingId,
    });

    // Clear any stale run save before starting fresh
    const cloud = this.registry.get('cloud');
    const slot = this.registry.get('activeSlot');
    clearSavedRun(cloud ? () => deleteRunSave(cloud.userId, slot) : null);

    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_confirm');
    void transitionToScene(this, 'NodeMap', {
      gameData: this.gameData,
      runManager: this.runManager,
    }, { reason: TRANSITION_REASONS.BEGIN_RUN });
  }

  _back() {
    // Discard RunManager — nothing persisted yet
    this.runManager = null;
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_cancel');
    void transitionToScene(this, 'DifficultySelect', { gameData: this.gameData }, { reason: TRANSITION_REASONS.BACK });
  }

  _draw() {
    this.children.removeAll(true);

    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const cx = w / 2;

    // Background
    this.add.rectangle(cx, h / 2, w, h, 0x0a0a14);

    // Panel
    const panelW = Math.min(600, w - 40);
    const panelH = Math.min(440, h - 40);
    const panelTop = (h - panelH) / 2;
    const panelBottom = panelTop + panelH;
    this.add.rectangle(cx, h / 2, panelW, panelH, 0x0e1322, 0.96)
      .setStrokeStyle(2, 0xffdd44, 0.9);

    // Header
    const headerY = panelTop + 24;
    this.add.rectangle(cx, headerY, panelW - 24, 30, 0x1a2138)
      .setStrokeStyle(1, 0x3d4a77);
    this.add.text(cx, headerY, 'Shrine Blessing', {
      fontFamily: 'monospace', fontSize: '17px', color: '#ffdd44', fontStyle: 'bold',
    }).setOrigin(0.5);

    const subtitleY = panelTop + 52;
    this.add.text(cx, subtitleY, 'Select one blessing to shape this run. Or skip for a neutral start.', {
      fontFamily: 'monospace', fontSize: '11px', color: '#b7bfd9',
    }).setOrigin(0.5);

    const dividerY = panelTop + 68;
    this.add.rectangle(cx, dividerY, panelW - 28, 1, 0x364166);

    // Blessing cards
    const cardW = panelW - 28;
    const skipY = panelBottom - 62;
    const cardsTop = dividerY + 16;
    const cardsBottom = skipY - 18;
    const cardGap = 10;
    const slotCount = Math.max(this.options.length, 1);
    const cardH = Math.min(86, Math.max(68, Math.floor((cardsBottom - cardsTop - (cardGap * (slotCount - 1))) / slotCount)));
    const totalCardsH = (cardH * slotCount) + (cardGap * (slotCount - 1));
    let y = cardsTop + Math.floor((cardsBottom - cardsTop - totalCardsH) / 2);

    for (let i = 0; i < this.options.length; i++) {
      const blessing = this.options[i];
      const isSelected = i === this.selectedIndex;
      const tierStyle = TIER_COLORS[blessing.tier] || TIER_COLORS[1];
      const cardCY = y + cardH / 2;

      const card = this.add.rectangle(cx, cardCY, cardW, cardH, tierStyle.bg)
        .setStrokeStyle(isSelected ? 2 : 1, isSelected ? 0xffdd44 : tierStyle.border);

      card.setInteractive({ useHandCursor: true });
      card.on('pointerdown', () => {
        this.selectedIndex = i;
        this._draw();
      });

      const left = cx - (cardW / 2) + 12;
      const right = cx + (cardW / 2) - 12;
      const row1Y = y + 10;

      // Tier badge
      this.add.text(left, row1Y, `T${blessing.tier}`, {
        fontFamily: 'monospace', fontSize: '10px', color: '#0b101f',
        backgroundColor: tierStyle.label, padding: { x: 5, y: 2 }, fontStyle: 'bold',
      });

      // Name
      const nameX = left + 38;
      this.add.text(nameX, row1Y + 1, blessing.name, {
        fontFamily: 'monospace', fontSize: '12px', color: '#edf1ff', fontStyle: 'bold',
      });

      // Description
      const descWrapWidth = Math.max(150, cardW - 38 - 80);
      const desc = this.add.text(nameX, row1Y + 20, blessing.description || '-', {
        fontFamily: 'monospace', fontSize: '10px', color: '#aeb8dc',
        wordWrap: { width: descWrapWidth, useAdvancedWrap: true },
      });
      // Truncate if too tall
      let guard = 0;
      while (desc.height > Math.max(18, cardH - 34) && desc.text.length > 8 && guard < 40) {
        const next = `${desc.text.slice(0, -4).trimEnd()}...`;
        if (next === desc.text) break;
        desc.setText(next);
        guard++;
      }

      // Select button
      const pickBtn = this.add.text(right, cardCY, isSelected ? '\u25b6 Selected' : '[Select]', {
        fontFamily: 'monospace', fontSize: '11px',
        color: isSelected ? '#ffdd44' : '#cbffd5',
        backgroundColor: isSelected ? '#2f5d39' : '#21442a',
        padding: { x: 8, y: 4 },
      }).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });

      pickBtn.on('pointerover', () => {
        pickBtn.setColor('#ffdd44');
        card.setStrokeStyle(2, 0xffdd44);
      });
      pickBtn.on('pointerout', () => {
        if (i !== this.selectedIndex) {
          pickBtn.setColor('#cbffd5');
          card.setStrokeStyle(1, tierStyle.border);
        }
      });
      pickBtn.on('pointerdown', () => {
        this.selectedIndex = i;
        this._draw();
      });

      y += cardH + cardGap;
    }

    // Skip option
    const isSkipSelected = this.selectedIndex >= this.options.length;
    const skipBtn = this.add.text(cx, skipY, isSkipSelected ? '\u25b6 Skip Blessing (Selected)' : '[Skip Blessing]', {
      fontFamily: 'monospace', fontSize: '12px',
      color: isSkipSelected ? '#ffdd44' : '#d7dbe8',
      backgroundColor: isSkipSelected ? '#3a4053' : '#2a2f3f',
      padding: { x: 10, y: 4 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    skipBtn.on('pointerover', () => skipBtn.setColor('#ffdd44'));
    skipBtn.on('pointerout', () => {
      if (!isSkipSelected) skipBtn.setColor('#d7dbe8');
    });
    skipBtn.on('pointerdown', () => {
      this.selectedIndex = this.options.length;
      this._draw();
    });

    // Bottom buttons
    const bottomY = panelBottom - 18;
    const confirmBtn = this.add.text(cx - 80, bottomY, '[ Confirm ]', {
      fontFamily: 'monospace', fontSize: '16px', color: '#88ff88',
      backgroundColor: '#000000aa', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    confirmBtn.on('pointerover', () => confirmBtn.setColor('#ffdd44'));
    confirmBtn.on('pointerout', () => confirmBtn.setColor('#88ff88'));
    confirmBtn.on('pointerdown', () => this._confirm());

    const backBtn = this.add.text(cx + 80, bottomY, '[ Back ]', {
      fontFamily: 'monospace', fontSize: '16px', color: '#e0e0e0',
      backgroundColor: '#000000aa', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    backBtn.on('pointerover', () => backBtn.setColor('#ffdd44'));
    backBtn.on('pointerout', () => backBtn.setColor('#e0e0e0'));
    backBtn.on('pointerdown', () => this._back());

  }
}

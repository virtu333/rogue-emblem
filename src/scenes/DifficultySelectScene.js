// DifficultySelectScene — Choose difficulty before starting a run

import Phaser from 'phaser';
import { MUSIC } from '../utils/musicConfig.js';
import { DIFFICULTY_IDS, generateModifierSummary } from '../engine/DifficultyEngine.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';

export class DifficultySelectScene extends Phaser.Scene {
  constructor() {
    super('DifficultySelect');
  }

  init(data) {
    this.gameData = data.gameData;
  }

  create() {
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.homeBase, this);

    this.events.once('shutdown', () => {
      const audio = this.registry.get('audio');
      if (audio) audio.releaseMusic(this, 0);
    });

    this.meta = this.registry.get('meta');
    this.selectedIndex = 0;
    this.modes = this._buildModes();

    this.input.keyboard.on('keydown-LEFT', () => this._navigate(-1));
    this.input.keyboard.on('keydown-RIGHT', () => this._navigate(1));
    this.input.keyboard.on('keydown-ENTER', () => this._confirm());
    this.input.keyboard.on('keydown-ESC', () => this._back());

    this._draw();
  }

  _buildModes() {
    const config = this.gameData?.difficulty?.modes || {};
    const hardUnlocked = Boolean(this.meta?.hasMilestone?.('beatGame'));
    return DIFFICULTY_IDS.map((id) => {
      const mode = config[id] || {};
      const label = mode.label || id.charAt(0).toUpperCase() + id.slice(1);
      const color = mode.color || '#aaaaaa';
      const summary = generateModifierSummary(mode);
      let locked = false;
      let lockReason = null;
      if (id === 'hard' && !hardUnlocked) {
        locked = true;
        lockReason = 'Beat the game to unlock';
      }
      if (id === 'lunatic') {
        locked = true;
        lockReason = 'Coming Soon';
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

  _confirm() {
    const mode = this.modes[this.selectedIndex];
    if (!mode || mode.locked) {
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_cancel');
      return;
    }
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_confirm');
    void transitionToScene(this, 'BlessingSelect', {
      gameData: this.gameData,
      difficultyId: mode.id,
    }, { reason: TRANSITION_REASONS.BEGIN_RUN });
  }

  _back() {
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_cancel');
    void transitionToScene(this, 'HomeBase', { gameData: this.gameData }, { reason: TRANSITION_REASONS.BACK });
  }

  _draw() {
    this.children.removeAll(true);

    const w = this.cameras.main.width;
    const cx = w / 2;

    // Background
    this.add.rectangle(cx, 240, w, 480, 0x0a0a14);

    // Title
    this.add.text(cx, 36, 'CHOOSE DIFFICULTY', {
      fontFamily: 'monospace', fontSize: '20px', color: '#ffdd44', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.add.text(cx, 62, 'Left/Right to browse, Enter to confirm, ESC to go back', {
      fontFamily: 'monospace', fontSize: '10px', color: '#888888',
    }).setOrigin(0.5);

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
      const borderColor = isSelected ? 0xffdd44 : (mode.locked ? 0x444444 : 0x666666);
      const bgColor = isSelected ? 0x1a1a2e : 0x111122;
      const card = this.add.rectangle(mx, cardTopY + cardH / 2, cardW, cardH, bgColor)
        .setStrokeStyle(isSelected ? 2 : 1, borderColor);

      card.setInteractive({ useHandCursor: true });
      card.on('pointerdown', () => {
        this.selectedIndex = i;
        const audio = this.registry.get('audio');
        if (audio) audio.playSFX(mode.locked ? 'sfx_cancel' : 'sfx_cursor');
        this._draw();
      });

      // Mode name
      const nameColor = mode.locked ? '#666666' : mode.color;
      this.add.text(mx, cardTopY + 20, mode.label, {
        fontFamily: 'monospace', fontSize: '16px', color: nameColor, fontStyle: 'bold',
      }).setOrigin(0.5);

      // Lock or summary
      if (mode.locked) {
        this.add.text(mx, cardTopY + 50, mode.lockReason, {
          fontFamily: 'monospace', fontSize: '10px', color: '#aa4444',
          wordWrap: { width: cardW - 20 },
        }).setOrigin(0.5, 0);
      } else if (mode.summary.length === 0) {
        this.add.text(mx, cardTopY + 50, 'Standard experience\n  no modifiers', {
          fontFamily: 'monospace', fontSize: '10px', color: '#88cc88',
          wordWrap: { width: cardW - 20 }, lineSpacing: 4,
        }).setOrigin(0.5, 0);
      } else {
        const summaryText = mode.summary.map(s => `\u2022 ${s}`).join('\n');
        this.add.text(mx, cardTopY + 50, summaryText, {
          fontFamily: 'monospace', fontSize: '9px', color: '#cccccc',
          wordWrap: { width: cardW - 20 }, lineSpacing: 3,
        }).setOrigin(0.5, 0);
      }

      // Selection indicator
      if (isSelected && !mode.locked) {
        this.add.text(mx, cardTopY + cardH - 16, '\u25b6 Selected', {
          fontFamily: 'monospace', fontSize: '10px', color: '#ffdd44',
        }).setOrigin(0.5);
      }
    }

    // Bottom buttons
    const btnY = 420;
    const selected = this.modes[this.selectedIndex];
    const canConfirm = selected && !selected.locked;

    const confirmBtn = this.add.text(cx - 80, btnY, '[ Confirm ]', {
      fontFamily: 'monospace', fontSize: '16px',
      color: canConfirm ? '#88ff88' : '#555555',
      backgroundColor: '#000000aa', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: canConfirm });

    if (canConfirm) {
      confirmBtn.on('pointerover', () => confirmBtn.setColor('#ffdd44'));
      confirmBtn.on('pointerout', () => confirmBtn.setColor('#88ff88'));
      confirmBtn.on('pointerdown', () => this._confirm());
    }

    const backBtn = this.add.text(cx + 80, btnY, '[ Back ]', {
      fontFamily: 'monospace', fontSize: '16px', color: '#e0e0e0',
      backgroundColor: '#000000aa', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    backBtn.on('pointerover', () => backBtn.setColor('#ffdd44'));
    backBtn.on('pointerout', () => backBtn.setColor('#e0e0e0'));
    backBtn.on('pointerdown', () => this._back());
  }
}

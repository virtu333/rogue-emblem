// RunCompleteScene — End-of-run screen (victory or defeat)

import Phaser from 'phaser';
import { clearSavedRun } from '../engine/RunManager.js';
import { calculateCurrencies } from '../engine/MetaProgressionManager.js';
import { MUSIC } from '../utils/musicConfig.js';
import { deleteRunSave } from '../cloud/CloudSync.js';
import { recordBlessingRunOutcome } from '../utils/blessingAnalytics.js';

export class RunCompleteScene extends Phaser.Scene {
  constructor() {
    super('RunComplete');
  }

  init(data) {
    this.gameData = data.gameData;
    this.runManager = data.runManager;
    this.result = data.result || 'defeat';
  }

  create() {
    const cloud = this.registry.get('cloud');
    const slot = this.registry.get('activeSlot');
    clearSavedRun(cloud ? () => deleteRunSave(cloud.userId, slot) : null);

    const cx = this.cameras.main.centerX;
    const cy = this.cameras.main.centerY;

    const isVictory = this.result === 'victory';

    const audio = this.registry.get('audio');
    if (audio) {
      const key = isVictory ? MUSIC.runWin : MUSIC.defeat;
      audio.playMusic(key, this, 500);
    }

    this.events.once('shutdown', () => {
      const audio = this.registry.get('audio');
      if (audio) audio.stopMusic(null, 0);
    });

    // Title
    this.add.text(cx, cy - 80, isVictory ? 'RUN COMPLETE!' : 'GAME OVER', {
      fontFamily: 'monospace',
      fontSize: '32px',
      color: isVictory ? '#ffdd44' : '#cc3333',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // Calculate and award currencies
    const rm = this.runManager;
    const actReached = rm.actIndex + 1;
    recordBlessingRunOutcome({
      activeBlessings: rm.activeBlessings || [],
      result: this.result,
      actIndex: rm.actIndex,
      completedBattles: rm.completedBattles,
    });
    const currencyMultiplier = rm.getDifficultyModifier?.('currencyMultiplier', 1) || 1;
    const { valor, supply } = calculateCurrencies(rm.actIndex, rm.completedBattles, isVictory, currencyMultiplier);
    const meta = this.registry.get('meta');
    if (meta) {
      meta.addValor(valor);
      meta.addSupply(supply);
      meta.incrementRunsCompleted();

      // Record milestones based on highest act reached
      // actIndex 0 = Act 1 in progress; reaching actIndex >= 1 means Act 1 was beaten
      if (rm.actIndex >= 1) meta.recordMilestone('beatAct1');
      if (rm.actIndex >= 2) meta.recordMilestone('beatAct2');
      if (rm.actIndex >= 3) meta.recordMilestone('beatAct3');
      // beatGame requires actually winning, not just reaching the final boss
      if (isVictory && rm.actIndex >= 3) meta.recordMilestone('beatGame');
    }

    // Stats
    const statsLines = [
      `Battles Won: ${rm.completedBattles}`,
      `Act Reached: ${actReached} / 4`,
    ];
    const statsText = statsLines.join('\n');

    this.add.text(cx, cy - 20, statsText, {
      fontFamily: 'monospace', fontSize: '14px', color: '#e0e0e0',
      align: 'center', lineSpacing: 6,
    }).setOrigin(0.5);

    // Difficulty line (colored separately)
    const diffLabel = rm.difficultyModifiers?.label || (rm.difficultyId || 'normal');
    const diffColor = rm.difficultyModifiers?.color || '#44cc44';
    this.add.text(cx, cy + 4, `${diffLabel} Mode  (x${currencyMultiplier.toFixed(2)} currency)`, {
      fontFamily: 'monospace', fontSize: '13px', color: diffColor,
      align: 'center',
    }).setOrigin(0.5);

    // Currency earned display
    let curY = cy + 14;
    this.add.text(cx, curY, `Valor Earned: +${valor}`, {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffcc44',
      align: 'center',
    }).setOrigin(0.5);
    curY += 18;
    this.add.text(cx, curY, `Supply Earned: +${supply}`, {
      fontFamily: 'monospace', fontSize: '13px', color: '#44ccbb',
      align: 'center',
    }).setOrigin(0.5);

    if (meta) {
      curY += 20;
      this.add.text(cx, curY, `Total: ${meta.getTotalValor()} Valor  |  ${meta.getTotalSupply()} Supply`, {
        fontFamily: 'monospace', fontSize: '11px', color: '#888888',
        align: 'center',
      }).setOrigin(0.5);
    }

    // Home Base button (primary)
    const homeBtn = this.add.text(cx - 90, cy + 80, '[ Home Base ]', {
      fontFamily: 'monospace', fontSize: '18px', color: '#88ccff',
      backgroundColor: '#000000aa', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    homeBtn.on('pointerover', () => homeBtn.setColor('#ffdd44'));
    homeBtn.on('pointerout', () => homeBtn.setColor('#88ccff'));
    homeBtn.on('pointerdown', () => {
      const audio = this.registry.get('audio');
      if (audio) audio.stopMusic(this, 0);
      this.scene.start('HomeBase', { gameData: this.gameData });
    });

    // Back to Title button (secondary)
    const titleBtn = this.add.text(cx + 90, cy + 80, '[ Title ]', {
      fontFamily: 'monospace', fontSize: '18px', color: '#e0e0e0',
      backgroundColor: '#000000aa', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    titleBtn.on('pointerover', () => titleBtn.setColor('#ffdd44'));
    titleBtn.on('pointerout', () => titleBtn.setColor('#e0e0e0'));
    titleBtn.on('pointerdown', () => {
      const audio = this.registry.get('audio');
      if (audio) audio.stopMusic(this, 0);
      this.scene.start('Title', { gameData: this.gameData });
    });
  }
}

// RunCompleteScene — End-of-run screen (victory or defeat)

import Phaser from 'phaser';
import { clearSavedRun } from '../engine/RunManager.js';
import { calculateRenown } from '../engine/MetaProgressionManager.js';
import { MUSIC } from '../utils/musicConfig.js';
import { deleteRunSave } from '../cloud/CloudSync.js';

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
    clearSavedRun(cloud ? () => deleteRunSave(cloud.userId) : null);

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

    // Calculate and award renown
    const rm = this.runManager;
    const actReached = rm.actIndex + 1;
    const renownEarned = calculateRenown(rm.actIndex, rm.completedBattles, isVictory);
    const meta = this.registry.get('meta');
    if (meta) {
      meta.addRenown(renownEarned);
      meta.incrementRunsCompleted();
    }

    // Stats
    const statsLines = [
      `Battles Won: ${rm.completedBattles}`,
      `Act Reached: ${actReached} / 4`,
      '',
      `Renown Earned: +${renownEarned}`,
    ];
    if (meta) statsLines.push(`Total Renown: ${meta.getTotalRenown()}`);
    const statsText = statsLines.join('\n');

    this.add.text(cx, cy - 10, statsText, {
      fontFamily: 'monospace', fontSize: '14px', color: '#e0e0e0',
      align: 'center', lineSpacing: 6,
    }).setOrigin(0.5);

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

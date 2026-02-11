// SlotPickerScene — Save slot selection screen

import Phaser from 'phaser';
import { MAX_SLOTS, getSlotSummary, deleteSlot, setActiveSlot, getMetaKey } from '../engine/SlotManager.js';
import { MetaProgressionManager } from '../engine/MetaProgressionManager.js';
import { HintManager } from '../engine/HintManager.js';
import { loadRun } from '../engine/RunManager.js';
import { MUSIC } from '../utils/musicConfig.js';
import { pushMeta, deleteSlotCloud } from '../cloud/CloudSync.js';
import { startSceneLazy } from '../utils/sceneLoader.js';

export class SlotPickerScene extends Phaser.Scene {
  constructor() {
    super('SlotPicker');
  }

  init(data) {
    this.gameData = data.gameData || data;
  }

  create() {
    const cx = this.cameras.main.centerX;
    this._touchTapDown = null;
    this._tapMoveThreshold = 12;

    this.add.text(cx, 40, 'SELECT SAVE SLOT', {
      fontFamily: 'monospace', fontSize: '24px', color: '#ffdd44', fontStyle: 'bold',
    }).setOrigin(0.5);

    this.input.keyboard.on('keydown-ESC', () => this.requestCancel());
    this.input.on('pointerdown', (pointer) => {
      this._touchTapDown = { x: pointer.x, y: pointer.y };
    });
    this.input.on('pointerup', (pointer) => this.onPointerUp(pointer));

    this.drawSlots();

    // Back button
    const backBtn = this.add.text(cx, 420, '[ Back to Title ]', {
      fontFamily: 'monospace', fontSize: '16px', color: '#e0e0e0',
      backgroundColor: '#000000aa', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    backBtn.on('pointerover', () => backBtn.setColor('#ffdd44'));
    backBtn.on('pointerout', () => backBtn.setColor('#e0e0e0'));
    backBtn.on('pointerdown', async () => {
      await startSceneLazy(this, 'Title', { gameData: this.gameData });
    });
  }

  onPointerUp(pointer) {
    if ((pointer.rightButtonDown && pointer.rightButtonDown()) || pointer.button === 2) return;
    if (pointer.pointerType === 'touch' && this._touchTapDown) {
      const dx = pointer.x - this._touchTapDown.x;
      const dy = pointer.y - this._touchTapDown.y;
      if ((dx * dx + dy * dy) > (this._tapMoveThreshold * this._tapMoveThreshold)) {
        this._touchTapDown = null;
        return;
      }
    }
    this._touchTapDown = null;
    if (!this.confirmDialog) return;
    if (this._isPointerOverInteractive(pointer)) return;
    this.requestCancel({ allowExit: false });
  }

  _isPointerOverInteractive(pointer) {
    if (!this.input || !pointer) return false;
    let hit = [];
    if (typeof this.input.hitTestPointer === 'function') {
      hit = this.input.hitTestPointer(pointer) || [];
    } else if (this.input.manager?.hitTest) {
      hit = this.input.manager.hitTest(pointer, this.children.list, this.cameras.main) || [];
    }
    return Array.isArray(hit) && hit.some(obj =>
      obj
      && obj.visible !== false
      && obj.active !== false
      && obj.input?.enabled
    );
  }

  requestCancel({ allowExit = true } = {}) {
    if (this.confirmDialog) {
      this.confirmDialog.forEach(o => o.destroy());
      this.confirmDialog = null;
      return true;
    }
    if (allowExit) {
      void startSceneLazy(this, 'Title', { gameData: this.gameData });
      return true;
    }
    return false;
  }

  drawSlots() {
    // Clear previous slot cards if redrawing
    if (this.slotCards) this.slotCards.forEach(o => o.destroy());
    this.slotCards = [];

    const cx = this.cameras.main.centerX;
    const cardW = 160;
    const cardH = 200;
    const gap = 20;
    const totalW = MAX_SLOTS * cardW + (MAX_SLOTS - 1) * gap;
    const startX = cx - totalW / 2 + cardW / 2;
    const cardY = 200;

    for (let i = 1; i <= MAX_SLOTS; i++) {
      const x = startX + (i - 1) * (cardW + gap);
      this.drawSlotCard(i, x, cardY, cardW, cardH);
    }
  }

  drawSlotCard(slot, x, y, w, h) {
    const summary = getSlotSummary(slot);
    const isEmpty = !summary;

    // Card background
    const bg = this.add.rectangle(x, y, w, h, 0x222233)
      .setStrokeStyle(2, isEmpty ? 0x444466 : 0x888888);
    this.slotCards.push(bg);

    // Slot header
    const header = this.add.text(x, y - h / 2 + 16, `Slot ${slot}`, {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffdd44', fontStyle: 'bold',
    }).setOrigin(0.5);
    this.slotCards.push(header);

    if (isEmpty) {
      const emptyText = this.add.text(x, y, 'Empty', {
        fontFamily: 'monospace', fontSize: '14px', color: '#555555',
      }).setOrigin(0.5);
      this.slotCards.push(emptyText);
    } else {
      // Valor
      const valorText = this.add.text(x, y - 58, `Valor: ${summary.valor}`, {
        fontFamily: 'monospace', fontSize: '11px', color: '#ffcc44',
      }).setOrigin(0.5);
      this.slotCards.push(valorText);

      // Supply
      const supplyText = this.add.text(x, y - 42, `Supply: ${summary.supply}`, {
        fontFamily: 'monospace', fontSize: '11px', color: '#44ccbb',
      }).setOrigin(0.5);
      this.slotCards.push(supplyText);

      // Runs completed
      const runsText = this.add.text(x, y - 26, `Runs: ${summary.runsCompleted}`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#e0e0e0',
      }).setOrigin(0.5);
      this.slotCards.push(runsText);

      // Active run status
      let runStatus;
      if (summary.hasActiveRun) {
        runStatus = `Act ${summary.actReached} in progress`;
      } else {
        runStatus = 'No active run';
      }
      const statusText = this.add.text(x, y - 6, runStatus, {
        fontFamily: 'monospace', fontSize: '11px',
        color: summary.hasActiveRun ? '#88ff88' : '#666666',
      }).setOrigin(0.5);
      this.slotCards.push(statusText);

      // Select button
      const selectBtn = this.add.text(x, y + 40, '[ Select ]', {
        fontFamily: 'monospace', fontSize: '14px', color: '#88ff88',
        backgroundColor: '#334433', padding: { x: 12, y: 6 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      selectBtn.on('pointerover', () => selectBtn.setColor('#ffdd44'));
      selectBtn.on('pointerout', () => selectBtn.setColor('#88ff88'));
      selectBtn.on('pointerdown', () => this.selectSlot(slot, summary));
      this.slotCards.push(selectBtn);

      // Delete button
      const deleteBtn = this.add.text(x, y + 72, '[ Delete ]', {
        fontFamily: 'monospace', fontSize: '12px', color: '#cc5555',
        backgroundColor: '#332222', padding: { x: 8, y: 4 },
      }).setOrigin(0.5).setInteractive({ useHandCursor: true });

      deleteBtn.on('pointerover', () => deleteBtn.setColor('#ff6666'));
      deleteBtn.on('pointerout', () => deleteBtn.setColor('#cc5555'));
      deleteBtn.on('pointerdown', () => this.confirmDelete(slot));
      this.slotCards.push(deleteBtn);
    }
  }

  selectSlot(slot, summary) {
    // Set active slot on registry + localStorage
    setActiveSlot(slot);
    this.registry.set('activeSlot', slot);

    // Create MetaProgressionManager for this slot
    const meta = new MetaProgressionManager(this.gameData.metaUpgrades, getMetaKey(slot));
    const cloud = this.registry.get('cloud');
    if (cloud) {
      meta.onSave = (payload) => pushMeta(cloud.userId, slot, payload);
    }
    this.registry.set('meta', meta);
    this.registry.set('hints', new HintManager(slot));

    const audio = this.registry.get('audio');
    if (audio) audio.stopMusic(this, 0);

    if (summary.hasActiveRun) {
      // Resume active run directly
      const rm = loadRun(this.gameData, slot);
      if (rm) {
        void startSceneLazy(this, 'NodeMap', { gameData: this.gameData, runManager: rm });
      } else {
        // Run data corrupt — go to HomeBase
        void startSceneLazy(this, 'HomeBase', { gameData: this.gameData });
      }
    } else {
      // No active run — go to HomeBase
      void startSceneLazy(this, 'HomeBase', { gameData: this.gameData });
    }
  }

  confirmDelete(slot) {
    // Show confirmation dialog
    if (this.confirmDialog) this.confirmDialog.forEach(o => o.destroy());
    this.confirmDialog = [];

    const cx = this.cameras.main.centerX;
    const cy = this.cameras.main.centerY;

    const overlay = this.add.rectangle(cx, cy, 640, 480, 0x000000, 0.7).setDepth(500).setInteractive();
    overlay.on('pointerdown', () => this.requestCancel({ allowExit: false }));
    this.confirmDialog.push(overlay);

    const box = this.add.rectangle(cx, cy, 300, 140, 0x222233, 1)
      .setStrokeStyle(2, 0xcc5555).setDepth(501);
    this.confirmDialog.push(box);

    const msg = this.add.text(cx, cy - 30, `Delete Slot ${slot}?`, {
      fontFamily: 'monospace', fontSize: '16px', color: '#ff6666', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(502);
    this.confirmDialog.push(msg);

    const warning = this.add.text(cx, cy - 8, 'This cannot be undone.', {
      fontFamily: 'monospace', fontSize: '11px', color: '#888888',
    }).setOrigin(0.5).setDepth(502);
    this.confirmDialog.push(warning);

    // Confirm button
    const yesBtn = this.add.text(cx - 60, cy + 30, '[ Delete ]', {
      fontFamily: 'monospace', fontSize: '14px', color: '#cc5555',
      backgroundColor: '#332222', padding: { x: 10, y: 6 },
    }).setOrigin(0.5).setDepth(502).setInteractive({ useHandCursor: true });

    yesBtn.on('pointerover', () => yesBtn.setColor('#ff6666'));
    yesBtn.on('pointerout', () => yesBtn.setColor('#cc5555'));
    yesBtn.on('pointerdown', () => {
      deleteSlot(slot);
      const cloud = this.registry.get('cloud');
      if (cloud) deleteSlotCloud(cloud.userId, slot);
      this.confirmDialog.forEach(o => o.destroy());
      this.confirmDialog = null;
      this.drawSlots();
    });
    this.confirmDialog.push(yesBtn);

    // Cancel button
    const noBtn = this.add.text(cx + 60, cy + 30, '[ Cancel ]', {
      fontFamily: 'monospace', fontSize: '14px', color: '#e0e0e0',
      backgroundColor: '#333333', padding: { x: 10, y: 6 },
    }).setOrigin(0.5).setDepth(502).setInteractive({ useHandCursor: true });

    noBtn.on('pointerover', () => noBtn.setColor('#ffdd44'));
    noBtn.on('pointerout', () => noBtn.setColor('#e0e0e0'));
    noBtn.on('pointerdown', () => {
      this.confirmDialog.forEach(o => o.destroy());
      this.confirmDialog = null;
    });
    this.confirmDialog.push(noBtn);
  }
}

// HowToPlayOverlay — Linear paginated guide accessible from Title Screen
// 4 sequential pages. Depth 500-502.

import { HOW_TO_PLAY_PAGES } from '../data/helpContent.js';

const DEPTH_BG = 500;
const DEPTH_PANEL = 501;
const DEPTH_UI = 502;

export class HowToPlayOverlay {
  constructor(scene, onClose) {
    this.scene = scene;
    this.onClose = onClose;
    this.objects = [];
    this.visible = false;
    this.currentPage = 0;
    this.escKey = null;
    this.leftKey = null;
    this.rightKey = null;
  }

  show() {
    this.hide();
    this.visible = true;
    this._draw();

    // Keyboard nav
    this.escKey = this.scene.input.keyboard.addKey('ESC');
    this.escKey.on('down', this._onEsc, this);
    this.leftKey = this.scene.input.keyboard.addKey('LEFT');
    this.leftKey.on('down', this._onLeft, this);
    this.rightKey = this.scene.input.keyboard.addKey('RIGHT');
    this.rightKey.on('down', this._onRight, this);
  }

  _onEsc() { this.hide(); }

  _onLeft() {
    if (this.currentPage > 0) { this.currentPage--; this._draw(); }
  }

  _onRight() {
    if (this.currentPage < HOW_TO_PLAY_PAGES.length - 1) { this.currentPage++; this._draw(); }
  }

  _draw() {
    for (const obj of this.objects) obj.destroy();
    this.objects = [];

    const cx = this.scene.cameras.main.centerX;
    const cy = this.scene.cameras.main.centerY;
    const panelW = 580;
    const panelH = 420;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;
    const pages = HOW_TO_PLAY_PAGES;
    const page = pages[this.currentPage];

    // Dark background
    const bg = this.scene.add.rectangle(cx, cy, 640, 480, 0x000000, 0.85)
      .setDepth(DEPTH_BG).setInteractive();
    this.objects.push(bg);

    // Panel
    const panel = this.scene.add.rectangle(cx, cy, panelW, panelH, 0x1a1a2e, 1)
      .setDepth(DEPTH_PANEL).setStrokeStyle(2, 0x888888);
    this.objects.push(panel);

    // Title
    const title = this.scene.add.text(left + 20, top + 16, 'HOW TO PLAY', {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffdd44', fontStyle: 'bold',
    }).setDepth(DEPTH_UI);
    this.objects.push(title);

    // Close button [X]
    const closeBtn = this.scene.add.text(left + panelW - 20, top + 16, '[X]', {
      fontFamily: 'monospace', fontSize: '14px', color: '#888888',
    }).setOrigin(1, 0).setDepth(DEPTH_UI).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ffdd44'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#888888'));
    closeBtn.on('pointerdown', () => this.hide());
    this.objects.push(closeBtn);

    // Divider
    const divider = this.scene.add.graphics().setDepth(DEPTH_UI);
    divider.lineStyle(1, 0x555555);
    divider.beginPath();
    divider.moveTo(left + 15, top + 40);
    divider.lineTo(left + panelW - 15, top + 40);
    divider.strokePath();
    this.objects.push(divider);

    // Section title
    const contentY = top + 55;
    const sectionTitle = this.scene.add.text(left + 25, contentY, page.title, {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffdd44', fontStyle: 'bold',
    }).setDepth(DEPTH_UI);
    this.objects.push(sectionTitle);

    // Content lines
    const lineStartY = contentY + 30;
    const lineHeight = 19;

    for (let i = 0; i < page.lines.length; i++) {
      const line = page.lines[i];
      if (!line.text && line.text !== '') continue;
      const lineText = this.scene.add.text(left + 25, lineStartY + i * lineHeight, line.text, {
        fontFamily: 'monospace', fontSize: '11px', color: line.color || '#e0e0e0',
      }).setDepth(DEPTH_UI);
      this.objects.push(lineText);
    }

    // Bottom navigation
    const navY = top + panelH - 35;

    // Prev button
    if (this.currentPage > 0) {
      const prevBtn = this.scene.add.text(cx - 100, navY, '\u25C0 Prev', {
        fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa',
        backgroundColor: '#333333', padding: { x: 10, y: 4 },
      }).setOrigin(0.5).setDepth(DEPTH_UI).setInteractive({ useHandCursor: true });
      prevBtn.on('pointerover', () => prevBtn.setColor('#ffdd44'));
      prevBtn.on('pointerout', () => prevBtn.setColor('#aaaaaa'));
      prevBtn.on('pointerdown', () => { this.currentPage--; this._draw(); });
      this.objects.push(prevBtn);
    }

    // Page indicator
    const pageInd = this.scene.add.text(cx, navY,
      `Page ${this.currentPage + 1}/${pages.length}`, {
        fontFamily: 'monospace', fontSize: '10px', color: '#888888',
      }).setOrigin(0.5).setDepth(DEPTH_UI);
    this.objects.push(pageInd);

    // Next button
    if (this.currentPage < pages.length - 1) {
      const nextBtn = this.scene.add.text(cx + 100, navY, 'Next \u25B6', {
        fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa',
        backgroundColor: '#333333', padding: { x: 10, y: 4 },
      }).setOrigin(0.5).setDepth(DEPTH_UI).setInteractive({ useHandCursor: true });
      nextBtn.on('pointerover', () => nextBtn.setColor('#ffdd44'));
      nextBtn.on('pointerout', () => nextBtn.setColor('#aaaaaa'));
      nextBtn.on('pointerdown', () => { this.currentPage++; this._draw(); });
      this.objects.push(nextBtn);
    }
  }

  hide() {
    if (this.escKey) {
      this.escKey.off('down', this._onEsc, this);
      this.escKey = null;
    }
    if (this.leftKey) {
      this.leftKey.off('down', this._onLeft, this);
      this.leftKey = null;
    }
    if (this.rightKey) {
      this.rightKey.off('down', this._onRight, this);
      this.rightKey = null;
    }
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
    if (this.onClose) this.onClose();
  }
}

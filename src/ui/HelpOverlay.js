// HelpOverlay — Tabbed reference dictionary accessible from Pause menu
// 8 tabs with paginated content. Depth 860-862.

import { HELP_TABS } from '../data/helpContent.js';

const DEPTH_BG = 860;
const DEPTH_PANEL = 861;
const DEPTH_UI = 862;

export class HelpOverlay {
  constructor(scene, onClose) {
    this.scene = scene;
    this.onClose = onClose;
    this.objects = [];
    this.visible = false;
    this.activeTabIndex = 0;
    this.currentPage = 0;
    this.escKey = null;
  }

  show() {
    this.hide();
    this.visible = true;
    this._draw();

    // ESC to close
    this.escKey = this.scene.input.keyboard.addKey('ESC');
    this.escKey.on('down', this._onEsc, this);
  }

  _onEsc() {
    this.hide();
  }

  _draw() {
    // Destroy old objects
    for (const obj of this.objects) obj.destroy();
    this.objects = [];

    const cx = this.scene.cameras.main.centerX;
    const cy = this.scene.cameras.main.centerY;
    const panelW = 580;
    const panelH = 420;
    const left = cx - panelW / 2;
    const top = cy - panelH / 2;

    // Dark background
    const bg = this.scene.add.rectangle(cx, cy, 640, 480, 0x000000, 0.85)
      .setDepth(DEPTH_BG).setInteractive();
    this.objects.push(bg);

    // Panel
    const panel = this.scene.add.rectangle(cx, cy, panelW, panelH, 0x1a1a2e, 1)
      .setDepth(DEPTH_PANEL).setStrokeStyle(2, 0x888888);
    this.objects.push(panel);

    // Title
    const title = this.scene.add.text(left + 20, top + 16, 'MORE INFO', {
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

    // Divider line
    const divider = this.scene.add.graphics().setDepth(DEPTH_UI);
    divider.lineStyle(1, 0x555555);
    divider.beginPath();
    divider.moveTo(left + 15, top + 40);
    divider.lineTo(left + panelW - 15, top + 40);
    divider.strokePath();
    this.objects.push(divider);

    // Tab bar
    const tabY = top + 55;
    const tabStartX = left + 15;
    const tabs = HELP_TABS;
    const tabGap = (panelW - 30) / tabs.length;

    for (let i = 0; i < tabs.length; i++) {
      const tx = tabStartX + tabGap * i + tabGap / 2;
      const isActive = i === this.activeTabIndex;
      const tabText = this.scene.add.text(tx, tabY, tabs[i].label, {
        fontFamily: 'monospace', fontSize: '9px',
        color: isActive ? '#ffdd44' : '#888888',
        fontStyle: isActive ? 'bold' : '',
      }).setOrigin(0.5).setDepth(DEPTH_UI);

      if (!isActive) {
        tabText.setInteractive({ useHandCursor: true });
        tabText.on('pointerover', () => tabText.setColor('#cccccc'));
        tabText.on('pointerout', () => tabText.setColor('#888888'));
        tabText.on('pointerdown', () => {
          this.activeTabIndex = i;
          this.currentPage = 0;
          this._draw();
        });
      }
      this.objects.push(tabText);

      // Underline for active tab
      if (isActive) {
        const underline = this.scene.add.graphics().setDepth(DEPTH_UI);
        underline.lineStyle(2, 0xffdd44);
        underline.beginPath();
        const halfW = tabGap * 0.4;
        underline.moveTo(tx - halfW, tabY + 10);
        underline.lineTo(tx + halfW, tabY + 10);
        underline.strokePath();
        this.objects.push(underline);
      }
    }

    // Tab divider
    const tabDiv = this.scene.add.graphics().setDepth(DEPTH_UI);
    tabDiv.lineStyle(1, 0x444444);
    tabDiv.beginPath();
    tabDiv.moveTo(left + 15, tabY + 16);
    tabDiv.lineTo(left + panelW - 15, tabY + 16);
    tabDiv.strokePath();
    this.objects.push(tabDiv);

    // Page content
    const activeTab = tabs[this.activeTabIndex];
    const page = activeTab.pages[this.currentPage];
    const contentY = tabY + 30;

    // Page title
    const pageTitle = this.scene.add.text(left + 25, contentY, page.title, {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffdd44', fontStyle: 'bold',
    }).setDepth(DEPTH_UI);
    this.objects.push(pageTitle);

    // Page indicator (if multi-page)
    if (activeTab.pages.length > 1) {
      const pageInd = this.scene.add.text(left + panelW - 25, contentY,
        `Page ${this.currentPage + 1}/${activeTab.pages.length}`, {
          fontFamily: 'monospace', fontSize: '10px', color: '#888888',
        }).setOrigin(1, 0).setDepth(DEPTH_UI);
      this.objects.push(pageInd);
    }

    // Content lines
    const lineStartY = contentY + 25;
    const lineHeight = 18;

    for (let i = 0; i < page.lines.length; i++) {
      const line = page.lines[i];
      if (!line.text && line.text !== '') continue;
      const lineText = this.scene.add.text(left + 25, lineStartY + i * lineHeight, line.text, {
        fontFamily: 'monospace', fontSize: '11px', color: line.color || '#e0e0e0',
      }).setDepth(DEPTH_UI);
      this.objects.push(lineText);
    }

    // Page navigation buttons
    if (activeTab.pages.length > 1) {
      const navY = top + panelH - 35;

      if (this.currentPage > 0) {
        const prevBtn = this.scene.add.text(cx - 60, navY, '\u25C0 Prev', {
          fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa',
          backgroundColor: '#333333', padding: { x: 10, y: 4 },
        }).setOrigin(0.5).setDepth(DEPTH_UI).setInteractive({ useHandCursor: true });
        prevBtn.on('pointerover', () => prevBtn.setColor('#ffdd44'));
        prevBtn.on('pointerout', () => prevBtn.setColor('#aaaaaa'));
        prevBtn.on('pointerdown', () => { this.currentPage--; this._draw(); });
        this.objects.push(prevBtn);
      }

      if (this.currentPage < activeTab.pages.length - 1) {
        const nextBtn = this.scene.add.text(cx + 60, navY, 'Next \u25B6', {
          fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa',
          backgroundColor: '#333333', padding: { x: 10, y: 4 },
        }).setOrigin(0.5).setDepth(DEPTH_UI).setInteractive({ useHandCursor: true });
        nextBtn.on('pointerover', () => nextBtn.setColor('#ffdd44'));
        nextBtn.on('pointerout', () => nextBtn.setColor('#aaaaaa'));
        nextBtn.on('pointerdown', () => { this.currentPage++; this._draw(); });
        this.objects.push(nextBtn);
      }
    }
  }

  hide() {
    if (this.escKey) {
      this.escKey.off('down', this._onEsc, this);
      this.escKey = null;
    }
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
    if (this.onClose) this.onClose();
  }
}

// HelpOverlay — Tabbed reference dictionary accessible from Pause menu
// 8 tabs with paginated content. Depth 860-862.

import { HELP_TABS } from '../data/helpContent.js';
import { consumeEscEvent } from '../utils/escPriority.js';

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
    this._mobileContextPushed = false;
    this.searchQuery = '';
    this.searchResults = [];
    this.activeSearchResult = -1;
    this.searchIndex = [];
    this.searchInputActive = false;
    this._keyboardSearchHandler = null;
  }

  show() {
    this.hide();
    this.visible = true;
    this.searchQuery = '';
    this.searchResults = [];
    this.activeSearchResult = -1;
    this.searchInputActive = false;
    this._buildSearchIndex();
    this._draw();

    // ESC to close
    this.escKey = this.scene.input.keyboard.addKey('ESC');
    this.escKey.on('down', this._onEsc, this);
    if (this.scene.input?.keyboard?.on) {
      this._keyboardSearchHandler = (event) => this._onKeyDown(event);
      this.scene.input.keyboard.on('keydown', this._keyboardSearchHandler);
    }

    // Mobile overlay tab navigation
    const game = this.scene?.game;
    if (game?.events) {
      game.events.emit('mobile:pushContext', { context: 'overlay_tabs' });
      this._mobileContextPushed = true;
      this._mobilePrev = () => this._mobilePrevAction();
      this._mobileNext = () => this._mobileNextAction();
      game.events.on('mobile:prevTab', this._mobilePrev);
      game.events.on('mobile:nextTab', this._mobileNext);
    }
  }

  _mobilePrevAction() {
    const tabs = HELP_TABS;
    if (this.currentPage > 0) {
      this.currentPage--;
      this._draw();
    } else if (this.activeTabIndex > 0) {
      this.activeTabIndex--;
      this.currentPage = tabs[this.activeTabIndex].pages.length - 1;
      this._draw();
    }
  }

  _mobileNextAction() {
    const tabs = HELP_TABS;
    const activeTab = tabs[this.activeTabIndex];
    if (this.currentPage < activeTab.pages.length - 1) {
      this.currentPage++;
      this._draw();
    } else if (this.activeTabIndex < tabs.length - 1) {
      this.activeTabIndex++;
      this.currentPage = 0;
      this._draw();
    }
  }

  _onEsc(_key, event) {
    if (!consumeEscEvent(this.scene, event)) return;
    if (this.searchInputActive) {
      this.searchInputActive = false;
      this._draw();
      return;
    }
    this.hide();
  }

  _buildSearchIndex() {
    this.searchIndex = [];
    for (let tabIndex = 0; tabIndex < HELP_TABS.length; tabIndex++) {
      const tab = HELP_TABS[tabIndex];
      const tabTags = Array.isArray(tab?.tags) ? tab.tags : [];
      const pages = Array.isArray(tab?.pages) ? tab.pages : [];
      for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
        const page = pages[pageIndex];
        const lines = Array.isArray(page?.lines) ? page.lines : [];
        const pageTags = Array.isArray(page?.tags) ? page.tags : [];
        const lineText = lines.map((line) => line?.text || '').join(' ');
        const source = [
          tab?.label || '',
          page?.title || '',
          lineText,
          ...tabTags,
          ...pageTags,
        ].join(' ');
        this.searchIndex.push({
          tabIndex,
          pageIndex,
          searchText: source.toLowerCase(),
        });
      }
    }
  }

  _setSearchQuery(rawQuery) {
    const query = String(rawQuery || '').slice(0, 26);
    this.searchQuery = query;
    const trimmed = query.trim();
    if (!trimmed) {
      this.searchResults = [];
      this.activeSearchResult = -1;
      this._draw();
      return;
    }

    const needle = trimmed.toLowerCase();
    this.searchResults = this.searchIndex.filter((entry) => entry.searchText.includes(needle));
    if (this.searchResults.length > 0) {
      this.activeSearchResult = 0;
      const first = this.searchResults[0];
      this.activeTabIndex = first.tabIndex;
      this.currentPage = first.pageIndex;
    } else {
      this.activeSearchResult = -1;
    }
    this._draw();
  }

  _jumpToSearchResult(direction = 1) {
    if (this.searchResults.length <= 0) return;
    const len = this.searchResults.length;
    const next = (this.activeSearchResult + direction + len) % len;
    this.activeSearchResult = next;
    const hit = this.searchResults[next];
    this.activeTabIndex = hit.tabIndex;
    this.currentPage = hit.pageIndex;
    this._draw();
  }

  _onKeyDown(event) {
    if (!this.visible) return;
    const key = String(event?.key || '');

    if (!this.searchInputActive) {
      if (key === '/') {
        this.searchInputActive = true;
        if (event?.preventDefault) event.preventDefault();
        this._draw();
      }
      return;
    }

    if (key === 'Enter') {
      this._jumpToSearchResult(1);
      if (event?.preventDefault) event.preventDefault();
      return;
    }
    if (key === 'Backspace') {
      this._setSearchQuery(this.searchQuery.slice(0, -1));
      if (event?.preventDefault) event.preventDefault();
      return;
    }
    if (key === 'Escape') {
      this.searchInputActive = false;
      this._draw();
      return;
    }
    if (key.length === 1 && !event?.ctrlKey && !event?.metaKey) {
      this._setSearchQuery(this.searchQuery + key);
      if (event?.preventDefault) event.preventDefault();
    }
  }

  _matchesSearch(text) {
    const needle = this.searchQuery.trim().toLowerCase();
    if (!needle) return false;
    return String(text || '')
      .toLowerCase()
      .includes(needle);
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
    const bg = this.scene.add
      .rectangle(cx, cy, 640, 480, 0x000000, 0.85)
      .setDepth(DEPTH_BG)
      .setInteractive();
    this.objects.push(bg);

    // Panel
    const panel = this.scene.add
      .rectangle(cx, cy, panelW, panelH, 0x1a1a2e, 1)
      .setDepth(DEPTH_PANEL)
      .setStrokeStyle(2, 0x888888);
    this.objects.push(panel);

    // Title
    const title = this.scene.add
      .text(left + 20, top + 16, 'MORE INFO', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffdd44',
        fontStyle: 'bold',
      })
      .setDepth(DEPTH_UI);
    this.objects.push(title);

    // Close button [X]
    const closeBtn = this.scene.add
      .text(left + panelW - 20, top + 16, '[X]', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#888888',
      })
      .setOrigin(1, 0)
      .setDepth(DEPTH_UI)
      .setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ffdd44'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#888888'));
    closeBtn.on('pointerdown', () => this.hide());
    this.objects.push(closeBtn);

    // Search controls
    const searchLabel = this.scene.add
      .text(left + 160, top + 18, 'Search:', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#888888',
      })
      .setDepth(DEPTH_UI);
    this.objects.push(searchLabel);

    const searchBoxW = 190;
    const searchBoxH = 16;
    const searchBoxX = left + 205 + searchBoxW / 2;
    const searchBoxY = top + 24;
    const searchBox = this.scene.add
      .rectangle(searchBoxX, searchBoxY, searchBoxW, searchBoxH, 0x111111, 1)
      .setDepth(DEPTH_UI)
      .setStrokeStyle(1, this.searchInputActive ? 0xffdd44 : 0x555555)
      .setInteractive({ useHandCursor: true });
    searchBox.on('pointerdown', () => {
      this.searchInputActive = true;
      this._draw();
    });
    this.objects.push(searchBox);

    const queryText =
      this.searchQuery.length > 0
        ? this.searchQuery
        : this.searchInputActive
          ? ''
          : 'Press / to search';
    const searchValue = this.scene.add
      .text(left + 212, top + 18, queryText, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: this.searchQuery.length > 0 ? '#e0e0e0' : '#666666',
      })
      .setDepth(DEPTH_UI)
      .setInteractive({ useHandCursor: true });
    searchValue.on('pointerdown', () => {
      this.searchInputActive = true;
      this._draw();
    });
    this.objects.push(searchValue);

    if (this.searchQuery.trim().length > 0) {
      const statusText =
        this.searchResults.length > 0
          ? `${this.activeSearchResult + 1}/${this.searchResults.length}`
          : 'No matches';
      const statusColor = this.searchResults.length > 0 ? '#66ff66' : '#ff8888';
      const searchStatus = this.scene.add
        .text(left + panelW - 72, top + 18, statusText, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: statusColor,
        })
        .setDepth(DEPTH_UI);
      this.objects.push(searchStatus);
    }

    // Divider line
    const divider = this.scene.add.graphics().setDepth(DEPTH_UI);
    divider.lineStyle(1, 0x555555);
    divider.beginPath();
    divider.moveTo(left + 15, top + 46);
    divider.lineTo(left + panelW - 15, top + 46);
    divider.strokePath();
    this.objects.push(divider);

    // Tab bar
    const tabY = top + 62;
    const tabStartX = left + 15;
    const tabs = HELP_TABS;
    const tabGap = (panelW - 30) / tabs.length;

    for (let i = 0; i < tabs.length; i++) {
      const tx = tabStartX + tabGap * i + tabGap / 2;
      const isActive = i === this.activeTabIndex;
      const tabText = this.scene.add
        .text(tx, tabY, tabs[i].label, {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: isActive ? '#ffdd44' : '#888888',
          fontStyle: isActive ? 'bold' : '',
        })
        .setOrigin(0.5)
        .setDepth(DEPTH_UI);

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
    const pageTitle = this.scene.add
      .text(left + 25, contentY, page.title, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: this._matchesSearch(page.title) ? '#66ff66' : '#ffdd44',
        fontStyle: 'bold',
      })
      .setDepth(DEPTH_UI);
    this.objects.push(pageTitle);

    // Page indicator (if multi-page)
    if (activeTab.pages.length > 1) {
      const pageInd = this.scene.add
        .text(
          left + panelW - 25,
          contentY,
          `Page ${this.currentPage + 1}/${activeTab.pages.length}`,
          {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#888888',
          },
        )
        .setOrigin(1, 0)
        .setDepth(DEPTH_UI);
      this.objects.push(pageInd);
    }

    // Content lines
    const lineStartY = contentY + 25;
    const lineHeight = 18;

    for (let i = 0; i < page.lines.length; i++) {
      const line = page.lines[i];
      if (!line.text && line.text !== '') continue;
      const isMatch = this._matchesSearch(line.text);
      const lineText = this.scene.add
        .text(left + 25, lineStartY + i * lineHeight, line.text, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: isMatch ? '#66ff66' : line.color || '#e0e0e0',
        })
        .setDepth(DEPTH_UI);
      this.objects.push(lineText);
    }

    // Page navigation buttons
    if (activeTab.pages.length > 1) {
      const navY = top + panelH - 35;

      if (this.currentPage > 0) {
        const prevBtn = this.scene.add
          .text(cx - 60, navY, '\u25C0 Prev', {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#aaaaaa',
            backgroundColor: '#333333',
            padding: { x: 10, y: 4 },
          })
          .setOrigin(0.5)
          .setDepth(DEPTH_UI)
          .setInteractive({ useHandCursor: true });
        prevBtn.on('pointerover', () => prevBtn.setColor('#ffdd44'));
        prevBtn.on('pointerout', () => prevBtn.setColor('#aaaaaa'));
        prevBtn.on('pointerdown', () => {
          this.currentPage--;
          this._draw();
        });
        this.objects.push(prevBtn);
      }

      if (this.currentPage < activeTab.pages.length - 1) {
        const nextBtn = this.scene.add
          .text(cx + 60, navY, 'Next \u25B6', {
            fontFamily: 'monospace',
            fontSize: '12px',
            color: '#aaaaaa',
            backgroundColor: '#333333',
            padding: { x: 10, y: 4 },
          })
          .setOrigin(0.5)
          .setDepth(DEPTH_UI)
          .setInteractive({ useHandCursor: true });
        nextBtn.on('pointerover', () => nextBtn.setColor('#ffdd44'));
        nextBtn.on('pointerout', () => nextBtn.setColor('#aaaaaa'));
        nextBtn.on('pointerdown', () => {
          this.currentPage++;
          this._draw();
        });
        this.objects.push(nextBtn);
      }
    }
  }

  hide() {
    const wasVisible = this.visible;
    const game = this.scene?.game;
    if (game?.events) {
      if (this._mobilePrev) game.events.off('mobile:prevTab', this._mobilePrev);
      if (this._mobileNext) game.events.off('mobile:nextTab', this._mobileNext);
      this._mobilePrev = null;
      this._mobileNext = null;
      if (this._mobileContextPushed) {
        this._mobileContextPushed = false;
        game.events.emit('mobile:popContext');
      }
    }
    if (this.escKey) {
      this.escKey.off('down', this._onEsc, this);
      this.escKey = null;
    }
    if (this._keyboardSearchHandler && this.scene.input?.keyboard?.off) {
      this.scene.input.keyboard.off('keydown', this._keyboardSearchHandler);
      this._keyboardSearchHandler = null;
    }
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
    if (wasVisible && this.onClose) this.onClose();
  }
}

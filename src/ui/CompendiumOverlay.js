// CompendiumOverlay — Encyclopedia data browser for game content
// 10 tabs with sub-filters, pagination, and search. Depth 870-872.

import { consumeEscEvent } from '../utils/escPriority.js';
import { LORE_TEXT_COLOR } from '../utils/constants.js';
import { hasAnySlotMilestone } from '../engine/SlotManager.js';
import { pushOverlay, removeOverlay, isTopOverlay } from '../utils/overlayStack.js';
import { formatUses, getConsumableDescription } from '../utils/consumableText.js';
import { getImbueStoneItems } from '../engine/ImbueSystem.js';
import { BoundingFocusController } from './BoundingFocusController.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';

const DEPTH_BG = 870;
const DEPTH_PANEL = 871;
const DEPTH_UI = 872;

// Exported for tests (tab labels/filters drive the gamepad cycling contracts).
export const TAB_DEFS = [
  {
    label: 'Arms',
    key: 'weapons',
    filters: ['All', 'Sword', 'Lance', 'Axe', 'Bow', 'Tome', 'Light', 'Staff', 'Scroll', 'Breath'],
  },
  {
    label: 'Skills',
    key: 'skills',
    filters: ['All', 'Passive', 'Aura', 'Combat', 'Attack', 'Defend', 'Turn', 'Action'],
  },
  { label: 'Arts', key: 'weaponArts', filters: ['All', 'Sword', 'Lance', 'Axe', 'Bow', 'Tome'] },
  { label: 'Class', key: 'classes', filters: ['All', 'base', 'promoted'] },
  { label: 'Items', key: 'items', filters: ['All', 'Consumable', 'Accessory', 'Whetstone'] },
  { label: 'Lords', key: 'lords', filters: null },
  { label: 'Bless', key: 'blessings', filters: ['All', 'T1', 'T2', 'T3', 'T4'] },
  { label: 'Terrain', key: 'terrain', filters: null },
  { label: 'Affixes', key: 'affixes', filters: ['All', 'T1', 'T2'] },
  // Appended last so existing tab indices (and index-based tests) stay stable.
  { label: 'Foes', key: 'foes', filters: ['All', 'Bosses', 'Classes'] },
];

const SKILL_FILTER_MAP = {
  Passive: 'passive',
  Aura: 'passive-aura',
  Combat: 'on-combat-start',
  Attack: 'on-attack',
  Defend: 'on-defend',
  Turn: 'on-turn-start',
  Action: 'action',
};

const ITEMS_PER_PAGE = 10;
const LORD_ITEMS_PER_PAGE = 6;
const DEFAULT_LINES_PER_ITEM = 2;
const DEFAULT_LINE_HEIGHT = 14;
const ITEM_GAP = 2;

// Tabs whose rows carry a lore line get taller rows and fewer per page.
// Content rows must end at least 10px above the page-navigation baseline.
export const PER_PAGE_BY_KEY = {
  lords: LORD_ITEMS_PER_PAGE,
  weapons: 6,
  items: 6,
  blessings: 6,
  skills: 9,
  weaponArts: 9,
  classes: 5,
  terrain: 9,
  affixes: 9,
  foes: 5,
};
export const LINES_BY_KEY = {
  lords: 3,
  weapons: 3,
  items: 3,
  blessings: 3,
  classes: 4,
  foes: 4,
};
export const ROW_HEIGHT_BY_KEY = { classes: 54, foes: 54 };

export function getCompendiumRowHeight(key) {
  return (
    ROW_HEIGHT_BY_KEY[key] ??
    (LINES_BY_KEY[key] ?? DEFAULT_LINES_PER_ITEM) * DEFAULT_LINE_HEIGHT + ITEM_GAP
  );
}

export class CompendiumOverlay {
  constructor(scene, gameData, onClose) {
    this.scene = scene;
    this.gameData = gameData;
    this.onClose = onClose;
    this.objects = [];
    this.visible = false;
    this.activeTabIndex = 0;
    this.activeFilterIndex = 0;
    this.currentPage = 0;
    this.escKey = null;
    this._mobileContextPushed = false;
    this.searchQuery = '';
    this.searchResults = [];
    this.activeSearchResult = -1;
    this.searchIndex = [];
    this.searchInputActive = false;
    this._keyboardSearchHandler = null;
    // Memoized bestiary list (bosses gated by act-reached milestones + all
    // classes). Reset on each show() so milestone unlocks appear in real time.
    this._foesItems = null;

    // Gamepad/keyboard focus: a ring on the active tab. The overlay pushes one
    // input-focus scope (LIFO) on show and pops it on hide, so the pad drives it on
    // top of the pause menu that opened it. L1/R1 cycle tabs; d-pad up/down cycle the
    // sub-filter; d-pad left/right page; B/Start close (B first exits search).
    this._focus = null;
    this._onInputBound = null;
    this._activeTabObj = null;
  }

  show() {
    this.hide();
    this.visible = true;
    this.searchQuery = '';
    this.searchResults = [];
    this.activeSearchResult = -1;
    this.searchInputActive = false;
    // Re-read act-reached milestones every open so newly reached bosses appear
    // (incl. mid-run pause → Compendium) and drop out of the search index too.
    this._foesItems = null;
    this._buildSearchIndex();
    this._draw();
    this._setupFocus();

    this._overlayToken = pushOverlay(this.scene, {
      name: 'compendium',
      onCancel: (event) => {
        this._onEsc(null, event);
        return true;
      },
    });
    this.escKey = this.scene.input.keyboard.addKey('ESC');
    this.escKey.on('down', this._onEsc, this);
    if (this.scene.input?.keyboard?.on) {
      this._keyboardSearchHandler = (event) => this._onKeyDown(event);
      this.scene.input.keyboard.on('keydown', this._keyboardSearchHandler);
    }

    const game = this.scene?.game;
    if (game?.events) {
      this._mobileContextToken = Symbol('mobile-context');
      game.events.emit('mobile:pushContext', {
        context: 'overlay_tabs',
        token: this._mobileContextToken,
      });
      this._mobileContextPushed = true;
      this._mobilePrev = () => this._mobilePrevAction();
      this._mobileNext = () => this._mobileNextAction();
      game.events.on('mobile:prevTab', this._mobilePrev);
      game.events.on('mobile:nextTab', this._mobileNext);
    }

    // Guard against scene shutdown while overlay is open
    if (!this._shutdownBound && this.scene?.events?.on) {
      this._shutdownBound = true;
      this.scene.events.on('shutdown', () => {
        // Never leak the input-focus scope on hard shutdown — the stack is a
        // module-level global that outlives the scene, so a missed pop would
        // swallow all pad input in the next scene. Idempotent, so the normal
        // host-driven hide() path is unaffected.
        this._teardownFocus();
        const g = this.scene?.game;
        if (g?.events) {
          if (this._mobilePrev) g.events.off('mobile:prevTab', this._mobilePrev);
          if (this._mobileNext) g.events.off('mobile:nextTab', this._mobileNext);
          this._mobilePrev = null;
          this._mobileNext = null;
          if (this._mobileContextPushed) {
            this._mobileContextPushed = false;
            g.events.emit('mobile:popContext', { token: this._mobileContextToken });
            this._mobileContextToken = null;
          }
        }
      });
    }
  }

  _mobilePrevAction() {
    if (this.currentPage > 0) {
      this.currentPage--;
      this._draw();
    } else if (this.activeTabIndex > 0) {
      this.activeTabIndex--;
      this.activeFilterIndex = 0;
      const items = this._getFilteredItems();
      const perPage = this._itemsPerPage();
      this.currentPage = Math.max(0, Math.ceil(items.length / perPage) - 1);
      this._draw();
    }
  }

  _mobileNextAction() {
    const items = this._getFilteredItems();
    const perPage = this._itemsPerPage();
    const maxPage = Math.max(0, Math.ceil(items.length / perPage) - 1);
    if (this.currentPage < maxPage) {
      this.currentPage++;
      this._draw();
    } else if (this.activeTabIndex < TAB_DEFS.length - 1) {
      this.activeTabIndex++;
      this.activeFilterIndex = 0;
      this.currentPage = 0;
      this._draw();
    }
  }

  _onEsc(_key, event) {
    if (!isTopOverlay(this.scene, this._overlayToken)) return;
    if (!consumeEscEvent(this.scene, event)) return;
    if (this.searchInputActive) {
      this.searchInputActive = false;
      this._draw();
      return;
    }
    this.hide();
  }

  _itemsPerPage() {
    return PER_PAGE_BY_KEY[TAB_DEFS[this.activeTabIndex].key] ?? ITEMS_PER_PAGE;
  }

  _getItemsForTab(tabIndex) {
    const def = TAB_DEFS[tabIndex];
    if (!def) return [];
    const gd = this.gameData;
    if (!gd) return [];
    switch (def.key) {
      case 'weapons':
        return gd.weapons || [];
      case 'skills':
        return gd.skills || [];
      case 'weaponArts':
        return gd.weaponArts?.arts || [];
      case 'classes':
        return gd.classes || [];
      case 'items':
        return [
          ...(gd.consumables || []),
          ...(gd.accessories || []),
          ...(gd.whetstones || []),
          ...getImbueStoneItems(gd.imbues),
        ];
      case 'lords':
        return gd.lords || [];
      case 'blessings':
        return gd.blessings?.blessings || [];
      case 'terrain':
        return gd.terrain || [];
      case 'affixes':
        return gd.affixes?.affixes || [];
      case 'foes':
        return this._getFoesItems();
      default:
        return [];
    }
  }

  // Bestiary entries: all named bosses (act-labelled) followed by every class.
  // Memoized so item identities stay stable across redraws and the search index.
  _getFoesItems() {
    if (this._foesItems) return this._foesItems;
    const gd = this.gameData;
    // Each act's bosses stay hidden until any run (any slot) has reached that
    // act. Read cross-slot so Title-screen access (no registry meta) matches
    // in-run access. Classes below are always visible.
    const bossActs = [
      ['act1', 'Act 1', 'reachedAct1'],
      ['act2', 'Act 2', 'reachedAct2'],
      ['act3', 'Act 3', 'reachedAct3'],
      ['act4', 'Act 4', 'reachedAct4'],
      ['finalBoss', 'Final', 'reachedFinalBoss'],
    ];
    const bosses = [];
    for (const [actKey, actLabel, milestone] of bossActs) {
      if (!hasAnySlotMilestone(milestone)) continue;
      for (const boss of gd?.enemies?.bosses?.[actKey] || []) {
        bosses.push({ ...boss, _kind: 'boss', _actLabel: actLabel });
      }
    }
    const classes = (gd?.classes || []).map((c) => ({ ...c, _kind: 'class' }));
    this._foesItems = [...bosses, ...classes];
    return this._foesItems;
  }

  _getFilteredItems() {
    const items = this._getItemsForTab(this.activeTabIndex);
    const def = TAB_DEFS[this.activeTabIndex];
    if (!def.filters || this.activeFilterIndex === 0) return items;
    const filterLabel = def.filters[this.activeFilterIndex];
    switch (def.key) {
      case 'weapons':
        return items.filter((i) => i.type === filterLabel);
      case 'skills': {
        const trigger = SKILL_FILTER_MAP[filterLabel];
        return trigger ? items.filter((i) => i.trigger === trigger) : items;
      }
      case 'weaponArts':
        return items.filter((i) => i.weaponType === filterLabel);
      case 'classes':
        return items.filter((i) => i.tier === filterLabel);
      case 'items':
        return items.filter((i) => i.type === filterLabel);
      case 'blessings': {
        const tier = parseInt(filterLabel.replace('T', ''), 10);
        return items.filter((i) => i.tier === tier);
      }
      case 'affixes': {
        const tier = parseInt(filterLabel.replace('T', ''), 10);
        return items.filter((i) => i.tier === tier);
      }
      case 'foes':
        return items.filter((i) =>
          filterLabel === 'Bosses' ? i._kind === 'boss' : i._kind === 'class',
        );
      default:
        return items;
    }
  }

  _buildSearchIndex() {
    this.searchIndex = [];
    for (let tabIndex = 0; tabIndex < TAB_DEFS.length; tabIndex++) {
      const items = this._getItemsForTab(tabIndex);
      for (let itemIndex = 0; itemIndex < items.length; itemIndex++) {
        const item = items[itemIndex];
        // Classes already index under the Class tab — skip their Foes-tab copies
        // so a class-name search jumps there instead of bouncing to the bestiary.
        if (TAB_DEFS[tabIndex].key === 'foes' && item._kind === 'class') continue;
        const parts = [
          item.name || '',
          item.description || '',
          item.type || '',
          item.trigger || '',
          item.special || '',
          item.weaponType || '',
          item.lore || '',
          item.tier != null ? String(item.tier) : '',
        ];
        this.searchIndex.push({
          tabIndex,
          itemIndex,
          searchText: parts.join(' ').toLowerCase(),
        });
      }
    }
  }

  _setSearchQuery(rawQuery) {
    const query = String(rawQuery || '').slice(0, 40);
    this.searchQuery = query;
    const trimmed = query.trim();
    if (!trimmed) {
      this.searchResults = [];
      this.activeSearchResult = -1;
      this._draw();
      return;
    }

    const needle = trimmed.toLowerCase();
    this.searchResults = this.searchIndex.filter((e) => e.searchText.includes(needle));
    if (this.searchResults.length > 0) {
      this.activeSearchResult = 0;
      this._jumpToResult(this.searchResults[0]);
    } else {
      this.activeSearchResult = -1;
    }
    this._draw();
  }

  _jumpToResult(result) {
    this.activeTabIndex = result.tabIndex;
    this.activeFilterIndex = 0; // reset sub-filter to "All"
    const perPage = this._itemsPerPage();
    this.currentPage = Math.floor(result.itemIndex / perPage);
  }

  _jumpToSearchResult(direction = 1) {
    if (this.searchResults.length <= 0) return;
    const len = this.searchResults.length;
    const next = (this.activeSearchResult + direction + len) % len;
    this.activeSearchResult = next;
    this._jumpToResult(this.searchResults[next]);
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
      .text(left + 20, top + 16, 'COMPENDIUM', {
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
    this._drawSearch(left, top, panelW);

    // Divider
    const divider = this.scene.add.graphics().setDepth(DEPTH_UI);
    divider.lineStyle(1, 0x555555);
    divider.beginPath();
    divider.moveTo(left + 15, top + 46);
    divider.lineTo(left + panelW - 15, top + 46);
    divider.strokePath();
    this.objects.push(divider);

    // Tab bar
    this._drawTabs(left, top, panelW);

    // Sub-filter row
    const def = TAB_DEFS[this.activeTabIndex];
    let contentStartY = top + 92;
    if (def.filters) {
      this._drawFilters(left, top + 80, panelW, def.filters);
      contentStartY = top + 102;
    }

    // Content
    const items = this._getFilteredItems();
    const perPage = this._itemsPerPage();
    const totalPages = Math.max(1, Math.ceil(items.length / perPage));
    if (this.currentPage >= totalPages) this.currentPage = totalPages - 1;
    const startIdx = this.currentPage * perPage;
    const pageItems = items.slice(startIdx, startIdx + perPage);

    this._renderItems(pageItems, contentStartY, left, panelW);

    // Page navigation
    if (totalPages > 1) {
      this._drawPageNav(left, top, panelW, panelH, totalPages);
    }

    // _draw() rebuilds this.objects (including the active tab), so re-point the
    // gamepad ring at the freshly created active-tab object after every redraw.
    if (this._focus) this._renderFocus();
  }

  // --- Gamepad/keyboard focus ---

  _setupFocus() {
    this._focus = new BoundingFocusController(this.scene, DEPTH_UI + 3);
    if (!this._onInputBound) {
      this._onInputBound = (action, payload) => this._onInput(action, payload);
    }
    pushInputScope(this, this._onInputBound);
    this._renderFocus();
  }

  _teardownFocus() {
    if (this._onInputBound) {
      popInputScope(this);
      this._onInputBound = null;
    }
    if (this._focus) {
      this._focus.destroy();
      this._focus = null;
    }
    this._activeTabObj = null;
  }

  _renderFocus() {
    if (!this._focus) return;
    this._focus.setObjects(this._activeTabObj ? [this._activeTabObj] : [], true);
  }

  _onInput(action, payload) {
    if (!this.visible) return;
    // While keyboard search-input mode is active, only backing out acts on the
    // pad — tab/filter/page cycling would silently abandon the tab/page the
    // search jumped to while the box still shows the query and result counter.
    if (this.searchInputActive && action !== InputAction.CANCEL && action !== InputAction.PAUSE) {
      return;
    }
    switch (action) {
      case InputAction.PREV_UNIT:
        this._cycleTab(-1);
        break;
      case InputAction.NEXT_UNIT:
        this._cycleTab(1);
        break;
      case InputAction.NAVIGATE:
        // up/down cycle the sub-filter (no-op on filter-less tabs); left/right page.
        if (payload?.dy) this._cycleFilter(payload.dy > 0 ? 1 : -1);
        else if (payload?.dx) this._cyclePage(payload.dx > 0 ? 1 : -1);
        break;
      case InputAction.CONFIRM:
        // A advances in reading order (next page, then next tab) — same
        // affordance as the mobile next-tab button, so the focus ring's
        // console-standard "A does something" promise holds.
        this._mobileNextAction();
        break;
      case InputAction.CANCEL:
      case InputAction.PAUSE:
        if (this.searchInputActive) {
          this.searchInputActive = false;
          this._draw();
        } else {
          this.hide();
        }
        break;
    }
  }

  // Cycle tabs with wraparound; reset the sub-filter and page.
  _cycleTab(dir) {
    const n = TAB_DEFS.length;
    if (n <= 1) return;
    this.activeTabIndex = (this.activeTabIndex + dir + n) % n;
    this.activeFilterIndex = 0;
    this.currentPage = 0;
    this._draw();
  }

  // Cycle the active tab's sub-filter with wraparound; reset to the first page.
  // No-op on tabs without filters (Lords, Terrain).
  _cycleFilter(dir) {
    const filters = TAB_DEFS[this.activeTabIndex]?.filters;
    if (!filters || filters.length <= 1) return;
    this.activeFilterIndex = (this.activeFilterIndex + dir + filters.length) % filters.length;
    this.currentPage = 0;
    this._draw();
  }

  // Step pages within the filtered list, clamped at the ends.
  _cyclePage(dir) {
    const items = this._getFilteredItems();
    const totalPages = Math.max(1, Math.ceil(items.length / this._itemsPerPage()));
    const next = Math.max(0, Math.min(totalPages - 1, this.currentPage + dir));
    if (next === this.currentPage) return;
    this.currentPage = next;
    this._draw();
  }

  _drawSearch(left, top, panelW) {
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
  }

  _drawTabs(left, top, panelW) {
    const tabY = top + 62;
    const tabStartX = left + 15;
    const tabGap = (panelW - 30) / TAB_DEFS.length;

    for (let i = 0; i < TAB_DEFS.length; i++) {
      const tx = tabStartX + tabGap * i + tabGap / 2;
      const isActive = i === this.activeTabIndex;
      const tabText = this.scene.add
        .text(tx, tabY, TAB_DEFS[i].label, {
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
          this.activeFilterIndex = 0;
          this.currentPage = 0;
          this._draw();
        });
      }
      this.objects.push(tabText);

      if (isActive) {
        this._activeTabObj = tabText; // gamepad focus ring target
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
    tabDiv.moveTo(left + 15, top + 76);
    tabDiv.lineTo(left + panelW - 15, top + 76);
    tabDiv.strokePath();
    this.objects.push(tabDiv);
  }

  _drawFilters(left, filterY, panelW, filters) {
    let fx = left + 25;
    for (let i = 0; i < filters.length; i++) {
      const isActive = i === this.activeFilterIndex;
      const chip = this.scene.add
        .text(fx, filterY, filters[i], {
          fontFamily: 'monospace',
          fontSize: '8px',
          color: isActive ? '#ffdd44' : '#777777',
        })
        .setDepth(DEPTH_UI);

      if (!isActive) {
        chip.setInteractive({ useHandCursor: true });
        chip.on('pointerover', () => chip.setColor('#cccccc'));
        chip.on('pointerout', () => chip.setColor('#777777'));
        chip.on('pointerdown', () => {
          this.activeFilterIndex = i;
          this.currentPage = 0;
          this._draw();
        });
      } else {
        // Gold underline for active filter
        const underline = this.scene.add.graphics().setDepth(DEPTH_UI);
        underline.lineStyle(1, 0xffdd44);
        underline.beginPath();
        underline.moveTo(fx, filterY + 12);
        // Approximate width based on character count
        underline.lineTo(fx + filters[i].length * 5, filterY + 12);
        underline.strokePath();
        this.objects.push(underline);
      }
      this.objects.push(chip);
      fx += filters[i].length * 5 + 12;
    }
  }

  _renderItems(items, startY, left, panelW) {
    const def = TAB_DEFS[this.activeTabIndex];
    if (items.length === 0) {
      // The Foes tab's Bosses filter can be empty on a fresh save (nothing
      // reached yet). Other tabs shouldn't hit this, but guard generically.
      const msg = def.key === 'foes' ? 'No foes encountered yet.' : 'Nothing to show yet.';
      this._text(left + panelW / 2, startY + 8, msg, '#888888', 0.5);
      return;
    }
    const itemGap = getCompendiumRowHeight(def.key);
    const rightX = left + panelW - 25;

    for (let i = 0; i < items.length; i++) {
      const y = startY + i * itemGap;
      const item = items[i];
      switch (def.key) {
        case 'weapons':
          this._renderWeapon(item, y, left, rightX);
          break;
        case 'skills':
          this._renderSkill(item, y, left, rightX);
          break;
        case 'weaponArts':
          this._renderArt(item, y, left, rightX);
          break;
        case 'classes':
          this._renderClass(item, y, left, rightX);
          break;
        case 'items':
          this._renderItem(item, y, left, rightX);
          break;
        case 'lords':
          this._renderLord(item, y, left, rightX);
          break;
        case 'blessings':
          this._renderBlessing(item, y, left, rightX);
          break;
        case 'terrain':
          this._renderTerrain(item, y, left, rightX);
          break;
        case 'affixes':
          this._renderAffix(item, y, left, rightX);
          break;
        case 'foes':
          this._renderFoe(item, y, left, rightX);
          break;
      }
    }
  }

  _renderWeapon(item, y, left, rightX) {
    const nameColor = this._matchesSearch(item.name)
      ? '#66ff66'
      : item.tier === 'Legend'
        ? '#ffdd44'
        : '#e0e0e0';
    this._text(left + 25, y, item.name, nameColor);
    this._text(
      rightX,
      y,
      `${item.type}  ${item.tier || ''}  ${item.rankRequired || ''}`,
      '#888888',
      1,
    );

    if (item.type === 'Scroll') {
      const taught = item.skillId || item.teachesWeaponArtId || '?';
      this._text(left + 25, y + 14, `Teaches: ${taught}  ${item.price || 0}g`, '#aaaaaa');
    } else {
      const stats = `Mt:${item.might ?? '-'}  Ht:${item.hit ?? '-'}  Cr:${item.crit ?? '-'}  Wt:${item.weight ?? '-'}  Rng:${item.range ?? '-'}`;
      this._text(left + 25, y + 14, stats, '#aaaaaa');
      this._text(rightX, y + 14, `${item.price || 0}g`, '#aaaaaa', 1);
    }
    this._renderLoreLine(item, y + 28, left);
  }

  _renderSkill(item, y, left, rightX) {
    const nameColor = this._matchesSearch(item.name) ? '#66ff66' : '#e0e0e0';
    this._text(left + 25, y, item.name, nameColor);
    const activation = item.activation ? `  ${item.activation}%` : '';
    this._text(rightX, y, `${item.trigger || ''}${activation}`, '#888888', 1);
    this._text(left + 25, y + 14, item.description || '', '#aaaaaa');
  }

  _renderArt(item, y, left, rightX) {
    const nameColor = this._matchesSearch(item.name) ? '#66ff66' : '#e0e0e0';
    this._text(left + 25, y, item.name, nameColor);
    this._text(
      rightX,
      y,
      `${item.weaponType || ''}  ${item.requiredRank || ''}  HP:${item.hpCost ?? '?'}  Act:${item.unlockAct || '?'}`,
      '#888888',
      1,
    );
    this._text(left + 25, y + 14, item.description || '', '#aaaaaa');
  }

  _renderClass(item, y, left, rightX) {
    const nameColor = this._matchesSearch(item.name) ? '#66ff66' : '#e0e0e0';
    this._text(left + 25, y, item.name, nameColor);
    const profs = Array.isArray(item.weaponProficiencies)
      ? item.weaponProficiencies.join('/')
      : typeof item.weaponProficiencies === 'string'
        ? item.weaponProficiencies
        : '';
    this._text(rightX, y, `${item.tier || ''}  ${item.moveType || ''}  ${profs}`, '#888888', 1);

    const bs = item.baseStats || {};
    const statLine = `HP:${bs.HP ?? '-'} STR:${bs.STR ?? '-'} MAG:${bs.MAG ?? '-'} SKL:${bs.SKL ?? '-'} SPD:${bs.SPD ?? '-'} DEF:${bs.DEF ?? '-'} RES:${bs.RES ?? '-'} MOV:${bs.MOV ?? '-'}`;
    const promotesToDisplay = Array.isArray(item.promotesTo)
      ? item.promotesTo.join(' / ')
      : item.promotesTo;
    const link = promotesToDisplay
      ? `\u2192 ${promotesToDisplay}`
      : item.promotesFrom
        ? `\u2190 ${item.promotesFrom}`
        : '';
    this._text(left + 25, y + 14, statLine, '#aaaaaa');
    if (link) this._text(rightX, y + 14, link, '#888888', 1);
    const loreLines = this._wrapLore(item.lore, 84, 2);
    for (let i = 0; i < loreLines.length; i++) {
      this._text(left + 25, y + 28 + i * 12, loreLines[i], LORE_TEXT_COLOR);
    }
  }

  _renderItem(item, y, left, rightX) {
    const nameColor = this._matchesSearch(item.name) ? '#66ff66' : '#e0e0e0';
    this._text(left + 25, y, item.name, nameColor);
    this._text(rightX, y, `${item.type || ''}  ${item.price || 0}g`, '#888888', 1);

    let desc = '';
    if (item.combatEffects) {
      const ce = item.combatEffects;
      const parts = [];
      if (ce.critBonus) parts.push(`Crit+${ce.critBonus}`);
      if (ce.atkBonus) parts.push(`Atk+${ce.atkBonus}`);
      if (ce.defBonus) parts.push(`Def+${ce.defBonus}`);
      if (ce.avoidBonus) parts.push(`Avo+${ce.avoidBonus}`);
      if (ce.preventEnemyDouble || ce.preventDouble) parts.push('Prevent Double');
      const dblThresholdReduction = ce.doubleThresholdReduction ?? ce.reduceDoubleThreshold;
      if (dblThresholdReduction) parts.push(`Dbl Thres -${dblThresholdReduction}`);
      if (ce.negateEffectiveness) parts.push('Negate Effectiveness');
      if (ce.condition) parts.push(`(${ce.condition})`);
      desc = parts.join(', ');
    } else if (item.effects && typeof item.effects === 'object') {
      desc = Object.entries(item.effects)
        .map(([k, v]) => `${k}+${v}`)
        .join(', ');
    } else if (item.effect) {
      const effectText = getConsumableDescription(item);
      const usesText = formatUses(item);
      if (effectText) desc = usesText ? `${effectText} (${usesText})` : effectText;
      else desc = item.effect || '';
    } else if (item.forgeStat) {
      desc = `Forge: ${item.forgeStat}`;
    } else if (item.imbueId) {
      desc = `Imbue: ${item.description || 'weapon blessing'}`;
    }
    this._text(left + 25, y + 14, desc, '#aaaaaa');
    this._renderLoreLine(item, y + 28, left);
  }

  /** Third row line on lore-bearing tabs: quoted, ellipsized to one line. */
  _renderLoreLine(item, y, left) {
    if (!item.lore) return;
    this._text(left + 25, y, this._ellipsize(`"${item.lore}"`, 84), LORE_TEXT_COLOR);
  }

  _ellipsize(text, maxChars) {
    const value = String(text || '');
    return value.length <= maxChars ? value : `${value.slice(0, maxChars - 1)}…`;
  }

  /**
   * Greedy word-wrap for lore text, char-budget based so it is testable without
   * Phaser text measurement. Overflow past maxLines ellipsizes the last line.
   */
  _wrapLore(text, maxChars, maxLines) {
    const value = String(text || '').trim();
    if (!value) return [];
    const words = value.split(/\s+/);
    const lines = [];
    let line = '';
    for (const word of words) {
      if (line.length === 0) {
        line = word;
      } else if (line.length + word.length + 1 > maxChars) {
        lines.push(line);
        line = word;
      } else {
        line = `${line} ${word}`;
      }
    }
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      // Appending the marker first guarantees the cut is visible even when the
      // kept line already sits exactly at the char budget.
      kept[maxLines - 1] = this._ellipsize(`${kept[maxLines - 1]} …`, maxChars);
      return kept;
    }
    return lines;
  }

  _renderLord(item, y, left, rightX) {
    const nameColor = this._matchesSearch(item.name) ? '#66ff66' : '#e0e0e0';
    this._text(left + 25, y, item.name, nameColor);
    this._text(rightX, y, `${item.class || ''} \u2192 ${item.promotedClass || ''}`, '#888888', 1);

    const bs = item.baseStats || {};
    const statLine = `HP:${bs.HP ?? '-'} STR:${bs.STR ?? '-'} MAG:${bs.MAG ?? '-'} SKL:${bs.SKL ?? '-'} SPD:${bs.SPD ?? '-'} DEF:${bs.DEF ?? '-'} RES:${bs.RES ?? '-'} LCK:${bs.LCK ?? '-'} MOV:${bs.MOV ?? '-'}`;
    this._text(left + 25, y + 14, statLine, '#aaaaaa');

    const weapon = item.weapon || item.promotionWeapons || '';
    this._text(
      left + 25,
      y + 28,
      `Skill: ${item.personalSkill || '-'}  Weapon: ${weapon}`,
      '#aaaaaa',
    );
  }

  _renderBlessing(item, y, left, rightX) {
    const nameColor = this._matchesSearch(item.name) ? '#66ff66' : '#e0e0e0';
    this._text(left + 25, y, item.name, nameColor);
    this._text(rightX, y, `Tier ${item.tier || '?'}`, '#888888', 1);
    this._text(left + 25, y + 14, item.description || '', '#aaaaaa');
    this._renderLoreLine(item, y + 28, left);
  }

  _renderTerrain(item, y, left, rightX) {
    const nameColor = this._matchesSearch(item.name) ? '#66ff66' : '#e0e0e0';
    this._text(left + 25, y, item.name, nameColor);
    this._text(rightX, y, `Avo:${item.avoidBonus ?? 0}  Def:${item.defBonus ?? 0}`, '#888888', 1);

    const mc = item.moveCost || {};
    const special = item.special ? `  ${item.special}` : '';
    this._text(
      left + 25,
      y + 14,
      `Move \u2014 Inf:${mc.Infantry ?? '-'} Arm:${mc.Armored ?? '-'} Cav:${mc.Cavalry ?? '-'} Fly:${mc.Flying ?? '-'}${special}`,
      '#aaaaaa',
    );
  }

  _renderAffix(item, y, left, rightX) {
    const nameColor = this._matchesSearch(item.name) ? '#66ff66' : '#e0e0e0';
    this._text(left + 25, y, item.name, nameColor);
    this._text(rightX, y, `Tier ${item.tier || '?'}  ${item.trigger || ''}`, '#888888', 1);
    this._text(left + 25, y + 14, item.description || '', '#aaaaaa');
  }

  _renderFoe(item, y, left, rightX) {
    const isBoss = item._kind === 'boss';
    const nameColor = this._matchesSearch(item.name) ? '#66ff66' : isBoss ? '#ff8866' : '#e0e0e0';
    this._text(left + 25, y, item.name, nameColor);

    let meta;
    if (isBoss) {
      // finalBoss entries are difficulty-gated variants — tag which mode meets them.
      const modeTag = Array.isArray(item.difficultyFilter)
        ? `  [${item.difficultyFilter.join('/')}]`
        : '';
      meta = `${item._actLabel || ''}  ${item.className || ''}  Lv${item.level ?? '?'}${modeTag}`;
    } else {
      meta = `Class  ${item.tier || ''}  ${item.moveType || ''}`;
    }
    this._text(rightX, y, meta, '#888888', 1);

    const loreLines = this._wrapLore(item.lore, 84, isBoss ? 3 : 2);
    for (let i = 0; i < loreLines.length; i++) {
      this._text(left + 25, y + 14 + i * 12, loreLines[i], LORE_TEXT_COLOR);
    }
  }

  /** Helper: create a text object, optionally right-aligned (originX=1). */
  _text(x, y, str, color = '#e0e0e0', originX = 0) {
    const t = this.scene.add
      .text(x, y, str, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color,
      })
      .setDepth(DEPTH_UI);
    if (originX) t.setOrigin(originX, 0);
    this.objects.push(t);
    return t;
  }

  _drawPageNav(left, top, panelW, panelH, totalPages) {
    const cx = this.scene.cameras.main.centerX;
    const navY = top + panelH - 28;

    // Page indicator
    const pageInd = this.scene.add
      .text(cx, navY, `Page ${this.currentPage + 1}/${totalPages}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#888888',
      })
      .setOrigin(0.5)
      .setDepth(DEPTH_UI);
    this.objects.push(pageInd);

    if (this.currentPage > 0) {
      const prevBtn = this.scene.add
        .text(cx - 80, navY, '\u25C0 Prev', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#aaaaaa',
          backgroundColor: '#333333',
          padding: { x: 8, y: 3 },
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

    if (this.currentPage < totalPages - 1) {
      const nextBtn = this.scene.add
        .text(cx + 80, navY, 'Next \u25B6', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#aaaaaa',
          backgroundColor: '#333333',
          padding: { x: 8, y: 3 },
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

  hide() {
    this._teardownFocus();
    const game = this.scene?.game;
    if (game?.events) {
      if (this._mobilePrev) game.events.off('mobile:prevTab', this._mobilePrev);
      if (this._mobileNext) game.events.off('mobile:nextTab', this._mobileNext);
      this._mobilePrev = null;
      this._mobileNext = null;
      if (this._mobileContextPushed) {
        this._mobileContextPushed = false;
        game.events.emit('mobile:popContext', { token: this._mobileContextToken });
        this._mobileContextToken = null;
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
    removeOverlay(this.scene, this._overlayToken);
    this._overlayToken = null;
    const wasVisible = this.visible;
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
    if (wasVisible && this.onClose) this.onClose();
  }
}

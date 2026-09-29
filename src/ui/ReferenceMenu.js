import { appendDetailScrollControls } from './DetailScrollControls.js';
import { InputAction } from '../utils/InputActions.js';
import { MenuSurface, element, button } from './MenuSurface.js';
import { itemKeywordRow, itemKeywordText } from './itemKeywordChips.js';
import { itemBaseLine, isCombatWeapon } from '../engine/ItemKeywords.js';
import { itemHero, itemIcon } from './itemIcons.js';
import { portraitListLayout, watchPortraitListLayout } from './portraitListLayout.js';
import { trackScrollEdges } from './scrollEdgeCue.js';

// A shared readable list/detail browser. Providers retain filtering/unlock rules.
//
// Upright phones (portrait mode, portraitListLayout()) show it as master -> detail:
// the list fills the screen, tapping an entry opens its text full-width with a Back
// button, and Back / Escape / cancel return to the list where it was. Categories and
// filters are one-row strips that scroll sideways (their hidden edge fades), so the
// list keeps most of the screen; a menu with one category shows no strip, and a
// category holding a single entry opens that entry in place. Elsewhere the list and
// detail sit side by side as before; `view` is then always 'list'.
export class ReferenceMenu {
  constructor(scene, title, tabs, provider, onClose, { searchAllTabs = false } = {}) {
    Object.assign(this, { tabs, provider, searchAllTabs });
    this.tab = 0;
    this.filter = 0;
    this.selected = 0;
    this.query = '';
    this.view = 'list';
    this.listScrollMemo = 0;
    this.surface = new MenuSurface(scene, title, onClose);
    this.surface.root.classList.add('re-reference');
    this.edgeTrackers = [];
    const unwatch = watchPortraitListLayout(() => {
      if (this.surface.destroyed) return;
      const detail = this.view === 'detail';
      this.view = 'list';
      this.render();
      if (detail) this.focusSelectedEntry();
    });
    const destroySurface = this.surface.destroy.bind(this.surface);
    this.surface.destroy = () => {
      unwatch();
      for (const tracker of this.edgeTrackers.splice(0)) tracker.destroy();
      destroySurface();
    };
    const search = element('label', null, 're-search');
    this.input = element('input');
    this.input.type = 'search';
    this.input.placeholder = searchAllTabs ? 'Search all help' : 'Search this category';
    this.input.setAttribute('aria-label', `Search ${title.toLowerCase()}`);
    this.input.addEventListener('input', () => {
      this.setQuery(this.input.value);
    });
    search.append(this.input);
    this.surface.header.insertBefore(search, this.surface.header.lastChild);
    this.surface.onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return false;
      if (event.key === 'Escape' && this.view === 'detail') {
        this.showList();
        return true;
      }
      if (event.key === '/' && event.target !== this.input) {
        this.input.focus();
        return true;
      }
      return false;
    };
    this.surface.onAction = (action) => {
      if ([InputAction.CANCEL, InputAction.PAUSE].includes(action) && this.view === 'detail') {
        this.showList();
        return true;
      }
      if ([InputAction.PREV_UNIT, InputAction.NEXT_UNIT].includes(action)) {
        this.changeTab(action === InputAction.PREV_UNIT ? -1 : 1);
        return true;
      }
      return false;
    };
    this.render();
    this.surface.focusContent();
  }
  setQuery(query) {
    const searching = !!query.trim();
    if (searching && !this.query.trim())
      this.searchContext = {
        tab: this.tab,
        filter: this.filter,
        selected: this.selected,
        listScroll: this.list?.scrollTop || 0,
        detailScroll: this.detail?.scrollTop || 0,
      };
    this.query = query;
    this.input.value = query;
    this.selected = 0;
    // Results are a list: a search typed over an open entry shows them.
    this.view = 'list';
    const restore = !searching && this.searchContext;
    if (restore) {
      Object.assign(this, { tab: restore.tab, filter: restore.filter, selected: restore.selected });
      this.searchContext = null;
    }
    this.render();
    if (restore) {
      this.list.scrollTop = restore.listScroll;
      this.detail.scrollTop = restore.detailScroll;
    }
  }
  selectTab(index) {
    this.query = '';
    this.input.value = '';
    this.searchContext = null;
    this.tab = index;
    this.filter = 0;
    this.selected = 0;
    this.view = 'list';
    this.render();
    this.surface.body.querySelector(`[data-focus="tab-${this.tab}"]`)?.focus();
  }
  /** Portrait: open entry `i` full-width, remembering where the list was. */
  openEntry(i) {
    this.listScrollMemo = this.list?.scrollTop || 0;
    this.selected = i;
    this.view = 'detail';
    this.render();
    this.surface.body.querySelector('[data-focus="detail-back"]')?.focus({ preventScroll: true });
  }
  /** Portrait: back from an entry to the list, at the entry that was open. */
  showList() {
    this.view = 'list';
    this.render();
    this.list.scrollTop = this.listScrollMemo;
    this.focusSelectedEntry();
  }
  focusSelectedEntry() {
    const entry = this.list?.querySelector(`[data-focus="entry-${this.selected}"]`);
    entry?.focus({ preventScroll: true });
    entry?.scrollIntoView?.({ block: 'nearest' });
  }
  changeTab(delta) {
    this.selectTab((this.tab + delta + this.tabs.length) % this.tabs.length);
  }
  moveEntry(delta) {
    this.selected = Math.max(0, Math.min(this.selected + delta, (this.entryCount || 1) - 1));
    this.render();
    this.list.querySelector(`[data-focus="entry-${this.selected}"]`)?.focus();
  }
  highlight(el) {
    const query = this.query.trim();
    if (!query) return;
    const text = el.textContent,
      lower = text.toLowerCase();
    el.replaceChildren();
    let start = 0,
      pos;
    while ((pos = lower.indexOf(query.toLowerCase(), start)) !== -1) {
      el.append(
        document.createTextNode(text.slice(start, pos)),
        element('mark', text.slice(pos, pos + query.length)),
      );
      start = pos + query.length;
    }
    el.append(document.createTextNode(text.slice(start)));
  }
  render() {
    const oldFocus = this.surface.body.contains(document.activeElement)
      ? document.activeElement.dataset.focus
      : null;
    const previousScroll = this.list?.scrollTop || 0;
    const body = this.surface.body;
    for (const tracker of this.edgeTrackers.splice(0)) tracker.destroy();
    body.replaceChildren();
    const portrait = portraitListLayout();
    if (!portrait) this.view = 'list';
    if (portrait) this.surface.root.dataset.refView = this.view;
    else delete this.surface.root.dataset.refView;
    // Upright, the list and an open entry each get the whole screen; controls for the
    // other view are left out rather than hidden, so focus never lands on them.
    const showList = !portrait || this.view === 'list';
    const showDetail = !portrait || this.view === 'detail';
    const tabs = element('nav', null, 're-tabs');
    tabs.setAttribute('aria-label', 'Categories');
    this.tabs.forEach((tab, i) => {
      const b = button(tab.label, () => {
        this.selectTab(i);
      });
      b.dataset.focus = `tab-${i}`;
      b.setAttribute('aria-pressed', String(i === this.tab));
      tabs.append(b);
    });
    // Upright, a menu with a single category (How to play) needs no category strip.
    if (showList && !(portrait && this.tabs.length === 1)) body.append(tabs);
    const filters = this.tabs[this.tab].filters || [];
    let filterRow = null;
    if (filters.length && showList) {
      const row = element('nav', null, 're-tabs re-filter-tabs');
      filterRow = row;
      row.setAttribute('aria-label', 'Filters');
      filters.forEach((label, i) => {
        const b = button(label, () => {
          this.filter = i;
          this.selected = 0;
          this.render();
        });
        b.dataset.focus = `filter-${i}`;
        b.setAttribute('aria-pressed', String(i === this.filter));
        row.append(b);
      });
      body.append(row);
    }
    const query = this.query.trim().toLowerCase();
    const candidates =
      query && this.searchAllTabs
        ? this.tabs.flatMap((tab, index) =>
            this.provider(index, 0).map((entry) => ({
              ...entry,
              summary: [tab.label, entry.summary].filter(Boolean).join(' · '),
            })),
          )
        : this.provider(this.tab, this.filter);
    const entries = candidates.filter(
      (entry) =>
        !query ||
        `${entry.name} ${entry.summary || ''} ${entry.lines.join(' ')} ${(entry.tags || []).join(' ')}`
          .toLowerCase()
          .includes(query),
    );
    this.entryCount = entries.length;
    this.selected = Math.min(this.selected, Math.max(0, entries.length - 1));
    // Upright, a category with one entry (several Help pages) opens it in place: a
    // one-row list would only cost a tap. Search results always stay a list.
    const direct = portrait && showList && !query && entries.length === 1;
    const split = element('div', null, 're-split');
    this.list = element('div', null, 're-scroll re-menu');
    this.list.setAttribute('aria-label', 'Entries');
    const detail = element('article', null, 're-scroll re-card re-reference-detail');
    this.detail = detail;
    entries.forEach((entry, i) => {
      const b = button(
        null,
        () => {
          if (portraitListLayout()) {
            this.openEntry(i);
            return;
          }
          this.selected = i;
          this.render();
        },
        entry.art ? 're-btn re-row re-row--item' : 're-btn re-row',
      );
      b.dataset.focus = `entry-${i}`;
      b.setAttribute('aria-pressed', String(i === this.selected));
      if (entry.art) b.append(itemIcon(entry.art.subject, { size: 32, kind: entry.art.kind }));
      b.append(element('strong', entry.name));
      if (entry.summary) b.append(element('small', entry.summary));
      this.list.append(b);
    });
    const selected = entries[this.selected];
    if (selected) {
      // Items and blessings lead with their picture, as in the shop; the text wraps beside it.
      if (selected.art)
        detail.append(
          itemHero(selected.art.subject, {
            size: 96,
            kind: selected.art.kind,
            className: 're-reference-art',
          }),
        );
      detail.append(element('h3', selected.name));
      const keys = selected.item ? itemKeywordRow(selected.item) : null;
      if (keys) detail.append(keys);
      // Upright, the full-width detail reads as paragraphs, not the canvas-era
      // 40-character line breaks (landscape keeps the lines as authored).
      const lines = portrait ? reflowLines(selected.lines) : selected.lines;
      for (const line of lines) detail.append(element('p', line));
    } else
      detail.append(
        element(
          'p',
          query
            ? this.searchAllTabs
              ? 'No matching help entries.'
              : 'No matching entries in this category.'
            : 'Nothing unlocked here yet.',
          're-empty',
        ),
      );
    for (const el of [
      ...this.list.querySelectorAll('strong,small'),
      ...detail.querySelectorAll('h3,p'),
    ])
      this.highlight(el);
    if (portrait && showDetail) {
      // Upright: the open entry leads with Back to the list.
      const back = button('‹ Back', () => this.showList(), 're-btn re-reference-back');
      back.dataset.focus = 'detail-back';
      back.setAttribute('aria-label', 'Back to list');
      split.append(back);
    }
    if (showList && !direct) split.append(this.list);
    if (showDetail || direct) split.append(detail);
    if (direct) this.surface.root.dataset.refView = 'entry';
    body.append(split);
    if (showDetail || direct) {
      const footer = element('footer', null, 're-footer');
      appendDetailScrollControls(footer, detail);
      body.append(footer);
    }
    this.list.scrollTop = previousScroll;
    if (showList) {
      for (const strip of [tabs, filterRow]) revealInStrip(strip);
    }
    if (portrait)
      for (const box of [tabs, filterRow, this.list, detail])
        if (box?.isConnected) this.edgeTrackers.push(trackScrollEdges(box));
    if (oldFocus) body.querySelector(`[data-focus="${oldFocus}"]`)?.focus({ preventScroll: true });
  }
  destroy() {
    this.surface.destroy();
  }
}

/**
 * Scroll a sideways strip so its chosen tab sits wholly inside it, clear of the strip's
 * scroll padding (the faded edge). Rounds outwards: a fractional shortfall would leave
 * the tab clipped by part of a pixel.
 */
function revealInStrip(strip) {
  const chosen = strip?.querySelector('[aria-pressed="true"]');
  if (!chosen) return;
  const box = strip.getBoundingClientRect();
  const tab = chosen.getBoundingClientRect();
  const pad = parseFloat(getComputedStyle(strip).scrollPaddingInlineStart) || 0;
  if (tab.left < box.left + pad) strip.scrollLeft -= Math.ceil(box.left + pad - tab.left);
  else if (tab.right > box.right - pad) strip.scrollLeft += Math.ceil(tab.right - box.right + pad);
}

/**
 * Rejoin text that was hard-wrapped for the old canvas panel: a line continues the one
 * before it when that one does not end a sentence or introduce a list (. ! ? :) and
 * this one starts mid-sentence (lowercase or an opening parenthesis) without the
 * indent that marks a list item. Blank lines, indented rows and new sentences stay
 * their own lines.
 */
export function reflowLines(lines) {
  const out = [];
  for (const raw of lines) {
    const line = String(raw ?? '');
    const prev = out.length ? out[out.length - 1] : '';
    if (prev.trim() && /^[a-z(]/.test(line) && !/[.!?:]\s*$/.test(prev))
      out[out.length - 1] = `${prev.replace(/\s+$/, '')} ${line}`;
    else out.push(line);
  }
  return out;
}

// Reuse existing compendium formatting without building hidden Phaser text.
// The receiver inherits the formatter methods and data, and owns only _text.
// Tabs whose entries are things the game draws as items (their icon and picture).
const ART_TABS = { weapons: 'item', items: 'item', blessings: 'blessing' };

export function compendiumEntries(controller, tab, filter, tabKey = null) {
  const artKind = ART_TABS[tabKey] || null;
  const view = Object.create(controller);
  view.activeTabIndex = tab;
  view.activeFilterIndex = filter;
  return view._getFilteredItems().map((item) => {
    const art = artKind ? { subject: item, kind: artKind } : null;
    if (item.referenceLines)
      return { name: item.name, summary: item.type, lines: item.referenceLines, art };
    const lines = [];
    view._text = (_x, _y, text) => {
      if (text != null && text !== '') lines.push(String(text));
    };
    view._renderLoreLine = (entry) => {
      if (entry.lore) lines.push(entry.lore);
    };
    view._wrapLore = (text) => (text ? [text] : []);
    view._renderItems([item], 0, 0, 560);
    if ((controller.gameData.lords || []).includes(item)) {
      for (const trait of controller.gameData.traits || []) {
        if (trait.lordName === item.name && trait.rarity === 'legendary')
          lines.push(
            `Legendary trait: ${trait.name}`,
            trait.description,
            '5% chance on a new lord; Valor upgrades raise this to 10% / 15%. Replaces the ordinary trait.',
          );
      }
    }
    // Weapons list as what they are and their rules ("Silver Sword · Crit 30");
    // a stat booster lists the stat it raises ("Consumable · +2 STR").
    const summary = isCombatWeapon(item)
      ? [itemBaseLine(item), itemKeywordText(item)].filter(Boolean).join(' · ')
      : [item.type, item.tier, item.className, itemKeywordText(item)].filter(Boolean).join(' · ');
    return {
      name: item.name || 'Unknown',
      item,
      summary,
      lines: lines.filter((line) => line !== item.name),
      art,
    };
  });
}

import { appendDetailScrollControls } from './DetailScrollControls.js';
import { InputAction } from '../utils/InputActions.js';
import { MenuSurface, element, button } from './MenuSurface.js';

// A shared readable list/detail browser. Providers retain filtering/unlock rules.
export class ReferenceMenu {
  constructor(scene, title, tabs, provider, onClose, { searchAllTabs = false } = {}) {
    Object.assign(this, { tabs, provider, searchAllTabs });
    this.tab = 0;
    this.filter = 0;
    this.selected = 0;
    this.query = '';
    this.surface = new MenuSurface(scene, title, onClose);
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
      if (event.target !== this.input) {
        if (['ArrowUp', 'ArrowDown'].includes(event.key)) {
          this.moveEntry(event.key === 'ArrowUp' ? -1 : 1);
          return true;
        }
        if (['ArrowLeft', 'ArrowRight'].includes(event.key)) {
          this.changeTab(event.key === 'ArrowLeft' ? -1 : 1);
          return true;
        }
      }
      if (event.key === '/' && event.target !== this.input) {
        this.input.focus();
        return true;
      }
      return false;
    };
    this.surface.onAction = (action, payload) => {
      if (action === InputAction.NAVIGATE) {
        if (payload?.dy) this.moveEntry(Math.sign(payload.dy));
        else if (payload?.dx) this.changeTab(Math.sign(payload.dx));
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
    this.render();
    this.surface.body.querySelector(`[data-focus="tab-${this.tab}"]`)?.focus();
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
    body.replaceChildren();
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
    body.append(tabs);
    const filters = this.tabs[this.tab].filters || [];
    if (filters.length) {
      const row = element('nav', null, 're-tabs re-filter-tabs');
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
    const split = element('div', null, 're-split');
    this.list = element('div', null, 're-scroll re-menu');
    this.list.setAttribute('aria-label', 'Entries');
    const detail = element('article', null, 're-scroll re-card re-reference-detail');
    this.detail = detail;
    entries.forEach((entry, i) => {
      const b = button(
        null,
        () => {
          this.selected = i;
          this.render();
        },
        're-btn re-row',
      );
      b.dataset.focus = `entry-${i}`;
      b.setAttribute('aria-pressed', String(i === this.selected));
      b.append(element('strong', entry.name));
      if (entry.summary) b.append(element('small', entry.summary));
      this.list.append(b);
    });
    const selected = entries[this.selected];
    if (selected) {
      detail.append(element('h3', selected.name));
      for (const line of selected.lines) detail.append(element('p', line));
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
    split.append(this.list, detail);
    const footer = element('footer', null, 're-footer');
    appendDetailScrollControls(footer, detail);
    body.append(split, footer);
    this.list.scrollTop = previousScroll;
    tabs
      .querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    if (oldFocus) body.querySelector(`[data-focus="${oldFocus}"]`)?.focus({ preventScroll: true });
  }
  destroy() {
    this.surface.destroy();
  }
}

// Reuse existing compendium formatting without building hidden Phaser text.
// The receiver inherits the formatter methods and data, and owns only _text.
export function compendiumEntries(controller, tab, filter) {
  const view = Object.create(controller);
  view.activeTabIndex = tab;
  view.activeFilterIndex = filter;
  return view._getFilteredItems().map((item) => {
    if (item.referenceLines)
      return { name: item.name, summary: item.type, lines: item.referenceLines };
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
    return {
      name: item.name || 'Unknown',
      summary: [item.type, item.tier, item.className].filter(Boolean).join(' · '),
      lines: lines.filter((line) => line !== item.name),
    };
  });
}

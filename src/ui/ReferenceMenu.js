import { MenuSurface, element, button } from './MenuSurface.js';

// A shared readable list/detail browser. Providers retain filtering/unlock rules.
export class ReferenceMenu {
  constructor(scene, title, tabs, provider, onClose) {
    Object.assign(this, { tabs, provider });
    this.tab = 0;
    this.filter = 0;
    this.selected = 0;
    this.query = '';
    this.surface = new MenuSurface(scene, title, onClose);
    const search = element('label', null, 're-search');
    this.input = element('input');
    this.input.type = 'search';
    this.input.placeholder = 'Search';
    this.input.setAttribute('aria-label', `Search ${title.toLowerCase()}`);
    this.input.addEventListener('input', () => {
      this.query = this.input.value;
      this.selected = 0;
      this.render();
    });
    search.append(this.input);
    this.surface.header.insertBefore(search, this.surface.header.lastChild);
    this.render();
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
        this.tab = i;
        this.filter = 0;
        this.selected = 0;
        this.render();
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
    const entries = this.provider(this.tab, this.filter).filter(
      (entry) => !query || `${entry.name} ${entry.lines.join(' ')}`.toLowerCase().includes(query),
    );
    this.selected = Math.min(this.selected, Math.max(0, entries.length - 1));
    const split = element('div', null, 're-split');
    this.list = element('div', null, 're-scroll re-menu');
    this.list.setAttribute('aria-label', 'Entries');
    const detail = element('article', null, 're-scroll re-card re-reference-detail');
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
          query ? 'No matching entries in this category.' : 'Nothing unlocked here yet.',
          're-empty',
        ),
      );
    split.append(this.list, detail);
    body.append(split);
    this.list.scrollTop = previousScroll;
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
    const lines = [];
    view._text = (_x, _y, text) => {
      if (text != null && text !== '') lines.push(String(text));
    };
    view._renderLoreLine = (entry) => {
      if (entry.lore) lines.push(entry.lore);
    };
    view._wrapLore = (text) => (text ? [text] : []);
    view._renderItems([item], 0, 0, 560);
    return {
      name: item.name || 'Unknown',
      summary: [item.type, item.tier, item.className].filter(Boolean).join(' · '),
      lines: lines.filter((line) => line !== item.name),
    };
  });
}

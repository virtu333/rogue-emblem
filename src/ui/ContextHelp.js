import { MenuSurface, element, button } from './MenuSurface.js';
import './contextHelp.css';

/**
 * Help content is a list of blocks, read top to bottom:
 *   'text'                                   a plain paragraph
 *   { lead: 'text' }                         the one-line answer, shown first and larger
 *   { stats: [{ label, value, note?, text? }] }  number tiles (value large, label under
 *                                            it; `text` sets a word value in body type)
 *   { title?: 'text', points: [...] }        a bulleted section; a point is 'text' or
 *                                            { term, text } (term shown as a keyword)
 *   { tip: 'text' }                          a footnote (where to look next)
 */
export function helpBlockText(block) {
  if (block == null) return '';
  if (typeof block === 'string') return block;
  if (block.lead) return block.lead;
  if (block.tip) return block.tip;
  if (block.stats) return block.stats.map((s) => `${s.label} ${s.value}`).join(' · ');
  const points = (block.points || []).map((p) =>
    typeof p === 'string' ? p : `${p.term}: ${p.text}`,
  );
  return [block.title, ...points].filter(Boolean).join(' ');
}

/** The first line of help content, for hover previews and the like. */
export function helpPreview(blocks) {
  return helpBlockText((blocks || []).find((b) => helpBlockText(b)));
}

function renderBlock(block) {
  if (typeof block === 'string') return element('p', block, 'ch-text');
  if (block.lead) return element('p', block.lead, 'ch-lead');
  if (block.tip) {
    const tip = element('p', null, 'ch-tip');
    tip.append(element('span', '›', 'ch-tip-mark'), document.createTextNode(block.tip));
    return tip;
  }
  if (block.stats) {
    const grid = element('dl', null, 'ch-stats');
    for (const stat of block.stats) {
      const tile = element('div', null, 'ch-stat');
      tile.append(
        element(
          'dd',
          String(stat.value),
          `ch-stat-value${stat.text ? ' ch-stat-value--text' : ''}`,
        ),
      );
      tile.append(element('dt', stat.label, 'ch-stat-label'));
      if (stat.note) tile.append(element('dd', stat.note, 'ch-stat-note'));
      grid.append(tile);
    }
    return grid;
  }
  const section = element('section', null, 'ch-section');
  if (block.title) section.append(element('h3', block.title, 'ch-heading'));
  const list = element('ul', null, 'ch-points');
  for (const point of block.points || []) {
    const item = element('li');
    if (typeof point === 'string') item.textContent = point;
    else item.append(element('b', point.term), document.createTextNode(` ${point.text}`));
    list.append(item);
  }
  section.append(list);
  return section;
}

// A child surface owns input without rebuilding or losing its parent's position.
export class ContextHelp {
  constructor(scene, parent, title, blocks, onClose) {
    this.parent = parent;
    this.wasInert = parent.inert;
    this.wasHidden = parent.getAttribute('aria-hidden');
    parent.inert = true;
    parent.setAttribute('aria-hidden', 'true');
    this.surface = new MenuSurface(
      scene,
      title,
      () => {
        this.destroy();
        onClose?.();
      },
      { modal: true },
    );
    this.surface.root.classList.add('re-help');
    this.surface.body.classList.add('re-scroll');
    for (const block of blocks || []) {
      if (!helpBlockText(block)) continue;
      const node = renderBlock(block);
      node.style.flexShrink = '0';
      this.surface.body.append(node);
    }
    // Scroll buttons serve keyboard/controller readers. They sit in the header
    // beside Close and only appear when the text is taller than the dialog.
    this.controls = element('div', null, 'ch-scroll');
    for (const [label, glyph, direction] of [
      ['Read above', '▲', -1],
      ['Read below', '▼', 1],
    ]) {
      const scroll = button(glyph, () => this.surface.body.scrollBy({ top: direction * 100 }));
      scroll.setAttribute('aria-label', label);
      scroll.title = label;
      this.controls.append(scroll);
    }
    const close = this.surface.header.querySelector('button');
    this.surface.header.insertBefore(this.controls, close);
    this.syncControls = () => {
      if (this.destroyed) return;
      const body = this.surface.body;
      this.controls.hidden = body.scrollHeight <= body.clientHeight + 1;
    };
    this.syncControls();
    if (typeof ResizeObserver === 'function') {
      this.resizeObserver = new ResizeObserver(this.syncControls);
      this.resizeObserver.observe(this.surface.body);
    }
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.resizeObserver?.disconnect();
    this.parent.inert = this.wasInert;
    if (this.wasHidden == null) this.parent.removeAttribute('aria-hidden');
    else this.parent.setAttribute('aria-hidden', this.wasHidden);
    this.surface.destroy();
  }
}

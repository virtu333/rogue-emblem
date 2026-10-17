import { MenuSurface, element, button } from './MenuSurface.js';
import { cycleOmen, omenRows, omensSummary } from './omensModel.js';
import './omens.css';

/**
 * The Omens picker (difficulty screen): a child surface over the menu, one row per Omen. A press
 * on a row raises its rank (Off, 1 .. max, Off); Clear turns every Omen off. Esc, Back and the
 * header's Close all close it first (MenuSurface's overlay and input scope), returning to the
 * difficulty menu with the choice kept. The scene owns the choice (`getRanks` / `onChange`).
 */
export class OmensPicker {
  constructor(scene, parent, { gameData, best, getRanks, onChange, onClose }) {
    Object.assign(this, { gameData, best, getRanks, onChange, parent });
    this.wasInert = parent.inert;
    this.wasHidden = parent.getAttribute('aria-hidden');
    parent.inert = true;
    parent.setAttribute('aria-hidden', 'true');
    this.surface = new MenuSurface(
      scene,
      'Knots',
      () => {
        this.destroy();
        onClose?.();
      },
      { modal: true },
    );
    this.surface.root.classList.add('re-help', 'om-picker');
    this.surface.header.lastChild.textContent = 'Back';
    this.render();
  }
  render(focusId = null) {
    const ranks = this.getRanks();
    const summary = element('p', omensSummary(this.gameData, ranks, this.best), 'om-summary');
    const list = element('ul', null, 'om-list re-scroll');
    for (const row of omenRows(this.gameData, ranks)) {
      const item = element('li');
      const press = button(null, () => this.cycle(row.id), 'om-row re-btn');
      press.dataset.focus = `omen-${row.id}`;
      press.dataset.rank = String(row.rank);
      press.setAttribute('aria-pressed', String(row.rank > 0));
      press.setAttribute(
        'aria-label',
        `${row.name}, ${row.rankLabel}${row.heat ? `, Heat ${row.heat}` : ''}. ${row.text}`,
      );
      const head = element('span', null, 'om-head');
      head.append(
        element('strong', row.name, 'om-name'),
        element('span', row.rankLabel, 'om-rank'),
        element('span', row.heat ? `Heat ${row.heat}` : '', 'om-heat'),
      );
      press.append(head, element('span', row.text, 'om-text'));
      item.append(press);
      list.append(item);
    }
    const foot = element('div', null, 'om-foot');
    const clear = button('Clear', () => this.clear());
    clear.dataset.focus = 'omens-clear';
    const done = button('Done', () => this.surface.onClose(), 're-btn re-btn--primary');
    done.dataset.focus = 'omens-done';
    foot.append(clear, done);
    this.surface.body.replaceChildren(summary, list, foot);
    if (focusId)
      this.surface.body.querySelector(`[data-focus="${focusId}"]`)?.focus({ preventScroll: true });
  }
  cycle(id) {
    this.onChange(cycleOmen(this.gameData, this.getRanks(), id));
    this.render(`omen-${id}`);
  }
  clear() {
    this.onChange({});
    this.render('omens-clear');
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.parent.inert = this.wasInert;
    if (this.wasHidden == null) this.parent.removeAttribute('aria-hidden');
    else this.parent.setAttribute('aria-hidden', this.wasHidden);
    this.surface.destroy();
  }
}

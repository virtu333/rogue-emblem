// The placement controls: what to do, who is still waiting, Auto-place / Clear and
// Start. The phone rail renders them inside the battle HUD; desktop gets a dock.
import { unitPortrait } from './unitPortrait.js';
import { formationUnitLine } from './FormationPicker.js';
import { DOM_INPUT_EVENTS } from '../utils/domUI.js';
import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = String(text);
  return node;
}

/**
 * Fill `container` with the placement controls. `makeButton(label, action, cls)`
 * lets the host supply its own press handling (the rail's cancelable press).
 */
export function renderFormationPanel(container, formation, makeButton, { withStart = true } = {}) {
  const s = formation.scene;
  const n = formation.units.length;
  const placed = formation.placed();
  const held = formation.heldUnit;
  container.append(
    el(
      'p',
      'fm-lead',
      held
        ? `Tap a blue tile for ${held.name}.`
        : placed < n
          ? 'Tap a blue tile to choose who stands there.'
          : 'Everyone is in place. Tap a tile to swap.',
    ),
  );
  const count = el('p', 'fm-count', `${placed} / ${n} placed`);
  count.setAttribute('role', 'status');
  container.append(count);
  if (formation.notice) container.append(el('p', 'fm-notice', formation.notice));

  const bench = formation.benched();
  const tools = el('div', 'fm-tools');
  if (bench.length) tools.append(makeButton('Auto-place', () => formation.autoPlace(), 'fm-auto'));
  if (placed > 0) tools.append(makeButton('Clear', () => formation.clearAll(), 'fm-clearall'));
  if (tools.childElementCount) container.append(tools);
  if (bench.length) {
    const list = el('div', 'fm-bench');
    list.setAttribute('aria-label', 'Waiting to be placed');
    for (const unit of bench) {
      const chip = makeButton('', () => formation.holdUnit(unit), 'fm-chip');
      chip.setAttribute('aria-pressed', String(held === unit));
      chip.setAttribute('aria-label', `${unit.name}, ${formationUnitLine(unit)}`);
      const face = unitPortrait(s, s.gameData, unit, 'mr-unit-face');
      if (face) chip.append(face);
      const text = el('span', 'fm-chip-text');
      text.append(el('strong', '', unit.name), el('small', '', unit.className || ''));
      chip.append(text);
      list.append(chip);
    }
    container.append(list);
  }

  if (withStart) container.append(startButton(formation, makeButton));
}

export function startButton(formation, makeButton) {
  const ready = formation.complete();
  const start = makeButton(
    'Start battle',
    () => formation.start(),
    'mb-primary re-btn--primary fm-start',
  );
  start.disabled = !ready;
  if (!ready)
    start.setAttribute(
      'aria-label',
      `Start battle (place everyone first: ${formation.placed()} of ${formation.units.length})`,
    );
  return start;
}

/** Desktop: a fixed dock at the bottom-left of the battle view. */
export class FormationDock {
  constructor(formation) {
    this.formation = formation;
    this.root = el('section', 're fm-dock');
    this.root.setAttribute('aria-label', 'Formation');
    this.root.style.zIndex = DOM_UI_DEPTHS.FORMATION;
    for (const type of DOM_INPUT_EVENTS)
      this.root.addEventListener(type, (event) => event.stopPropagation());
    (document.getElementById('game-wrapper') || document.body).append(this.root);
    this.onResize = () => this.layout();
    globalThis.addEventListener?.('resize', this.onResize);
    this.render();
  }

  /**
   * Sit in the wider margin beside the map so the dock never covers a spawn tile;
   * with no room on either side it overlays the bottom-right corner.
   */
  layout() {
    const root = this.root;
    const s = this.formation.scene;
    const canvas = s.game?.canvas;
    const host = root?.offsetParent || root?.parentElement;
    if (!root || !canvas || !s.grid || !host) return;
    const rect = canvas.getBoundingClientRect();
    const hostRect = host.getBoundingClientRect();
    const toPage = (x, y) => {
      const p = s._worldToScreen?.(x, y) || { x, y };
      return {
        x: rect.left + (p.x * rect.width) / s.scale.width,
        y: rect.top + (p.y * rect.height) / s.scale.height,
      };
    };
    const half = 16;
    const topLeft = toPage(s.grid.gridToPixel(0, 0).x - half, 0);
    const last = s.grid.gridToPixel(s.grid.cols - 1, 0);
    const right = toPage(last.x + half, 0);
    const leftRoom = topLeft.x - hostRect.left;
    const rightRoom = hostRect.right - right.x;
    const room = Math.max(leftRoom, rightRoom);
    root.style.left = root.style.right = '';
    root.classList.toggle('is-overlay', room < 200);
    if (room < 200) {
      root.style.right = '12px';
      root.style.width = '';
      return;
    }
    const width = Math.min(300, room - 16);
    root.style.width = `${width}px`;
    if (rightRoom >= leftRoom) root.style.right = '8px';
    else root.style.left = '8px';
  }

  render() {
    if (!this.root?.isConnected) return;
    const f = this.formation;
    this.root.hidden = !f.ready;
    this.root.replaceChildren(el('h2', 'fm-title', 'Formation'));
    const button = (label, action, cls = '') => {
      const b = el('button', `re-btn ${cls}`, label);
      b.type = 'button';
      b.addEventListener('click', () => {
        if (!f.ready) return;
        action();
      });
      return b;
    };
    renderFormationPanel(this.root, f, button);
    this.layout();
    const danger = button('Danger [D]', () => f.scene._onDangerClick?.(), 'fm-danger');
    danger.setAttribute('aria-pressed', String(Boolean(f.scene.dangerZone?.visible)));
    this.root.append(danger);
  }

  destroy() {
    globalThis.removeEventListener?.('resize', this.onResize);
    this.root?.remove();
    this.root = null;
  }
}

import './trade.css';
import { MenuSurface, element, button } from './MenuSurface.js';
import { InputAction } from '../utils/InputActions.js';
import { bindCancelablePress } from '../utils/cancelablePress.js';
import { formatUses, getConsumableDescription } from '../utils/consumableText.js';
import { formatAccessoryEffects, formatAccessoryCombatEffect } from '../utils/accessoryText.js';
import { itemIcon } from './itemIcons.js';
import { equippedBadgeElement } from './equippedBadge.js';
import { battleItemBrief } from './battleItemSummary.js';
import { itemKeywordText } from './itemKeywordChips.js';
import {
  activateRow,
  baseStatus,
  buildTradeView,
  cancelAction,
  clampFocus,
  commitMessage,
  focusAfterCommit,
  holderUnit,
  initialFocus,
  navigate,
  rowAt,
  sameHolder,
} from './tradeMenuModel.js';

const ARROWS = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' };
let menuSerial = 0;

/** A unit or a holder in, a holder out (holders pass through untouched). */
function toHolder(subject, engine) {
  if (subject?.kind === 'unit' || subject?.kind === 'convoy') return subject;
  return engine?.unitHolder ? engine.unitHolder(subject) : { kind: 'unit', unit: subject };
}

/** The short line under an item's name. */
export function tradeItemBrief(item, unit) {
  if (!item) return '';
  if (item.type === 'Accessory')
    return [formatAccessoryEffects(item), formatAccessoryCombatEffect(item)]
      .filter(Boolean)
      .join(' · ');
  if (item.type === 'Consumable')
    return [formatUses(item), getConsumableDescription(item)].filter(Boolean).join(' · ');
  // A staff's range and uses grow with its wielder's MAG: in the convoy (no wielder)
  // it shows its base range only (battleItemBrief needs a unit for a staff).
  if (item.type === 'Staff' && !unit?.stats) return `Staff · Rng ${item.range ?? 1}`;
  if (item.type === 'Staff' || item.type === 'Scroll') return battleItemBrief(item, unit);
  return [
    `${item.type} · Mt ${item.might ?? 0} · Hit ${item.hit ?? 0} · Wt ${item.weight ?? 0}`,
    itemKeywordText(item),
  ]
    .filter(Boolean)
    .join(' · ');
}

/**
 * FE-style trading between two holders (docs/specs/item-trade.md, "UI"): tap an
 * item to hold it, tap a slot on the other side to give or swap. The rules and the
 * write belong to the caller: `engine` plans every target, `commit` applies one.
 *
 * Props:
 *   scene      Phaser scene (overlay stack, shutdown)
 *   ctx        { context: 'battle' | 'roster', run? }
 *   left/right a unit or a holder ({ kind: 'unit', unit } | { kind: 'convoy' })
 *   bags?      bag ids to offer (default: all the context allows)
 *   bag?       the tab to open on (default: the held item's bag, else the first)
 *   held?      { holder, bag, item } to open with an item already held
 *   commit(from, to) -> { ok, reason?, message? } (or a promise of it)
 *   onClose()  after the menu is gone
 *   engine     { planTrade, bagItems, bagCapacity, unitHolder? }
 */
export class TradeMenu {
  constructor({
    scene,
    ctx,
    left,
    right,
    bags = null,
    bag = null,
    held = null,
    commit,
    onClose,
    engine,
    title = 'Trade items',
  }) {
    this.id = `tm-${++menuSerial}`;
    Object.assign(this, { scene, ctx, bags, engine, onClose, commitTrade: commit });
    this.left = toHolder(left, engine);
    this.right = toHolder(right, engine);
    this.held = this.ownSlot(held);
    this.bag = bag || held?.bag || null;
    this.message = '';
    this.focus = null;
    this.serial = 0;
    this.releases = [];
    this.rowEls = new Map();

    this.surface = new MenuSurface(scene, title, () => this.cancel(), { modal: true });
    const { root, header, body } = this.surface;
    root.classList.add('tm-trade');
    this.done = header.querySelector('button');
    this.done.textContent = 'Done';
    this.done.classList.add('tm-done');
    this.done.onclick = () => this.close();
    const heading = header.querySelector('h2');
    this.titleBox = element('div', null, 'tm-title');
    this.notice = element('p', '', 'tm-notice');
    this.titleBox.append(heading, this.notice);
    this.tabList = element('div', null, 'tm-tabs');
    this.tabList.setAttribute('role', 'tablist');
    this.tabList.setAttribute('aria-label', 'Bags');
    header.replaceChildren(this.titleBox, this.tabList, this.done);

    this.grid = element('div', null, 'tm-grid');
    this.grid.id = `${this.id}-panel`;
    this.grid.setAttribute('role', 'tabpanel');
    this.status = element('p', '', 'tm-status');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    body.append(this.grid, this.status);

    this.surface.onKey = (event) => this.onKey(event);
    this.surface.onAction = (action, payload) => this.onAction(action, payload);
    this.render();
    this.focusRow(initialFocus(this.view));
  }

  /** A caller's slot re-pointed at this menu's own holder objects. */
  ownSlot(slot) {
    if (!slot?.item) return null;
    const holder = toHolder(slot.holder, this.engine);
    const own = sameHolder(holder, this.left)
      ? this.left
      : sameHolder(holder, this.right)
        ? this.right
        : null;
    return own ? { holder: own, bag: slot.bag, item: slot.item } : null;
  }

  render() {
    const was = this.focusKind();
    const scroll = {};
    for (const side of ['left', 'right'])
      scroll[side] = this.grid.querySelector(`.tm-list-${side}`)?.scrollTop || 0;
    for (const release of this.releases.splice(0)) release();
    this.rowEls.clear();
    this.serial++;

    this.view = buildTradeView({
      ctx: this.ctx,
      left: this.left,
      right: this.right,
      bags: this.bags,
      bag: this.bag,
      held: this.held,
      engine: this.engine,
    });
    const view = this.view;
    this.bag = view.bag;
    this.held = view.held;
    this.focus = clampFocus(view, this.focus);

    this.notice.textContent = view.notice;
    this.notice.hidden = !view.notice;
    this.renderTabs();
    this.grid.replaceChildren();
    if (view.empty) this.grid.append(element('p', 'Nothing to trade.', 'tm-empty'));
    else
      for (const side of ['left', 'right']) {
        const column = this.renderColumn(view.columns[side]);
        this.grid.append(column);
        const list = column.querySelector(`.tm-list-${side}`);
        if (list) list.scrollTop = scroll[side];
      }
    this.setStatus(this.message || baseStatus(view));

    if (was === 'tab') this.tabButtons.find((t) => t.bag === view.bag)?.el.focus();
    else if (was === 'row') this.focusRow(this.focus);
  }

  renderTabs() {
    this.tabButtons = [];
    this.tabList.replaceChildren();
    this.tabList.hidden = this.view.tabs.length === 0;
    for (const tab of this.view.tabs) {
      const selected = tab.bag === this.view.bag;
      const el = button(tab.label, () => this.setBag(tab.bag), 're-btn tm-tab');
      el.id = `${this.id}-tab-${tab.bag}`;
      el.setAttribute('role', 'tab');
      el.setAttribute('aria-selected', String(selected));
      el.setAttribute('aria-controls', this.grid.id);
      if (selected) this.grid.setAttribute('aria-labelledby', el.id);
      this.tabList.append(el);
      this.tabButtons.push({ bag: tab.bag, el });
    }
  }

  renderColumn(column) {
    const section = element('section', null, `tm-col tm-col-${column.side}`);
    const headId = `${this.id}-${column.side}-head`;
    section.setAttribute('role', 'group');
    section.setAttribute('aria-labelledby', headId);
    const head = element('h3', null, 'tm-col-head');
    head.id = headId;
    head.append(
      element('span', column.title, 'tm-col-name'),
      element('span', column.count, 'tm-col-count'),
    );
    const list = element('div', null, `re-scroll tm-list tm-list-${column.side}`);
    for (const row of column.rows) list.append(this.renderRow(row));
    section.append(head, list);
    return section;
  }

  renderRow(row) {
    const el = element('button', null, 're-btn re-row tm-row');
    el.type = 'button';
    el.dataset.side = row.side;
    el.dataset.index = String(row.index);
    el.dataset.state = row.state;
    el.setAttribute('aria-label', row.name);
    if (row.pressed != null) el.setAttribute('aria-pressed', String(row.pressed));
    if (row.disabled) el.setAttribute('aria-disabled', 'true');
    if (row.blocked) el.classList.add('is-blocked');
    const described = [];
    const line = (text, className) => {
      const small = element('small', text, className);
      small.id = `${this.id}-${row.key.replace(':', '-')}-${className}`;
      described.push(small.id);
      return small;
    };
    if (row.empty) {
      el.classList.add('is-empty');
      el.append(element('strong', 'Empty'));
    } else {
      const name = element('strong', row.item.name);
      if (row.equipped) name.append(equippedBadgeElement((tag) => element(tag)));
      el.append(itemIcon(row.item, { size: 32 }), name);
      const brief = tradeItemBrief(row.item, holderUnit(row.slot.holder));
      if (brief) el.append(line(brief, 'tm-brief'));
    }
    if (row.warnings.length) el.append(line(row.warnings.join(' · '), 'tm-warn'));
    if (described.length) el.setAttribute('aria-describedby', described.join(' '));
    el.addEventListener('focus', () => this.onRowFocus(row));
    this.releases.push(
      bindCancelablePress(el, () => this.activate(row.side, row.index), {
        context: () => this.serial,
      }),
    );
    this.rowEls.set(row.key, el);
    return el;
  }

  rowEl(focus) {
    return focus ? this.rowEls.get(`${focus.side}:${focus.index}`) || null : null;
  }

  focusKind() {
    const active = globalThis.document?.activeElement;
    if (!active || !this.surface?.root.contains(active)) return null;
    if ([...this.rowEls.values()].includes(active)) return 'row';
    if (this.tabButtons?.some((t) => t.el === active)) return 'tab';
    if (active === this.done) return 'done';
    return null;
  }

  focusRow(focus) {
    const target = clampFocus(this.view, focus);
    const el = this.rowEl(target);
    if (!el) {
      this.done.focus();
      return;
    }
    this.focus = target;
    el.focus();
  }

  onRowFocus(row) {
    this.focus = { side: row.side, index: row.index };
    // A blocked target says why while it has focus; leaving it restores the line.
    this.setStatus(row.blocked || this.message || baseStatus(this.view));
  }

  setStatus(text) {
    if (this.status.textContent !== text) this.status.textContent = text;
  }

  activate(side, index) {
    if (this.applying || this.closed) return;
    const row = rowAt(this.view, { side, index });
    const action = activateRow(this.view, row);
    this.focus = { side, index };
    if (action.type === 'hold') {
      this.held = action.held;
      this.message = '';
      this.render();
      this.focusRow({ side, index });
    } else if (action.type === 'release') {
      this.held = null;
      this.message = '';
      this.render();
      this.focusRow({ side, index });
    } else if (action.type === 'blocked') {
      this.setStatus(action.reason);
    } else if (action.type === 'commit') {
      this.apply(action, { side, index });
    }
  }

  apply(action, target) {
    const origin = this.view.heldRow;
    this.applying = true;
    this.surface.root.setAttribute('aria-busy', 'true');
    const finish = (result) => {
      this.applying = false;
      this.surface.root.removeAttribute('aria-busy');
      if (this.closed) return;
      if (result?.ok === true) {
        this.held = null;
        this.message = result.message || commitMessage(action.from, action.to, action.kind);
        this.render();
        this.focusRow(focusAfterCommit(this.view, origin));
      } else {
        // Keep the item held if it is still there; the plan is redone on render.
        this.message = result?.reason || 'Could not trade. Please try again.';
        this.render();
        this.focusRow(target);
      }
    };
    const fail = (error) => {
      console.error('Trade failed', error);
      finish({ ok: false });
    };
    let result;
    try {
      result = this.commitTrade(action.from, action.to);
    } catch (error) {
      fail(error);
      return;
    }
    if (typeof result?.then === 'function') result.then(finish, fail);
    else finish(result);
  }

  setBag(bag, focus = this.focus) {
    if (this.applying || this.closed || !bag || bag === this.view.bag) return;
    const was = this.focusKind();
    if (this.held && this.held.bag !== bag) this.held = null;
    this.bag = bag;
    this.message = '';
    this.focus = focus;
    this.render();
    if (was === 'row') this.focusRow(focus);
    else if (was !== 'done') this.tabButtons.find((t) => t.bag === this.view.bag)?.el.focus();
  }

  switchTab(delta) {
    const { bag, focus } = navigate(this.view, this.focus, delta < 0 ? 'prevTab' : 'nextTab');
    this.setBag(bag, focus);
  }

  move(direction) {
    const kind = this.focusKind();
    if (kind === 'row') {
      this.focusRow(navigate(this.view, this.focus, direction).focus);
      return;
    }
    if (kind === 'tab') {
      const at = this.tabButtons.findIndex((t) => t.el === globalThis.document.activeElement);
      if (direction === 'left' || direction === 'right') {
        const next = at + (direction === 'left' ? -1 : 1);
        if (next >= this.tabButtons.length) this.done.focus();
        else this.tabButtons[Math.max(0, next)].el.focus();
      } else if (direction === 'down') this.focusRow(this.focus || initialFocus(this.view));
      return;
    }
    if (kind === 'done') {
      if (direction === 'left' && this.tabButtons.length) this.tabButtons.at(-1).el.focus();
      else if (direction === 'down') this.focusRow(this.focus || initialFocus(this.view));
      return;
    }
    this.focusRow(this.focus || initialFocus(this.view));
  }

  onKey(event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return false;
    const { key } = event;
    if (key === 'Escape') {
      this.cancel();
      return true;
    }
    if (key === 'PageUp' || key === 'PageDown') {
      this.switchTab(key === 'PageUp' ? -1 : 1);
      return true;
    }
    if (/^[qe]$/i.test(key)) {
      this.switchTab(key.toLowerCase() === 'q' ? -1 : 1);
      return true;
    }
    if (ARROWS[key]) {
      this.move(ARROWS[key]);
      return true;
    }
    // MenuSurface: Enter clicks the focused control (held-key repeats are dropped
    // there), Space activates natively, Tab walks every control in order.
    return false;
  }

  onAction(action, payload) {
    if (action === InputAction.NAVIGATE) {
      const dy = Math.sign(Number(payload?.dy) || 0);
      const dx = Math.sign(Number(payload?.dx) || 0);
      const direction = dy < 0 ? 'up' : dy > 0 ? 'down' : dx < 0 ? 'left' : dx > 0 ? 'right' : null;
      if (direction) this.move(direction);
      return true;
    }
    if (action === InputAction.PREV_UNIT || action === InputAction.NEXT_UNIT) {
      this.switchTab(action === InputAction.PREV_UNIT ? -1 : 1);
      return true;
    }
    if (action === InputAction.CANCEL || action === InputAction.PAUSE) {
      this.cancel();
      return true;
    }
    return false; // CONFIRM: MenuSurface clicks the focused control.
  }

  /** Esc / B / rail Back / overlay: release a held item first, then close. */
  cancel() {
    if (this.closed || this.applying) return;
    if (cancelAction(this.view) === 'release') {
      const at = this.view.heldRow;
      this.held = null;
      this.message = '';
      this.render();
      this.focusRow(at);
      return;
    }
    this.close();
  }

  close() {
    if (this.closed || this.applying) return;
    this.destroy();
    this.onClose?.();
  }

  destroy() {
    if (this.closed) return;
    this.closed = true;
    for (const release of this.releases.splice(0)) release();
    this.surface.destroy();
  }
}

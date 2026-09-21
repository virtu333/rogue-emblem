import { ignoreRepeatedActivation } from '../utils/domInputBoundary.js';
import { DOM_INPUT_EVENTS } from '../utils/domUI.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';
const categories = [
  ['recruit_stats', 'Recruits'],
  ['lord_bonuses', 'Lords'],
  ['economy', 'Economy'],
  ['capacity', 'Battalion'],
  ['starting_equipment', 'Equipment'],
  ['starting_skills', 'Skills'],
];
const node = (tag, cls, text) => {
  const n = document.createElement(tag);
  n.className = cls;
  if (text != null) n.textContent = text;
  return n;
};
export class MobileUpgradeMenu {
  constructor(scene, options = {}) {
    this.options = options;
    this.scene = scene;
    this.meta = scene.meta;
    this.category = 'recruit_stats';
    this.offsets = new Map();
    this.selections = new Map();
    this.launcher = this.button('Upgrades', () => this.open());
    this.launcher.className = 'mu-launch';
    for (const type of DOM_INPUT_EVENTS)
      this.launcher.addEventListener(type, (event) => event.stopPropagation());
    document.getElementById('game-wrapper').append(this.launcher);
    if (!options.embedded) this.open();
    else this.launcher.hidden = true;
  }
  button(label, fn) {
    const b = node('button', '', label);
    b.type = 'button';
    b.onclick = fn;
    return b;
  }
  open() {
    if (this.visible) return;
    this.visible = true;
    this.launcher.hidden = true;
    this.previousFocus = document.activeElement;
    this.previousInput = this.scene.input.enabled;
    this.scene.input.enabled = false;
    this.root = node('section', 'mu-screen');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Army upgrades');
    for (const name of DOM_INPUT_EVENTS)
      this.root.addEventListener(name, (e) => e.stopPropagation());
    this.root.addEventListener('keydown', (e) => {
      if (ignoreRepeatedActivation(e)) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.back();
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        this.moveFocus(e.shiftKey ? -1 : 1);
      }
    });
    this.header = node('header', 'mu-header');
    this.tabs = node('nav', 'mu-tabs');
    this.tabs.setAttribute('aria-label', 'Upgrade categories');
    const split = node('div', 'mu-split');
    this.list = node('div', 'mu-list');
    this.list.setAttribute('aria-label', 'Upgrades');
    this.detail = node('section', 'mu-detail');
    split.append(this.list, this.detail);
    this.status = node('div', 'mu-status');
    this.status.setAttribute('role', 'status');
    this.root.append(this.header, this.tabs, split, this.status);
    document.getElementById('game-wrapper').append(this.root);
    pushInputScope(this, (action, payload) => {
      if ([InputAction.CANCEL, InputAction.PAUSE].includes(action)) this.back();
      if (action === InputAction.NAVIGATE) this.moveFocus(payload?.dy || payload?.dx || 1);
      if (action === InputAction.CONFIRM && this.root.contains(document.activeElement))
        document.activeElement.click();
    });
    this.render(false);
    this.root.querySelector('button')?.focus();
  }
  moveFocus(delta) {
    const bs = [...this.root.querySelectorAll('button:not(:disabled)')];
    const i = bs.indexOf(document.activeElement);
    bs[(i + delta + bs.length) % bs.length]?.focus();
  }
  back() {
    if (this.refundPending) {
      this.refundPending = false;
      this.render();
    } else this.close();
  }
  close() {
    if (!this.visible) return;
    this.offsets.set(this.category, this.list.scrollTop);
    this.visible = false;
    this.refundPending = false;
    popInputScope(this);
    this.root.remove();
    this.scene.input.enabled = this.previousInput;
    this.scene.drawUI();
    if (this.options.embedded) this.options.onClose?.();
    else {
      this.launcher.hidden = false;
      this.launcher.focus();
    }
  }
  selectCategory(category) {
    this.offsets.set(this.category, this.list.scrollTop);
    this.selections.set(this.category, this.selected);
    this.category = category;
    this.selected = this.selections.get(category) || null;
    this.refundPending = false;
    this.render(false);
  }
  render(preserve = true) {
    if (!this.visible) return;
    const focus = document.activeElement?.dataset?.focus;
    const scroll = preserve ? this.list.scrollTop : this.offsets.get(this.category) || 0;
    const m = this.meta,
      items = m.upgradesData.filter((u) => u.category === this.category);
    if (!items.some((u) => u.id === this.selected)) this.selected = items[0]?.id;
    const u = items.find((u) => u.id === this.selected);
    const currency = u ? m.getCurrencyForUpgrade(u.id) : 'supply';
    this.header.replaceChildren(node('h1', '', 'Army upgrades'));
    for (const cur of ['valor', 'supply']) {
      const balance = node(
        'span',
        'mu-currency' + (cur === currency ? ' active' : ''),
        `${cur === 'valor' ? 'Valor' : 'Supply'} ${cur === 'valor' ? m.totalValor : m.totalSupply}`,
      );
      this.header.append(balance);
    }
    const close = this.button('Home base', () => this.close());
    close.dataset.focus = 'close';
    this.header.append(close);
    this.tabs.replaceChildren();
    for (const [id, label] of categories) {
      const b = this.button(label, () => this.selectCategory(id));
      b.setAttribute('aria-pressed', String(id === this.category));
      b.dataset.focus = 'cat-' + id;
      this.tabs.append(b);
    }
    this.list.replaceChildren();
    let group = '';
    for (const item of items) {
      const nextGroup = item.id.endsWith('_growth')
        ? 'Growths'
        : item.id.endsWith('_flat')
          ? 'Base stats'
          : 'Other';
      if (nextGroup !== group) {
        this.list.append(node('h2', 'mu-group', nextGroup));
        group = nextGroup;
      }
      const level = m.getUpgradeLevel(item.id),
        hidden = level === 0 && m.isMilestoneLocked(item),
        maxed = m.isMaxed(item.id);
      const b = this.button('', () => {
        this.selected = item.id;
        this.refundPending = false;
        this.status.textContent = '';
        this.render();
      });
      b.className = 'mu-row';
      b.dataset.upgrade = item.id;
      b.dataset.focus = 'row-' + item.id;
      b.setAttribute('aria-pressed', String(item.id === this.selected));
      b.append(node('strong', '', hidden ? '???' : item.name));
      b.append(
        node(
          'span',
          'mu-row-state',
          hidden
            ? 'Locked'
            : maxed
              ? 'MAX'
              : `${m.getNextCost(item.id)} ${m.getCurrencyForUpgrade(item.id)}`,
        ),
      );
      const pips = node('span', 'mu-pips' + (maxed ? ' maxed' : ''));
      pips.setAttribute('aria-label', `Tier ${level} of ${item.maxLevel}`);
      for (let i = 0; i < item.maxLevel; i++) {
        const pip = node('i', i < level ? 'filled' : '');
        pip.setAttribute('aria-hidden', 'true');
        pips.append(pip);
      }
      b.append(
        pips,
        node('small', '', hidden ? 'Tap for requirements' : `Tier ${level} / ${item.maxLevel}`),
      );
      this.list.append(b);
    }
    this.list.scrollTop = scroll;
    this.detail.replaceChildren();
    if (!u) {
      this.detail.append(node('p', '', 'No upgrades in this category.'));
      return;
    }
    const level = m.getUpgradeLevel(u.id),
      hidden = level === 0 && m.isMilestoneLocked(u),
      maxed = m.isMaxed(u.id),
      requirements = m.getPrerequisiteInfo(u.id);
    const copy = node('div', 'mu-copy');
    copy.append(node('h2', '', hidden ? 'Unknown upgrade' : u.name));
    if (!hidden) {
      copy.append(node('p', '', u.description || this.scene._getActionDesc(u)));
      const values = this.scene._getValueTexts(u, level);
      copy.append(
        node(
          'p',
          'mu-effects',
          `Current: ${values.current || 'None'}\nNext: ${maxed ? 'Fully upgraded' : values.next || 'See description'}`,
        ),
      );
      const tips = this.scene
        ._getUpgradeTooltipLines(u)
        .filter((t) => t !== u.name && t !== u.description);
      if (tips.length) copy.append(node('p', 'mu-help', tips.join('\n')));
    }
    if (!requirements.met)
      copy.append(node('p', 'mu-requirements', `Requires:\n${requirements.missing.join('\n')}`));
    const actions = node('div', 'mu-actions');
    const buy = this.button(
      maxed ? 'Fully upgraded' : `Buy · ${m.getNextCost(u.id)} ${currency}`,
      () => this.purchase(u),
    );
    buy.dataset.focus = 'buy';
    buy.className = 'mu-buy';
    buy.disabled = maxed || !m.canAfford(u.id) || !requirements.met;
    actions.append(buy);
    if (!maxed && requirements.met && !m.canAfford(u.id))
      copy.append(node('p', 'mu-requirements', `Not enough ${currency}.`));
    if (level > 0) {
      const check = m.canRefund(u.id);
      if (this.refundPending && check.success) {
        actions.append(
          node(
            'p',
            'mu-refund-info',
            `Return ${check.refundAmount} ${currency}, less ${check.refundFee} fee. Net: +${check.refundAmount - check.refundFee} ${currency}.`,
          ),
        );
        const yes = this.button('Confirm refund', () => this.refund(u));
        yes.dataset.focus = 'confirm-refund';
        actions.append(
          yes,
          this.button('Keep upgrade', () => {
            this.refundPending = false;
            this.render();
          }),
        );
      } else {
        const refund = this.button('Refund one tier', () => {
          this.refundPending = true;
          this.render();
          this.detail.querySelector('[data-focus="confirm-refund"]')?.focus();
        });
        refund.disabled = !check.success;
        refund.dataset.focus = 'refund';
        actions.append(refund);
        if (!check.success)
          copy.append(
            node(
              'p',
              'mu-help',
              check.detail ||
                (check.reason === 'insufficient_fee'
                  ? 'Your balance cannot cover the refund fee.'
                  : 'This tier cannot be refunded.'),
            ),
          );
      }
    }
    this.detail.append(copy, actions);
    if (focus) this.root.querySelector(`[data-focus="${focus}"]`)?.focus({ preventScroll: true });
  }
  purchase(u) {
    if (!this.meta.purchaseUpgrade(u.id)) {
      this.status.textContent = 'Purchase unavailable.';
      this.render();
      return;
    }
    this.refundPending = false;
    this.scene.registry.get('audio')?.playSFX('sfx_confirm');
    this.render();
    this.status.textContent = `${u.name}: tier ${this.meta.getUpgradeLevel(u.id)} purchased.`;
  }
  refund(u) {
    const r = this.meta.refundUpgrade(u.id);
    this.refundPending = false;
    this.render();
    this.status.textContent = r.success
      ? `${u.name}: one tier refunded.`
      : 'Refund unavailable. Your upgrades are unchanged.';
  }
  destroy() {
    if (this.visible) {
      popInputScope(this);
      this.root.remove();
      this.scene.input.enabled = this.previousInput;
    }
    this.visible = false;
    this.launcher.remove();
  }
}

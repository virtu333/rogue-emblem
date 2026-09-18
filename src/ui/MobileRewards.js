import { pushOverlay, removeOverlay } from '../utils/overlayStack.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';
import './mobileUpgrade.css';
const node = (tag, text, cls = '') => {
  const el = document.createElement(tag);
  el.className = cls;
  if (text != null) el.textContent = text;
  return el;
};
// Reuses the reward controller's commands; never rolls or awards rewards itself.
export class MobileRewards {
  constructor(scene, controller, choices, summary, skipGold) {
    Object.assign(this, { scene, controller, choices, summary, skipGold });
    this.selected = 0;
    this.onShutdown = () => this.destroy();
    scene.events.once('shutdown', this.onShutdown);
    this.open();
  }
  button(label, action) {
    const b = node('button', label);
    b.type = 'button';
    b.onclick = action;
    return b;
  }
  open() {
    if (this.visible || this.scene._lootResolving || this.scene._lootCleanedUp) return;
    this.visible = true;
    this.previousFocus = document.activeElement;
    this.overlayToken = pushOverlay(this.scene, { name: 'rewards', onCancel: () => true });
    this.root = node('section', null, 'mu-screen');
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Battle rewards');
    for (const type of ['pointerdown', 'pointerup', 'click', 'wheel', 'keydown'])
      this.root.addEventListener(type, (e) => e.stopPropagation());
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        this.moveFocus(e.shiftKey ? -1 : 1);
      }
    });
    document.getElementById('game-wrapper').append(this.root);
    for (const obj of this.controller.lootGroup) obj.setVisible(false);
    pushInputScope(this, (action, payload) => {
      if (action === InputAction.NAVIGATE) this.moveFocus(payload?.dy || payload?.dx || 1);
      if (action === InputAction.CONFIRM && this.root.contains(document.activeElement))
        document.activeElement.click();
    });
    this.render();
    this.root.querySelector('button')?.focus();
  }
  moveFocus(delta) {
    const buttons = [...this.root.querySelectorAll('button:not(:disabled)')];
    const i = buttons.indexOf(document.activeElement);
    buttons[(i + delta + buttons.length) % buttons.length]?.focus();
  }
  render() {
    const scene = this.scene;
    const focus = this.root.contains(document.activeElement)
      ? document.activeElement.dataset.focus
      : null;
    this.root.replaceChildren();
    const header = node('header', null, 'mu-header');
    header.append(
      node('h1', 'Battle rewards'),
      node('span', `${scene.runManager.gold} gold`, 'mu-currency active'),
    );
    const split = node('div', null, 'mu-split');
    const list = node('div', null, 'mu-list');
    const detail = node('section', null, 'mu-detail');
    const all = [...this.choices, { type: 'skip' }];
    const label = (c) =>
      c.type === 'skip'
        ? `Take ${this.skipGold} gold instead`
        : c.item?.name ||
          `${c.goldAmount || 0} gold${c.xpAmount ? ` + ${c.xpAmount} team XP` : ''}`;
    all.forEach((c, i) => {
      const b = this.button(label(c), () => {
        this.selected = i;
        this.render();
      });
      b.dataset.focus = `reward-${i}`;
      b.className = 'mh-skill';
      b.setAttribute('aria-pressed', String(this.selected === i));
      b.disabled = !this.controller._focusCards[i]?.input?.enabled;
      list.append(b);
    });
    const c = all[this.selected];
    const copy = node('div', null, 'mu-copy');
    copy.append(node('h2', label(c)), node('p', this.summary, 'mu-help'));
    const description =
      c.type === 'skip'
        ? 'Pass on the remaining rewards and add this gold to your vault.'
        : c.item
          ? scene._getLootTooltipText(c, c.item)
          : 'Gold is added to your vault. Team XP is shared with your roster.';
    copy.append(node('p', description));
    const actions = node('div', null, 'mu-actions');
    actions.append(
      node(
        'span',
        `Choose ${scene._elitePicksRemaining || 1} reward${scene._elitePicksRemaining > 1 ? 's' : ''}`,
        'mu-help',
      ),
    );
    const claim = this.button(c.type === 'skip' ? 'Take gold' : 'Choose reward', () => {
      const card = this.controller._focusCards[this.selected];
      if (!card?.input?.enabled || scene._lootResolving) return;
      this.hide();
      card.emit('pointerdown', { button: 0 });
    });
    claim.dataset.focus = 'claim';
    claim.className = 'mu-buy';
    claim.disabled = !this.controller._focusCards[this.selected]?.input?.enabled;
    actions.append(claim);
    detail.append(copy, actions);
    split.append(list, detail);
    this.root.append(header, split);
    if (focus) this.root.querySelector(`[data-focus="${focus}"]:not(:disabled)`)?.focus();
  }
  hide() {
    if (!this.visible) return;
    this.visible = false;
    popInputScope(this);
    removeOverlay(this.scene, this.overlayToken);
    this.overlayToken = null;
    this.root.remove();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }
  destroy() {
    this.hide();
    this.scene.events.off('shutdown', this.onShutdown);
  }
}

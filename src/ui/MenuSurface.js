import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import { pushOverlay, removeOverlay } from '../utils/overlayStack.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';
import './cohesion.css';

export function element(tag, text, className = '') {
  const el = document.createElement(tag);
  if (text != null) el.textContent = text;
  el.className = className;
  return el;
}
export function button(text, action, className = 're-btn') {
  const el = element('button', text, className);
  el.type = 'button';
  el.onclick = action;
  return el;
}

// DOM menus share modal ownership and teardown, not gameplay or purchase rules.
export class MenuSurface {
  constructor(scene, title, onClose, { modal = false } = {}) {
    Object.assign(this, { scene, onClose });
    this.previousFocus = document.activeElement;
    this.root = element('section', null, 're re-screen re-live-menu');
    this.root.style.setProperty('--re-z', DOM_UI_DEPTHS.MENU);
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', title);
    this.root.tabIndex = -1;
    if (modal) this.root.classList.add('re-compact-menu');
    this.header = element('header', null, 're-header');
    this.header.append(
      element('h2', title),
      button('Close', () => onClose()),
    );
    this.body = element('div', null, 're-menu-body');
    this.root.append(this.header, this.body);
    for (const name of ['pointerdown', 'pointerup', 'click', 'wheel'])
      this.root.addEventListener(name, (event) => event.stopPropagation());
    this.root.addEventListener('keydown', (event) => {
      event.stopPropagation();
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
      if (event.key === 'Tab') {
        event.preventDefault();
        this.focusNext(event.shiftKey ? -1 : 1);
      }
    });
    this.token = pushOverlay(scene, {
      name: title,
      onCancel: () => {
        onClose();
        return true;
      },
    });
    pushInputScope(this, (action, payload) => {
      if ([InputAction.CANCEL, InputAction.PAUSE].includes(action)) onClose();
      if (action === InputAction.NAVIGATE) this.focusNext(payload?.dy || payload?.dx || 1);
      if (action === InputAction.CONFIRM && this.root.contains(document.activeElement))
        document.activeElement.click();
    });
    this.shutdown = () => this.destroy();
    scene.events.once('shutdown', this.shutdown);
    document.getElementById('game-wrapper').append(this.root);
    this.root.querySelector('button').focus();
  }
  focusNext(delta) {
    const items = [...this.root.querySelectorAll('button:not(:disabled),input,select')];
    const i = items.indexOf(document.activeElement);
    items[(i + delta + items.length) % items.length]?.focus();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    removeOverlay(this.scene, this.token);
    popInputScope(this);
    this.scene.events.off('shutdown', this.shutdown);
    this.root.remove();
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
  }
}

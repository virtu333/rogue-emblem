import { ignoreRepeatedActivation } from '../utils/domInputBoundary.js';
import { DOM_INPUT_EVENTS } from '../utils/domUI.js';
import { hasInputFocus } from '../utils/inputFocus.js';
import { InputAction } from '../utils/InputActions.js';

// Presents the existing PauseOverlay actions; ownership and transitions stay there.
export class MobilePauseMenu {
  constructor(overlay) {
    this.overlay = overlay;
    this.previousFocus = document.activeElement;
    this.root = document.createElement('section');
    this.root.className = 'mp-backdrop';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', 'Paused');
    for (const type of DOM_INPUT_EVENTS)
      this.root.addEventListener(type, (e) => e.stopPropagation());
    this.root.addEventListener('keydown', (e) => {
      if (ignoreRepeatedActivation(e)) return;
      e.stopPropagation();
      if (e.key === 'Escape') {
        e.preventDefault();
        this.back();
      }
      if (['ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault();
        this.move(e.key === 'ArrowDown' ? 1 : -1);
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        this.move(e.shiftKey ? -1 : 1);
      }
    });
    document.getElementById('game-wrapper').append(this.root);
    this.tick = () => this.sync();
    overlay.scene.game.events.on('poststep', this.tick);
    this.shutdown = () => {
      this.destroy();
      this.overlay._teardownFocus();
    };
    overlay.scene.events.once('shutdown', this.shutdown);
    this.sync();
  }
  back() {
    if (!hasInputFocus(this.overlay)) return;
    if (this.overlay._confirmButtons.length) this.overlay._hideConfirm();
    else this.overlay.hide();
    this.sync();
  }
  move(delta) {
    const buttons = [...this.root.querySelectorAll('button')];
    if (!buttons.length) return;
    const i = buttons.indexOf(document.activeElement);
    buttons[(i + delta + buttons.length) % buttons.length].focus();
  }
  handleInput(action, payload) {
    if (action === InputAction.NAVIGATE) this.move(payload?.dy || payload?.dx || 0);
    if (action === InputAction.CONFIRM) {
      if (this.root.contains(document.activeElement)) document.activeElement.click();
    }
    if ([InputAction.CANCEL, InputAction.PAUSE].includes(action)) this.back();
  }
  sync() {
    if (this.destroyed) return;
    const o = this.overlay;
    const hidden = o.hasActiveSubOverlay() || !hasInputFocus(o);
    const wasHidden = this.root.hidden;
    this.root.hidden = hidden;
    for (const obj of [...o.objects, ...o.confirmObjects]) obj.setVisible?.(false);
    o._focus?.setRingVisible(false);
    if (hidden) return;
    const confirming = o._confirmButtons.length > 0;
    const buttons = confirming ? o._confirmButtons : o._menuButtons;
    if (buttons === this.buttons) {
      if (wasHidden) this.root.querySelector('button')?.focus();
      return;
    }
    this.buttons = buttons;
    this.root.replaceChildren();
    const panel = document.createElement('div');
    panel.className = 'mp-panel';
    const title = document.createElement('h2');
    title.textContent = confirming ? 'Confirm action' : 'Paused';
    panel.append(title);
    if (o.tutorial && !confirming) {
      const note = document.createElement('p');
      note.className = 'mp-note';
      note.textContent = 'Tutorial · practice battle — nothing here is saved.';
      panel.append(note);
    }
    if (confirming) {
      const message = document.createElement('p');
      message.className = 'mp-message';
      message.textContent =
        o.confirmObjects.find((obj) => obj.text && !buttons.includes(obj))?.text || '';
      panel.append(message);
    }
    const list = document.createElement('div');
    list.className = 'mp-actions';
    for (const source of buttons) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = source.text;
      if (source.text === 'Abandon Run') button.classList.add('mp-danger');
      if (source.text === 'Resume') button.classList.add('mp-primary');
      if (['Leave Tutorial', 'Start First Run'].includes(source.text))
        button.classList.add('mp-exit');
      let start = null;
      button.addEventListener('pointerdown', (e) => {
        start = [e.clientX, e.clientY];
      });
      button.addEventListener('pointercancel', () => {
        start = null;
      });
      button.addEventListener('click', (e) => {
        if (start && e.detail && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 10) {
          start = null;
          return;
        }
        start = null;
        const current = o._confirmButtons.length ? o._confirmButtons : o._menuButtons;
        if (this.destroyed || !o.visible || !hasInputFocus(o) || !current.includes(source)) return;
        source.emit('pointerdown');
        this.sync();
      });
      list.append(button);
    }
    panel.append(list);
    this.root.append(panel);
    // Back out is the initially focused action for destructive confirmations.
    const initial = confirming
      ? [...list.children].find((b) => b.textContent === 'Cancel')
      : list.firstChild;
    initial?.focus();
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.overlay.scene.game.events.off('poststep', this.tick);
    this.overlay.scene.events.off('shutdown', this.shutdown);
    this.root.remove();
    if (this.previousFocus?.isConnected) this.previousFocus.focus({ preventScroll: true });
  }
}

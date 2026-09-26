// Boot loading screen in the DOM: status and progress while assets download, the
// "no progress" recovery after a stall, and the data-load failure with its actions.
// DOM text stays readable at any size and orientation (canvas text on the 640x480
// boot canvas shrank to ~8 CSS px on an upright phone). BootScene owns the lifecycle.

import { hasDOMHost } from '../utils/domUI.js';

function el(doc, tag, className, text) {
  const node = doc.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function actionButton(doc, label, onClick, primary = false) {
  const b = el(doc, 'button', `re-btn${primary ? ' re-btn--primary' : ''}`, label);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

export class BootLoader {
  constructor(doc = globalThis.document) {
    this.doc = hasDOMHost() ? doc : null;
    this.root = null;
    this.stallShown = false;
  }

  create() {
    const doc = this.doc;
    if (!doc || this.root) return this;
    this.root = el(doc, 'section', 're-boot-loader');
    this.root.id = 'boot-loader';
    this.root.setAttribute('aria-label', 'Loading');
    this.status = el(doc, 'p', 're-boot-status', 'Loading assets…');
    this.status.setAttribute('role', 'status');
    this.status.setAttribute('aria-live', 'polite');
    this.progress = el(doc, 'p', 're-boot-progress', 'Preparing downloads…');
    this.warning = el(doc, 'p', 're-boot-warning');
    this.warning.hidden = true;
    this.panel = el(doc, 'div', 're-boot-panel');
    this.panel.hidden = true;
    this.root.append(this.status, this.progress, this.warning, this.panel);
    doc.body.append(this.root);
    return this;
  }

  setStatus(text) {
    if (this.status) this.status.textContent = text;
  }

  setProgress(text) {
    if (this.progress) this.progress.textContent = text;
  }

  /** Assets that failed to download (the game continues without them). */
  warn(text) {
    if (!this.warning) return;
    this.warning.textContent = text;
    this.warning.hidden = false;
  }

  /** Thirty seconds without progress: offer a reload while the download keeps going. */
  showStall({ onReload, onSafeReload }) {
    if (!this.panel || this.stallShown) return;
    this.stallShown = true;
    this._fillPanel('No download progress for 30 seconds. You can keep waiting.', [
      actionButton(this.doc, 'Reload', onReload, true),
      actionButton(this.doc, 'Reload Safe Mode', onSafeReload),
    ]);
  }

  hideStall() {
    if (!this.stallShown) return;
    this.stallShown = false;
    this.panel.replaceChildren();
    this.panel.hidden = true;
  }

  /** Game data could not load: say why and offer a retry or a safe-mode reload. */
  showFailure({ message, onRetry, onSafeReload }) {
    if (!this.root) return;
    this.stallShown = false;
    this.status.textContent = 'Failed to load game data.';
    this.status.classList.add('is-bad');
    this.progress.textContent = 'You can retry now or reload in safe mode.';
    this._fillPanel(message || 'unknown', [
      actionButton(this.doc, 'Retry', onRetry, true),
      actionButton(this.doc, 'Reload Safe Mode', onSafeReload),
    ]);
  }

  _fillPanel(text, buttons) {
    const actions = el(this.doc, 'div', 're-boot-actions');
    actions.append(...buttons);
    this.panel.replaceChildren(el(this.doc, 'p', 're-boot-detail', text), actions);
    this.panel.hidden = false;
  }

  destroy() {
    this.root?.remove();
    this.root = null;
    this.status = this.progress = this.warning = this.panel = null;
    this.stallShown = false;
  }
}

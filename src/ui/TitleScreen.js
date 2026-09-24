import { element } from './MenuSurface.js';
import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import { mountKeyArtBackdrop } from '../art/keyart/keyArtBackdrop.js';

// TitleScreen — DOM title over The Hollow Sun key art (ART_BIBLE "Title").
// Owns presentation only: the lockup, the reliquary menu, corner actions, notices and
// the backdrop lifecycle. TitleScene decides which actions exist (titleMenuModel.js)
// and what they do.

const COVERING_SCREENS = '.re-screen:not(.re-title):not([hidden]), .re-modal-shield, .mu-screen';
const DESIGN_W = 640;

/** The key-art lockup shared by the title and the auth screen. */
export function createKeyArtLockup({ subtitle = 'The Hollow Sun', level = 'h1' } = {}) {
  const lockup = element('div', null, 're-keyart-lockup');
  const title = element(level, 'Rogue Emblem', 're-keyart-title');
  const rule = element('div', null, 're-keyart-rule');
  rule.setAttribute('aria-hidden', 'true');
  rule.append(element('span'), element('i'), element('span'));
  lockup.append(title, rule, element('p', subtitle, 're-keyart-sub'));
  return lockup;
}

function isPhoneLayout() {
  const cl = document.documentElement.classList;
  return cl.contains('touch-ui') || cl.contains('mobile-preview');
}

export class TitleScreen {
  /**
   * @param {Phaser.Scene} scene
   * @param {object} opts
   * @param {Array} opts.items        buildTitleMenu() output
   * @param {(id: string) => void} opts.onAction
   * @param {'dusk'|'rising'|'ashfall'} opts.variant
   * @param {() => boolean} opts.reducedMotion
   * @param {{ displayName: string }|null} opts.cloud
   * @param {() => void} opts.onSettings
   * @param {() => void} [opts.onLogout]
   * @param {string} opts.version
   */
  constructor(scene, opts) {
    this.scene = scene;
    this.opts = opts;
    this.phone = isPhoneLayout();
    const root = element('section', null, 're re-title');
    this.root = root;
    root.classList.add(this.phone ? 're-title--phone' : 're-title--stage');
    root.dataset.variant = opts.variant;
    root.style.setProperty('--re-z', DOM_UI_DEPTHS.TITLE);
    root.setAttribute('aria-label', 'Rogue Emblem');

    this.art = element('div', null, 're-title-art');
    const veil = element('div', null, 're-title-veil');
    veil.setAttribute('aria-hidden', 'true');
    this.stage = element('div', null, 're-title-stage');
    root.append(this.art, veil, this.stage);

    const lead = element('div', null, 're-title-lead');
    lead.append(createKeyArtLockup());
    // Two groups: run actions under the lockup, guides and records bottom-right.
    const run = element('div', null, 're-title-run');
    run.setAttribute('role', 'group');
    run.setAttribute('aria-label', 'Play');
    const reference = element('div', null, 're-title-reference');
    reference.setAttribute('role', 'group');
    reference.setAttribute('aria-label', 'Guides and records');
    this.buttons = [];
    this.byId = new Map();
    for (const item of opts.items) {
      const b = element('button', null, 're-btn re-title-btn');
      b.type = 'button';
      b.dataset.action = item.id;
      if (item.primary) b.classList.add('re-btn--primary', 'is-primary');
      if (item.sub) b.classList.add('has-sub');
      const label = element('span', item.label, 're-title-label');
      b.append(label);
      if (item.sub) b.append(element('span', item.sub, 're-title-subtext'));
      if (item.badge) {
        b.classList.add('has-badge');
        const badge = element('span', item.badge, 're-title-badge');
        badge.setAttribute('aria-hidden', 'true');
        b.append(badge, element('span', ` (${item.badge.toLowerCase()})`, 're-visually-hidden'));
      }
      b.addEventListener('click', () => this._activate(item.id));
      (item.group === 'reference' ? reference : run).append(b);
      this.buttons.push(b);
      this.byId.set(item.id, b);
    }
    lead.append(run);

    const corner = element('div', null, 're-title-corner');
    this.soundHint = element('p', 'Tap for sound', 're-title-sound');
    this.soundHint.hidden = true;
    corner.append(this.soundHint);
    if (opts.cloud) {
      corner.append(element('span', opts.cloud.displayName || 'Player', 're-title-user'));
      this.logoutButton = this._cornerButton('Log Out', () => opts.onLogout?.());
      corner.append(this.logoutButton);
    }
    this.settingsButton = this._cornerButton('Settings', () => opts.onSettings?.());
    corner.append(this.settingsButton);

    this.notices = element('div', null, 're-title-notices');
    this.notices.setAttribute('role', 'status');
    this.cloudNotice = element('p', null, 're-title-notice is-bad');
    this.cloudNotice.hidden = true;
    this.logoutNotice = element('p', null, 're-title-notice');
    this.logoutNotice.hidden = true;
    this.notices.append(this.cloudNotice, this.logoutNotice);

    const foot = element('footer', null, 're-title-foot');
    foot.append(
      element('span', opts.version, 're-title-version'),
      element('span', 'Alpha testing', 're-title-alpha'),
    );
    if (!opts.cloud)
      foot.append(element('span', 'Progress saved on this device', 're-title-local'));

    this.message = element('p', null, 're-title-message');
    this.message.setAttribute('role', 'alert');
    this.message.hidden = true;

    this.stage.append(lead, reference, corner, this.notices, foot, this.message);

    root.addEventListener('keydown', (event) => this._onKey(event));
    root.addEventListener('focusin', (event) => {
      const i = this.buttons.indexOf(event.target);
      if (i >= 0) opts.onFocusIndex?.(i);
    });

    const host = document.getElementById('game-wrapper');
    host.append(root);

    this.backdrop = mountKeyArtBackdrop(this.art, {
      variant: opts.variant,
      reducedMotion: opts.reducedMotion,
      // Phones keep a crisp integer scale (the 2x plate) even if it crops a little more.
      maxCrop: this.phone ? 1.3 : 1.12,
    });

    this._syncStage = () => this._fitStage();
    if (!this.phone) {
      const canvas = scene.game?.canvas;
      if (typeof ResizeObserver !== 'undefined' && canvas) {
        this._stageObserver = new ResizeObserver(this._syncStage);
        this._stageObserver.observe(canvas);
      }
      window.addEventListener('resize', this._syncStage);
      scene.scale?.on?.('resize', this._syncStage);
      this._fitStage();
    }

    // Opaque screens (Compendium, Settings, records…) cover the art: pause it. Screens
    // are added/removed or shown/hidden in place, so watch both.
    this._coverObserver = new MutationObserver(() => this._syncCovered());
    this._coverObserver.observe(host, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['hidden'],
    });
    this._syncCovered();
    this.root.classList.toggle('is-still', !!opts.reducedMotion?.());
  }

  _cornerButton(label, onClick) {
    const b = element('button', label, 're-btn re-title-corner-btn');
    b.type = 'button';
    b.addEventListener('click', () => {
      if (this.scene._titleOverlayOpen?.() || this.scene.isTransitioning) return;
      onClick();
    });
    return b;
  }

  _activate(id) {
    if (this.scene._titleOverlayOpen?.() || this.scene.isTransitioning) return;
    this.opts.onAction(id);
  }

  _onKey(event) {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    const i = this.buttons.indexOf(document.activeElement);
    if (i < 0) return;
    event.preventDefault();
    const d = ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1;
    const next = this.buttons[(i + d + this.buttons.length) % this.buttons.length];
    next.focus();
  }

  /** Desktop: match the letterboxed 4:3 game canvas and scale the 640x480 design. */
  _fitStage() {
    if (this.destroyed || this.phone) return;
    const rect = this.scene.game?.canvas?.getBoundingClientRect?.();
    const w = rect?.width || Math.min(innerWidth, (innerHeight * 4) / 3);
    const h = rect?.height || (w * 3) / 4;
    const left = rect ? rect.left : (innerWidth - w) / 2;
    const top = rect ? rect.top : (innerHeight - h) / 2;
    Object.assign(this.root.style, {
      left: `${left}px`,
      top: `${top}px`,
      width: `${w}px`,
      height: `${h}px`,
    });
    this.root.style.setProperty('--re-title-k', String(w / DESIGN_W));
  }

  _syncCovered() {
    if (this.destroyed) return;
    const host = this.root.parentElement;
    const covered =
      !!host && [...host.children].some((el) => el !== this.root && el.matches(COVERING_SCREENS));
    this.backdrop?.setPaused(covered);
  }

  /** Pad focus highlight, driven by MenuFocusController. */
  setFocused(index, focused) {
    const b = this.buttons[index];
    if (!b) return;
    b.classList.toggle('is-focused', focused);
    if (focused && document.activeElement !== b && !this.root.inert)
      b.focus({ preventScroll: true });
  }

  setInteractive(enabled) {
    this.root.inert = !enabled;
    this.root.toggleAttribute('aria-busy', !enabled);
    // A failed transition hands focus back to the highlighted action.
    if (enabled && (!document.activeElement || document.activeElement === document.body))
      this.root.querySelector('.re-title-btn.is-focused')?.focus({ preventScroll: true });
  }

  setSoundHint(visible) {
    this.soundHint.hidden = !visible;
  }

  setCloudNotice(text) {
    this.cloudNotice.textContent = text || '';
    this.cloudNotice.hidden = !text;
  }

  setLogoutNotice(text, tone = 'info') {
    this.logoutNotice.textContent = text || '';
    this.logoutNotice.hidden = !text;
    this.logoutNotice.className = `re-title-notice is-${tone}`;
  }

  showMessage(text) {
    this.message.textContent = text || '';
    this.message.hidden = !text;
  }

  refreshMotion() {
    this.root.classList.toggle('is-still', !!this.opts.reducedMotion?.());
    this.backdrop?.refreshMotion();
  }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.backdrop?.destroy();
    this.backdrop = null;
    this._coverObserver?.disconnect();
    this._stageObserver?.disconnect();
    window.removeEventListener('resize', this._syncStage);
    this.scene.scale?.off?.('resize', this._syncStage);
    this.root.remove();
  }
}

import { element } from './MenuSurface.js';
import { applyPixelFontVariables } from '../utils/pixelFontGrid.js';
import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import { computeBackdropFrame, mountKeyArtBackdrop } from '../art/keyart/keyArtBackdrop.js';
import { PLATE_H, PLATE_W } from '../art/keyart/hollowSun.js';
import { GAME_TITLE } from '../utils/gameIdentity.js';
import { portraitListLayout, watchPortraitListLayout } from './portraitListLayout.js';

// TitleScreen — DOM title over The Hollow Sun key art (ART_BIBLE "Title").
// Owns presentation only: the lockup, the reliquary menu, corner actions, notices and
// the backdrop lifecycle. TitleScene decides which actions exist (titleMenuModel.js)
// and what they do.

const COVERING_SCREENS = '.re-screen:not(.re-title):not([hidden]), .re-modal-shield, .mu-screen';
const DESIGN_W = 640;

// ── Upright phones (portrait mode) ──
// The 424x240 plate cannot cover a tall screen and still read: covering 375x667 shows
// ~135 plate px of its width. Upright, the art is a band instead: the whole plate height
// at a whole device-pixel scale, as large as the room above the menu allows while still
// showing UPRIGHT_BAND.narrowest plate px of its width, and never so small that it shows
// more than UPRIGHT_BAND.widest (hollowSun.js keeps everything important inside x
// 52..372: the keep, the figure, the Hollow Sun). The band rests on the menu
// (title.css); the lockup keeps the upper left, as in landscape, so the sun is placed
// beside it when they share rows.
export const UPRIGHT_BAND = { widest: 300, narrowest: 215 };
// Plate anchors per variant (hollowSun.js VARIANTS and FIGURE_FEET; the portrait title
// spec checks them against the art module).
export const TITLE_ART_ANCHORS = {
  figure: { x: 172, y: 171 },
  sun: {
    dusk: { x: 292, y: 68, r: 22 },
    ashfall: { x: 292, y: 62, r: 22 },
    rising: { x: 318, y: 124, r: 40 },
  },
};

/**
 * Device-pixel scale of the upright band for a screen `width` CSS px wide, with `room`
 * CSS px from the top of the screen to where the band's lower edge rests.
 */
export function uprightArtScale(width, dpr = 1, room = Infinity) {
  const dev = Math.max(1, Math.round(width * dpr));
  const cover = Math.ceil(dev / PLATE_W - 1e-6);
  const lo = Math.max(1, cover, Math.ceil(dev / UPRIGHT_BAND.widest - 1e-6));
  const hi = Math.max(lo, Math.floor(dev / UPRIGHT_BAND.narrowest));
  const fit = Math.floor((Math.max(0, room) * dpr) / PLATE_H);
  return Math.max(lo, Math.min(hi, fit));
}

/** CSS height of the upright band: the whole plate at uprightArtScale (never over it). */
export function uprightArtHeight(width, dpr = 1, room = Infinity) {
  return Math.floor((PLATE_H * uprightArtScale(width, dpr, room)) / dpr);
}

/**
 * Where the upright band's crop starts (plate x), so the Hollow Sun is whole and clear
 * of the lockup and the lone figure stays in view. `visW` is the visible plate width,
 * `k` CSS px per plate px, `top` the plate row at the band's top edge, and `lockup`
 * the lockup's right / bottom edges in CSS px from the band's top-left corner. When
 * everything cannot fit, the title wins over the sun's far rim, and the sun over the
 * figure. Returns { sx, anchorX } for computeBackdropFrame.
 */
export function uprightArtAnchor({ visW, k, top = 0, lockup = null, sun, figure }) {
  const span = Math.max(0, PLATE_W - visW);
  if (!span) return { sx: 0, anchorX: 0.5 };
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const beside = (pad, gap) => {
    // Rows the sun (with its corona) shares with the lockup: it must start right of it.
    const sunTop = (sun.y - sun.r - pad - top) * k;
    if (!lockup || sunTop >= lockup.bottom + gap) return span;
    return sun.x - sun.r - pad - (lockup.right + gap) / k;
  };
  // Most wanted first: the plate centred, the corona whole, the figure in view.
  let sx = span / 2;
  let lo = Math.max(0, sun.x + sun.r + 6 - visW, figure.x + 12 - visW);
  let hi = Math.min(span, figure.x - 12, beside(6, 10));
  if (lo > hi) {
    // Tight: drop the corona's margin and the figure, keep the disc and the title apart.
    lo = Math.max(0, sun.x + sun.r - visW);
    hi = Math.min(span, beside(0, 4));
    if (lo > hi) lo = hi; // the title wins: the disc may run off the edge
  }
  lo = Math.max(0, lo);
  hi = Math.max(0, hi);
  // Whole plate px, rounded towards the side that keeps the title clear.
  sx = Math.round(clamp(sx, lo, hi));
  if (sx > hi) sx = Math.floor(hi);
  return { sx, anchorX: sx / span };
}

/** The key-art lockup shared by the title and the auth screen. */
export function createKeyArtLockup({ subtitle = 'The Hollow Sun', level = 'h1' } = {}) {
  const lockup = element('div', null, 're-keyart-lockup');
  const title = element(level, GAME_TITLE, 're-keyart-title');
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
    root.setAttribute('aria-label', GAME_TITLE);

    this.art = element('div', null, 're-title-art');
    const veil = element('div', null, 're-title-veil');
    veil.setAttribute('aria-hidden', 'true');
    this.stage = element('div', null, 're-title-stage');
    root.append(this.art, veil, this.stage);

    const lead = element('div', null, 're-title-lead');
    this.lockup = createKeyArtLockup();
    lead.append(this.lockup);
    // Two groups: run actions under the lockup, guides and records bottom-right.
    const run = element('div', null, 're-title-run');
    run.setAttribute('role', 'group');
    run.setAttribute('aria-label', 'Play');
    this.runGroup = run;
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

    // Phones keep a crisp integer scale (the 2x plate) even if it crops a little more.
    this.maxCrop = this.phone ? 1.3 : 1.12;
    this._syncUpright();
    this.backdrop = mountKeyArtBackdrop(this.art, {
      variant: opts.variant,
      reducedMotion: opts.reducedMotion,
      maxCrop: this.maxCrop,
      anchor: (box) => this._artAnchor(box),
    });
    if (this.phone) {
      // Upright: size the band to the screen and re-place the sun whenever the phone
      // turns, portrait mode changes, or the lockup's font arrives.
      this._onUprightResize = () => this._syncUpright();
      window.addEventListener('resize', this._onUprightResize);
      this._unwatchUpright = watchPortraitListLayout(() => this._syncUpright());
      // iOS can announce a turn before its layout settles, and send nothing once it has:
      // the band kept the sideways size, so the art stayed zoomed after turning back
      // (playtest, build 24). The screen's own size is the settled answer.
      if (typeof ResizeObserver !== 'undefined') {
        this._uprightObserver = new ResizeObserver(() => this._syncUpright());
        this._uprightObserver.observe(this.root);
      }
      document.fonts?.ready?.then(() => this._syncUpright(true));
    }

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

  /** Upright phone layout (title.css), keyed like every portrait layout. */
  _upright() {
    return this.phone && portraitListLayout();
  }

  /** Upright: the band's height for this screen; then re-frame the art if asked. */
  _syncUpright(reframe = false) {
    if (this.destroyed) return;
    let value = '';
    if (this._upright()) {
      // The band rests on the menu: its room runs from the screen's top to the first
      // run plate, plus the bleed under it.
      const top = this.root.getBoundingClientRect().top;
      const bleed = parseFloat(getComputedStyle(this.root).getPropertyValue('--rt-bleed')) || 0;
      const room = this.runGroup.getBoundingClientRect().top - top + bleed;
      value = `${uprightArtHeight(this.root.clientWidth, globalThis.devicePixelRatio || 1, room)}px`;
    }
    if (this.root.style.getPropertyValue('--rt-art-h') !== value) {
      if (value) this.root.style.setProperty('--rt-art-h', value);
      else this.root.style.removeProperty('--rt-art-h');
      reframe = true;
    }
    if (reframe) this.backdrop?.resize();
  }

  /** Backdrop crop anchor: the default framing, except the upright band (see above). */
  _artAnchor({ width, height }) {
    if (!this._upright() || !(width > 0 && height > 0)) return {};
    const dpr = globalThis.devicePixelRatio || 1;
    const frame = computeBackdropFrame({ width, height, dpr, maxCrop: this.maxCrop });
    const k = frame.scale / dpr;
    const art = this.art.getBoundingClientRect();
    const lockup = this.lockup.getBoundingClientRect();
    const sun = TITLE_ART_ANCHORS.sun[this.opts.variant] || TITLE_ART_ANCHORS.sun.dusk;
    const { anchorX } = uprightArtAnchor({
      visW: (width * dpr) / frame.scale,
      k,
      top: frame.sy,
      lockup: { right: lockup.right - art.left, bottom: lockup.bottom - art.top },
      sun,
      figure: TITLE_ART_ANCHORS.figure,
    });
    return { anchorX };
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
    const k = w / DESIGN_W;
    this.root.style.setProperty('--re-title-k', String(k));
    // The stage is transform-scaled: pick pixel-font sizes that land on whole
    // device pixels after the scale (Retina / browser zoom), not before it.
    applyPixelFontVariables(this.root, globalThis.devicePixelRatio || 1, {
      scale: k,
      prefix: '--rt-pf-',
    });
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
    this._unwatchUpright?.();
    this._uprightObserver?.disconnect();
    if (this._onUprightResize) window.removeEventListener('resize', this._onUprightResize);
    window.removeEventListener('resize', this._syncStage);
    this.scene.scale?.off?.('resize', this._syncStage);
    this.root.remove();
  }
}

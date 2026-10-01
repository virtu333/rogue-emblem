// infoAffordance — the compact "explain this" pattern for DOM cards.
//
// Replaces the full-width "About …" buttons: a card keeps its heading and data,
// and its explanation is one gesture away:
//   - a small ⓘ in the heading: a real <button> with an aria-label (Tab/Enter/
//     Space work), a 44px hit area around a small glyph;
//   - press and hold anywhere on the card (touch and pen) opens the same text;
//   - on hover-capable pointers the ⓘ shows the first line as a tooltip.
// A one-time tip teaches the hold gesture on touch devices. Presentation only:
// callers decide what opens (their existing ContextHelp flow), so input scopes,
// ESC stacking and focus return are unchanged.

const TIP_KEY = 'emblem_rogue_tip_hold_info';
export const INFO_HOLD_MS = 450;
const MOVE_SLOP = 10;
let tipId = 0;

function readTipSeen() {
  try {
    return localStorage.getItem(TIP_KEY) === '1';
  } catch {
    return true; // storage blocked: never nag
  }
}
function markTipSeen() {
  try {
    localStorage.setItem(TIP_KEY, '1');
  } catch {
    /* optional */
  }
}

function coarsePointer() {
  try {
    return (
      document.documentElement.classList.contains('touch-ui') ||
      Boolean(globalThis.matchMedia?.('(pointer: coarse)').matches)
    );
  } catch {
    return false;
  }
}

function hoverPointer() {
  try {
    return Boolean(globalThis.matchMedia?.('(hover: hover)').matches);
  } catch {
    return false;
  }
}

function reducedMotion() {
  try {
    return Boolean(globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
  } catch {
    return false;
  }
}

/**
 * Press-and-hold on a non-interactive surface. Touch and pen only (a mouse has
 * the ⓘ and hover); a hold that starts on a nested control is ignored so the
 * card's own buttons keep their meaning. Moving more than a few pixels (a
 * scroll) cancels. Returns an unbind function.
 */
export function bindHold(
  surface,
  onHold,
  {
    holdMs = INFO_HOLD_MS,
    enabled = () => true,
    ignore = 'button, summary, select, a, input',
  } = {},
) {
  let press = null;
  const clear = () => {
    if (!press) return;
    clearTimeout(press.timer);
    surface.classList.remove('is-holding');
    press = null;
  };
  const down = (event) => {
    clear();
    if (event.pointerType === 'mouse' || event.isPrimary === false) return;
    if (event.button != null && event.button !== 0) return;
    if (ignore && event.target?.closest?.(ignore) && event.target.closest(ignore) !== surface)
      return;
    if (!enabled()) return;
    press = { id: event.pointerId, x: event.clientX, y: event.clientY, fired: false };
    surface.classList.add('is-holding');
    press.timer = setTimeout(() => {
      if (!press || !surface.isConnected || !enabled()) return clear();
      press.fired = true;
      surface.classList.remove('is-holding');
      onHold(event);
    }, holdMs);
  };
  const move = (event) => {
    if (!press || press.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_SLOP) clear();
  };
  const up = (event) => {
    if (!press || press.id !== event.pointerId) return;
    const fired = press.fired;
    clear();
    // Swallow the click that follows a completed hold so nothing else activates.
    if (fired) {
      const swallow = (e) => {
        e.preventDefault();
        e.stopPropagation();
      };
      surface.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => surface.removeEventListener('click', swallow, { capture: true }), 400);
    }
  };
  // iOS/Android long-press callouts would fight the gesture.
  const menu = (event) => {
    if (press || surface.classList.contains('has-hold')) event.preventDefault();
  };
  surface.classList.add('has-hold');
  const listeners = {
    pointerdown: down,
    pointermove: move,
    pointerup: up,
    pointercancel: clear,
    pointerleave: clear,
    contextmenu: menu,
  };
  for (const [name, fn] of Object.entries(listeners)) surface.addEventListener(name, fn);
  return () => {
    clear();
    surface.classList.remove('has-hold');
    for (const [name, fn] of Object.entries(listeners)) surface.removeEventListener(name, fn);
  };
}

const HOVER_SHOW_MS = 280;
// A short grace on leaving, so sliding between neighbouring targets doesn't flicker.
const HOVER_HIDE_MS = 100;
const DEFAULT_FOOTER = 'Click ⓘ for more';
/** Mouse and trackpad only: touch and gamepad keep their own gestures. */
export const FINE_HOVER_MEDIA = '(hover: hover) and (pointer: fine)';

function matches(media) {
  try {
    return Boolean(globalThis.matchMedia?.(media).matches);
  } catch {
    return false;
  }
}

function previewText(content) {
  if (content == null || content === false) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(previewText).join(' ');
  return content.textContent || '';
}

/**
 * Hover/keyboard-focus preview for any control. A manual popover renders in the top
 * layer, so no z-index or clipping ancestor (chamfers, scroll panes) can cut it;
 * browsers without the Popover API fall back to the native title tooltip. The popover
 * never takes pointer events, so it cannot swallow the click it describes.
 *
 * @param {HTMLElement} target
 * @param {() => (string|Node|Node[]|{content: string|Node|Node[], footer?: string}|null)} contentFn
 *   read each time the preview is about to open; null/'' skips this time (e.g. a
 *   disclosure that is already open). An object may carry its own `footer`.
 * @param {object} [options]
 * @param {string} [options.footer] the line under the content ('' for none)
 * @param {string} [options.media] pointer media query that must match (checked at
 *   event time, so a touch-only device never sees a preview)
 * @param {'start'|'end'} [options.align] which edge of the target the popover lines up with
 * @returns {HTMLElement|null} the popover element, or null without the Popover API
 */
export function bindHoverPreview(
  target,
  contentFn,
  { footer = DEFAULT_FOOTER, media = '(hover: hover)', align = 'end' } = {},
) {
  const tip = document.createElement('span');
  tip.className = 're-info-tip';
  tip.setAttribute('role', 'tooltip');
  tip.id = `re-info-tip-${++tipId}`;
  if (typeof tip.showPopover !== 'function') {
    const text = previewText(contentFn());
    if (text) target.title = text;
    return null;
  }
  tip.popover = 'manual';
  target.setAttribute('aria-describedby', tip.id);
  let showTimer = null;
  let hideTimer = null;
  const place = () => {
    const r = target.getBoundingClientRect();
    const width = Math.min(280, globalThis.innerWidth - 16);
    tip.style.width = `${width}px`;
    const preferred = align === 'start' ? r.left : r.right - width;
    const left = Math.max(8, Math.min(globalThis.innerWidth - width - 8, preferred));
    tip.style.left = `${left}px`;
    const below = r.bottom + 6;
    tip.style.top = `${below}px`;
    const height = tip.getBoundingClientRect().height;
    if (below + height > globalThis.innerHeight - 8)
      tip.style.top = `${Math.max(8, r.top - height - 6)}px`;
  };
  const open = () => {
    if (!target.isConnected || tip.matches?.(':popover-open') || !matches(media)) return;
    const raw = contentFn();
    const resolved = raw && typeof raw === 'object' && 'content' in raw ? raw : { content: raw };
    const content = resolved.content;
    if (!content || (Array.isArray(content) && !content.length)) return;
    // A disclosure's own content is hidden while it is closed, so the popover sits
    // beside the whole disclosure, never inside it.
    if (!tip.isConnected) (target.closest('details') || target).after(tip);
    if (typeof content === 'string') tip.textContent = content;
    else tip.replaceChildren(...[content].flat());
    tip.dataset.footer = resolved.footer ?? footer;
    try {
      tip.showPopover();
      place();
    } catch {
      /* detached or unsupported in this context */
    }
  };
  const show = () => {
    clearTimeout(hideTimer);
    clearTimeout(showTimer);
    showTimer = setTimeout(open, HOVER_SHOW_MS);
  };
  const close = () => {
    clearTimeout(showTimer);
    try {
      if (tip.matches?.(':popover-open')) tip.hidePopover();
    } catch {
      /* already closed */
    }
  };
  const hide = ({ immediate = true } = {}) => {
    clearTimeout(showTimer);
    clearTimeout(hideTimer);
    if (immediate) close();
    else hideTimer = setTimeout(close, HOVER_HIDE_MS);
  };
  target.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse' && matches(media)) show();
  });
  target.addEventListener('pointerleave', () => hide({ immediate: false }));
  target.addEventListener('focus', () => {
    if (target.matches(':focus-visible') && matches(media)) show();
  });
  target.addEventListener('blur', () => hide());
  target.addEventListener('click', () => hide());
  target.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hide();
  });
  return tip;
}

/**
 * Give `card` a compact explanation affordance.
 * @param {HTMLElement} card      the card (receives the hold gesture)
 * @param {object} options
 * @param {string} options.title  topic name, used for the ⓘ label ("About <title>")
 * @param {() => void} options.open  opens the explanation (e.g. ContextHelp)
 * @param {string} [options.preview] first line shown as a hover tooltip
 * @param {HTMLElement} [options.heading] where the ⓘ goes (defaults to the first h3/h4)
 * @param {() => boolean} [options.enabled]
 * @param {(button: HTMLButtonElement) => void} [options.decorate] e.g. bind cancelable press
 * @returns {HTMLButtonElement} the ⓘ button
 */
export function attachInfo(card, { title, open, preview = '', heading, enabled, decorate } = {}) {
  const head = heading || card.querySelector('h3, h4, h2');
  const info = document.createElement('button');
  info.type = 'button';
  info.className = 're-info-btn';
  info.setAttribute('aria-label', `About ${title}`);
  const glyph = document.createElement('span');
  glyph.className = 're-info-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = 'i';
  info.append(glyph);
  const tip = preview && hoverPointer() ? bindHoverPreview(info, () => preview) : null;
  if (decorate) decorate(info);
  else info.addEventListener('click', () => open());
  if (head) {
    head.classList.add('re-info-heading');
    head.append(info);
  } else card.prepend(info);
  if (tip) info.after(tip);
  card.classList.add('re-info-card');
  bindHold(
    card,
    () => {
      markTipSeen();
      open();
    },
    { enabled },
  );
  return info;
}

/**
 * One-time teaching line for the hold gesture, shown on touch devices the first
 * time a surface with explainable cards opens. Returns the element or null.
 */
export function holdTip(text = 'Tip: press and hold a card, or tap ⓘ, to see what it means.') {
  if (!coarsePointer() || readTipSeen()) return null;
  markTipSeen();
  const tip = document.createElement('p');
  tip.className = 're-hold-tip';
  tip.setAttribute('role', 'note');
  const glyph = document.createElement('span');
  glyph.className = 're-info-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = 'i';
  tip.append(glyph, document.createTextNode(` ${text}`));
  if (!reducedMotion()) tip.classList.add('is-arriving');
  return tip;
}

/** Test hook: forget the one-time tip. */
export function resetHoldTip() {
  try {
    localStorage.removeItem(TIP_KEY);
  } catch {
    /* optional */
  }
}

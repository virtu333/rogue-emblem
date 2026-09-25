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

// Hover/keyboard-focus preview. A manual popover renders in the top layer, so no
// z-index or clipping ancestor (chamfers, scroll panes) can cut it; browsers
// without the Popover API fall back to the native title tooltip.
function bindPreview(info, text) {
  const tip = document.createElement('span');
  tip.className = 're-info-tip';
  tip.setAttribute('role', 'tooltip');
  tip.id = `re-info-tip-${++tipId}`;
  tip.textContent = text;
  const supported = typeof tip.showPopover === 'function';
  if (!supported) {
    info.title = text;
    return null;
  }
  tip.popover = 'manual';
  info.setAttribute('aria-describedby', tip.id);
  let timer = null;
  const place = () => {
    const r = info.getBoundingClientRect();
    const width = Math.min(280, globalThis.innerWidth - 16);
    tip.style.width = `${width}px`;
    const left = Math.max(8, Math.min(globalThis.innerWidth - width - 8, r.right - width));
    tip.style.left = `${left}px`;
    const below = r.bottom + 6;
    tip.style.top = `${below}px`;
    const height = tip.getBoundingClientRect().height;
    if (below + height > globalThis.innerHeight - 8)
      tip.style.top = `${Math.max(8, r.top - height - 6)}px`;
  };
  const show = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!info.isConnected || tip.matches?.(':popover-open')) return;
      if (!tip.isConnected) info.after(tip);
      try {
        tip.showPopover();
        place();
      } catch {
        /* detached or unsupported in this context */
      }
    }, 280);
  };
  const hide = () => {
    clearTimeout(timer);
    try {
      if (tip.matches?.(':popover-open')) tip.hidePopover();
    } catch {
      /* already closed */
    }
  };
  info.addEventListener('pointerenter', (event) => {
    if (event.pointerType === 'mouse') show();
  });
  info.addEventListener('pointerleave', hide);
  info.addEventListener('focus', () => {
    if (info.matches(':focus-visible')) show();
  });
  info.addEventListener('blur', hide);
  info.addEventListener('click', hide);
  info.addEventListener('keydown', (event) => {
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
  const tip = preview && hoverPointer() ? bindPreview(info, preview) : null;
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

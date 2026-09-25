// GuidanceNote — a one-time, non-blocking field note docked over the map.
//
// Unlike the modal "Field notes" dialog, this never takes input from the game:
// only the note itself receives pointer events, it has no backdrop, and it steps
// aside on its own. It is marked read (HintManager) when the player taps "Got it"
// or after it stayed visible long enough to read; a note that was hidden or cut
// short stays unread so a later moment can teach it. "Fewer tips" drops the
// Guidance setting to Light.
//
// Presentation only: no game state, no RNG, no timers that outlive the scene.

import { DOM_INPUT_EVENTS, hasDOMHost } from '../utils/domUI.js';
import { hintReadingPolicy } from './HintDisplay.js';
import { measureFrame } from './ceremonyDom.js';
import './guidance.css';

function intersect(a, b) {
  if (!a || !b) return a || b;
  const left = Math.max(a.left, b.left);
  const top = Math.max(a.top, b.top);
  const right = Math.min(a.left + a.width, b.left + b.width);
  const bottom = Math.min(a.top + a.height, b.top + b.height);
  // Too small to hold a note: fall back to the whole frame.
  if (right - left < 220 || bottom - top < 110) return a;
  return { left, top, width: right - left, height: bottom - top };
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Show a note. Returns a handle { id, close(read), root } or null when there is no
 * DOM host. `anchor` (CSS px point on screen) and `avoid` (points, or a function
 * returning them) are kept clear of the note.
 */
export function showGuidanceNote(
  scene,
  {
    id,
    text,
    onRead,
    onFewerTips,
    anchor = null,
    avoid = null,
    bounds = null,
    reduceMotion = false,
  } = {},
) {
  if (!hasDOMHost() || !text) return null;
  const wrapper = document.getElementById('game-wrapper');
  const root = el('aside', 're re-guide');
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-label', 'Field note');
  root.dataset.guide = id;
  if (reduceMotion) root.classList.add('re-guide--still');
  // The plate is click-through (CSS); its buttons must not reach the map.
  for (const type of DOM_INPUT_EVENTS)
    root.addEventListener(type, (e) => {
      if (e.target.closest?.('button')) e.stopPropagation();
    });
  root.addEventListener('keydown', (e) => e.stopPropagation());
  root.addEventListener('keyup', (e) => e.stopPropagation());

  const kicker = el('span', 're-guide-kicker', 'Field note');
  const body = el('p', 're-guide-text', text);
  const actions = el('div', 're-guide-actions');
  const ok = el('button', 're-guide-btn re-guide-ok', 'Got it');
  ok.type = 'button';
  actions.append(ok);
  let fewer = null;
  if (onFewerTips) {
    fewer = el('button', 're-guide-btn re-guide-quiet', 'Fewer tips');
    fewer.type = 'button';
    fewer.setAttribute('aria-label', 'Fewer tips: set Guidance to Light');
    actions.append(fewer);
  }
  root.append(kicker, body, actions);
  wrapper?.append(root);

  const policy = hintReadingPolicy(text);
  let closed = false;
  let visibleSince = null;
  let read = false;
  let hovering = false;

  // Dock in the corner of the map that covers the fewest of the points to keep
  // clear (the anchor counts triple): never over the unit the note talks about.
  const place = () => {
    const frame = measureFrame(scene, 'map');
    // Prefer the battlefield itself (desktop HUD plates sit around it).
    const area = typeof bounds === 'function' ? bounds() : bounds;
    const rect = area ? intersect(frame, area) : frame;
    if (!rect || rect.width < 1) return;
    const inset = 8;
    const width = Math.min(340, Math.max(200, rect.width * 0.62));
    root.style.width = `${Math.round(width)}px`;
    const height = root.offsetHeight || 90;
    const left = rect.left + inset;
    const right = rect.left + rect.width - width - inset;
    const top = rect.top + inset;
    const bottom = rect.top + rect.height - height - inset;
    const points = [
      ...(anchor ? [anchor, anchor, anchor] : []),
      ...((typeof avoid === 'function' ? avoid() : avoid) || []),
    ].filter(Boolean);
    const pad = 20; // a unit's sprite reaches ~half a tile around its centre
    let best = null;
    for (const [x, y] of [
      [left, top],
      [right, top],
      [left, bottom],
      [right, bottom],
    ]) {
      const covered = points.filter(
        (p) => p.x > x - pad && p.x < x + width + pad && p.y > y - pad && p.y < y + height + pad,
      ).length;
      if (!best || covered < best.covered) best = { x, y, covered };
    }
    root.style.left = `${Math.round(Math.max(0, best.x))}px`;
    root.style.top = `${Math.round(Math.max(0, best.y))}px`;
  };

  const markRead = () => {
    if (read) return;
    read = true;
    onRead?.();
  };
  const tick = () => {
    if (closed) return;
    const shown =
      root.isConnected &&
      document.visibilityState !== 'hidden' &&
      getComputedStyle(root).display !== 'none';
    if (!shown) visibleSince = null;
    else if (visibleSince === null) visibleSince = Date.now();
    else if (Date.now() - visibleSince >= policy.duration) markRead();
    // Step aside once read and left alone for a while.
    if (read && !hovering && !root.contains(document.activeElement)) {
      if (Date.now() - (visibleSince ?? Date.now()) >= policy.duration * 2) close(true);
    }
  };
  const timer = setInterval(tick, 200);
  root.addEventListener('pointerenter', () => (hovering = true));
  root.addEventListener('pointerleave', () => (hovering = false));
  const onResize = () => place();
  window.addEventListener('resize', onResize);
  const shutdown = () => close(false);
  scene.events?.once?.('shutdown', shutdown);

  function close(acknowledged = false) {
    if (closed) return;
    closed = true;
    if (acknowledged) markRead();
    clearInterval(timer);
    window.removeEventListener('resize', onResize);
    scene.events?.off?.('shutdown', shutdown);
    root.remove();
    handle.onClose?.(read);
  }
  ok.addEventListener('click', () => close(true));
  fewer?.addEventListener('click', () => {
    onFewerTips?.();
    close(true);
  });

  place();
  requestAnimationFrame?.(place);
  const handle = { id, root, close, isRead: () => read, onClose: null };
  return handle;
}

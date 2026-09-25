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
import './guidance.css';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * Show a note. Returns a handle { id, close(read), root } or null when there is no
 * DOM host. `anchor` (CSS px point on screen) keeps the note away from it.
 */
export function showGuidanceNote(
  scene,
  { id, text, onRead, onFewerTips, anchor = null, reduceMotion = false } = {},
) {
  if (!hasDOMHost() || !text) return null;
  const wrapper = document.getElementById('game-wrapper');
  const root = el('aside', 're re-guide');
  root.setAttribute('role', 'status');
  root.setAttribute('aria-live', 'polite');
  root.setAttribute('aria-label', 'Field note');
  root.dataset.guide = id;
  if (reduceMotion) root.classList.add('re-guide--still');
  for (const type of DOM_INPUT_EVENTS) root.addEventListener(type, (e) => e.stopPropagation());
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
  const canvas = scene.game?.canvas;

  const place = () => {
    const rect = canvas?.getBoundingClientRect?.();
    if (!rect || rect.width < 1) return;
    const inset = 8;
    const width = Math.min(340, Math.max(200, rect.width - inset * 2));
    root.style.width = `${Math.round(width)}px`;
    // Dock at the top of the map, on the side away from the anchor.
    const midX = rect.left + rect.width / 2;
    const right = anchor && anchor.x < midX;
    const top = Math.max(rect.top, 0) + inset;
    root.style.top = `${Math.round(top)}px`;
    root.style.left = right
      ? `${Math.round(Math.min(rect.right, window.innerWidth) - width - inset)}px`
      : `${Math.round(Math.max(rect.left, 0) + inset)}px`;
    // If the anchor sits under the note's band, drop to the bottom of the map.
    const noteH = root.offsetHeight || 90;
    if (anchor && anchor.y < top + noteH + 12) {
      root.style.top = `${Math.round(Math.min(rect.bottom, window.innerHeight) - noteH - inset)}px`;
    }
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

import { DOM_INPUT_EVENTS } from './domUI.js';
import { pushInputScope, popInputScope } from './inputFocus.js';
import { InputAction } from './InputActions.js';

// Holding a commit/cancel key must not act again on the next menu that gets
// focus. Arrow repeat remains useful; typed text keeps its native behavior.
export function ignoreRepeatedActivation(event) {
  const editing = event.target?.matches?.('input, textarea, select, [contenteditable="true"]');
  if (
    !event.repeat ||
    !['Enter', ' ', 'Escape'].includes(event.key) ||
    (editing && event.key !== 'Escape')
  )
    return false;
  event.preventDefault();
  event.stopPropagation();
  return true;
}

// For standalone DOM surfaces that do not use MenuSurface. No preventDefault:
// native scrolling, focus, text selection and button activation keep working.
export function isolateDOMInput(root, { keyboard = false } = {}) {
  const events = keyboard ? [...DOM_INPUT_EVENTS, 'keydown', 'keyup'] : DOM_INPUT_EVENTS;
  const stop = (event) => event.stopPropagation();
  for (const name of events) root?.addEventListener?.(name, stop);
  return () => {
    for (const name of events) root?.removeEventListener?.(name, stop);
  };
}

// A drag that starts on the canvas and ends over DOM is cancellation, not a
// click on either surface. Observe it before a menu stops propagation, otherwise
// Phaser never receives mouseup and keeps its pointer held. Touch releases stay
// targeted at their original canvas and already reach the normal cancel routing.
export function installDOMDragRelease(game, target = document) {
  const release = (event) => {
    const pointer = game.input?.mousePointer;
    if (event.target === game.canvas || !pointer?.isDown || pointer.downElement !== game.canvas)
      return;
    pointer.reset();
    for (const scene of game.scene?.getScenes?.(true) || [])
      scene.input?.emit('pointerupoutside', pointer, []);
    event.stopPropagation();
  };
  target.addEventListener('mouseup', release, true);
  const cleanup = () => target.removeEventListener('mouseup', release, true);
  game.events.once('destroy', cleanup);
  return cleanup;
}

// Recovery is deliberately non-dismissible: Cancel must not revive a failed
// game. It still owns keyboard and controller focus, including outside its card.
export function ownRecoveryInput(root, documentRef = document) {
  if (!root?.addEventListener) return () => {};
  const previousFocus = documentRef.activeElement;
  const wrapper = documentRef.getElementById('game-wrapper');
  const wasInert = wrapper?.inert;
  if (wrapper) wrapper.inert = true;
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Game recovery');
  root.tabIndex = -1;
  const cleanupEvents = isolateDOMInput(root, { keyboard: true });
  const controls = () => [...root.querySelectorAll('button:not(:disabled)')];
  const move = (delta) => {
    const items = controls();
    const i = items.indexOf(documentRef.activeElement);
    (items[(i + delta + items.length) % items.length] || root).focus();
  };
  const keydown = (event) => {
    if (ignoreRepeatedActivation(event)) return;
    if (event.key === 'Tab' || event.key.startsWith('Arrow')) {
      event.preventDefault();
      move(event.shiftKey || ['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1);
    } else if (event.key === 'Escape') event.preventDefault();
  };
  root.addEventListener('keydown', keydown);
  const outsideKey = (event) => {
    if (root.contains(event.target)) return;
    event.stopPropagation();
    event.preventDefault();
    root.focus();
    if (event.type === 'keydown') keydown(event);
  };
  documentRef.addEventListener('keydown', outsideKey, true);
  documentRef.addEventListener('keyup', outsideKey, true);
  pushInputScope(root, (action, payload) => {
    if (action === InputAction.NAVIGATE) move(payload?.dy || payload?.dx || 1);
    if (action === InputAction.CONFIRM && root.contains(documentRef.activeElement))
      documentRef.activeElement.click();
  });
  (controls()[0] || root).focus();
  let released = false;
  return () => {
    if (released) return;
    released = true;
    cleanupEvents();
    root.removeEventListener('keydown', keydown);
    documentRef.removeEventListener('keydown', outsideKey, true);
    documentRef.removeEventListener('keyup', outsideKey, true);
    popInputScope(root);
    if (wrapper) wrapper.inert = wasInert;
    if (previousFocus?.isConnected) previousFocus.focus();
  };
}

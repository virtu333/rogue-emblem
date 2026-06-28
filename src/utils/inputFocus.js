// LIFO input-focus stack for the device-independent action bus.
//
// The global gamepad reader (GamepadReader.js) emits InputActions onto a single
// game.events channel that EVERY listener would otherwise receive. That is wrong
// when an overlay is open over a base scene: one button press would drive both the
// overlay AND the scene behind it. This stack fixes that the same way overlayStack.js
// fixes ESC — only the *topmost* scope receives a dispatched action.
//
// Each scene/overlay registers a scope (an owner + a handler) when it gains input
// focus and removes it when it loses focus. A base scene pushes its scope in
// create(); an overlay opened later pushes on top and transparently captures the
// pad until it closes and pops, restoring the scene's scope. There is no
// fall-through: if the top scope ignores an action, nothing else sees it (matching
// overlayStack's "topmost owns it" semantics).
//
// main.js bridges the bus to this module with a single
//   game.events.on(INPUT_ACTION_EVENT, dispatchInputAction)
// so this module stays Phaser-free and exhaustively unit-testable.

const _stack = []; // [{ owner, handler, onTopChange }] — last element is the active scope

function _top() {
  return _stack.length ? _stack[_stack.length - 1] : null;
}

// Fire onTopChange(false) on the scope losing the top, then onTopChange(true) on
// the one gaining it. Lets a covered scope dim/hide its focus ring and restore it
// when re-exposed, without each pusher knowing what it covered.
function _notifyTopChange(prevEntry, nextEntry) {
  if (prevEntry === nextEntry) return;
  if (prevEntry?.onTopChange) prevEntry.onTopChange(false);
  if (nextEntry?.onTopChange) nextEntry.onTopChange(true);
}

/**
 * Deliver an action to the topmost scope only. No-op if the stack is empty.
 * @param {string} action  an InputAction value
 * @param {object} [payload]
 */
export function dispatchInputAction(action, payload) {
  const top = _stack[_stack.length - 1];
  if (top) top.handler(action, payload);
}

/**
 * Claim input focus. If `owner` already has a scope, its handler is replaced in
 * place (so a re-render can swap the closure without re-ordering the stack).
 * @param {*} owner  a stable identity (the scene or overlay instance)
 * @param {(action: string, payload?: object) => void} handler
 * @param {(isTop: boolean) => void} [onTopChange]  notified when this scope is
 *   covered (false) or re-exposed (true) on the stack.
 */
export function pushInputScope(owner, handler, onTopChange = null) {
  if (typeof handler !== 'function') return;
  const existing = _stack.find((s) => s.owner === owner);
  if (existing) {
    existing.handler = handler;
    if (onTopChange !== null) existing.onTopChange = onTopChange;
    return;
  }
  const prev = _top();
  const entry = { owner, handler, onTopChange: onTopChange || null };
  _stack.push(entry);
  _notifyTopChange(prev, entry);
}

/**
 * Release input focus for `owner`, wherever it sits in the stack. Safe to call
 * more than once (idempotent) and regardless of scene/overlay teardown order.
 */
export function popInputScope(owner) {
  const idx = _stack.findIndex((s) => s.owner === owner);
  if (idx === -1) return;
  const wasTop = idx === _stack.length - 1;
  const removed = _stack[idx];
  _stack.splice(idx, 1);
  if (wasTop) _notifyTopChange(removed, _top());
}

/** The owner of the active (topmost) scope, or null. */
export function activeInputOwner() {
  return _stack.length ? _stack[_stack.length - 1].owner : null;
}

/** Whether `owner` currently holds the topmost scope. */
export function hasInputFocus(owner) {
  return _stack.length > 0 && _stack[_stack.length - 1].owner === owner;
}

/** Test/teardown helper: clear the whole stack. */
export function _resetInputFocus() {
  _stack.length = 0;
}

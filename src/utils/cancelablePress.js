import { ignoreRepeatedActivation } from './domInputBoundary.js';

// Native click supplies keyboard/accessibility activation. Pointer releases are
// accepted only for the same visible control/context that received the press.
export function bindCancelablePress(
  element,
  activate,
  {
    enabled = () => true,
    context = () => null,
    threshold = 10,
    onLongPress = null,
    holdMs = 550,
  } = {},
) {
  let press = null;
  let canceled = false;
  let timer = null;
  const clearHold = () => {
    clearTimeout(timer);
    timer = null;
  };
  const available = () =>
    element.isConnected &&
    !element.disabled &&
    !element.closest('[hidden], [inert]') &&
    element.getClientRects().length > 0 &&
    getComputedStyle(element).visibility !== 'hidden' &&
    enabled();
  const inside = (event) => {
    const r = element.getBoundingClientRect();
    return (
      event.clientX >= r.left &&
      event.clientX <= r.right &&
      event.clientY >= r.top &&
      event.clientY <= r.bottom
    );
  };
  const down = (event) => {
    clearHold();
    canceled =
      !available() || event.isPrimary === false || (event.button != null && event.button !== 0);
    press = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      context: context(),
      threshold: typeof threshold === 'function' ? threshold(event) : threshold,
    };
    if (!canceled && onLongPress)
      timer = setTimeout(() => {
        timer = null;
        if (!press || canceled || !available() || context() !== press.context) return;
        canceled = true; // Consume the eventual click; never also toggle the tap action.
        onLongPress(event);
      }, holdMs);
  };
  const move = (event) => {
    if (!press || press.id !== event.pointerId) return;
    if (
      Math.hypot(event.clientX - press.x, event.clientY - press.y) > press.threshold ||
      !inside(event)
    ) {
      canceled = true;
      clearHold();
    }
  };
  const up = (event) => {
    if (!press || press.id !== event.pointerId) return;
    clearHold();
    move(event);
    if (!available() || context() !== press.context) canceled = true;
    press = null;
  };
  const cancel = () => {
    clearHold();
    canceled = true;
    press = null;
  };
  const click = (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!available() || (event.detail !== 0 && (canceled || press))) return;
    activate(event);
  };
  const listeners = {
    keydown: ignoreRepeatedActivation,
    pointerdown: down,
    pointermove: move,
    pointerup: up,
    pointercancel: cancel,
    pointerleave: () => {
      if (press) cancel();
    },
    lostpointercapture: () => {
      if (press) cancel();
    },
    click,
  };
  for (const [name, handler] of Object.entries(listeners)) element.addEventListener(name, handler);
  return () => {
    cancel();
    for (const [name, handler] of Object.entries(listeners))
      element.removeEventListener(name, handler);
  };
}

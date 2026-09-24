import { inputHint } from './inputHint.js';

export function hasDOMHost() {
  return typeof document !== 'undefined' && !!document.getElementById('game-wrapper')?.append;
}

// Input modality is reserved for the compact battle HUD. Menus use hasDOMHost.
export function canUseTouchUI(scene) {
  return hasDOMHost() && inputHint(scene, false, true);
}

// Phaser listens to legacy touch/mouse events on window as well as the canvas.
// Stopping only pointer events lets DOM menu taps activate covered game objects.
// Bubble-phase isolation preserves native scrolling, focus and button clicks.
export const DOM_INPUT_EVENTS = Object.freeze([
  'pointerdown',
  'pointerup',
  'pointermove',
  'pointercancel',
  'mousedown',
  'mouseup',
  'mousemove',
  'touchstart',
  'touchend',
  'touchmove',
  'touchcancel',
  'click',
  'wheel',
]);

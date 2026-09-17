import { isTouchPointer } from '../utils/runtimeFlags.js';

// Canvas menus scale with the viewport. Express touch targets in screen pixels.
export function mobileTarget(scene, fallback = 30) {
  if (!scene.registry?.get?.('startupFlags')?.isMobile) return fallback;
  const canvas = scene.game?.canvas;
  const rect = canvas?.getBoundingClientRect?.();
  const scale = rect?.height / (scene.scale?.height || 480);
  return Math.ceil(44 / (scale > 0 ? Math.min(scale, 1) : 0.75));
}

// A swipe through a list must never sell an item or choose a recipient.
// Desktop and gamepad continue invoking the original command immediately.
export function deferTouchActivation(target) {
  if (!target?.input?.enabled || target._touchActivationDeferred) return;
  const commands = target.listeners('pointerdown');
  if (!commands.length) return;
  target._touchActivationDeferred = true;
  target.removeAllListeners('pointerdown');
  let start;
  const invoke = (pointer) => commands.forEach((fn) => fn.call(target, pointer));
  target.on('pointerdown', (pointer) => {
    if (isTouchPointer(pointer)) start = { x: pointer.x, y: pointer.y };
    else invoke(pointer);
  });
  target.on('pointerup', (pointer) => {
    const origin = start;
    start = null;
    if (!origin || !isTouchPointer(pointer)) return;
    if (Math.hypot(pointer.x - origin.x, pointer.y - origin.y) <= 8) invoke(pointer);
  });
  target.on('pointerout', () => {
    start = null;
  });
}

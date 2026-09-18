import { inputHint } from './inputHint.js';

export function hasDOMHost() {
  return typeof document !== 'undefined' && !!document.getElementById('game-wrapper')?.append;
}

export function canUseTouchUI(scene) {
  return hasDOMHost() && inputHint(scene, false, true);
}

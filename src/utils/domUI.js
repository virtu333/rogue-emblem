import { inputHint } from './inputHint.js';

export function hasDOMHost() {
  return typeof document !== 'undefined' && !!document.getElementById('game-wrapper')?.append;
}

// Input modality is reserved for the compact battle HUD. Menus use hasDOMHost.
export function canUseTouchUI(scene) {
  return hasDOMHost() && inputHint(scene, false, true);
}

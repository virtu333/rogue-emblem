import { createSeededRng } from '../engine/BlessingEngine.js';

// Phaser Text's internal UUID generation must not consume the battle RNG.
// Only the synchronous factory runs in this scope; no gameplay or await here.
const uuidRandom = createSeededRng(0x74657874);
export function presentationText(scene, ...args) {
  const previous = Math.random;
  try {
    Math.random = uuidRandom;
    return scene.add.text(...args);
  } finally {
    Math.random = previous;
  }
}

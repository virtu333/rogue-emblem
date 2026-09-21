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

// Cover legacy canvas widgets created while battle owns Math.random too.
// This is scoped to one scene factory and restored on battle shutdown.
export function isolateBattleTextFactory(scene) {
  const factory = scene.add;
  if (!factory?.text) return () => {};
  const original = factory.text;
  const isolated = function (...args) {
    const previous = Math.random;
    try {
      Math.random = uuidRandom;
      return original.apply(this, args);
    } finally {
      Math.random = previous;
    }
  };
  factory.text = isolated;
  return () => {
    if (factory.text === isolated) factory.text = original;
  };
}

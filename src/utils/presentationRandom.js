import { createSeededRng } from '../engine/BlessingEngine.js';

// During a battle Math.random IS the battle RNG (BattleScene.installBattleRng).
// Presentation code that builds Phaser objects must never advance it: Phaser draws
// UUIDs and random values from Math.random internally. Run such construction inside
// this scope so the gameplay stream is untouched. Synchronous only — no awaits.
const presentationRng = createSeededRng(0x61746d6f);

export function withPresentationRandom(fn) {
  const previous = Math.random;
  try {
    Math.random = presentationRng;
    return fn();
  } finally {
    Math.random = previous;
  }
}

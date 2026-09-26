// Stateful version of the existing Mulberry32 stream. Capture/restore/peek do
// not advance it. Presentation and history identifiers never select its state.
export function isBattleRngState(value) {
  return (
    value?.algorithm === 'mulberry32-v1' &&
    Number.isInteger(value.cursor) &&
    value.cursor >= 0 &&
    value.cursor <= 0xffffffff
  );
}

export function createBattleRng(seed, saved = null) {
  let cursor = isBattleRngState(saved) ? saved.cursor : seed >>> 0;
  const random = () => {
    cursor = (cursor + 0x6d2b79f5) >>> 0;
    let value = Math.imul(cursor ^ (cursor >>> 15), 1 | cursor);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  random.getState = () => ({ algorithm: 'mulberry32-v1', cursor });
  return random;
}

export function keyedBattleRandom(seed, key) {
  let hash = (2166136261 ^ (seed >>> 0)) >>> 0;
  for (const char of String(key)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return createBattleRng(hash);
}

// Ambient randomness: Math.random at the moment of the draw. During a battle
// that is the battle RNG installed by BattleScene.installBattleRng, so paths
// that still draw it keep the saved stream. It is only the default generator
// for callers that do not hold one yet (enemy combat, the headless harness,
// sims, tests) and the legacy-v1 compatibility policy below. A migrated path
// is handed its generator and never falls back here (eslint.config.js).
export function ambientRandom() {
  return Math.random();
}

// The generator a player attack draws from, Confirm through resolveCombat and
// every nested skill, affix, weapon-art and imbue roll (compression plan step 3).
// fixed-v1: the battle RNG itself, passed explicitly: same algorithm, cursor
// and draw order as the global install, but rendering cannot reach it.
// legacy-v1 compatibility: a battle saved under the legacy policy keeps
// drawing ambient Math.random exactly as when it was saved; its outcomes may
// depend on what else advanced the global stream (canvas text, the forecast's
// Gambler roll) and that must not change under an old save.
export function playerAttackRandom(policy, battleRng) {
  if (policy === 'fixed-v1' && typeof battleRng === 'function') return battleRng;
  return ambientRandom;
}

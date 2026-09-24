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

import { narrativeLineKey } from './lineKey.js';

// Serializable shuffle bag with namespace-local randomness: never consumes combat RNG.
// `state[key]` is `{ cycle, seen }`; a seen entry is the line itself or its line key
// (the compact form the save keeps between runs: MetaProgressionManager.getNarrativeSeen),
// so a bag carried over from earlier runs keeps walking where it left off.
export function pickFresh(pool, key, state, seed = 0) {
  if (!Array.isArray(pool) || !pool.length) return null;
  const unique = [...new Set(pool.filter((value) => typeof value === 'string' && value))];
  if (!unique.length) return null;
  const previous = state[key];
  let cycle = Math.max(0, Math.trunc(previous?.cycle) || 0);
  const byKey = new Map(unique.map((value) => [narrativeLineKey(value), value]));
  let seen = [];
  if (Array.isArray(previous?.seen)) {
    for (const entry of previous.seen) {
      const value = unique.includes(entry) ? entry : byKey.get(entry);
      if (value && !seen.includes(value)) seen.push(value);
    }
  }
  let remaining = unique.filter((value) => !seen.includes(value));
  if (!remaining.length) {
    cycle++;
    seen = [];
    remaining = unique;
  }
  let hash = Number(seed) >>> 0;
  for (const char of `${key}:${cycle}:${seen.length}`)
    hash = Math.imul(hash ^ char.charCodeAt(0), 16777619) >>> 0;
  const choice = remaining[hash % remaining.length];
  state[key] = { cycle, seen: [...seen, choice] };
  return choice;
}

/** The bags in their compact form (line keys, not lines), for the save between runs. */
export function compactNarrativeSeen(state) {
  const out = {};
  if (!state || typeof state !== 'object' || Array.isArray(state)) return out;
  for (const [key, bag] of Object.entries(state)) {
    if (!bag || typeof bag !== 'object' || !Array.isArray(bag.seen)) continue;
    const seen = bag.seen
      .filter((entry) => typeof entry === 'string' && entry)
      .map((entry) => (/^l[0-9a-z]+$/.test(entry) ? entry : narrativeLineKey(entry)));
    out[key] = { cycle: Math.max(0, Math.trunc(bag.cycle) || 0), seen };
  }
  return out;
}

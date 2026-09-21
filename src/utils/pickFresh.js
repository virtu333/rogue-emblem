// Serializable shuffle bag with namespace-local randomness: never consumes combat RNG.
export function pickFresh(pool, key, state, seed = 0) {
  if (!Array.isArray(pool) || !pool.length) return null;
  const unique = [...new Set(pool.filter((value) => typeof value === 'string' && value))];
  if (!unique.length) return null;
  const previous = state[key];
  let cycle = Math.max(0, Math.trunc(previous?.cycle) || 0);
  let seen = Array.isArray(previous?.seen)
    ? previous.seen.filter((value) => unique.includes(value))
    : [];
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

// ItemUsage — how much each carried item has been used, per instance.
//
// Counters live on the item itself as plain JSON, like `_usesSpent` and the
// forge fields: `_strikes` (strikes its wielder made with it, hits and misses),
// `_kills` (enemies it finished) and `_casts` (staff uses: heals, cures,
// warps and rescues). So they follow the item through trades, the convoy, a
// forge, a whetstone, an imbue and a rename; a battle checkpoint (Vision
// rewind, suspend) restores them with the item, and "Continue from Map"
// drops them with the rest of the battle. A bought or looted item is a fresh
// catalog copy and starts at none.
//
// Only the player's army counts (DeedSystem calls these from its recording
// seams, so the tutorial and enemies never count). Pure: no Phaser, no DOM,
// never the RNG.

export const ITEM_USAGE_KEYS = Object.freeze(['_strikes', '_kills', '_casts']);

const count = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.trunc(Number(v))) : 0);
const isItem = (item) => Boolean(item) && typeof item === 'object' && !Array.isArray(item);

/** Add `by` to one of the item's usage counters (no-op for a missing item or key). */
export function bumpItemUsage(item, key, by = 1) {
  if (!isItem(item) || !ITEM_USAGE_KEYS.includes(key)) return;
  const n = count(item[key]) + count(by);
  if (n > 0) item[key] = n;
}

/** The item's counters as numbers: `{ strikes, kills, casts }` (0 when never used). */
export function itemUsage(item) {
  return {
    strikes: count(item?._strikes),
    kills: count(item?._kills),
    casts: count(item?._casts),
  };
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * The item card's line: "Used in 14 strikes · 3 kills", "Used 9 times" (a
 * staff), or '' when the item has no recorded use.
 */
export function itemUsageText(item) {
  const { strikes, kills, casts } = itemUsage(item);
  if (item?.type === 'Staff')
    return casts > 0 ? `Used ${casts === 1 ? 'once' : `${casts} times`}` : '';
  const parts = [];
  if (strikes > 0) parts.push(plural(strikes, 'strike', 'strikes'));
  if (kills > 0) parts.push(plural(kills, 'kill', 'kills'));
  return parts.length ? `Used in ${parts.join(' · ')}` : '';
}

/** The list row's short form: "14 strikes", "9 uses" (a staff), or ''. */
export function itemUsageShort(item) {
  const { strikes, casts } = itemUsage(item);
  if (item?.type === 'Staff') return casts > 0 ? plural(casts, 'use', 'uses') : '';
  return strikes > 0 ? plural(strikes, 'strike', 'strikes') : '';
}

/**
 * Raise `target`'s counters to `source`'s where the source has more (the same
 * item instance seen later). Returns true when anything changed.
 */
export function carryItemUsage(target, source) {
  if (!isItem(target) || !isItem(source)) return false;
  let changed = false;
  for (const key of ITEM_USAGE_KEYS) {
    const n = count(source[key]);
    if (n > count(target[key])) {
      target[key] = n;
      changed = true;
    }
  }
  return changed;
}

/** `{ uid, _strikes?, _kills?, _casts? }` for each used item that has a uid. */
export function itemUsageByUid(items) {
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!isItem(item) || typeof item.uid !== 'string' || !item.uid) continue;
    const entry = { uid: item.uid };
    for (const key of ITEM_USAGE_KEYS) if (count(item[key]) > 0) entry[key] = count(item[key]);
    if (Object.keys(entry).length > 1) out.push(entry);
  }
  return out;
}

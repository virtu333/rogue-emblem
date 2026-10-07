let _counter = 0;

/**
 * A fresh item uid. `rng` (default Math.random) picks the random suffix; a caller that
 * must not touch Math.random (authored prologue units, engine/Prologue.js) passes its
 * own seeded stream.
 */
export function generateItemUid(rng = Math.random) {
  _counter += 1;
  const rand = Math.floor(rng() * 1679616)
    .toString(36)
    .padStart(4, '0');
  return `itm_${_counter}_${rand}`;
}

export function ensureItemUid(item) {
  if (item && typeof item === 'object' && typeof item.uid !== 'string') {
    item.uid = generateItemUid();
  }
  return item;
}

/**
 * ensureItemUid with the uid's random suffix drawn from `rng` instead of Math.random.
 * A separate function on purpose: ensureItemUid is passed straight to forEach, which
 * would hand it an index as a second argument.
 */
export function ensureItemUidWith(item, rng) {
  if (item && typeof item === 'object' && typeof item.uid !== 'string') {
    item.uid = generateItemUid(rng);
  }
  return item;
}

export function _resetUidCounter() {
  _counter = 0;
}

/** The counter itself, for a headless session that owns it while it runs (tools/play). */
export function _getUidCounter() {
  return _counter;
}

export function _setUidCounter(value) {
  _counter = Math.max(0, Math.trunc(Number(value) || 0));
}

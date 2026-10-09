// The blessings a run holds, as the pause menu lists them.
// Pure: reads RunManager.activeBlessings and the blessings catalog, draws nothing.

import { buildBlessingIndex } from '../engine/BlessingEngine.js';

const TIER_NUMERALS = ['', 'I', 'II', 'III', 'IV', 'V'];

function catalogIndex(run) {
  try {
    const catalog = run?.gameData?.blessings;
    return catalog?.blessings?.length ? buildBlessingIndex(catalog) : new Map();
  } catch {
    return new Map();
  }
}

/**
 * One entry per held blessing, in the order it was taken:
 * `{ id, label, tier, line, price, priceKind }`. `price` is the label of what the blessing
 * cost when it was taken (its rolled cost, or its pact) and `priceKind` is 'Cost' or 'Pact';
 * both are null for a free blessing (tier I, a church's vow, an event's gift). An id the
 * catalog no longer has is left out. Empty when the run holds none.
 * @param {object} run - RunManager
 * @returns {Array<{ id: string, label: string, tier: string, line: string,
 *   price: string|null, priceKind: 'Cost'|'Pact'|null }>}
 */
export function heldBlessingEntries(run) {
  const index = catalogIndex(run);
  const seen = new Set();
  const entries = [];
  for (const entry of run?.activeBlessings || []) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (typeof id !== 'string' || seen.has(id)) continue;
    const blessing = index.get(id);
    if (!blessing) continue;
    seen.add(id);
    const label = entry?.midRun ? null : entry?.rolledCost?.label || null;
    const isPact = !!label && !!blessing.pact && blessing.pact.label === label;
    entries.push({
      id,
      label: blessing.name,
      tier: TIER_NUMERALS[blessing.tier] || String(blessing.tier ?? ''),
      line: blessing.description || '',
      price: label,
      priceKind: label ? (isPact ? 'Pact' : 'Cost') : null,
    });
  }
  return entries;
}

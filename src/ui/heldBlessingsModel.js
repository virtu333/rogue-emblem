// The blessings a run holds, as the pause menu lists them.
// Pure: reads RunManager.activeBlessings and the blessings catalog, draws nothing.

import { buildBlessingIndex } from '../engine/BlessingEngine.js';
import { blessingTerms } from '../engine/BlessingTerms.js';
import { blessingPriceKind } from './choiceContent.js';

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
 * `{ id, label, tier, earned, line, price, priceKind, terms }` (`tier` reads 'Earned' for an
 * earned blessing). `price` is the label of what the
 * blessing cost when it was taken (its rolled cost, or its pact) and `priceKind` is 'Cost',
 * 'Price' (an intrinsic price: the boon carries it), 'Pact', 'Twist' (a twisted earned card's
 * twist) or 'Catch' (a start gift's catch); both are null for a free blessing (tier I, a church's
 * vow, an event's gift).
 * `terms` explains the price's words (BlessingTerms). An id the catalog no longer has is left
 * out. Empty when the run holds none.
 * @param {object} run - RunManager
 * @returns {Array<{ id: string, label: string, tier: string, line: string,
 *   price: string|null, priceKind: 'Cost'|'Price'|'Pact'|'Twist'|'Catch'|null }>}
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
    // A mid-run blessing shows no price, but the one its grant applied: a twisted earned card's
    // twist ("Twist: ..."), a start gift's catch ("Catch: ...").
    const midRunPrice = ['twist', 'gift'].includes(entry?.rolledCost?.kind);
    const label = entry?.midRun && !midRunPrice ? null : entry?.rolledCost?.label || null;
    // A v3 price says it was the pact; a v2 save names its pact by the pact's own label.
    const isPact =
      !!label &&
      (entry?.rolledCost?.kind === 'pact' || (!!blessing.pact && blessing.pact.label === label));
    entries.push({
      id,
      label: blessing.name,
      // An earned blessing has no tier: the list says how it was come by.
      tier:
        blessing.earned === true
          ? 'Earned'
          : TIER_NUMERALS[blessing.tier] || String(blessing.tier ?? ''),
      earned: blessing.earned === true,
      line: blessing.description || '',
      price: label,
      priceKind: label
        ? isPact
          ? 'Pact'
          : blessingPriceKind({
              rolledCost: entry?.rolledCost,
              intrinsicPrice: blessing.intrinsicPrice,
            })
        : null,
      terms: label
        ? blessingTerms([label], {
            burdens: run?.gameData?.events?.burdens,
            difficultyId: run?.difficultyId,
            pact: isPact,
            effects: entry?.rolledCost?.effects || null,
          })
        : [],
    });
  }
  return entries;
}

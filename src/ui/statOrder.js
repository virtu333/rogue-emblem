// Display order for a unit's stat grid (display only: saves, XP_STAT_NAMES and the
// level-up order are untouched).
//
// The roster sheet lays its stats out as label/value pairs flowing row by row. Three
// pairs per row (landscape) reads well in Fire Emblem order. Two pairs per row
// (upright phones) would put HP, Magic, Speed, Resistance and Move down the left
// column; players read the left column as the body stats, so the two-column order
// swaps Strength and Magic: left column HP, Strength, Speed, Resistance, Move; right
// column Magic, Skill, Defense, Luck.

export const FE_STAT_ORDER = Object.freeze([
  'HP',
  'STR',
  'MAG',
  'SKL',
  'SPD',
  'DEF',
  'RES',
  'LCK',
  'MOV',
]);

// Row-major for two columns: [HP MAG] [STR SKL] [SPD DEF] [RES LCK] [MOV].
export const TWO_COLUMN_STAT_ORDER = Object.freeze([
  'HP',
  'MAG',
  'STR',
  'SKL',
  'SPD',
  'DEF',
  'RES',
  'LCK',
  'MOV',
]);

/**
 * The keys of `stats` in display order. Known stats follow the layout's order; a key
 * outside it keeps its own relative order and sits before Move, which always ends the
 * grid. Keys the unit lacks are skipped, never invented.
 */
export function orderedStatKeys(stats, { twoColumn = false } = {}) {
  const keys = Object.keys(stats || {});
  const order = twoColumn ? TWO_COLUMN_STAT_ORDER : FE_STAT_ORDER;
  const known = order.filter((key) => key !== 'MOV' && keys.includes(key));
  const extra = keys.filter((key) => !order.includes(key));
  return [...known, ...extra, ...(keys.includes('MOV') ? ['MOV'] : [])];
}

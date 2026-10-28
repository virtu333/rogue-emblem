// A class's own name pool is small (a Dancer has 10), and a long NG+ ladder can use them all.
// Before a name takes a numeral ("Aria II"), a recruit borrows a name nobody in the run holds
// from any other class's pool: every pool name is already clash-checked against the rest
// (tests/RecruitNameClashes.test.js), so a borrowed name never reads like another in the army.

/**
 * @param {Record<string, string[]>} namePool the recruits' per-class pools
 * @param {Set<string>} taken names already in use (roster, fallen, promised)
 * @param {() => number} rng a 0..1 draw
 * @returns {string|null} a name no one holds, or null when every pool name is taken
 */
export function spareRecruitName(namePool, taken, rng) {
  const spare = [];
  for (const names of Object.values(namePool || {})) {
    if (!Array.isArray(names)) continue;
    for (const n of names) {
      if (typeof n === 'string' && n.trim() && !taken.has(n) && !spare.includes(n)) spare.push(n);
    }
  }
  return spare.length ? spare[Math.floor(rng() * spare.length)] : null;
}

// UnitIdentity.js — who a unit is, independent of the name on its card.
//
// Names are display text: two units can share one (a mercenary hired under a name a
// recruit node had already promised, or a legacy save), and the roster repair renames
// duplicates after the fact. Anything that decides whether a unit lived, fell, or is
// the one being revived must therefore not match by name. Every run unit carries
// `unitUid` ("ru<n>"), allocated by RunManager from a run-scoped counter
// (`nextUnitUid`, saved with the run; never Math.random, so no seeded stream moves).
//
// Legacy data (saves, checkpoints and battle records from before the field existed)
// has no uid; matching falls back to the name only where a side has no uid.
//
// Pure: no RNG, no scene access.

const UID_PATTERN = /^ru([1-9]\d*)$/;

/** The unit's run identity, or null when it has none (legacy data). */
export function unitUidOf(unit) {
  const uid = unit?.unitUid;
  return typeof uid === 'string' && UID_PATTERN.test(uid) ? uid : null;
}

/** Numeric part of a uid ("ru12" → 12), or 0. */
export function unitUidNumber(uid) {
  const match = typeof uid === 'string' ? UID_PATTERN.exec(uid) : null;
  return match ? Number(match[1]) : 0;
}

export function formatUnitUid(n) {
  return `ru${n}`;
}

/** Identity key for maps and sets: the uid, or the name for legacy units. */
export function unitIdentityKey(unit) {
  const uid = unitUidOf(unit);
  if (uid) return uid;
  return typeof unit?.name === 'string' ? `name:${unit.name}` : null;
}

/**
 * Same unit? Both carry a uid → the uids decide (names are ignored). Otherwise the
 * legacy rule: the same name.
 */
export function isSameUnit(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ua = unitUidOf(a);
  const ub = unitUidOf(b);
  if (ua && ub) return ua === ub;
  return typeof a.name === 'string' && a.name !== '' && a.name === b.name;
}

/**
 * One-to-one match of the units that entered a battle (`candidates`: the roster as
 * it entered, then any mid-battle recruit records) against the units that came out
 * of it (`survivors`). Each survivor accounts for at most one candidate, so two units
 * sharing a name can never both be "alive" because one of them is.
 *
 * Pass 1: exact uid. Pass 2 (legacy): a candidate still unmatched is matched by name
 * to a survivor without a uid; a candidate without a uid may also take a same-named
 * survivor that has one (a legacy record whose unit was stamped since). A survivor
 * whose uid matched nobody is a unit new to the army (a recruit who lived).
 *
 * @returns {{ unmatched: object[], survivorOf: Map<object, object> }}
 *   unmatched: candidates no survivor accounts for (the fallen), in input order;
 *   survivorOf: candidate → the survivor that accounts for it.
 */
export function matchUnitsToSurvivors(candidates = [], survivors = []) {
  const list = (Array.isArray(candidates) ? candidates : []).filter(Boolean);
  const alive = (Array.isArray(survivors) ? survivors : []).filter(Boolean);
  const claimed = new Set();
  const survivorOf = new Map();
  const claim = (candidate, survivor) => {
    claimed.add(survivor);
    survivorOf.set(candidate, survivor);
  };

  for (const candidate of list) {
    const uid = unitUidOf(candidate);
    if (!uid) continue;
    const survivor = alive.find((s) => !claimed.has(s) && unitUidOf(s) === uid);
    if (survivor) claim(candidate, survivor);
  }
  for (const candidate of list) {
    if (survivorOf.has(candidate)) continue;
    const name = typeof candidate.name === 'string' ? candidate.name : '';
    if (!name) continue;
    const sameName = (s) => !claimed.has(s) && s.name === name;
    let survivor = alive.find((s) => sameName(s) && !unitUidOf(s));
    if (!survivor && !unitUidOf(candidate)) survivor = alive.find(sameName);
    if (survivor) claim(candidate, survivor);
  }
  return { unmatched: list.filter((c) => !survivorOf.has(c)), survivorOf };
}

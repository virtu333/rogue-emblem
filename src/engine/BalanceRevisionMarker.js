/**
 * The balance revision a meta save was settled at, kept a second time inside
 * `purchasedUpgrades` (see BALANCE_REVISIONS in MetaProgressionManager.js).
 *
 * A build from before a revision writes its own (older) `balanceRevision` whenever it
 * saves, so the top-level field alone would let the next current build credit the same
 * price cut again on every round trip through an older client (a lagging app build, a
 * stale tab). Older builds copy `purchasedUpgrades` whole on load and keep its unknown
 * keys when they save or max-merge it (as they keep `<id>__repeat_tiers`), and read only
 * the ids their own data lists, so the copy stored here survives them. A save is settled
 * at the largest of its records.
 *
 * Two keys, because a build that knows `__balance_revision` (revision 5 on) strips it on
 * load and writes its own revision back under it. `__balance_settled` is unknown to those
 * builds, so they carry it through untouched; the revision-5 build is the only one that
 * writes `__balance_revision` alone. A build never writes a revision below the one it read.
 */
export const BALANCE_REVISION_MARKER = '__balance_revision';
export const BALANCE_SETTLED_MARKER = '__balance_settled';
const MARKER_KEYS = [BALANCE_REVISION_MARKER, BALANCE_SETTLED_MARKER];

/** True for a key that records the settled revision, never an upgrade's level. */
export function isBalanceRevisionMarker(key) {
  return MARKER_KEYS.includes(key);
}

function revisionOf(value) {
  const raw = Number(value);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** The revision recorded inside a saved `purchasedUpgrades` (0 when there is none). */
export function markedBalanceRevision(purchasedUpgrades) {
  return Math.max(...MARKER_KEYS.map((key) => revisionOf(purchasedUpgrades?.[key])));
}

/** The revision a saved meta payload was settled at: the largest of its records. */
export function settledBalanceRevision(saved) {
  return Math.max(
    revisionOf(saved?.balanceRevision),
    markedBalanceRevision(saved?.purchasedUpgrades),
  );
}

/** `purchasedUpgrades` without the markers (the in-memory shape: upgrade ids only). */
export function withoutBalanceRevisionMarker(purchasedUpgrades) {
  const upgrades = { ...(purchasedUpgrades || {}) };
  for (const key of MARKER_KEYS) delete upgrades[key];
  return upgrades;
}

/**
 * `purchasedUpgrades` as saved: with both markers when anything has been bought (a credit
 * only ever pays for tiers owned), so a save with no purchases still reads as fresh to the
 * cloud's empty-boot guard.
 */
export function withBalanceRevisionMarker(purchasedUpgrades, revision) {
  const upgrades = withoutBalanceRevisionMarker(purchasedUpgrades);
  const owned = Object.values(upgrades).some((level) => Number(level) > 0);
  return owned
    ? { ...upgrades, [BALANCE_REVISION_MARKER]: revision, [BALANCE_SETTLED_MARKER]: revision }
    : upgrades;
}

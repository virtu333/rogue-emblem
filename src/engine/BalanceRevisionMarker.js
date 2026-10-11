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
 * at the larger of the two.
 */
export const BALANCE_REVISION_MARKER = '__balance_revision';

/** The revision recorded inside a saved `purchasedUpgrades` (0 when there is none). */
export function markedBalanceRevision(purchasedUpgrades) {
  const raw = Number(purchasedUpgrades?.[BALANCE_REVISION_MARKER]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
}

/** The revision a saved meta payload was settled at: the larger of its two records. */
export function settledBalanceRevision(saved) {
  const top = Number(saved?.balanceRevision);
  return Math.max(
    Number.isFinite(top) && top > 0 ? Math.floor(top) : 0,
    markedBalanceRevision(saved?.purchasedUpgrades),
  );
}

/** `purchasedUpgrades` without the marker (the in-memory shape: upgrade ids only). */
export function withoutBalanceRevisionMarker(purchasedUpgrades) {
  const { [BALANCE_REVISION_MARKER]: _marker, ...upgrades } = purchasedUpgrades || {};
  return upgrades;
}

/**
 * `purchasedUpgrades` as saved: with the marker when anything has been bought (a credit
 * only ever pays for tiers owned), so a save with no purchases still reads as fresh to the
 * cloud's empty-boot guard.
 */
export function withBalanceRevisionMarker(purchasedUpgrades, revision) {
  const upgrades = withoutBalanceRevisionMarker(purchasedUpgrades);
  const owned = Object.values(upgrades).some((level) => Number(level) > 0);
  return owned ? { ...upgrades, [BALANCE_REVISION_MARKER]: revision } : upgrades;
}

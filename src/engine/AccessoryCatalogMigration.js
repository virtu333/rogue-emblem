// Saved Gambler's Coins take the catalog's odds. Pure.
//
// The coin used to carry the flag `combatEffects: { gamblerCoin: true }` (the engine's
// default 50%, +5 / -3); the catalog now gives it an explicit
// `gambler: { winChance, winAtkBonus, lossAtkPenalty }`. Saves store whole item
// objects, so a coin already in a save (equipped, convoy, shop stock, pending loot or
// battle reward, a fallen unit's gear, a colosseum merc's gear, the battle checkpoint
// and its rewind timeline) still holds the flag. RunManager.fromJSON runs
// migrateSavedGamblerCoins on the parsed save, right after the item-name migration.
//
// Only the `combatEffects` config changes. The item's text is derived from it
// (utils/accessoryText.js; an accessory stores no description), and every instance
// field (uid, forge, imbue, HP debt) is never touched.
//
// The `gamblerCoin` flag belongs to this one accessory, so the walk keys on the flag
// itself rather than on a name. A rewind destination stored as a patch never reaches
// the walk as a patch: RunManager.fromJSON decodes every patch to its full state first
// and re-encodes it against the migrated keyframe afterwards
// (BattleTimeline.expandTimelinePatches / collapseTimelinePatches), so the walk only
// ever sees whole states.
//
// Idempotent and ungated by a save revision: a migrated coin has no flag left, and a
// save written back by an older build with the flag is fixed on its next load.

const LEGACY_FLAG = 'gamblerCoin';
const COIN_NAME = "Gambler's Coin";

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The catalog's gambler config for the coin, or null when the catalog has none. */
function catalogGamblerConfig(gameData) {
  const coin = (gameData?.accessories || []).find((a) => a?.name === COIN_NAME);
  const config = coin?.combatEffects?.gambler;
  return isRecord(config) ? config : null;
}

/**
 * Give every legacy Gambler's Coin in a parsed save the catalog's config, in place.
 * Returns the number of places changed (0 when the save has none, or the catalog
 * defines no gambler config).
 */
export function migrateSavedGamblerCoins(saved, gameData = null) {
  const config = catalogGamblerConfig(gameData);
  if (!config || !saved || typeof saved !== 'object') return 0;
  let changed = 0;
  const seen = new Set();
  const visit = (node, depth) => {
    if (!node || typeof node !== 'object' || depth > 64 || seen.has(node)) return;
    seen.add(node);
    if (!Array.isArray(node) && node[LEGACY_FLAG] === true && !Object.hasOwn(node, 'gambler')) {
      delete node[LEGACY_FLAG];
      node.gambler = structuredClone(config);
      changed += 1;
    }
    for (const key of Object.keys(node)) visit(node[key], depth + 1);
  };
  visit(saved, 0);
  return changed;
}

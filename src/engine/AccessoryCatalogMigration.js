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
// itself rather than on a name: that also reaches the pieces of a rewind patch, which
// hold combatEffects fragments without the item's name:
//   - a flag value or a patch leaf `{ $: true }` becomes the config (or `{ $: config }`);
//   - a patch that removes the flag (`x: ['gamblerCoin']`) removes `gambler` too, so a
//     migrated base coin swapped for another accessory does not keep the coin's effect.
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
    if (!Array.isArray(node)) {
      if (Object.hasOwn(node, LEGACY_FLAG) && !Object.hasOwn(node, 'gambler')) {
        const flag = node[LEGACY_FLAG];
        const isLeaf = isRecord(flag) && Object.keys(flag).length === 1 && Object.hasOwn(flag, '$');
        if (isLeaf && flag.$) {
          delete node[LEGACY_FLAG];
          node.gambler = { $: structuredClone(config) };
          changed += 1;
        } else if (!isLeaf && flag === true) {
          delete node[LEGACY_FLAG];
          node.gambler = structuredClone(config);
          changed += 1;
        }
      }
      // A patch that removes the flag from its base removes the migrated key as well.
      if (
        Array.isArray(node.x) &&
        isRecord(node.o) &&
        node.x.includes(LEGACY_FLAG) &&
        !node.x.includes('gambler') &&
        !Object.hasOwn(node.o, 'gambler')
      ) {
        node.x.push('gambler');
        changed += 1;
      }
    }
    for (const key of Object.keys(node)) visit(node[key], depth + 1);
  };
  visit(saved, 0);
  return changed;
}

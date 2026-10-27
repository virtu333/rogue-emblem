// LordOutfits.js - the Wardrobe's rules (docs/specs/lord-outfits.md), pure.
//
// One alternate outfit per lord (data/lordOutfits.json): a look for the portrait (base and
// promoted) and the map sprite, nothing else; stats, crest and kit never change. An outfit is
// bought once per save slot for `price` Valor, only after a run won with that lord alive
// (Edric after any win), and the player chooses per lord what is worn.
//
// Saved in the slot's meta: ownership as a `purchasedUpgrades` key per outfit
// (`lord_outfit_<id>: 1`), so it travels with the economy that paid for it (the cloud fetch
// and the local adopt keep one payload's economy whole) and an older build, which copies
// `purchasedUpgrades` whole, never drops it; what is worn as `lordOutfitsWorn`
// (`{ <lord>: <outfit id> }`), a preference adopted whole from the newer copy. The
// unlock is the milestone `wonWith:<Lord>`, written at a victory's run end, or a victory
// record (RunRecords) whose survivors hold the lord.
import catalog from '../../data/lordOutfits.json' with { type: 'json' };

export const LORD_OUTFIT_CATALOG = catalog;
export const LORD_OUTFIT_PRICE = catalog.price;
export const OWNED_OUTFIT_PREFIX = 'lord_outfit_';
export const WON_WITH_PREFIX = 'wonWith:';
/** Edric's outfit needs a win, not a win with him alive (he need not be in the run). */
export const ANY_WIN_LORD = 'Edric';
const ID_PATTERN = /^[a-z0-9_]{1,40}$/;

const outfits = () => (Array.isArray(catalog?.outfits) ? catalog.outfits : []);

export function lordOutfit(id) {
  return outfits().find((o) => o.id === id) || null;
}

/** The outfits a lord can wear (one today). */
export function outfitsForLord(lordName) {
  return outfits().filter((o) => o.lord === lordName);
}

export const ownedOutfitKey = (id) => `${OWNED_OUTFIT_PREFIX}${id}`;
export const wonWithMilestone = (lordName) => `${WON_WITH_PREFIX}${lordName}`;

/** The outfit ids a saved `purchasedUpgrades` owns, in catalog order. */
export function ownedOutfitIds(purchasedUpgrades) {
  const upgrades =
    purchasedUpgrades && typeof purchasedUpgrades === 'object' ? purchasedUpgrades : {};
  return outfits()
    .filter((o) => (Number(upgrades[ownedOutfitKey(o.id)]) || 0) > 0)
    .map((o) => o.id);
}

/** The lords a victory record's survivors hold. */
export function lordsWonWith(runRecords) {
  const names = new Set();
  for (const record of Array.isArray(runRecords) ? runRecords : [])
    for (const unit of Array.isArray(record?.roster) ? record.roster : [])
      if (unit?.isLord === true && typeof unit.name === 'string') names.add(unit.name);
  return names;
}

/**
 * Has the save won a run with this lord alive? `milestones` is a Set; `runRecords` the
 * slot's victory records (a win before the milestone existed). Edric: any win.
 */
export function hasWonWithLord(lordName, { milestones, runRecords } = {}) {
  const has = (m) => Boolean(milestones?.has?.(m));
  if (has(wonWithMilestone(lordName))) return true;
  const records = Array.isArray(runRecords) ? runRecords : [];
  if (lordName === ANY_WIN_LORD && (has('beatGame') || records.length > 0)) return true;
  return lordsWonWith(records).has(lordName);
}

/** The milestones a victory's record earns (`wonWith:<Lord>` per surviving lord). */
export function wonWithMilestonesFor(victoryRecord) {
  return [...lordsWonWith(victoryRecord ? [victoryRecord] : [])].map(wonWithMilestone);
}

/**
 * The worn map kept to outfits that exist, belong to that lord and are owned
 * (`owned` a list of ids; omitted: ownership is not checked).
 */
export function normalizeWornOutfits(raw, owned = null) {
  const worn = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return worn;
  const ownedSet = owned ? new Set(owned) : null;
  for (const [lord, id] of Object.entries(raw)) {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) continue;
    const outfit = lordOutfit(id);
    if (!outfit || outfit.lord !== lord) continue;
    if (ownedSet && !ownedSet.has(id)) continue;
    worn[lord] = id;
  }
  return worn;
}

/** The portrait id an outfit's portrait has (`lord_edric__ashen_crown`, promoted `lord_edric_promoted__ashen_crown`). */
export function outfitPortraitId(lordName, outfitId, { promoted = false } = {}) {
  return `lord_${String(lordName).toLowerCase()}${promoted ? '_promoted' : ''}__${outfitId}`;
}

/** Problems with the catalog (`npm run validate:data`); `lords` is data/lords.json. */
export function validateLordOutfitsConfig(config, lords = []) {
  const errors = [];
  if (!config || typeof config !== 'object') return ['lordOutfits: not an object'];
  if (!Number.isInteger(config.price) || config.price <= 0)
    errors.push('lordOutfits.price: a positive whole number of Valor');
  const lordNames = new Set((lords || []).map((l) => l.name));
  const ids = new Set();
  for (const [i, o] of (Array.isArray(config.outfits) ? config.outfits : []).entries()) {
    const at = `lordOutfits.outfits[${i}]`;
    if (typeof o?.id !== 'string' || !ID_PATTERN.test(o.id)) errors.push(`${at}.id: [a-z0-9_]`);
    else if (ids.has(o.id)) errors.push(`${at}.id: duplicate ${o.id}`);
    else ids.add(o.id);
    if (!lordNames.has(o?.lord)) errors.push(`${at}.lord: not a lord (${o?.lord})`);
    if (typeof o?.name !== 'string' || !o.name.trim() || o.name.length > 24)
      errors.push(`${at}.name: 1-24 characters`);
    if (typeof o?.description !== 'string' || !o.description.trim() || o.description.length > 100)
      errors.push(`${at}.description: 1-100 characters`);
  }
  if (!Array.isArray(config.outfits)) errors.push('lordOutfits.outfits: a list');
  return errors;
}

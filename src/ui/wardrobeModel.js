// wardrobeModel.js - the words and state of Home Base's Wardrobe tab
// (docs/specs/lord-outfits.md), pure: WardrobePanel draws it, the meta commands change it.
import { metLords } from '../engine/LordsMet.js';

export const WARDROBE_TAB_LABEL = 'Wardrobe';

const valor = (n) => `${Math.max(0, Math.floor(Number(n) || 0)).toLocaleString('en-US')} Valor`;

/** Why a Buy was refused, in words. */
export function wardrobeBlockText(reason, { lord, price, held } = {}) {
  switch (reason) {
    case 'owned':
      return 'Already in the Wardrobe.';
    case 'locked':
      return lord === 'Edric' ? 'Win a run to unlock.' : `Win a run with ${lord} alive to unlock.`;
    case 'valor':
      return `Needs ${valor(price)} (you have ${valor(held)}).`;
    case 'save_failed':
      return 'Could not save. Nothing was spent.';
    case 'not_owned':
      return 'Buy this outfit first.';
    default:
      return 'Unavailable.';
  }
}

/**
 * One row per lord this save has met with an outfit: `{ lord, outfit, owned, worn, block,
 * status, blockText, price }`. `lords` is data/lords.json, `outfits` data/lordOutfits.json.
 */
export function wardrobeRows(meta, lords, outfitsConfig) {
  const price = outfitsConfig?.price ?? 0;
  const held = meta?.getTotalValor?.() ?? 0;
  const { owned = [], worn = {} } = meta?.getLordOutfits?.() || {};
  const met = metLords(lords || [], (name) => meta?.hasMetLord?.(name) === true);
  const rows = [];
  for (const lord of met)
    for (const outfit of (outfitsConfig?.outfits || []).filter((o) => o.lord === lord.name)) {
      const isOwned = owned.includes(outfit.id);
      const isWorn = worn[lord.name] === outfit.id;
      const block = isOwned ? null : meta?.lordOutfitBlock?.(outfit.id) || null;
      rows.push({
        lord: lord.name,
        outfit,
        owned: isOwned,
        worn: isWorn,
        block,
        price,
        status: isWorn
          ? 'Wearing'
          : isOwned
            ? 'Owned'
            : block === 'locked'
              ? 'Locked'
              : valor(price),
        blockText: block ? wardrobeBlockText(block, { lord: lord.name, price, held }) : null,
      });
    }
  return rows;
}

/** The lead line above the list. */
export function wardrobeLead(price) {
  return `Each lord has one outfit to buy: ${valor(price)}, once for this save. Looks only; nothing else changes.`;
}

export const buyLabel = (price, confirming) =>
  confirming ? `Spend ${valor(price)}?` : `Buy · ${valor(price)}`;

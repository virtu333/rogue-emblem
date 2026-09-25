// Item icon ids — the one naming rule shared by the atlas build
// (tools/art/icons/lib/catalog.mjs) and the runtime (src/ui/itemIcons.js). Pure.
//
//   items       -> slug(name)          "Gambler's Coin" -> "gamblers-coin"
//   blessings   -> blessing-<id>       upgrades -> upgrade-<id>
//   fallbacks   -> generic-<kind>

export function itemSlug(name) {
  return String(name ?? '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

const GENERIC_BY_TYPE = {
  Sword: 'generic-sword',
  Lance: 'generic-lance',
  Axe: 'generic-axe',
  Bow: 'generic-bow',
  Tome: 'generic-tome',
  Light: 'generic-light',
  Staff: 'generic-staff',
  Breath: 'generic-breath',
  Accessory: 'generic-accessory',
  Consumable: 'generic-supply',
  Whetstone: 'generic-whetstone',
};

/** Display names carry run state: "Vampiric Iron Sword +2" is still an Iron Sword. */
export function baseItemName(item) {
  const raw = typeof item === 'string' ? item : item?._baseName || item?.name || '';
  return String(raw)
    .replace(/\s*\+\d+$/, '')
    .trim();
}

/**
 * The icon id for anything the game shows as an item, blessing or upgrade. Always
 * returns an id; `has(id)` says which ids the atlas holds.
 * @param {object|string} subject item / blessing / upgrade / reward choice, or a name
 * @param {(id:string)=>boolean} has
 * @param {'item'|'blessing'|'upgrade'|'gold'} [kind]
 */
export function resolveItemIconId(subject, has, kind) {
  if (subject == null) return 'generic-supply';
  if (typeof subject === 'object' && subject.item && !subject.name) {
    // A reward choice: { type, item } (rewardPresentation's input).
    if (subject.type === 'gold' || subject.type === 'skip') return 'gold';
    return resolveItemIconId(subject.item, has, kind);
  }
  const obj = typeof subject === 'object' ? subject : null;
  if (kind === 'gold' || ['gold', 'Gold', 'skip'].includes(obj?.type)) return 'gold';
  if (obj && (kind === 'blessing' || (Array.isArray(obj.boons) && obj.id))) {
    const id = `blessing-${obj.id}`;
    return has(id) ? id : 'generic-blessing';
  }
  if (obj && (kind === 'upgrade' || (obj.category && obj.maxLevel != null && obj.id))) {
    const id = `upgrade-${obj.id}`;
    return has(id) ? id : 'generic-upgrade';
  }
  const name = baseItemName(subject);
  const words = name.split(/\s+/).filter(Boolean);
  // Imbued weapons lead with the imbue's adjective ("Vampiric Iron Sword").
  for (let drop = 0; drop < words.length; drop += 1) {
    const id = itemSlug(words.slice(drop).join(' '));
    if (id && has(id)) return id;
  }
  if (!obj) return 'generic-supply';
  if (obj.type === 'Scroll' || obj.skillId || obj.teachesWeaponArtId)
    return obj.teachesWeaponArtId ? 'generic-art-scroll' : 'generic-skill-scroll';
  if (obj.imbueId || /imbuing stone/i.test(name)) return 'generic-imbue';
  if (obj.forgeStat) return 'generic-whetstone';
  return (
    GENERIC_BY_TYPE[obj.type] ||
    (obj.effects && !obj.effect ? 'generic-accessory' : 'generic-supply')
  );
}

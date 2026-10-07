// itemNames.js — the one reading of a weapon's run-state name suffix. Pure, no deps.
//
// A name is an item's identity (weapon-art gates, icons, fx, keyword and migration
// lookups key on it), and run state decorates it: forging appends " +N", wear appends
// " -N" (docs/specs/worn-weapons.md), an imbue prefixes one adjective. Every lookup that
// maps a weapon to something reads the undecorated name through here, so a new kind of
// suffix is one change, not a hunt.
//
// An accessory with a bound skill is the other kind of decoration: its identity name stays
// "Power Ring" and only the display name carries the skill (`itemDisplayName`).
import { accessoryDisplayName } from '../engine/AccessorySkillNames.js';

/** The suffix forging (" +2") or wear (" -2") leaves on a display name. ASCII hyphen. */
export const ITEM_NAME_SUFFIX_RE = /\s[+-]\d+$/;

/** The name without its forge or wear suffix: "Iron Sword -2" is "Iron Sword". */
export function stripItemNameSuffix(name) {
  return typeof name === 'string' ? name.replace(ITEM_NAME_SUFFIX_RE, '') : '';
}

/** The suffix a display name carries (" +2", " -2"), or ''. */
export function itemNameSuffix(name) {
  const match = typeof name === 'string' ? name.match(ITEM_NAME_SUFFIX_RE) : null;
  return match ? match[0] : '';
}

/**
 * The display name of a weapon from its base name: "<base> +N" when forged, "<base> -N"
 * when worn, the base alone otherwise. A weapon is never both (a worn weapon is repaired
 * before it is forged), so forging wins if saved data ever carries both.
 */
export function composeWeaponName(baseName, { forgeLevel = 0, wearSteps = 0 } = {}) {
  const base = String(baseName ?? '');
  if (forgeLevel > 0) return `${base} +${forgeLevel}`;
  if (wearSteps > 0) return `${base} -${wearSteps}`;
  return base;
}

const text = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * Every name a weapon instance may go by in the catalog: its base name, id and display
 * name, each with the forge/wear suffix removed, and (one imbue per weapon, and every
 * imbue adjective is one word) without the imbue's adjective. "Cruel Twinsworn -1"
 * answers to "Twinsworn". Raw tokens come first so an exact catalog name still wins.
 */
export function weaponCatalogNames(weapon) {
  const raw = [weapon?._baseName, weapon?.id, weapon?.name].map(text).filter(Boolean);
  const names = new Set(raw);
  for (const token of raw) {
    const plain = stripItemNameSuffix(token);
    names.add(plain);
    if (weapon?._imbueId) names.add(plain.replace(/^\S+\s+/, ''));
  }
  return [...names];
}

/**
 * The name an item shows. Most items show their `name` (a forged or worn weapon's already
 * carries its " +N" / " -N"). An accessory with a bound skill keeps its identity
 * name and shows "Power Ring · Vantage" (docs/specs/item-names.md). Display only: every lookup keeps
 * reading the identity name. `skills` is the skills.json catalog, which names the lent skill.
 */
export function itemDisplayName(item, skills = null) {
  return accessoryDisplayName(item, skills);
}

// BondRingNames.js — what a Bond Ring is called and says (docs/specs/phase3.md 3H). Pure.
//
// The light half of BondRings.js, with no import beyond EffectiveSkills, so utils/itemNames.js
// and the UI can read a ring without pulling in UnitManager. A ring's identity name is always
// "Bond Ring"; its display name carries the rarity and skill, "Bond Ring (B) · Vantage"
// (docs/specs/item-names.md). The bound skill is read only through `boundSkillOf`
// (EffectiveSkills); the rarity is the instance's `_rarity`.
import { boundSkillOf } from './EffectiveSkills.js';

/** The accessory family's catalog name; every ring's identity. */
export const BOND_RING_NAME = 'Bond Ring';

/** Rarities, lowest first. */
export const BOND_RARITIES = Object.freeze(['C', 'B', 'A', 'S']);

/** Is this item a Bond Ring (the family's catalog entry or a rolled instance)? */
export function isBondRing(item) {
  return Boolean(item) && item.type === 'Accessory' && item.name === BOND_RING_NAME;
}

/** The ring's rarity ('C'..'S') or null (a catalog ring, or anything that is not a ring). */
export function bondRingRarity(item) {
  const rarity = item?._rarity;
  return isBondRing(item) && BOND_RARITIES.includes(rarity) ? rarity : null;
}

/** The skill a ring lends (its id) or null. */
export function bondRingSkill(item) {
  return isBondRing(item) ? boundSkillOf(item) : null;
}

/** The skill's catalog name, or the id set in words ("uncanny_blow" -> "Uncanny Blow"). */
export function boundSkillName(id, skills = null) {
  if (typeof id !== 'string' || !id) return '';
  const entry = Array.isArray(skills) ? skills.find((skill) => skill?.id === id) : null;
  if (entry?.name) return entry.name;
  return id
    .split('_')
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * The ring's display name: "Bond Ring (B) · Vantage". A catalog ring (no rolled skill), or
 * anything that is not a ring, shows its own name. Never an identity: lookups keep
 * "Bond Ring".
 */
export function bondRingDisplayName(item, skills = null) {
  if (!isBondRing(item)) return typeof item?.name === 'string' ? item.name : '';
  const id = boundSkillOf(item);
  if (!id) return item.name;
  const rarity = bondRingRarity(item);
  const skill = boundSkillName(id, skills);
  return rarity ? `${item.name} (${rarity}) · ${skill}` : `${item.name} · ${skill}`;
}

/**
 * The text a ring's card carries: what it lends. A catalog ring (no skill yet) says it
 * rolls one; a ring with a skill names it and says what it does.
 */
export function bondRingText(item, skills = null) {
  if (!isBondRing(item)) return '';
  const id = boundSkillOf(item);
  if (!id) return 'Lends a skill, rolled when the ring is found';
  const name = boundSkillName(id, skills);
  const entry = Array.isArray(skills) ? skills.find((skill) => skill?.id === id) : null;
  const rarity = bondRingRarity(item);
  const head = rarity ? `Rank ${rarity} · lends ${name}` : `Lends ${name}`;
  return entry?.description ? `${head}: ${entry.description}` : head;
}

/**
 * The unit already has the skill its ring lends in its equipped list, so the ring adds
 * nothing (a lent copy of a known skill counts once). A benched skill is not equipped, so the
 * ring still lends it.
 */
export function ringSkillAlreadyKnown(unit, ring = unit?.accessory) {
  const id = bondRingSkill(ring);
  if (!id) return false;
  return (Array.isArray(unit?.skills) ? unit.skills : []).some(
    (entry) => (typeof entry === 'string' ? entry : entry?.id) === id,
  );
}

/**
 * The line a unit's ring adds to its skills display, or null: the skill it lends, apart from
 * the equipped list (it never counts toward MAX_SKILLS and cannot be benched or taught).
 * `known` is true when the unit already has that skill equipped, so the ring adds nothing.
 * @returns {{ id: string, name: string, text: string, known: boolean, label: string }|null}
 */
export function lentSkillLine(unit, skills = null) {
  const id = bondRingSkill(unit?.accessory);
  if (!id) return null;
  const entry = Array.isArray(skills) ? skills.find((skill) => skill?.id === id) : null;
  const known = ringSkillAlreadyKnown(unit);
  return {
    id,
    name: boundSkillName(id, skills),
    text: entry?.description || '',
    known,
    label: known ? 'Already known' : 'Lent by ring',
  };
}

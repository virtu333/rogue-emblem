// BondRings.js — accessories that lend a skill (docs/specs/phase3.md 3H). Pure, no Phaser.
//
// "Bond Ring" is one catalog accessory (the family: its lore and no stat effects). Each ring
// INSTANCE rolls a rarity (C/B/A/S) and a bound skill when it is created, and keeps them on the
// instance: `_rarity`, `_boundSkill`, and a `price` set by the rarity (shop price and sell
// value read `item.price`). Saves store whole accessory objects, so the fields persist; the
// catalog entry never carries them, and the item's identity name stays "Bond Ring" (the
// display name, "Bond Ring (B) · Vantage", is `itemDisplayName` in utils/itemNames.js).
//
// A ring lends, it does not teach: EffectiveSkills reads the bound skill on every battle path
// while the ring is equipped, it never counts toward MAX_SKILLS, is never "known", and leaves
// with the ring. The roll lives here and is the only writer of `_boundSkill`.
//
// The tables are data (`bondRings` in lootTables.json): `rarityByAct` weights, `pools` per
// rarity, `priceByRarity`, `neverBound` (skills a ring can never lend, kept even if a pool
// lists one; Steal and Goddess Dance are listed before they exist) and `lentInnates` (the
// personal or class-innate skills the pools lend on purpose). `validateBondRingData` is what
// `npm run validate:data` runs over them.
import { boundSkillOf } from './EffectiveSkills.js';
import { ENEMY_ONLY_CLASS_NAMES } from './UnitManager.js';

/** The accessory family's catalog name; every ring's identity. */
export const BOND_RING_NAME = 'Bond Ring';

/** Rarities, lowest first. */
export const BOND_RARITIES = Object.freeze(['C', 'B', 'A', 'S']);

const ACT_KEYS = Object.freeze(['act1', 'act2', 'act3', 'act4']);

/** Is this item a Bond Ring (family catalog entry or rolled instance)? */
export function isBondRing(item) {
  return Boolean(item) && item.type === 'Accessory' && item.name === BOND_RING_NAME;
}

/** The `bondRings` block of a loot-tables object (or of a gameData that holds one), or null. */
export function bondRingConfig(data) {
  const tables = data?.lootTables ?? data;
  const config = tables?.bondRings;
  return config && typeof config === 'object' && !Array.isArray(config) ? config : null;
}

/**
 * The table an act reads: Act I..IV their own; acts after IV (postAct, the finale) Act IV's,
 * anything unknown Act I's (the same fallback as the event accessory pools).
 */
export function bondRingActKey(act) {
  if (ACT_KEYS.includes(act)) return act;
  return act === 'postAct' || act === 'finalBoss' ? 'act4' : 'act1';
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
export function ringSkillAlreadyKnown(unit) {
  const id = boundSkillOf(unit?.accessory);
  if (!id || !isBondRing(unit.accessory)) return false;
  return (Array.isArray(unit.skills) ? unit.skills : []).some(
    (entry) => (typeof entry === 'string' ? entry : entry?.id) === id,
  );
}

// ── The roll ────────────────────────────────────────────────────────────

/**
 * Can this skill be lent? It exists, is not in `neverBound`, is not an enemy-only class's
 * innate, and, if it is personal or a class innate, is one the config lends on purpose
 * (`lentInnates`). With no catalog entry (`skill` null) only the id list applies.
 */
export function isBindableSkill(id, skill, config) {
  if (typeof id !== 'string' || !id) return false;
  if ((config?.neverBound || []).includes(id)) return false;
  if (!skill) return true;
  const innate = skill.classInnate;
  const classes = Array.isArray(innate) ? innate : innate ? [innate] : [];
  if (classes.length > 0 && classes.every((name) => ENEMY_ONLY_CLASS_NAMES.has(name))) return false;
  if ((skill.personal === true || classes.length > 0) && !(config?.lentInnates || []).includes(id))
    return false;
  return true;
}

/** The skill ids a rarity may roll: its pool, minus anything that cannot be lent. */
export function bondRingPool(config, rarity, skills = null) {
  const pool = Array.isArray(config?.pools?.[rarity]) ? config.pools[rarity] : [];
  const byId = Array.isArray(skills) ? new Map(skills.map((skill) => [skill?.id, skill])) : null;
  return [...new Set(pool)].filter((id) => {
    if (byId && !byId.has(id)) return false;
    return isBindableSkill(id, byId ? byId.get(id) : null, config);
  });
}

function pickRarity(weights, rng) {
  const entries = BOND_RARITIES.map((rarity) => [rarity, Number(weights?.[rarity]) || 0]).filter(
    ([, weight]) => weight > 0,
  );
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  if (total <= 0) return null;
  let roll = rng() * total;
  for (const [rarity, weight] of entries) {
    roll -= weight;
    if (roll < 0) return rarity;
  }
  return entries[entries.length - 1][0];
}

/**
 * Roll one Bond Ring instance for an act: the rarity from `rarityByAct`, then a skill from
 * that rarity's pool, on `rng` (the stream that is creating the ring: Math.random in loot and
 * shops, an event's seeded stream for an event grant). Two draws, always in that order.
 *
 * `data` is `{ lootTables, accessories, skills? }` (a gameData serves). With the skill
 * catalog, a pool entry that does not exist or cannot be lent is skipped before the pick.
 * The instance is a copy of the catalog ring with `_rarity`, `_boundSkill` and the rarity's
 * `price`; it has no uid yet (the caller adds it with the rest of its items).
 *
 * @param {string} act act id ('act1'..'act4'; later acts read Act IV's table)
 * @param {() => number} rng returns [0, 1)
 * @param {{ lootTables?: object, accessories?: object[], skills?: object[] }} data
 * @returns {object|null} the ring, or null when the data holds no ring family or tables
 */
export function rollBondRing(act, rng, data) {
  const config = bondRingConfig(data);
  const family = (data?.accessories || []).find((a) => a?.name === BOND_RING_NAME);
  if (!config || !family) return null;
  const rarity = pickRarity(config.rarityByAct?.[bondRingActKey(act)], rng);
  if (!rarity) return null;
  const pool = bondRingPool(config, rarity, data.skills);
  if (pool.length === 0) return null;
  const skillId = pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))];
  const ring = structuredClone(family);
  const price = Number(config.priceByRarity?.[rarity]);
  if (Number.isFinite(price) && price > 0) ring.price = price;
  ring._rarity = rarity;
  ring._boundSkill = skillId;
  return ring;
}

// ── Validation (npm run validate:data) ──────────────────────────────────

/**
 * Check the ring data against the catalogs. Returns issue strings (empty when sound):
 * the family exists in accessories.json, every act and rarity has weights and a price, every
 * pool skill exists, is not in `neverBound`, is not an enemy-only class's innate and, when
 * personal or a class innate, is listed in `lentInnates`; every `lentInnates` entry is a real
 * personal or class-innate skill that a pool uses; `neverBound` and the pools never overlap;
 * the Act I rarity is C only; and no act's boss rewards list the ring in Act I.
 */
export function validateBondRingData({ lootTables, skills, accessories }) {
  const issues = [];
  const where = 'lootTables.json:bondRings';
  const config = bondRingConfig({ lootTables });
  if (!config) {
    if ((accessories || []).some((a) => a?.name === BOND_RING_NAME))
      issues.push(`${where} is missing (accessories.json defines "${BOND_RING_NAME}")`);
    return issues;
  }
  if (!(accessories || []).some((a) => a?.name === BOND_RING_NAME))
    issues.push(`${where}: accessories.json has no "${BOND_RING_NAME}" entry`);

  const byId = new Map((skills || []).map((skill) => [skill?.id, skill]));
  const used = new Set();
  for (const rarity of BOND_RARITIES) {
    const pool = config.pools?.[rarity];
    if (!Array.isArray(pool) || pool.length === 0) {
      issues.push(`${where}.pools.${rarity} must be a non-empty list`);
      continue;
    }
    if (!(Number(config.priceByRarity?.[rarity]) > 0))
      issues.push(`${where}.priceByRarity.${rarity} must be a positive price`);
    for (const id of pool) {
      used.add(id);
      const skill = byId.get(id);
      if (!skill) {
        issues.push(`${where}.pools.${rarity} references unknown skill "${id}"`);
        continue;
      }
      if ((config.neverBound || []).includes(id)) {
        issues.push(`${where}.pools.${rarity} lists "${id}", which a ring can never lend`);
        continue;
      }
      const innate = skill.classInnate;
      const classes = Array.isArray(innate) ? innate : innate ? [innate] : [];
      if (classes.length > 0 && classes.every((name) => ENEMY_ONLY_CLASS_NAMES.has(name)))
        issues.push(`${where}.pools.${rarity} lists enemy-only skill "${id}"`);
      else if (!isBindableSkill(id, skill, config))
        issues.push(
          `${where}.pools.${rarity} lists personal or class-innate skill "${id}" that is not in lentInnates`,
        );
    }
    if (new Set(pool).size !== pool.length)
      issues.push(`${where}.pools.${rarity} lists a skill twice`);
  }
  for (const id of config.lentInnates || []) {
    const skill = byId.get(id);
    if (!skill) issues.push(`${where}.lentInnates references unknown skill "${id}"`);
    else if (!(skill.personal === true || skill.classInnate))
      issues.push(
        `${where}.lentInnates lists "${id}", which is neither personal nor a class innate`,
      );
    else if ((config.neverBound || []).includes(id))
      issues.push(`${where}.lentInnates lists "${id}", which is in neverBound`);
    else if (!used.has(id)) issues.push(`${where}.lentInnates lists "${id}", which no pool uses`);
  }
  for (const [rarity, pool] of Object.entries(config.pools || {}))
    for (const other of Object.keys(config.pools || {}))
      if (rarity < other)
        for (const id of pool || [])
          if ((config.pools[other] || []).includes(id))
            issues.push(`${where}: "${id}" is in both the ${rarity} and ${other} pools`);

  for (const act of ACT_KEYS) {
    const weights = config.rarityByAct?.[act];
    const total = BOND_RARITIES.reduce((sum, r) => sum + (Number(weights?.[r]) || 0), 0);
    if (!(total > 0)) issues.push(`${where}.rarityByAct.${act} has no weight`);
    for (const rarity of Object.keys(weights || {}))
      if (Number(weights[rarity]) > 0 && !(config.pools?.[rarity]?.length > 0))
        issues.push(`${where}.rarityByAct.${act} weights ${rarity}, which has no pool`);
  }
  const act1 = config.rarityByAct?.act1 || {};
  for (const rarity of BOND_RARITIES)
    if (rarity !== 'C' && Number(act1[rarity]) > 0)
      issues.push(`${where}.rarityByAct.act1 must be rarity C only (found ${rarity})`);

  const act1Boss = lootTables?.act1?.bossRewards?.accessories;
  if (Array.isArray(act1Boss) && act1Boss.includes(BOND_RING_NAME))
    issues.push('lootTables.json:act1.bossRewards.accessories must not list a Bond Ring');
  return issues;
}

// AccessorySkills.js — accessories that can roll a bound skill (docs/specs/phase3.md 3H, as
// the owner reshaped it: no new item family and no rarity tiers). Pure, no Phaser.
//
// When an ordinary accessory INSTANCE is created from loot, shop stock or an event grant, it
// may, rarely, roll a bound skill. The skill lives on the instance (`_boundSkill`), and the
// instance's `price` is raised by `priceMultiplier` (shop price and sell value both read
// `item.price`). Saves store whole accessory objects, so the field persists; the catalog entry
// never carries it and the item's identity name never changes (`accessoryDisplayName` shows
// "Power Ring · Vantage").
//
// A bound skill is lent, not learned: EffectiveSkills reads it on every battle path while the
// accessory is equipped, it never counts toward MAX_SKILLS, is never "known", and leaves with
// the accessory. This module is the only writer of `_boundSkill` for accessories.
//
// Never rolled: legendary accessories (`legendary: true` in accessories.json), and anything
// that is not created by loot, a shop or an event grant (starting kits, meta-granted and
// blessing-granted accessories never pass through here).
//
// The roll must not shift any other draw. Loot and shops draw sequentially from Math.random,
// so one more draw per accessory would move every later result; the roll therefore runs on its
// own keyed stream (`accessorySkillRng`): a hash of the item's uid suffix (itself a product of
// the creating stream's single uid draw, which happens anyway), its name and the act. An event
// grant passes its own seeded sub-stream instead.
//
// The tables are data (`accessorySkills` in lootTables.json). `validateAccessorySkillData` is
// what `npm run validate:data` runs over them.
import { accessorySkillOf } from './AccessorySkillNames.js';
import { ENEMY_ONLY_CLASS_NAMES } from './UnitManager.js';

export {
  ACCESSORY_SKILL_SEPARATOR,
  accessoryDisplayName,
  accessorySkillAlreadyKnown,
  accessorySkillOf,
  accessorySkillText,
  boundSkillName,
  hasAccessorySkill,
  lentSkillLine,
} from './AccessorySkillNames.js';

const ACT_KEYS = Object.freeze(['act1', 'act2', 'act3', 'act4']);

/** The `accessorySkills` block of a loot-tables object (or of a gameData holding one), or null. */
export function accessorySkillConfig(data) {
  const tables = data?.lootTables ?? data;
  const config = tables?.accessorySkills;
  return config && typeof config === 'object' && !Array.isArray(config) ? config : null;
}

/**
 * The table an act reads: Act I..IV their own; acts after IV (postAct, the finale) Act IV's,
 * anything unknown Act I's (the same fallback as the event accessory pools).
 */
export function accessorySkillActKey(act) {
  if (ACT_KEYS.includes(act)) return act;
  return act === 'postAct' || act === 'finalBoss' ? 'act4' : 'act1';
}

/** Can this item roll a bound skill: an accessory, not legendary, with none yet? */
export function canRollAccessorySkill(item) {
  return (
    Boolean(item) &&
    item.type === 'Accessory' &&
    item.legendary !== true &&
    accessorySkillOf(item) === null
  );
}

/**
 * Can this skill be lent? It is not in `neverBound`, is not an enemy-only class's innate,
 * and, if it is personal or a class innate, is one the config lends on purpose
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

/** The skill ids an act may bind: its pool, minus anything that cannot be lent. */
export function accessorySkillPool(config, act, skills = null) {
  const pool = config?.poolByAct?.[accessorySkillActKey(act)];
  const byId = Array.isArray(skills) ? new Map(skills.map((skill) => [skill?.id, skill])) : null;
  return [...new Set(Array.isArray(pool) ? pool : [])].filter((id) => {
    if (byId && !byId.has(id)) return false;
    return isBindableSkill(id, byId ? byId.get(id) : null, config);
  });
}

function hashString(text) {
  // FNV-1a, 32 bit.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The keyed stream an accessory's skill roll runs on: a hash of the uid's random suffix (the
 * part drawn from the creating stream; the leading counter is process state and is left out),
 * the accessory's name and the act. It takes nothing from Math.random, so rolling or not
 * rolling leaves every other draw of the creating stream where it was.
 */
export function accessorySkillRng(item, act) {
  const uid = typeof item?.uid === 'string' ? item.uid : '';
  const suffix = uid.slice(uid.lastIndexOf('_') + 1);
  return mulberry32(
    hashString(`accessory-skill:${accessorySkillActKey(act)}:${item?.name}:${suffix}`),
  );
}

/**
 * Maybe give an accessory instance a bound skill, in place. One draw decides (chance by act);
 * a second picks the skill from the act's pool. Eligible items always spend exactly the first
 * draw; ineligible ones (legendary, not an accessory, already bound) spend none. A bound
 * accessory's price is raised by `priceMultiplier`, which is what the shop quotes and the
 * sale pays.
 *
 * @param {object} item the accessory instance (not the catalog entry)
 * @param {string} act act id ('act1'..'act4'; later acts read Act IV's table)
 * @param {{ lootTables?: object, skills?: object[] }} data a gameData serves
 * @param {() => number} [rng] defaults to the item's keyed stream
 * @param {{ chance?: number|null }} [options] `chance`: the roll's odds in place of the act's
 *   (a start gift's own, docs/specs/blessings-v3.md §7); the pool and price are the act's still
 * @returns {object} the same item
 */
export function bindAccessorySkill(item, act, data, rng = null, { chance: override = null } = {}) {
  if (!canRollAccessorySkill(item)) return item;
  const config = accessorySkillConfig(data);
  if (!config) return item;
  const draw = rng || accessorySkillRng(item, act);
  const chance = Number.isFinite(override)
    ? override
    : Number(config.chanceByAct?.[accessorySkillActKey(act)]) || 0;
  if (!(draw() < chance)) return item;
  const pool = accessorySkillPool(config, act, data?.skills);
  if (pool.length === 0) return item;
  item._boundSkill = pool[Math.min(pool.length - 1, Math.floor(draw() * pool.length))];
  const multiplier = Number(config.priceMultiplier);
  if (Number.isFinite(multiplier) && multiplier > 0 && Number(item.price) > 0)
    item.price = Math.round(item.price * multiplier);
  return item;
}

// ── Validation (npm run validate:data) ──────────────────────────────────

/**
 * Check the accessory-skill data against the catalogs. Returns issue strings (empty when
 * sound): every act has a chance and a pool; every pool skill exists, is not in `neverBound`,
 * is not an enemy-only class's innate and, when personal or a class innate, is listed in
 * `lentInnates`; every `lentInnates` entry is a real personal or class-innate skill some pool
 * uses; the four legendary accessories are marked; the catalog carries no instance field.
 */
export function validateAccessorySkillData({ lootTables, skills, accessories }) {
  const issues = [];
  const where = 'lootTables.json:accessorySkills';
  const config = accessorySkillConfig({ lootTables });
  if (!config) {
    issues.push(`${where} is missing`);
    return issues;
  }
  const byId = new Map((skills || []).map((skill) => [skill?.id, skill]));
  const used = new Set();
  for (const act of ACT_KEYS) {
    const chance = Number(config.chanceByAct?.[act]);
    if (!(chance >= 0 && chance <= 1)) issues.push(`${where}.chanceByAct.${act} must be 0 to 1`);
    const pool = config.poolByAct?.[act];
    if (!Array.isArray(pool) || pool.length === 0) {
      issues.push(`${where}.poolByAct.${act} must be a non-empty list`);
      continue;
    }
    if (new Set(pool).size !== pool.length)
      issues.push(`${where}.poolByAct.${act} lists a skill twice`);
    for (const id of pool) {
      used.add(id);
      const skill = byId.get(id);
      if (!skill) {
        issues.push(`${where}.poolByAct.${act} references unknown skill "${id}"`);
        continue;
      }
      if ((config.neverBound || []).includes(id)) {
        issues.push(`${where}.poolByAct.${act} lists "${id}", which can never be lent`);
        continue;
      }
      const innate = skill.classInnate;
      const classes = Array.isArray(innate) ? innate : innate ? [innate] : [];
      if (classes.length > 0 && classes.every((name) => ENEMY_ONLY_CLASS_NAMES.has(name)))
        issues.push(`${where}.poolByAct.${act} lists enemy-only skill "${id}"`);
      else if (!isBindableSkill(id, skill, config))
        issues.push(
          `${where}.poolByAct.${act} lists personal or class-innate skill "${id}" that is not in lentInnates`,
        );
    }
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
  if (!(Number(config.priceMultiplier) >= 1))
    issues.push(`${where}.priceMultiplier must be at least 1`);

  const legendary = (accessories || []).filter((a) => a?.legendary === true).map((a) => a.name);
  for (const name of ["Mentor's Band", 'Mercury Sandals', 'Phalanx Band', 'Pursuit Ring'])
    if (!legendary.includes(name)) issues.push(`accessories.json:${name} must be marked legendary`);
  for (const accessory of accessories || [])
    if (accessorySkillOf(accessory) !== null)
      issues.push(`accessories.json:${accessory.name} must not carry an instance field`);
  return issues;
}

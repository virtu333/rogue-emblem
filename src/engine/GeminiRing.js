// GeminiRing.js — the Gemini Ring, an accessory that is half of a set (docs: the new
// accessories proposal, /mnt/project-files/reviews/new-accessories.md). Pure, no imports.
//
// Each ring carries one stat (`GEMINI_STATS`) and gives its wearer +bonus to it, like a
// Power Ring. The stat belongs to the INSTANCE: a ring found in Act II might be a SPD ring,
// the next a DEF ring. It is read by `geminiStatOf`: the instance's own `geminiStat` when
// one is stamped, else a hash of its uid's random suffix (the part the creating stream drew
// anyway), so a ring needs no extra draw where it is made, shows the same stat in a shop,
// the loot screen and the bag, and every save keeps it (saves store whole items, uid
// included). Equipping stamps it (`settleGeminiStat`), so the stat never moves once worn,
// even if a uid-less copy is given one later.
//
// The set: while another living ally on the field wears a Gemini Ring, the wearer also
// gets +bonus to that ring's stat (each partner stat once, so three rings with different
// stats give each wearer all three). The partner bonus is a combat modifier
// (`geminiCombatMods`, read by SkillSystem.getSkillCombatMods), so it follows the field as
// it stands at each combat: a partner who falls takes its half with it.
//
// The ring's own stat lives in `unit.stats` like every stat accessory: UnitManager's
// equip/unequip reads `accessoryStatEffects`, which adds it to the catalog `effects`.

export const GEMINI_STATS = Object.freeze(['STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES']);
export const GEMINI_DEFAULT_BONUS = 2;
export const GEMINI_ACTIVATION = Object.freeze({ id: 'gemini_ring', name: 'Gemini Ring' });

/** The ring's `combatEffects.gemini` config ({} for `true`), or null for any other item. */
export function geminiConfig(item) {
  const raw = item?.combatEffects?.gemini;
  if (raw === true) return {};
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
}

export function isGeminiRing(item) {
  return geminiConfig(item) !== null;
}

/** How much the ring gives, to its own stat and to each partner's. */
export function geminiBonus(item) {
  const n = Math.trunc(Number(geminiConfig(item)?.bonus));
  return Number.isFinite(n) && n > 0 ? n : GEMINI_DEFAULT_BONUS;
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

/**
 * The stat this ring carries: its stamped `geminiStat`, else one hashed from its uid's
 * random suffix, else null (a uid-less copy that was never worn: a catalog row).
 */
export function geminiStatOf(item) {
  if (!isGeminiRing(item)) return null;
  if (GEMINI_STATS.includes(item.geminiStat)) return item.geminiStat;
  const uid = typeof item.uid === 'string' ? item.uid : '';
  if (!uid) return null;
  const suffix = uid.slice(uid.lastIndexOf('_') + 1);
  return GEMINI_STATS[hashString(`gemini:${suffix}`) % GEMINI_STATS.length];
}

/** Stamp the ring's stat on the instance (its derived one, else the first). Returns the item. */
export function settleGeminiStat(item) {
  if (!isGeminiRing(item) || GEMINI_STATS.includes(item.geminiStat)) return item;
  item.geminiStat = geminiStatOf(item) ?? GEMINI_STATS[0];
  return item;
}

/**
 * The stats an accessory adds while worn: its `effects`, plus a Gemini Ring's own stat.
 * The one reader of an accessory's stat bonus (equip, unequip and its text).
 */
export function accessoryStatEffects(item) {
  const base = item?.effects && typeof item.effects === 'object' ? { ...item.effects } : {};
  const stat = geminiStatOf(item);
  if (stat) base[stat] = (Number(base[stat]) || 0) + geminiBonus(item);
  return base;
}

const living = (u) => Boolean(u) && (Number(u.currentHP) || 0) > 0 && u._removing !== true;

/**
 * The partner stats a Gemini Ring wearer draws on: one entry per distinct stat among the
 * OTHER living allies' rings, each at its ring's bonus (the larger, should two differ).
 * Empty when the unit wears no Gemini Ring.
 * @returns {Array<{ stat: string, bonus: number }>}
 */
export function geminiPartnerStats(unit, allies) {
  if (!isGeminiRing(unit?.accessory)) return [];
  const byStat = new Map();
  for (const ally of Array.isArray(allies) ? allies : []) {
    if (ally === unit || !living(ally) || !isGeminiRing(ally.accessory)) continue;
    const stat = geminiStatOf(ally.accessory);
    if (!stat) continue;
    byStat.set(stat, Math.max(byStat.get(stat) || 0, geminiBonus(ally.accessory)));
  }
  return GEMINI_STATS.filter((stat) => byStat.has(stat)).map((stat) => ({
    stat,
    bonus: byStat.get(stat),
  }));
}

/**
 * The partner stats as combat modifiers, exactly what +N to the stat changes in a combat
 * (Combat.js's formulas): STR or MAG raise damage when the weapon strikes with that stat
 * (`magic`: Combat.usesMagic), SKL Hit (x2) and Crit (floor(SKL / 2)), SPD Attack Speed
 * and Avoid (x2), DEF and RES their defence.
 */
export function geminiCombatMods(unit, allies, { magic = false } = {}) {
  const mods = {
    atkBonus: 0,
    hitBonus: 0,
    critBonus: 0,
    avoidBonus: 0,
    spdBonus: 0,
    defBonus: 0,
    resBonus: 0,
  };
  const partners = geminiPartnerStats(unit, allies);
  const skl = Number(unit?.stats?.SKL) || 0;
  for (const { stat, bonus } of partners) {
    if (stat === 'STR' && !magic) mods.atkBonus += bonus;
    if (stat === 'MAG' && magic) mods.atkBonus += bonus;
    if (stat === 'SKL') {
      mods.hitBonus += bonus * 2;
      mods.critBonus += Math.floor((skl + bonus) / 2) - Math.floor(skl / 2);
    }
    if (stat === 'SPD') {
      mods.spdBonus += bonus;
      mods.avoidBonus += bonus * 2;
    }
    if (stat === 'DEF') mods.defBonus += bonus;
    if (stat === 'RES') mods.resBonus += bonus;
  }
  return { mods, partners };
}

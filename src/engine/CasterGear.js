// CasterGear.js — which enemy casters carry a status staff or a siege tome
// (docs/specs/dusk-pressure.md §2c). Pure, no Phaser, never draws Math.random.
//
// A rung's `statusStaffConfig` / `siegeWeaponConfig` in difficulty.json with
// `perBattle: true` gives, per act, the chance that a battle has one: it is rolled only
// when an eligible caster is on the map (Mage, Sage or Bishop for staves; Sage, Warlock,
// Dark Knight or Grandmaster for siege), so the chance is the share of such battles that
// get one. With `maxPerBattle` above 1, each further one takes another roll at the same
// chance. The siege tome is assigned first; a caster never carries both.
//
// The rolls come from their own stream, hashed from the generated garrison (which the
// battle seed already fixes), so they never move the map generator's Math.random draws:
// a map is the same with or without them, only its casters' gear differs. MapGenerator
// writes the flags into the spawns, so a locked map, a resume or a Vision rewind keeps
// them; EnemySpawnGear turns them into the unit's gear for BattleScene and the harness.
//
// A config without `perBattle` is the old per-spawn roll (a run saved before this kept
// its rung's old numbers); MapGenerator still rolls those per spawn.
import { SIEGE_ELIGIBLE_CLASSES, STATUS_STAFF_ELIGIBLE_CLASSES } from '../utils/constants.js';

export const STATUS_STAFF_KINDS = Object.freeze(['sleep', 'silence']);

/** True when a rung's staff or siege config uses the per-battle chance. */
export function isPerBattleGearConfig(cfg) {
  return Boolean(cfg && typeof cfg === 'object' && cfg.perBattle === true);
}

/** The per-battle chance for an act (0 when absent). */
export function gearChanceFor(cfg, act) {
  const chance = Number(cfg?.[act]);
  return Number.isFinite(chance) && chance > 0 ? Math.min(1, chance) : 0;
}

export function fnv1a(input) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The roll stream for a garrison: same spawns, act and rung, same rolls. */
export function casterGearStream({ spawns, act, difficultyId, templateId }) {
  const key = [
    'caster-gear',
    act,
    difficultyId || 'normal',
    templateId || '',
    ...(spawns || []).map((s) => `${s.className}@${s.col},${s.row}:${s.level}`),
  ].join('|');
  return mulberry32(fnv1a(key));
}

/**
 * Give up to `max` eligible spawns the gear, one roll per slot at `chance`, stopping at
 * the first miss. Mutates the chosen spawns through `give`.
 */
function rollSlots(rand, eligible, chance, max, give) {
  const free = [...eligible];
  for (let slot = 0; slot < max && free.length > 0; slot++) {
    if (!(rand() < chance)) break;
    const pick = free.splice(Math.floor(rand() * free.length), 1)[0];
    give(pick);
  }
}

/**
 * Assign the per-battle staves and siege tomes (mutates `spawns`). Configs without
 * `perBattle` are left to the per-spawn roll in MapGenerator.
 * @returns {{ siege: number, staves: number }}
 */
export function assignCasterGear(
  spawns,
  { act, difficultyId, templateId, statusStaffConfig = null, siegeWeaponConfig = null } = {},
) {
  const out = { siege: 0, staves: 0 };
  const staffCfg = isPerBattleGearConfig(statusStaffConfig) ? statusStaffConfig : null;
  const siegeCfg = isPerBattleGearConfig(siegeWeaponConfig) ? siegeWeaponConfig : null;
  if (!staffCfg && !siegeCfg) return out;
  const rand = casterGearStream({ spawns, act, difficultyId, templateId });
  const field = (spawns || []).filter((s) => s && !s.isBoss && !s.isEntity);

  // Two independent rolls from the one stream, in a fixed order: siege, then staves.
  const siegeChance = gearChanceFor(siegeCfg, act);
  const siegeEligible = field.filter((s) => SIEGE_ELIGIBLE_CLASSES.has(s.className));
  if (siegeCfg?.weaponName && siegeChance > 0 && siegeEligible.length > 0) {
    const max = Math.max(0, Math.trunc(Number(siegeCfg.maxPerBattle) || 0));
    rollSlots(rand, siegeEligible, siegeChance, max, (s) => {
      s.siegeWeapon = siegeCfg.weaponName;
      out.siege++;
    });
  }

  const staffChance = gearChanceFor(staffCfg, act);
  const staffEligible = field.filter(
    (s) => STATUS_STAFF_ELIGIBLE_CLASSES.has(s.className) && !s.siegeWeapon,
  );
  const kinds = (Array.isArray(staffCfg?.kinds) ? staffCfg.kinds : STATUS_STAFF_KINDS).filter((k) =>
    STATUS_STAFF_KINDS.includes(k),
  );
  if (staffChance > 0 && staffEligible.length > 0 && kinds.length > 0) {
    const max = Math.max(0, Math.trunc(Number(staffCfg.maxPerBattle) || 0));
    rollSlots(rand, staffEligible, staffChance, max, (s) => {
      s.statusStaff = kinds[Math.floor(rand() * kinds.length)];
      out.staves++;
    });
  }
  return out;
}

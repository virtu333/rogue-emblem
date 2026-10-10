// EnemyCarry — which enemies carry an item a Thief can steal (docs/specs/phase3.md 3G).
// Pure, no Phaser, never draws Math.random.
//
// A rung's `carryConfig` in difficulty.json gives, per act, the chance that a battle has a
// carrier; with `maxPerBattle` above 1 each further carrier takes another roll at the same
// chance, and the first miss ends the rolls (the same shape as CasterGear.js). A carrier is
// any ordinary field enemy: never an act boss or an elite captain (`isBoss`), the Entity,
// an authored spawn (the prologue's), or a Skeleton. Skeletons are raised mid-battle and
// are never in a garrison, so they are never rolled, and `isCarrierEligible` still refuses
// one so that a future path that hands a raised unit a spawn cannot mint loot from it
// (Necromancy.buildRaisedSkeleton: a raise is repeatable, so it must stay worth nothing).
//
// What it carries is drawn from the act's `carryPool` in lootTables.json (weighted
// entries: a named item, or a draw from the act's `statBooster` list). The roll writes
// `spawn.carries` (the item's name) and, for an entry that names one, `spawn.carryValue`
// (a Gold Pouch's gold). Like the caster gear, the roll comes from its own stream hashed
// from the generated garrison, so it never moves the map generator's Math.random draws and
// a locked map, a resume or a Vision rewind keeps its carriers. EnemySpawnGear turns the
// flag into `unit.carriedItem` for BattleScene and the headless harness.
//
// A carrier killed before its item is stolen loses it: nothing drops (spec Q4), so Steal is
// the only way to the item and the economy stays predictable.
import { fnv1a, gearChanceFor, isPerBattleGearConfig, mulberry32 } from './CasterGear.js';
import { isGoldPouch, makeGoldPouch } from './GoldPouch.js';

export const CARRY_ACTS = Object.freeze(['act1', 'act2', 'act3', 'act4', 'finalBoss']);
export const SKELETON_CLASS_NAME = 'Skeleton';

/**
 * The roll stream for a garrison: same spawns, act and rung, same rolls. `pass` > 0 is a further
 * pass's own stream (Cutpurse's Luck), so the first pass's rolls never move.
 */
export function carryStream({ spawns, act, difficultyId, templateId, pass = 0 }) {
  const key = [
    pass > 0 ? `enemy-carry#${pass}` : 'enemy-carry',
    act,
    difficultyId || 'normal',
    templateId || '',
    ...(spawns || []).map((s) => `${s.className}@${s.col},${s.row}:${s.level}`),
  ].join('|');
  return mulberry32(fnv1a(key));
}

/**
 * Can this spawn (or unit) carry an item? Never a boss or elite captain, the Entity, an
 * authored spawn, a Skeleton or a raised or zero-XP unit (docs/specs/phase3.md 3G).
 */
export function isCarrierEligible(spawn) {
  if (!spawn || typeof spawn !== 'object') return false;
  if (spawn.isBoss || spawn.isEntity || spawn._noXP) return false;
  if (typeof spawn.authoredId === 'string' && spawn.authoredId) return false;
  if (typeof spawn._raisedBy === 'string' && spawn._raisedBy) return false;
  return spawn.className !== SKELETON_CLASS_NAME;
}

/** The act's weighted carry pool as entries with a positive weight (never null). */
export function carryPoolFor(lootTables, act) {
  const pool = lootTables?.[act]?.carryPool;
  return (Array.isArray(pool) ? pool : []).filter(
    (entry) => entry && Number.isFinite(entry.weight) && entry.weight > 0,
  );
}

/**
 * One pool entry, resolved to what the spawn carries: `{ name, value? }`, or null when the
 * entry names nothing (a `from` list that is empty). Two draws from `rand` always (the
 * entry, then the list index), so the stream's position does not depend on the pick.
 */
function drawCarried(rand, pool, table) {
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0);
  let roll = rand() * total;
  let entry = pool[pool.length - 1];
  for (const candidate of pool) {
    roll -= candidate.weight;
    if (roll < 0) {
      entry = candidate;
      break;
    }
  }
  const index = rand();
  if (typeof entry.item === 'string' && entry.item) {
    return entry.value === undefined
      ? { name: entry.item }
      : { name: entry.item, value: entry.value };
  }
  const list = Array.isArray(table?.[entry.from]) ? table[entry.from] : [];
  if (list.length === 0) return null;
  return { name: list[Math.floor(index * list.length)] };
}

/**
 * Assign the carried items (mutates `spawns`): up to `maxPerBattle` eligible spawns get
 * `carries` (and `carryValue`), one roll per slot at the act's chance, stopping at the
 * first miss. A config without `perBattle`, an act with no chance or no pool, or a garrison
 * with nothing eligible, assigns nothing and draws nothing.
 *
 * `passes` (Cutpurse's Luck: `battleParams.carryPasses`) runs the whole roll that many times,
 * each further pass on its own stream over the spawns still empty-handed, so the first pass is
 * exactly the roll without the blessing and the expected carriers double (two passes).
 * @returns {{ carriers: number }}
 */
export function assignEnemyCarry(
  spawns,
  { act, difficultyId, templateId, carryConfig = null, lootTables = null, passes = 1 } = {},
) {
  const out = { carriers: 0 };
  const count = Math.max(1, Math.min(4, Math.trunc(Number(passes) || 1)));
  for (let pass = 0; pass < count; pass++)
    out.carriers += carryPass(spawns, {
      act,
      difficultyId,
      templateId,
      carryConfig,
      lootTables,
      pass,
    });
  return out;
}

/** One pass of `assignEnemyCarry`: the number of carriers it added. */
function carryPass(spawns, { act, difficultyId, templateId, carryConfig, lootTables, pass }) {
  let carriers = 0;
  if (!isPerBattleGearConfig(carryConfig)) return carriers;
  const chance = gearChanceFor(carryConfig, act);
  const max = Math.max(0, Math.trunc(Number(carryConfig.maxPerBattle) || 0));
  const pool = carryPoolFor(lootTables, act);
  const eligible = (spawns || []).filter((s) => isCarrierEligible(s) && !s.carries);
  if (chance <= 0 || max <= 0 || pool.length === 0 || eligible.length === 0) return carriers;
  const rand = carryStream({ spawns, act, difficultyId, templateId, pass });
  const free = [...eligible];
  for (let slot = 0; slot < max && free.length > 0; slot++) {
    if (!(rand() < chance)) break;
    const spawn = free.splice(Math.floor(rand() * free.length), 1)[0];
    const carried = drawCarried(rand, pool, lootTables[act]);
    if (!carried) continue;
    spawn.carries = carried.name;
    if (carried.value !== undefined) spawn.carryValue = carried.value;
    carriers++;
  }
  return carriers;
}

/**
 * A deterministic uid for a spawn's carried item, from the battle's key, the tile and the
 * name: made without Math.random (so the battle stream is untouched) and the same across a
 * rebuild of the same battle. The battle key keeps two battles' items apart.
 */
export function carriedItemUid(spawn, battleKey = '') {
  const key = `carry|${battleKey}|${spawn?.col},${spawn?.row}|${spawn?.carries}`;
  return `itm_carry_${fnv1a(key).toString(36)}`;
}

/**
 * The whole item a carrier holds, from the run's consumable catalog (a Vulnerary at the
 * uses the run gives it: `run.getConsumableCatalog()`) or, for a weapon name, the weapon
 * catalog. A fresh copy with a uid, or null when the spawn carries nothing or the name is
 * unknown.
 * @param {{ carries?: string, carryValue?: number, col?: number, row?: number }} spawn
 * @param {{ consumables?: object[], weapons?: object[], battleKey?: string }} deps
 */
export function buildCarriedItem(spawn, { consumables = [], weapons = [], battleKey = '' } = {}) {
  const name = spawn?.carries;
  if (typeof name !== 'string' || !name) return null;
  const consumable = (consumables || []).find((entry) => entry?.name === name);
  const weapon = consumable ? null : (weapons || []).find((entry) => entry?.name === name);
  const template = consumable || weapon;
  if (!template || template.type === 'Scroll') return null;
  const item =
    isGoldPouch(template) && Number.isFinite(spawn.carryValue)
      ? makeGoldPouch(template, spawn.carryValue)
      : structuredClone(template);
  item.uid = carriedItemUid(spawn, battleKey);
  return item;
}

/**
 * Data check for the carry pools (tools/validateCrossReferences.js): every act has a
 * non-empty pool of weighted entries, each a catalog item (a consumable, or a weapon that
 * is not a scroll) or a draw from a non-empty list of the act's own table; a Gold Pouch
 * names its value and nothing else does.
 * @returns {string[]} the problems found (empty when sound)
 */
export function validateCarryPools({ lootTables, consumables, weapons }) {
  const issues = [];
  const consumable = new Map((consumables || []).map((c) => [c?.name, c]));
  const weapon = new Map((weapons || []).map((w) => [w?.name, w]));
  for (const act of CARRY_ACTS) {
    const where = `lootTables.json:${act}.carryPool`;
    const table = lootTables?.[act];
    const pool = table?.carryPool;
    if (!Array.isArray(pool) || pool.length === 0) {
      issues.push(`${where} must list at least one entry`);
      continue;
    }
    for (const entry of pool) {
      if (!(Number.isFinite(entry?.weight) && entry.weight > 0))
        issues.push(`${where} entry needs a positive weight`);
      if (typeof entry?.item === 'string') {
        const found = consumable.get(entry.item) || weapon.get(entry.item);
        if (!found) issues.push(`${where} references unknown item "${entry.item}"`);
        else if (found.type === 'Scroll')
          issues.push(`${where} lists "${entry.item}": a scroll is never carried`);
        if (found && isGoldPouch(found)) {
          if (!(Number.isInteger(entry.value) && entry.value > 0))
            issues.push(`${where} "${entry.item}" must name its gold value`);
        } else if (entry.value !== undefined) {
          issues.push(`${where} "${entry.item}" is not a Gold Pouch and takes no value`);
        }
      } else if (typeof entry?.from === 'string') {
        const list = table[entry.from];
        if (!Array.isArray(list) || list.length === 0)
          issues.push(`${where} draws from "${entry.from}", which is empty in ${act}`);
        else
          for (const name of list)
            if (!consumable.has(name) && !weapon.has(name))
              issues.push(`${where} draws unknown item "${name}" from ${entry.from}`);
      } else {
        issues.push(`${where} entry names neither an item nor a list to draw from`);
      }
    }
  }
  return issues;
}

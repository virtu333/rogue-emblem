// ActionAbilitySystem — pure helpers for utility abilities: "action"-trigger
// skills carrying structured `actionAbility` data (Blink, Rally Cry, Healing
// Circle, Ensnare, Smite, Transfuse). Battle actions that appear in the Ability
// submenu of the unit action menu. No Phaser dependencies.
//
// Gating rules:
// - Silence blocks abilities (they are shouts/spells — same rule as staves
//   and weapon arts), unless the ability says `usableWhileSilenced` (Smite and
//   Transfuse are bodily acts, like Shove and Pull, which silence never blocked).
// - Root does NOT block abilities: root prevents movement, not acting.
// - `perMapLimit` uses are tracked on `unit._battleAbilityUsage`, mirroring
//   the weapon-art `_battleWeaponArtUsage` counter (survives suspend/resume
//   and Vision rewinds; scrubbed between battles by RunManager.serializeUnit).
//   An ability without a `perMapLimit` is usable every turn and counts nothing.
//
// Targeted abilities (`push_enemy`, `transfer_hp`) pick an adjacent unit. Their
// finders take a `ctx` of what the player may know ({ grid, getUnitAt, enemies,
// allies, affixes }): the caller passes seen foes and a `getUnitAt` that counts a
// fogged tile as taken (BattleInformation.seenTileOccupant), so a hidden unit can
// never change what a preview offers. Execution re-runs the same finder.
import { settleMoves } from './ActionMovement.js';
import { damageUnit, healUnit } from './UnitHealth.js';
import { allyBuff } from './PostCombatEffects.js';
import { applyCondition, isRooted, isSilenced, isWounded } from './StatusConditionSystem.js';
import { gridDistance } from './Combat.js';
import { getFootprintKeys, isEntity } from './EntitySystem.js';
import { isDisplacementImmune } from './AffixSystem.js';

/** Ability kinds the engine + BattleScene glue know how to execute. */
export const ACTION_ABILITY_KINDS = new Set([
  'teleport_self',
  'ally_buff',
  'aoe_heal',
  'aoe_root',
  'push_enemy',
  'transfer_hp',
]);

/** Kinds that pick one adjacent unit (SELECTING_ABILITY_TILE, on the unit's tile). */
export const TARGETED_ABILITY_KINDS = new Set(['push_enemy', 'transfer_hp']);

const CARDINALS = Object.freeze([
  { dc: 0, dr: -1 },
  { dc: 0, dr: 1 },
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
]);

/**
 * A unit's action-trigger skills that carry structured actionAbility data.
 * Legacy hardcoded action skills (shove/pull/dance) have no actionAbility
 * field and are deliberately excluded — they keep their bespoke menu entries.
 * @returns {Array<object>} skill entries (each with `.actionAbility`)
 */
export function getActionAbilities(unit, skillsData) {
  if (!unit || !Array.isArray(unit.skills) || !Array.isArray(skillsData)) return [];
  const byId = new Map(
    skillsData.filter((skill) => typeof skill?.id === 'string' && skill.id).map((s) => [s.id, s]),
  );
  const abilities = [];
  for (const skillId of unit.skills) {
    const skill = byId.get(skillId);
    if (!skill || skill.trigger !== 'action') continue;
    const ability = skill.actionAbility;
    if (!ability || typeof ability !== 'object') continue;
    if (!ACTION_ABILITY_KINDS.has(ability.kind)) continue;
    abilities.push(skill);
  }
  return abilities;
}

/** Times this unit has used the given ability this battle. */
export function getAbilityUsageCount(unit, abilityId) {
  if (!unit || !abilityId) return 0;
  const raw = Number(unit._battleAbilityUsage?.map?.[abilityId]);
  return Number.isFinite(raw) && raw > 0 ? Math.trunc(raw) : 0;
}

/**
 * Can the unit use this ability right now? Checks the per-map usage counter
 * and silence. Root deliberately does not block (root allows acting).
 * @returns {{ ok: boolean, reason: string|null }}
 */
export function canUseAbility(unit, skill) {
  if (!unit || !skill?.id || !skill.actionAbility || typeof skill.actionAbility !== 'object') {
    return { ok: false, reason: 'invalid_input' };
  }
  if (isSilenced(unit) && skill.actionAbility.usableWhileSilenced !== true)
    return { ok: false, reason: 'silenced' };
  const limit = Math.max(0, Math.trunc(Number(skill.actionAbility.perMapLimit) || 0));
  if (limit > 0 && getAbilityUsageCount(unit, skill.id) >= limit) {
    return { ok: false, reason: 'per_map_limit' };
  }
  return { ok: true, reason: null };
}

/** Record one use of the ability on the unit's per-battle counter. */
export function markUsed(unit, abilityId) {
  if (!unit || !abilityId) return;
  if (!unit._battleAbilityUsage || typeof unit._battleAbilityUsage !== 'object') {
    unit._battleAbilityUsage = { map: {} };
  }
  if (!unit._battleAbilityUsage.map || typeof unit._battleAbilityUsage.map !== 'object') {
    unit._battleAbilityUsage.map = {};
  }
  unit._battleAbilityUsage.map[abilityId] = getAbilityUsageCount(unit, abilityId) + 1;
}

/**
 * Legal Blink destinations: the FULL diamond of in-bounds, passable,
 * unoccupied tiles within `range` (unlike AffixSystem.getWarpCandidates,
 * which keeps only the maximum-distance ring for the Teleporter affix).
 * @returns {Array<{col: number, row: number}>}
 */
export function getBlinkTiles(unit, range, grid, getUnitAt) {
  const tiles = [];
  if (!unit || !grid) return tiles;
  const r = Math.max(0, Math.trunc(Number(range) || 0));
  for (let dr = -r; dr <= r; dr++) {
    for (let dc = -r; dc <= r; dc++) {
      if (dr === 0 && dc === 0) continue;
      if (Math.abs(dr) + Math.abs(dc) > r) continue;
      const col = unit.col + dc;
      const row = unit.row + dr;
      if (col < 0 || col >= grid.cols || row < 0 || row >= grid.rows) continue;
      if (typeof getUnitAt === 'function' && getUnitAt(col, row)) continue;
      if (grid.getMoveCost(col, row, unit.moveType) === Infinity) continue;
      tiles.push({ col, row });
    }
  }
  return tiles;
}

/**
 * Units within the ability's radius of the caster (self-centered AOE).
 * The caster itself is included only when `ability.includeSelf === true`.
 * Dead units are excluded. Faction filtering is the caller's job — pass the
 * appropriate ally or enemy list.
 */
export function collectAffected(unit, ability, units) {
  if (!unit || !ability || typeof ability !== 'object' || !Array.isArray(units)) return [];
  const radius = Math.max(0, Math.trunc(Number(ability.radius) || 0));
  const includeSelf = ability.includeSelf === true;
  return units
    .filter((candidate) => candidate && candidate.currentHP > 0)
    .filter((candidate) => (candidate === unit ? includeSelf : true))
    .filter(
      (candidate) => gridDistance(unit.col, unit.row, candidate.col, candidate.row) <= radius,
    );
}

/**
 * Does this ability currently have anything worthwhile to affect?
 * - teleport_self: at least one legal destination tile
 * - ally_buff / aoe_root: at least one affected unit
 * - aoe_heal: at least one affected unit missing HP
 * - push_enemy / transfer_hp: at least one legal adjacent target
 * @param {object} ctx { grid, getUnitAt, allies, enemies, affixes }
 */
export function abilityHasTargets(unit, skill, ctx = {}) {
  const ability = skill?.actionAbility;
  if (!unit || !ability || typeof ability !== 'object') return false;
  const allies = Array.isArray(ctx.allies) ? ctx.allies : [];
  const enemies = Array.isArray(ctx.enemies) ? ctx.enemies : [];
  switch (ability.kind) {
    case 'teleport_self':
      return getBlinkTiles(unit, ability.range, ctx.grid, ctx.getUnitAt).length > 0;
    case 'ally_buff':
      return collectAffected(unit, ability, allies).length > 0;
    case 'aoe_heal':
      return collectAffected(unit, ability, allies).some(
        (target) => (Number(target.currentHP) || 0) < (Number(target.stats?.HP) || 0),
      );
    case 'aoe_root':
      return collectAffected(unit, ability, enemies).length > 0;
    case 'push_enemy':
      return findSmiteTargets(unit, ability, ctx).length > 0;
    case 'transfer_hp':
      return findTransfuseTargets(unit, ability, ctx).length > 0;
    default:
      return false;
  }
}

/** All domain writes land before any ability effects are rendered. */
export function settleBlink(unit, skill, tile) {
  markUsed(unit, skill.id);
  return { moves: settleMoves([{ unit, to: tile }]), usage: getAbilityUsageCount(unit, skill.id) };
}

export function settleHealingCircle(unit, ability, pool) {
  const amount = Math.max(0, Math.trunc(Number(ability.amount) || 0));
  return collectAffected(unit, ability, pool).map((target) => {
    const hpBefore = target.currentHP;
    const healed = healUnit(target, amount);
    return { unit: target, hpBefore, hpAfter: target.currentHP, healed };
  });
}

export function settleEnsnare(unit, ability, pool) {
  const duration = Math.max(1, Math.trunc(Number(ability.durationPhases) || 1));
  return collectAffected(unit, ability, pool).map((target) => ({
    unit: target,
    rooted: applyCondition(target, 'root', duration + 1, { recoveryChance: 0 }),
  }));
}

export function settleRally(step, unit, world) {
  return [...allyBuff(step, unit, world)];
}

// --- Smite (push_enemy): shove an adjacent foe `distance` tiles straight away ---

const liveUnit = (unit) => Boolean(unit) && unit.currentHP > 0 && !unit._removing;

/** The live unit of `units` whose footprint covers the tile (an Entity covers nine). */
function unitCovering(units, col, row) {
  const key = `${col},${row}`;
  return (
    (units || []).find((unit) => {
      if (!liveUnit(unit)) return false;
      return isEntity(unit)
        ? getFootprintKeys(unit).includes(key)
        : unit.col === col && unit.row === row;
    }) || null
  );
}

/**
 * Why a foe cannot be smitten, or null when it can. Bosses and the Entity never
 * move; Anchored (the affix that keeps its holder put) and root pin a unit against
 * every push, exactly as WeaponArtPostCombat.resolvePostCombatMove pins them.
 * @returns {'boss'|'entity'|'anchored'|'rooted'|null}
 */
export function smiteBlockReason(foe, affixData) {
  if (isEntity(foe)) return 'entity';
  if (foe.isBoss) return 'boss';
  if (isDisplacementImmune(foe, affixData)) return 'anchored';
  if (isRooted(foe)) return 'rooted';
  return null;
}

/**
 * Where a push of `target` lands: up to `distance` tiles along (dc, dr), stopping
 * before the edge, impassable ground (for the target's own move type) or a unit.
 * @returns {{ col: number, row: number, steps: number }|null} null when the first tile is blocked
 */
export function traceSmite(target, dc, dr, distance, grid, getUnitAt) {
  let col = target.col;
  let row = target.row;
  let steps = 0;
  for (let i = 0; i < distance; i++) {
    const nextCol = col + dc;
    const nextRow = row + dr;
    if (nextCol < 0 || nextCol >= grid.cols || nextRow < 0 || nextRow >= grid.rows) break;
    if (grid.getMoveCost(nextCol, nextRow, target.moveType) === Infinity) break;
    if (typeof getUnitAt === 'function' && getUnitAt(nextCol, nextRow)) break;
    col = nextCol;
    row = nextRow;
    steps++;
  }
  return steps > 0 ? { col, row, steps } : null;
}

/**
 * Foes `unit` can smite: one per side, adjacent, not pinned, with a free first tile.
 * A free first tile and nothing beyond it moves the foe one tile, not two.
 * Terrain is not special: Shove puts an ally on whatever ground it can stand on
 * (ice, lava, acid) with no slide and no damage, and Smite does the same to a foe;
 * the ground works on it at the end of its own phase, as it would after any move.
 * @returns {Array<{ unit: object, destCol: number, destRow: number, dc: number, dr: number, steps: number }>}
 */
export function findSmiteTargets(unit, ability, ctx = {}) {
  const { grid, getUnitAt, enemies, affixes } = ctx;
  if (!unit || !grid || !Array.isArray(enemies)) return [];
  const distance = Math.max(1, Math.trunc(Number(ability?.distance) || 1));
  const targets = [];
  for (const { dc, dr } of CARDINALS) {
    const foe = unitCovering(enemies, unit.col + dc, unit.row + dr);
    if (!foe || foe === unit || smiteBlockReason(foe, affixes)) continue;
    const landing = traceSmite(foe, dc, dr, distance, grid, getUnitAt);
    if (!landing) continue;
    targets.push({
      unit: foe,
      destCol: landing.col,
      destRow: landing.row,
      dc,
      dr,
      steps: landing.steps,
    });
  }
  return targets;
}

/**
 * The push, settled: the foe's coordinates change and, if it was holding position,
 * the move wakes its pack (ActionMovement.settleMoves marks it disturbed). No HP, no RNG.
 */
export function settleSmite(target) {
  return {
    moves: settleMoves([{ unit: target.unit, to: { col: target.destCol, row: target.destRow } }]),
    steps: target.steps,
  };
}

// --- Transfuse (transfer_hp): give HP to an adjacent ally ---

/**
 * HP the giver can hand over: the ability's cap, what the giver can spare (never
 * its last HP) and what the ally is missing. 0 means nothing to give.
 */
export function transfuseAmount(giver, ally, ability) {
  const cap = Math.max(1, Math.trunc(Number(ability?.amount) || 1));
  const spare = (Number(giver?.currentHP) || 0) - 1;
  const missing = (Number(ally?.stats?.HP) || 0) - (Number(ally?.currentHP) || 0);
  return Math.max(0, Math.min(cap, spare, missing));
}

/**
 * Allies `unit` can transfuse: adjacent, alive, missing HP and able to recover it
 * (a Wounded ally recovers nothing except from a staff, so giving would only burn HP).
 * @returns {Array<{ unit: object, amount: number, dc: number, dr: number }>}
 */
export function findTransfuseTargets(unit, ability, ctx = {}) {
  const { allies } = ctx;
  if (!liveUnit(unit) || !Array.isArray(allies)) return [];
  const targets = [];
  for (const { dc, dr } of CARDINALS) {
    const ally = unitCovering(allies, unit.col + dc, unit.row + dr);
    if (!ally || ally === unit || isWounded(ally)) continue;
    const amount = transfuseAmount(unit, ally, ability);
    if (amount > 0) targets.push({ unit: ally, amount, dc, dr });
  }
  return targets;
}

/**
 * The transfer, settled through UnitHealth so HP accessory debt holds: the ally is
 * healed first and the giver pays exactly what the ally received, never below 1 HP.
 */
export function settleTransfuse(giver, target, ability) {
  const giverBefore = giver.currentHP;
  const allyBefore = target.unit.currentHP;
  const given = healUnit(target.unit, transfuseAmount(giver, target.unit, ability));
  const paid = given > 0 ? damageUnit(giver, given, { floor: 1, disturbs: false }) : 0;
  return {
    giver,
    ally: target.unit,
    given,
    paid,
    giverBefore,
    giverAfter: giver.currentHP,
    allyBefore,
    allyAfter: target.unit.currentHP,
  };
}

// ActionAbilitySystem — pure helpers for utility abilities: "action"-trigger
// skills carrying structured `actionAbility` data (Blink, Rally Cry, Healing
// Circle, Ensnare). Limited-use battle actions that appear in the Ability
// submenu of the unit action menu. No Phaser dependencies.
//
// Gating rules:
// - Silence blocks abilities (they are shouts/spells — same rule as staves
//   and weapon arts).
// - Root does NOT block abilities: root prevents movement, not acting.
// - `perMapLimit` uses are tracked on `unit._battleAbilityUsage`, mirroring
//   the weapon-art `_battleWeaponArtUsage` counter (survives suspend/resume
//   and Vision rewinds; scrubbed between battles by RunManager.serializeUnit).
import { isSilenced } from './StatusConditionSystem.js';
import { gridDistance } from './Combat.js';

/** Ability kinds the engine + BattleScene glue know how to execute. */
export const ACTION_ABILITY_KINDS = new Set(['teleport_self', 'ally_buff', 'aoe_heal', 'aoe_root']);

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
  if (isSilenced(unit)) return { ok: false, reason: 'silenced' };
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
 * @param {object} ctx { grid, getUnitAt, allies, enemies }
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
    default:
      return false;
  }
}

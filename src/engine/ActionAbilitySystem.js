// ActionAbilitySystem — pure helpers for utility abilities: "action"-trigger
// skills carrying structured `actionAbility` data (Blink, Rally Cry, Healing
// Circle, Ensnare, Smite, Transfuse, Great Sacrifice, Goddess Dance, Blink Strike).
// Battle actions that appear in the Ability submenu of the unit action menu. No Phaser
// dependencies.
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
import { applyCondition, isSilenced, isWounded } from './StatusConditionSystem.js';
import { gridDistance } from './Combat.js';
import { combatDistance, getFootprintKeys, isEntity } from './EntitySystem.js';
import { displacementBlockReason, traceForcedMove } from './ForcedMovement.js';
import { effectiveSkills, hasEffectiveSkill } from './EffectiveSkills.js';
import { canAttackWithWeapon, getAttackRange } from './AttackOptions.js';
import {
  STEAL_ABILITY_KIND,
  STEAL_REASONS,
  carriedItemOf,
  stealBlockReason,
  stealDestination,
} from './Steal.js';

/** Ability kinds the engine + BattleScene glue know how to execute. */
export const ACTION_ABILITY_KINDS = new Set([
  'teleport_self',
  'ally_buff',
  'aoe_heal',
  'aoe_root',
  'push_enemy',
  'transfer_hp',
  'sacrifice_heal',
  'refresh_adjacent',
  'warp_strike',
]);

/** Kinds that pick one adjacent unit (SELECTING_ABILITY_TILE, on the unit's tile). */
export const TARGETED_ABILITY_KINDS = new Set(['push_enemy', 'transfer_hp']);

// Steal (3G) joins both sets without touching their literals above.
ACTION_ABILITY_KINDS.add(STEAL_ABILITY_KIND);
TARGETED_ABILITY_KINDS.add(STEAL_ABILITY_KIND);

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
  if (!unit || !Array.isArray(skillsData)) return [];
  const byId = new Map(
    skillsData.filter((skill) => typeof skill?.id === 'string' && skill.id).map((s) => [s.id, s]),
  );
  const abilities = [];
  for (const skillId of effectiveSkills(unit)) {
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
 * - push_enemy / transfer_hp / steal_item: at least one legal adjacent target
 * - sacrifice_heal: the user has HP to spare and a hurt, healable ally is in range
 * - refresh_adjacent: an adjacent ally who has acted and is not a dancer
 * - warp_strike: a free tile the equipped weapon strikes a seen foe from
 * @param {object} ctx { grid, getUnitAt, allies, enemies, affixes, skillsData, canAddToConvoy }
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
    case 'sacrifice_heal':
      return sacrificeAmount(unit, ability, allies) > 0;
    case 'refresh_adjacent':
      return findDanceRefreshTargets(unit, allies).length > 0;
    case 'warp_strike':
      return findWarpStrikeOptions(unit, ability, ctx).length > 0;
    case STEAL_ABILITY_KIND:
      return findStealTargets(unit, ability, ctx).length > 0;
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
  return displacementBlockReason(foe, affixData);
}

/**
 * Where a push of `target` lands: up to `distance` tiles along (dc, dr), stopping
 * before the edge, impassable ground (for the target's own move type) or a unit, and
 * then the slide of any Ice the push put it on (ForcedMovement.traceForcedMove: the
 * forced-slide rule shared with Shove and the weapon-art pushes).
 * `getUnitAt` picks the push's tiles (a fogged tile counts as taken); `slideUnitAt`
 * the units that stop a slide (default: the same probe).
 * @returns {{ col: number, row: number, steps: number, path: object[], slid: boolean,
 *   blocker: any }|null} null when the first tile is blocked
 */
export function traceSmite(target, dc, dr, distance, grid, getUnitAt, slideUnitAt = getUnitAt) {
  const trace = traceForcedMove(target, dc, dr, distance, grid, getUnitAt, slideUnitAt);
  return trace.steps > 0 ? trace : null;
}

/**
 * Foes `unit` can smite: one per side, adjacent, not pinned, with a free first tile.
 * A free first tile and nothing beyond it moves the foe one tile, not two.
 * Ice: a foe the push puts on Ice slides on (the forced-slide rule,
 * IceMovement.traceForcedSlide), so `destCol`/`destRow` is where it ends as the player
 * knows the board: `ctx.slideUnitAt` reads known units only, so a unit the fog hides
 * never shortens the slide shown (execution traces the real board, settleSmite).
 * Lava and acid are not special: the ground works on the foe at the end of its phase,
 * as after any move.
 * @returns {Array<{ unit: object, destCol: number, destRow: number, dc: number, dr: number,
 *   steps: number, distance: number, slid: boolean, path: object[] }>}
 */
export function findSmiteTargets(unit, ability, ctx = {}) {
  const { grid, getUnitAt, slideUnitAt, enemies, affixes } = ctx;
  if (!unit || !grid || !Array.isArray(enemies)) return [];
  const distance = Math.max(1, Math.trunc(Number(ability?.distance) || 1));
  const targets = [];
  for (const { dc, dr } of CARDINALS) {
    const foe = unitCovering(enemies, unit.col + dc, unit.row + dr);
    if (!foe || foe === unit || smiteBlockReason(foe, affixes)) continue;
    const landing = traceSmite(foe, dc, dr, distance, grid, getUnitAt, slideUnitAt);
    if (!landing) continue;
    targets.push({
      unit: foe,
      destCol: landing.col,
      destRow: landing.row,
      dc,
      dr,
      steps: landing.steps,
      distance,
      slid: landing.slid,
      path: landing.path,
    });
  }
  return targets;
}

/**
 * The push, settled: the foe's coordinates change and, if it was holding position,
 * the move wakes its pack (ActionMovement.settleMoves marks it disturbed). No HP, no RNG.
 * With `world` ({ grid, getUnitAt, slideUnitAt }: the probes over the real board) the
 * slide is traced where it really goes; without, the offered landing stands.
 */
export function settleSmite(target, world = null) {
  const end = world
    ? traceForcedMove(
        target.unit,
        target.dc,
        target.dr,
        target.distance,
        world.grid,
        world.getUnitAt,
        world.slideUnitAt,
      )
    : {
        col: target.destCol,
        row: target.destRow,
        steps: target.steps,
        slid: target.slid,
        path: target.path,
      };
  const move = { unit: target.unit, to: { col: end.col, row: end.row } };
  if (end.slid) move.path = end.path;
  return { moves: settleMoves([move]), steps: end.steps, slid: Boolean(end.slid) };
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

// --- Great Sacrifice (sacrifice_heal): pay HP, every ally in range heals that much ---

/**
 * Allies Great Sacrifice would mend: within the ability's radius, hurt, and able to recover
 * it. A Wounded ally recovers nothing (UnitHealth.healUnit), so it is never counted: a
 * sacrifice for no one would only burn HP. The user itself is never a target.
 */
export function sacrificeTargets(user, ability, allies) {
  if (!liveUnit(user) || !Array.isArray(allies)) return [];
  return collectAffected(user, { ...ability, includeSelf: false }, allies).filter(
    (ally) =>
      ally !== user &&
      !isWounded(ally) &&
      (Number(ally.currentHP) || 0) < (Number(ally.stats?.HP) || 0),
  );
}

/**
 * HP the user pays, and every ally in range is healed by: the ability's cap, what the user
 * can spare (never its last HP) and what the most hurt ally in range is missing. 0 means
 * the ability has nothing worthwhile to do (the user is down to 1 HP, or no one in range is
 * hurt and healable), so it is not offered: it never wastes the turn.
 */
export function sacrificeAmount(user, ability, allies) {
  const cap = Math.max(1, Math.trunc(Number(ability?.amount) || 1));
  const spare = (Number(user?.currentHP) || 0) - 1;
  const need = sacrificeTargets(user, ability, allies).reduce(
    (most, ally) => Math.max(most, (Number(ally.stats?.HP) || 0) - (Number(ally.currentHP) || 0)),
    0,
  );
  return Math.max(0, Math.min(cap, spare, need));
}

/**
 * The sacrifice, settled through UnitHealth: each ally in range is healed by the amount
 * (capped at its max HP), then the user pays it, never below 1 HP. `allies` is the pool the
 * ability reads (the army, plus the NPC allies the caster sees, as Healing Circle).
 * @returns {{ user: object, amount: number, paid: number, userBefore: number,
 *   userAfter: number, targets: Array<{ unit: object, hpBefore: number, hpAfter: number,
 *   healed: number }> }}
 */
export function settleGreatSacrifice(user, ability, allies) {
  const amount = sacrificeAmount(user, ability, allies);
  const userBefore = user.currentHP;
  const targets =
    amount > 0
      ? sacrificeTargets(user, ability, allies).map((unit) => {
          const hpBefore = unit.currentHP;
          const healed = healUnit(unit, amount);
          return { unit, hpBefore, hpAfter: unit.currentHP, healed };
        })
      : [];
  const paid = amount > 0 ? damageUnit(user, amount, { floor: 1, disturbs: false }) : 0;
  return { user, amount, paid, userBefore, userAfter: user.currentHP, targets };
}

// --- Goddess Dance (refresh_adjacent): refresh every adjacent ally who has acted ---

/**
 * The allies a dancer can refresh: next to it (the four neighbouring tiles), alive, having
 * acted, and not dancers themselves (a dancer's own turn is its own). This is Dance's rule
 * (BattleScene.findDanceTargets reads it too), and Goddess Dance refreshes all of them.
 * "Dancer" is read through effective skills, so a Dance an accessory lends counts.
 * @param {object} unit the dancer
 * @param {object[]} units the player's army
 * @returns {object[]} allies, in the cardinal order up, down, left, right
 */
export function findDanceRefreshTargets(unit, units) {
  if (!unit || !Array.isArray(units)) return [];
  // Not removed or down (a unit with no HP field, as a bare test unit, still stands).
  const standing = (other) => Boolean(other) && !other._removing && !(other.currentHP <= 0);
  const targets = [];
  for (const { dc, dr } of CARDINALS) {
    const ally = units.find(
      (other) =>
        other !== unit &&
        standing(other) &&
        other.col === unit.col + dc &&
        other.row === unit.row + dr,
    );
    if (ally && ally.hasActed && !hasEffectiveSkill(ally, 'dance')) targets.push(ally);
  }
  return targets;
}

/**
 * Refresh one ally who has acted: it may move and act again. The same refresh Dance gives
 * (MovementActionController.executeDance): `hasMoved`, `_movementCommitted` and `hasActed`
 * are reset. `_movementSpent` is not (Dance never reset it; the Gambit and Galeforce do).
 */
export function refreshActedAlly(ally) {
  ally.hasMoved = false;
  ally._movementCommitted = false;
  ally.hasActed = false;
}

/**
 * Goddess Dance, settled: every target is refreshed (the caller spends the use, as for
 * Healing Circle, and records the deeds and XP).
 */
export function settleGoddessDance(targets) {
  for (const ally of targets) refreshActedAlly(ally);
  return targets;
}

// --- Blink Strike (warp_strike): warp next to a seen foe, then attack it ---

/**
 * Where Blink Strike may land and whom it may strike from there. A destination is a tile of
 * Blink's diamond (getBlinkTiles: in bounds, passable for the move type, unoccupied as the
 * player knows it) from which the EQUIPPED weapon reaches at least one seen foe; `targets`
 * are the foes it reaches from that tile. So a bow user is offered only the tiles at its
 * range, a lance user the tiles beside a foe. Only the equipped weapon counts: no weapon
 * swap, and never a weapon art (the strike is a plain attack).
 * `ctx`: { grid, getUnitAt, enemies, skillsData }: what the player may know. `getUnitAt`
 * counts a fogged tile as taken (BattleInformation.seenTileOccupant) and `enemies` are the
 * seen foes, so a hidden unit can never change what is offered.
 * @returns {Array<{ col: number, row: number, targets: object[] }>} reading order
 */
export function findWarpStrikeOptions(unit, ability, ctx = {}) {
  const { grid, getUnitAt, enemies, skillsData } = ctx;
  const weapon = unit?.weapon;
  if (!liveUnit(unit) || !grid || !weapon || !Array.isArray(enemies)) return [];
  if (!canAttackWithWeapon(unit, weapon)) return [];
  const { min, max } = getAttackRange(unit, weapon, { skillsData });
  const foes = enemies.filter((foe) => liveUnit(foe) && foe !== unit);
  const options = [];
  for (const tile of getBlinkTiles(unit, ability?.range, grid, getUnitAt)) {
    const targets = foes.filter((foe) => {
      const distance = combatDistance(tile, foe);
      return distance >= min && distance <= max;
    });
    if (targets.length > 0) options.push({ col: tile.col, row: tile.row, targets });
  }
  return options;
}

/**
 * Validate a whole Blink Strike (destination and target) against what the player knows:
 * the same finder the menu used, so what was offered is what is accepted, and a board that
 * changed since (a foe fell, the weapon broke) is refused. Run at the choices and again at
 * commit.
 * @returns {{ ok: true, from: {col,row}, destination: {col,row}, target: object,
 *   distance: number } | { ok: false, reason: 'bad_destination'|'bad_target' }}
 */
export function planWarpStrike(unit, ability, destination, target, ctx = {}) {
  const option = findWarpStrikeOptions(unit, ability, ctx).find(
    (entry) => entry.col === destination?.col && entry.row === destination?.row,
  );
  if (!option) return { ok: false, reason: 'bad_destination' };
  if (!target || !option.targets.includes(target)) return { ok: false, reason: 'bad_target' };
  return {
    ok: true,
    from: { col: unit.col, row: unit.row },
    destination: { col: option.col, row: option.row },
    target,
    distance: combatDistance({ col: option.col, row: option.row }, target),
  };
}

/**
 * The warp, settled (the domain write, before anything is drawn). The use is spent either
 * way. `occupantAt(col, row)` reads the REAL board: a unit the fog hid standing on the
 * destination makes the warp fail (the unit stays where it is), where the choices only knew
 * the board as the player does. Blink Strike never places a unit on another.
 * @returns {{ warped: boolean, moves: object[], blocker: object|null, usage: number }}
 */
export function settleWarpStrike(unit, skill, plan, { occupantAt = null } = {}) {
  markUsed(unit, skill.id);
  const usage = getAbilityUsageCount(unit, skill.id);
  const { col, row } = plan.destination;
  const blocker = typeof occupantAt === 'function' ? occupantAt(col, row) : null;
  if (blocker && blocker !== unit) return { warped: false, moves: [], blocker, usage };
  return { warped: true, moves: settleMoves([{ unit, to: { col, row } }]), blocker: null, usage };
}

// --- Steal (steal_item): take the item an adjacent foe carries (engine/Steal.js) ---

/**
 * The adjacent foes `unit` can rob right now: each carries an item, the thief is at least as
 * fast, and there is room (the thief's bag, then the convoy through `ctx.canAddToConvoy`).
 * `ctx.enemies` is what the player may know (seen foes), so a hidden carrier never shows.
 * @returns {Array<{ unit: object, item: object, destination: 'bag'|'convoy', dc: number,
 *   dr: number }>}
 */
export function findStealTargets(unit, ability, ctx = {}) {
  return stealStatus(unit, ability, ctx).targets;
}

/**
 * `findStealTargets` and, when none is legal but a carrier stands adjacent, why: 'too_slow'
 * when every such carrier is faster, 'full' when one the thief could outpace has nowhere to
 * go. `reason` is null when a target is legal or no carrier stands adjacent.
 * @returns {{ targets: object[], reason: 'too_slow'|'full'|null }}
 */
export function stealStatus(unit, ability, ctx = {}) {
  const { enemies, canAddToConvoy } = ctx;
  const out = { targets: [], reason: null };
  if (!liveUnit(unit) || !Array.isArray(enemies)) return out;
  const blocked = [];
  for (const { dc, dr } of CARDINALS) {
    const foe = unitCovering(enemies, unit.col + dc, unit.row + dr);
    if (!foe || foe === unit) continue;
    const item = carriedItemOf(foe);
    if (!item) continue;
    const why = stealBlockReason(unit, foe, { canAddToConvoy });
    if (why) {
      blocked.push(why);
      continue;
    }
    out.targets.push({
      unit: foe,
      item,
      destination: stealDestination(unit, item, { canAddToConvoy }),
      dc,
      dr,
    });
  }
  if (out.targets.length === 0 && blocked.length > 0)
    out.reason = blocked.includes(STEAL_REASONS.full) ? STEAL_REASONS.full : STEAL_REASONS.tooSlow;
  return out;
}

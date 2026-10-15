// ThreatForecast — the one threat computation behind the Danger overlay, pinned
// ranges and "who threatens this tile" (no Phaser deps, no RNG, no mutation).
//
// An enemy threatens a tile when, next enemy phase, it can stop on some tile of its
// movement range (movement + terrain costs + blocking units + roots) from which the
// tile is inside its weapon range. Entities are stationary and strike from their
// footprint (and beside each Grasping Limb of theirs the player sees: EntityKit.js); enemy-owned ballistas are independent sources. A siege caster or a
// status-staff caster with shots or uses left holds its post (SiegeArtillery.js), so it
// strikes from there. Status staves are a
// separate, non-damage threat. The Entity alone also has a COUNTER band: tiles it can only
// counter into (EntityReach.js: its weapons reach farther than its blows), shown beside the
// strike zone so an attack from there is no surprise. Counter tiles are display only: the
// AI and the hold rule read `damage` and `status`, never `counter`. Only enemies the player
// can currently see count: fog-hidden units are never evaluated, so nothing here can reveal
// them.
//
// `ctx` is a read-only view of a battle:
//   grid                    Grid-like (cols, rows, fogEnabled, isVisible,
//                           getMovementRange, getAttackRange)
//   enemyUnits, ballistas   live arrays
//   positions()             Map "col,row" -> { faction, isCaravan? } of every living unit the
//                           player knows of (PlayerKnowledge.js): a hidden unit
//                           blocking a visible enemy's stop would give itself away
//   costModifier(unit)      terrain-cost reduction for a unit (skills)
//   areaArtOf(unit)?        the area art an enemy could swing next phase, or null
//                           (EnemyArtScoring.enemyAreaArtOf). Danger still shows the
//                           primary reach only; threat sight's line names how many
//                           foes that reach a tile carry one.

import { canInspectUnit, statusStaffThreat } from './BattleInformation.js';
import {
  entityDistanceTo,
  getFootprint,
  isEntity,
  isLargeUnit,
  livingEntityLimbs,
} from './EntitySystem.js';
import { willRemainRootedNextPhase } from './StatusConditionSystem.js';
import { getBallistaDangerTiles } from './BallistaEngine.js';
import { ENTITY_LIMB_REACH, ENTITY_PRIMARY_ATTACK_RANGE } from '../utils/constants.js';
import {
  getPerBattleRemainingUses,
  isInRange,
  isStaff,
  nextStrikeWeapon,
  parseRange,
} from './Combat.js';
import { entityCounterOnlyTiles } from './EntityReach.js';
import { artilleryWeapon, holdsPost } from './SiegeArtillery.js';
import { movementOptionsFor } from './PassMovement.js';
import { rangedReachBonusOf } from './WeaponReach.js';
import { getAttackRange, getAttackWeapons } from './AttackOptions.js';

const tileKey = (col, row) => `${col},${row}`;

/**
 * The weapon a unit will strike with, or null. A staff heals or hexes but never
 * deals damage (Combat.js), and the AI only attacks with the equipped weapon's
 * range, so a staff-only unit (every enemy Cleric) threatens no damage. A spent
 * per-battle weapon (Breachbolt) gives way to the weapon the AI swaps to
 * (Combat.nextStrikeWeapon).
 */
function strikingWeapon(unit) {
  const weapon = nextStrikeWeapon(unit);
  return weapon && !isStaff(weapon) && weapon.type !== 'Scroll' ? weapon : null;
}

/** Living and visible to the player (fog + inspection rules). */
export function isThreatSourceVisible(grid, enemy) {
  if (!enemy || enemy.currentHP <= 0 || enemy._removing) return false;
  // canInspectUnit is the fog's whole rule for a foe: a tile of its body seen (an Entity's
  // footprint), or every foe under Seer's Eye.
  return canInspectUnit(grid, enemy);
}

/**
 * Tiles one enemy threatens next phase, given the unit positions that block it.
 * `counter` holds the tiles where it can only answer a blow (the Entity's, EntityReach.js;
 * empty for every other unit); it is never a threat, so the AI-facing readers ignore it.
 * @returns {{ damage: Set<string>, status: Set<string>, counter: Set<string> }}
 */
export function enemyThreatTiles(ctx, enemy, positions = ctx.positions()) {
  const { grid } = ctx;
  const damage = new Set();
  const status = new Set();
  const counter = new Set();
  if (isEntity(enemy)) {
    for (const tile of getFootprint(enemy)) {
      for (const t of grid.getAttackRange(tile.col, tile.row, {
        range: `1-${ENTITY_PRIMARY_ATTACK_RANGE}`,
      })) {
        damage.add(tileKey(t.col, t.row));
      }
    }
    // Beside each of its Grasping Limbs the player can see, too (canEntityStrike).
    for (const limb of livingEntityLimbs(ctx.enemyUnits))
      if (isThreatSourceVisible(grid, limb))
        for (const t of grid.getAttackRange(limb.col, limb.row, {
          range: `1-${ENTITY_LIMB_REACH}`,
        }))
          damage.add(tileKey(t.col, t.row));
    for (const key of entityCounterOnlyTiles(enemy, grid.cols, grid.rows))
      if (!damage.has(key)) counter.add(key);
    return { damage, status, counter };
  }
  // Any other big body never steps (AIController._decideBodyAction): its weapon's reach from
  // its nearest body tile, as combat measures it; the body itself is never a target tile.
  if (isLargeUnit(enemy)) {
    const weapon = strikingWeapon(enemy);
    for (const key of bodyReachTiles(grid, enemy, weapon)) damage.add(key);
    // The Iron Guardian's Hammerfall lands on the tiles it marked (IronGuardian.js) as the
    // enemy phase starts, before anyone moves: they are its reach too.
    if (enemy.hammerfall && ctx.hammerfallMarks)
      for (const key of ctx.hammerfallMarks) damage.add(key);
    return { damage, status, counter };
  }
  // No movement while it stays rooted (willRemainRootedNextPhase, not isRooted: a root
  // expiring at the enemy's next phase start must not understate its threat range), nor
  // while it holds its post (siege artillery and status-staff casters, SiegeArtillery.js).
  const planted = holdsPost(enemy);
  const moveRange = grid.getMovementRange(
    enemy.col,
    enemy.row,
    planted || willRemainRootedNextPhase(enemy) ? 0 : enemy.mov || enemy.stats?.MOV,
    enemy.moveType,
    positions,
    enemy.faction,
    ctx.costModifier ? ctx.costModifier(enemy) : 0,
  );
  // Artillery only fires (AIController._decideArtilleryAction): no staff.
  const staff = artilleryWeapon(enemy) ? null : statusStaffThreat(enemy);
  const weapon = strikingWeapon(enemy);
  for (const [key, entry] of moveRange) {
    if (entry?.stoppable === false) continue;
    const [mc, mr] = key.split(',').map(Number);
    if (staff) {
      for (const t of grid.getAttackRange(mc, mr, { range: `${staff.min}-${staff.max}` })) {
        status.add(tileKey(t.col, t.row));
      }
    }
    if (weapon) {
      for (const t of grid.getAttackRange(mc, mr, weapon)) {
        damage.add(tileKey(t.col, t.row));
      }
    }
  }
  return { damage, status, counter };
}

/**
 * The tiles a big body's weapon reaches without a step: a tile is in reach when the combat
 * distance (entityDistanceTo, the nearest body tile) is in the weapon's range, as combat
 * measures it. The body itself is never a target tile. Keys "col,row".
 */
function bodyReachTiles(grid, unit, weapon) {
  const keys = new Set();
  if (!weapon) return keys;
  const { min, max } = parseRange(weapon.range);
  for (const tile of getFootprint(unit)) {
    for (const t of grid.getAttackRange(tile.col, tile.row, weapon)) {
      const d = entityDistanceTo(unit, t.col, t.row);
      if (d >= min && d <= max) keys.add(tileKey(t.col, t.row));
    }
  }
  return keys;
}

/**
 * Where a unit can stop with `mov` movement, and the tiles its weapon reaches
 * beyond them (the attack fringe the move preview draws in red; none for a staff).
 * @returns {{ moveRange: Map, attackTiles: Array<{col,row}> }}
 */
export function unitReach(
  grid,
  unit,
  { mov = 0, positions = null, costModifier = 0, skillsData = null } = {},
) {
  // A player unit with Pass walks through foes (never stopping on one): its reach reads it.
  const moveRange = grid.getMovementRange(
    unit.col,
    unit.row,
    mov,
    unit.moveType,
    positions,
    unit.faction,
    costModifier,
    movementOptionsFor(unit),
  );
  const attack = new Set();
  const weapon = strikingWeapon(unit);
  if (weapon && isLargeUnit(unit)) {
    // A big body (the Entity, a 2x2) never steps and fights from its whole body.
    for (const key of bodyReachTiles(grid, unit, weapon)) attack.add(key);
  } else if (unit.faction === 'player') {
    // A player unit's fringe is what Attack would let it initiate: the union over every
    // weapon it can attack with (silence, per-battle uses, proficiency), each at the range
    // attack planning reads (AttackOptions.getAttackRange: Foresight, Siegebreaker). Counter
    // reach is separate (Combat.canCounter) and gets no skill bonus.
    const reachWeapons = getAttackWeapons(unit).map((w) => {
      const { min, max } = getAttackRange(unit, w, { skillsData });
      return { range: `${min}-${max}` };
    });
    for (const [key, entry] of moveRange) {
      if (entry?.stoppable === false) continue;
      const [mc, mr] = key.split(',').map(Number);
      for (const reachWeapon of reachWeapons) {
        for (const t of grid.getAttackRange(mc, mr, reachWeapon)) {
          const tk = tileKey(t.col, t.row);
          if (!moveRange.has(tk)) attack.add(tk);
        }
      }
    }
  } else if (weapon) {
    // Foes (and NPCs): the equipped weapon's printed range, as the AI plays it.
    for (const [key, entry] of moveRange) {
      if (entry?.stoppable === false) continue;
      const [mc, mr] = key.split(',').map(Number);
      for (const t of grid.getAttackRange(mc, mr, weapon)) {
        const tk = tileKey(t.col, t.row);
        if (!moveRange.has(tk)) attack.add(tk);
      }
    }
  }
  const attackTiles = Array.from(attack).map((k) => {
    const [col, row] = k.split(',').map(Number);
    return { col, row };
  });
  return { moveRange, attackTiles };
}

function visibleEnemyBallistas(ctx) {
  const { grid } = ctx;
  return (ctx.ballistas || []).filter(
    (b) => b?.owner === 'enemy' && (!grid.fogEnabled || grid.isVisible(b.col, b.row)),
  );
}

/**
 * The Danger overlay's tile list: [{ col, row, count, statusThreat, damageThreat }].
 * `count` is the number of distinct damage sources (each enemy once per tile).
 * With `counter: true` (the display callers) the Entity's counter-only band joins as tiles
 * with `count` 0, `damageThreat` false and `counterThreat` true (the flag is set on any tile in
 * the band, and on no other); without it the list is exactly the threat (what "is a unit in
 * danger" asks).
 */
export function computeDangerTiles(ctx, { onlyEnemy = null, counter = false } = {}) {
  const threatened = new Map();
  const statusThreatened = new Set();
  const counterTiles = new Set();
  const addDamageSource = (tiles) => {
    for (const key of tiles) threatened.set(key, (threatened.get(key) || 0) + 1);
  };
  let positions = null;
  for (const enemy of onlyEnemy ? [onlyEnemy] : ctx.enemyUnits || []) {
    if (!isThreatSourceVisible(ctx.grid, enemy)) continue;
    if (!isLargeUnit(enemy)) positions ||= ctx.positions();
    const { damage, status, counter: counterOnly } = enemyThreatTiles(ctx, enemy, positions);
    addDamageSource(damage);
    for (const key of status) statusThreatened.add(key);
    if (counter) for (const key of counterOnly) counterTiles.add(key);
  }
  if (!onlyEnemy) {
    for (const ballista of visibleEnemyBallistas(ctx)) {
      const tiles = getBallistaDangerTiles(ballista, ctx.grid.cols, ctx.grid.rows);
      addDamageSource(new Set(tiles.map((t) => tileKey(t.col, t.row))));
    }
  }
  return Array.from(new Set([...threatened.keys(), ...statusThreatened, ...counterTiles])).map(
    (k) => {
      const [col, row] = k.split(',').map(Number);
      const tile = {
        col,
        row,
        count: threatened.get(k) || 0,
        statusThreat: statusThreatened.has(k),
        damageThreat: threatened.has(k),
      };
      if (counterTiles.has(k)) tile.counterThreat = true;
      return tile;
    },
  );
}

/** Positions with `mover` lifted from its tile and set down on (col, row). */
export function positionsWithMoverAt(positions, mover, col, row) {
  if (!mover || (mover.col === col && mover.row === row)) return positions;
  const next = new Map(positions);
  const from = tileKey(mover.col, mover.row);
  if (next.get(from)?.faction === mover.faction) next.delete(from);
  next.set(tileKey(col, row), { faction: mover.faction });
  return next;
}

const iceCache = new WeakMap();
/** Ice lets a unit slide past its movement allowance; pruning must then stay off. */
function gridHasIce(grid) {
  if (!grid?.mapLayout || !Array.isArray(grid.terrainData)) return true;
  const revision = grid.terrainRevision ?? 0;
  const cached = iceCache.get(grid);
  if (cached && cached.revision === revision) return cached.ice;
  let ice = false;
  for (const line of grid.mapLayout) {
    for (const index of line || []) {
      if (grid.terrainData[index]?.name === 'Ice') ice = true;
    }
  }
  iceCache.set(grid, { revision, ice });
  return ice;
}

function withinBareReach(enemy, col, row) {
  // Planted artillery moves 0: mov stays an upper bound for the prune.
  const mov = willRemainRootedNextPhase(enemy) ? 0 : Number(enemy.mov || enemy.stats?.MOV) || 0;
  const weapon = strikingWeapon(enemy);
  let reach = weapon ? parseRange(weapon.range).max : 0;
  const staff = statusStaffThreat(enemy);
  if (staff) reach = Math.max(reach, staff.max);
  return Math.abs(enemy.col - col) + Math.abs(enemy.row - row) <= mov + reach;
}

/** The combat weapons `mover` carries (equipped or in its bag): what "can hit from here" reads. */
function moverCombatWeapons(mover) {
  return [mover?.weapon, ...(mover?.inventory || [])].filter(
    (w) => w && !isStaff(w) && w.type !== 'Scroll',
  );
}

/** Can `mover` (null: anyone) hit `entity` from (col, row) with a combat weapon it carries? */
function moverReaches(mover, entity, col, row) {
  if (!mover) return true;
  const distance = entityDistanceTo(entity, col, row);
  return moverCombatWeapons(mover).some((w) => {
    // Siegebreaker (engine/WeaponReach.js): a player unit's bow or tome reaches further.
    const reach = rangedReachBonusOf(mover, w);
    if (reach <= 0) return isInRange(w, distance);
    const { min, max } = parseRange(w.range);
    return distance >= min && distance <= max + reach;
  });
}

/**
 * What `threatsOnTile` reads from the mover beyond its tile: the reaches of the combat weapons
 * it carries (the Entity's "counters from here" note). A Trade or an Equip that changes them
 * changes this, though the unit never moved; the order of the bag does not.
 */
export function moverReachSignature(mover) {
  const reaches = new Set();
  for (const w of moverCombatWeapons(mover)) {
    const { min, max } = parseRange(w.range);
    reaches.add(`${min}-${max + rangedReachBonusOf(mover, w)}`);
  }
  return [...reaches].sort().join(',');
}

/**
 * Every visible source that could strike (col, row) next enemy phase if `mover`
 * ended its move there. Enemies whose paths the move opens or closes are
 * evaluated against the moved positions, so the answer matches what the enemy
 * phase will actually see.
 *
 * @returns {{ damage: object[], status: object[], counter: object[], ballistas: object[],
 *   area: object[], count: number, fogged: boolean }}  `counter` = Entities that cannot strike
 *   the tile but would answer a blow from it (a note, never part of `count`); `count` = damage
 *   enemies + ballistas; `area` =
 *   the damage enemies carrying an area art; `fogged` = fog is on, so unseen enemies
 *   may add to it.
 */
export function threatsOnTile(ctx, col, row, { mover = null } = {}) {
  const key = tileKey(col, row);
  const damage = [];
  const status = [];
  const counter = [];
  let positions = null;
  const slides = gridHasIce(ctx.grid);
  for (const enemy of ctx.enemyUnits || []) {
    if (!isThreatSourceVisible(ctx.grid, enemy)) continue;
    // Cheap exact prune: every step costs at least 1, so without ice slides an
    // enemy farther than movement + reach cannot strike the tile.
    if (!slides && !isLargeUnit(enemy) && !withinBareReach(enemy, col, row)) continue;
    if (!isLargeUnit(enemy)) positions ||= positionsWithMoverAt(ctx.positions(), mover, col, row);
    const tiles = enemyThreatTiles(ctx, enemy, positions);
    if (tiles.damage.has(key)) damage.push(enemy);
    else if (tiles.status.has(key)) status.push(enemy);
    // The Entity answers a blow from here, though it could not strike this tile: only worth
    // saying to a mover with a weapon that reaches it from here.
    else if (tiles.counter.has(key) && moverReaches(mover, enemy, col, row)) counter.push(enemy);
  }
  const ballistas = visibleEnemyBallistas(ctx).filter((ballista) =>
    getBallistaDangerTiles(ballista, ctx.grid.cols, ctx.grid.rows).some(
      (t) => t.col === col && t.row === row,
    ),
  );
  return {
    damage,
    status,
    counter,
    ballistas,
    area: damage.filter((enemy) => Boolean(ctx.areaArtOf?.(enemy))),
    count: damage.length + ballistas.length,
    fogged: Boolean(ctx.grid?.fogEnabled),
  };
}

/**
 * A cheap fingerprint of everything threatsOnTile reads, so a cache can tell when
 * a remembered answer went stale (moves, deaths, roots, fog, weapons, staff uses, the
 * mover's own weapon reaches, and terrain: Grid.setTerrainAt bumps `terrainRevision` for
 * Break, temporary terrain and its expiry, villages and snapshot restores).
 */
export function threatWorldSignature(ctx, units = []) {
  const { grid } = ctx;
  const parts = [`T${grid?.terrainRevision ?? 0}`];
  for (const u of units) {
    if (!u) continue;
    const alive = u.currentHP > 0 && !u._removing;
    let part = `${u.faction}:${u.col},${u.row}:${alive ? 1 : 0}`;
    // A player unit may be the mover: its weapons' reaches decide whether a foe that cannot
    // strike a tile still counters a blow from it.
    if (u.faction === 'player' && alive) part += `:W${moverReachSignature(u)}`;
    if (u.faction !== 'player' && alive) {
      const visible = isThreatSourceVisible(grid, u) ? 1 : 0;
      const staff = statusStaffThreat(u);
      part += `:${visible}:${u.mov ?? u.stats?.MOV}:${u.moveType}:${u.weapon?.range ?? ''}`;
      // The weapon it strikes with next and its shots: a spent Breachbolt gives way to
      // its fallback, and only a siege tome with shots left plants (SiegeArtillery).
      const strike = nextStrikeWeapon(u);
      part += `:${strike?.name ?? ''}:${strike?.perBattleUses ? getPerBattleRemainingUses(strike, u) : ''}:${u.aiMode ?? ''}`;
      part += `:${willRemainRootedNextPhase(u) ? 'R' : ''}:${staff ? `${staff.min}-${staff.max}` : ''}`;
      // An area art spent or priced out of reach changes the line.
      part += `:${ctx.areaArtOf?.(u)?.id ?? ''}`;
    }
    parts.push(part);
  }
  for (const b of ctx.ballistas || []) {
    const visible = !grid?.fogEnabled || grid.isVisible(b.col, b.row);
    parts.push(`B${b.col},${b.row}:${b.owner}:${visible ? 1 : 0}`);
  }
  // Hammerfall's marks move each enemy phase while the Guardian stands still.
  if (ctx.hammerfallMarks?.size) parts.push(`H${[...ctx.hammerfallMarks].sort().join(';')}`);
  return parts.join('|');
}

const staves = (n) => `${n} ${n === 1 ? 'staff' : 'staves'}`;

/**
 * How a move preview should read: 'reached' when a foe (or ballista) can strike
 * the tile, 'status' when only status staves can reach it, 'counter' when nothing can
 * strike it but the Entity would answer a blow from it, else 'clear'.
 */
export function threatSummaryTone(result) {
  if (!result) return 'clear';
  if (result.count > 0) return 'reached';
  if (result.status?.length) return 'status';
  return result.counter?.length ? 'counter' : 'clear';
}

/**
 * Short, plain move-preview text: "2 foes can reach", "2 foes can reach · 1 staff",
 * with threat sight's intent "2 foes can reach · 1 targets you" ("none target you": they
 * would go for someone else),
 * "Only 1 staff can reach" (no foe can strike, but a status staff can), "No foe can
 * reach"; under fog, " · fog may hide more". When some of the foes that reach carry
 * an area art, " · 1 with an area art" follows the count: the blow may land on the
 * tiles around (or behind) this one too. When the Entity cannot strike the tile but would
 * counter a blow from it, " · The Entity counters from here" follows. `status` lists enemies
 * that reach the tile with a status staff only (those that can also strike are in `count`).
 */
export function threatSummaryText(result) {
  if (!result) return '';
  const hits = result.count || 0;
  const staffOnly = result.status?.length || 0;
  const area = result.area?.length || 0;
  let text;
  // Threat sight adds `aimed` (EnemyIntent): how many of them would go for this unit here.
  const aimed = Number.isInteger(result.aimed) ? result.aimed : null;
  const aimedText =
    aimed === null
      ? ''
      : ` · ${aimed === 0 ? 'none target' : `${aimed} ${aimed === 1 ? 'targets' : 'target'}`} you`;
  if (hits > 0) {
    text = `${hits} ${hits === 1 ? 'foe' : 'foes'} can reach${aimedText}`;
    if (area) text += ` · ${area} with an area art`;
    if (staffOnly) text += ` · ${staves(staffOnly)}`;
  } else if (staffOnly) {
    text = `Only ${staves(staffOnly)} can reach${aimedText}`;
  } else {
    text = 'No foe can reach';
  }
  const counters = result.counter || [];
  if (counters.length === 1) text += ` · ${counters[0].name || 'A foe'} counters from here`;
  else if (counters.length) text += ` · ${counters.length} foes counter from here`;
  if (result.fogged) text += ' · fog may hide more';
  return text;
}

// ThreatForecast — the one threat computation behind the Danger overlay, pinned
// ranges and "who threatens this tile" (no Phaser deps, no RNG, no mutation).
//
// An enemy threatens a tile when, next enemy phase, it can stop on some tile of its
// movement range (movement + terrain costs + blocking units + roots) from which the
// tile is inside its weapon range. Entities are stationary and strike from their
// footprint; enemy-owned ballistas are independent sources. Status staves are a
// separate, non-damage threat. Only enemies the player can currently see count:
// fog-hidden units are never evaluated, so nothing here can reveal them.
//
// `ctx` is a read-only view of a battle:
//   grid                    Grid-like (cols, rows, fogEnabled, isVisible,
//                           getMovementRange, getAttackRange)
//   enemyUnits, ballistas   live arrays
//   positions()             Map "col,row" -> { faction } of every living unit
//   costModifier(unit)      terrain-cost reduction for a unit (skills)

import { canInspectUnit, statusStaffThreat } from './BattleInformation.js';
import { getFootprint, isEntity } from './EntitySystem.js';
import { willRemainRootedNextPhase } from './StatusConditionSystem.js';
import { getBallistaDangerTiles } from './BallistaEngine.js';
import { ENTITY_PRIMARY_ATTACK_RANGE } from '../utils/constants.js';
import { parseRange } from './Combat.js';

const tileKey = (col, row) => `${col},${row}`;

/** Living and visible to the player (fog + inspection rules). */
export function isThreatSourceVisible(grid, enemy) {
  if (!enemy || enemy.currentHP <= 0 || enemy._removing) return false;
  if (!canInspectUnit(grid, enemy)) return false;
  if (grid?.fogEnabled) {
    const tiles = isEntity(enemy) ? getFootprint(enemy) : [enemy];
    if (!tiles.some((t) => grid.isVisible(t.col, t.row))) return false;
  }
  return true;
}

/**
 * Tiles one enemy threatens next phase, given the unit positions that block it.
 * @returns {{ damage: Set<string>, status: Set<string> }}
 */
export function enemyThreatTiles(ctx, enemy, positions = ctx.positions()) {
  const { grid } = ctx;
  const damage = new Set();
  const status = new Set();
  if (isEntity(enemy)) {
    for (const tile of getFootprint(enemy)) {
      for (const t of grid.getAttackRange(tile.col, tile.row, {
        range: `1-${ENTITY_PRIMARY_ATTACK_RANGE}`,
      })) {
        damage.add(tileKey(t.col, t.row));
      }
    }
    return { damage, status };
  }
  // willRemainRootedNextPhase, not isRooted: a root expiring at the enemy's next
  // phase start must not understate its threat range.
  const moveRange = grid.getMovementRange(
    enemy.col,
    enemy.row,
    willRemainRootedNextPhase(enemy) ? 0 : enemy.mov || enemy.stats?.MOV,
    enemy.moveType,
    positions,
    enemy.faction,
    ctx.costModifier ? ctx.costModifier(enemy) : 0,
  );
  const staff = statusStaffThreat(enemy);
  for (const [key, entry] of moveRange) {
    if (entry?.stoppable === false) continue;
    const [mc, mr] = key.split(',').map(Number);
    if (staff) {
      for (const t of grid.getAttackRange(mc, mr, { range: `${staff.min}-${staff.max}` })) {
        status.add(tileKey(t.col, t.row));
      }
    }
    if (enemy.weapon) {
      for (const t of grid.getAttackRange(mc, mr, enemy.weapon)) {
        damage.add(tileKey(t.col, t.row));
      }
    }
  }
  return { damage, status };
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
 */
export function computeDangerTiles(ctx, { onlyEnemy = null } = {}) {
  const threatened = new Map();
  const statusThreatened = new Set();
  const addDamageSource = (tiles) => {
    for (const key of tiles) threatened.set(key, (threatened.get(key) || 0) + 1);
  };
  let positions = null;
  for (const enemy of onlyEnemy ? [onlyEnemy] : ctx.enemyUnits || []) {
    if (!isThreatSourceVisible(ctx.grid, enemy)) continue;
    if (!isEntity(enemy)) positions ||= ctx.positions();
    const { damage, status } = enemyThreatTiles(ctx, enemy, positions);
    addDamageSource(damage);
    for (const key of status) statusThreatened.add(key);
  }
  if (!onlyEnemy) {
    for (const ballista of visibleEnemyBallistas(ctx)) {
      const tiles = getBallistaDangerTiles(ballista, ctx.grid.cols, ctx.grid.rows);
      addDamageSource(new Set(tiles.map((t) => tileKey(t.col, t.row))));
    }
  }
  return Array.from(new Set([...threatened.keys(), ...statusThreatened])).map((k) => {
    const [col, row] = k.split(',').map(Number);
    return {
      col,
      row,
      count: threatened.get(k) || 0,
      statusThreat: statusThreatened.has(k),
      damageThreat: threatened.has(k),
    };
  });
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
  const mov = willRemainRootedNextPhase(enemy) ? 0 : Number(enemy.mov || enemy.stats?.MOV) || 0;
  let reach = enemy.weapon ? parseRange(enemy.weapon.range).max : 0;
  const staff = statusStaffThreat(enemy);
  if (staff) reach = Math.max(reach, staff.max);
  return Math.abs(enemy.col - col) + Math.abs(enemy.row - row) <= mov + reach;
}

/**
 * Every visible source that could strike (col, row) next enemy phase if `mover`
 * ended its move there. Enemies whose paths the move opens or closes are
 * evaluated against the moved positions, so the answer matches what the enemy
 * phase will actually see.
 *
 * @returns {{ damage: object[], status: object[], ballistas: object[], count: number,
 *   fogged: boolean }}  `count` = damage enemies + ballistas; `fogged` = fog is on,
 *   so unseen enemies may add to it.
 */
export function threatsOnTile(ctx, col, row, { mover = null } = {}) {
  const key = tileKey(col, row);
  const damage = [];
  const status = [];
  let positions = null;
  const slides = gridHasIce(ctx.grid);
  for (const enemy of ctx.enemyUnits || []) {
    if (!isThreatSourceVisible(ctx.grid, enemy)) continue;
    // Cheap exact prune: every step costs at least 1, so without ice slides an
    // enemy farther than movement + reach cannot strike the tile.
    if (!slides && !isEntity(enemy) && !withinBareReach(enemy, col, row)) continue;
    if (!isEntity(enemy)) positions ||= positionsWithMoverAt(ctx.positions(), mover, col, row);
    const tiles = enemyThreatTiles(ctx, enemy, positions);
    if (tiles.damage.has(key)) damage.push(enemy);
    else if (tiles.status.has(key)) status.push(enemy);
  }
  const ballistas = visibleEnemyBallistas(ctx).filter((ballista) =>
    getBallistaDangerTiles(ballista, ctx.grid.cols, ctx.grid.rows).some(
      (t) => t.col === col && t.row === row,
    ),
  );
  return {
    damage,
    status,
    ballistas,
    count: damage.length + ballistas.length,
    fogged: Boolean(ctx.grid?.fogEnabled),
  };
}

/**
 * A cheap fingerprint of everything threatsOnTile reads, so a cache can tell when
 * a remembered answer went stale (moves, deaths, roots, fog, weapons, staff uses).
 */
export function threatWorldSignature(ctx, units = []) {
  const { grid } = ctx;
  const parts = [];
  for (const u of units) {
    if (!u) continue;
    const alive = u.currentHP > 0 && !u._removing;
    let part = `${u.faction}:${u.col},${u.row}:${alive ? 1 : 0}`;
    if (u.faction !== 'player' && alive) {
      const visible = isThreatSourceVisible(grid, u) ? 1 : 0;
      const staff = statusStaffThreat(u);
      part += `:${visible}:${u.mov ?? u.stats?.MOV}:${u.moveType}:${u.weapon?.range ?? ''}`;
      part += `:${willRemainRootedNextPhase(u) ? 'R' : ''}:${staff ? `${staff.min}-${staff.max}` : ''}`;
    }
    parts.push(part);
  }
  for (const b of ctx.ballistas || []) {
    const visible = !grid?.fogEnabled || grid.isVisible(b.col, b.row);
    parts.push(`B${b.col},${b.row}:${b.owner}:${visible ? 1 : 0}`);
  }
  return parts.join('|');
}

/** Short, plain move-preview text: "2 can reach", "No foe can reach". */
export function threatSummaryText(result) {
  if (!result) return '';
  const statusOnly = result.status?.length || 0;
  let text = result.count === 0 ? 'No foe can reach' : `${result.count} can reach`;
  if (statusOnly) text += ` · ${statusOnly} staff`;
  if (result.fogged) text += ' · fog may hide more';
  return text;
}

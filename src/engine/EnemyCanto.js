// EnemyCanto — an enemy with Canto (or Parting Step) steps away after it acts, by the
// same budget a player unit gets (CantoRule.cantoAllowance: what is left of its move, the
// whole of it for Canto, half for Parting Step). Pure, no Phaser, no RNG: the scene and
// the harness both reach it through AIController, so a replayed enemy phase steps the same.
//
// Where it goes: the tile in that budget the fewest player-side units (the army and its
// NPC allies, never the merchant) could strike next player phase, reading every combat
// weapon each one carries. Ties go to the better terrain (Avoid + DEF), then to the
// shorter step, then to the tile first in reading order. It stays put unless a tile beats
// the one it stands on. It never steps onto ground that hurts it (lava, acid), and a
// non-flier never steps across Ice (a slide would not end where it chose).
//
// Who never steps: a boss (seated or not), the Entity, a holder, a guard, a unit holding a
// post (siege artillery, a set piece's post), a sleeping or rooted unit, and a unit that
// did nothing this turn but walk.
import { cantoAllowance } from './CantoRule.js';
import { canEquip } from './UnitManager.js';
import { isStaff } from './Combat.js';
import { isEntity } from './EntitySystem.js';
import { HOLD_AI_MODE } from './HoldActivation.js';
import { holdsPost, isOffAuthoredPost, POST_AI_MODE } from './SiegeArtillery.js';
import { isRooted, isSleeping, willRemainRootedNextPhase } from './StatusConditionSystem.js';
import { isHazardTerrainIndex } from './TerrainHazards.js';

const tileKey = (col, row) => `${col},${row}`;

/** May this enemy take a Canto step at all (before its budget is counted)? */
export function enemyMayCanto(enemy) {
  if (!enemy || enemy.faction !== 'enemy' || enemy.currentHP <= 0 || enemy._removing) return false;
  if (enemy.isBoss || isEntity(enemy)) return false;
  if (enemy.aiMode === HOLD_AI_MODE || enemy.aiMode === 'guard') return false;
  if (enemy.aiMode === POST_AI_MODE || isOffAuthoredPost(enemy) || holdsPost(enemy)) return false;
  if (isSleeping(enemy) || isRooted(enemy)) return false;
  return true;
}

/** Every weapon the unit could strike with next phase (it may swap before attacking). */
function combatWeapons(unit) {
  const list = [...(unit.inventory || [])];
  if (unit.weapon && !list.includes(unit.weapon)) list.push(unit.weapon);
  return list.filter(
    (w) => w && !isStaff(w) && w.type !== 'Scroll' && (w === unit.weapon || canEquip(unit, w)),
  );
}

/**
 * The tiles each player-side unit could strike next player phase, as one count per tile.
 * `positions` blocks their walks (every living unit but the stepping enemy).
 */
function playerStrikeCounts({ grid, playerUnits, npcUnits, positions, costModifier }) {
  const counts = new Map();
  for (const unit of [...(playerUnits || []), ...(npcUnits || [])]) {
    if (!unit || unit.currentHP <= 0 || unit._removing || unit.isCaravan) continue;
    const weapons = combatWeapons(unit);
    if (!weapons.length) continue;
    const mov = willRemainRootedNextPhase(unit) ? 0 : (unit.mov ?? unit.stats?.MOV ?? 0);
    const range = grid.getMovementRange(
      unit.col,
      unit.row,
      mov,
      unit.moveType,
      positions,
      unit.faction,
      costModifier ? costModifier(unit) : 0,
    );
    const struck = new Set();
    const stops = [[tileKey(unit.col, unit.row), { stoppable: true }], ...range];
    for (const [key, entry] of stops) {
      if (entry?.stoppable === false) continue;
      const [c, r] = key.split(',').map(Number);
      for (const weapon of weapons) {
        for (const t of grid.getAttackRange(c, r, weapon)) struck.add(tileKey(t.col, t.row));
      }
    }
    for (const key of struck) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return counts;
}

function terrainOf(grid, col, row) {
  const idx = grid.mapLayout?.[row]?.[col];
  return { idx, terrain: idx == null ? null : grid.terrainData?.[idx] || null };
}

function hurtsToStand(enemy, idx) {
  if (idx == null || !isHazardTerrainIndex(idx)) return false;
  if (enemy.moveType === 'Flying') return false;
  return !(enemy.poisonImmune || enemy.terrainHazardImmune);
}

function crossesIce(grid, path, moveType) {
  if (moveType === 'Flying') return false;
  for (let i = 1; i < path.length; i++) {
    const { terrain } = terrainOf(grid, path[i].col, path[i].row);
    if (terrain?.name === 'Ice') return true;
  }
  return false;
}

/**
 * The Canto step an enemy takes after acting, or null when it stays.
 * @param {object} p
 * @param {object} p.enemy           the enemy, standing where it acted
 * @param {{col,row}} p.origin       where its turn began
 * @param {boolean} p.afterCombat    it fought (Measured Step does not apply then)
 * @param {object} p.grid            Grid-like (getMovementRange, getAttackRange, reconstructIcePath,
 *                                   mapLayout, terrainData)
 * @param {Array} p.units            every unit on the field (all sides)
 * @param {Array} p.playerUnits
 * @param {Array} [p.npcUnits]
 * @param {Function} [p.costModifier] unit -> terrain-cost reduction
 * @param {Array} [p.skillsData]
 * @returns {{ path: Array<{col,row}>, allowance: number } | null}
 */
export function planEnemyCanto({
  enemy,
  origin,
  afterCombat = false,
  grid,
  units,
  playerUnits,
  npcUnits = [],
  costModifier = null,
  skillsData,
}) {
  if (!enemyMayCanto(enemy) || !grid || !origin) return null;
  const positions = new Map();
  for (const u of units || []) {
    if (!u || u === enemy || u._removing || u.currentHP <= 0) continue;
    positions.set(tileKey(u.col, u.row), { faction: u.faction });
  }
  const mov = Number(enemy.mov ?? enemy.stats?.MOV) || 0;
  const costMod = costModifier ? costModifier(enemy) : 0;
  // What the walk cost: the same range the AI moved within, from where the turn began.
  let spent = 0;
  if (origin.col !== enemy.col || origin.row !== enemy.row) {
    const walked = grid.getMovementRange(
      origin.col,
      origin.row,
      mov,
      enemy.moveType,
      positions,
      enemy.faction,
      costMod,
    );
    const entry = walked.get(tileKey(enemy.col, enemy.row));
    // A landing the range cannot account for (a slide, a cut) leaves nothing to spend.
    spent = entry ? Number(entry.cost) || 0 : mov;
  }
  const allowance = cantoAllowance(enemy, mov - spent, { afterCombat }, skillsData);
  if (allowance <= 0) return null;

  const range = grid.getMovementRange(
    enemy.col,
    enemy.row,
    allowance,
    enemy.moveType,
    positions,
    enemy.faction,
    costMod,
  );
  const counts = playerStrikeCounts({ grid, playerUnits, npcUnits, positions, costModifier });
  const score = (col, row, steps) => {
    const { terrain } = terrainOf(grid, col, row);
    return {
      threat: counts.get(tileKey(col, row)) || 0,
      cover: (Number(terrain?.avoidBonus) || 0) + (Number(terrain?.defBonus) || 0),
      steps,
      col,
      row,
    };
  };
  const better = (a, b) =>
    a.threat !== b.threat
      ? a.threat < b.threat
      : a.cover !== b.cover
        ? a.cover > b.cover
        : a.steps !== b.steps
          ? a.steps < b.steps
          : a.row !== b.row
            ? a.row < b.row
            : a.col < b.col;

  const here = score(enemy.col, enemy.row, 0);
  let best = here;
  let bestPath = null;
  for (const [key, entry] of range) {
    if (entry?.stoppable === false || positions.has(key)) continue;
    const [col, row] = key.split(',').map(Number);
    if (col === enemy.col && row === enemy.row) continue;
    if (hurtsToStand(enemy, terrainOf(grid, col, row).idx)) continue;
    const path = grid.reconstructIcePath(range, enemy.col, enemy.row, col, row);
    if (!path || path.length < 2) continue;
    if (crossesIce(grid, path, enemy.moveType)) continue;
    const s = score(col, row, Number(entry.cost) || path.length - 1);
    if (better(s, best)) {
      best = s;
      bestPath = path;
    }
  }
  return bestPath ? { path: bestPath, allowance } : null;
}

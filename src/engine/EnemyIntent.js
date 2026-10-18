// EnemyIntent — who each visible enemy would go for next enemy phase, if the selected unit
// ended its move on a given tile (threat sight's lines; pure, no Phaser, no RNG, no mutation).
//
// The answer is the AI's own: AIController's decision runs on copies of the board, in the
// order the enemy phase takes the enemies, and each enemy's move is applied before the next
// one decides (two foes cannot both claim the last tile next to a unit). The AI breaks every
// tie by the order it reads tiles and units (first best wins, `>`), never by a roll, so the
// same lists in the same order give the same pick, and nothing here draws randomness.
//
// What it cannot know, it leaves out rather than guess:
//   - blows land or miss: nobody falls in the preview, so a foe whose target an earlier foe
//     would kill still shows it (and an enemy that acts is read to survive its action, so it
//     takes its Canto step: AIController._cantoStep's plan, applied to the copied board
//     before the next foe decides, as a foe vacating a chokepoint opens it for the next;
//     a wall it breaks is cleared on a copy of the map for the foes after it, never on the
//     battle's own grid);
//   - foes the fog hides: never evaluated, and never a blocker (they would give themselves
//     away), the Danger overlay's rule (ThreatForecast);
//   - whatever the phase start adds (reinforcements, a raise, a caravan step).
// What the phase start decides that the board already tells is applied the AI's way: the
// anti-turtle and enrage flags (the caller passes the next phase's: TurnPressure), the
// garrison packs' wake rule (HoldActivation.wakeHolders on copies), the siege casters'
// stances (settleArtilleryStances on copies), and a foe asleep for certain through the phase
// start (no recovery roll can wake it) stays asleep; one that may wake is read awake.
//
// The AI writes to the units it decides for (a weapon swap, a guard post, a streak count):
// every unit it may touch is a shallow copy, so the battle never changes.

import { selectBallistaTarget } from './BallistaEngine.js';
import { gridDistance, hasPerBattleUsesLeft, isInRange } from './Combat.js';
import { planEnemyCanto } from './EnemyCanto.js';
import { isEntity, isLargeUnit } from './EntitySystem.js';
import { wakeHolders } from './HoldActivation.js';
import { settleArtilleryStances } from './SiegeArtillery.js';
import { isThreatSourceVisible, positionsWithMoverAt } from './ThreatForecast.js';
import { getTerrainCostReduction } from './SkillSystem.js';
import { STATUS_CONDITIONS } from '../utils/constants.js';

const tileKey = (col, row) => `${col},${row}`;
const alive = (u) => u && u.currentHP > 0 && !u._removing;

/** Asleep through the next phase start for certain: no countdown end, no recovery roll. */
export function staysAsleepNextPhase(unit) {
  const sleep = (unit?._conditions || []).find((c) => c.id === 'sleep');
  if (!sleep) return false;
  const chance =
    typeof sleep.recoveryChance === 'number'
      ? sleep.recoveryChance
      : (STATUS_CONDITIONS.sleep?.recoveryChance ?? 0);
  return (sleep.turnsRemaining ?? 1) - 1 > 0 && !(chance > 0);
}

function copyUnit(unit) {
  return {
    ...unit,
    _conditions: unit._conditions ? unit._conditions.map((c) => ({ ...c })) : unit._conditions,
    guardPost: unit.guardPost ? { ...unit.guardPost } : unit.guardPost,
  };
}

/**
 * A view of `grid` whose terrain edits stay on the view: its own copy of the layout and of the
 * temporary-terrain list, and a setTerrainAt that only writes the copy (no redraw, no listener,
 * no revision). Grid's own clearTemporaryTerrainAt then runs on it unchanged.
 */
function overlayGrid(grid) {
  const overlay = Object.create(grid);
  overlay.mapLayout = grid.mapLayout.map((row) => [...row]);
  overlay.temporaryTerrains = [...(grid.temporaryTerrains || [])];
  overlay.setTerrainAt = (col, row, index) => {
    if (!overlay.mapLayout[row] || !overlay.terrainData[index]) return false;
    overlay.mapLayout[row][col] = index;
    return true;
  };
  return overlay;
}

/** The tile an enemy ends on after `decision` (an attack names it; a walk may slide on ice). */
function landingTile(ai, enemy, decision, occupied) {
  const path = decision?.path;
  if (!path || path.length < 2) return { col: enemy.col, row: enemy.row };
  const attackTile = decision.detail?.attackTile;
  if (decision.target && attackTile) return { col: attackTile.col, row: attackTile.row };
  const last = path[path.length - 1];
  return ai._predictFinalTileFromPath(enemy, last, path, occupied).finalTile;
}

/**
 * Each visible enemy's intent for the next enemy phase, with `mover` set down on (col, row).
 *
 * @param {object} options
 *   ai           the battle's AIController (read only: a view carries the next phase's flags)
 *   ctx          ThreatForecast's context (grid, enemyUnits, positions(), isKnown?)
 *   playerUnits, npcUnits  the battle's live arrays
 *   mover, col, row        the unit being moved and the tile it would end on (mover may be null)
 *   turn         the turn whose enemy phase comes next (hold wake turns, siege stances)
 *   aggressiveMode, bossEnraged  the next phase's anti-turtle flags (default: the AI's own)
 * @returns {Map<object, { kind: 'attack'|'status'|'heal'|'none', target: object|null,
 *   reason: string }>} keyed by the real enemy, in phase order; `target` is the real unit
 *   (the mover itself when it is the one aimed at)
 */
export function predictEnemyIntents({
  ai,
  ctx,
  playerUnits = [],
  npcUnits = [],
  mover = null,
  col = mover?.col,
  row = mover?.row,
  turn = null,
  aggressiveMode,
  bossEnraged,
}) {
  const intents = new Map();
  if (!ai || !ctx?.grid) return intents;
  // The coming phase's inputs, never the ones left from the phase the AI last played.
  const view = ai.phaseView({ turnNumber: turn, aggressiveMode, bossEnraged });

  // The real unit behind each copy, so an answer names the battle's own units.
  const realOf = new Map();
  const moverCopy = mover ? { ...mover, col, row } : null;
  if (moverCopy) realOf.set(moverCopy, mover);
  const players = (playerUnits || []).filter(alive).map((u) => (u === mover ? moverCopy : u));
  if (moverCopy && !players.includes(moverCopy) && alive(mover)) players.push(moverCopy);
  const knows = ctx.isKnown || (() => true);
  const npcs = (npcUnits || []).filter((u) => alive(u) && knows(u));

  // Every enemy is copied for the wake rule (a pack counts its hidden members too, as the
  // real check does); only the visible ones decide, block and are answered for.
  const all = (ctx.enemyUnits || []).filter(alive).map((u) => {
    const copy = copyUnit(u);
    realOf.set(copy, u);
    return copy;
  });
  const moved = positionsWithMoverAt(ctx.positions(), mover, col, row);
  const wakeCtx = { ...ctx, enemyUnits: all, positions: () => moved };
  wakeHolders({
    enemyUnits: all,
    playerUnits: players,
    npcUnits: npcs,
    threatContext: wakeCtx,
    bossEnraged: view.bossEnraged,
    turn: Number.isInteger(turn) ? turn : null,
  });
  settleArtilleryStances({ enemyUnits: all, turn: Number.isInteger(turn) ? turn : null });

  const visible = all.filter((u) => isThreatSourceVisible(ctx.grid, realOf.get(u)));
  const realTarget = (t) => (t ? realOf.get(t) || t : null);

  for (const enemy of visible) {
    const real = realOf.get(enemy);
    if (staysAsleepNextPhase(enemy)) {
      intents.set(real, { kind: 'none', target: null, reason: 'asleep' });
      continue;
    }
    if (isLargeUnit(enemy)) {
      // The foes the player sees, so a visible Grasping Limb lends its reach and a hidden
      // one never shows (EntitySystem.canEntityStrike; the live phase passes every foe).
      // Any other big body never steps either (AIController._decideBodyAction).
      const decision = isEntity(enemy)
        ? view._decideEntityAction(enemy, players, npcs, visible)
        : view._decideBodyAction(enemy, players, npcs);
      intents.set(real, {
        kind: decision?.target ? 'attack' : 'none',
        target: realTarget(decision?.target),
        reason: decision?.reason || 'none',
      });
      continue;
    }
    const decision = view._decideAction(enemy, visible, players, npcs);
    const occupied = new Set();
    for (const u of [...visible, ...players, ...npcs])
      if (u !== enemy && alive(u)) occupied.add(tileKey(u.col, u.row));
    const origin = { col: enemy.col, row: enemy.row };
    const landing = landingTile(view, enemy, decision, occupied);
    enemy.col = landing.col;
    enemy.row = landing.row;

    let kind = 'none';
    let target = null;
    if (decision.healTarget) {
      kind = 'heal';
      target = decision.healTarget;
    } else if (decision.statusStaffTarget) {
      kind = 'status';
      target = decision.statusStaffTarget;
    } else if (decision.target) {
      // AIController._processOneEnemy: a plan the landing no longer serves retargets in range.
      target = decision.target;
      const dist = gridDistance(enemy.col, enemy.row, target.col, target.row);
      if (
        !enemy.weapon ||
        !hasPerBattleUsesLeft(enemy.weapon, enemy) ||
        !isInRange(enemy.weapon, dist)
      )
        target = view._selectBestInRangeTarget(enemy, [...players, ...npcs]);
      if (target) kind = 'attack';
    }
    // AIController breaks the wall before the next foe acts (BattleScene.executeEnemyBreak):
    // later decisions read the map without it.
    if (decision.breakTile) {
      if (view.grid === ai.grid) view.grid = overlayGrid(ai.grid);
      view.grid.clearTemporaryTerrainAt?.(decision.breakTile.col, decision.breakTile.row);
    }
    // The step after the action (AIController._processOneEnemy / _cantoStep), on the same
    // board: only a foe that acted steps, and it is read to survive what it did.
    if (kind !== 'none' || decision.breakTile) {
      const cantoUnits = [...visible, ...players, ...npcs];
      const skills = view.gameData?.skills;
      const spent = view._walkSpent(enemy, origin, visible, players, npcs);
      const plan = planEnemyCanto({
        enemy,
        spent,
        afterCombat: kind === 'attack',
        grid: view.grid,
        units: cantoUnits,
        playerUnits: players,
        npcUnits: npcs,
        costModifier: (u) => getTerrainCostReduction(u, skills),
        skillsData: skills,
      });
      if (plan) {
        const end = plan.path[plan.path.length - 1];
        enemy.col = end.col;
        enemy.row = end.row;
      }
    }
    intents.set(real, { kind, target: realTarget(target), reason: decision.reason || 'none' });
  }
  return intents;
}

/**
 * Who each enemy ballista would shoot at the start of the next enemy phase, with `mover` set
 * down on (col, row). The ballista is no AI unit: BattleScene.processBallistaFire fires it at
 * the army alone (never an NPC ally) with BallistaEngine.selectBallistaTarget, the nearest unit
 * in reach and the lowest HP on a tie, before any enemy moves, so this is that same call on the
 * moved board. No RNG (the shot's hit roll is not read).
 *
 * @returns {Map<object, object|null>} real ballista -> the real unit it would shoot (or null)
 */
export function predictBallistaTargets({
  ballistas = [],
  playerUnits = [],
  mover = null,
  col,
  row,
}) {
  const targets = new Map();
  if (!ballistas.length) return targets;
  const realOf = new Map();
  const moverCopy = mover ? { ...mover, col, row } : null;
  if (moverCopy) realOf.set(moverCopy, mover);
  const players = (playerUnits || []).filter(alive).map((u) => (u === mover ? moverCopy : u));
  if (moverCopy && !players.includes(moverCopy) && alive(mover)) players.push(moverCopy);
  for (const ballista of ballistas) {
    if (ballista?.owner !== 'enemy') continue;
    const pick = selectBallistaTarget(ballista, players);
    targets.set(ballista, pick ? realOf.get(pick) || pick : null);
  }
  return targets;
}

/**
 * A fingerprint of what the AI reads beyond ThreatForecast's world signature: HP (it scores
 * expected damage and kills), stats, turn order state, conditions, hold and guard state.
 */
export function enemyIntentSignature(
  units = [],
  { turn = null, aggressiveMode, bossEnraged } = {},
) {
  const parts = [`t${turn ?? ''}:${aggressiveMode ? 1 : 0}${bossEnraged ? 1 : 0}`];
  for (const u of units) {
    if (!u) continue;
    const conditions = (u._conditions || []).map((c) => `${c.id}${c.turnsRemaining ?? ''}`);
    parts.push(
      [
        u.faction,
        u.col,
        u.row,
        u.currentHP,
        u.hasActed ? 1 : 0,
        u.weapon?.name ?? '',
        (u.inventory || []).map((w) => `${w?.name}:${w?._usesSpent ?? ''}`).join('/'),
        conditions.join('/'),
        u.aiMode ?? '',
        u.holdDisturbed ?? '',
        u.holdCheckedTurn ?? '',
        u.statusStaff ? `${u.statusStaff.name}:${u.statusStaff._usesSpent ?? 0}` : '',
        u.stats ? Object.values(u.stats).join('.') : '',
        u._aiNoMoveStreak ?? 0,
      ].join(':'),
    );
  }
  return parts.join('|');
}

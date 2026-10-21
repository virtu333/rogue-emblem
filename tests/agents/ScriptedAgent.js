// ScriptedAgent — Priority-based tactical policy (deterministic, no extra randomness).

import { getCombatForecast, gridDistance, isWardedUnit } from '../../src/engine/Combat.js';
import { objectiveTargetUnits } from '../../src/engine/BattleObjectives.js';
import { openWardCircles } from '../../src/engine/Vigil.js';

/**
 * A Vigil's standing ward circles (Vigil.openWardCircles), each claimed by a living player unit:
 * a unit already on a circle keeps it, then each open circle in data order takes the nearest
 * unit not yet claimed (roster order on a tie). Deterministic. Empty without wards.
 * @returns {Map<object, object>} unit -> circle
 */
export function wardCircleClaims(b) {
  const claims = new Map();
  const circles = openWardCircles(b?.battleConfig?.vigil, b?._vigilState, b?.enemyUnits);
  if (circles.length === 0) return claims;
  const free = (b.playerUnits || []).filter((u) => u.currentHP > 0);
  const taken = new Set();
  for (const c of circles) {
    const holder = free.find((u) => u.col === c.col && u.row === c.row);
    if (holder) {
      claims.set(holder, c);
      taken.add(c);
    }
  }
  for (const c of circles) {
    if (taken.has(c)) continue;
    const open = free.filter((u) => !claims.has(u));
    open.sort(
      (x, y) =>
        gridDistance(x.col, x.row, c.col, c.row) - gridDistance(y.col, y.row, c.col, c.row) ||
        free.indexOf(x) - free.indexOf(y),
    );
    if (open[0]) claims.set(open[0], c);
  }
  return claims;
}

export class ScriptedAgent {
  constructor(driver) {
    this.driver = driver;
  }

  chooseAction(legalActions) {
    if (legalActions.length === 0) return null;

    // Priority 1: Seize / Escape (win-condition actions)
    const seize = legalActions.find(
      (a) => a.type === 'choose_action' && a.payload.label === 'Seize',
    );
    if (seize) return seize;
    const escape = legalActions.find(
      (a) => a.type === 'choose_action' && a.payload.label === 'Escape',
    );
    if (escape) return escape;
    // A Vigil circle under the unit: Unweave it (it breaks now; standing alone only stops calls).
    const unweave = legalActions.find(
      (a) => a.type === 'choose_action' && a.payload.label === 'Unweave',
    );
    if (unweave) return unweave;

    // Priority 1b: a defeat map's targets are the win condition (boss-like priority): strike one
    // before anything else in reach, the weakest first. The guards need not fall.
    const targetStrikes = this._findTargetStrikes(legalActions);
    if (targetStrikes.length > 0) return targetStrikes[0];

    // Priority 2: Attack that kills (forecast HP <= 0)
    const kills = this._findKillTargets(legalActions);
    if (kills.length > 0) {
      // Pick lowest HP target
      kills.sort((a, b) => a._targetHP - b._targetHP);
      return kills[0];
    }

    // Priority 3: Attack any target (prefer lowest HP)
    const attacks = legalActions.filter((a) => a.type === 'choose_target');
    if (attacks.length > 0) {
      // Score by target HP
      const scored = attacks.map((a) => {
        const target = this._findUnit(a.payload.targetName, 'enemy');
        return { action: a, hp: target ? target.currentHP : Infinity };
      });
      scored.sort((a, b) => a.hp - b.hp);
      return scored[0].action;
    }

    // Priority 4: Choose Attack action
    const attackAction = legalActions.find(
      (a) => a.type === 'choose_action' && a.payload.label === 'Attack',
    );
    if (attackAction) return attackAction;

    // Priority 4b: Smash Zombie remains in reach (they rise again otherwise)
    const smashTarget = legalActions.find((a) => a.type === 'choose_remains');
    if (smashTarget) return smashTarget;
    const smashAction = legalActions.find(
      (a) => a.type === 'choose_action' && a.payload.label === 'Smash',
    );
    if (smashAction) return smashAction;

    // Priority 5: Heal ally below 50% HP
    const healAction = legalActions.find(
      (a) => a.type === 'choose_action' && a.payload.label === 'Heal',
    );
    if (healAction) {
      // Check if any ally actually needs healing
      const b = this.driver.battle;
      const needsHeal = b.playerUnits.some(
        (u) => u.currentHP < u.stats.HP * 0.5 && u !== b.selectedUnit,
      );
      if (needsHeal) return healAction;
    }

    // Priority 5b: Choose heal target (lowest HP ally)
    const healTargets = legalActions.filter((a) => a.type === 'choose_target');
    if (healTargets.length > 0) {
      const scored = healTargets.map((a) => {
        const target = this._findUnit(a.payload.targetName, 'player');
        return { action: a, hp: target ? target.currentHP : Infinity };
      });
      scored.sort((a, b) => a.hp - b.hp);
      return scored[0].action;
    }

    // Priority 6: Talk to NPC
    const talkAction = legalActions.find(
      (a) => a.type === 'choose_action' && a.payload.label === 'Talk',
    );
    if (talkAction) return talkAction;

    // Priority 7: Move toward the objective (escape squares on escape maps,
    // otherwise the nearest enemy)
    const moves = legalActions.filter((a) => a.type === 'move_to');
    if (moves.length > 0) {
      const b = this.driver.battle;
      const unit = b.selectedUnit;
      // A Vigil's ward: the unit claimed for a standing circle walks to it (then Unweaves it).
      const circle = unit ? this._claimedCircle(unit) : null;
      if (circle) {
        const cost = (action) => this._pathCost(unit, action.payload, circle);
        const scored = moves.map((action) => ({ action, cost: cost(action) }));
        scored.sort((x, y) => x.cost - y.cost);
        return scored[0].action;
      }
      if (unit && b.battleConfig?.objective === 'escape' && b.battleConfig?.escapeTiles?.length) {
        const tiles = b.battleConfig.escapeTiles;
        const distToExit = (col, row) =>
          Math.min(...tiles.map((t) => gridDistance(col, row, t.col, t.row)));
        moves.sort(
          (a, c) =>
            distToExit(a.payload.col, a.payload.row) - distToExit(c.payload.col, c.payload.row),
        );
        return moves[0];
      }
      // After the boss falls, a Lord must still reach the throne. Without
      // this objective target an empty enemy list makes the default move
      // repeatedly select the current tile, even with an adjacent throne.
      const throne = b.battleConfig?.thronePos;
      if (
        unit?.isLord &&
        b.battleConfig?.objective === 'seize' &&
        throne &&
        !b.enemyUnits.some((enemy) => enemy.isBoss)
      ) {
        const distance = (action) => {
          const { col, row } = action.payload;
          if (!b.grid?.findPath) return gridDistance(col, row, throne.col, throne.row);
          const path = b.grid.findPath(col, row, throne.col, throne.row, unit.moveType);
          return path
            ? path
                .slice(1)
                .reduce(
                  (cost, tile) => cost + b.grid.getMoveCost(tile.col, tile.row, unit.moveType),
                  0,
                )
            : Infinity;
        };
        const scored = moves.map((action) => ({ action, distance: distance(action) }));
        scored.sort((a, b) => a.distance - b.distance);
        return scored[0].action;
      }
      if (unit) {
        const nearestEnemy = this._findNearestEnemy(unit);
        if (nearestEnemy) {
          // Legal moves cover this turn; path cost guides later turns around walls.
          // Ignore temporary unit occupancy for the long route, not terrain.
          const distance = (action) => {
            const { col, row } = action.payload;
            if (!b.grid?.findPath)
              return gridDistance(col, row, nearestEnemy.col, nearestEnemy.row);
            const path = b.grid.findPath(
              col,
              row,
              nearestEnemy.col,
              nearestEnemy.row,
              unit.moveType,
            );
            if (!path) return Infinity;
            return path
              .slice(1)
              .reduce(
                (cost, tile) => cost + b.grid.getMoveCost(tile.col, tile.row, unit.moveType),
                0,
              );
          };
          const scored = moves.map((action) => ({ action, distance: distance(action) }));
          scored.sort((a, b) => a.distance - b.distance);
          return scored[0].action;
        }
      }
      // Default: first move
      return moves[0];
    }

    // Priority 8: Wait
    const waitAction = legalActions.find(
      (a) => a.type === 'choose_action' && a.payload.label === 'Wait',
    );
    if (waitAction) return waitAction;

    // Priority 9: Select unit (prefer closest to enemies, lords first for seize)
    const selects = legalActions.filter((a) => a.type === 'select_unit');
    if (selects.length > 0) {
      const b = this.driver.battle;
      const scored = selects.map((a) => {
        const unit = b.playerUnits.find((u) => u.name === a.payload.unitName);
        if (!unit) return { action: a, score: Infinity };

        let minDist = Infinity;
        for (const e of this._objectiveFoes()) {
          const d = gridDistance(unit.col, unit.row, e.col, e.row);
          if (d < minDist) minDist = d;
        }
        // Lords get priority on seize/escape maps (they carry the win condition)
        const lordBonus =
          ['seize', 'escape'].includes(b.battleConfig.objective) && unit.isLord ? -100 : 0;
        return { action: a, score: minDist + lordBonus };
      });
      scored.sort((a, b) => a.score - b.score);
      return scored[0].action;
    }

    // Priority 10: End turn
    const endTurn = legalActions.find((a) => a.type === 'end_turn');
    if (endTurn) return endTurn;

    // Fallback: cancel
    const cancelAction = legalActions.find((a) => a.type === 'cancel');
    if (cancelAction) return cancelAction;

    // Absolute fallback
    return legalActions[0];
  }

  /**
   * The foes the walk heads for: a defeat map's remaining targets (BattleObjectives), else every
   * enemy standing. The agent plays no fog, so a hidden target is still its mark.
   */
  _objectiveFoes() {
    const b = this.driver.battle;
    const field = b.objectiveField?.() ?? { enemyUnits: b.enemyUnits };
    const targets = objectiveTargetUnits(b.battleConfig, field);
    // The targets that can be hurt first (a warded Voice waits on its circle or the choir).
    const open = targets.filter((u) => !isWardedUnit(u));
    if (open.length > 0) return open;
    return targets.length > 0 ? targets : b.enemyUnits;
  }

  /** The Vigil ward circle `unit` is claimed for (wardCircleClaims), or null. */
  _claimedCircle(unit) {
    return wardCircleClaims(this.driver.battle).get(unit) || null;
  }

  /** Path cost from `from` to `goal` for `unit` (terrain, not units), else grid distance. */
  _pathCost(unit, from, goal) {
    const b = this.driver.battle;
    if (!b.grid?.findPath) return gridDistance(from.col, from.row, goal.col, goal.row);
    const path = b.grid.findPath(from.col, from.row, goal.col, goal.row, unit.moveType);
    if (!path) return Infinity;
    return path
      .slice(1)
      .reduce((cost, tile) => cost + b.grid.getMoveCost(tile.col, tile.row, unit.moveType), 0);
  }

  /** The attacks on a defeat map's targets among the legal actions, weakest target first. */
  _findTargetStrikes(legalActions) {
    const b = this.driver.battle;
    const field = b.objectiveField?.() ?? { enemyUnits: b.enemyUnits };
    // A warded target takes no damage: no point striking it.
    const targets = objectiveTargetUnits(b.battleConfig, field).filter((u) => !isWardedUnit(u));
    if (targets.length === 0) return [];
    return legalActions
      .filter((a) => a.type === 'choose_target')
      .map((a) => ({ action: a, unit: this._findUnit(a.payload.targetName, 'enemy') }))
      .filter(({ unit }) => unit && targets.includes(unit))
      .sort((x, y) => x.unit.currentHP - y.unit.currentHP)
      .map(({ action }) => action);
  }

  _findKillTargets(legalActions) {
    const targets = legalActions.filter((a) => a.type === 'choose_target');
    const kills = [];
    const b = this.driver.battle;
    const attacker = b.selectedUnit;
    if (!attacker) return kills;

    for (const a of targets) {
      const target = this._findUnit(a.payload.targetName, 'enemy');
      if (!target) continue;
      // Rough kill check: our attack power vs their HP
      const atk = (attacker.stats.STR || 0) + (attacker.weapon?.might || 0);
      const def = target.stats.DEF || 0;
      const dmg = Math.max(0, atk - def);
      if (dmg >= target.currentHP) {
        kills.push({ ...a, _targetHP: target.currentHP });
      }
    }
    return kills;
  }

  _findUnit(name, faction) {
    const b = this.driver.battle;
    if (faction === 'enemy') return b.enemyUnits.find((u) => u.name === name);
    if (faction === 'player') return b.playerUnits.find((u) => u.name === name);
    return [...b.playerUnits, ...b.enemyUnits, ...b.npcUnits].find((u) => u.name === name);
  }

  _findNearestEnemy(unit) {
    const b = this.driver.battle;
    let nearest = null;
    let minDist = Infinity;
    // With no foe left standing, a Rout waits on Zombie remains: head for them.
    const foes = this._objectiveFoes();
    const targets = foes.length ? foes : b._zombieTombstones || [];
    for (const e of targets) {
      const d = gridDistance(unit.col, unit.row, e.col, e.row);
      if (d < minDist) {
        minDist = d;
        nearest = e;
      }
    }
    return nearest;
  }
}

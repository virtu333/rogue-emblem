// ScriptedAgent — Priority-based tactical policy (deterministic, no extra randomness).

import { getCombatForecast, gridDistance } from '../../src/engine/Combat.js';

export class ScriptedAgent {
  constructor(driver) {
    this.driver = driver;
  }

  chooseAction(legalActions) {
    if (legalActions.length === 0) return null;

    // Priority 1: Seize (win condition)
    const seize = legalActions.find(a =>
      a.type === 'choose_action' && a.payload.label === 'Seize'
    );
    if (seize) return seize;

    // Priority 2: Attack that kills (forecast HP <= 0)
    const kills = this._findKillTargets(legalActions);
    if (kills.length > 0) {
      // Pick lowest HP target
      kills.sort((a, b) => a._targetHP - b._targetHP);
      return kills[0];
    }

    // Priority 3: Attack any target (prefer lowest HP)
    const attacks = legalActions.filter(a =>
      a.type === 'choose_target'
    );
    if (attacks.length > 0) {
      // Score by target HP
      const scored = attacks.map(a => {
        const target = this._findUnit(a.payload.targetName, 'enemy');
        return { action: a, hp: target ? target.currentHP : Infinity };
      });
      scored.sort((a, b) => a.hp - b.hp);
      return scored[0].action;
    }

    // Priority 4: Choose Attack action
    const attackAction = legalActions.find(a =>
      a.type === 'choose_action' && a.payload.label === 'Attack'
    );
    if (attackAction) return attackAction;

    // Priority 5: Heal ally below 50% HP
    const healAction = legalActions.find(a =>
      a.type === 'choose_action' && a.payload.label === 'Heal'
    );
    if (healAction) {
      // Check if any ally actually needs healing
      const b = this.driver.battle;
      const needsHeal = b.playerUnits.some(u =>
        u.currentHP < u.stats.HP * 0.5 && u !== b.selectedUnit
      );
      if (needsHeal) return healAction;
    }

    // Priority 5b: Choose heal target (lowest HP ally)
    const healTargets = legalActions.filter(a =>
      a.type === 'choose_target'
    );
    if (healTargets.length > 0) {
      const scored = healTargets.map(a => {
        const target = this._findUnit(a.payload.targetName, 'player');
        return { action: a, hp: target ? target.currentHP : Infinity };
      });
      scored.sort((a, b) => a.hp - b.hp);
      return scored[0].action;
    }

    // Priority 6: Talk to NPC
    const talkAction = legalActions.find(a =>
      a.type === 'choose_action' && a.payload.label === 'Talk'
    );
    if (talkAction) return talkAction;

    // Priority 7: Move toward nearest enemy
    const moves = legalActions.filter(a => a.type === 'move_to');
    if (moves.length > 0) {
      const unit = this.driver.battle.selectedUnit;
      if (unit) {
        const nearestEnemy = this._findNearestEnemy(unit);
        if (nearestEnemy) {
          moves.sort((a, b) => {
            const distA = gridDistance(a.payload.col, a.payload.row, nearestEnemy.col, nearestEnemy.row);
            const distB = gridDistance(b.payload.col, b.payload.row, nearestEnemy.col, nearestEnemy.row);
            return distA - distB;
          });
          return moves[0];
        }
      }
      // Default: first move
      return moves[0];
    }

    // Priority 8: Wait
    const waitAction = legalActions.find(a =>
      a.type === 'choose_action' && a.payload.label === 'Wait'
    );
    if (waitAction) return waitAction;

    // Priority 9: Select unit (prefer closest to enemies, lords first for seize)
    const selects = legalActions.filter(a => a.type === 'select_unit');
    if (selects.length > 0) {
      const b = this.driver.battle;
      const scored = selects.map(a => {
        const unit = b.playerUnits.find(u => u.name === a.payload.unitName);
        if (!unit) return { action: a, score: Infinity };

        let minDist = Infinity;
        for (const e of b.enemyUnits) {
          const d = gridDistance(unit.col, unit.row, e.col, e.row);
          if (d < minDist) minDist = d;
        }
        // Lords get priority on seize maps
        const lordBonus = (b.battleConfig.objective === 'seize' && unit.isLord) ? -100 : 0;
        return { action: a, score: minDist + lordBonus };
      });
      scored.sort((a, b) => a.score - b.score);
      return scored[0].action;
    }

    // Priority 10: End turn
    const endTurn = legalActions.find(a => a.type === 'end_turn');
    if (endTurn) return endTurn;

    // Fallback: cancel
    const cancelAction = legalActions.find(a => a.type === 'cancel');
    if (cancelAction) return cancelAction;

    // Absolute fallback
    return legalActions[0];
  }

  _findKillTargets(legalActions) {
    const targets = legalActions.filter(a => a.type === 'choose_target');
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
    if (faction === 'enemy') return b.enemyUnits.find(u => u.name === name);
    if (faction === 'player') return b.playerUnits.find(u => u.name === name);
    return [...b.playerUnits, ...b.enemyUnits, ...b.npcUnits].find(u => u.name === name);
  }

  _findNearestEnemy(unit) {
    const b = this.driver.battle;
    let nearest = null;
    let minDist = Infinity;
    for (const e of b.enemyUnits) {
      const d = gridDistance(unit.col, unit.row, e.col, e.row);
      if (d < minDist) { minDist = d; nearest = e; }
    }
    return nearest;
  }
}

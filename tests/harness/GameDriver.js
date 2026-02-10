// GameDriver — Canonical action API wrapping HeadlessBattle.
// Provides listLegalActions/step/snapshot for agents and test runners.

import { HeadlessBattle, HEADLESS_STATES } from './HeadlessBattle.js';
import { gridDistance } from '../../src/engine/Combat.js';
import { getCombatWeapons } from '../../src/engine/UnitManager.js';

export class GameDriver {
  constructor(gameData, battleParams, roster = null) {
    this.battle = new HeadlessBattle(gameData, battleParams, roster);
    this.replayLog = [];
    this.stepCount = 0;
  }

  init() {
    this.battle.init();
  }

  listLegalActions() {
    const state = this.battle.battleState;
    const actions = [];

    switch (state) {
      case HEADLESS_STATES.PLAYER_IDLE: {
        for (const u of this.battle.playerUnits) {
          if (!u.hasActed) {
            actions.push({ type: 'select_unit', payload: { unitName: u.name } });
          }
        }
        actions.push({ type: 'end_turn', payload: {} });
        break;
      }
      case HEADLESS_STATES.UNIT_SELECTED: {
        // All reachable tiles (including current position)
        for (const [key] of this.battle.movementRange) {
          const [col, row] = key.split(',').map(Number);
          actions.push({ type: 'move_to', payload: { col, row } });
        }
        // Current position if not already in movementRange
        const unit = this.battle.selectedUnit;
        const curKey = `${unit.col},${unit.row}`;
        if (!this.battle.movementRange.has(curKey)) {
          actions.push({ type: 'move_to', payload: { col: unit.col, row: unit.row } });
        }
        actions.push({ type: 'cancel', payload: {} });
        break;
      }
      case HEADLESS_STATES.UNIT_ACTION_MENU: {
        const menuActions = this.battle.getAvailableActions();
        for (const a of menuActions) {
          if (a.supported) {
            actions.push({ type: 'choose_action', payload: { label: a.label } });
          }
        }
        actions.push({ type: 'cancel', payload: {} });
        break;
      }
      case HEADLESS_STATES.SELECTING_TARGET: {
        for (const t of this.battle.attackTargets) {
          actions.push({ type: 'choose_target', payload: { targetName: t.name } });
        }
        actions.push({ type: 'cancel', payload: {} });
        break;
      }
      case HEADLESS_STATES.SELECTING_HEAL_TARGET: {
        for (const t of this.battle.healTargets) {
          actions.push({ type: 'choose_target', payload: { targetName: t.name } });
        }
        actions.push({ type: 'cancel', payload: {} });
        break;
      }
      case HEADLESS_STATES.BATTLE_END:
        return [];
      default:
        return [];
    }

    return actions;
  }

  async step(action) {
    this.replayLog.push({ i: this.stepCount, ...action });
    this.stepCount++;

    switch (action.type) {
      case 'select_unit':
        this.battle.selectUnit(action.payload.unitName);
        break;
      case 'move_to':
        this.battle.moveTo(action.payload.col, action.payload.row);
        break;
      case 'choose_action':
        this.battle.chooseAction(action.payload.label);
        break;
      case 'choose_target':
        if (this.battle.battleState === HEADLESS_STATES.SELECTING_TARGET) {
          this.battle.chooseAttackTarget(action.payload.targetName);
        } else if (this.battle.battleState === HEADLESS_STATES.SELECTING_HEAL_TARGET) {
          this.battle.chooseHealTarget(action.payload.targetName);
        } else {
          throw new Error(`choose_target called in invalid state: ${this.battle.battleState}`);
        }
        break;
      case 'cancel':
        this.battle.cancel();
        break;
      case 'end_turn':
        await this.battle.endTurn();
        break;
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }

    // Auto-process enemy phase if triggered (mirrors BattleScene's automatic transition)
    if (this.battle.battleState === HEADLESS_STATES.ENEMY_PHASE) {
      await this.battle._processEnemyPhase();
    }

    return {
      state: this.battle.battleState,
      turn: this.battle.turnManager?.turnNumber || 0,
      playerAlive: this.battle.playerUnits.length,
      enemyAlive: this.battle.enemyUnits.length,
    };
  }

  snapshot() {
    return {
      battleState: this.battle.battleState,
      turn: this.battle.turnManager?.turnNumber || 0,
      goldEarned: this.battle.goldEarned,
      playerUnits: this.battle.playerUnits.map(u => ({
        name: u.name, col: u.col, row: u.row,
        hp: u.currentHP, maxHp: u.stats.HP,
        level: u.level, xp: u.xp || 0,
        hasMoved: u.hasMoved, hasActed: u.hasActed,
        weapon: u.weapon?.name || null,
      })),
      enemyUnits: this.battle.enemyUnits.map(u => ({
        name: u.name, col: u.col, row: u.row,
        hp: u.currentHP, maxHp: u.stats.HP,
        level: u.level, weapon: u.weapon?.name || null,
      })),
      npcUnits: this.battle.npcUnits.map(u => ({
        name: u.name, col: u.col, row: u.row, hp: u.currentHP,
      })),
    };
  }

  stateHash() {
    return JSON.stringify(this.snapshot());
  }

  isTerminal() {
    return this.battle.result !== null;
  }

  getTerminalResult() {
    return this.battle.result;
  }
}

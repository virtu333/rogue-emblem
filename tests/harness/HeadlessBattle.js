// HeadlessBattle — Synchronous battle state machine for headless testing.
// Mirrors BattleScene's MVP subset (7 states) using real engine functions.

import { HeadlessGrid } from './HeadlessGrid.js';
import { TurnManager } from '../../src/engine/TurnManager.js';
import { AIController } from '../../src/engine/AIController.js';
import { generateBattle } from '../../src/engine/MapGenerator.js';
import {
  resolveCombat,
  resolveHeal,
  gridDistance,
  parseRange,
  isInRange,
  isStaff,
  getStaffRemainingUses,
  getEffectiveStaffRange,
  getStaffMaxUses,
  spendStaffUse,
} from '../../src/engine/Combat.js';
import {
  createLordUnit,
  createEnemyUnit,
  createRecruitUnit,
  calculateCombatXP,
  gainExperience,
  equipWeapon,
  hasStaff,
  getCombatWeapons,
  canPromote,
  promoteUnit,
  canEquip,
  getClassInnateSkills,
  addToInventory,
  addToConsumables,
  checkLevelUpSkills,
} from '../../src/engine/UnitManager.js';
import {
  getSkillCombatMods,
  rollStrikeSkills,
  rollDefenseSkills,
  checkAstra,
  getTurnStartEffects,
  getWeaponRangeBonus,
} from '../../src/engine/SkillSystem.js';
import { calculateKillGold } from '../../src/engine/LootSystem.js';
import {
  BOSS_STAT_BONUS,
  SUNDER_WEAPON_BY_TYPE,
  ROSTER_CAP,
} from '../../src/utils/constants.js';

export const HEADLESS_STATES = {
  PLAYER_IDLE: 'PLAYER_IDLE',
  UNIT_SELECTED: 'UNIT_SELECTED',
  UNIT_ACTION_MENU: 'UNIT_ACTION_MENU',
  SELECTING_TARGET: 'SELECTING_TARGET',
  SELECTING_HEAL_TARGET: 'SELECTING_HEAL_TARGET',
  ENEMY_PHASE: 'ENEMY_PHASE',
  BATTLE_END: 'BATTLE_END',
};

// MVP explicitly disables Canto
export const CANTO_DISABLED = true;

export class HeadlessBattle {
  constructor(gameData, battleParams, roster = null) {
    this.gameData = gameData;
    if (!this.gameData.skills) this.gameData.skills = [];
    this.battleParams = battleParams || { act: 'act1', objective: 'rout' };
    this.roster = roster;

    this.battleState = null;
    this.battleConfig = null;
    this.grid = null;
    this.turnManager = null;
    this.aiController = null;

    this.playerUnits = [];
    this.enemyUnits = [];
    this.npcUnits = [];
    this.goldEarned = 0;
    this.result = null; // 'victory' | 'defeat' | null

    this.selectedUnit = null;
    this.movementRange = null;
    this.preMoveLoc = null;
    this.attackTargets = [];
    this.healTargets = [];
    this.aiPhaseStatsHistory = [];
    this.lastEnemyPhaseAiStats = null;
    this.currentEnemyPhaseAiStats = null;
  }

  // Initialize battle — mirrors BattleScene.beginBattle
  init() {
    const bc = generateBattle(this.battleParams, {
      terrain: this.gameData.terrain,
      mapSizes: this.gameData.mapSizes,
      mapTemplates: this.gameData.mapTemplates,
      enemies: this.gameData.enemies,
      recruits: this.gameData.recruits,
      classes: this.gameData.classes,
      weapons: this.gameData.weapons,
    });
    this.battleConfig = bc;

    this.grid = new HeadlessGrid(
      bc.cols, bc.rows, this.gameData.terrain, bc.mapLayout, Boolean(this.battleParams.fogEnabled)
    );

    this.playerUnits = [];
    this.enemyUnits = [];
    this.npcUnits = [];
    this.goldEarned = 0;
    this.result = null;
    this.aiPhaseStatsHistory = [];
    this.lastEnemyPhaseAiStats = null;
    this.currentEnemyPhaseAiStats = null;

    // Create player units
    if (this.roster && this.roster.length > 0) {
      for (let i = 0; i < this.roster.length && i < bc.playerSpawns.length; i++) {
        const unit = this.roster[i];
        unit.col = bc.playerSpawns[i].col;
        unit.row = bc.playerSpawns[i].row;
        unit.hasMoved = false;
        unit.hasActed = false;
        unit._miracleUsed = false;
        unit._gambitUsedThisTurn = false;
        for (const w of (unit.inventory || [])) {
          if (w.perBattleUses) w._usesSpent = 0;
        }
        this.playerUnits.push(unit);
      }
    } else {
      this._createFallbackLords(bc);
    }

    // Create enemies
    for (const spawn of bc.enemySpawns) {
      const classData = this.gameData.classes.find(c => c.name === spawn.className);
      if (!classData) continue;
      const diffMod = this.battleParams.difficultyMod || 1.0;

      let enemy;
      if (classData.tier === 'promoted') {
        const baseClassData = this.gameData.classes.find(c => c.name === classData.promotesFrom);
        if (!baseClassData) continue;
        enemy = createEnemyUnit(baseClassData, spawn.level, this.gameData.weapons, diffMod, this.gameData.skills, this.battleParams.act);
        promoteUnit(enemy, classData, classData.promotionBonuses, this.gameData.skills);
      } else {
        enemy = createEnemyUnit(classData, spawn.level, this.gameData.weapons, diffMod, this.gameData.skills, this.battleParams.act);
      }

      enemy.col = spawn.col;
      enemy.row = spawn.row;
      if (spawn.isBoss) {
        enemy.isBoss = true;
        enemy.name = spawn.name || enemy.name;
        for (const stat of Object.keys(enemy.stats)) {
          enemy.stats[stat] += BOSS_STAT_BONUS;
        }
        enemy.currentHP = enemy.stats.HP;
      }
      if (spawn.sunderWeapon) {
        const primaryType = enemy.proficiencies?.[0]?.type;
        const sunderName = primaryType ? SUNDER_WEAPON_BY_TYPE[primaryType] : null;
        if (sunderName) {
          const sunderData = this.gameData.weapons.find(w => w.name === sunderName);
          if (sunderData) {
            const sunderClone = structuredClone(sunderData);
            enemy.weapon = sunderClone;
            enemy.inventory = [sunderClone];
          }
        }
      }
      // Assign guard AI mode if spawn has it
      if (spawn.aiMode) enemy.aiMode = spawn.aiMode;
      this.enemyUnits.push(enemy);
    }

    // Spawn NPC for recruit battles
    if (bc.npcSpawn) {
      const npcSpawn = bc.npcSpawn;
      const lord = this.playerUnits.find(u => u.isLord);
      if (lord) {
        npcSpawn.level = Math.max(1, lord.level - (Math.random() < 0.5 ? 1 : 0));
      }
      const npcClassData = this.gameData.classes.find(c => c.name === npcSpawn.className);
      if (npcClassData) {
        let npc;
        if (npcClassData.tier === 'promoted') {
          const baseClassData = this.gameData.classes.find(c => c.name === npcClassData.promotesFrom);
          if (baseClassData) {
            const baseDef = { ...npcSpawn, className: baseClassData.name };
            npc = createRecruitUnit(baseDef, baseClassData, this.gameData.weapons, null, null, null);
            for (const sid of getClassInnateSkills(baseClassData.name, this.gameData.skills)) {
              if (!npc.skills.includes(sid)) npc.skills.push(sid);
            }
            promoteUnit(npc, npcClassData, npcClassData.promotionBonuses, this.gameData.skills);
          }
        } else {
          npc = createRecruitUnit(npcSpawn, npcClassData, this.gameData.weapons, null, null, null);
          for (const sid of getClassInnateSkills(npcClassData.name, this.gameData.skills)) {
            if (!npc.skills.includes(sid)) npc.skills.push(sid);
          }
        }
        if (npc) {
          npc.col = npcSpawn.col;
          npc.row = npcSpawn.row;
          this.npcUnits.push(npc);
        }
      }
    }

    // Initialize turn system
    this.turnManager = new TurnManager({
      onPhaseChange: (phase, turn) => this._onPhaseChange(phase, turn),
      onVictory: () => this._onVictory(),
      onDefeat: () => this._onDefeat(),
    });
    this.turnManager.init(this.playerUnits, this.enemyUnits, this.npcUnits, bc.objective);

    // Initialize AI
    this.aiController = new AIController(this.grid, this.gameData, {
      objective: bc.objective,
      thronePos: bc.thronePos,
    });
    // Override delay for synchronous execution
    this.aiController._delay = () => Promise.resolve();

    // Start battle
    this.turnManager.startBattle();
    this._refreshFogVisibility();
    // Note: _onPhaseChange('player', 1) will set state to PLAYER_IDLE
    // Turn-start effects are applied in _onPhaseChange, not here (avoiding double-apply)
  }

  // --- State transitions ---

  selectUnit(unitName) {
    if (this.battleState !== HEADLESS_STATES.PLAYER_IDLE) {
      throw new Error(`Cannot select unit in state: ${this.battleState}`);
    }
    const matching = this.playerUnits.filter(u => u.name === unitName);
    if (matching.length === 0) throw new Error(`Unit not found: ${unitName}`);

    // Duplicate unit names can exist in simulations; prefer any unacted match.
    const unit = matching.find(u => !u.hasActed) || matching[0];
    if (unit.hasActed) throw new Error(`Unit already acted: ${unitName}`);

    this.selectedUnit = unit;
    this.preMoveLoc = { col: unit.col, row: unit.row };
    this.movementRange = this.grid.getMovementRange(
      unit.col, unit.row, unit.stats.MOV, unit.moveType,
      this._buildUnitPositionMap(unit.faction), unit.faction
    );
    this.battleState = HEADLESS_STATES.UNIT_SELECTED;
  }

  moveTo(col, row) {
    if (this.battleState !== HEADLESS_STATES.UNIT_SELECTED) {
      throw new Error(`Cannot move in state: ${this.battleState}`);
    }
    const key = `${col},${row}`;
    // Allow staying in place (current tile always in movementRange)
    if (!this.movementRange.has(key) && !(col === this.selectedUnit.col && row === this.selectedUnit.row)) {
      throw new Error(`Tile (${col},${row}) not reachable`);
    }

    // Track movement spent for Canto (deferred, but track anyway)
    const costEntry = this.movementRange.get(key);
    this.selectedUnit._movementSpent = costEntry ? costEntry.cost : 0;

    this.selectedUnit.col = col;
    this.selectedUnit.row = row;
    this.selectedUnit.hasMoved = true;
    this._refreshFogVisibility();
    this.battleState = HEADLESS_STATES.UNIT_ACTION_MENU;
  }

  getAvailableActions() {
    if (this.battleState !== HEADLESS_STATES.UNIT_ACTION_MENU) {
      throw new Error(`Cannot get actions in state: ${this.battleState}`);
    }
    const unit = this.selectedUnit;
    const actions = [];

    // Attack
    const attackTargets = this._findAttackTargets(unit);
    if (attackTargets.length > 0) actions.push({ label: 'Attack', supported: true });

    // Heal
    const healTargets = this._findHealTargets(unit);
    if (healTargets.length > 0) actions.push({ label: 'Heal', supported: true });

    // Seize
    if (this.battleConfig.objective === 'seize' && unit.isLord) {
      const throne = this.battleConfig.thronePos;
      const bossAlive = this.enemyUnits.some(u => u.isBoss);
      if (throne && unit.col === throne.col && unit.row === throne.row && !bossAlive) {
        actions.push({ label: 'Seize', supported: true });
      }
    }

    // Talk
    if (unit.isLord && this.npcUnits.length > 0) {
      const talkTarget = this._findTalkTarget(unit);
      if (talkTarget && this.playerUnits.length < ROSTER_CAP) {
        actions.push({ label: 'Talk', supported: true });
      }
    }

    // Deferred actions (listed but unsupported in MVP)
    const equippable = unit.inventory.filter(item =>
      item.type !== 'Consumable' && canEquip(unit, item)
    );
    if (equippable.length >= 2) actions.push({ label: 'Equip', supported: false });
    const hasPromotionSeal = (unit.consumables || []).some(item => item?.effect === 'promote' && (item.uses ?? 0) > 0);
    if (canPromote(unit) && hasPromotionSeal) actions.push({ label: 'Promote', supported: false });
    if ((unit.consumables || []).length > 0) actions.push({ label: 'Item', supported: false });

    // Wait (always available)
    actions.push({ label: 'Wait', supported: true });

    return actions;
  }

  chooseAction(label) {
    if (this.battleState !== HEADLESS_STATES.UNIT_ACTION_MENU) {
      throw new Error(`Cannot choose action in state: ${this.battleState}`);
    }

    switch (label) {
      case 'Attack': {
        this.attackTargets = this._findAttackTargets(this.selectedUnit);
        if (this.attackTargets.length === 0) throw new Error('No attack targets');
        // Auto-equip combat weapon if holding staff
        if (isStaff(this.selectedUnit.weapon)) {
          const combat = getCombatWeapons(this.selectedUnit);
          if (combat.length > 0) equipWeapon(this.selectedUnit, combat[0]);
        }
        this.battleState = HEADLESS_STATES.SELECTING_TARGET;
        break;
      }
      case 'Heal': {
        this.healTargets = this._findHealTargets(this.selectedUnit);
        if (this.healTargets.length === 0) throw new Error('No heal targets');
        // Auto-equip active usable staff
        const staff = this._getActiveHealStaff(this.selectedUnit);
        if (staff && this.selectedUnit.weapon !== staff) {
          equipWeapon(this.selectedUnit, staff);
        }
        this.battleState = HEADLESS_STATES.SELECTING_HEAL_TARGET;
        break;
      }
      case 'Wait':
        this._finishUnitAction(this.selectedUnit);
        break;
      case 'Seize':
        this._onVictory();
        break;
      case 'Talk': {
        const target = this._findTalkTarget(this.selectedUnit);
        if (!target) throw new Error('No talk target');
        this._executeTalk(this.selectedUnit, target);
        break;
      }
      default: {
        const actions = this.getAvailableActions();
        const action = actions.find(a => a.label === label);
        if (action && !action.supported) {
          throw new Error(`Action "${label}" is not supported in MVP`);
        }
        throw new Error(`Unknown action: ${label}`);
      }
    }
  }

  chooseAttackTarget(targetName) {
    if (this.battleState !== HEADLESS_STATES.SELECTING_TARGET) {
      throw new Error(`Cannot choose attack target in state: ${this.battleState}`);
    }
    const target = this.attackTargets.find(u => u.name === targetName);
    if (!target) throw new Error(`Target not in attack range: ${targetName}`);

    // Ensure equipped weapon can reach target
    this._ensureValidWeaponForTarget(this.selectedUnit, target);
    this._executeCombat(this.selectedUnit, target);
  }

  chooseHealTarget(targetName) {
    if (this.battleState !== HEADLESS_STATES.SELECTING_HEAL_TARGET) {
      throw new Error(`Cannot choose heal target in state: ${this.battleState}`);
    }
    const target = this.healTargets.find(u => u.name === targetName);
    if (!target) throw new Error(`Target not in heal range: ${targetName}`);

    this._executeHeal(this.selectedUnit, target);
  }

  undoMove() {
    if (this.battleState !== HEADLESS_STATES.UNIT_ACTION_MENU) {
      throw new Error(`Cannot undo move in state: ${this.battleState}`);
    }
    if (this.preMoveLoc) {
      this.selectedUnit.col = this.preMoveLoc.col;
      this.selectedUnit.row = this.preMoveLoc.row;
      this.selectedUnit.hasMoved = false;
      this.selectedUnit._movementSpent = 0;
      this._refreshFogVisibility();
    }
    this.battleState = HEADLESS_STATES.UNIT_SELECTED;
  }

  cancel() {
    switch (this.battleState) {
      case HEADLESS_STATES.UNIT_SELECTED:
        this.selectedUnit = null;
        this.movementRange = null;
        this.preMoveLoc = null;
        this.battleState = HEADLESS_STATES.PLAYER_IDLE;
        break;
      case HEADLESS_STATES.UNIT_ACTION_MENU:
        this.undoMove();
        break;
      case HEADLESS_STATES.SELECTING_TARGET:
      case HEADLESS_STATES.SELECTING_HEAL_TARGET:
        this.attackTargets = [];
        this.healTargets = [];
        this.battleState = HEADLESS_STATES.UNIT_ACTION_MENU;
        break;
      default:
        throw new Error(`Cannot cancel in state: ${this.battleState}`);
    }
  }

  async endTurn() {
    if (this.battleState !== HEADLESS_STATES.PLAYER_IDLE) {
      throw new Error(`Cannot end turn in state: ${this.battleState}`);
    }
    // Mark all remaining player units as acted
    for (const u of this.playerUnits) {
      if (!u.hasActed) {
        u.hasActed = true;
      }
    }
    this.turnManager.endPlayerPhase();
    // Note: enemy phase processing is handled by GameDriver after step()
  }

  // --- Internal methods ---

  _createFallbackLords(bc) {
    const edric = this.gameData.lords.find(l => l.name === 'Edric');
    const edricClass = this.gameData.classes.find(c => c.name === edric.class);
    const p1 = createLordUnit(edric, edricClass, this.gameData.weapons);
    p1.col = bc.playerSpawns[0].col;
    p1.row = bc.playerSpawns[0].row;
    const steelSword = this.gameData.weapons.find(w => w.name === 'Steel Sword');
    if (steelSword) addToInventory(p1, steelSword);
    const vul = this.gameData.consumables.find(c => c.name === 'Vulnerary');
    if (vul) addToConsumables(p1, vul);
    this.playerUnits.push(p1);

    if (bc.playerSpawns.length > 1) {
      const sera = this.gameData.lords.find(l => l.name === 'Sera');
      const seraClass = this.gameData.classes.find(c => c.name === sera.class);
      const p2 = createLordUnit(sera, seraClass, this.gameData.weapons);
      p2.col = bc.playerSpawns[1].col;
      p2.row = bc.playerSpawns[1].row;
      p2.proficiencies.push({ type: 'Staff', rank: 'Prof' });
      const heal = this.gameData.weapons.find(w => w.name === 'Heal');
      if (heal) addToInventory(p2, heal);
      const vul2 = this.gameData.consumables.find(c => c.name === 'Vulnerary');
      if (vul2) addToConsumables(p2, vul2);
      this.playerUnits.push(p2);
    }
  }

  _onPhaseChange(phase, turn) {
    if (phase === 'player') {
      for (const u of this.playerUnits) {
        u.hasMoved = false;
        u.hasActed = false;
        u._gambitUsedThisTurn = false;
        u._movementSpent = 0;
      }
      // Apply turn-start effects (Renewal, etc.) — skip turn 1 to match BattleScene
      if (turn > 1) {
        this._processTurnStartEffects();
      }
      this._refreshFogVisibility();
      this.battleState = HEADLESS_STATES.PLAYER_IDLE;
    } else if (phase === 'enemy') {
      this.battleState = HEADLESS_STATES.ENEMY_PHASE;
    }
  }

  _onVictory() {
    this.result = 'victory';
    this.battleState = HEADLESS_STATES.BATTLE_END;
  }

  _onDefeat() {
    this.result = 'defeat';
    this.battleState = HEADLESS_STATES.BATTLE_END;
  }

  _processTurnStartEffects() {
    const effects = getTurnStartEffects(this.playerUnits, this.gameData.skills);
    for (const effect of effects) {
      if (effect.type === 'heal' && effect.target.currentHP < effect.target.stats.HP) {
        effect.target.currentHP = Math.min(
          effect.target.stats.HP,
          effect.target.currentHP + effect.amount
        );
      }
    }
  }

  _refreshFogVisibility() {
    if (!this.grid?.fogEnabled) return;
    this.grid.updateFogOfWar(this.playerUnits);
  }

  _buildUnitPositionMap(moverFaction) {
    const map = new Map();
    for (const u of [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits]) {
      map.set(`${u.col},${u.row}`, { faction: u.faction });
    }
    return map;
  }

  _findAttackTargets(unit) {
    const targets = [];
    const combatWeapons = getCombatWeapons(unit);
    if (combatWeapons.length === 0) return targets;
    const enemies = unit.faction === 'player' ? this.enemyUnits : this.playerUnits;
    for (const enemy of enemies) {
      if (this.grid.fogEnabled && unit.faction === 'player' && !this.grid.isVisible(enemy.col, enemy.row)) continue;
      const dist = gridDistance(unit.col, unit.row, enemy.col, enemy.row);
      if (combatWeapons.some(w => {
        const bonus = getWeaponRangeBonus(unit, w, this.gameData.skills);
        const { min, max } = parseRange(w.range);
        return dist >= min && dist <= max + bonus;
      })) {
        targets.push(enemy);
      }
    }
    return targets;
  }

  _findHealTargets(unit) {
    if (!hasStaff(unit)) return [];
    const staff = this._getActiveHealStaff(unit);
    if (!staff) return [];
    const range = getEffectiveStaffRange(staff, unit);
    const targets = [];
    for (const ally of this.playerUnits) {
      if (ally === unit) continue;
      if (ally.currentHP >= ally.stats.HP) continue;
      const dist = gridDistance(unit.col, unit.row, ally.col, ally.row);
      if (dist >= range.min && dist <= range.max) {
        targets.push(ally);
      }
    }
    return targets;
  }

  _findTalkTarget(unit) {
    if (!unit.isLord) return null;
    for (const npc of this.npcUnits) {
      const dist = gridDistance(unit.col, unit.row, npc.col, npc.row);
      if (dist === 1) return npc;
    }
    return null;
  }

  _ensureValidWeaponForTarget(unit, target) {
    const dist = gridDistance(unit.col, unit.row, target.col, target.row);
    if (unit.weapon && isInRange(unit.weapon, dist) && !isStaff(unit.weapon)) return;
    // Find a weapon that can reach the target
    const combatWeapons = getCombatWeapons(unit);
    for (const w of combatWeapons) {
      const bonus = getWeaponRangeBonus(unit, w, this.gameData.skills);
      const { min, max } = parseRange(w.range);
      if (dist >= min && dist <= max + bonus) {
        equipWeapon(unit, w);
        return;
      }
    }
  }

  _buildSkillCtx(attacker, defender) {
    const skills = this.gameData.skills;
    const getAllies = (u) => {
      if (u.faction === 'player') return this.playerUnits;
      if (u.faction === 'npc') return [u];
      return this.enemyUnits;
    };
    const getEnemies = (u) => {
      if (u.faction === 'player') return this.enemyUnits;
      if (u.faction === 'npc') return this.enemyUnits;
      return this.playerUnits;
    };

    const atkTerrain = this.grid.getTerrainAt(attacker.col, attacker.row);
    const defTerrain = this.grid.getTerrainAt(defender.col, defender.row);

    return {
      atkMods: getSkillCombatMods(attacker, defender, getAllies(attacker), getEnemies(attacker), skills, atkTerrain, true),
      defMods: getSkillCombatMods(defender, attacker, getAllies(defender), getEnemies(defender), skills, defTerrain, false),
      rollStrikeSkills,
      rollDefenseSkills,
      checkAstra,
      skillsData: skills,
    };
  }

  _executeCombat(attacker, defender) {
    const dist = gridDistance(attacker.col, attacker.row, defender.col, defender.row);
    const atkTerrain = this.grid.getTerrainAt(attacker.col, attacker.row);
    const defTerrain = this.grid.getTerrainAt(defender.col, defender.row);
    const skillCtx = this._buildSkillCtx(attacker, defender);

    const result = resolveCombat(
      attacker, attacker.weapon,
      defender, defender.weapon,
      dist, atkTerrain, defTerrain,
      skillCtx
    );

    // Apply HP
    attacker.currentHP = result.attackerHP;
    defender.currentHP = result.defenderHP;

    // Apply poison
    if (result.poisonEffects?.length > 0) {
      for (const pe of result.poisonEffects) {
        const target = pe.target === 'defender' ? defender : attacker;
        target.currentHP = Math.max(1, target.currentHP - pe.damage);
      }
    }

    // Award XP to player attacker
    if (attacker.faction === 'player' && !result.attackerDied) {
      const xp = calculateCombatXP(attacker, defender, result.defenderDied);
      gainExperience(attacker, xp);
      checkLevelUpSkills(attacker, this.gameData.classes);
    }

    // Remove dead units
    if (result.defenderDied) this._removeUnit(defender);
    if (result.attackerDied) this._removeUnit(attacker);

    // Check battle end
    if (this._checkBattleEnd()) return;

    if (result.attackerDied) {
      this.selectedUnit = null;
      this.attackTargets = [];
      this.battleState = HEADLESS_STATES.PLAYER_IDLE;
      return;
    }

    // Commander's Gambit
    if (!attacker._gambitUsedThisTurn) {
      const gambitTriggered = result.events?.some(e =>
        e.skillActivations?.some(s => s.id === 'commanders_gambit')
      );
      if (gambitTriggered) {
        attacker._gambitUsedThisTurn = true;
        const toRefresh = [attacker];
        for (const ally of this.playerUnits) {
          if (ally === attacker || ally.currentHP <= 0) continue;
          if (gridDistance(attacker.col, attacker.row, ally.col, ally.row) <= 1) {
            toRefresh.push(ally);
          }
        }
        for (const u of toRefresh) {
          u.hasActed = false;
          u.hasMoved = false;
          u._movementSpent = 0;
        }
        this.selectedUnit = null;
        this.attackTargets = [];
        this.battleState = HEADLESS_STATES.PLAYER_IDLE;
        return;
      }
    }

    this._finishUnitAction(attacker);
  }

  _executeHeal(healer, target) {
    const staff = this._getActiveHealStaff(healer);
    if (!staff) return;
    const result = resolveHeal(staff, healer, target);
    target.currentHP = result.targetHPAfter;
    spendStaffUse(staff);

    // Award XP for healing
    if (healer.faction === 'player') {
      const xp = Math.max(1, Math.floor(result.healAmount / 2));
      gainExperience(healer, xp);
      checkLevelUpSkills(healer, this.gameData.classes);
    }

    // Check staff depletion
    if (getStaffRemainingUses(staff, healer) <= 0) {
      const idx = healer.inventory.indexOf(staff);
      if (idx !== -1) healer.inventory.splice(idx, 1);
      const combat = getCombatWeapons(healer);
      if (combat.length > 0) equipWeapon(healer, combat[0]);
    }

    this._finishUnitAction(healer);
  }

  _getUsableStaves(unit) {
    return unit.inventory.filter(w =>
      w.type === 'Staff'
      && getStaffMaxUses(w, unit) > 0
      && getStaffRemainingUses(w, unit) > 0
    );
  }

  _getActiveHealStaff(unit) {
    const usable = this._getUsableStaves(unit);
    if (usable.length === 0) return null;
    if (unit.weapon && usable.includes(unit.weapon)) return unit.weapon;
    return usable[0];
  }

  _executeTalk(lord, npc) {
    // Convert NPC to player faction
    npc.faction = 'player';
    const idx = this.npcUnits.indexOf(npc);
    if (idx !== -1) this.npcUnits.splice(idx, 1);
    this.playerUnits.push(npc);
    npc.hasActed = true; // Can't act again this turn
    this._refreshFogVisibility();

    this._finishUnitAction(lord);
  }

  _finishUnitAction(unit) {
    this.attackTargets = [];
    this.healTargets = [];

    // Canto disabled in MVP
    unit.hasActed = true;
    this.selectedUnit = null;
    this.preMoveLoc = null;
    this.battleState = HEADLESS_STATES.PLAYER_IDLE;
    this.turnManager.unitActed(unit);
  }

  _removeUnit(unit) {
    if (unit.faction === 'player') {
      const idx = this.playerUnits.indexOf(unit);
      if (idx !== -1) this.playerUnits.splice(idx, 1);
    } else if (unit.faction === 'npc') {
      const idx = this.npcUnits.indexOf(unit);
      if (idx !== -1) this.npcUnits.splice(idx, 1);
    } else {
      const idx = this.enemyUnits.indexOf(unit);
      if (idx !== -1) this.enemyUnits.splice(idx, 1);
      this.goldEarned += calculateKillGold(unit);
    }
  }

  _checkBattleEnd() {
    const edricAlive = this.playerUnits.some(u => u.name === 'Edric');
    if (!edricAlive || this.playerUnits.length === 0) {
      this._onDefeat();
      return true;
    }
    if (this.battleConfig.objective === 'rout' && this.enemyUnits.length === 0) {
      this._onVictory();
      return true;
    }
    return false;
  }

  async _processEnemyPhase() {
    this.currentEnemyPhaseAiStats = this._createEnemyPhaseAiStats();
    try {
      await this.aiController.processEnemyPhase(
        this.enemyUnits,
        this.playerUnits,
        this.npcUnits,
        {
          onMoveUnit: (enemy, path) => {
            if (path && path.length >= 2) {
              const dest = path[path.length - 1];
              enemy.col = dest.col;
              enemy.row = dest.row;
            }
            return Promise.resolve();
          },
          onAttack: (enemy, target) => {
            this._executeEnemyCombat(enemy, target);
            return Promise.resolve();
          },
          onDecision: (enemy, decision) => this._recordEnemyAiDecision(enemy, decision),
          onUnitDone: (enemy) => {
            enemy.hasActed = true;
          },
        }
      );
    } finally {
      this._finalizeEnemyPhaseAiStats();
    }

    if (this.battleState !== HEADLESS_STATES.BATTLE_END) {
      this.turnManager.endEnemyPhase();
    }
  }

  _createEnemyPhaseAiStats() {
    return {
      turn: this.turnManager?.turnNumber || 0,
      enemyCountAtStart: this.enemyUnits.length,
      byReason: {},
      noPathUnits: [],
    };
  }

  _recordEnemyAiDecision(enemy, decision) {
    if (!this.currentEnemyPhaseAiStats) return;
    const reason = decision?.reason || 'unknown';
    const bucket = this.currentEnemyPhaseAiStats.byReason;
    bucket[reason] = (bucket[reason] || 0) + 1;
    if (reason === 'no_reachable_move') {
      this.currentEnemyPhaseAiStats.noPathUnits.push({
        name: enemy.name || null,
        className: enemy.className || null,
        col: enemy.col,
        row: enemy.row,
        detail: decision?.detail || null,
      });
    }
  }

  _finalizeEnemyPhaseAiStats() {
    if (!this.currentEnemyPhaseAiStats) return;
    this.lastEnemyPhaseAiStats = this.currentEnemyPhaseAiStats;
    this.aiPhaseStatsHistory.push(this.currentEnemyPhaseAiStats);
    if (this.aiPhaseStatsHistory.length > 20) this.aiPhaseStatsHistory.shift();
    this.currentEnemyPhaseAiStats = null;
  }

  getLastEnemyPhaseAiStats() {
    return this.lastEnemyPhaseAiStats;
  }

  _executeEnemyCombat(attacker, defender) {
    const dist = gridDistance(attacker.col, attacker.row, defender.col, defender.row);
    const atkTerrain = this.grid.getTerrainAt(attacker.col, attacker.row);
    const defTerrain = this.grid.getTerrainAt(defender.col, defender.row);
    const skillCtx = this._buildSkillCtx(attacker, defender);

    const result = resolveCombat(
      attacker, attacker.weapon,
      defender, defender.weapon,
      dist, atkTerrain, defTerrain,
      skillCtx
    );

    attacker.currentHP = result.attackerHP;
    defender.currentHP = result.defenderHP;

    if (result.poisonEffects?.length > 0) {
      for (const pe of result.poisonEffects) {
        const target = pe.target === 'defender' ? defender : attacker;
        target.currentHP = Math.max(1, target.currentHP - pe.damage);
      }
    }

    // Award XP to player defender
    if (defender.faction === 'player' && !result.defenderDied) {
      const xp = calculateCombatXP(defender, attacker, result.attackerDied);
      gainExperience(defender, xp);
      checkLevelUpSkills(defender, this.gameData.classes);
    }

    if (result.defenderDied) this._removeUnit(defender);
    if (result.attackerDied) this._removeUnit(attacker);

    this._checkBattleEnd();
  }

  getUnitAt(col, row) {
    return [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits]
      .find(u => u.col === col && u.row === row) || null;
  }
}

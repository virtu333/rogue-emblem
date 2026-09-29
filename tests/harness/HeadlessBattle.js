// HeadlessBattle — Synchronous battle state machine for headless testing.
// Mirrors BattleScene's MVP subset (7 states) using real engine functions.

import { HeadlessGrid } from './HeadlessGrid.js';
import { TurnManager } from '../../src/engine/TurnManager.js';
import {
  commitBattleDeeds,
  recordCombat,
  recordEnemyPhaseEnd,
  recordHeal,
  recordKill,
} from '../../src/engine/DeedSystem.js';
import { AIController } from '../../src/engine/AIController.js';
import { generateBattle, reconcileRecruitSpawnTile } from '../../src/engine/MapGenerator.js';
import { scheduleReinforcementsForTurn } from '../../src/engine/ReinforcementScheduler.js';
import {
  armyAndNpcAllies,
  isRecruitNpc,
  staffAllyCandidates,
} from '../../src/engine/RecruitNpc.js';
import { canInspectUnit } from '../../src/engine/BattleInformation.js';
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
  createPromotedEnemyUnit,
  equipWeapon,
  hasStaff,
  getCombatWeapons,
  canPromote,
  canEquip,
  addToInventory,
  addToConsumables,
  grantSecondaryWeapons,
} from '../../src/engine/UnitManager.js';
import {
  getSkillCombatMods,
  rollStrikeSkills,
  rollDefenseSkills,
  checkAstra,
  getTurnStartEffects,
  getWeaponRangeBonus,
  checkPhoenixBrooch,
  resolveGamblerDelta,
  applyAccessoryPhaseCombatMods,
} from '../../src/engine/SkillSystem.js';
import {
  getAttackAffixes,
  getTurnStartAffixes,
  rollDefenseAffixes,
} from '../../src/engine/AffixSystem.js';
import {
  applyWeaponArtCost,
  canUseWeaponArt,
  getEffectiveWeaponArtHpCost,
  getWeaponArtCombatMods,
  getWeaponArtIds,
  isWeaponArtCompatibleWithWeapon,
  recordWeaponArtUse,
} from '../../src/engine/WeaponArtSystem.js';
import { processConditionRecovery } from '../../src/engine/StatusConditionSystem.js';
import { calculateKillReward } from '../../src/engine/LootSystem.js';
import {
  calculatePar,
  getLatePressureState,
  getParXpMultiplier,
} from '../../src/engine/TurnBonusCalculator.js';
import { getTraitXpMultiplier } from '../../src/engine/MasterySystem.js';
import {
  createVillageState,
  visitVillage,
  razeVillage,
  clearSeekTileBandits,
  getVillageGoldReward,
  rollVillageRewardItem,
  VILLAGE_STATUS,
} from '../../src/engine/VillageSystem.js';
import { computeLavaCrackHp, isLavaCrackTerrainIndex } from '../../src/engine/TerrainHazards.js';
import { stampCommanderFlag } from '../../src/engine/Commander.js';
import {
  buildRecruitNodeUnit,
  spawnTilesForDeployment,
} from '../../src/engine/RecruitNodeSystem.js';
import {
  BOSS_STAT_BONUS,
  SUNDER_WEAPON_BY_TYPE,
  POISON_WEAPON_BY_TYPE,
  TERRAIN,
  XP_BASE_HEAL,
  XP_SPECIAL_ENEMY_MULTIPLIER,
  ESCAPE_EVAC_GOLD_BY_ACT,
} from '../../src/utils/constants.js';
import { applyCombatHP, setUnitHP } from '../../src/engine/UnitHealth.js';
import { postCombatEffects, runPostCombatEffectsSync } from '../../src/engine/PostCombatEffects.js';
import {
  applyTimedBuffEntry,
  expireTimedBuffs,
  resolveTimedBuffExpiry,
  timedBuffCombatMods,
} from '../../src/engine/TimedWeaponArtBuffs.js';
import { applyBattleDebuff, clearBattleScopedDeltas } from '../../src/engine/BattleStatDeltas.js';
import { applyXpGain, combatXpAwards, scaledXp } from '../../src/engine/BattleXp.js';

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

const HIDDEN_WEAPON_ART_REASONS = new Set([
  'legendary_weapon_required',
  'owner_scope_mismatch',
  'faction_mismatch',
  'wrong_weapon_type',
  'invalid_owner_scope_config',
  'invalid_faction_config',
  'invalid_legendary_weapon_ids_config',
  'invalid_unlock_act_config',
  'invalid_input',
]);

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
    this.escapedUnits = [];
    this.goldEarned = 0;
    this.result = null; // 'victory' | 'defeat' | null

    this.selectedUnit = null;
    this.movementRange = null;
    this.preMoveLoc = null;
    this.attackTargets = [];
    this.healTargets = [];
    this._selectedWeaponArt = null;
    this.aiPhaseStatsHistory = [];
    this.lastEnemyPhaseAiStats = null;
    this.currentEnemyPhaseAiStats = null;
    this.reinforcementTemplatePool = null;
    this.lastReinforcementSchedule = null;
    this.appliedHybridOverrideTurns = new Set();
    this.lastHybridOverrideResult = null;
    this._combatRollSession = null;
    this.runManager = null;
    this._reinforcementsPendingThisTurn = false;
    this._villageState = null;
    this.villageRewardItems = [];
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
      affixes: this.gameData.affixes,
      difficulty: this.gameData.difficulty,
    });
    this.battleConfig = bc;

    this.grid = new HeadlessGrid(
      bc.cols,
      bc.rows,
      this.gameData.terrain,
      bc.mapLayout,
      Boolean(this.battleParams.fogEnabled),
    );

    this.playerUnits = [];
    this.enemyUnits = [];
    this.npcUnits = [];
    this.escapedUnits = [];
    this.goldEarned = 0;
    this.result = null;
    this._selectedWeaponArt = null;
    this.aiPhaseStatsHistory = [];
    this.lastEnemyPhaseAiStats = null;
    this.currentEnemyPhaseAiStats = null;
    this.reinforcementTemplatePool = null;
    this.lastReinforcementSchedule = null;
    this.appliedHybridOverrideTurns = new Set();
    this.lastHybridOverrideResult = null;
    this._combatRollSession = null;
    this._reinforcementsPendingThisTurn = false;
    this._villageState = bc.villageTile ? createVillageState(bc.villageTile) : null;
    this.villageRewardItems = [];

    // Create player units
    if (this.roster && this.roster.length > 0) {
      // Recruit battles: lords take the spawns nearest the recruit (mirrors BattleScene).
      const tiles = spawnTilesForDeployment(this.roster, bc.playerSpawns, {
        lordsFirst: Boolean(bc.npcSpawn),
      });
      for (let i = 0; i < this.roster.length; i++) {
        if (!tiles[i]) continue;
        const unit = this.roster[i];
        unit.col = tiles[i].col;
        unit.row = tiles[i].row;
        unit.hasMoved = false;
        unit.hasActed = false;
        unit._miracleUsed = false;
        unit._phoenixBroochUsed = false;
        unit._gambitUsedThisTurn = false;
        for (const w of unit.inventory || []) {
          if (w.perBattleUses) w._usesSpent = 0;
        }
        this.playerUnits.push(unit);
      }
    } else {
      this._createFallbackLords(bc);
    }

    // Mirrors BattleScene: the commander flag must exist before the first
    // _checkBattleEnd because the defeat check is strict on it.
    stampCommanderFlag(this.playerUnits);

    // Create enemies
    for (const spawn of bc.enemySpawns) {
      this._addEnemyFromSpawn(spawn);
    }

    // Spawn NPC for recruit battles — the same RecruitNodeSystem build as BattleScene
    // (own seeded stream; the battle's Math.random is not consumed). Full-run sims
    // pass the run roster / seed / node id so the NPC matches the Loom preview.
    if (bc.npcSpawn) {
      const npcSpawn = bc.npcSpawn;
      const built = buildRecruitNodeUnit({
        preview: { className: npcSpawn.className, name: npcSpawn.name },
        nodeId: this.battleParams?.recruitNodeId || 'recruit',
        runSeed: this.battleParams?.recruitRunSeed ?? this.battleParams?.battleSeed ?? 0,
        act: this.battleParams?.act || 'act1',
        roster: Array.isArray(this.battleParams?.recruitRoster)
          ? this.battleParams.recruitRoster
          : this.playerUnits,
        fallenUnits: this.battleParams?.fallenUnits || [],
        gameData: this.gameData,
        metaEffects: this.battleParams?.metaEffects || null,
        startingLordNames: this.battleParams?.startingLordNames,
        recruitLevelBonus: Math.trunc(Number(this.battleParams?.recruitLevelBonus) || 0),
        deployBonus: Math.trunc(Number(this.battleParams?.deployBonus) || 0),
      });
      if (built?.unit) {
        const npc = built.unit;
        // Mirrors BattleScene: the tile must suit the unit that spawned (lord roll).
        reconcileRecruitSpawnTile(bc, {
          moveType: npc.moveType || 'Infantry',
          terrainData: this.gameData.terrain,
          classesData: this.gameData.classes,
          weaponsData: this.gameData.weapons,
        });
        npc.col = npcSpawn.col;
        npc.row = npcSpawn.row;
        npc._phoenixBroochUsed = false;
        this.npcUnits.push(npc);
      }
    }

    for (const unit of [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits]) {
      unit._phoenixBroochUsed = false;
    }

    // Turn par — mirrors BattleScene (full-run sims commit the Eclipse against it).
    this.turnPar = this.gameData.turnBonus
      ? calculatePar(
          {
            cols: bc.cols,
            rows: bc.rows,
            enemyCount: this.enemyUnits.length,
            objective: bc.objective,
            mapLayout: bc.mapLayout,
            terrainData: this.gameData.terrain,
            parBonus: bc.parBonus || 0,
          },
          this.gameData.turnBonus,
          this.battleParams?.difficultyId,
        )
      : null;

    // Initialize turn system
    this.turnManager = new TurnManager({
      onPhaseChange: (phase, turn) => this._onPhaseChange(phase, turn),
      onVictory: () => this._onVictory(),
      onDefeat: () => this._onDefeat(),
      checkBattleEnd: () => this._checkBattleEnd(),
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
    const matching = this.playerUnits.filter((u) => u.name === unitName);
    if (matching.length === 0) throw new Error(`Unit not found: ${unitName}`);

    // Duplicate unit names can exist in simulations; prefer any unacted match.
    const unit = matching.find((u) => !u.hasActed) || matching[0];
    if (unit.hasActed) throw new Error(`Unit already acted: ${unitName}`);

    this.selectedUnit = unit;
    this.preMoveLoc = { col: unit.col, row: unit.row };
    this.movementRange = this.grid.getMovementRange(
      unit.col,
      unit.row,
      unit.stats.MOV,
      unit.moveType,
      this._buildUnitPositionMap(unit.faction),
      unit.faction,
    );
    this.battleState = HEADLESS_STATES.UNIT_SELECTED;
  }

  moveTo(col, row) {
    if (this.battleState !== HEADLESS_STATES.UNIT_SELECTED) {
      throw new Error(`Cannot move in state: ${this.battleState}`);
    }
    const key = `${col},${row}`;
    const rangeEntry = this.movementRange.get(key);
    // Allow staying in place (current tile always in movementRange)
    // Reject tiles marked stoppable: false (ally-occupied)
    if (
      !(col === this.selectedUnit.col && row === this.selectedUnit.row) &&
      (!rangeEntry || rangeEntry.stoppable === false)
    ) {
      throw new Error(`Tile (${col},${row}) not reachable`);
    }

    // Track movement spent for Canto (deferred, but track anyway)
    const costEntry = rangeEntry;
    this.selectedUnit._movementSpent = costEntry ? costEntry.cost : 0;

    this.selectedUnit.col = col;
    this.selectedUnit.row = row;
    this.selectedUnit.hasMoved = true;
    // Fog waits for the action to be committed (BattleActionCompletion.revealSettledVision).
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
      const bossAlive = this.enemyUnits.some((u) => u.isBoss);
      if (throne && unit.col === throne.col && unit.row === throne.row && !bossAlive) {
        actions.push({ label: 'Seize', supported: true });
      }
    }

    // Escape (any unit on an escape square)
    if (
      this.battleConfig.objective === 'escape' &&
      (this.battleConfig.escapeTiles || []).some((t) => t.col === unit.col && t.row === unit.row)
    ) {
      actions.push({ label: 'Escape', supported: true });
    }

    // Talk (the roster has no cap)
    if (unit.isLord && this.npcUnits.length > 0) {
      const talkTarget = this._findTalkTarget(unit);
      if (talkTarget) {
        actions.push({ label: 'Talk', supported: true });
      }
    }

    // Deferred actions (listed but unsupported in MVP)
    const equippable = unit.inventory.filter(
      (item) => item.type !== 'Consumable' && canEquip(unit, item),
    );
    if (equippable.length >= 2) actions.push({ label: 'Equip', supported: false });
    const hasPromotionSeal = (unit.consumables || []).some(
      (item) => item?.effect === 'promote' && (item.uses ?? 0) > 0,
    );
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
      case 'Escape':
        this._executeEscape(this.selectedUnit);
        break;
      case 'Talk': {
        const target = this._findTalkTarget(this.selectedUnit);
        if (!target) throw new Error('No talk target');
        this._executeTalk(this.selectedUnit, target);
        break;
      }
      default: {
        const actions = this.getAvailableActions();
        const action = actions.find((a) => a.label === label);
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
    const target = this.attackTargets.find((u) => u.name === targetName);
    if (!target) throw new Error(`Target not in attack range: ${targetName}`);

    // Ensure equipped weapon can reach target
    this._ensureValidWeaponForTarget(this.selectedUnit, target);
    this._executeCombat(this.selectedUnit, target);
  }

  chooseHealTarget(targetName) {
    if (this.battleState !== HEADLESS_STATES.SELECTING_HEAL_TARGET) {
      throw new Error(`Cannot choose heal target in state: ${this.battleState}`);
    }
    const target = this.healTargets.find((u) => u.name === targetName);
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
        this._clearSelectedWeaponArt();
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
    this._refreshFogVisibility();
    this.turnManager.endPlayerPhase();
    // Note: enemy phase processing is handled by GameDriver after step()
  }

  // --- Internal methods ---

  _createFallbackLords(bc) {
    const edric = this.gameData.lords.find((l) => l.name === 'Edric');
    const edricClass = this.gameData.classes.find((c) => c.name === edric.class);
    const p1 = createLordUnit(edric, edricClass, this.gameData.weapons);
    p1.col = bc.playerSpawns[0].col;
    p1.row = bc.playerSpawns[0].row;
    const steelSword = this.gameData.weapons.find((w) => w.name === 'Steel Sword');
    if (steelSword) addToInventory(p1, steelSword);
    const vul = this.gameData.consumables.find((c) => c.name === 'Vulnerary');
    if (vul) addToConsumables(p1, vul);
    this.playerUnits.push(p1);

    if (bc.playerSpawns.length > 1) {
      const sera = this.gameData.lords.find((l) => l.name === 'Sera');
      const seraClass = this.gameData.classes.find((c) => c.name === sera.class);
      const p2 = createLordUnit(sera, seraClass, this.gameData.weapons);
      p2.col = bc.playerSpawns[1].col;
      p2.row = bc.playerSpawns[1].row;
      p2.proficiencies.push({ type: 'Staff', rank: 'Prof' });
      const heal = this.gameData.weapons.find((w) => w.name === 'Heal');
      if (heal) addToInventory(p2, heal);
      const vul2 = this.gameData.consumables.find((c) => c.name === 'Vulnerary');
      if (vul2) addToConsumables(p2, vul2);
      this.playerUnits.push(p2);
    }
  }

  _getEnemyDifficultyConfig() {
    return {
      multiplier: this.battleParams.difficultyMod || 1.0,
      enemyStatBonus: Math.trunc(this.battleParams.enemyStatBonus || 0),
      classStatBonuses: this.battleParams.classStatBonuses || {},
      enemyEquipTierShift: Math.trunc(this.battleParams.enemyEquipTierShift || 0),
    };
  }

  _deriveBattleSeed() {
    const runSeed = Number(this.battleParams?.runSeed || 0) >>> 0;
    const nodePart = String(this.battleParams?.nodeId || this.battleParams?.act || 'battle');
    let hash = 2166136261 >>> 0;
    const input = `${runSeed}:${nodePart}`;
    for (let i = 0; i < input.length; i++) {
      hash ^= input.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  _getReinforcementSeed() {
    if (Number.isFinite(this.battleParams?.battleSeed)) return this.battleParams.battleSeed >>> 0;
    return this._deriveBattleSeed() >>> 0;
  }

  _getEnemySpawnFallbackLevel() {
    const nonBossLevels = (this.battleConfig?.enemySpawns || [])
      .filter((spawn) => spawn && !spawn.isBoss)
      .map((spawn) => Math.trunc(Number(spawn.level) || 0))
      .filter((level) => level > 0);
    if (nonBossLevels.length > 0) {
      const total = nonBossLevels.reduce((sum, level) => sum + level, 0);
      return Math.max(1, Math.round(total / nonBossLevels.length));
    }
    const byAct = { act1: 3, act2: 6, act3: 9, act4: 12, finalBoss: 14 };
    return byAct[this.battleParams?.act] || 3;
  }

  _getReinforcementTemplatePool() {
    if (
      Array.isArray(this.reinforcementTemplatePool) &&
      this.reinforcementTemplatePool.length > 0
    ) {
      return this.reinforcementTemplatePool;
    }

    const templates = [];
    const seen = new Set();
    for (const spawn of this.battleConfig?.enemySpawns || []) {
      if (!spawn || spawn.isBoss || typeof spawn.className !== 'string') continue;
      const classData = this.gameData.classes.find(
        (candidate) => candidate.name === spawn.className,
      );
      if (!classData) continue;
      const level = Math.max(
        1,
        Math.trunc(Number(spawn.level) || this._getEnemySpawnFallbackLevel()),
      );
      const key = `${spawn.className}:${level}:${spawn.sunderWeapon ? 's' : 'n'}:${spawn.poisonWeapon ? 'p' : 'n'}`;
      if (seen.has(key)) continue;
      seen.add(key);
      templates.push({
        className: spawn.className,
        level,
        sunderWeapon: Boolean(spawn.sunderWeapon),
        poisonWeapon: Boolean(spawn.poisonWeapon),
        aiMode: spawn.aiMode || null,
        affixes: Array.isArray(spawn.affixes) ? [...spawn.affixes] : [],
      });
    }

    if (templates.length === 0) {
      const fallbackLevel = this._getEnemySpawnFallbackLevel();
      const act = this.battleParams?.act || 'act1';
      const pool = this.gameData?.enemies?.pools?.[act];
      const classNames = [
        ...(Array.isArray(pool?.base) ? pool.base : []),
        ...(Array.isArray(pool?.promoted) ? pool.promoted : []),
      ];
      for (const className of classNames) {
        if (typeof className !== 'string') continue;
        const classData = this.gameData.classes.find((candidate) => candidate.name === className);
        if (!classData) continue;
        templates.push({
          className,
          level: fallbackLevel,
          sunderWeapon: false,
          poisonWeapon: false,
          aiMode: null,
          affixes: [],
        });
      }
    }

    this.reinforcementTemplatePool = templates;
    return templates;
  }

  _normalizeEnemyRewardMultiplier(value) {
    if (!Number.isFinite(value)) return 1;
    return Math.max(0, Math.min(1, value));
  }

  _getEnemyRewardMultiplier(unit) {
    if (!unit?._isReinforcement) return 1;
    const rewardMultiplier = Number.isFinite(unit._reinforcementRewardMultiplier)
      ? unit._reinforcementRewardMultiplier
      : unit._reinforcementXpMultiplier;
    return this._normalizeEnemyRewardMultiplier(rewardMultiplier);
  }

  _getEnemyXpMultiplier(unit) {
    const rewardMultiplier = this._getEnemyRewardMultiplier(unit);
    const isSpecialEnemy = Boolean(unit?.isBoss || unit?.isElite);
    if (!isSpecialEnemy) return rewardMultiplier;
    return rewardMultiplier * XP_SPECIAL_ENEMY_MULTIPLIER;
  }

  /** XP as BattleScene.awardXP grants it (BattleXp): the unit, then Mentor's Band shares. */
  _awardCombatXP(unit, opponent, opponentDied, damageDealt, opponentHpAtStart, extra = {}) {
    const awards = combatXpAwards({
      unit,
      opponent,
      opponentDied,
      damageDealt,
      opponentHpAtStart,
      rewardMultiplier: this._getEnemyXpMultiplier(opponent),
      pressureXpMultiplier: getLatePressureState(
        this._turnNumber(),
        this.turnPar,
        this.gameData.turnBonus,
      ).xpMultiplier,
      recruitXpBonus: Number(this.battleParams?.metaEffects?.recruitXpBonus) || 0,
      allies: this.playerUnits,
      ...extra,
    });
    for (const award of awards) this._grantScaledXP(award.unit, award.baseXp);
  }

  /** XP as BattleScene.awardScaledXP grants it: the battle's multipliers, then the gain. */
  _grantScaledXP(unit, baseXp) {
    const xp = scaledXp(baseXp, {
      parXpMultiplier: getParXpMultiplier(
        this._turnNumber(),
        this.turnPar,
        this.gameData.turnBonus,
      ),
      xpMultiplier: Number.isFinite(this.battleParams?.xpMultiplier)
        ? this.battleParams.xpMultiplier
        : 1,
      blessingXpDelta: Number(this.battleParams?.blessingXpDelta) || 0,
      traitXpMultiplier: getTraitXpMultiplier(unit, this.gameData?.traits || null),
    });
    applyXpGain(unit, xp, {
      classes: this.gameData.classes,
      extendedLevelingEnabled: this.battleParams?.extendedLevelingEnabled === true,
    });
  }

  _turnNumber() {
    return Math.max(0, Math.trunc(Number(this.turnManager?.turnNumber) || 0));
  }

  _hashReinforcementTemplateChoice(spawn, spawnOrdinal = 0) {
    let hash = this._getReinforcementSeed() >>> 0;
    const waveIndex = Math.trunc(Number(spawn?.waveIndex) || 0) + 1;
    const col = Math.trunc(Number(spawn?.col) || 0) + 1;
    const row = Math.trunc(Number(spawn?.row) || 0) + 1;
    const ordinal = Math.trunc(Number(spawnOrdinal) || 0) + 1;
    hash ^= Math.imul(waveIndex, 0x9e3779b1);
    hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b);
    hash ^= Math.imul(col, 0xc2b2ae35);
    hash = Math.imul(hash ^ (hash >>> 13), 0x27d4eb2d);
    hash ^= Math.imul(row, 0x165667b1);
    hash ^= Math.imul(ordinal, 0x1b873593);
    return (hash ^ (hash >>> 16)) >>> 0;
  }

  _buildReinforcementSpawnSpec(scheduledSpawn, spawnOrdinal = 0) {
    const classOverride =
      scheduledSpawn && typeof scheduledSpawn.className === 'string'
        ? scheduledSpawn.className
        : null;

    let template = null;
    if (!classOverride) {
      const templates = this._getReinforcementTemplatePool();
      if (!Array.isArray(templates) || templates.length === 0) return null;
      const pickIndex =
        this._hashReinforcementTemplateChoice(scheduledSpawn, spawnOrdinal) % templates.length;
      template = templates[pickIndex];
      if (!template || typeof template.className !== 'string') return null;
    }

    const className = classOverride || template.className;
    const hasLevelOverride = Number.isFinite(scheduledSpawn?.level);
    const baseLevel = template ? template.level : this._getEnemySpawnFallbackLevel();
    return {
      className,
      level: Math.max(
        1,
        Math.trunc(
          Number(hasLevelOverride ? scheduledSpawn.level : baseLevel) ||
            this._getEnemySpawnFallbackLevel(),
        ),
      ),
      col: scheduledSpawn.col,
      row: scheduledSpawn.row,
      sunderWeapon:
        typeof scheduledSpawn?.sunderWeapon === 'boolean'
          ? scheduledSpawn.sunderWeapon
          : Boolean(template?.sunderWeapon),
      poisonWeapon:
        typeof scheduledSpawn?.poisonWeapon === 'boolean'
          ? scheduledSpawn.poisonWeapon
          : Boolean(template?.poisonWeapon),
      aiMode:
        typeof scheduledSpawn?.aiMode === 'string'
          ? scheduledSpawn.aiMode
          : template?.aiMode || null,
      aiTargetTile:
        scheduledSpawn?.aiTargetTile &&
        Number.isFinite(scheduledSpawn.aiTargetTile.col) &&
        Number.isFinite(scheduledSpawn.aiTargetTile.row)
          ? { col: scheduledSpawn.aiTargetTile.col, row: scheduledSpawn.aiTargetTile.row }
          : null,
      affixes: Array.isArray(scheduledSpawn?.affixes)
        ? [...scheduledSpawn.affixes]
        : Array.isArray(template?.affixes)
          ? [...template.affixes]
          : [],
    };
  }

  _addEnemyFromSpawn(spawn, options = {}) {
    if (!spawn || typeof spawn.className !== 'string') return null;
    const classData = this.gameData.classes.find((candidate) => candidate.name === spawn.className);
    if (!classData) return null;

    const spawnLevel = Math.max(
      1,
      Math.trunc(Number(spawn.level) || this._getEnemySpawnFallbackLevel()),
    );
    const difficultyConfig = this._getEnemyDifficultyConfig();

    let enemy;
    if (classData.tier === 'promoted') {
      enemy = createPromotedEnemyUnit(
        classData,
        spawnLevel,
        this.gameData.weapons,
        difficultyConfig,
        this.gameData.skills,
        this.battleParams.act,
        this.gameData.classes,
      );
    } else {
      enemy = createEnemyUnit(
        classData,
        spawnLevel,
        this.gameData.weapons,
        difficultyConfig,
        this.gameData.skills,
        this.battleParams.act,
      );
    }
    if (!enemy) return null;

    enemy.col = spawn.col;
    enemy.row = spawn.row;
    enemy.isElite = Boolean(spawn.isElite || this.battleParams?.isElite);
    if (Array.isArray(spawn.affixes) && spawn.affixes.length > 0) {
      enemy.affixes = [...spawn.affixes];
    }
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
        const sunderData = this.gameData.weapons.find((weapon) => weapon.name === sunderName);
        if (sunderData) {
          const sunderClone = structuredClone(sunderData);
          enemy.weapon = sunderClone;
          enemy.inventory = [sunderClone];
        }
      }
    } else if (spawn.poisonWeapon) {
      const primaryType = enemy.proficiencies?.[0]?.type;
      const poisonName = primaryType ? POISON_WEAPON_BY_TYPE[primaryType] : null;
      if (poisonName) {
        const poisonData = this.gameData.weapons.find((weapon) => weapon.name === poisonName);
        if (poisonData) {
          const poisonClone = structuredClone(poisonData);
          enemy.weapon = poisonClone;
          enemy.inventory = [poisonClone];
        }
      }
    }
    // Grant secondary weapons for multi-proficiency enemies on Hard/Lunatic
    if (!spawn.sunderWeapon && !spawn.poisonWeapon && !spawn.siegeWeapon && !spawn.isEntity) {
      const diffId = this.battleParams?.difficultyId;
      if (diffId === 'hard' || diffId === 'lunatic') {
        grantSecondaryWeapons(enemy, this.gameData.weapons, enemy.weapon?.tier || 'Iron');
      }
    }

    if (spawn.aiMode) enemy.aiMode = spawn.aiMode;
    if (
      spawn.aiTargetTile &&
      Number.isFinite(spawn.aiTargetTile.col) &&
      Number.isFinite(spawn.aiTargetTile.row)
    ) {
      enemy.aiTargetTile = { col: spawn.aiTargetTile.col, row: spawn.aiTargetTile.row };
    }
    // Village bandits that spawn after the village resolved revert to chase
    // (mirrors VillageController.sanitizeSpawnedEnemy).
    if (
      enemy.aiMode === 'seek_tile' &&
      (!this._villageState || this._villageState.status !== VILLAGE_STATUS.INTACT)
    ) {
      enemy.aiMode = 'chase';
      delete enemy.aiTargetTile;
    }

    const reinforcementMeta = options.reinforcementMeta || null;
    if (reinforcementMeta) {
      enemy._isReinforcement = true;
      enemy._reinforcementWaveIndex = Math.trunc(Number(reinforcementMeta.waveIndex) || 0);
      enemy._reinforcementSpawnTurn = Math.trunc(Number(reinforcementMeta.scheduledTurn) || 0);
      const rewardMultiplier = this._normalizeEnemyRewardMultiplier(
        Number(reinforcementMeta.xpMultiplier),
      );
      enemy._reinforcementRewardMultiplier = rewardMultiplier;
      // Backward compatibility for legacy field name.
      enemy._reinforcementXpMultiplier = rewardMultiplier;
    }

    this.enemyUnits.push(enemy);
    return enemy;
  }

  _getReinforcementOccupiedTiles() {
    return [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits]
      .filter((unit) => unit && Number.isFinite(unit.col) && Number.isFinite(unit.row))
      .map((unit) => ({ col: unit.col, row: unit.row }));
  }

  _resolveReinforcementsForTurn(turn) {
    if (!this.battleConfig?.reinforcements) return { spawns: [], dueWaves: [], blockedSpawns: 0 };
    return scheduleReinforcementsForTurn({
      turn,
      seed: this._getReinforcementSeed(),
      reinforcements: this.battleConfig.reinforcements,
      mapLayout: this.battleConfig.mapLayout,
      terrain: this.gameData.terrain,
      occupied: this._getReinforcementOccupiedTiles(),
      difficultyId: this.battleParams?.difficultyId || 'normal',
      difficultyTurnOffset: Math.trunc(Number(this.battleParams?.reinforcementTurnOffset) || 0),
      enemyCountBonus: Math.trunc(Number(this.battleParams?.enemyCountBonus) || 0),
      activeEnemyCount: this.enemyUnits.length,
    });
  }

  _applyReinforcementsForTurn(turn) {
    const schedule = this._resolveReinforcementsForTurn(turn);
    this.lastReinforcementSchedule = schedule;
    if (!Array.isArray(schedule.spawns) || schedule.spawns.length === 0)
      return { ...schedule, spawned: 0 };

    let spawned = 0;
    const successfulWaveKeys = new Set();
    for (let i = 0; i < schedule.spawns.length; i++) {
      const scheduledSpawn = schedule.spawns[i];
      const spec = this._buildReinforcementSpawnSpec(scheduledSpawn, i);
      if (!spec) continue;
      const enemy = this._addEnemyFromSpawn(spec, { reinforcementMeta: scheduledSpawn });
      if (enemy) {
        spawned++;
        // Mirrors BattleScene: each non-repeating wave that arrived bumps par by 1.
        if (scheduledSpawn.waveIndex != null && scheduledSpawn.waveType !== 'repeating')
          successfulWaveKeys.add(
            `${scheduledSpawn.waveType || 'procedural'}:${scheduledSpawn.waveIndex}`,
          );
      }
    }
    if (Number.isFinite(this.turnPar) && successfulWaveKeys.size > 0)
      this.turnPar += successfulWaveKeys.size;
    return { ...schedule, spawned };
  }

  _applyDueHybridOverridesForTurn(turn) {
    const normalizedTurn = Math.trunc(Number(turn) || 0);
    const overrides = this.battleConfig?.phaseTerrainOverrides;
    if (normalizedTurn <= 0 || !Array.isArray(overrides) || overrides.length === 0) {
      const none = { turn: normalizedTurn, dueOverrides: 0, appliedOverrides: 0, changedTiles: 0 };
      this.lastHybridOverrideResult = none;
      return none;
    }

    if (!(this.appliedHybridOverrideTurns instanceof Set)) {
      this.appliedHybridOverrideTurns = new Set();
    }

    const dueOverrides = overrides.filter(
      (entry) =>
        Number.isInteger(entry?.turn) &&
        entry.turn === normalizedTurn &&
        !this.appliedHybridOverrideTurns.has(entry.turn),
    );
    if (dueOverrides.length === 0) {
      const none = { turn: normalizedTurn, dueOverrides: 0, appliedOverrides: 0, changedTiles: 0 };
      this.lastHybridOverrideResult = none;
      return none;
    }

    let changedTiles = 0;
    const anchors = this.battleConfig?.hybridAnchors || {};
    for (const entry of dueOverrides) {
      if (!Array.isArray(entry?.setTiles)) continue;
      for (const setTile of entry.setTiles) {
        const target = Array.isArray(setTile?.coord)
          ? { col: setTile.coord[0], row: setTile.coord[1] }
          : anchors?.[setTile?.anchor];
        if (!target || !Number.isInteger(target.col) || !Number.isInteger(target.row)) continue;
        const terrainIndex = this.gameData.terrain.findIndex(
          (terrain) => terrain?.name === setTile?.terrain,
        );
        if (terrainIndex < 0) continue;
        const didSet = this.grid?.setTerrainAt?.(target.col, target.row, terrainIndex);
        if (didSet) changedTiles++;
      }
      this.appliedHybridOverrideTurns.add(entry.turn);
    }

    const result = {
      turn: normalizedTurn,
      dueOverrides: dueOverrides.length,
      appliedOverrides: dueOverrides.length,
      changedTiles,
    };
    this.lastHybridOverrideResult = result;
    return result;
  }

  _onPhaseChange(phase, turn) {
    this._clearCombatRollSession();
    this._expireTimedWeaponArtBuffs(phase, turn);
    if (phase === 'player') {
      // Deeds: the enemy phase that just ended (mirrors DeedController).
      if (turn > 1 && this.gameData?.deeds)
        recordEnemyPhaseEnd(this.playerUnits, {
          turn,
          terrainAt: (u) => this._terrainName(u),
          commander: this.playerUnits.find((u) => u?.isCommander) || null,
          deedsData: this.gameData.deeds,
        });
      // Condition recovery mirrors BattleScene: tick at the start of the
      // afflicted side's phase, before units act (art statuses expire here).
      // NPC allies share the army's turn start, after the army.
      processConditionRecovery(armyAndNpcAllies(this.playerUnits, this.npcUnits));
      for (const u of this.playerUnits) {
        u.hasMoved = false;
        u.hasActed = false;
        u._gambitUsedThisTurn = false;
        u._movementSpent = 0;
      }
      // Apply turn-start effects (Renewal, etc.) — skip turn 1 to match BattleScene
      if (turn > 1) {
        this._processTurnStartEffects(armyAndNpcAllies(this.playerUnits, this.npcUnits));
      }
      this._refreshFogVisibility();
      this.battleState = HEADLESS_STATES.PLAYER_IDLE;
    } else if (phase === 'enemy') {
      processConditionRecovery(this.enemyUnits);
      this.grid.tickTemporaryTerrains?.();
      this.battleState = HEADLESS_STATES.ENEMY_PHASE;
    }
  }

  _onVictory() {
    this.result = 'victory';
    this.battleState = HEADLESS_STATES.BATTLE_END;
    // Deeds commit with the win, like PostCombatController.onVictory (the
    // harness is one battle, so no idempotency key is needed).
    this.deedAnnouncements = [];
    if (this.gameData?.deeds) {
      if (this.turnManager?.currentPhase === 'enemy')
        recordEnemyPhaseEnd(this.playerUnits, {
          turn: (this.turnManager.turnNumber || 0) + 1,
          terrainAt: (u) => this._terrainName(u),
          commander: this.playerUnits.find((u) => u?.isCommander) || null,
          deedsData: this.gameData.deeds,
        });
      this.deedAnnouncements = commitBattleDeeds(
        [...this.playerUnits, ...(this.escapedUnits || [])],
        this.gameData.deeds,
        {
          act: this.battleParams?.act || null,
          battle: this.battleParams?.battleNumber ?? null,
          deployedCount: this.battleParams?.deployCount,
        },
      );
    }
  }

  _terrainName(unit) {
    if (!unit || typeof this.grid?.getTerrainAt !== 'function') return null;
    return this.grid.getTerrainAt(unit.col, unit.row)?.name || null;
  }

  _recordDeedCombat(attacker, defender, result) {
    if (!this.gameData?.deeds) return;
    recordCombat(result, attacker, defender, { phase: this.turnManager?.currentPhase || null });
  }

  _onDefeat() {
    this.result = 'defeat';
    this.battleState = HEADLESS_STATES.BATTLE_END;
  }

  _processTurnStartEffects(units) {
    if (!Array.isArray(units)) return;
    // 1. Skills
    const skillEffects = getTurnStartEffects(units, this.gameData.skills);
    for (const effect of skillEffects) {
      if (effect.type === 'heal' && effect.target.currentHP < effect.target.stats.HP) {
        effect.target.currentHP = Math.min(
          effect.target.stats.HP,
          effect.target.currentHP + effect.amount,
        );
      }
    }
    // 2. Affixes
    const affixEffects = getTurnStartAffixes(units, this.gameData.affixes);
    for (const effect of affixEffects) {
      if (effect.type === 'heal' && effect.target.currentHP < effect.target.stats.HP) {
        effect.target.currentHP = Math.min(
          effect.target.stats.HP,
          effect.target.currentHP + effect.amount,
        );
      }
      // Note: spawn_terrain is not fully simulated in HeadlessBattle MVP for now
    }
  }

  _processTerrainDamage(units) {
    for (const unit of [...(units || [])]) {
      if (!unit || unit.currentHP <= 0) continue;
      const terrainIdx = this.grid.mapLayout[unit.row]?.[unit.col];
      if (!isLavaCrackTerrainIndex(terrainIdx)) continue;
      const { nextHP, appliedDamage } = computeLavaCrackHp(unit.currentHP);
      if (appliedDamage <= 0) continue;
      unit.currentHP = nextHP;
      this._checkPhoenixBrooch(unit);
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
      if (
        this.grid.fogEnabled &&
        unit.faction === 'player' &&
        !this.grid.isVisible(enemy.col, enemy.row)
      )
        continue;
      const dist = gridDistance(unit.col, unit.row, enemy.col, enemy.row);
      if (
        combatWeapons.some((w) => {
          const bonus = getWeaponRangeBonus(unit, w, this.gameData.skills);
          const { min, max } = parseRange(w.range);
          return dist >= min && dist <= max + bonus;
        })
      ) {
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
    const healOpts = this._healOptions();
    const targets = [];
    // Mirrors HealController: the army first, then living NPC allies (recruits,
    // the merchant caravan) the army can see.
    for (const ally of staffAllyCandidates(this.playerUnits, this.npcUnits)) {
      if (ally === unit) continue;
      if (ally.currentHP <= 0 || ally._removing) continue;
      if (!canInspectUnit(this.grid, ally)) continue;
      if (ally.currentHP >= ally.stats.HP) continue;
      // Mirrors HealController: never offer a target the heal would restore 0 HP to.
      if (resolveHeal(staff, unit, ally, healOpts).healAmount <= 0) continue;
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
      // Mirrors BattleScene.findTalkTarget: the merchant caravan is never a recruit.
      if (!isRecruitNpc(npc)) continue;
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

  selectWeaponArt(artId, weapon = null) {
    if (!this.selectedUnit) throw new Error('No selected unit for weapon art selection');
    this._setSelectedWeaponArt(this.selectedUnit, artId, weapon);
  }

  _getWeaponArtCatalog() {
    return this.gameData?.weaponArts?.arts || [];
  }

  _collectWeaponBoundArts(weapon) {
    if (!weapon) return [];
    const allArts = this._getWeaponArtCatalog();
    if (allArts.length <= 0) return [];
    const byId = new Map();

    for (const boundId of getWeaponArtIds(weapon)) {
      const boundArt = allArts.find((art) => art?.id === boundId);
      if (boundArt?.id) byId.set(boundArt.id, boundArt);
    }

    const weaponToken = weapon?.id || weapon?.name || null;
    if (weaponToken) {
      for (const art of allArts) {
        if (!art?.id) continue;
        if (Array.isArray(art.legendaryWeaponIds) && art.legendaryWeaponIds.includes(weaponToken)) {
          byId.set(art.id, art);
        }
      }
    }

    return [...byId.values()];
  }

  _getAvailableWeaponArtEntriesForUnit(unit) {
    if (!unit) return [];
    const inventory =
      Array.isArray(unit.inventory) && unit.inventory.length > 0
        ? unit.inventory
        : unit.weapon
          ? [unit.weapon]
          : [];
    const entries = [];
    for (const weapon of inventory) {
      if (!weapon || !weapon.type || isStaff(weapon)) continue;
      for (const art of this._collectWeaponBoundArts(weapon)) {
        if (!art || !isWeaponArtCompatibleWithWeapon(art, weapon)) continue;
        entries.push({ weapon, art });
      }
    }
    return entries;
  }

  _setSelectedWeaponArt(unit, artId = null, weapon = null) {
    if (!unit || !artId) {
      this._selectedWeaponArt = null;
      return;
    }
    const inventory = Array.isArray(unit.inventory) ? unit.inventory : [];
    const activeWeapon = weapon || unit.weapon || null;
    const weaponIndex = activeWeapon ? inventory.indexOf(activeWeapon) : -1;
    // Mirrors WeaponArtController: the uid survives the equipped-first reorder.
    this._selectedWeaponArt = {
      unitName: unit.name,
      artId,
      weaponIndex,
      ...(typeof activeWeapon?.uid === 'string' ? { weaponUid: activeWeapon.uid } : {}),
    };
  }

  _clearSelectedWeaponArt() {
    this._selectedWeaponArt = null;
  }

  _resolveSelectedWeaponArtEntry(unit) {
    const selected = this._selectedWeaponArt;
    if (!unit || !selected || selected.unitName !== unit.name) return null;
    const entries = this._getAvailableWeaponArtEntriesForUnit(unit);
    if (entries.length <= 0) return null;

    if (typeof selected.weaponUid === 'string' && selected.weaponUid) {
      const byUid = entries.find(
        (entry) => entry.art.id === selected.artId && entry.weapon?.uid === selected.weaponUid,
      );
      if (byUid) return byUid;
    }
    if (
      Number.isInteger(selected.weaponIndex) &&
      selected.weaponIndex >= 0 &&
      Array.isArray(unit.inventory) &&
      selected.weaponIndex < unit.inventory.length
    ) {
      const selectedWeapon = unit.inventory[selected.weaponIndex];
      const strict = entries.find(
        (entry) => entry.art.id === selected.artId && entry.weapon === selectedWeapon,
      );
      if (strict) return strict;
    }

    return entries.find((entry) => entry.art.id === selected.artId) || null;
  }

  _getSelectedWeaponArtForUnit(unit, context = {}) {
    const selectedEntry = this._resolveSelectedWeaponArtEntry(unit);
    if (!selectedEntry) return null;

    const { weapon, art } = selectedEntry;
    const valid = canUseWeaponArt(unit, weapon, art, {
      turnNumber: this.turnManager?.turnNumber,
      isInitiating: true,
      weaponArtHpCostDelta: this.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
      ...context,
    });
    // Pure, like the scene's: executeCombat equips the art's weapon.
    return valid.ok ? art : null;
  }

  _getWeaponArtChoices(unit, weapon = null, context = {}, options = {}) {
    if (!unit) return [];
    const restrictToWeapon = Boolean(options?.restrictToWeapon && weapon);
    const entries = this._getAvailableWeaponArtEntriesForUnit(unit).filter(
      (entry) => !restrictToWeapon || entry.weapon === weapon,
    );

    return entries
      .map(({ weapon: sourceWeapon, art }) => {
        const check = canUseWeaponArt(unit, sourceWeapon, art, {
          turnNumber: this.turnManager?.turnNumber,
          isInitiating: true,
          actorFaction: unit.faction,
          weaponArtHpCostDelta:
            this.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
          ...context,
        });
        return { weapon: sourceWeapon, art, canUse: check.ok, reason: check.reason };
      })
      .filter((entry) => !(entry.canUse === false && HIDDEN_WEAPON_ART_REASONS.has(entry.reason)));
  }

  _getCombatRollSessionKey(attacker, defender) {
    const phase = this.turnManager?.currentPhase || 'player';
    const turn = Math.max(1, Math.trunc(Number(this.turnManager?.turnNumber) || 1));
    return `${phase}:${turn}:${String(attacker?.name || '')}:${String(defender?.name || '')}:${attacker?.col},${attacker?.row}:${defender?.col},${defender?.row}`;
  }

  _ensureCombatRollSession(attacker, defender) {
    if (!attacker || !defender) return null;
    const key = this._getCombatRollSessionKey(attacker, defender);
    const existing = this._combatRollSession;
    if (
      existing &&
      existing.key === key &&
      existing.attacker === attacker &&
      existing.defender === defender
    ) {
      return existing;
    }
    const next = {
      key,
      attacker,
      defender,
      gamblerAtkDeltaByUnit: new Map(),
    };
    this._combatRollSession = next;
    return next;
  }

  _clearCombatRollSession() {
    this._combatRollSession = null;
  }

  _getGamblerAtkDelta(unit, session = null) {
    return resolveGamblerDelta(unit, session || this._combatRollSession, Math.random);
  }

  _applyAccessoryPhaseCombatMods(unit, mods, session = null) {
    applyAccessoryPhaseCombatMods(unit, mods, {
      turnNumber: this.turnManager?.turnNumber,
      rollSession: session || this._combatRollSession,
      rng: Math.random,
    });
  }

  _applyRecoilGuardAfterArtUse(unit, art) {
    if (!unit || !art) return;
    const combatEffects = unit.accessory?.combatEffects || {};
    const recoilGuard = combatEffects.recoilGuard;
    const hasRecoilGuard = Boolean(recoilGuard) || Boolean(combatEffects.weaponArtDefBuff);
    if (!hasRecoilGuard) return;
    const rawStats =
      recoilGuard?.stats && typeof recoilGuard.stats === 'object'
        ? recoilGuard.stats
        : {
            DEF: Number.isFinite(Number(combatEffects?.buffDEF))
              ? Number(combatEffects.buffDEF)
              : 3,
            RES: Number.isFinite(Number(combatEffects?.buffRES))
              ? Number(combatEffects.buffRES)
              : 3,
          };
    const stats = {};
    for (const [rawStat, rawValue] of Object.entries(rawStats)) {
      const stat = String(rawStat || '')
        .trim()
        .toUpperCase();
      if (!stat) continue;
      const value = Math.trunc(Number(rawValue) || 0);
      if (value === 0) continue;
      stats[stat] = value;
    }
    if (Object.keys(stats).length <= 0) return;
    const { expiryPhase, expiryTurn } = this._resolveTier5BuffExpiry(unit, 1);
    this._applyTier5TimedBuffEntry(unit, {
      key: `recoil_guard::${String(unit.name || '')}`,
      artId: art.id || null,
      sourceName: unit.name || null,
      sourceFaction: unit.faction || null,
      expiryPhase,
      expiryTurn,
      stats,
    });
  }

  _checkPhoenixBrooch(unit) {
    if (!unit || unit.currentHP <= 0) return false;
    return Boolean(checkPhoenixBrooch(unit).triggered);
  }

  _applyKillRewards(defeatedUnit, killer = null) {
    if (defeatedUnit?.faction !== 'enemy') return;
    this.goldEarned += calculateKillReward(defeatedUnit, killer, {
      rewardMultiplier: this._getEnemyRewardMultiplier(defeatedUnit),
      pressureGoldMultiplier: this.getTurnPressureState?.()?.goldMultiplier,
    });
  }

  _scoreEnemyWeaponArt(unit, art) {
    const mods = getWeaponArtCombatMods(art);
    const artOpts = {
      weaponArtHpCostDelta: this.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
    };
    const hpCost = getEffectiveWeaponArtHpCost(unit, art, artOpts);
    const effectivenessScore =
      mods.effectiveness?.multiplier > 1 ? (mods.effectiveness.multiplier - 1) * 4 : 0;
    const rangeOverrideScore = mods.rangeOverride
      ? (Math.max(mods.rangeOverride.min, mods.rangeOverride.max) - 1) * 1.5
      : 0;
    return (
      mods.atkBonus * 3 +
      mods.hitBonus * 0.35 +
      mods.critBonus * 0.25 +
      mods.spdBonus * 0.5 +
      mods.avoidBonus * 0.15 +
      mods.defBonus * 0.1 +
      effectivenessScore +
      (mods.rangeBonus || 0) * 1.2 +
      rangeOverrideScore +
      (mods.preventCounter ? 3.5 : 0) +
      (mods.targetsRES ? 2.5 : 0) +
      (mods.halfPhysicalDamage ? 2.5 : 0) +
      (mods.vengeance ? 4 : 0) -
      hpCost * 0.75
    );
  }

  _getEnemyWeaponArtDifficultyId() {
    return this.battleParams?.difficultyId || null;
  }

  _getEnemyWeaponArtTuning() {
    const rawDifficulty = this._getEnemyWeaponArtDifficultyId();
    if (!rawDifficulty) return { minScore: 0.75, useChance: 1.0 };
    const difficultyId = String(rawDifficulty).toLowerCase();
    if (difficultyId === 'normal') return { minScore: 2.25, useChance: 0.6 };
    if (difficultyId === 'lunatic') return { minScore: 0.25, useChance: 1.0 };
    return { minScore: 0.75, useChance: 0.9 };
  }

  _rollEnemyWeaponArtChance() {
    const roll =
      typeof this._enemyWeaponArtRandom === 'function'
        ? Number(this._enemyWeaponArtRandom())
        : Math.random();
    if (!Number.isFinite(roll)) return 1;
    return Math.min(1, Math.max(0, roll));
  }

  _selectEnemyWeaponArt(unit, target) {
    if (!unit?.weapon) return null;
    const tuning = this._getEnemyWeaponArtTuning();
    const choices = this._getWeaponArtChoices(unit, unit.weapon, {
      isAI: true,
      isInitiating: true,
      actorFaction: unit.faction,
      targetFaction: target?.faction,
    }).filter((entry) => entry.canUse);
    if (choices.length <= 0) return null;
    const scored = choices
      .map((choice) => ({ art: choice.art, score: this._scoreEnemyWeaponArt(unit, choice.art) }))
      .filter((entry) => entry.score >= tuning.minScore);
    if (scored.length <= 0) return null;
    if (tuning.useChance < 1 && this._rollEnemyWeaponArtChance() > tuning.useChance) return null;
    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      const sortArtOpts = {
        weaponArtHpCostDelta: this.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
      };
      const aCost = getEffectiveWeaponArtHpCost(unit, a.art, sortArtOpts);
      const bCost = getEffectiveWeaponArtHpCost(unit, b.art, sortArtOpts);
      if (aCost !== bCost) return aCost - bCost;
      const aId = String(a.art?.id || '');
      const bId = String(b.art?.id || '');
      return aId.localeCompare(bId);
    });
    return scored[0].art;
  }

  _buildSkillCtx(attacker, defender, weaponArt = null) {
    const rollSession = this._ensureCombatRollSession(attacker, defender);
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
    const atkWeaponArtMods = weaponArt ? getWeaponArtCombatMods(weaponArt) : null;
    const affixes = this.gameData.affixes;
    const masteryCtx = {
      classesData: this.gameData.classes,
      traitsData: this.gameData.traits || null,
    };
    const atkMods = getSkillCombatMods(
      attacker,
      defender,
      getAllies(attacker),
      getEnemies(attacker),
      skills,
      atkTerrain,
      true,
      affixes,
      masteryCtx,
    );
    const defMods = getSkillCombatMods(
      defender,
      attacker,
      getAllies(defender),
      getEnemies(defender),
      skills,
      defTerrain,
      false,
      affixes,
      masteryCtx,
    );
    atkMods.hitBonus += this.runManager?.getActHitBonusForUnit?.(attacker) || 0;
    defMods.hitBonus += this.runManager?.getActHitBonusForUnit?.(defender) || 0;
    const atkTimedBuffMods = this._getTimedWeaponArtCombatBuffMods(attacker);
    const defTimedBuffMods = this._getTimedWeaponArtCombatBuffMods(defender);
    atkMods.hitBonus += atkTimedBuffMods.hitBonus || 0;
    atkMods.critBonus += atkTimedBuffMods.critBonus || 0;
    atkMods.avoidBonus += atkTimedBuffMods.avoidBonus || 0;
    atkMods.atkBonus += atkTimedBuffMods.atkBonus || 0;
    atkMods.defBonus += atkTimedBuffMods.defBonus || 0;
    atkMods.resBonus += atkTimedBuffMods.resBonus || 0;
    atkMods.spdBonus += atkTimedBuffMods.spdBonus || 0;
    defMods.hitBonus += defTimedBuffMods.hitBonus || 0;
    defMods.critBonus += defTimedBuffMods.critBonus || 0;
    defMods.avoidBonus += defTimedBuffMods.avoidBonus || 0;
    defMods.atkBonus += defTimedBuffMods.atkBonus || 0;
    defMods.defBonus += defTimedBuffMods.defBonus || 0;
    defMods.resBonus += defTimedBuffMods.resBonus || 0;
    defMods.spdBonus += defTimedBuffMods.spdBonus || 0;
    this._applyAccessoryPhaseCombatMods(attacker, atkMods, rollSession);
    this._applyAccessoryPhaseCombatMods(defender, defMods, rollSession);

    const terrainBonuses = this.runManager?.getTerrainCombatBonuses?.() || [];
    if (terrainBonuses.length > 0) {
      const applyTerrainBonus = (mods, unit, terrain) => {
        if (!terrain?.name || unit?.faction !== 'player') return;
        for (const bonus of terrainBonuses) {
          if (Array.isArray(bonus.terrains) && bonus.terrains.includes(terrain.name)) {
            mods.avoidBonus += bonus.avoidBonus || 0;
            mods.defBonus += bonus.defBonus || 0;
          }
        }
      };
      applyTerrainBonus(atkMods, attacker, atkTerrain);
      applyTerrainBonus(defMods, defender, defTerrain);
    }

    return {
      atkMods,
      defMods,
      atkWeaponArtMods,
      rollStrikeSkills,
      rollDefenseSkills,
      rollDefenseAffixes,
      getAttackAffixes,
      checkAstra,
      affixData: affixes,
      skillsData: skills,
      imbuesData: this.gameData.imbues || null,
    };
  }

  /** Post-combat effects: the engine's (PostCombatEffects.js), without presentation. */
  _applyResolvedCombatPostEffects(combat) {
    runPostCombatEffectsSync(postCombatEffects(combat, this._postCombatWorld()), {
      remove: (unit, options) => this._removeUnit(unit, options),
      moved: (units) => this._refreshPostCombatMovementState(units),
    });
  }

  /** The battle as post-combat effects see it (same shape as BattleScene's). */
  _postCombatWorld() {
    return {
      affixes: this.gameData?.affixes,
      cols: this.grid.cols,
      rows: this.grid.rows,
      getMoveCost: (col, row, moveType) => this.grid.getMoveCost(col, row, moveType),
      getUnitAt: (col, row) => this.getUnitAt(col, row),
      hostilesOf: (unit) =>
        unit?.faction === 'enemy' ? this.playerUnits || [] : unit ? this.enemyUnits || [] : [],
      alliesOf: (unit) => this._getDivineChargeAllies(unit),
      turnNumber: this.turnManager?.turnNumber,
    };
  }

  _applyTier5TimedBuffEntry(unit, entry) {
    applyTimedBuffEntry(unit, entry);
  }

  _resolveTier5BuffExpiry(sourceUnit, durationPhases = 1) {
    return resolveTimedBuffExpiry(sourceUnit, this.turnManager?.turnNumber, durationPhases);
  }

  _expireTimedWeaponArtBuffs(phase, turn) {
    expireTimedBuffs(
      [...(this.playerUnits || []), ...(this.enemyUnits || []), ...(this.npcUnits || [])],
      phase,
      turn,
    );
  }

  _getTimedWeaponArtCombatBuffMods(unit) {
    return timedBuffCombatMods(unit);
  }

  _refreshPostCombatMovementState(movedUnits) {
    if (!Array.isArray(movedUnits) || movedUnits.length <= 0) return;
    this._refreshFogVisibility();
  }

  _executeCombat(attacker, defender) {
    // As BattleScene.executeCombat: measured before the art's HP cost or any strike.
    const defenderHpAtStart = Math.max(0, Math.trunc(Number(defender?.currentHP) || 0));
    const dist = gridDistance(attacker.col, attacker.row, defender.col, defender.row);
    const atkTerrain = this.grid.getTerrainAt(attacker.col, attacker.row);
    const defTerrain = this.grid.getTerrainAt(defender.col, defender.row);
    this._ensureCombatRollSession(attacker, defender);
    const selectedArt =
      attacker.faction === 'player'
        ? this._getSelectedWeaponArtForUnit(attacker, { isInitiating: true })
        : null;
    // Mirrors BattleScene._prepareCombatContext's equipArtWeapon in executeCombat.
    const artWeapon = selectedArt ? this._resolveSelectedWeaponArtEntry(attacker)?.weapon : null;
    if (artWeapon && attacker.weapon !== artWeapon) equipWeapon(attacker, artWeapon);
    if (selectedArt) {
      const artCostOpts = {
        weaponArtHpCostDelta: this.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
      };
      applyWeaponArtCost(attacker, selectedArt, artCostOpts);
      recordWeaponArtUse(attacker, selectedArt, { turnNumber: this.turnManager?.turnNumber });
      this._applyRecoilGuardAfterArtUse(attacker, selectedArt);
      this._checkPhoenixBrooch(attacker);
    }
    const skillCtx = this._buildSkillCtx(attacker, defender, selectedArt);

    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      dist,
      atkTerrain,
      defTerrain,
      skillCtx,
    );

    applyCombatHP(attacker, defender, result); // UnitHealth, as BattleScene applies it
    this._recordDeedCombat(attacker, defender, result);

    this._applyResolvedCombatPostEffects({
      attacker,
      defender,
      result,
      attackerWeaponArt: selectedArt,
      defenderWeaponArt: null,
    });
    this._checkPhoenixBrooch(attacker);
    this._checkPhoenixBrooch(defender);

    if (attacker.faction === 'player' && attacker.currentHP > 0) {
      const damageDealt = Math.max(
        0,
        defenderHpAtStart - Math.max(0, Math.trunc(Number(result.defenderHP) || 0)),
      );
      this._awardCombatXP(
        attacker,
        defender,
        defender.currentHP <= 0,
        damageDealt,
        defenderHpAtStart,
      );
    }

    if (defender.currentHP <= 0) this._removeUnit(defender, { killer: attacker });
    if (attacker.currentHP <= 0) this._removeUnit(attacker, { killer: defender });

    if (this._checkBattleEnd()) {
      this._clearCombatRollSession();
      return;
    }

    if (attacker.currentHP <= 0) {
      this.selectedUnit = null;
      this._clearSelectedWeaponArt();
      this.attackTargets = [];
      this.battleState = HEADLESS_STATES.PLAYER_IDLE;
      this._clearCombatRollSession();
      this._refreshFogVisibility();
      return;
    }

    if (!attacker._gambitUsedThisTurn) {
      const gambitTriggered = result.events?.some((e) =>
        e.skillActivations?.some((s) => s.id === 'commanders_gambit'),
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
        this._clearSelectedWeaponArt();
        this.attackTargets = [];
        this.battleState = HEADLESS_STATES.PLAYER_IDLE;
        this._clearCombatRollSession();
        this._refreshFogVisibility();
        return;
      }
    }

    this._finishUnitAction(attacker);
  }

  _healOptions() {
    return {
      healingMultiplier:
        this.runManager?.blessingRuntimeModifiers?.healingEffectivenessMultiplier ?? 1,
    };
  }

  _executeHeal(healer, target) {
    const staff = this._getActiveHealStaff(healer);
    if (!staff) return;
    const result = resolveHeal(staff, healer, target, this._healOptions());
    const hpBefore = target.currentHP;
    setUnitHP(target, result.targetHPAfter);
    if (this.gameData?.deeds && healer !== target) recordHeal(healer, target.currentHP - hpBefore);
    spendStaffUse(staff);

    // Heal XP as HealController grants it: XP_BASE_HEAL through the battle's multipliers.
    if (healer.faction === 'player') this._grantScaledXP(healer, XP_BASE_HEAL);

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
    // Warp/Rescue relocation staves are a player-flow-only utility; the
    // harness AI never relocates, so exclude them from its heal-staff pool
    // (otherwise a looted relocate staff would be "used" as a 0-base heal).
    return unit.inventory.filter(
      (w) =>
        w.type === 'Staff' &&
        !w.relocate &&
        getStaffMaxUses(w, unit) > 0 &&
        getStaffRemainingUses(w, unit) > 0,
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
    // Recruit can move + act this turn (FE convention); keep action flags fresh.
    npc.hasMoved = false;
    npc.hasActed = false;
    this._refreshFogVisibility();

    this._finishUnitAction(lord);
  }

  _finishUnitAction(unit) {
    this._clearCombatRollSession();
    this.attackTargets = [];
    this.healTargets = [];
    this._clearSelectedWeaponArt();

    // Canto disabled in MVP
    unit.hasActed = true;
    this._handleVillageVisit(unit);
    this.selectedUnit = null;
    this.preMoveLoc = null;
    this.battleState = HEADLESS_STATES.PLAYER_IDLE;
    this._refreshFogVisibility();
    this.turnManager.unitActed(unit);
  }

  /** Mirrors VillageController.handleUnitActionEnd (gold + convoy-item reward, never XP). */
  _handleVillageVisit(unit) {
    const state = this._villageState;
    if (!state || state.status !== VILLAGE_STATUS.INTACT) return false;
    if (!unit || unit.faction !== 'player' || unit.currentHP <= 0) return false;
    if (unit.col !== state.col || unit.row !== state.row) return false;
    if (!visitVillage(state)) return false;

    this.grid?.setTerrainAt?.(state.col, state.row, TERRAIN.Plain);
    const act = this.battleParams?.act || 'act1';
    this.goldEarned += getVillageGoldReward(act);
    const item = rollVillageRewardItem(act, this.gameData?.lootTables, this.gameData?.consumables);
    if (item) {
      this.villageRewardItems.push(item);
      this.runManager?.addToConvoy?.(item);
    }
    clearSeekTileBandits(this.enemyUnits);
    return true;
  }

  /** Mirrors VillageController.handleEnemyUnitDone (only seek_tile bandits raze). */
  _handleVillageRaze(enemy) {
    const state = this._villageState;
    if (!state || state.status !== VILLAGE_STATUS.INTACT) return false;
    if (!enemy || enemy.currentHP <= 0 || enemy.aiMode !== 'seek_tile') return false;
    if (enemy.col !== state.col || enemy.row !== state.row) return false;
    if (!razeVillage(state)) return false;

    this.grid?.setTerrainAt?.(state.col, state.row, TERRAIN.Plain);
    clearSeekTileBandits(this.enemyUnits);
    return true;
  }

  /** Escape objective: unit leaves the field (mirrors EscapeObjectiveController). */
  _executeEscape(unit) {
    const idx = this.playerUnits.indexOf(unit);
    if (idx !== -1) this.playerUnits.splice(idx, 1);
    unit.hasActed = true;
    unit.hasMoved = true;
    this.escapedUnits.push(unit);

    if (!unit.isLord) {
      const act = this.battleParams?.act || 'act1';
      this.goldEarned += ESCAPE_EVAC_GOLD_BY_ACT[act] ?? ESCAPE_EVAC_GOLD_BY_ACT.act1;
    }

    this.selectedUnit = null;
    this.preMoveLoc = null;
    this.battleState = HEADLESS_STATES.PLAYER_IDLE;

    if (this._checkBattleEnd()) return;
    this._refreshFogVisibility();
    this.turnManager.unitActed(unit);
  }

  _removeUnit(unit, options = {}) {
    const killer = options?.killer || null;
    if (this.gameData?.deeds) recordKill(unit, killer, { terrain: this._terrainName(killer) });
    if (unit.faction === 'player') {
      const idx = this.playerUnits.indexOf(unit);
      if (idx !== -1) this.playerUnits.splice(idx, 1);
    } else if (unit.faction === 'npc') {
      const idx = this.npcUnits.indexOf(unit);
      if (idx !== -1) this.npcUnits.splice(idx, 1);
    } else {
      const idx = this.enemyUnits.indexOf(unit);
      if (idx !== -1) this.enemyUnits.splice(idx, 1);
      this._applyKillRewards(unit, killer);
    }
  }

  /** Faction-aware ally pool for Divine Charge heals (enemy→enemy, player→player, npc→player+npc) */
  _getDivineChargeAllies(caster) {
    if (caster.faction === 'enemy') return this.enemyUnits;
    if (caster.faction === 'npc') return [...this.playerUnits, ...(this.npcUnits || [])];
    return this.playerUnits;
  }

  _checkBattleEnd() {
    // Mirrors BattleScene.checkBattleEnd: strict isCommander flag, stamped at setup.
    const commanderEscaped = (this.escapedUnits || []).some((u) => u.isCommander);
    const commanderAlive = this.playerUnits.some((u) => u.isCommander) || commanderEscaped;
    const fieldEmpty = this.playerUnits.length === 0 && !(this.escapedUnits?.length > 0);
    if (!commanderAlive || fieldEmpty) {
      this._onDefeat();
      return true;
    }
    if (this.battleConfig.objective === 'rout' && this.enemyUnits.length === 0) {
      if (this._reinforcementsPendingThisTurn) return false;
      this._onVictory();
      return true;
    }
    if (this.battleConfig.objective === 'escape') {
      const lordsOnField = this.playerUnits.some((u) => u.isLord);
      if (commanderEscaped && !lordsOnField) {
        this._onVictory();
        return true;
      }
    }
    return false;
  }

  async _processEnemyPhase() {
    this._reinforcementsPendingThisTurn = true;
    try {
      this._processTerrainDamage(armyAndNpcAllies(this.playerUnits, this.npcUnits));
      this._processTurnStartEffects(this.enemyUnits);
      this._applyDueHybridOverridesForTurn(this.turnManager?.turnNumber || 0);
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
              this._handleVillageRaze(enemy);
            },
          },
        );
      } finally {
        this._finalizeEnemyPhaseAiStats();
      }

      if (this.battleState !== HEADLESS_STATES.BATTLE_END) {
        this._processTerrainDamage(this.enemyUnits);
        this._applyReinforcementsForTurn(this.turnManager?.turnNumber || 0);
        this._reinforcementsPendingThisTurn = false;
        this._checkBattleEnd();
        if (this.battleState !== HEADLESS_STATES.BATTLE_END) this.turnManager.endEnemyPhase();
      }
    } finally {
      this._reinforcementsPendingThisTurn = false;
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
    // As BattleScene.executeEnemyCombat: measured before the art's HP cost or any strike.
    const attackerHpAtStart = Math.max(0, Math.trunc(Number(attacker?.currentHP) || 0));
    const dist = gridDistance(attacker.col, attacker.row, defender.col, defender.row);
    const atkTerrain = this.grid.getTerrainAt(attacker.col, attacker.row);
    const defTerrain = this.grid.getTerrainAt(defender.col, defender.row);
    this._ensureCombatRollSession(attacker, defender);
    const selectedArt = this._selectEnemyWeaponArt(attacker, defender);
    if (selectedArt) {
      const artCostOpts = {
        weaponArtHpCostDelta: this.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
      };
      applyWeaponArtCost(attacker, selectedArt, artCostOpts);
      recordWeaponArtUse(attacker, selectedArt, { turnNumber: this.turnManager?.turnNumber });
      this._applyRecoilGuardAfterArtUse(attacker, selectedArt);
      this._checkPhoenixBrooch(attacker);
    }
    const skillCtx = this._buildSkillCtx(attacker, defender, selectedArt);

    const result = resolveCombat(
      attacker,
      attacker.weapon,
      defender,
      defender.weapon,
      dist,
      atkTerrain,
      defTerrain,
      skillCtx,
    );

    applyCombatHP(attacker, defender, result); // UnitHealth, as BattleScene applies it
    this._recordDeedCombat(attacker, defender, result);

    this._applyResolvedCombatPostEffects({
      attacker,
      defender,
      result,
      attackerWeaponArt: selectedArt,
      defenderWeaponArt: null,
    });
    this._checkPhoenixBrooch(attacker);
    this._checkPhoenixBrooch(defender);

    // Award XP to a player defender that lived: at least the survival minimum, even
    // with no counter or no damage dealt (BattleScene.executeEnemyCombat).
    if (defender.faction === 'player' && defender.currentHP > 0) {
      const counterDamage = Math.max(
        0,
        attackerHpAtStart - Math.max(0, Math.trunc(Number(result.attackerHP) || 0)),
      );
      this._awardCombatXP(
        defender,
        attacker,
        attacker.currentHP <= 0,
        counterDamage,
        attackerHpAtStart,
        { survivedAttack: true },
      );
    }

    if (defender.currentHP <= 0) this._removeUnit(defender, { killer: attacker });
    if (attacker.currentHP <= 0) this._removeUnit(attacker, { killer: defender });

    this._checkBattleEnd();
    this._clearCombatRollSession();
  }

  applyBattleDebuff(unit, stat, value) {
    applyBattleDebuff(unit, stat, value);
  }

  clearBattleScopedDeltas(units) {
    clearBattleScopedDeltas(units);
  }

  getUnitAt(col, row) {
    return (
      [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits].find(
        (u) => u.col === col && u.row === row,
      ) || null
    );
  }
}

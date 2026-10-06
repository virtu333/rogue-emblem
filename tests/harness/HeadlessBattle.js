import { buildPrologueNpcUnit, battleRequiredRecruits } from '../../src/engine/Prologue.js';
import {
  isRoutComplete,
  isRoutFieldClear,
  pendingRequiredRecruits,
} from '../../src/engine/RoutObjective.js';
import { settleRecruitJoin } from '../../src/engine/BattleRecruits.js';
import { settleStaffHeal } from '../../src/engine/StaffSettlement.js';
// HeadlessBattle — Synchronous battle state machine for headless testing.
// Mirrors BattleScene's MVP subset (7 states) using real engine functions.

import { HeadlessGrid } from './HeadlessGrid.js';
import { TurnManager } from '../../src/engine/TurnManager.js';
import {
  commitBattleDeeds,
  recordAreaStrike,
  recordCombat,
  recordEnemyPhaseEnd,
  recordHeal,
  recordKill,
  recordStaffUse,
} from '../../src/engine/DeedSystem.js';
import { AIController } from '../../src/engine/AIController.js';
import { advanceCaravan, createCaravanUnit } from '../../src/engine/CaravanSystem.js';
import { generateBattle, reconcileRecruitSpawnTile } from '../../src/engine/MapGenerator.js';
import { parRaiseForArrivals } from '../../src/engine/ReinforcementScheduler.js';
import {
  buildReinforcementSpawnSpec,
  buildReinforcementTemplatePool,
  enemyRewardMultiplier,
  enemySpawnFallbackLevel,
  enemyXpMultiplier,
  normalizeEnemyRewardMultiplier,
  occupiedUnitTiles,
  resolveBattleReinforcements,
  stampReinforcementMeta,
} from '../../src/engine/ReinforcementSpawns.js';
import {
  armyAndNpcAllies,
  isRecruitNpc,
  findRecruitNpc,
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
  enemyDifficultyConfigFromParams,
  equipWeapon,
  hasStaff,
  getCombatWeapons,
  canPromote,
  canEquip,
  addToInventory,
  addToConsumables,
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
  getTerrainCostReduction,
} from '../../src/engine/SkillSystem.js';
import {
  getAttackAffixes,
  getTurnStartAffixes,
  rollDefenseAffixes,
} from '../../src/engine/AffixSystem.js';
import {
  applyWeaponArtCost,
  canUseWeaponArt,
  getWeaponArtCombatMods,
  getWeaponArtIds,
  isWeaponArtCompatibleWithWeapon,
  recordWeaponArtUse,
} from '../../src/engine/WeaponArtSystem.js';
import {
  applyCondition,
  isAcidPoisoned,
  isSleeping,
  processConditionRecovery,
  removeCondition,
  resolveStatusStaff,
} from '../../src/engine/StatusConditionSystem.js';
import { applyEnemySpawnGear, applySpawnLoadout } from '../../src/engine/EnemySpawnGear.js';
import { applyHoldSpawn } from '../../src/engine/HoldActivation.js';
import { createPlayerKnowledge } from '../../src/engine/PlayerKnowledge.js';
import {
  spendAreaStrikeShot,
  spendCombatShots,
  swapSpentWeapons,
} from '../../src/engine/PerBattleWeapons.js';
import { canAttackWithWeapon, getAttackWeapons } from '../../src/engine/AttackOptions.js';
import { combatDistance, getFootprint, isEntity } from '../../src/engine/EntitySystem.js';
import {
  advanceTurnPressure,
  createTurnPressureState,
  measureTurnPressure,
} from '../../src/engine/TurnPressure.js';
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
  villageRewardItem,
  VILLAGE_STATUS,
} from '../../src/engine/VillageSystem.js';
import {
  computeAcidDamage,
  computeLavaCrackHp,
  isAcidTerrainIndex,
  isLavaCrackTerrainIndex,
  lavaBurnsUnit,
} from '../../src/engine/TerrainHazards.js';
import { stampCommanderFlag } from '../../src/engine/Commander.js';
import {
  buildRecruitNodeUnit,
  spawnTilesForDeployment,
} from '../../src/engine/RecruitNodeSystem.js';
import {
  BOSS_STAT_BONUS,
  TERRAIN,
  XP_BASE_HEAL,
  ESCAPE_EVAC_GOLD_BY_ACT,
} from '../../src/utils/constants.js';
import { applyCombatHP, damageUnit, healUnit, setUnitHP } from '../../src/engine/UnitHealth.js';
import { resetFortHealStreak, settleTerrainHeal } from '../../src/engine/TerrainHealing.js';
import { postCombatEffects, runPostCombatEffectsSync } from '../../src/engine/PostCombatEffects.js';
import {
  areaStrikeEffects,
  canStartAreaStrike,
  isAreaStrikeCenter,
} from '../../src/engine/AreaStrike.js';
import {
  applyTimedBuffEntry,
  expireTimedBuffs,
  resolveTimedBuffExpiry,
  timedBuffCombatMods,
} from '../../src/engine/TimedWeaponArtBuffs.js';
import {
  applyBattleDebuff,
  applyBattleStartDebuffs,
  clearBattleScopedDeltas,
} from '../../src/engine/BattleStatDeltas.js';
import { AREA_XP_LIVE, actionXpAwards, applyXpGain, scaledXp } from '../../src/engine/BattleXp.js';
import { selectEnemyWeaponArt } from '../../src/engine/EnemyArtScoring.js';
import { bindEnemyAreaArt } from '../../src/engine/EnemyAreaArts.js';
import { settleArtilleryStances } from '../../src/engine/SiegeArtillery.js';
import {
  buildRisenUnit,
  createRemains,
  leavesRemains,
  remainsInReach,
  riseTile,
  smashRemains,
  tickRemains,
} from '../../src/engine/ZombieRemains.js';

export const HEADLESS_STATES = {
  PLAYER_IDLE: 'PLAYER_IDLE',
  UNIT_SELECTED: 'UNIT_SELECTED',
  UNIT_ACTION_MENU: 'UNIT_ACTION_MENU',
  SELECTING_TARGET: 'SELECTING_TARGET',
  SELECTING_HEAL_TARGET: 'SELECTING_HEAL_TARGET',
  SELECTING_REMAINS_TARGET: 'SELECTING_REMAINS_TARGET',
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
    // Area credits pay XP as the scene pays them (BattleXp.AREA_XP_LIVE, one switch for
    // both); a test may turn it off per battle.
    this.areaXpLive = AREA_XP_LIVE;

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
    // Zombie remains (engine/ZombieRemains.js), the records BattleScene keeps.
    this._zombieTombstones = [];
    this.remainsTargets = [];
  }

  // Initialize battle — mirrors BattleScene.beginBattle. `options.battleConfig` plays a
  // locked config (a node's battleConfigsByNodeId entry, a prologue chapter) instead of
  // generating one, as BattleScene does with RunManager.getLockedBattleConfig.
  init(options = {}) {
    const bc = options.battleConfig
      ? structuredClone(options.battleConfig)
      : this._generateBattleConfig();
    this._setupBattle(bc);
  }

  _generateBattleConfig() {
    return generateBattle(this.battleParams, {
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
  }

  _setupBattle(bc) {
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
    this._zombieTombstones = [];
    this.remainsTargets = [];

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
    if (bc.npcSpawn?.prologueUnit) {
      // An authored green unit (P3's Sera): the one builder BattleScene uses too.
      const npc = buildPrologueNpcUnit(bc.npcSpawn, this.gameData);
      npc._phoenixBroochUsed = false;
      this.npcUnits.push(npc);
    } else if (bc.npcSpawn) {
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

    // Merchant Caravan, as CaravanController.spawnIfConfigured: an NPC from the config.
    this._caravanExited = false;
    if (bc.caravanSpawn) {
      this.npcUnits.push(createCaravanUnit(this.battleParams?.act || 'act1', bc.caravanSpawn));
    }

    for (const unit of [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits]) {
      unit._phoenixBroochUsed = false;
    }
    // The Wounded burden's stat delta, as BattleScene applies it at a fresh start.
    applyBattleStartDebuffs(this.playerUnits, this.battleParams?.battleDebuffs);

    // Anti-turtle clock (engine/TurnPressure.js), as BattleScene: measured once the
    // field is populated, advanced at the start of every enemy phase.
    this.antiTurtleState = createTurnPressureState(this._measureTurnPressure());

    // Turn par — mirrors BattleScene (full-run sims commit the Eclipse against it). A
    // locked config may hide it (a prologue chapter's showPar: false): then par is off.
    this.turnPar =
      this.gameData.turnBonus && !bc.hidePar
        ? calculatePar(
            {
              cols: bc.cols,
              rows: bc.rows,
              enemyCount: this.enemyUnits.length,
              objective: bc.objective,
              mapLayout: bc.mapLayout,
              terrainData: this.gameData.terrain,
              parBonus: bc.parBonus || 0,
              parInflation: bc.parInflation,
              parOffset: bc.parOffset,
              parFloor: bc.parFloor,
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
      onRejectedTransition: ({ action, phase, turn }) => {
        throw new Error(`Unexpected phase rejection: ${action} in ${phase} on turn ${turn}`);
      },
    });
    this.turnManager.init(this.playerUnits, this.enemyUnits, this.npcUnits, bc.objective);

    // Initialize AI
    this.aiController = new AIController(this.grid, this.gameData, {
      objective: bc.objective,
      thronePos: bc.thronePos,
    });
    // As BattleScene: holders wake on the Danger tiles of the board the player knows.
    this.aiController.setHoldContext(() => this._playerThreatContext());
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

    // Smash: known remains in weapon reach (mirrors BattleScene / ZombieRemainsController)
    if (this._findRemainsTargets(unit).length > 0)
      actions.push({ label: 'Smash', supported: true });

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
      case 'Smash': {
        this.remainsTargets = this._findRemainsTargets(this.selectedUnit);
        if (this.remainsTargets.length === 0) throw new Error('No remains in reach');
        this.battleState = HEADLESS_STATES.SELECTING_REMAINS_TARGET;
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

  // `targetName` may also be the target unit itself (two enemies can share a name).
  chooseAttackTarget(targetName) {
    if (this.battleState !== HEADLESS_STATES.SELECTING_TARGET) {
      throw new Error(`Cannot choose attack target in state: ${this.battleState}`);
    }
    const target =
      targetName && typeof targetName === 'object'
        ? this.attackTargets.find((u) => u === targetName)
        : this.attackTargets.find((u) => u.name === targetName);
    if (!target) throw new Error(`Target not in attack range: ${targetName?.name ?? targetName}`);

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

  /** Smash the remains on (col, row): no roll, no RNG, no XP; ends the action. */
  chooseRemainsTarget(col, row) {
    if (this.battleState !== HEADLESS_STATES.SELECTING_REMAINS_TARGET) {
      throw new Error(`Cannot choose remains in state: ${this.battleState}`);
    }
    const target = this.remainsTargets.find((t) => t.col === col && t.row === row);
    if (!target) throw new Error(`No remains in reach at (${col},${row})`);
    const unit = this.selectedUnit;
    this._zombieTombstones = smashRemains(this._zombieTombstones, target).list;
    this.remainsTargets = [];
    // The last remains of a Rout win it, as a killing blow does.
    if (this._checkBattleEnd()) return;
    this._finishUnitAction(unit);
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
      case HEADLESS_STATES.SELECTING_REMAINS_TARGET:
        this.attackTargets = [];
        this.healTargets = [];
        this.remainsTargets = [];
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
    return enemyDifficultyConfigFromParams(this.battleParams);
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
    return enemySpawnFallbackLevel(this.battleConfig, this.battleParams?.act);
  }

  /** As BattleScene.getReinforcementTemplatePool (engine/ReinforcementSpawns.js). */
  _getReinforcementTemplatePool() {
    if (
      Array.isArray(this.reinforcementTemplatePool) &&
      this.reinforcementTemplatePool.length > 0
    ) {
      return this.reinforcementTemplatePool;
    }
    this.reinforcementTemplatePool = buildReinforcementTemplatePool({
      battleConfig: this.battleConfig,
      battleParams: this.battleParams,
      gameData: this.gameData,
    });
    return this.reinforcementTemplatePool;
  }

  _normalizeEnemyRewardMultiplier(value) {
    return normalizeEnemyRewardMultiplier(value);
  }

  _getEnemyRewardMultiplier(unit) {
    return enemyRewardMultiplier(unit);
  }

  _getEnemyXpMultiplier(unit) {
    return enemyXpMultiplier(unit);
  }

  /**
   * XP as BattleScene.awardXP grants it (BattleXp): the unit, then Mentor's Band shares.
   * `extra.credits` are the area art's other victims (result.areaCredits).
   */
  _awardCombatXP(unit, opponent, opponentDied, damageDealt, opponentHpAtStart, extra = {}) {
    const awards = actionXpAwards({
      rewardMultiplierOf: (victim) => this._getEnemyXpMultiplier(victim),
      areaXp: this.gameData.weaponArts?.areaXp,
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

  _buildReinforcementSpawnSpec(scheduledSpawn, spawnOrdinal = 0) {
    return buildReinforcementSpawnSpec({
      scheduledSpawn,
      spawnOrdinal,
      seed: this._getReinforcementSeed(),
      templates: this._getReinforcementTemplatePool(),
      battleConfig: this.battleConfig,
      battleParams: this.battleParams,
      gameData: this.gameData,
    });
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
    if (spawn.isEntity) enemy.isEntity = true;
    // As BattleScene.addEnemyFromSpawn (engine/EnemySpawnGear.js): Entity weapons,
    // Sunder/Poison, siege with its fallback, status staff, Nightfall+ secondaries.
    applyEnemySpawnGear(enemy, spawn, {
      weapons: this.gameData.weapons,
      difficultyId: this.battleParams?.difficultyId,
    });
    // As BattleScene: an authored spawn's own weapon, skills and id win.
    applySpawnLoadout(enemy, spawn, {
      weapons: this.gameData.weapons,
      skills: this.gameData.skills,
    });

    if (spawn.areaArt) bindEnemyAreaArt(enemy, spawn.areaArt, this.gameData.weaponArts?.arts);
    if (spawn.aiMode) enemy.aiMode = spawn.aiMode;
    // A garrison holder keeps its post until its pack wakes (HoldActivation).
    applyHoldSpawn(enemy, spawn);
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

    if (options.reinforcementMeta) stampReinforcementMeta(enemy, options.reinforcementMeta);

    this.enemyUnits.push(enemy);
    return enemy;
  }

  _getReinforcementOccupiedTiles() {
    return occupiedUnitTiles([...this.playerUnits, ...this.enemyUnits, ...this.npcUnits]);
  }

  _resolveReinforcementsForTurn(turn) {
    return resolveBattleReinforcements({
      turn,
      seed: this._getReinforcementSeed(),
      battleConfig: this.battleConfig,
      battleParams: this.battleParams,
      gameData: this.gameData,
      templates: this._getReinforcementTemplatePool(),
      playerUnits: this.playerUnits,
      enemyUnits: this.enemyUnits,
      npcUnits: this.npcUnits,
      occupied: this._getReinforcementOccupiedTiles(),
    });
  }

  _applyReinforcementsForTurn(turn) {
    // As BattleScene: a rout whose field is already clear takes no more waves.
    if (
      isRoutFieldClear({
        objective: this.battleConfig?.objective,
        enemyUnits: this.enemyUnits || [],
        zombieTombstones: this._zombieTombstones || [],
      })
    ) {
      const cleared = { turn, spawns: [], spawned: 0, cancelledByClear: true };
      this.lastReinforcementSchedule = cleared;
      return cleared;
    }
    const schedule = this._resolveReinforcementsForTurn(turn);
    this.lastReinforcementSchedule = schedule;
    if (!Array.isArray(schedule.spawns) || schedule.spawns.length === 0)
      return { ...schedule, spawned: 0 };

    let spawned = 0;
    const arrived = [];
    for (let i = 0; i < schedule.spawns.length; i++) {
      const scheduledSpawn = schedule.spawns[i];
      const spec = this._buildReinforcementSpawnSpec(scheduledSpawn, i);
      if (!spec) continue;
      const enemy = this._addEnemyFromSpawn(spec, { reinforcementMeta: scheduledSpawn });
      if (enemy) {
        spawned++;
        arrived.push(scheduledSpawn);
      }
    }
    // As BattleScene: +1 par per arrived wave that raises par (waveRaisesPar).
    const parRaise = parRaiseForArrivals(arrived);
    if (Number.isFinite(this.turnPar) && parRaise > 0) this.turnPar += parRaise;
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
      this._advanceTurnPressure(turn);
      processConditionRecovery(this.enemyUnits);
      this.grid.tickTemporaryTerrains?.();
      this.battleState = HEADLESS_STATES.ENEMY_PHASE;
    }
  }

  _measureTurnPressure() {
    return measureTurnPressure({
      playerUnits: this.playerUnits,
      enemyUnits: this.enemyUnits,
      escapedUnits: this.escapedUnits,
      battleConfig: this.battleConfig,
    });
  }

  /** As BattleScene.updateAntiTurtlePressure (the boss enrage fx aside). */
  _advanceTurnPressure(turn) {
    if (!this.antiTurtleState) return;
    const step = advanceTurnPressure(this.antiTurtleState, this._measureTurnPressure(), {
      turn,
      par: this.turnPar,
      turnBonusConfig: this.gameData.turnBonus,
    });
    this.antiTurtleState = step.state;
    this.aiController?.setAggressiveMode?.(step.aggressiveMode);
    this.aiController?.setBossEnraged?.(step.turnEnrageActive);
  }

  /**
   * BattleScene.threatContext: the Danger overlay's view, positions from what the player
   * knows (PlayerKnowledge: own units, what the fog shows, the recruit's beacon).
   */
  _playerThreatContext() {
    const knowledge = createPlayerKnowledge({
      grid: this.grid,
      units: [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits],
      // As battleKnowledge.js: only the recruit beacon's NPC shows through the fog.
      revealed: [findRecruitNpc(this.npcUnits)],
    });
    return {
      grid: this.grid,
      enemyUnits: this.enemyUnits,
      ballistas: this.ballistas || [],
      positions: () => knowledge.positions(),
      isKnown: knowledge.isKnown,
      costModifier: (unit) => getTerrainCostReduction(unit, this.gameData?.skills),
    };
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
    // 0b. Acid ticks, as BattleScene._processAcidTicks: non-lethal, and the ground's own
    // damage never disturbs a holder.
    for (const unit of units) {
      if (!unit || unit.currentHP <= 0 || !isAcidPoisoned(unit)) continue;
      damageUnit(unit, computeAcidDamage(unit.stats?.HP), { floor: 1, disturbs: false });
    }
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
    // 3. Terrain healing (Fort/Throne), as BattleScene.processTerrainHealing.
    for (const unit of units) {
      const amount = settleTerrainHeal(unit, this.grid?.mapLayout?.[unit?.row]?.[unit?.col]);
      if (amount > 0) healUnit(unit, amount);
    }
  }

  /** As BattleScene.processTerrainDamage: lava burns (and wakes a sleeper), acid corrodes. */
  _processTerrainDamage(units) {
    for (const unit of [...(units || [])]) {
      if (!unit || unit._removing || unit.currentHP <= 0) continue;
      if (isEntity(unit)) continue; // the Entity is immune to terrain hazards
      const terrainIdx = this.grid.mapLayout[unit.row]?.[unit.col];
      if (isLavaCrackTerrainIndex(terrainIdx)) {
        if (!lavaBurnsUnit(unit)) continue;
        const { nextHP, appliedDamage } = computeLavaCrackHp(unit.currentHP);
        if (appliedDamage <= 0) continue;
        // Through UnitHealth, as the scene: the ground never disturbs a holder.
        setUnitHP(unit, nextHP, { disturbs: false });
        if (isSleeping(unit)) removeCondition(unit, 'sleep');
        this._checkPhoenixBrooch(unit);
        continue;
      }
      if (!isAcidTerrainIndex(terrainIdx)) continue;
      if (unit.moveType === 'Flying' || unit.poisonImmune || unit.terrainHazardImmune) continue;
      applyCondition(unit, 'acid', undefined, { disturbs: false });
    }
  }

  _refreshFogVisibility() {
    if (!this.grid?.fogEnabled) return;
    this.grid.updateFogOfWar(this.playerUnits);
  }

  _buildUnitPositionMap(moverFaction) {
    const map = new Map();
    for (const u of [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits]) {
      for (const t of isEntity(u) ? getFootprint(u) : [u])
        map.set(`${t.col},${t.row}`, { faction: u.faction });
    }
    return map;
  }

  _findAttackTargets(unit) {
    const targets = [];
    // As BattleScene.findAttackTargets: weapons that can attack now (rank, silence,
    // per-battle shots left).
    const combatWeapons = getAttackWeapons(unit);
    if (combatWeapons.length === 0) return targets;
    const enemies = unit.faction === 'player' ? this.enemyUnits : this.playerUnits;
    for (const enemy of enemies) {
      const seen = isEntity(enemy)
        ? getFootprint(enemy).some((t) => this.grid.isVisible(t.col, t.row))
        : this.grid.isVisible(enemy.col, enemy.row);
      if (this.grid.fogEnabled && unit.faction === 'player' && !seen) continue;
      const dist = combatDistance(unit, enemy);
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
    const dist = combatDistance(unit, target); // the Entity's footprint, as in combat
    if (
      unit.weapon &&
      isInRange(unit.weapon, dist) &&
      !isStaff(unit.weapon) &&
      canAttackWithWeapon(unit, unit.weapon)
    )
      return;
    // Find a weapon that can reach the target (never a spent per-battle weapon)
    const combatWeapons = getAttackWeapons(unit);
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

  /** An area art's other victims lost HP too (result.areaCredits), as BattleScene checks. */
  _checkAreaVictimBrooches(result) {
    for (const { victim } of result?.areaCredits || []) this._checkPhoenixBrooch(victim);
  }

  _applyKillRewards(defeatedUnit, killer = null) {
    if (defeatedUnit?.faction !== 'enemy') return;
    this.goldEarned += calculateKillReward(defeatedUnit, killer, {
      rewardMultiplier: this._getEnemyRewardMultiplier(defeatedUnit),
      pressureGoldMultiplier: this.getTurnPressureState?.()?.goldMultiplier,
    });
  }

  _getEnemyWeaponArtDifficultyId() {
    return this.battleParams?.difficultyId || null;
  }

  _rollEnemyWeaponArtChance() {
    const roll =
      typeof this._enemyWeaponArtRandom === 'function'
        ? Number(this._enemyWeaponArtRandom())
        : Math.random();
    if (!Number.isFinite(roll)) return 1;
    return Math.min(1, Math.max(0, roll));
  }

  /** The scene's rule (engine/EnemyArtScoring), over the harness's world. */
  _selectEnemyWeaponArt(unit, target) {
    if (!unit?.weapon) return null;
    const choices = this._getWeaponArtChoices(unit, unit.weapon, {
      isAI: true,
      isInitiating: true,
      actorFaction: unit.faction,
      targetFaction: target?.faction,
    }).filter((entry) => entry.canUse);
    if (choices.length <= 0) return null;
    return selectEnemyWeaponArt({
      unit,
      target,
      choices,
      world: () => this._postCombatWorld(),
      difficultyId: this._getEnemyWeaponArtDifficultyId(),
      weaponArtHpCostDelta: this.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
      roll: () => this._rollEnemyWeaponArtChance(),
    });
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
      getTerrainAt: (col, row) => this.grid.getTerrainAt?.(col, row) ?? null,
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
    resetFortHealStreak(attacker); // as BattleScene.executeCombat
    // As BattleScene.executeCombat: measured before the art's HP cost or any strike.
    const defenderHpAtStart = Math.max(0, Math.trunc(Number(defender?.currentHP) || 0));
    // As BattleScene._prepareCombatContext: the Entity fights from its footprint.
    const dist =
      isEntity(attacker) || isEntity(defender)
        ? combatDistance(attacker, defender)
        : gridDistance(attacker.col, attacker.row, defender.col, defender.row);
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
    spendCombatShots(attacker, defender, result); // Breachbolt shots, as BattleScene
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
    this._checkAreaVictimBrooches(result);

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
        {
          credits: this.areaXpLive
            ? (result.areaCredits || []).filter((credit) => credit.source === attacker)
            : [],
        },
      );
    }

    if (defender.currentHP <= 0) this._removeUnit(defender, { killer: attacker });
    if (attacker.currentHP <= 0) this._removeUnit(attacker, { killer: defender });
    swapSpentWeapons([attacker, defender]); // after kill credit, as BattleScene

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

  /**
   * A chosen-center weapon art (engine/AreaStrike.js): the art's cost, every blow in the
   * blast, removals, then XP from the credits, as BattleScene will resolve it. Returns
   * false (nothing spent) when the art cannot be used or the center is out of range.
   */
  executeAreaStrike(unit, artId, center) {
    if (!unit || unit.currentHP <= 0 || unit.hasActed) return false;
    const entry = this._getAvailableWeaponArtEntriesForUnit(unit).find((e) => e.art.id === artId);
    if (!entry) return false;
    const { weapon, art } = entry;
    const artCostOpts = {
      weaponArtHpCostDelta: this.runManager?.blessingRuntimeModifiers?.weaponArtHpCostDelta ?? 0,
    };
    const check = canUseWeaponArt(unit, weapon, art, {
      turnNumber: this.turnManager?.turnNumber,
      isInitiating: true,
      actorFaction: unit.faction,
      ...artCostOpts,
    });
    if (!check.ok) return false;
    // Aim with the art's weapon before equipping it: a refused center changes nothing.
    // canStartAreaStrike: a weapon it may strike with (silence, a spent per-battle weapon).
    const world = this._postCombatWorld();
    if (!canStartAreaStrike(unit, weapon, art, world)) return false;
    if (!isAreaStrikeCenter(unit, art, center, world, weapon)) return false;
    if (unit.weapon !== weapon) equipWeapon(unit, weapon);

    applyWeaponArtCost(unit, art, artCostOpts);
    spendAreaStrikeShot(weapon); // one Breachbolt shot a cast, as BattleScene
    recordWeaponArtUse(unit, art, { turnNumber: this.turnManager?.turnNumber });
    this._applyRecoilGuardAfterArtUse(unit, art);
    this._checkPhoenixBrooch(unit);

    const result = {};
    runPostCombatEffectsSync(areaStrikeEffects({ unit, art, center, world }, result), {
      remove: (victim, options) => this._removeUnit(victim, options),
    });
    if (this.gameData?.deeds) recordAreaStrike(unit, weapon, result.areaCredits);
    this._checkAreaVictimBrooches(result);
    if (
      this.areaXpLive &&
      unit.faction === 'player' &&
      unit.currentHP > 0 &&
      result.areaCredits?.length
    )
      this._awardCombatXP(unit, null, false, null, null, { credits: result.areaCredits });
    swapSpentWeapons([unit]); // after the blast's deaths, as BattleScene

    if (this._checkBattleEnd()) return true;
    this._finishUnitAction(unit);
    return true;
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
    settleStaffHeal({
      staff,
      healer,
      targets: [target],
      healOpts: this._healOptions(),
      traits: this.gameData?.traits,
      turn: this.turnManager.turnNumber,
      phase: this.turnManager.currentPhase,
      onTarget: ({ healAmount }) => {
        if (this.gameData?.deeds && healer !== target) recordHeal(healer, healAmount);
      },
    });
    // The staff's use count, as HealController's settlement records it.
    if (this.gameData?.deeds) recordStaffUse(healer, staff);
    if (healer.faction === 'player') this._grantScaledXP(healer, XP_BASE_HEAL);
    const combat = getCombatWeapons(healer);
    if (combat.length > 0) equipWeapon(healer, combat[0]);

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
    // As MovementActionController.executeTalk: a join can complete a rout that waited
    // on this very recruit (RoutObjective.requiredRecruits), read before the join.
    const state = this.routObjectiveState();
    const routWaited =
      this.battleConfig.objective === 'rout' &&
      pendingRequiredRecruits(state.requiredRecruits, state.playerUnits, state.escapedUnits).includes(npc?.name); // prettier-ignore
    const joined = settleRecruitJoin({
      npc,
      npcUnits: this.npcUnits,
      playerUnits: this.playerUnits,
      battleRecruits: this._battleRecruits,
      runManager: this.runManager,
    });
    if (!joined) throw new Error(`Invalid Talk recruit: ${npc?.name || 'missing target'}`);
    this._battleRecruits = joined.battleRecruits;
    this._refreshFogVisibility();
    this._finishUnitAction(lord);
    if (routWaited) this._checkBattleEnd();
  }

  /** What the rout's end reads (RoutObjective), as BattleScene.routObjectiveState. */
  routObjectiveState() {
    return {
      enemyUnits: this.enemyUnits || [],
      zombieTombstones: this._zombieTombstones || [],
      requiredRecruits: battleRequiredRecruits({
        battleConfig: this.battleConfig,
        battleParams: this.battleParams,
        gameData: this.gameData,
      }),
      playerUnits: this.playerUnits || [],
      escapedUnits: this.escapedUnits || [],
    };
  }

  _finishUnitAction(unit) {
    this._clearCombatRollSession();
    this.attackTargets = [];
    this.healTargets = [];
    this._clearSelectedWeaponArt();

    // Canto (including Measured Step) is disabled in this harness; scene tests cover it.
    unit.hasActed = true;
    this._handleVillageVisit(unit);
    this.selectedUnit = null;
    this.preMoveLoc = null;
    this.battleState = HEADLESS_STATES.PLAYER_IDLE;
    this._refreshFogVisibility();
    if (this.playerUnits.includes(unit)) this.turnManager.unitActed(unit);
    else this.turnManager.checkPlayerPhaseComplete();
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
    const item = villageRewardItem(this.battleConfig?.villageTile, act, {
      lootTables: this.gameData?.lootTables,
      consumables: this.gameData?.consumables,
      weapons: this.gameData?.weapons,
    });
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
    this.turnManager.checkPlayerPhaseComplete();
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
      if (leavesRemains(unit, killer)) {
        const tile = { col: unit.col, row: unit.row };
        const seen = this.grid?.isVisible ? this.grid.isVisible(tile.col, tile.row) : true;
        this._zombieTombstones = [...this._zombieTombstones, createRemains(unit, tile, { seen })];
      }
    }
  }

  /** Remains `unit` can Smash (the scene's rule: known, visible, open, in weapon reach). */
  _findRemainsTargets(unit) {
    if (!unit || unit.faction !== 'player') return [];
    return remainsInReach(unit, this._zombieTombstones, {
      skillsData: this.gameData?.skills || null,
      isVisible: (c, r) => (this.grid?.isVisible ? this.grid.isVisible(c, r) : true),
      isOccupied: (c, r) => Boolean(this.getUnitAt(c, r)),
    });
  }

  /** Mirrors ZombieRemainsController.processRevival (no banner, no graphics). */
  _processZombieRevival() {
    if (!this._zombieTombstones?.length) return;
    const { kept, rising } = tickRemains(this._zombieTombstones);
    this._zombieTombstones = kept;
    for (const record of rising) {
      const tile = riseTile(record, {
        cols: this.battleConfig.cols,
        rows: this.battleConfig.rows,
        isOccupied: (c, r) => Boolean(this.getUnitAt(c, r)),
        moveCostAt: (c, r, moveType) => this.grid.getTerrainAt(c, r)?.moveCost?.[moveType],
      });
      if (!tile) continue;
      this.enemyUnits.push(buildRisenUnit(record, tile));
    }
    if (rising.length > 0) this._checkBattleEnd();
  }

  /** Faction-aware ally pool for Divine Charge heals (enemy→enemy, player→player, npc→player+npc) */
  _getDivineChargeAllies(caster) {
    if (caster.faction === 'enemy') return this.enemyUnits;
    if (caster.faction === 'npc') return [...this.playerUnits, ...(this.npcUnits || [])];
    return this.playerUnits;
  }

  _checkBattleEnd() {
    // Mirrors BattleScene.checkBattleEnd: idempotent once the battle ended, strict
    // isCommander flag (stamped at setup), and the rout read through RoutObjective.
    if (this.battleState === HEADLESS_STATES.BATTLE_END) return true;
    const commanderEscaped = (this.escapedUnits || []).some((u) => u.isCommander);
    const commanderAlive =
      this.playerUnits.some((u) => u.isCommander && u.currentHP > 0) || commanderEscaped;
    const fieldEmpty = this.playerUnits.length === 0 && !(this.escapedUnits?.length > 0);
    if (!commanderAlive || fieldEmpty) {
      this._onDefeat();
      return true;
    }
    if (this.battleConfig.objective === 'rout' && isRoutComplete(this.routObjectiveState())) {
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
    // As BattleScene.onPhaseChange('enemy'): siege casters take their stance from the
    // board the player left, before the phase-start hazards (SiegeArtillery).
    settleArtilleryStances({
      enemyUnits: this.enemyUnits,
      playerUnits: this.playerUnits,
      turn: this.turnManager?.turnNumber ?? null,
    });
    try {
      this._processTerrainDamage(armyAndNpcAllies(this.playerUnits, this.npcUnits));
      // Then the caravan steps toward its exit, before the AI acts (as BattleScene: the
      // player phase's hazards burn first, startEnemyPhase steps it).
      this._stepCaravan();
      this._processTurnStartEffects(this.enemyUnits);
      this._processZombieRevival();
      if (this.battleState === HEADLESS_STATES.BATTLE_END) return;
      this._applyDueHybridOverridesForTurn(this.turnManager?.turnNumber || 0);
      this.currentEnemyPhaseAiStats = this._createEnemyPhaseAiStats();
      try {
        await this.aiController.processEnemyPhase(
          this.enemyUnits,
          this.playerUnits,
          this.npcUnits,
          {
            turnNumber: this.turnManager?.turnNumber ?? null, // as BattleScene
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
            // As BattleScene.executeEnemyStatusStaff without the banner and icons.
            onStatusStaff: (enemy, target) => {
              if (!enemy.statusStaff) return Promise.resolve();
              resolveStatusStaff(enemy.statusStaff, enemy, target);
              spendStaffUse(enemy.statusStaff);
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

  /** As CaravanController.stepTurn (engine/CaravanSystem.advanceCaravan), minus drawing. */
  _stepCaravan() {
    if (this._caravanExited) return;
    const unit = this.npcUnits.find((u) => u.isCaravan && u.currentHP > 0);
    if (!unit) return;
    const { exited } = advanceCaravan(unit, {
      units: [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits],
      mapLayout: this.grid.mapLayout,
      cols: this.grid.cols,
      rows: this.grid.rows,
      terrainData: this.grid.terrainData,
    });
    if (!exited) return;
    this._caravanExited = true;
    this.npcUnits.splice(this.npcUnits.indexOf(unit), 1);
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
    resetFortHealStreak(attacker); // as BattleScene.executeEnemyCombat
    // As BattleScene.executeEnemyCombat: measured before the art's HP cost or any strike.
    const attackerHpAtStart = Math.max(0, Math.trunc(Number(attacker?.currentHP) || 0));
    // As BattleScene._prepareCombatContext: the Entity fights from its footprint.
    const dist =
      isEntity(attacker) || isEntity(defender)
        ? combatDistance(attacker, defender)
        : gridDistance(attacker.col, attacker.row, defender.col, defender.row);
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
    spendCombatShots(attacker, defender, result); // Breachbolt shots, as BattleScene
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
    this._checkAreaVictimBrooches(result);

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
    swapSpentWeapons([attacker, defender]); // after kill credit, as BattleScene

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

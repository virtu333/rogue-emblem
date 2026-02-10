// BattleScene â€” Phase 3: multi-unit tactical combat with unit system

import Phaser from 'phaser';
import { Grid } from '../engine/Grid.js';
import { TurnManager } from '../engine/TurnManager.js';
import { AIController } from '../engine/AIController.js';
import {
  getCombatForecast,
  resolveCombat,
  resolveHeal,
  gridDistance,
  parseRange,
  isInRange,
  isStaff,
  getEffectivenessMultiplier,
  getStaffRemainingUses,
  getStaffMaxUses,
  getEffectiveStaffRange,
  spendStaffUse,
} from '../engine/Combat.js';
import {
  createLordUnit,
  createEnemyUnit as createEnemyUnitFromClass,
  createRecruitUnit,
  calculateCombatXP,
  gainExperience,
  addToInventory,
  addToConsumables,
  removeFromConsumables,
  equipWeapon,
  hasStaff,
  getStaffWeapon,
  getCombatWeapons,
  canPromote,
  promoteUnit,
  checkLevelUpSkills,
  learnSkill,
  removeFromInventory,
  isLastCombatWeapon,
  hasProficiency,
  canEquip,
  equipAccessory,
  unequipAccessory,
  applyStatBoost,
  getClassInnateSkills,
} from '../engine/UnitManager.js';
import {
  getSkillCombatMods,
  rollStrikeSkills,
  rollDefenseSkills,
  checkAstra,
  getTurnStartEffects,
  getWeaponRangeBonus,
} from '../engine/SkillSystem.js';
import { LevelUpPopup } from '../ui/LevelUpPopup.js';
import { UnitInspectionPanel } from '../ui/UnitInspectionPanel.js';
import { UnitDetailOverlay } from '../ui/UnitDetailOverlay.js';
import { DangerZoneOverlay } from '../ui/DangerZoneOverlay.js';
import { TILE_SIZE, FACTION_COLORS, MAX_SKILLS, BOSS_STAT_BONUS, INVENTORY_MAX, CONSUMABLE_MAX, GOLD_BATTLE_BONUS, LOOT_CHOICES, ELITE_LOOT_CHOICES, ELITE_MAX_PICKS, ROSTER_CAP, DEPLOY_LIMITS, TERRAIN, TERRAIN_HEAL_PERCENT, RECRUIT_SKILL_POOL, FORGE_MAX_LEVEL, FORGE_STAT_CAP, SUNDER_WEAPON_BY_TYPE } from '../utils/constants.js';
import { getHPBarColor } from '../utils/uiStyles.js';
import { generateBattle } from '../engine/MapGenerator.js';
import { serializeUnit, clearSavedRun } from '../engine/RunManager.js';
import { calculateKillGold, generateLootChoices, calculateSkipLootBonus } from '../engine/LootSystem.js';
import { canForge, canForgeStat, applyForge, isForged, getStatForgeCount } from '../engine/ForgeSystem.js';
import { calculatePar, getRating, calculateBonusGold } from '../engine/TurnBonusCalculator.js';
import { deleteRunSave } from '../cloud/CloudSync.js';
import { PauseOverlay } from '../ui/PauseOverlay.js';
import { SettingsOverlay } from '../ui/SettingsOverlay.js';
import { MUSIC, getMusicKey } from '../utils/musicConfig.js';
import { showImportantHint, showMinorHint } from '../ui/HintDisplay.js';
import { generateBossRecruitCandidates } from '../engine/BossRecruitSystem.js';
import { DEBUG_MODE, debugState } from '../utils/debugMode.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';

export class BattleScene extends Phaser.Scene {
  constructor() {
    super('Battle');
  }

  init(data) {
    this.gameData = data.gameData || data;
    if (!this.gameData.skills) this.gameData.skills = [];
    this.runManager = data.runManager || null;
    this.battleParams = data.battleParams || { act: 'act1', objective: 'rout' };
    this.roster = data.roster || null;
    this.nodeId = data.nodeId || null;
    this.isBoss = data.isBoss || false;
    this.isElite = data.isElite || false;
    this.isTransitioningOut = false;
  }

  create() {
    // Determine deploy limits for this act (+ meta upgrade bonus)
    const act = this.battleParams.act || 'act1';
    const baseLimits = DEPLOY_LIMITS[act] || DEPLOY_LIMITS.act1;
    const deployBonus = this.runManager?.getDeployBonus?.() || 0;
    const limits = { min: baseLimits.min + deployBonus, max: baseLimits.max + deployBonus };

    if (!this.roster) {
      // Standalone mode â€” no deploy screen
      this.beginBattle(null);
    } else if (this.roster.length <= limits.max) {
      // Small roster â€” auto-deploy all
      this.beginBattle(this.roster);
    } else {
      // Roster exceeds max â€” show deploy selection
      this.showDeployScreen(this.roster, limits, (selectedRoster) => {
        this.beginBattle(selectedRoster);
      });
    }
  }

  beginBattle(deployedRoster) {
    try {
      // Track non-deployed units for merging back on victory
      if (this.roster && deployedRoster) {
        const deployedNames = new Set(deployedRoster.map(u => u.name));
        this.nonDeployedUnits = this.roster.filter(u => !deployedNames.has(u.name));
      } else {
        this.nonDeployedUnits = [];
      }

      // Set deployCount for MapGenerator spawn generation
      const deployCount = deployedRoster ? deployedRoster.length : 2;
      this.battleParams.deployCount = deployCount;
      this.battleParams.isBoss = !!this.isBoss;

      // Generate battle from templates
      this.battleConfig = generateBattle(this.battleParams, this.gameData);
      const bc = this.battleConfig;

      // Build the grid from generated map (with optional fog of war)
      const fogEnabled = this.battleParams.fogEnabled || false;
      this.grid = new Grid(this, bc.cols, bc.rows, this.gameData.terrain, bc.mapLayout, fogEnabled);

      // Ensure music is stopped when scene shuts down
      this.events.once('shutdown', () => {
        const audio = this.registry.get('audio');
        if (audio) audio.stopMusic(null, 0);
      });

      // Unit arrays
      this.playerUnits = [];
      this.enemyUnits = [];
      this.npcUnits = [];

      // Gold tracking for loot system
      this.goldEarned = 0;

      // Create player units â€” from deployed roster (run mode) or fresh lords (standalone)
      if (deployedRoster) {
        for (let i = 0; i < deployedRoster.length && i < bc.playerSpawns.length; i++) {
          const unit = deployedRoster[i];
          unit.col = bc.playerSpawns[i].col;
          unit.row = bc.playerSpawns[i].row;
          unit.hasMoved = false;
          unit.hasActed = false;
          unit._miracleUsed = false;
          unit._gambitUsedThisTurn = false;
          // Reset per-battle weapon uses (e.g. Bolting)
          for (const w of (unit.inventory || [])) {
            if (w.perBattleUses) w._usesSpent = 0;
          }
          this.playerUnits.push(unit);
          this.addUnitGraphic(unit);
        }
      } else {
        // Standalone fallback â€” create lords directly
        const edric = this.gameData.lords.find(l => l.name === 'Edric');
        const edricClass = this.gameData.classes.find(c => c.name === edric.class);
        const playerUnit1 = createLordUnit(edric, edricClass, this.gameData.weapons);
        playerUnit1.col = bc.playerSpawns[0].col;
        playerUnit1.row = bc.playerSpawns[0].row;
        const steelSword = this.gameData.weapons.find(w => w.name === 'Steel Sword');
        if (steelSword) addToInventory(playerUnit1, steelSword);
        const vulnerary = this.gameData.consumables.find(c => c.name === 'Vulnerary');
        if (vulnerary) addToConsumables(playerUnit1, vulnerary);
        this.playerUnits.push(playerUnit1);
        this.addUnitGraphic(playerUnit1);

        const sera = this.gameData.lords.find(l => l.name === 'Sera');
        const seraClass = this.gameData.classes.find(c => c.name === sera.class);
        const playerUnit2 = createLordUnit(sera, seraClass, this.gameData.weapons);
        playerUnit2.col = bc.playerSpawns[1].col;
        playerUnit2.row = bc.playerSpawns[1].row;
        playerUnit2.proficiencies.push({ type: 'Staff', rank: 'Prof' });
        const healStaff = this.gameData.weapons.find(w => w.name === 'Heal');
        if (healStaff) addToInventory(playerUnit2, healStaff);
        const vulnerary2 = this.gameData.consumables.find(c => c.name === 'Vulnerary');
        if (vulnerary2) addToConsumables(playerUnit2, vulnerary2);
        this.playerUnits.push(playerUnit2);
        this.addUnitGraphic(playerUnit2);
      }

      // Create enemies from generated spawns
      for (const spawn of bc.enemySpawns) {
        const classData = this.gameData.classes.find(c => c.name === spawn.className);
        if (!classData) continue;
        const diffMod = this.battleParams.difficultyMod || 1.0;

        let enemy;
        if (classData.tier === 'promoted') {
          // Promoted class: create from base class, then promote
          const baseClassName = classData.promotesFrom;
          const baseClassData = this.gameData.classes.find(c => c.name === baseClassName);
          if (!baseClassData) continue;
          enemy = createEnemyUnitFromClass(baseClassData, spawn.level, this.gameData.weapons, diffMod, this.gameData.skills, this.battleParams.act);
          promoteUnit(enemy, classData, classData.promotionBonuses, this.gameData.skills);
        } else {
          enemy = createEnemyUnitFromClass(classData, spawn.level, this.gameData.weapons, diffMod, this.gameData.skills, this.battleParams.act);
        }

        enemy.col = spawn.col;
        enemy.row = spawn.row;
        if (spawn.isBoss) {
          enemy.isBoss = true;
          enemy.name = spawn.name || enemy.name;
          // Boss stat bonus
          for (const stat of Object.keys(enemy.stats)) {
            enemy.stats[stat] += BOSS_STAT_BONUS;
          }
          enemy.currentHP = enemy.stats.HP;
        }
        // Apply Sunder weapon from spawn (enemy-only anti-juggernaut mechanic)
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
        this.enemyUnits.push(enemy);
        this.addUnitGraphic(enemy);
      }

      // Spawn NPC for recruit battles
      if (bc.npcSpawn) {
        const npcSpawn = bc.npcSpawn;
        // Scale recruit to lord's level (lord level or lord level - 1)
        const lord = this.playerUnits.find(u => u.isLord);
        if (lord) {
          npcSpawn.level = Math.max(1, lord.level - (Math.random() < 0.5 ? 1 : 0));
        }
        const npcClassData = this.gameData.classes.find(c => c.name === npcSpawn.className);
        if (npcClassData) {
          const recruitStatBonuses = this.runManager?.metaEffects?.statBonuses || null;
          const recruitGrowthBonuses = this.runManager?.metaEffects?.growthBonuses || null;
          const recruitSkillPool = this.runManager?.metaEffects?.recruitRandomSkill
            ? RECRUIT_SKILL_POOL : null;

          let npc;
          if (npcClassData.tier === 'promoted') {
            // Promoted recruit: create from base class, then promote
            const baseClassData = this.gameData.classes.find(c => c.name === npcClassData.promotesFrom);
            if (!baseClassData) throw new Error(`Base class not found for promoted recruit: ${npcClassData.promotesFrom}`);
            const baseDef = { ...npcSpawn, className: baseClassData.name };
            npc = createRecruitUnit(baseDef, baseClassData, this.gameData.weapons, recruitStatBonuses, recruitGrowthBonuses, recruitSkillPool);
            for (const sid of getClassInnateSkills(baseClassData.name, this.gameData.skills)) {
              if (!npc.skills.includes(sid)) npc.skills.push(sid);
            }
            promoteUnit(npc, npcClassData, npcClassData.promotionBonuses, this.gameData.skills);
          } else {
            npc = createRecruitUnit(npcSpawn, npcClassData, this.gameData.weapons, recruitStatBonuses, recruitGrowthBonuses, recruitSkillPool);
            // Assign base-class innate skills (e.g. Dancer gets 'dance')
            for (const sid of getClassInnateSkills(npcClassData.name, this.gameData.skills)) {
              if (!npc.skills.includes(sid)) npc.skills.push(sid);
            }
          }

          npc.col = npcSpawn.col;
          npc.row = npcSpawn.row;
          this.npcUnits.push(npc);
          this.addUnitGraphic(npc);
        }
      }

      // Throne marker for Seize objective
      if (bc.objective === 'seize' && bc.thronePos) {
        const tp = this.grid.gridToPixel(bc.thronePos.col, bc.thronePos.row);
        this.add.text(tp.x, tp.y - 10, 'SEIZE', {
          fontFamily: 'monospace', fontSize: '8px', color: '#ffdd44',
          fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(5);
      }

      // Calculate turn par (for turn bonus system)
      this.turnPar = null;
      this.turnBonusConfig = this.gameData.turnBonus;
      if (this.turnBonusConfig && this.battleConfig) {
        const mapParams = {
          cols: this.battleConfig.cols,
          rows: this.battleConfig.rows,
          enemyCount: this.enemyUnits.length,
          objective: this.battleConfig.objective,
          mapLayout: this.battleConfig.mapLayout,
          terrainData: this.gameData.terrain,
        };
        this.turnPar = calculatePar(mapParams, this.turnBonusConfig);
      }

      // Battle state machine
      this.battleState = 'PLAYER_IDLE';
      this.selectedUnit = null;
      this.movementRange = null;
      this.preMoveLoc = null;
      this.attackTargets = [];
      this.healTargets = [];
      this.forecastTarget = null;
      this.forecastObjects = null;
      this.actionMenu = null;
      this.inEquipMenu = false;

      // Turn manager
      this.turnManager = new TurnManager({
        onPhaseChange: (phase, turn) => this.onPhaseChange(phase, turn),
        onVictory: () => this.onVictory(),
        onDefeat: () => this.onDefeat(),
      });
      this.turnManager.init(this.playerUnits, this.enemyUnits, this.npcUnits, bc.objective);

      // AI controller
      this.aiController = new AIController(this.grid, this.gameData, {
        objective: bc.objective,
        thronePos: bc.thronePos,
      });

      // Cursor highlight
      this.cursorHighlight = this.add.rectangle(
        0, 0, TILE_SIZE - 1, TILE_SIZE - 1, 0xffffff, 0.15
      ).setVisible(false).setDepth(50);

      // Terrain/unit info (top-left)
      this.infoText = this.add.text(8, 8, '', {
        fontFamily: 'monospace', fontSize: '12px', color: '#e0e0e0',
        backgroundColor: '#000000aa', padding: { x: 4, y: 2 },
      }).setDepth(100);

      // Objective display (top-right) â€” dynamic
      this.objectiveText = this.add.text(this.cameras.main.width - 8, 8, '', {
        fontFamily: 'monospace', fontSize: '11px', color: '#ffdd44',
        backgroundColor: '#000000aa', padding: { x: 4, y: 2 },
      }).setOrigin(1, 0).setDepth(100);
      this.updateObjectiveText();

      // Turn counter (top-left corner, below info text)
      this.turnCounterText = this.add.text(8, 28, '', {
        fontFamily: 'monospace', fontSize: '11px', color: '#e0e0e0',
        backgroundColor: '#000000aa', padding: { x: 4, y: 2 },
      }).setOrigin(0, 0).setDepth(100);
      this.updateTopLeftHudLayout();

      // Instructions (bottom center)
      this.instructionText = this.add.text(
        this.cameras.main.width / 2, this.cameras.main.height - 16,
        'Right-click: inspect  |  [V] Details  |  [R] Roster  |  ESC: cancel  |  [D] Danger',
        { fontFamily: 'monospace', fontSize: '11px', color: '#888888' }
      ).setOrigin(0.5).setDepth(100);

      // Unit inspection tooltip (right-click shows name + "View Unit [V]")
      this.inspectionPanel = new UnitInspectionPanel(this);
      // Full unit detail overlay (V key or click tooltip)
      this.unitDetailOverlay = new UnitDetailOverlay(this, this.gameData);

      // Danger zone overlay
      this.dangerZone = new DangerZoneOverlay(this, this.grid);
      this.dangerZoneCache = null;
      this.dangerZoneStale = true;

      // Disable browser context menu
      this.input.mouse.disableContextMenu();

      // Input handlers
      this.input.on('pointermove', (pointer) => this.onPointerMove(pointer));
      this.input.on('pointerdown', (pointer) => this.onClick(pointer));
      this.input.on('pointerdown', (pointer) => {
        if (pointer.rightButtonDown()) this.onRightClick(pointer);
      });
      this.input.keyboard.on('keydown-V', () => {
        if (this.inspectionPanel.visible && this.inspectionPanel._unit) {
          this.openUnitDetailOverlay();
        }
      });
      this.input.keyboard.on('keydown-ESC', () => {
        if (DEBUG_MODE && this.debugOverlay?.visible) {
          this.debugOverlay.hide();
          return;
        }
        if (this.unitDetailOverlay?.visible) {
          this.unitDetailOverlay.hide();
        } else if (this.inspectionPanel.visible) {
          this.inspectionPanel.hide();
          this.grid.clearHighlights();
          this.grid.clearAttackHighlights();
        } else if (this.pauseOverlay?.visible) {
          this.pauseOverlay.hide();
        } else if (this.lootRosterVisible) {
          this.hideLootRoster();
        } else if (this.battleState === 'BATTLE_END' && this.lootGroup) {
          this.lootSettingsOverlay = new SettingsOverlay(this, () => { this.lootSettingsOverlay = null; });
          this.lootSettingsOverlay.show();
        } else if (this.battleState === 'PLAYER_IDLE') {
          this.showPauseMenu();
        } else {
          this.handleCancel();
        }
      });
      this.input.keyboard.on('keydown-R', () => {
        // Roster detail overlay during player-input states (guard against stacked modals)
        const rosterStates = ['PLAYER_IDLE', 'UNIT_SELECTED', 'UNIT_ACTION_MENU', 'SHOWING_FORECAST', 'SELECTING_TARGET', 'SELECTING_HEAL_TARGET'];
        if (rosterStates.includes(this.battleState) && this.playerUnits
            && !this.pauseOverlay?.visible && !this.lootSettingsOverlay) {
          if (this.unitDetailOverlay?.visible) {
            this.unitDetailOverlay.hide();
            return;
          }
          const living = this.playerUnits.filter(u => u.currentHP > 0);
          if (living.length === 0) return;
          // Pick default index: inspected player unit → selected unit → first lord → 0
          let defaultIdx = 0;
          const inspected = this.inspectionPanel?._unit;
          if (inspected && inspected.faction === 'player' && living.includes(inspected)) {
            defaultIdx = living.indexOf(inspected);
          } else if (this.selectedUnit && living.includes(this.selectedUnit)) {
            defaultIdx = living.indexOf(this.selectedUnit);
          } else {
            const lordIdx = living.findIndex(u => u.isLord);
            if (lordIdx >= 0) defaultIdx = lordIdx;
          }
          const unit = living[defaultIdx];
          const terrainIdx = this.grid?.mapLayout?.[unit.row]?.[unit.col];
          const terrain = terrainIdx != null ? this.gameData.terrain[terrainIdx] : null;
          this.unitDetailOverlay.show(unit, terrain, this.gameData, { rosterUnits: living, rosterIndex: defaultIdx });
          if (this.inspectionPanel?.visible) this.inspectionPanel.hide();
          return;
        }
        // Loot roster toggle during BATTLE_END
        if (this.battleState === 'BATTLE_END' && this.lootGroup && this.runManager) {
          if (this.lootRosterVisible) {
            this.hideLootRoster();
          } else {
            this.showLootRoster();
          }
        }
      });
      this.input.keyboard.on('keydown-D', () => {
        if (this.battleState === 'PLAYER_IDLE' || this.battleState === 'UNIT_SELECTED') {
          if (this.dangerZoneStale || !this.dangerZoneCache) {
            this.dangerZoneCache = this.calculateDangerZone();
            this.dangerZoneStale = false;
          }
          this.dangerZone.toggle(this.dangerZoneCache);
        }
      });
      this.input.keyboard.on('keydown-W', () => {
        if (this.battleState === 'CANTO_MOVING' && this.selectedUnit) {
          this.grid.clearHighlights();
          this.cantoRange = null;
          const unit = this.selectedUnit;
          this.dimUnit(unit);
          this.selectedUnit = null;
          this.battleState = 'PLAYER_IDLE';
          this.turnManager.unitActed(unit);
        }
      });

      this.input.keyboard.on('keydown-LEFT', () => {
        if (this.unitDetailOverlay?.visible) return;
        this._cycleForecastWeapon(-1);
      });
      this.input.keyboard.on('keydown-RIGHT', () => {
        if (this.unitDetailOverlay?.visible) return;
        this._cycleForecastWeapon(1);
      });

      // Start battle music â€” per-act tracks
      const audio = this.registry.get('audio');
      if (audio) {
        const act = this.battleParams?.act || 'act1';
        const key = this.isBoss
          ? getMusicKey('boss', act)
          : getMusicKey('battle', act);
        audio.playMusic(key, this, 800);
      }

      // Initial fog of war update
      if (this.grid.fogEnabled) {
        this.grid.updateFogOfWar(this.playerUnits);
        this.updateEnemyVisibility();
      }

      // D1: Recruit NPC fog hint marker — pulsing "?" visible through fog
      this.recruitFogMarker = null;
      if (this.grid.fogEnabled && this.battleParams.isRecruitBattle && this.npcUnits.length > 0) {
        const npc = this.npcUnits[0];
        const npcPixel = this.grid.gridToPixel(npc.col, npc.row);
        this.recruitFogMarker = this.add.text(npcPixel.x, npcPixel.y, '?', {
          fontFamily: 'monospace', fontSize: '16px', color: '#ffdd44',
          fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(4); // depth 4 = above fog (3) but below highlights (5)
        this.tweens.add({
          targets: this.recruitFogMarker,
          alpha: { from: 0.4, to: 1.0 },
          duration: 1500,
          yoyo: true,
          repeat: -1,
        });
      }

      // FOG OF WAR indicator
      if (this.grid.fogEnabled) {
        this.add.text(8, this.cameras.main.height - 36, 'FOG OF WAR', {
          fontFamily: 'monospace', fontSize: '10px', color: '#ffaa44',
          backgroundColor: '#000000aa', padding: { x: 4, y: 2 },
        }).setDepth(100);

        const hints = this.registry.get('hints');
        if (hints?.shouldShow('battle_fog')) {
          showMinorHint(this, 'Fog of War \u2014 enemies beyond vision range are hidden.');
        }
      }

      // Debug overlay (dev-only)
      if (DEBUG_MODE) {
        this.debugOverlay = new DebugOverlay(this);
        this.input.keyboard.addKey(192).on('down', () => {
          if (this.battleState === 'COMBAT_RESOLVING' || this.battleState === 'DEPLOY_SELECTION') return;
          this.debugOverlay.toggle();
        });
      }

      // Start the battle
      this.turnManager.startBattle();
    } catch (err) {
      console.error('BattleScene.beginBattle failed:', err);
      const cam = this.cameras.main;
      const toast = this.add.text(
        cam.centerX, cam.centerY,
        'Battle failed to load. Returning to map...',
        { fontFamily: 'monospace', fontSize: '14px', color: '#ff4444', backgroundColor: '#000000', padding: { x: 10, y: 6 } }
      ).setOrigin(0.5).setDepth(999);
      this.time.delayedCall(2000, () => {
        toast.destroy();
        if (this.runManager) {
          this.scene.start('NodeMap', {
            gameData: this.gameData,
            runManager: this.runManager,
          });
        } else {
          this.scene.start('Title');
        }
      });
    }
  }

  // --- Deploy selection screen ---

  showDeployScreen(roster, limits, onConfirm) {
    this.battleState = 'DEPLOY_SELECTION';
    const cam = this.cameras.main;
    const deployGroup = [];

    // Dark overlay
    const overlay = this.add.rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.92)
      .setDepth(700).setInteractive();
    deployGroup.push(overlay);

    // Title
    const title = this.add.text(cam.centerX, 28, 'DEPLOY UNITS', {
      fontFamily: 'monospace', fontSize: '20px', color: '#ffdd44', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(701);
    deployGroup.push(title);

    const subtitle = this.add.text(cam.centerX, 52, `Select ${limits.min}-${limits.max} units`, {
      fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(701);
    deployGroup.push(subtitle);

    // Track selections
    const selected = new Set();
    const rowObjects = [];

    // Auto-select Edric (locked)
    const edricIdx = roster.findIndex(u => u.name === 'Edric');
    if (edricIdx !== -1) selected.add(edricIdx);

    // Counter text
    const counterText = this.add.text(cam.centerX, 74, '', {
      fontFamily: 'monospace', fontSize: '12px', color: '#88ccff',
    }).setOrigin(0.5).setDepth(701);
    deployGroup.push(counterText);

    const updateCounter = () => {
      counterText.setText(`${selected.size} / ${limits.max}`);
      // Update confirm button state
      const canConfirm = selected.size >= limits.min && selected.size <= limits.max;
      confirmText.setColor(canConfirm ? '#44ff44' : '#666666');
    };

    // Roster list
    const rowHeight = 34;
    const startY = 100;
    const listWidth = 400;

    for (let i = 0; i < roster.length; i++) {
      const unit = roster[i];
      const ry = startY + i * rowHeight;
      const isEdric = unit.name === 'Edric';

      // Row background
      const rowBg = this.add.rectangle(cam.centerX, ry, listWidth, rowHeight - 2, 0x222244, 0.8)
        .setDepth(701).setInteractive({ useHandCursor: !isEdric });
      deployGroup.push(rowBg);

      // Checkbox
      const checkText = this.add.text(cam.centerX - listWidth / 2 + 16, ry, '', {
        fontFamily: 'monospace', fontSize: '13px', color: '#ffffff',
      }).setOrigin(0.5).setDepth(702);
      deployGroup.push(checkText);

      // Unit info
      const lvl = unit.level || 1;
      const cls = unit.className || '';
      const hp = unit.currentHP !== undefined ? `${unit.currentHP}/${unit.stats.HP}` : `${unit.stats.HP}`;
      const infoStr = `${unit.name}  Lv${lvl} ${cls}  HP ${hp}`;
      const infoText = this.add.text(cam.centerX - listWidth / 2 + 40, ry, infoStr, {
        fontFamily: 'monospace', fontSize: '12px', color: '#e0e0e0',
      }).setOrigin(0, 0.5).setDepth(702);
      deployGroup.push(infoText);

      // Lock label for Edric
      if (isEdric) {
        const lockLabel = this.add.text(cam.centerX + listWidth / 2 - 16, ry, 'LOCKED', {
          fontFamily: 'monospace', fontSize: '9px', color: '#ffaa44',
        }).setOrigin(1, 0.5).setDepth(702);
        deployGroup.push(lockLabel);
      }

      const updateRow = () => {
        const isSel = selected.has(i);
        checkText.setText(isSel ? '[X]' : '[ ]');
        rowBg.setFillStyle(isSel ? 0x334466 : 0x222244, 0.8);
        infoText.setColor(isSel ? '#ffffff' : '#999999');
      };

      rowObjects.push({ index: i, updateRow });

      // Click handler (skip Edric â€” always locked)
      if (!isEdric) {
        rowBg.on('pointerdown', () => {
          const audio = this.registry.get('audio');
          if (selected.has(i)) {
            selected.delete(i);
            if (audio) audio.playSFX('sfx_cancel');
          } else if (selected.size < limits.max) {
            selected.add(i);
            if (audio) audio.playSFX('sfx_cursor');
          }
          for (const ro of rowObjects) ro.updateRow();
          updateCounter();
        });
      }

      updateRow();
    }

    // Confirm button
    const confirmY = startY + roster.length * rowHeight + 20;
    const confirmBg = this.add.rectangle(cam.centerX, confirmY, 120, 32, 0x225522, 1)
      .setStrokeStyle(2, 0x44aa44).setDepth(701).setInteractive({ useHandCursor: true });
    deployGroup.push(confirmBg);

    const confirmText = this.add.text(cam.centerX, confirmY, 'CONFIRM', {
      fontFamily: 'monospace', fontSize: '14px', color: '#666666', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(702);
    deployGroup.push(confirmText);

    confirmBg.on('pointerdown', () => {
      if (selected.size < limits.min || selected.size > limits.max) return;
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_confirm');

      // Build selectedRoster in original roster order
      const selectedRoster = roster.filter((_, idx) => selected.has(idx));

      // Destroy overlay
      for (const obj of deployGroup) obj.destroy();

      onConfirm(selectedRoster);
    });

    updateCounter();

    // Tutorial hint for deploy screen
    const hints = this.registry.get('hints');
    if (hints?.shouldShow('battle_deploy')) {
      showImportantHint(this, 'Click units to deploy them.\nEdric always deploys. Click Confirm when ready.');
    }
  }

  // --- Unit rendering ---

  getSpriteKey(unit) {
    const classKey = unit.className.toLowerCase().replace(/ /g, '_');
    if (unit.faction === 'enemy') {
      return `enemy_${classKey}`;
    }
    // Lords: try personal name first (Edric has unique sprite), fall back to class
    if (unit.isLord) {
      const lordKey = unit.name.toLowerCase();
      if (this.textures.exists(lordKey)) return lordKey;
    }
    // NPCs use player sprites (same as non-lord player units)
    return classKey;
  }

  getWeaponSFX(unit) {
    const weapon = unit.weapon;
    if (!weapon) return 'sfx_hit';
    switch (weapon.type) {
      case 'Sword': return 'sfx_sword';
      case 'Lance': return 'sfx_lance';
      case 'Axe':   return 'sfx_axe';
      case 'Bow':   return 'sfx_bow';
      case 'Staff': return 'sfx_heal';
      case 'Tome':
        if (weapon.name.includes('Fire') || weapon.name.includes('Bolganone')) return 'sfx_fire';
        if (weapon.name.includes('Thunder') || weapon.name.includes('Lightning')) return 'sfx_thunder';
        if (weapon.name.includes('Excalibur')) return 'sfx_ice';
        return 'sfx_fire';
      case 'Light': return 'sfx_light';
      default: return 'sfx_hit';
    }
  }

  addUnitGraphic(unit) {
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const color = FACTION_COLORS[unit.faction];

    // Try sprite first, fall back to colored rectangle
    const spriteKey = this.getSpriteKey(unit);
    if (this.textures.exists(spriteKey)) {
      unit.graphic = this.add.image(pos.x, pos.y, spriteKey);
      unit.graphic.setDisplaySize(TILE_SIZE - 2, TILE_SIZE - 2);
      unit.label = null;
    } else {
      unit.graphic = this.add.rectangle(
        pos.x, pos.y, TILE_SIZE - 4, TILE_SIZE - 4, color
      );
      unit.label = this.add.text(pos.x, pos.y, unit.name[0], {
        fontFamily: 'monospace', fontSize: '14px', color: '#ffffff',
      }).setOrigin(0.5).setDepth(11);
    }
    unit.graphic.setDepth(10);

    // Faction indicator circle (blue=player, red=enemy, green=npc)
    const indicatorY = pos.y + TILE_SIZE / 2 - 8;
    unit.factionIndicator = this.add.circle(pos.x, indicatorY, 5, color, 0.6)
      .setDepth(9);

    // HP bar
    const barWidth = TILE_SIZE - 6;
    const barHeight = 3;
    const barX = pos.x - barWidth / 2;
    const barY = pos.y + TILE_SIZE / 2 - 4;
    unit.hpBar = {
      bg: this.add.rectangle(
        pos.x, barY, barWidth, barHeight, 0x333333
      ).setDepth(12),
      fill: this.add.rectangle(
        barX + barWidth / 2, barY, barWidth, barHeight,
        unit.faction === 'enemy' ? 0xcc4444 : 0x44cc44
      ).setOrigin(0.5).setDepth(13),
    };
    this.updateHPBar(unit);
  }

  updateUnitPosition(unit) {
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    unit.graphic.setPosition(pos.x, pos.y);
    if (unit.label) unit.label.setPosition(pos.x, pos.y);
    if (unit.factionIndicator) unit.factionIndicator.setPosition(pos.x, pos.y + TILE_SIZE / 2 - 8);
    this.updateHPBar(unit);
  }

  updateHPBar(unit) {
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const barWidth = TILE_SIZE - 6;
    const barY = pos.y + TILE_SIZE / 2 - 4;
    const ratio = Math.max(0, unit.currentHP / unit.stats.HP);
    const fillWidth = barWidth * ratio;

    unit.hpBar.bg.setPosition(pos.x, barY);
    unit.hpBar.fill.setPosition(pos.x - barWidth / 2 + fillWidth / 2, barY);
    unit.hpBar.fill.setSize(fillWidth, 3);
    unit.hpBar.fill.setFillStyle(getHPBarColor(ratio));
  }

  removeUnitGraphic(unit) {
    if (unit.graphic) unit.graphic.destroy();
    if (unit.label) unit.label.destroy();
    if (unit.factionIndicator) { unit.factionIndicator.destroy(); unit.factionIndicator = null; }
    if (unit.hpBar) {
      unit.hpBar.bg.destroy();
      unit.hpBar.fill.destroy();
    }
  }

  dimUnit(unit) {
    if (unit.graphic && unit.graphic.setTint) {
      unit.graphic.setTint(0x888888);
    }
    if (unit.label) unit.label.setAlpha(0.5);
    if (unit.factionIndicator) unit.factionIndicator.setAlpha(0.3);
  }

  undimUnit(unit) {
    if (unit.graphic && unit.graphic.clearTint) {
      unit.graphic.clearTint();
    }
    if (unit.label) unit.label.setAlpha(1);
    if (unit.factionIndicator) unit.factionIndicator.setAlpha(0.6);
  }

  // --- Position tracking ---

  getUnitAt(col, row) {
    const all = [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits];
    return all.find(u => u.col === col && u.row === row) || null;
  }

  buildUnitPositionMap(moverFaction) {
    const map = new Map();
    for (const u of [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits]) {
      map.set(`${u.col},${u.row}`, { faction: u.faction });
    }
    return map;
  }

  // --- Pointer / click handling ---

  onPointerMove(pointer) {
    const gp = this.grid.pixelToGrid(pointer.x, pointer.y);
    if (!gp) {
      this.cursorHighlight.setVisible(false);
      this.infoText.setText('');
      this.updateTopLeftHudLayout();
      return;
    }

    // Move cursor
    const { x, y } = this.grid.gridToPixel(gp.col, gp.row);
    this.cursorHighlight.setPosition(x, y).setVisible(true);

    // Terrain info
    const terrain = this.grid.getTerrainAt(gp.col, gp.row);
    let info = terrain.name;
    const hovered = this.getUnitAt(gp.col, gp.row);
    const moveType = hovered ? hovered.moveType : 'Infantry';
    const moveCost = terrain.moveCost[moveType];
    info += ` | Move: ${moveCost}`;
    if (parseInt(terrain.avoidBonus)) info += ` | Avo +${terrain.avoidBonus}`;
    if (parseInt(terrain.defBonus)) info += ` | Def +${terrain.defBonus}`;

    // Unit info (skip hidden units in fog)
    if (hovered && this.grid.isVisible(gp.col, gp.row)) {
      const lvl = hovered.level || 1;
      const cls = hovered.className || '';
      info += `\n${hovered.name} Lv${lvl} ${cls} | HP ${hovered.currentHP}/${hovered.stats.HP}`;
      if (hovered.weapon) info += ` | ${hovered.weapon.name}`;
      if (hovered.faction === 'player' && hovered.xp !== undefined) {
        info += ` | XP ${hovered.xp}/100`;
      }
    }
    this.infoText.setText(info);
    this.updateTopLeftHudLayout();

    // Path preview when unit selected and hovering a reachable tile
    if (this.battleState === 'UNIT_SELECTED' && this.selectedUnit && this.movementRange) {
      const key = `${gp.col},${gp.row}`;
      if (this.movementRange.has(key) && key !== `${this.selectedUnit.col},${this.selectedUnit.row}`) {
        const path = this.grid.findPath(
          this.selectedUnit.col, this.selectedUnit.row,
          gp.col, gp.row, this.selectedUnit.moveType,
          this.unitPositions, this.selectedUnit.faction
        );
        if (path) this.grid.showPath(path);
      } else {
        this.grid.clearPath();
      }
    }
  }

  updateTopLeftHudLayout() {
    if (!this.infoText || !this.turnCounterText) return;
    const hasInfo = Boolean(this.infoText.text);
    const baseY = 28;
    const stackedY = this.infoText.y + this.infoText.height + 4;
    this.turnCounterText.setY(hasInfo ? Math.max(baseY, stackedY) : baseY);
  }

  onClick(pointer) {
    if (pointer.rightButtonDown()) return; // handled separately
    if (this.unitDetailOverlay?.visible) return; // tab clicks handled by overlay
    if (this.battleState === 'ENEMY_PHASE' ||
        this.battleState === 'BATTLE_END' ||
        this.battleState === 'UNIT_MOVING' ||
        this.battleState === 'COMBAT_RESOLVING' ||
        this.battleState === 'HEAL_RESOLVING' ||
        this.battleState === 'DEPLOY_SELECTION' ||
        this.battleState === 'PAUSED') return;

    const gp = this.grid.pixelToGrid(pointer.x, pointer.y);
    if (!gp) return;

    switch (this.battleState) {
      case 'PLAYER_IDLE':
        this.handleIdleClick(gp);
        break;
      case 'UNIT_SELECTED':
        this.handleSelectedClick(gp);
        break;
      case 'UNIT_ACTION_MENU':
        this.handleActionMenuClick(gp);
        break;
      case 'SELECTING_TARGET':
        this.handleTargetClick(gp);
        break;
      case 'SHOWING_FORECAST':
        this.handleForecastClick(gp);
        break;
      case 'SELECTING_HEAL_TARGET':
        this.handleHealTargetClick(gp);
        break;
      case 'SELECTING_SHOVE_TARGET':
        this.handleShoveTargetClick(gp);
        break;
      case 'SELECTING_PULL_TARGET':
        this.handlePullTargetClick(gp);
        break;
      case 'SELECTING_TRADE_TARGET':
        this.handleTradeTargetClick(gp);
        break;
      case 'SELECTING_SWAP_TARGET':
        this.handleSwapTargetClick(gp);
        break;
      case 'SELECTING_DANCE_TARGET':
        this.handleDanceTargetClick(gp);
        break;
      case 'CANTO_MOVING':
        this.handleCantoClick(gp);
        break;
    }
  }

  onRightClick(pointer) {
    // Close any open detail overlay first
    if (this.unitDetailOverlay?.visible) this.unitDetailOverlay.hide();

    // Right-click cancels active selection states (like ESC)
    const cancelStates = [
      'UNIT_SELECTED', 'UNIT_ACTION_MENU', 'SELECTING_TARGET', 'SHOWING_FORECAST',
      'SELECTING_HEAL_TARGET', 'SELECTING_SHOVE_TARGET', 'SELECTING_PULL_TARGET',
      'SELECTING_TRADE_TARGET', 'SELECTING_SWAP_TARGET', 'SELECTING_DANCE_TARGET',
      'TRADING', 'CANTO_MOVING',
    ];
    if (cancelStates.includes(this.battleState)) {
      this.handleCancel();
      return;
    }

    // Right-click = unit inspection toggle
    if (this.inspectionPanel.visible) {
      this.inspectionPanel.hide();
      this.grid.clearHighlights();
      this.grid.clearAttackHighlights();
      return;
    }
    // Find unit at cursor position
    if (pointer) {
      const gp = this.grid.pixelToGrid(pointer.x, pointer.y);
      if (gp) {
        const unit = this.getUnitAt(gp.col, gp.row);
        if (unit) {
          const terrain = this.grid.getTerrainAt(unit.col, unit.row);
          this.inspectionPanel.show(unit, terrain, this.gameData);

          // Show movement + attack range for non-player units when idle
          if (this.battleState === 'PLAYER_IDLE' && unit.faction !== 'player') {
            const positions = this.buildUnitPositionMap(unit.faction);
            const mov = unit.mov ?? unit.stats?.MOV ?? 0;
            const moveRange = this.grid.getMovementRange(
              unit.col, unit.row, mov, unit.moveType, positions, unit.faction
            );
            this.grid.showMovementRange(moveRange, unit.col, unit.row, 0xcc3333, 0.35);

            // Show attack reach from all reachable positions
            if (unit.weapon) {
              const attackTiles = new Set();
              for (const [key] of moveRange) {
                const [mc, mr] = key.split(',').map(Number);
                for (const t of this.grid.getAttackRange(mc, mr, unit.weapon)) {
                  const tk = `${t.col},${t.row}`;
                  if (!moveRange.has(tk)) attackTiles.add(tk);
                }
              }
              const tiles = Array.from(attackTiles).map(k => {
                const [col, row] = k.split(',').map(Number);
                return { col, row };
              });
              this.grid.showAttackRange(tiles);
            }
          }
          return;
        }
      }
    }
  }

  openUnitDetailOverlay() {
    const { _unit, _terrain, _gameData } = this.inspectionPanel;
    if (!_unit) return;
    const living = (this.playerUnits || []).filter(u => u.currentHP > 0);
    const rosterIndex = living.includes(_unit) ? living.indexOf(_unit) : 0;
    const rosterOptions = living.length > 0
      ? { rosterUnits: living, rosterIndex }
      : undefined;
    this.unitDetailOverlay.show(_unit, _terrain, _gameData, rosterOptions);
  }

  handleCancel() {
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_cancel');
    if (this.battleState === 'SHOWING_FORECAST') {
      this.hideForecast();
      this.battleState = 'SELECTING_TARGET';
    } else if (this.battleState === 'SELECTING_TARGET') {
      this.grid.clearAttackHighlights();
      this.attackTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_HEAL_TARGET') {
      this.grid.clearAttackHighlights();
      this.healTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_SHOVE_TARGET') {
      this.grid.clearAttackHighlights();
      this.shoveTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_PULL_TARGET') {
      this.grid.clearAttackHighlights();
      this.pullTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_TRADE_TARGET') {
      this.grid.clearAttackHighlights();
      this.tradeTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_SWAP_TARGET') {
      this.grid.clearAttackHighlights();
      this.swapTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'SELECTING_DANCE_TARGET') {
      this.grid.clearAttackHighlights();
      this.danceTargets = [];
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'TRADING') {
      this.cleanupTradeUI();
      this.showActionMenu(this.selectedUnit);
    } else if (this.battleState === 'CANTO_MOVING') {
      // Skip Canto â€” end unit's turn
      this.grid.clearHighlights();
      this.cantoRange = null;
      const cantoUnit = this.selectedUnit;
      this.dimUnit(cantoUnit);
      this.selectedUnit = null;
      this.battleState = 'PLAYER_IDLE';
      this.turnManager.unitActed(cantoUnit);
    } else if (this.battleState === 'UNIT_ACTION_MENU') {
      if (this.inEquipMenu) {
        this.inEquipMenu = false;
        this.showActionMenu(this.selectedUnit);
      } else {
        this.hideActionMenu();
        this.undoMove(this.selectedUnit);
      }
    } else if (this.battleState === 'UNIT_SELECTED') {
      this.deselectUnit();
    }
  }

  showPauseMenu() {
    this.prePauseState = this.battleState;
    this.battleState = 'PAUSED';
    const abandonCb = this.runManager ? () => {
      const cloud = this.registry.get('cloud');
      const slot = this.registry.get('activeSlot');
      clearSavedRun(cloud ? () => deleteRunSave(cloud.userId, slot) : null);
      this.runManager.failRun();
      const audio = this.registry.get('audio');
      if (audio) audio.stopMusic(this, 0);
      this.scene.start('Title', { gameData: this.gameData });
    } : null;
    const saveExitCb = this.runManager ? () => {
      // Return to title â€” last NodeMap auto-save preserved. Battle progress lost.
      const audio = this.registry.get('audio');
      if (audio) audio.stopMusic(this, 0);
      this.scene.start('Title', { gameData: this.gameData });
    } : null;
    this.pauseOverlay = new PauseOverlay(this, {
      onResume: () => {
        this.battleState = this.prePauseState || 'PLAYER_IDLE';
        this.pauseOverlay = null;
      },
      onSaveAndExit: saveExitCb,
      onSaveAndExitWarning: 'Battle Progress Will Be Lost',
      onAbandon: abandonCb,
    });
    this.pauseOverlay.show();
  }

  handleIdleClick(gp) {
    if (this.unitDetailOverlay?.visible) this.unitDetailOverlay.hide();
    const unit = this.getUnitAt(gp.col, gp.row);
    if (unit && unit.faction === 'player' && !unit.hasActed) {
      this.inspectionPanel.hide();
      this.grid.clearHighlights();
      this.grid.clearAttackHighlights();
      this.selectUnit(unit);
    } else {
      // Left-click on empty or non-selectable: hide inspection tooltip + ranges
      this.inspectionPanel.hide();
      this.grid.clearHighlights();
      this.grid.clearAttackHighlights();
    }
  }

  handleSelectedClick(gp) {
    // Click own tile to stay in place â†’ show action menu
    if (gp.col === this.selectedUnit.col && gp.row === this.selectedUnit.row) {
      this.grid.clearHighlights();
      if (this.selectedUnit.graphic.clearTint) this.selectedUnit.graphic.clearTint();
      this.preMoveLoc = { col: this.selectedUnit.col, row: this.selectedUnit.row };
      this.showActionMenu(this.selectedUnit);
      return;
    }

    // Click a reachable tile to move
    const key = `${gp.col},${gp.row}`;
    if (this.movementRange && this.movementRange.has(key)) {
      this.moveUnit(this.selectedUnit, gp.col, gp.row);
    } else {
      // Click unreachable tile â†’ deselect (FE standard behavior)
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_cancel');
      this.deselectUnit();
    }
  }

  handleActionMenuClick(gp) {
    // Clicks during action menu are handled by the menu buttons, not grid clicks
  }

  handleTargetClick(gp) {
    // Check if clicked an attackable enemy
    const target = this.attackTargets.find(t => t.col === gp.col && t.row === gp.row);
    if (target) {
      this.showForecast(this.selectedUnit, target);
    }
  }

  handleForecastClick(gp) {
    // Any click confirms combat (ESC / right-click to cancel)
    if (this.forecastTarget) {
      const target = this.forecastTarget;
      this.hideForecast();
      this.executeCombat(this.selectedUnit, target);
    }
  }

  // --- Unit selection & movement ---

  selectUnit(unit) {
    if (this.unitDetailOverlay?.visible) this.unitDetailOverlay.hide();
    this.inspectionPanel.hide();
    this.dangerZone.hide();
    this.selectedUnit = unit;
    this.battleState = 'UNIT_SELECTED';

    if (unit.graphic.setTint) {
      unit.graphic.setTint(0xaaaaff);
    }

    this.unitPositions = this.buildUnitPositionMap(unit.faction);
    this.movementRange = this.grid.getMovementRange(
      unit.col, unit.row, unit.mov, unit.moveType, this.unitPositions, unit.faction
    );
    this.grid.showMovementRange(this.movementRange, unit.col, unit.row);
  }

  deselectUnit() {
    if (this.selectedUnit && this.selectedUnit.graphic.clearTint) {
      this.selectedUnit.graphic.clearTint();
    }
    this.selectedUnit = null;
    this.movementRange = null;
    this.unitPositions = null;
    this.battleState = 'PLAYER_IDLE';
    this.grid.clearHighlights();
    this.grid.clearAttackHighlights();
  }

  moveUnit(unit, toCol, toRow) {
    const path = this.grid.findPath(
      unit.col, unit.row, toCol, toRow, unit.moveType,
      this.unitPositions, unit.faction
    );
    if (!path || path.length < 2) return;

    // Track movement cost for Canto
    const moveRange = this.grid.getMovementRange(unit.col, unit.row, unit.stats.MOV, unit.moveType, this.unitPositions, unit.faction);
    const destKey = `${toCol},${toRow}`;
    unit._movementSpent = moveRange.get(destKey)?.cost || 0;

    this.battleState = 'UNIT_MOVING';
    this.preMoveLoc = { col: unit.col, row: unit.row };
    this.grid.clearHighlights();

    if (unit.graphic.clearTint) unit.graphic.clearTint();

    // Animate step-by-step along path
    const targets = unit.label
      ? [unit.graphic, unit.label]
      : [unit.graphic];

    const animateStep = (stepIndex) => {
      if (stepIndex >= path.length) {
        unit.col = toCol;
        unit.row = toRow;
        unit.hasMoved = true;
        this.updateUnitPosition(unit);
        this.afterMove(unit);
        return;
      }
      const pos = this.grid.gridToPixel(path[stepIndex].col, path[stepIndex].row);
      this.tweens.add({
        targets,
        x: pos.x, y: pos.y,
        duration: 80,
        ease: 'Linear',
        onComplete: () => animateStep(stepIndex + 1),
      });
    };
    animateStep(1);
  }

  afterMove(unit) {
    // Update fog of war after player movement
    if (this.grid.fogEnabled && unit.faction === 'player') {
      this.grid.updateFogOfWar(this.playerUnits);
      this.updateEnemyVisibility();
    }
    this.showActionMenu(unit);
  }

  findAttackTargets(unit) {
    const targets = [];
    const combatWeapons = getCombatWeapons(unit);
    if (combatWeapons.length === 0) return targets;
    const enemies = unit.faction === 'player' ? this.enemyUnits : this.playerUnits;
    // Check all combat weapons in inventory for range (with skill bonuses)
    for (const enemy of enemies) {
      // In fog mode, player can only target visible enemies
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

  /** Auto-swap to a combat weapon that can reach the given distance. */
  ensureValidWeaponForRange(unit, dist) {
    if (unit.weapon) {
      const { min, max } = parseRange(unit.weapon.range);
      const bonus = getWeaponRangeBonus(unit, unit.weapon, this.gameData.skills);
      if (dist >= min && dist <= max + bonus) return; // equipped weapon is fine
    }
    // Find first combat weapon that can reach
    const validWeapon = getCombatWeapons(unit).find(w => {
      const { min, max } = parseRange(w.range);
      const bonus = getWeaponRangeBonus(unit, w, this.gameData.skills);
      return dist >= min && dist <= max + bonus;
    });
    if (validWeapon) equipWeapon(unit, validWeapon);
  }

  finishUnitAction(unit, { skipCanto = false } = {}) {
    this.hideActionMenu();
    this.grid.clearAttackHighlights();
    this.attackTargets = [];
    this.healTargets = [];
    this.inEquipMenu = false;

    // Check for Canto: use remaining movement after acting
    if (!skipCanto) {
      const hasCanto = unit.skills?.includes('canto');
      const movSpent = unit._movementSpent || 0;
      const remaining = unit.stats.MOV - movSpent;
      if (hasCanto && remaining > 0 && unit.faction === 'player') {
        unit.hasActed = true;
        this.selectedUnit = unit;
        this.preMoveLoc = null;
        this.startCantoMove(unit, remaining);
        return;
      }
    }

    unit.hasActed = true;
    this.dimUnit(unit);
    this.selectedUnit = null;
    this.preMoveLoc = null;
    this.battleState = 'PLAYER_IDLE';
    this.turnManager.unitActed(unit);
  }

  // --- Shove / Pull / Canto ---

  findShoveTargets(unit) {
    const targets = [];
    const dirs = [{ dc: 0, dr: -1 }, { dc: 0, dr: 1 }, { dc: -1, dr: 0 }, { dc: 1, dr: 0 }];
    for (const { dc, dr } of dirs) {
      const ac = unit.col + dc;
      const ar = unit.row + dr;
      // Must be an ally at that position
      const ally = this.playerUnits.find(u => u !== unit && u.col === ac && u.row === ar);
      if (!ally) continue;
      const destC = ac + dc;
      const destR = ar + dr;
      if (destC < 0 || destC >= this.grid.cols || destR < 0 || destR >= this.grid.rows) continue;
      const moveCost = this.grid.getMoveCost(destC, destR, ally.moveType);
      if (moveCost === Infinity) continue;
      const occupied = [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits].some(u => u.col === destC && u.row === destR);
      if (occupied) continue;
      targets.push({ ally, destCol: destC, destRow: destR, dc, dr });
    }
    return targets;
  }

  findPullTargets(unit) {
    const targets = [];
    const dirs = [{ dc: 0, dr: -1 }, { dc: 0, dr: 1 }, { dc: -1, dr: 0 }, { dc: 1, dr: 0 }];
    for (const { dc, dr } of dirs) {
      const ac = unit.col + dc;
      const ar = unit.row + dr;
      const ally = this.playerUnits.find(u => u !== unit && u.col === ac && u.row === ar);
      if (!ally) continue;
      // Unit retreats opposite direction
      const retreatC = unit.col - dc;
      const retreatR = unit.row - dr;
      if (retreatC < 0 || retreatC >= this.grid.cols || retreatR < 0 || retreatR >= this.grid.rows) continue;
      const retreatCost = this.grid.getMoveCost(retreatC, retreatR, unit.moveType);
      if (retreatCost === Infinity) continue;
      // Ally moves to unit's old position â€” passable for ally?
      const allyDestCost = this.grid.getMoveCost(unit.col, unit.row, ally.moveType);
      if (allyDestCost === Infinity) continue;
      const occupied = [...this.playerUnits, ...this.enemyUnits, ...this.npcUnits].some(u => u.col === retreatC && u.row === retreatR);
      if (occupied) continue;
      targets.push({ ally, retreatCol: retreatC, retreatRow: retreatR, dc, dr });
    }
    return targets;
  }

  findTradeTargets(unit) {
    const targets = [];
    const dirs = [{ dc: 0, dr: -1 }, { dc: 0, dr: 1 }, { dc: -1, dr: 0 }, { dc: 1, dr: 0 }];
    for (const { dc, dr } of dirs) {
      const ac = unit.col + dc;
      const ar = unit.row + dr;
      const ally = this.playerUnits.find(u => u !== unit && u.col === ac && u.row === ar);
      if (!ally) continue;

      // Both units must have items OR space for items
      const unitHasItems = (unit.inventory?.length || 0) + (unit.consumables?.length || 0) > 0;
      const allyHasItems = (ally.inventory?.length || 0) + (ally.consumables?.length || 0) > 0;
      const unitHasSpace = (unit.inventory?.length || 0) < INVENTORY_MAX || (unit.consumables?.length || 0) < CONSUMABLE_MAX;
      const allyHasSpace = (ally.inventory?.length || 0) < INVENTORY_MAX || (ally.consumables?.length || 0) < CONSUMABLE_MAX;

      if ((unitHasItems && allyHasSpace) || (allyHasItems && unitHasSpace)) {
        targets.push({ ally });
      }
    }
    return targets;
  }

  findSwapTargets(unit) {
    const targets = [];
    const dirs = [{ dc: 0, dr: -1 }, { dc: 0, dr: 1 }, { dc: -1, dr: 0 }, { dc: 1, dr: 0 }];
    for (const { dc, dr } of dirs) {
      const ac = unit.col + dc;
      const ar = unit.row + dr;
      const ally = this.playerUnits.find(u => u !== unit && u.col === ac && u.row === ar);
      if (!ally) continue;

      // Check if both positions are walkable by both units
      const unitCanWalkToAlly = this.grid.getMoveCost(ac, ar, unit.moveType) !== Infinity;
      const allyCanWalkToUnit = this.grid.getMoveCost(unit.col, unit.row, ally.moveType) !== Infinity;

      if (unitCanWalkToAlly && allyCanWalkToUnit) {
        targets.push({ ally });
      }
    }
    return targets;
  }

  findDanceTargets(unit) {
    const targets = [];
    const dirs = [{ dc: 0, dr: -1 }, { dc: 0, dr: 1 }, { dc: -1, dr: 0 }, { dc: 1, dr: 0 }];
    for (const { dc, dr } of dirs) {
      const ac = unit.col + dc;
      const ar = unit.row + dr;
      const ally = this.playerUnits.find(u => u !== unit && u.col === ac && u.row === ar);
      if (!ally) continue;

      // Must have acted AND not be another dancer
      if (ally.hasActed && !ally.skills?.includes('dance')) {
        targets.push({ ally });
      }
    }
    return targets;
  }

  executeShove(unit, target) {
    this.hideActionMenu();
    const pos = this.grid.gridToPixel(target.destCol, target.destRow);
    const targets = target.ally.label ? [target.ally.graphic, target.ally.label] : [target.ally.graphic];
    this.tweens.add({
      targets,
      x: pos.x, y: pos.y,
      duration: 80,
      ease: 'Linear',
      onComplete: () => {
        target.ally.col = target.destCol;
        target.ally.row = target.destRow;
        this.updateUnitPosition(target.ally);
        this.finishUnitAction(unit);
      },
    });
  }

  executePull(unit, target) {
    this.hideActionMenu();
    // Move both simultaneously: unit retreats, ally moves to unit's old spot
    const unitPos = this.grid.gridToPixel(target.retreatCol, target.retreatRow);
    const allyPos = this.grid.gridToPixel(unit.col, unit.row);
    const unitTargets = unit.label ? [unit.graphic, unit.label] : [unit.graphic];
    const allyTargets = target.ally.label ? [target.ally.graphic, target.ally.label] : [target.ally.graphic];
    const allyDestCol = unit.col;
    const allyDestRow = unit.row;
    this.tweens.add({ targets: unitTargets, x: unitPos.x, y: unitPos.y, duration: 80, ease: 'Linear' });
    this.tweens.add({
      targets: allyTargets,
      x: allyPos.x, y: allyPos.y,
      duration: 80,
      ease: 'Linear',
      onComplete: () => {
        unit.col = target.retreatCol;
        unit.row = target.retreatRow;
        target.ally.col = allyDestCol;
        target.ally.row = allyDestRow;
        this.updateUnitPosition(unit);
        this.updateUnitPosition(target.ally);
        this.finishUnitAction(unit);
      },
    });
  }

  startTradeTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_TRADE_TARGET';
    this.tradeTargets = this.findTradeTargets(unit);
    const tiles = this.tradeTargets.map(t => ({ col: t.ally.col, row: t.ally.row }));
    this.grid.showAttackRange(tiles, 0x44ff44, 0.4);
  }

  executeTrade(unit, target) {
    this.hideActionMenu();
    this.showBattleTradeUI(unit, target.ally);
  }

  showBattleTradeUI(unitA, unitB) {
    if (this.inspectionPanel) this.inspectionPanel.hide();
    const cam = this.cameras.main;
    this.battleState = 'TRADING';

    // Dark overlay
    const overlay = this.add.rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.7)
      .setDepth(400).setInteractive();
    this.tradeUIObjects = [overlay];

    // Title
    const title = this.add.text(cam.centerX, 30, 'TRADE ITEMS', {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffdd44', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(401);
    this.tradeUIObjects.push(title);

    // Unit names
    const leftName = this.add.text(160, 60, unitA.name, {
      fontFamily: 'monospace', fontSize: '13px', color: '#e0e0e0',
    }).setOrigin(0.5).setDepth(401);
    const rightName = this.add.text(480, 60, unitB.name, {
      fontFamily: 'monospace', fontSize: '13px', color: '#e0e0e0',
    }).setOrigin(0.5).setDepth(401);
    this.tradeUIObjects.push(leftName, rightName);

    // Two-column item lists (weapons + consumables)
    let yOffset = 90;
    const drawItems = (unit, x, otherUnit) => {
      // Weapons
      (unit.inventory || []).forEach((item, i) => {
        const locked = isLastCombatWeapon(unit, item);
        const noProf = !hasProficiency(otherUnit, item);
        const suffix = locked ? '' : (noProf ? ' (no prof)' : '');
        const color = locked ? '#666666' : (noProf ? '#cc8844' : '#e0e0e0');
        const btn = this.add.text(x, yOffset + i * 20, item.name + suffix, {
          fontFamily: 'monospace', fontSize: '11px', color,
          backgroundColor: '#222222', padding: { x: 6, y: 2 },
        }).setOrigin(0.5).setDepth(401);

        if (!locked) {
          btn.setInteractive({ useHandCursor: true });
          btn.on('pointerover', () => btn.setColor('#ffdd44'));
          btn.on('pointerout', () => btn.setColor(color));
          btn.on('pointerdown', () => {
            if ((otherUnit.inventory?.length || 0) < INVENTORY_MAX) {
              removeFromInventory(unit, item);
              addToInventory(otherUnit, item);
              this.cleanupTradeUI();
              this.showBattleTradeUI(unitA, unitB);
            }
          });
        }
        this.tradeUIObjects.push(btn);
      });

      // Consumables (below weapons)
      const consumableOffset = (unit.inventory?.length || 0) * 20;
      (unit.consumables || []).forEach((item, i) => {
        const btn = this.add.text(x, yOffset + consumableOffset + i * 20, item.name, {
          fontFamily: 'monospace', fontSize: '11px', color: '#88ccff',
          backgroundColor: '#222222', padding: { x: 6, y: 2 },
        }).setOrigin(0.5).setDepth(401).setInteractive({ useHandCursor: true });

        btn.on('pointerover', () => btn.setColor('#ffdd44'));
        btn.on('pointerout', () => btn.setColor('#88ccff'));
        btn.on('pointerdown', () => {
          if ((otherUnit.consumables?.length || 0) < CONSUMABLE_MAX) {
            const idx = unit.consumables.indexOf(item);
            if (idx !== -1) unit.consumables.splice(idx, 1);
            if (!otherUnit.consumables) otherUnit.consumables = [];
            otherUnit.consumables.push(item);
            this.cleanupTradeUI();
            this.showBattleTradeUI(unitA, unitB);
          }
        });
        this.tradeUIObjects.push(btn);
      });
    };

    drawItems(unitA, 160, unitB);
    drawItems(unitB, 480, unitA);

    // Done button
    const doneBtn = this.add.text(cam.centerX, cam.height - 40, '[ Done ]', {
      fontFamily: 'monospace', fontSize: '14px', color: '#e0e0e0',
      backgroundColor: '#333333', padding: { x: 16, y: 6 },
    }).setOrigin(0.5).setDepth(401).setInteractive({ useHandCursor: true });
    doneBtn.on('pointerover', () => doneBtn.setColor('#ffdd44'));
    doneBtn.on('pointerout', () => doneBtn.setColor('#e0e0e0'));
    doneBtn.on('pointerdown', () => {
      this.cleanupTradeUI();
      this.showActionMenu(unitA);
    });
    this.tradeUIObjects.push(doneBtn);
  }

  cleanupTradeUI() {
    if (this.tradeUIObjects) {
      this.tradeUIObjects.forEach(obj => obj.destroy());
      this.tradeUIObjects = null;
    }
  }

  startSwapTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_SWAP_TARGET';
    this.swapTargets = this.findSwapTargets(unit);
    const tiles = this.swapTargets.map(t => ({ col: t.ally.col, row: t.ally.row }));
    this.grid.showAttackRange(tiles, 0x44ff44, 0.4);
  }

  executeSwap(unit, target) {
    this.hideActionMenu();
    const unitPos = this.grid.gridToPixel(target.ally.col, target.ally.row);
    const allyPos = this.grid.gridToPixel(unit.col, unit.row);
    const unitTargets = unit.label ? [unit.graphic, unit.label] : [unit.graphic];
    const allyTargets = target.ally.label ? [target.ally.graphic, target.ally.label] : [target.ally.graphic];

    // Store positions for swap
    const unitOldCol = unit.col, unitOldRow = unit.row;
    const allyOldCol = target.ally.col, allyOldRow = target.ally.row;

    // Animate both units simultaneously
    this.tweens.add({ targets: unitTargets, x: unitPos.x, y: unitPos.y, duration: 120, ease: 'Quad.easeInOut' });
    this.tweens.add({
      targets: allyTargets, x: allyPos.x, y: allyPos.y, duration: 120, ease: 'Quad.easeInOut',
      onComplete: () => {
        unit.col = allyOldCol; unit.row = allyOldRow;
        target.ally.col = unitOldCol; target.ally.row = unitOldRow;
        this.updateUnitPosition(unit);
        this.updateUnitPosition(target.ally);
        this.finishUnitAction(unit);
      },
    });
  }

  startDanceTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_DANCE_TARGET';
    this.danceTargets = this.findDanceTargets(unit);
    const tiles = this.danceTargets.map(t => ({ col: t.ally.col, row: t.ally.row }));
    this.grid.showAttackRange(tiles, 0x44ff88, 0.4);
  }

  executeDance(unit, target) {
    this.hideActionMenu();
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_heal');

    // Visual feedback: brief sparkle/glow on target
    const pos = this.grid.gridToPixel(target.ally.col, target.ally.row);
    const sparkle = this.add.circle(pos.x, pos.y, 20, 0x44ff88, 0.6).setDepth(200);
    this.tweens.add({
      targets: sparkle, alpha: 0, scale: 1.5, duration: 400, ease: 'Quad.easeOut',
      onComplete: () => sparkle.destroy(),
    });

    // Reset target's action state
    target.ally.hasMoved = false;
    target.ally.hasActed = false;
    this.undimUnit(target.ally);

    // Dancer ends turn
    this.finishUnitAction(unit);
  }

  startShoveTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_SHOVE_TARGET';
    this.shoveTargets = this.findShoveTargets(unit);
    const tiles = this.shoveTargets.map(t => ({ col: t.ally.col, row: t.ally.row }));
    this.grid.showAttackRange(tiles, 0x44ff44, 0.4);
  }

  startPullTargetSelection(unit) {
    this.hideActionMenu();
    this.battleState = 'SELECTING_PULL_TARGET';
    this.pullTargets = this.findPullTargets(unit);
    const tiles = this.pullTargets.map(t => ({ col: t.ally.col, row: t.ally.row }));
    this.grid.showAttackRange(tiles, 0x44ff44, 0.4);
  }

  startCantoMove(unit, remainingMov) {
    this.battleState = 'CANTO_MOVING';
    const positions = this.buildUnitPositionMap(unit.faction);
    const moveRange = this.grid.getMovementRange(
      unit.col, unit.row, remainingMov, unit.moveType, positions, unit.faction
    );
    this.grid.showMovementRange(moveRange, unit.col, unit.row, 0x44aaff, 0.3);
    this.cantoRange = moveRange;
  }

  handleShoveTargetClick(gp) {
    const target = this.shoveTargets.find(t => t.ally.col === gp.col && t.ally.row === gp.row);
    if (target) {
      this.grid.clearAttackHighlights();
      this.executeShove(this.selectedUnit, target);
    }
  }

  handlePullTargetClick(gp) {
    const target = this.pullTargets.find(t => t.ally.col === gp.col && t.ally.row === gp.row);
    if (target) {
      this.grid.clearAttackHighlights();
      this.executePull(this.selectedUnit, target);
    }
  }

  handleTradeTargetClick(gp) {
    const target = this.tradeTargets.find(t => t.ally.col === gp.col && t.ally.row === gp.row);
    if (target) {
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_confirm');
      this.grid.clearAttackHighlights();
      this.executeTrade(this.selectedUnit, target);
    }
  }

  handleSwapTargetClick(gp) {
    const target = this.swapTargets.find(t => t.ally.col === gp.col && t.ally.row === gp.row);
    if (target) {
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_confirm');
      this.grid.clearAttackHighlights();
      this.executeSwap(this.selectedUnit, target);
    }
  }

  handleDanceTargetClick(gp) {
    const target = this.danceTargets.find(t => t.ally.col === gp.col && t.ally.row === gp.row);
    if (target) {
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_confirm');
      this.grid.clearAttackHighlights();
      this.executeDance(this.selectedUnit, target);
    }
  }

  handleCantoClick(gp) {
    const unit = this.selectedUnit;
    // Click own tile or W key = skip Canto
    if (gp.col === unit.col && gp.row === unit.row) {
      this.grid.clearHighlights();
      this.cantoRange = null;
      this.dimUnit(unit);
      this.selectedUnit = null;
      this.battleState = 'PLAYER_IDLE';
      this.turnManager.unitActed(unit);
      return;
    }
    const key = `${gp.col},${gp.row}`;
    if (!this.cantoRange?.has(key)) return;
    // Animate Canto movement
    this.grid.clearHighlights();
    const positions = this.buildUnitPositionMap(unit.faction);
    const path = this.grid.findPath(
      unit.col, unit.row, gp.col, gp.row, unit.moveType, positions, unit.faction
    );
    if (!path || path.length < 2) return;
    this.battleState = 'UNIT_MOVING';
    const targets = unit.label ? [unit.graphic, unit.label] : [unit.graphic];
    const destCol = gp.col;
    const destRow = gp.row;
    const animateStep = (stepIndex) => {
      if (stepIndex >= path.length) {
        unit.col = destCol;
        unit.row = destRow;
        this.updateUnitPosition(unit);
        if (this.grid.fogEnabled) {
          this.grid.updateFogOfWar(this.playerUnits);
          this.updateEnemyVisibility();
        }
        this.cantoRange = null;
        this.dimUnit(unit);
        this.selectedUnit = null;
        this.battleState = 'PLAYER_IDLE';
        this.turnManager.unitActed(unit);
        return;
      }
      const pos = this.grid.gridToPixel(path[stepIndex].col, path[stepIndex].row);
      this.tweens.add({
        targets,
        x: pos.x, y: pos.y,
        duration: 80,
        ease: 'Linear',
        onComplete: () => animateStep(stepIndex + 1),
      });
    };
    animateStep(1);
  }

  // --- Action Menu ---

  _clampMenuY(preferredY, menuHeight) {
    const pad = 4;
    const maxY = 480 - menuHeight - pad;
    return Math.max(pad, Math.min(preferredY, maxY));
  }

  showActionMenu(unit) {
    this.hideActionMenu();
    this.inEquipMenu = false;
    this.battleState = 'UNIT_ACTION_MENU';

    const attackTargets = this.findAttackTargets(unit);
    const healTargets = this.findHealTargets(unit);

    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const menuX = (unit.col < this.grid.cols - 3)
      ? pos.x + TILE_SIZE
      : pos.x - TILE_SIZE - 60;
    const menuY = pos.y - 10;

    this.actionMenu = [];

    // Build dynamic item list
    const items = [];
    if (attackTargets.length > 0) items.push('Attack');
    if (healTargets.length > 0) {
      const staff = getStaffWeapon(unit);
      const rem = getStaffRemainingUses(staff, unit);
      const max = getStaffMaxUses(staff, unit);
      items.push(`Heal (${rem}/${max})`);
    }
    const equippableItems = unit.inventory.filter(item =>
      item.type !== 'Consumable' && canEquip(unit, item)
    );
    if (equippableItems.length >= 2) items.push('Equip');
    if (canPromote(unit)) items.push('Promote');
    // Item: show if unit has consumables
    const consumables = unit.consumables || [];
    if (consumables.length > 0) items.push('Item');
    // Accessory: show if unit has accessory or team has accessories in pool
    if (unit.accessory || (this.runManager?.accessories?.length > 0)) items.push('Accessory');
    // Shove/Pull: show if unit has skill and valid targets exist
    if (unit.skills?.includes('shove') && this.findShoveTargets(unit).length > 0) items.push('Shove');
    if (unit.skills?.includes('pull') && this.findPullTargets(unit).length > 0) items.push('Pull');
    // Trade: show if adjacent ally with items/space exists
    if (this.findTradeTargets(unit).length > 0) items.push('Trade');
    // Swap: show if adjacent ally on walkable terrain exists
    if (this.findSwapTargets(unit).length > 0) items.push('Swap');
    // Dance: show if unit has skill and valid targets exist
    if (unit.skills?.includes('dance') && this.findDanceTargets(unit).length > 0) items.push('Dance');
    // Talk: Lord adjacent to NPC, roster not full
    if (unit.isLord && this.npcUnits.length > 0) {
      const talkTarget = this.findTalkTarget(unit);
      const rosterCapBonus = this.runManager?.metaEffects?.rosterCapBonus || 0;
      if (talkTarget && this.playerUnits.length < ROSTER_CAP + rosterCapBonus) {
        items.push('Talk');
      }
    }
    // Seize: Lord on throne, boss dead
    if (this.battleConfig.objective === 'seize' && unit.isLord) {
      const throne = this.battleConfig.thronePos;
      const bossAlive = this.enemyUnits.some(u => u.isBoss);
      if (throne && unit.col === throne.col && unit.row === throne.row && !bossAlive) {
        items.push('Seize');
      }
    }
    items.push('Wait');

    const longestLabel = Math.max(...items.map(l => l.length));
    const menuWidth = Math.max(70, longestLabel * 8 + 16);
    const itemHeight = 22;
    const menuHeight = items.length * itemHeight + 8;
    const clampedY = this._clampMenuY(menuY, menuHeight);

    const bg = this.add.rectangle(
      menuX + menuWidth / 2, clampedY + menuHeight / 2,
      menuWidth, menuHeight, 0x000000, 0.85
    ).setDepth(400).setStrokeStyle(1, 0x666666);
    this.actionMenu.push(bg);

    items.forEach((label, i) => {
      const itemY = clampedY + 4 + i * itemHeight + itemHeight / 2;
      const itemX = menuX + menuWidth / 2;

      const text = this.add.text(itemX, itemY, label, {
        fontFamily: 'monospace', fontSize: '13px', color: '#e0e0e0',
      }).setOrigin(0.5).setDepth(401).setInteractive({ useHandCursor: true });

      text.on('pointerover', () => text.setColor('#ffdd44'));
      text.on('pointerout', () => text.setColor('#e0e0e0'));
      text.on('pointerdown', () => {
        const audio = this.registry.get('audio');
        if (audio) audio.playSFX('sfx_confirm');
        if (label === 'Attack') {
          // Auto-equip first combat weapon if staff is currently equipped
          if (unit.weapon && isStaff(unit.weapon)) {
            const combatWpn = getCombatWeapons(unit)[0];
            if (combatWpn) {
              equipWeapon(unit, combatWpn);
              this.showAutoSwitchTooltip(unit, combatWpn);
            }
          }
          // Show weapon picker if unit has 2+ combat weapons
          const combatWeapons = getCombatWeapons(unit);
          if (combatWeapons.length >= 2) {
            this.showWeaponPicker(unit, attackTargets);
          } else {
            this.hideActionMenu();
            this.attackTargets = attackTargets;
            const attackTiles = attackTargets.map(e => ({ col: e.col, row: e.row }));
            this.grid.showAttackRange(attackTiles);
            this.battleState = 'SELECTING_TARGET';
          }
        } else if (label.startsWith('Heal')) {
          this.hideActionMenu();
          this.startHealTargetSelection(unit, healTargets);
        } else if (label === 'Equip') {
          this.showEquipMenu(unit);
        } else if (label === 'Promote') {
          this.hideActionMenu();
          this.executePromotion(unit);
        } else if (label === 'Item') {
          this.showItemMenu(unit);
        } else if (label === 'Accessory') {
          this.showAccessoryMenu(unit);
        } else if (label === 'Talk') {
          this.hideActionMenu();
          this.executeTalk(unit);
        } else if (label === 'Seize') {
          this.hideActionMenu();
          this.onVictory();
        } else if (label === 'Shove') {
          this.startShoveTargetSelection(unit);
        } else if (label === 'Pull') {
          this.startPullTargetSelection(unit);
        } else if (label === 'Trade') {
          this.startTradeTargetSelection(unit);
        } else if (label === 'Swap') {
          this.startSwapTargetSelection(unit);
        } else if (label === 'Dance') {
          this.startDanceTargetSelection(unit);
        } else if (label === 'Wait') {
          this.finishUnitAction(unit, { skipCanto: true });
        }
      });

      this.actionMenu.push(text);
    });
  }

  hideActionMenu() {
    if (this.actionMenu) {
      this.actionMenu.forEach(obj => obj.destroy());
      this.actionMenu = null;
    }
  }

  undoMove(unit) {
    if (!this.preMoveLoc) {
      this.deselectUnit();
      return;
    }

    // Return unit to original position
    const { col, row } = this.preMoveLoc;
    unit.col = col;
    unit.row = row;
    unit.hasMoved = false;
    this.updateUnitPosition(unit);

    // Re-select the unit so they can choose again
    this.preMoveLoc = null;
    this.selectUnit(unit);
  }

  // --- Talk / Recruit ---

  findTalkTarget(unit) {
    for (const npc of this.npcUnits) {
      const dist = Math.abs(unit.col - npc.col) + Math.abs(unit.row - npc.row);
      if (dist === 1) return npc;
    }
    return null;
  }

  async executeTalk(lord) {
    const npc = this.findTalkTarget(lord);
    if (!npc) {
      this.finishUnitAction(lord);
      return;
    }

    this.battleState = 'COMBAT_RESOLVING'; // block input

    // Show recruitment banner
    await this.showBriefBanner(`${npc.name} joins your army!`, '#44ccaa');

    // Remove from NPC array
    const npcIdx = this.npcUnits.indexOf(npc);
    if (npcIdx !== -1) this.npcUnits.splice(npcIdx, 1);

    // Convert faction
    npc.faction = 'player';

    // Destroy and re-create graphics (correct sprite key + tint + HP bar color)
    this.removeUnitGraphic(npc);
    this.addUnitGraphic(npc);

    // Add to player units
    this.playerUnits.push(npc);
    npc.hasActed = true;
    this.dimUnit(npc);

    this.finishUnitAction(lord);
  }

  // --- Heal flow ---

  findHealTargets(unit) {
    if (!hasStaff(unit)) return [];
    const staff = getStaffWeapon(unit);
    if (getStaffRemainingUses(staff, unit) <= 0) return [];
    const range = getEffectiveStaffRange(staff, unit);
    const targets = [];
    for (const ally of this.playerUnits) {
      if (ally === unit) continue; // Can't heal self
      if (ally.currentHP >= ally.stats.HP) continue; // Full HP
      const dist = gridDistance(unit.col, unit.row, ally.col, ally.row);
      if (dist >= range.min && dist <= range.max) {
        targets.push(ally);
      }
    }
    return targets;
  }

  startHealTargetSelection(unit, targets) {
    // Auto-equip staff
    const staff = getStaffWeapon(unit);
    if (staff) equipWeapon(unit, staff);

    // First-heal tutorial hint (one-time per save slot)
    const hints = this.registry.get('hints');
    if (hints?.shouldShow('battle_heal_uses')) {
      showMinorHint(this, 'Staves have limited uses per battle. Uses reset each battle. Higher MAG grants bonus uses.');
    }

    // Fortify: auto-heal all targets, no selection needed
    if (staff.healAll) {
      this.executeHealAll(unit, targets);
      return;
    }

    this.healTargets = targets;
    const healTiles = targets.map(a => ({ col: a.col, row: a.row }));
    this.grid.showHealRange(healTiles);
    this.battleState = 'SELECTING_HEAL_TARGET';
  }

  handleHealTargetClick(gp) {
    const target = this.healTargets.find(a => a.col === gp.col && a.row === gp.row);
    if (target) {
      this.executeHeal(this.selectedUnit, target);
    }
  }

  async executeHeal(healer, target) {
    this.battleState = 'HEAL_RESOLVING';
    this.grid.clearAttackHighlights();

    const staff = healer.weapon; // Should already be equipped
    const result = resolveHeal(staff, healer, target);

    // Apply heal
    target.currentHP = result.targetHPAfter;
    this.updateHPBar(target);

    // Animate
    await this.animateHeal(target, result.healAmount);

    // Spend a use and check depletion
    spendStaffUse(staff);
    if (getStaffRemainingUses(staff, healer) <= 0) {
      const combatWpn = getCombatWeapons(healer)[0];
      if (combatWpn) equipWeapon(healer, combatWpn);
    }

    this.finishUnitAction(healer);
  }

  async executeHealAll(healer, targets) {
    this.battleState = 'HEAL_RESOLVING';
    this.grid.clearAttackHighlights();

    const staff = healer.weapon;

    for (const target of targets) {
      const result = resolveHeal(staff, healer, target);
      target.currentHP = result.targetHPAfter;
      this.updateHPBar(target);
      await this.animateHeal(target, result.healAmount);
    }

    // Single use spent for all targets
    spendStaffUse(staff);
    if (getStaffRemainingUses(staff, healer) <= 0) {
      const combatWpn = getCombatWeapons(healer)[0];
      if (combatWpn) equipWeapon(healer, combatWpn);
    }

    this.finishUnitAction(healer);
  }

  animateHeal(target, healAmount) {
    return new Promise(resolve => {
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_heal');
      // Flash target green
      if (target.graphic.setTint) target.graphic.setTint(0x44ff44);

      const pos = this.grid.gridToPixel(target.col, target.row);
      const healText = this.add.text(pos.x, pos.y - 16, `+${healAmount}`, {
        fontFamily: 'monospace', fontSize: '13px', color: '#44ff44', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(300);

      this.tweens.add({
        targets: healText, y: pos.y - 36, alpha: 0,
        duration: 600, onComplete: () => healText.destroy(),
      });

      this.time.delayedCall(250, () => {
        if (target.graphic.clearTint) target.graphic.clearTint();
      });

      this.time.delayedCall(500, resolve);
    });
  }

  // --- Weapon picker (pre-attack) ---

  showWeaponPicker(unit, attackTargets) {
    this.hideActionMenu();
    this.inEquipMenu = true;
    this.battleState = 'UNIT_ACTION_MENU';

    const combatWeapons = getCombatWeapons(unit);
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const menuX = (unit.col < this.grid.cols - 3)
      ? pos.x + TILE_SIZE
      : pos.x - TILE_SIZE - 210;
    const menuY = pos.y - 10;

    this.actionMenu = [];

    const menuWidth = 210;
    const itemHeight = 36;
    const menuHeight = combatWeapons.length * itemHeight + 12;
    const clampedY = this._clampMenuY(menuY, menuHeight);

    const bg = this.add.rectangle(
      menuX + menuWidth / 2, clampedY + menuHeight / 2,
      menuWidth, menuHeight, 0x000000, 0.85
    ).setDepth(400).setStrokeStyle(1, 0x666666);
    this.actionMenu.push(bg);

    combatWeapons.forEach((wpn, i) => {
      const itemY = clampedY + 6 + i * itemHeight + itemHeight / 2;
      const itemX = menuX + 8;
      const marker = wpn === unit.weapon ? '\u25b6 ' : '  ';
      const rng = wpn.range.includes('-') ? `Rng${wpn.range}` : `Rng ${wpn.range}`;
      const label = `${marker}${wpn.name}\n   ${wpn.might}Mt ${wpn.hit}Hit ${wpn.crit}Crt ${rng}`;
      const defaultColor = wpn === unit.weapon ? '#ffdd44' : '#e0e0e0';

      const text = this.add.text(itemX, itemY, label, {
        fontFamily: 'monospace', fontSize: '11px', color: defaultColor, lineSpacing: 1,
      }).setOrigin(0, 0.5).setDepth(401).setInteractive({ useHandCursor: true });

      text.on('pointerover', () => text.setColor('#ffdd44'));
      text.on('pointerout', () => text.setColor(defaultColor));
      text.on('pointerdown', () => {
        const audio = this.registry.get('audio');
        if (audio) audio.playSFX('sfx_confirm');
        equipWeapon(unit, wpn);
        this.inEquipMenu = false;
        this.hideActionMenu();
        // Now enter target selection with chosen weapon
        // Recalculate attack targets since weapon range may differ
        this.attackTargets = this.findAttackTargets(unit);
        const attackTiles = this.attackTargets.map(e => ({ col: e.col, row: e.row }));
        this.grid.showAttackRange(attackTiles);
        this.battleState = 'SELECTING_TARGET';
      });

      this.actionMenu.push(text);
    });
  }

  // --- Equip sub-menu ---

  showEquipMenu(unit) {
    this.hideActionMenu();
    this.inEquipMenu = true;
    this.battleState = 'UNIT_ACTION_MENU';

    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const menuX = (unit.col < this.grid.cols - 3)
      ? pos.x + TILE_SIZE
      : pos.x - TILE_SIZE - 100;
    const menuY = pos.y - 10;

    this.actionMenu = [];

    // Scrolls no longer in inventory (moved to team pool), so no need to filter them
    const equippable = unit.inventory.filter(item => item.type !== 'Consumable' && canEquip(unit, item));
    const menuWidth = 110;
    const itemHeight = 22;
    const menuHeight = equippable.length * itemHeight + 8;
    const clampedY = this._clampMenuY(menuY, menuHeight);

    const bg = this.add.rectangle(
      menuX + menuWidth / 2, clampedY + menuHeight / 2,
      menuWidth, menuHeight, 0x000000, 0.85
    ).setDepth(400).setStrokeStyle(1, 0x666666);
    this.actionMenu.push(bg);

    equippable.forEach((wpn, i) => {
      const itemY = clampedY + 4 + i * itemHeight + itemHeight / 2;
      const itemX = menuX + menuWidth / 2;
      const marker = wpn === unit.weapon ? '\u25b6 ' : '  ';
      const label = marker + wpn.name;
      const defaultColor = wpn === unit.weapon ? '#ffdd44' : '#e0e0e0';

      const text = this.add.text(itemX, itemY, label, {
        fontFamily: 'monospace', fontSize: '12px', color: defaultColor,
      }).setOrigin(0.5).setDepth(401).setInteractive({ useHandCursor: true });

      text.on('pointerover', () => text.setColor('#ffdd44'));
      text.on('pointerout', () => text.setColor(defaultColor));
      text.on('pointerdown', () => {
        equipWeapon(unit, wpn);
        this.showActionMenu(unit);
      });

      this.actionMenu.push(text);
    });
  }

  /** DEPRECATED: Scrolls now handled in team pool via RosterOverlay. */
  // async useSkillScroll(unit, scroll) {
  //   const result = learnSkill(unit, scroll.skillId);
  //   if (result.learned) {
  //     removeFromInventory(unit, scroll);
  //     this.hideActionMenu();
  //     const skillData = this.gameData.skills.find(s => s.id === scroll.skillId);
  //     const skillName = skillData ? skillData.name : scroll.skillId;
  //     await this.showSkillLearnedBanner(unit, skillName);
  //     this.showActionMenu(unit);
  //   } else {
  //     // Show feedback for failure
  //     this.hideActionMenu();
  //     const reason = result.reason === 'at_cap'
  //       ? `${unit.name} already knows ${MAX_SKILLS} skills!`
  //       : `${unit.name} already knows this skill!`;
  //     await this.showBriefBanner(reason, '#ff8888');
  //     this.showEquipMenu(unit);
  //   }
  // }

  // --- Item Menu (Consumables) ---

  showItemMenu(unit) {
    this.hideActionMenu();
    this.actionMenu = [];
    this.inEquipMenu = true; // reuse flag to block other input

    // Use consumables array instead of filtering inventory
    const consumables = unit.consumables || [];
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const menuX = (unit.col < this.grid.cols - 3) ? pos.x + TILE_SIZE : pos.x - TILE_SIZE - 120;
    const menuY = pos.y - 10;

    const itemHeight = 22;
    const menuWidth = 120;
    const menuHeight = (consumables.length + 1) * itemHeight + 8; // +1 for Back
    const clampedY = this._clampMenuY(menuY, menuHeight);

    const bg = this.add.rectangle(
      menuX + menuWidth / 2, clampedY + menuHeight / 2,
      menuWidth, menuHeight, 0x000000, 0.85
    ).setDepth(400).setStrokeStyle(1, 0x666666);
    this.actionMenu.push(bg);

    consumables.forEach((item, i) => {
      const iy = clampedY + 4 + i * itemHeight + itemHeight / 2;
      const ix = menuX + menuWidth / 2;

      // Check usability
      const isHeal = item.effect === 'heal' || item.effect === 'healFull';
      const isPromote = item.effect === 'promote';
      const usable = !(isHeal && unit.currentHP >= unit.stats.HP) && !(isPromote && !canPromote(unit));

      let label = item.name;
      if (item.uses !== undefined) label += ` (${item.uses})`;

      const color = usable ? '#88ff88' : '#666666';
      const text = this.add.text(ix, iy, label, {
        fontFamily: 'monospace', fontSize: '11px', color,
      }).setOrigin(0.5).setDepth(401);

      if (usable) {
        text.setInteractive({ useHandCursor: true });
        text.on('pointerover', () => text.setColor('#ffdd44'));
        text.on('pointerout', () => text.setColor('#88ff88'));
        text.on('pointerdown', () => {
          this.useConsumable(unit, item);
        });
      }
      this.actionMenu.push(text);
    });

    // Back button
    const backY = clampedY + 4 + consumables.length * itemHeight + itemHeight / 2;
    const backText = this.add.text(menuX + menuWidth / 2, backY, 'Back', {
      fontFamily: 'monospace', fontSize: '11px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(401).setInteractive({ useHandCursor: true });

    backText.on('pointerover', () => backText.setColor('#ffdd44'));
    backText.on('pointerout', () => backText.setColor('#aaaaaa'));
    backText.on('pointerdown', () => {
      this.hideActionMenu();
      this.inEquipMenu = false;
      this.showActionMenu(unit);
    });
    this.actionMenu.push(backText);
  }

  async useConsumable(unit, item) {
    this.hideActionMenu();
    this.inEquipMenu = false;

    if (item.effect === 'heal') {
      const oldHP = unit.currentHP;
      unit.currentHP = Math.min(unit.stats.HP, unit.currentHP + item.value);
      const healed = unit.currentHP - oldHP;
      this.updateHPBar(unit);
      await this.showBriefBanner(`${unit.name} healed ${healed} HP!`, '#88ff88');
    } else if (item.effect === 'healFull') {
      unit.currentHP = unit.stats.HP;
      this.updateHPBar(unit);
      await this.showBriefBanner(`${unit.name} fully healed!`, '#88ff88');
    } else if (item.effect === 'promote') {
      await this.executePromotion(unit);
      // executePromotion calls finishUnitAction, and we handle uses below
      // But executePromotion already finishes the action, so decrement uses and return
      item.uses--;
      if (item.uses <= 0) removeFromConsumables(unit, item);
      return;
    }

    // Decrement uses, remove if depleted
    item.uses--;
    if (item.uses <= 0) removeFromConsumables(unit, item);

    this.finishUnitAction(unit);
  }

  showSkillLearnedBanner(unit, skillName) {
    return new Promise(resolve => {
      const banner = this.add.text(
        this.cameras.main.centerX, this.cameras.main.centerY,
        `${unit.name} learned ${skillName}!`,
        {
          fontFamily: 'monospace', fontSize: '16px', color: '#88ffff',
          backgroundColor: '#000000cc', padding: { x: 16, y: 8 },
        }
      ).setOrigin(0.5).setAlpha(0).setDepth(500);

      this.tweens.add({
        targets: banner, alpha: 1, duration: 300,
        yoyo: true, hold: 1200,
        onComplete: () => { banner.destroy(); resolve(); },
      });
    });
  }

  showBriefBanner(message, color = '#ffdd44') {
    return new Promise(resolve => {
      const banner = this.add.text(
        this.cameras.main.centerX, this.cameras.main.centerY,
        message,
        {
          fontFamily: 'monospace', fontSize: '14px', color,
          backgroundColor: '#000000cc', padding: { x: 16, y: 8 },
        }
      ).setOrigin(0.5).setAlpha(0).setDepth(500);

      this.tweens.add({
        targets: banner, alpha: 1, duration: 200,
        yoyo: true, hold: 800,
        onComplete: () => { banner.destroy(); resolve(); },
      });
    });
  }

  // --- Accessory Menu ---

  showAccessoryMenu(unit) {
    this.hideActionMenu();
    this.inEquipMenu = true;
    this.battleState = 'UNIT_ACTION_MENU';

    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const menuX = (unit.col < this.grid.cols - 3) ? pos.x + TILE_SIZE : pos.x - TILE_SIZE - 140;
    const menuY = pos.y - 10;

    this.actionMenu = [];
    const pool = this.runManager?.accessories || [];
    const items = [];

    // Current accessory (unequip option)
    if (unit.accessory) {
      items.push({ label: `\u25b6 ${unit.accessory.name}`, action: 'unequip', accessory: unit.accessory });
    }
    // Pool accessories (equip options)
    for (const acc of pool) {
      items.push({ label: `  ${acc.name}`, action: 'equip', accessory: acc });
    }
    items.push({ label: 'Back', action: 'back' });

    const menuWidth = 140;
    const itemHeight = 22;
    const menuHeight = items.length * itemHeight + 8;
    const clampedY = this._clampMenuY(menuY, menuHeight);

    const bg = this.add.rectangle(
      menuX + menuWidth / 2, clampedY + menuHeight / 2,
      menuWidth, menuHeight, 0x000000, 0.85
    ).setDepth(400).setStrokeStyle(1, 0x666666);
    this.actionMenu.push(bg);

    items.forEach((entry, i) => {
      const iy = clampedY + 4 + i * itemHeight + itemHeight / 2;
      const ix = menuX + menuWidth / 2;
      const defaultColor = entry.action === 'unequip' ? '#cc88ff' : entry.action === 'back' ? '#aaaaaa' : '#e0e0e0';

      const text = this.add.text(ix, iy, entry.label, {
        fontFamily: 'monospace', fontSize: '11px', color: defaultColor,
      }).setOrigin(0.5).setDepth(401).setInteractive({ useHandCursor: true });

      text.on('pointerover', () => text.setColor('#ffdd44'));
      text.on('pointerout', () => text.setColor(defaultColor));
      text.on('pointerdown', () => {
        if (entry.action === 'back') {
          this.hideActionMenu();
          this.inEquipMenu = false;
          this.showActionMenu(unit);
        } else if (entry.action === 'unequip') {
          this.doUnequipAccessory(unit);
          this.showAccessoryMenu(unit);
        } else if (entry.action === 'equip') {
          this.doEquipAccessory(unit, entry.accessory);
          this.showAccessoryMenu(unit);
        }
      });
      this.actionMenu.push(text);
    });
  }

  doEquipAccessory(unit, accessory) {
    const pool = this.runManager?.accessories;
    if (!pool) return;
    const idx = pool.indexOf(accessory);
    if (idx === -1) return;
    pool.splice(idx, 1);
    const old = equipAccessory(unit, accessory);
    if (old) pool.push(old);
    this.updateHPBar(unit);
  }

  doUnequipAccessory(unit) {
    const pool = this.runManager?.accessories;
    if (!pool) return;
    const old = unequipAccessory(unit);
    if (old) pool.push(old);
    this.updateHPBar(unit);
  }

  // --- Promotion ---

  async executePromotion(unit) {
    this.battleState = 'COMBAT_RESOLVING'; // block input during promotion

    // Find promotion data
    const lordData = this.gameData.lords.find(l => l.name === unit.name);
    let promotedClassName, promotionBonuses, promotionWeapons;

    if (lordData) {
      promotedClassName = lordData.promotedClass;
      promotionBonuses = lordData.promotionBonuses;
      promotionWeapons = lordData.promotionWeapons;
    } else {
      const baseClass = this.gameData.classes.find(c => c.name === unit.className);
      promotedClassName = baseClass?.promotesTo;
      const promotedClass = this.gameData.classes.find(c => c.name === promotedClassName);
      promotionBonuses = promotedClass?.promotionBonuses;
    }

    if (!promotedClassName || !promotionBonuses) {
      this.finishUnitAction(unit);
      return;
    }

    const promotedClassData = this.gameData.classes.find(c => c.name === promotedClassName);
    if (!promotedClassData) {
      this.finishUnitAction(unit);
      return;
    }

    // Track pre-promotion weapon types to detect new proficiencies
    const oldTypes = new Set(unit.proficiencies.map(p => p.type));

    // Apply promotion
    promoteUnit(unit, promotedClassData, promotionBonuses, this.gameData.skills);

    // Refresh sprite to show promoted class
    this.removeUnitGraphic(unit);
    this.addUnitGraphic(unit);

    // Grant Iron weapons for any new weapon proficiencies gained
    if (promotionWeapons) {
      // Lords get specific promotion weapons (e.g. "Lances (P)")
      const newType = promotionWeapons.match(/(\w+)/)?.[1];
      const typeMap = { Swords: 'Sword', Lances: 'Lance', Axes: 'Axe', Bows: 'Bow', Tomes: 'Tome', Staves: 'Staff', Light: 'Light' };
      const wpnType = typeMap[newType] || newType;
      const newWeapon = this.gameData.weapons.find(w => w.type === wpnType && w.tier === 'Iron');
      if (newWeapon && !unit.inventory.some(w => w.name === newWeapon.name)) {
        addToInventory(unit, newWeapon);
      }
    } else {
      // Non-Lord: grant Iron weapon for each newly gained proficiency type
      for (const prof of unit.proficiencies) {
        if (oldTypes.has(prof.type)) continue;
        const tier = 'Iron';
        const newWeapon = this.gameData.weapons.find(w => w.type === prof.type && w.tier === tier);
        if (newWeapon && !unit.inventory.some(w => w.name === newWeapon.name)) {
          addToInventory(unit, newWeapon);
        }
      }
    }

    // Update HP bar (max HP increased)
    this.updateHPBar(unit);

    // Show promotion banner
    await this.showPromotionBanner(unit, promotedClassName);

    // Show stat gains as a level-up style popup
    const gains = { gains: { ...promotionBonuses }, newLevel: 1 };
    delete gains.gains.MOV; // MOV isn't shown in level-up popup
    const popup = new LevelUpPopup(this, unit, gains, true);
    await popup.show();

    this.finishUnitAction(unit);
  }

  showPromotionBanner(unit, newClassName) {
    return new Promise(resolve => {
      const banner = this.add.text(
        this.cameras.main.centerX, this.cameras.main.centerY,
        `${unit.name} promoted to ${newClassName}!`,
        {
          fontFamily: 'monospace', fontSize: '16px', color: '#ffdd44',
          backgroundColor: '#000000cc', padding: { x: 16, y: 8 },
        }
      ).setOrigin(0.5).setAlpha(0).setDepth(500);

      this.tweens.add({
        targets: banner, alpha: 1, duration: 300,
        yoyo: true, hold: 1200,
        onComplete: () => { banner.destroy(); resolve(); },
      });
    });
  }

  // --- Skill context builder ---

  buildSkillCtx(attacker, defender) {
    const skills = this.gameData.skills;
    const getAllies = (unit) => {
      if (unit.faction === 'player') return this.playerUnits;
      if (unit.faction === 'npc') return [unit]; // NPC has no allies for aura purposes
      return this.enemyUnits;
    };
    const getEnemies = (unit) => {
      if (unit.faction === 'player') return this.enemyUnits;
      if (unit.faction === 'npc') return this.enemyUnits;
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

  // --- Combat ---

  _cycleForecastWeapon(direction) {
    if (this.battleState !== 'SHOWING_FORECAST' || !this.selectedUnit) return;
    const validWeapons = this._forecastValidWeapons;
    if (!validWeapons || validWeapons.length < 2) return;

    const currentIdx = validWeapons.indexOf(this.selectedUnit.weapon);
    if (currentIdx < 0) return;
    const nextIdx = (currentIdx + direction + validWeapons.length) % validWeapons.length;
    equipWeapon(this.selectedUnit, validWeapons[nextIdx]);

    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_cursor');

    // Rebuild forecast with new weapon
    const target = this.forecastTarget;
    this.hideForecast();
    this.showForecast(this.selectedUnit, target);
  }

  _getPortraitKey(unit) {
    const lordData = this.gameData.lords.find(l => l.name === unit.name);
    if (lordData) return `portrait_lord_${unit.name.toLowerCase()}`;
    const classKey = `portrait_generic_${unit.className.toLowerCase().replace(/ /g, '_')}`;
    if (this.textures.exists(classKey)) return classKey;
    const classData = this.gameData.classes.find(c => c.name === unit.className);
    if (classData?.promotesFrom) {
      const baseKey = `portrait_generic_${classData.promotesFrom.toLowerCase().replace(/ /g, '_')}`;
      if (this.textures.exists(baseKey)) return baseKey;
    }
    return null;
  }

  _drawForecastSide(x, panelY, unit, info, opponent, isAttacker, depth) {
    const sideW = 186;
    const textDepth = depth + 1;
    let y = panelY + 6;

    // Portrait (40x40) â€” attacker on left edge, defender on right edge
    const portraitKey = this._getPortraitKey(unit);
    if (portraitKey && this.textures.exists(portraitKey)) {
      const px = isAttacker ? x + 2 : x + sideW - 42;
      const portrait = this.add.image(px + 20, y + 20, portraitKey)
        .setDisplaySize(40, 40).setDepth(textDepth);
      this.forecastObjects.push(portrait);
    }

    // Name â€” positioned next to portrait
    const nameX = isAttacker ? x + 48 : x + 2;
    const name = this.add.text(nameX, y + 6, unit.name, {
      fontFamily: 'monospace', fontSize: '11px', color: '#ffdd44', fontStyle: 'bold',
    }).setDepth(textDepth);
    this.forecastObjects.push(name);

    // EFFECTIVE! banner â€” below name, beside portrait
    if (unit.weapon && getEffectivenessMultiplier(unit.weapon, opponent) > 1 &&
        (isAttacker || info.canCounter)) {
      const eff = this.add.text(nameX, y + 22, 'EFFECTIVE!', {
        fontFamily: 'monospace', fontSize: '9px', color: '#ff4444', fontStyle: 'bold',
      }).setDepth(textDepth);
      this.forecastObjects.push(eff);
    }

    // HP row â€” below portrait area
    y += 44;
    const hpLabel = this.add.text(x + 2, y, 'HP', {
      fontFamily: 'monospace', fontSize: '10px', color: '#aaaaaa',
    }).setDepth(textDepth);
    this.forecastObjects.push(hpLabel);

    const hpVal = this.add.text(x + 22, y, `${unit.currentHP}/${unit.stats.HP}`, {
      fontFamily: 'monospace', fontSize: '10px', color: '#ffffff',
    }).setDepth(textDepth);
    this.forecastObjects.push(hpVal);

    // HP bar
    const barX = x + 80;
    const barW = sideW - 86;
    const barH = 6;
    const barY = y + 4;
    const hpGfx = this.add.graphics().setDepth(textDepth);
    hpGfx.fillStyle(0x333333);
    hpGfx.fillRect(barX, barY, barW, barH);
    const ratio = Math.max(0, unit.currentHP / unit.stats.HP);
    hpGfx.fillStyle(getHPBarColor(ratio));
    hpGfx.fillRect(barX, barY, Math.round(barW * ratio), barH);
    this.forecastObjects.push(hpGfx);

    y += 16;

    // Cannot counter case (defender only)
    if (!isAttacker && !info.canCounter) {
      const noCounter = this.add.text(x + sideW / 2, y + 4, '-- No Counter --', {
        fontFamily: 'monospace', fontSize: '10px', color: '#cc6666',
      }).setOrigin(0.5, 0).setDepth(textDepth);
      this.forecastObjects.push(noCounter);

      y += 20;
      const wpnName = unit.weapon?.name || 'Unarmed';
      const wpn = this.add.text(x + 2, y, wpnName, {
        fontFamily: 'monospace', fontSize: '9px', color: '#88bbff',
      }).setDepth(textDepth);
      this.forecastObjects.push(wpn);
      return;
    }

    // Stat row 1: Dmg + Hit
    const dmgLabel = this.add.text(x + 2, y, 'Dmg', {
      fontFamily: 'monospace', fontSize: '10px', color: '#888888',
    }).setDepth(textDepth);
    this.forecastObjects.push(dmgLabel);
    const dmgVal = this.add.text(x + 32, y, `${info.damage}`, {
      fontFamily: 'monospace', fontSize: '10px', color: '#e0e0e0',
    }).setDepth(textDepth);
    this.forecastObjects.push(dmgVal);

    const hitLabel = this.add.text(x + 80, y, 'Hit', {
      fontFamily: 'monospace', fontSize: '10px', color: '#888888',
    }).setDepth(textDepth);
    this.forecastObjects.push(hitLabel);
    const hitVal = this.add.text(x + 108, y, `${info.hit}%`, {
      fontFamily: 'monospace', fontSize: '10px', color: '#e0e0e0',
    }).setDepth(textDepth);
    this.forecastObjects.push(hitVal);

    y += 14;

    // Stat row 2: Crt + doubling
    const crtLabel = this.add.text(x + 2, y, 'Crt', {
      fontFamily: 'monospace', fontSize: '10px', color: '#888888',
    }).setDepth(textDepth);
    this.forecastObjects.push(crtLabel);
    const crtVal = this.add.text(x + 32, y, `${info.crit}%`, {
      fontFamily: 'monospace', fontSize: '10px', color: '#e0e0e0',
    }).setDepth(textDepth);
    this.forecastObjects.push(crtVal);

    if (info.attackCount > 1) {
      const countText = this.add.text(x + 80, y, `x${info.attackCount}`, {
        fontFamily: 'monospace', fontSize: '11px', color: '#ffdd44', fontStyle: 'bold',
      }).setDepth(textDepth);
      this.forecastObjects.push(countText);
    }

    y += 14;

    // Weapon name (with â—„ â–º arrows + next weapon preview if attacker has 2+ valid weapons)
    const wpnName = unit.weapon?.name || 'Unarmed';
    const wpnColor = unit.weapon && isForged(unit.weapon) ? '#44ff88' : '#88bbff';
    const validWpns = this._forecastValidWeapons;
    const canCycle = isAttacker && validWpns?.length >= 2;

    if (canCycle) {
      // Left arrow
      const leftArrow = this.add.text(x + 1, y - 2, '\u25C4', {
        fontFamily: 'monospace', fontSize: '12px', color: '#888888',
      }).setDepth(textDepth).setInteractive({ useHandCursor: true });
      leftArrow.on('pointerover', () => leftArrow.setColor('#ffdd44'));
      leftArrow.on('pointerout', () => leftArrow.setColor('#888888'));
      leftArrow.on('pointerdown', () => this._cycleForecastWeapon(-1));
      this.forecastObjects.push(leftArrow);

      // Current weapon name (centered between arrows)
      const wpn = this.add.text(x + 16, y, wpnName, {
        fontFamily: 'monospace', fontSize: '9px', color: wpnColor,
      }).setDepth(textDepth);
      this.forecastObjects.push(wpn);

      // Right arrow
      const rightArrow = this.add.text(x + sideW - 14, y - 2, '\u25BA', {
        fontFamily: 'monospace', fontSize: '12px', color: '#888888',
      }).setDepth(textDepth).setInteractive({ useHandCursor: true });
      rightArrow.on('pointerover', () => rightArrow.setColor('#ffdd44'));
      rightArrow.on('pointerout', () => rightArrow.setColor('#888888'));
      rightArrow.on('pointerdown', () => this._cycleForecastWeapon(1));
      this.forecastObjects.push(rightArrow);

      // Next weapon preview (right arrow direction)
      const curIdx = validWpns.indexOf(unit.weapon);
      const nextIdx = (curIdx + 1) % validWpns.length;
      const nextWpn = validWpns[nextIdx];
      if (nextWpn) {
        const preview = this.add.text(x + 2, y + 11, `\u25BA ${nextWpn.name}`, {
          fontFamily: 'monospace', fontSize: '8px', color: '#666688',
        }).setDepth(textDepth);
        this.forecastObjects.push(preview);
      }
    } else {
      const wpn = this.add.text(x + 2, y, wpnName, {
        fontFamily: 'monospace', fontSize: '9px', color: wpnColor,
      }).setDepth(textDepth);
      this.forecastObjects.push(wpn);
    }

    y += 12;

    // Skills + Miracle (combined on one line if both present)
    const parts = [];
    if (info.skills?.length) {
      parts.push(info.skills.map(s => s.name).join(', '));
    }
    if (unit.skills?.includes('miracle')) {
      const used = unit._miracleUsed;
      parts.push(`Miracle: ${used ? 'Used' : 'Ready'}`);
    }
    if (parts.length) {
      const skillText = this.add.text(x + 2, y, parts.join('  '), {
        fontFamily: 'monospace', fontSize: '9px', color: '#aaddff',
        wordWrap: { width: sideW - 6 },
      }).setDepth(textDepth);
      this.forecastObjects.push(skillText);
    }
  }

  showForecast(attacker, defender) {
    this.forecastTarget = defender;
    this.battleState = 'SHOWING_FORECAST';

    const dist = gridDistance(attacker.col, attacker.row, defender.col, defender.row);

    // Auto-swap to a weapon that can reach the target if equipped weapon can't
    this.ensureValidWeaponForRange(attacker, dist);

    const atkTerrain = this.grid.getTerrainAt(attacker.col, attacker.row);
    const defTerrain = this.grid.getTerrainAt(defender.col, defender.row);
    const skillCtx = this.buildSkillCtx(attacker, defender);

    const forecast = getCombatForecast(
      attacker, attacker.weapon,
      defender, defender.weapon,
      dist, atkTerrain, defTerrain,
      skillCtx
    );

    // Compute valid weapons for cycling (weapons that can reach this target)
    const validWeapons = getCombatWeapons(attacker).filter(w => {
      const { min, max } = parseRange(w.range);
      const bonus = getWeaponRangeBonus(attacker, w, this.gameData.skills);
      return dist >= min && dist <= max + bonus;
    });
    this._forecastValidWeapons = validWeapons;

    // Build graphical forecast panel (FE GBA-style split layout)
    this.forecastObjects = [];
    const depth = 200;
    const panelW = 380, panelH = 152;
    const panelX = (this.cameras.main.width - panelW) / 2;
    const panelY = this.cameras.main.height - panelH - 10;
    const halfW = (panelW - 8) / 2; // 186 per side

    // Panel background
    const bg = this.add.rectangle(panelX + panelW / 2, panelY + panelH / 2,
      panelW, panelH, 0x111122, 0.95
    ).setDepth(depth).setStrokeStyle(2, 0x4466aa);
    this.forecastObjects.push(bg);

    // Draw attacker (left) and defender (right)
    this._drawForecastSide(panelX + 4, panelY, attacker, forecast.attacker, defender, true, depth);
    this._drawForecastSide(panelX + halfW + 8, panelY, defender, forecast.defender, attacker, false, depth);

    // Center divider + VS
    const divGfx = this.add.graphics().setDepth(depth + 1);
    divGfx.lineStyle(1, 0x444466);
    divGfx.lineBetween(panelX + panelW / 2, panelY + 8, panelX + panelW / 2, panelY + panelH - 22);
    this.forecastObjects.push(divGfx);

    const vs = this.add.text(panelX + panelW / 2, panelY + 28, 'VS', {
      fontFamily: 'monospace', fontSize: '9px', color: '#666688',
    }).setOrigin(0.5).setDepth(depth + 1);
    this.forecastObjects.push(vs);

    // Confirm hint bar
    const hintY = panelY + panelH - 18;
    const hintBg = this.add.rectangle(panelX + panelW / 2, hintY + 9,
      panelW - 4, 16, 0x0a0a15, 0.8
    ).setDepth(depth);
    this.forecastObjects.push(hintBg);
    const hintText = validWeapons.length >= 2
      ? 'Click confirm | \u25C4 \u25BA weapon | ESC cancel'
      : 'Click to confirm | ESC cancel';
    const hint = this.add.text(panelX + panelW / 2, hintY + 9, hintText, {
      fontFamily: 'monospace', fontSize: '9px', color: '#888888',
    }).setOrigin(0.5).setDepth(depth + 1);
    this.forecastObjects.push(hint);
  }

  hideForecast() {
    if (this.forecastObjects) {
      for (const obj of this.forecastObjects) obj.destroy();
      this.forecastObjects = null;
    }
    this.forecastTarget = null;
    this._forecastValidWeapons = null;
  }

  async executeCombat(attacker, defender) {
    this.battleState = 'COMBAT_RESOLVING';
    this.grid.clearAttackHighlights();

    const dist = gridDistance(attacker.col, attacker.row, defender.col, defender.row);
    const atkTerrain = this.grid.getTerrainAt(attacker.col, attacker.row);
    const defTerrain = this.grid.getTerrainAt(defender.col, defender.row);
    const skillCtx = this.buildSkillCtx(attacker, defender);

    const result = resolveCombat(
      attacker, attacker.weapon,
      defender, defender.weapon,
      dist, atkTerrain, defTerrain,
      skillCtx
    );

    // Animate each event (strikes + skill activations)
    for (const event of result.events) {
      if (event.type === 'skill') {
        await this.animateSkillActivation(event);
      } else {
        await this.animateStrike(event, attacker, defender);
      }
    }

    // Apply final HP (Sol heals etc. may differ from per-strike tracking)
    attacker.currentHP = result.attackerHP;
    defender.currentHP = result.defenderHP;

    // Debug: invincibility â€” restore player units to full HP
    if (DEBUG_MODE && debugState.invincible) {
      if (attacker.faction === 'player') { attacker.currentHP = attacker.stats.HP; result.attackerDied = false; }
      if (defender.faction === 'player') { defender.currentHP = defender.stats.HP; result.defenderDied = false; }
    }

    this.updateHPBar(attacker);
    this.updateHPBar(defender);

    // Show poison damage if applicable
    if (result.poisonEffects?.length > 0) {
      for (const pe of result.poisonEffects) {
        const poisonUnit = pe.target === 'defender' ? defender : attacker;
        await this.showPoisonDamage(poisonUnit, pe.damage);
      }
    }

    // Award XP to player attacker if they survived
    if (attacker.faction === 'player' && !result.attackerDied) {
      await this.awardXP(attacker, defender, result.defenderDied);
    }

    // Remove dead units
    if (result.defenderDied) {
      this.removeUnit(defender);
    }
    if (result.attackerDied) {
      this.removeUnit(attacker);
    }

    // Check battle end
    if (this.checkBattleEnd()) return;

    if (result.attackerDied) {
      // Attacker died â€” skip finishUnitAction
      this.selectedUnit = null;
      this.battleState = 'PLAYER_IDLE';
      this.grid.clearAttackHighlights();
      this.attackTargets = [];
      return;
    }

    // Commander's Gambit: attacker + nearby allies act again
    if (!attacker._gambitUsedThisTurn) {
      const gambitTriggered = result.events.some(e =>
        e.skillActivations?.some(s => s.id === 'commanders_gambit')
      );
      if (gambitTriggered) {
        attacker._gambitUsedThisTurn = true;
        const unitsToRefresh = [attacker];
        for (const ally of this.playerUnits) {
          if (ally === attacker || ally.currentHP <= 0) continue;
          if (gridDistance(attacker.col, attacker.row, ally.col, ally.row) <= 1) {
            unitsToRefresh.push(ally);
          }
        }
        for (const u of unitsToRefresh) {
          u.hasActed = false;
          u.hasMoved = false;
          u._movementSpent = 0;
          if (u.graphic?.clearTint) u.graphic.clearTint();
        }
        this.selectedUnit = null;
        this.battleState = 'PLAYER_IDLE';
        this.grid.clearAttackHighlights();
        this.attackTargets = [];
        return;
      }
    }

    // Finish action (attacker survived)
    this.finishUnitAction(attacker);
  }

  animateStrike(event, attacker, defender) {
    return new Promise(resolve => {
      // Determine who is striking and who is receiving
      const striker = event.attacker === attacker.name ? attacker : defender;
      const target = event.attacker === attacker.name ? defender : attacker;

      // Show per-strike skill activation text (Sol, Luna, Lethality)
      if (event.skillActivations?.length) {
        const names = event.skillActivations.map(s => s.name).join(', ');
        const sPos = this.grid.gridToPixel(striker.col, striker.row);
        const skillText = this.add.text(sPos.x, sPos.y - 24, names, {
          fontFamily: 'monospace', fontSize: '10px', color: '#88ffff',
          fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(301);
        this.tweens.add({
          targets: skillText, y: sPos.y - 40, alpha: 0,
          duration: 700, onComplete: () => skillText.destroy(),
        });
      }

      // Flash striker white + weapon SFX
      if (striker.graphic.setTint) striker.graphic.setTint(0xffffff);
      const audio = this.registry.get('audio');
      if (audio && !event.miss) {
        audio.playSFX(this.getWeaponSFX(striker));
      }

      this.time.delayedCall(120, () => {
        // Restore striker
        if (striker.graphic.clearTint) striker.graphic.clearTint();

        if (event.miss) {
          // Show "MISS" text
          const pos = this.grid.gridToPixel(target.col, target.row);
          const missText = this.add.text(pos.x, pos.y - 16, 'MISS', {
            fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa',
            fontStyle: 'bold',
          }).setOrigin(0.5).setDepth(300);

          this.tweens.add({
            targets: missText, y: pos.y - 32, alpha: 0,
            duration: 500, onComplete: () => missText.destroy(),
          });
        } else {
          // Flash target red and show damage
          if (target.graphic.setTint) target.graphic.setTint(0xff4444);
          const audio2 = this.registry.get('audio');
          if (audio2) audio2.playSFX(event.isCrit ? 'sfx_crit' : 'sfx_hit');
          const pos = this.grid.gridToPixel(target.col, target.row);

          const dmgStr = event.isCrit ? `${event.damage}!` : `${event.damage}`;
          const dmgColor = event.isCrit ? '#ffff00' : '#ffffff';
          const dmgText = this.add.text(pos.x, pos.y - 16, dmgStr, {
            fontFamily: 'monospace', fontSize: '13px', color: dmgColor,
            fontStyle: 'bold',
          }).setOrigin(0.5).setDepth(300);

          this.tweens.add({
            targets: dmgText, y: pos.y - 32, alpha: 0,
            duration: 600, onComplete: () => dmgText.destroy(),
          });

          // Update HP bar live
          target.currentHP = event.targetHPAfter;
          this.updateHPBar(target);

          // Sol heal â€” show heal on striker
          if (event.heal > 0 && event.strikerHealTo !== undefined) {
            striker.currentHP = event.strikerHealTo;
            this.updateHPBar(striker);
            const sPos = this.grid.gridToPixel(striker.col, striker.row);
            const healText = this.add.text(sPos.x + 12, sPos.y - 8, `+${event.heal}`, {
              fontFamily: 'monospace', fontSize: '11px', color: '#44ff44',
              fontStyle: 'bold',
            }).setOrigin(0.5).setDepth(300);
            this.tweens.add({
              targets: healText, y: sPos.y - 28, alpha: 0,
              duration: 600, onComplete: () => healText.destroy(),
            });
          }

          this.time.delayedCall(150, () => {
            if (target.graphic.clearTint) target.graphic.clearTint();
          });
        }
      });

      // Resolve after animation time
      this.time.delayedCall(400, resolve);
    });
  }

  /** Animate a skill activation event (Vantage, Astra banner) */
  animateSkillActivation(event) {
    return new Promise(resolve => {
      const text = this.add.text(
        this.cameras.main.centerX, this.cameras.main.centerY - 40,
        `${event.unit} â€” ${event.name}!`,
        {
          fontFamily: 'monospace', fontSize: '14px', color: '#88ffff',
          backgroundColor: '#000000cc', padding: { x: 10, y: 4 },
        }
      ).setOrigin(0.5).setDepth(500).setAlpha(0);

      this.tweens.add({
        targets: text, alpha: 1, duration: 150,
        yoyo: true, hold: 400,
        onComplete: () => { text.destroy(); resolve(); },
      });
    });
  }

  /** Flash a brief tooltip when auto-switching from Staff to combat weapon. */
  showAutoSwitchTooltip(unit, weapon) {
    if (!unit.graphic) return;
    const pos = this.grid.gridToPixel(unit.col, unit.row);
    const text = this.add.text(pos.x, pos.y - 20, `Switched to ${weapon.name}`, {
      fontFamily: 'monospace', fontSize: '10px', color: '#88ccff',
      backgroundColor: '#000000cc', padding: { x: 4, y: 2 },
    }).setOrigin(0.5).setDepth(301);
    this.tweens.add({
      targets: text, alpha: 0, y: pos.y - 36,
      duration: 1200, delay: 400,
      onComplete: () => text.destroy(),
    });
  }

  /** Show poison damage floating text. */
  showPoisonDamage(unit, damage) {
    return new Promise(resolve => {
      if (!unit.graphic) { resolve(); return; }
      const pos = this.grid.gridToPixel(unit.col, unit.row);
      const text = this.add.text(pos.x, pos.y - 16, `Poison -${damage}`, {
        fontFamily: 'monospace', fontSize: '11px', color: '#cc66ff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(301);
      this.updateHPBar(unit);
      this.tweens.add({
        targets: text, y: pos.y - 32, alpha: 0,
        duration: 600, onComplete: () => { text.destroy(); resolve(); },
      });
    });
  }

  /** Award XP to a player unit after combat. Shows floating text + level-up popups. */
  async awardXP(playerUnit, opponent, opponentDied) {
    const xp = calculateCombatXP(playerUnit, opponent, opponentDied);

    // Show floating XP text
    const pos = this.grid.gridToPixel(playerUnit.col, playerUnit.row);
    const xpText = this.add.text(pos.x, pos.y - 20, `+${xp} XP`, {
      fontFamily: 'monospace', fontSize: '12px', color: '#88ccff', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(300);

    this.tweens.add({
      targets: xpText, y: pos.y - 44, alpha: 0,
      duration: 800, onComplete: () => xpText.destroy(),
    });

    // Apply XP and check for level-ups
    const result = gainExperience(playerUnit, xp);

    // Show level-up popups sequentially
    for (const lvUp of result.levelUps) {
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_levelup');
      // Update HP bar after level-up (maxHP may have increased)
      this.updateHPBar(playerUnit);
      // Check for new skills learned at this level
      const learnedIds = checkLevelUpSkills(playerUnit, this.gameData.classes);
      const learnedNames = learnedIds.map(id => {
        const skill = this.gameData.skills.find(s => s.id === id);
        return skill ? skill.name : id;
      });
      const popup = new LevelUpPopup(this, playerUnit, lvUp, false, learnedNames);
      await popup.show();
    }
  }

  removeUnit(unit) {
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_death');
    this.removeUnitGraphic(unit);
    // Splice in-place so TurnManager's reference stays valid
    if (unit.faction === 'player') {
      const idx = this.playerUnits.indexOf(unit);
      if (idx !== -1) this.playerUnits.splice(idx, 1);
    } else if (unit.faction === 'npc') {
      const idx = this.npcUnits.indexOf(unit);
      if (idx !== -1) this.npcUnits.splice(idx, 1);
    } else {
      const idx = this.enemyUnits.indexOf(unit);
      if (idx !== -1) this.enemyUnits.splice(idx, 1);
      // Track gold earned from enemy kills
      if (this.runManager) {
        this.goldEarned += calculateKillGold(unit);
      }
    }
    this.dangerZoneStale = true;
    // Detect boss death on seize maps â€” show prominent notification
    if (unit.isBoss && unit.faction === 'enemy' && this.battleConfig.objective === 'seize') {
      this._showBossDefeatedBanner();
    }
    this.updateObjectiveText();
  }

  // --- Phase management ---

  onPhaseChange(phase, turn) {
    this.showPhaseBanner(phase, turn);
    this.dangerZoneStale = true;
    this.dangerZone.hide();

    if (phase === 'player') {
      // Reset player units for new turn
      for (const u of this.playerUnits) {
        u.hasMoved = false;
        u.hasActed = false;
        u._gambitUsedThisTurn = false;
        this.undimUnit(u);
      }
      this.battleState = 'PLAYER_IDLE';

      // Update turn counter at start of each player phase
      if (this.turnCounterText && this.turnPar !== null) {
        const rating = getRating(turn, this.turnPar, this.turnBonusConfig);
        const colors = { S: '#44ff44', A: '#88ccff', B: '#ffaa55', C: '#cc3333' };
        this.turnCounterText.setText(`Turn: ${turn} / Par: ${this.turnPar} (${rating.rating})`);
        this.turnCounterText.setColor(colors[rating.rating] || '#e0e0e0');
      } else if (this.turnCounterText) {
        this.turnCounterText.setText(`Turn: ${turn}`);
        this.turnCounterText.setColor('#e0e0e0');
      }

      // Update fog of war at start of player phase
      if (this.grid.fogEnabled) {
        this.grid.updateFogOfWar(this.playerUnits);
        this.updateEnemyVisibility();
      }

      // Process turn-start skill effects (after banner settles)
      this.time.delayedCall(1200, () => this.processTurnStartSkills(this.playerUnits));

      // Tutorial hints (after phase banner fades)
      const hints = this.registry.get('hints');
      if (hints && turn === 1) {
        this.time.delayedCall(1500, async () => {
          if (hints.shouldShow('battle_first_turn')) {
            await showImportantHint(this, 'Click a blue unit to move, then choose an action.\nRight-click any unit to inspect.');
          }
          if (this.npcUnits.length > 0 && hints.shouldShow('battle_recruit')) {
            await showImportantHint(this, 'Move a Lord adjacent to the green NPC\nand select Talk to recruit them!');
          }
          if (this.battleParams.objective === 'seize' && hints.shouldShow('battle_seize')) {
            await showImportantHint(this, 'Defeat the boss, then move a Lord\nto the throne and select Seize!');
          }
        });
      } else if (hints && turn === 2) {
        this.time.delayedCall(1500, () => {
          if (hints.shouldShow('battle_danger_zone')) {
            showMinorHint(this, 'Press [D] to show enemy threat range.');
          }
        });
      }
    } else if (phase === 'enemy') {
      this.battleState = 'ENEMY_PHASE';
      // Terrain healing for enemies, then start AI
      this.time.delayedCall(1400, async () => {
        await this.processTerrainHealing(this.enemyUnits);
        this.startEnemyPhase();
      });
    }
  }

  /** Apply turn-start skill effects (e.g. Renewal Aura healing) */
  async processTurnStartSkills(units) {
    const effects = getTurnStartEffects(units, this.gameData.skills);
    for (const effect of effects) {
      if (effect.type === 'heal' && effect.amount > 0) {
        effect.target.currentHP = Math.min(
          effect.target.stats.HP,
          effect.target.currentHP + effect.amount
        );
        this.updateHPBar(effect.target);
        await this.animateHeal(effect.target, effect.amount);
      }
    }
    // Terrain healing (Fort/Throne) after skill effects
    await this.processTerrainHealing(units);
  }

  /** Heal units standing on Fort or Throne at turn start */
  async processTerrainHealing(units) {
    for (const unit of units) {
      if (unit.currentHP >= unit.stats.HP) continue;
      const terrainIdx = this.grid.mapLayout[unit.row]?.[unit.col];
      if (terrainIdx !== TERRAIN.Fort && terrainIdx !== TERRAIN.Throne) continue;
      const healAmount = Math.max(1, Math.floor(unit.stats.HP * TERRAIN_HEAL_PERCENT));
      unit.currentHP = Math.min(unit.stats.HP, unit.currentHP + healAmount);
      this.updateHPBar(unit);
      await this.animateHeal(unit, healAmount);
    }
  }

  async startEnemyPhase() {
    // Debug: skip enemy phase entirely
    if (DEBUG_MODE && this._debugSkipEnemyPhase) {
      this._debugSkipEnemyPhase = false;
      if (this.battleState !== 'BATTLE_END') this.turnManager.endEnemyPhase();
      return;
    }

    await this.aiController.processEnemyPhase(
      this.enemyUnits,
      this.playerUnits,
      this.npcUnits,
      {
        onMoveUnit: (enemy, path) => this.animateEnemyMove(enemy, path),
        onAttack: (enemy, target) => this.executeEnemyCombat(enemy, target),
        onUnitDone: (enemy) => {
          enemy.hasActed = true;
          this.dimUnit(enemy);
        },
      }
    );

    // End enemy phase (skip if battle already ended during combat)
    if (this.battleState !== 'BATTLE_END') {
      this.turnManager.endEnemyPhase();
    }
  }

  animateEnemyMove(enemy, path) {
    return new Promise(resolve => {
      if (!path || path.length < 2) {
        resolve();
        return;
      }

      const targets = enemy.label
        ? [enemy.graphic, enemy.label]
        : [enemy.graphic];

      const animateStep = (stepIndex) => {
        if (stepIndex >= path.length) {
          const dest = path[path.length - 1];
          enemy.col = dest.col;
          enemy.row = dest.row;
          this.updateUnitPosition(enemy);
          if (this.grid.fogEnabled) this.updateEnemyVisibility();
          resolve();
          return;
        }
        const pos = this.grid.gridToPixel(path[stepIndex].col, path[stepIndex].row);
        this.tweens.add({
          targets,
          x: pos.x, y: pos.y,
          duration: 80,
          ease: 'Linear',
          onComplete: () => animateStep(stepIndex + 1),
        });
      };
      animateStep(1);
    });
  }

  async executeEnemyCombat(enemy, target) {
    const dist = gridDistance(enemy.col, enemy.row, target.col, target.row);
    const atkTerrain = this.grid.getTerrainAt(enemy.col, enemy.row);
    const defTerrain = this.grid.getTerrainAt(target.col, target.row);
    const skillCtx = this.buildSkillCtx(enemy, target);

    const result = resolveCombat(
      enemy, enemy.weapon,
      target, target.weapon,
      dist, atkTerrain, defTerrain,
      skillCtx
    );

    // Animate events
    for (const event of result.events) {
      if (event.type === 'skill') {
        await this.animateSkillActivation(event);
      } else {
        await this.animateStrike(event, enemy, target);
      }
    }

    // Apply final HP
    enemy.currentHP = result.attackerHP;
    target.currentHP = result.defenderHP;

    // Debug: invincibility â€” restore player units to full HP
    if (DEBUG_MODE && debugState.invincible) {
      if (target.faction === 'player') { target.currentHP = target.stats.HP; result.defenderDied = false; }
    }

    this.updateHPBar(enemy);
    this.updateHPBar(target);

    // Show poison damage if applicable
    if (result.poisonEffects?.length > 0) {
      for (const pe of result.poisonEffects) {
        const poisonUnit = pe.target === 'defender' ? target : enemy;
        await this.showPoisonDamage(poisonUnit, pe.damage);
      }
    }

    // Award XP to player defender if they survived
    if (target.faction === 'player' && !result.defenderDied) {
      await this.awardXP(target, enemy, result.attackerDied);
    }

    if (result.defenderDied) {
      this.removeUnit(target);
    }
    if (result.attackerDied) {
      this.removeUnit(enemy);
    }
    this.checkBattleEnd();
  }

  showPhaseBanner(phase, turn) {
    const label = phase === 'player' ? 'Player Phase' : 'Enemy Phase';
    const color = phase === 'player' ? '#3366cc' : '#cc3333';
    const banner = this.add.text(
      this.cameras.main.centerX, this.cameras.main.centerY,
      `Turn ${turn} - ${label}`,
      {
        fontFamily: 'monospace', fontSize: '20px', color,
        backgroundColor: '#000000cc', padding: { x: 16, y: 8 },
      }
    ).setOrigin(0.5).setAlpha(0).setDepth(500);

    this.tweens.add({
      targets: banner, alpha: 1, duration: 300,
      yoyo: true, hold: 800,
      onComplete: () => banner.destroy(),
    });
  }

  _showBossDefeatedBanner() {
    const banner = this.add.text(
      this.cameras.main.centerX, this.cameras.main.centerY - 30,
      'Boss defeated!\nSeize the throne with a Lord!',
      {
        fontFamily: 'monospace', fontSize: '18px', color: '#66ff66',
        backgroundColor: '#000000dd', padding: { x: 16, y: 8 },
        align: 'center',
      }
    ).setOrigin(0.5).setAlpha(0).setDepth(500);

    this.tweens.add({
      targets: banner, alpha: 1, duration: 400,
      yoyo: true, hold: 1800,
      onComplete: () => banner.destroy(),
    });

    // Pulse the objective text to draw attention
    if (this.objectiveText) {
      this.tweens.add({
        targets: this.objectiveText,
        scaleX: 1.15, scaleY: 1.15, duration: 300,
        yoyo: true, repeat: 2, ease: 'Sine.easeInOut',
      });
    }
  }

  // --- Win/lose ---

  checkBattleEnd() {
    // Edric defeat = immediate loss (permadeath rule â€” other lords can fall)
    const edricAlive = this.playerUnits.some(u => u.name === 'Edric');
    if (!edricAlive || this.playerUnits.length === 0) {
      this.onDefeat();
      return true;
    }
    // Rout: all enemies dead = victory
    if (this.battleConfig.objective === 'rout' && this.enemyUnits.length === 0) {
      this.onVictory();
      return true;
    }
    // Seize victory triggers via action menu 'Seize' button
    return false;
  }

  updateObjectiveText() {
    if (!this.objectiveText) return;
    let label;
    let color = '#ffdd44'; // default gold
    if (this.battleConfig.objective === 'seize') {
      const bossAlive = this.enemyUnits.some(u => u.isBoss);
      if (bossAlive) {
        label = 'Seize: Defeat boss, then capture throne';
        color = '#ff6666'; // red â€” boss still alive
      } else {
        label = 'Seize: Capture throne with a Lord!';
        color = '#66ff66'; // green â€” ready to seize
      }
    } else {
      label = `Rout: ${this.enemyUnits.length} enemies remaining`;
    }
    if (this.npcUnits.length > 0) {
      label += '\nRecruit: Talk to green unit';
    }
    this.objectiveText.setText(label);
    this.objectiveText.setColor(color);
  }

  calculateDangerZone() {
    const threatened = new Set();
    for (const enemy of this.enemyUnits) {
      if (this.grid.fogEnabled && !this.grid.isVisible(enemy.col, enemy.row)) continue;
      const positions = this.buildUnitPositionMap(enemy.faction);
      const moveRange = this.grid.getMovementRange(
        enemy.col, enemy.row, enemy.mov || enemy.stats.MOV,
        enemy.moveType, positions, enemy.faction
      );
      for (const [key] of moveRange) {
        const [mc, mr] = key.split(',').map(Number);
        // Get attack tiles from this position based on enemy weapon
        if (enemy.weapon) {
          const atkTiles = this.grid.getAttackRange(mc, mr, enemy.weapon);
          for (const t of atkTiles) {
            threatened.add(`${t.col},${t.row}`);
          }
        }
      }
    }
    return Array.from(threatened).map(k => {
      const [col, row] = k.split(',').map(Number);
      return { col, row };
    });
  }

  /** Hide/show enemy and NPC graphics based on fog visibility. */
  updateEnemyVisibility() {
    if (!this.grid.fogEnabled) return;
    for (const enemy of this.enemyUnits) {
      const vis = this.grid.isVisible(enemy.col, enemy.row);
      if (enemy.graphic) enemy.graphic.setVisible(vis);
      if (enemy.label) enemy.label.setVisible(vis);
      if (enemy.factionIndicator) enemy.factionIndicator.setVisible(vis);
      if (enemy.hpBar) {
        enemy.hpBar.bg.setVisible(vis);
        enemy.hpBar.fill.setVisible(vis);
      }
    }
    for (const npc of this.npcUnits) {
      const vis = this.grid.isVisible(npc.col, npc.row);
      if (npc.graphic) npc.graphic.setVisible(vis);
      if (npc.label) npc.label.setVisible(vis);
      if (npc.factionIndicator) npc.factionIndicator.setVisible(vis);
      if (npc.hpBar) {
        npc.hpBar.bg.setVisible(vis);
        npc.hpBar.fill.setVisible(vis);
      }
      // D1: Destroy recruit fog marker once NPC tile is in player vision
      if (vis && this.recruitFogMarker) {
        this.recruitFogMarker.destroy();
        this.recruitFogMarker = null;
      }
    }
  }

  onVictory() {
    if (this.battleState === 'BATTLE_END') return;
    this.battleState = 'BATTLE_END';
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.victory, this, 0);
    this.add.text(
      this.cameras.main.centerX, this.cameras.main.centerY,
      'VICTORY!',
      {
        fontFamily: 'monospace', fontSize: '28px', color: '#ffdd44',
        backgroundColor: '#000000dd', padding: { x: 24, y: 12 },
      }
    ).setOrigin(0.5).setDepth(600);

    if (this.runManager) {
      const surviving = this.playerUnits.map(u => serializeUnit(u));
      const allUnits = [...surviving, ...(this.nonDeployedUnits || [])];
      this.runManager.completeBattle(allUnits, this.nodeId, this.goldEarned);
      this.time.delayedCall(1500, () => {
        if (this.isBoss && !this.runManager.isRunComplete()) {
          this.showBossRecruitScreen();
        } else {
          this.showLootScreen();
        }
      });
    } else {
      // Standalone mode â€” restart battle after delay
      this.time.delayedCall(2000, () => {
        this.scene.restart();
      });
    }
  }

  /** Transition to the next scene after loot selection. */
  transitionAfterBattle() {
    if (this.isTransitioningOut) return;
    this.isTransitioningOut = true;
    try {
      if (this.runManager.isActComplete()) {
        if (this.runManager.isRunComplete()) {
          this.runManager.status = 'victory';
          this.scene.start('RunComplete', {
            gameData: this.gameData,
            runManager: this.runManager,
            result: 'victory',
          });
        } else {
          this.runManager.advanceAct();
          this.scene.start('NodeMap', {
            gameData: this.gameData,
            runManager: this.runManager,
          });
        }
      } else {
        this.scene.start('NodeMap', {
          gameData: this.gameData,
          runManager: this.runManager,
        });
      }
    } catch (err) {
      this.isTransitioningOut = false;
      this.reportLootError('transitionAfterBattle', err, {
        isElite: this.isElite,
        battleState: this.battleState,
        nodeId: this.nodeId,
      });
    }
  }

  /** Show boss recruit selection: pick 1 of 3 recruits or skip, then proceed to loot. */
  showBossRecruitScreen() {
    const candidates = generateBossRecruitCandidates(
      this.runManager.actIndex,
      this.runManager.roster,
      this.gameData,
      this.runManager.metaEffects
    );
    // Fallback to loot if no candidates generated
    if (!candidates || candidates.length === 0) {
      this.showLootScreen();
      return;
    }

    const audio = this.registry.get('audio');
    const recruitGroup = [];
    const cam = this.cameras.main;

    // Dark overlay
    const overlay = this.add.rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.85)
      .setDepth(700).setInteractive();
    recruitGroup.push(overlay);

    // Title
    const title = this.add.text(cam.centerX, 28, 'BOSS RECRUIT', {
      fontFamily: 'monospace', fontSize: '20px', color: '#ffdd44', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(701);
    recruitGroup.push(title);

    const subtitle = this.add.text(cam.centerX, 54, 'Choose a warrior to join your cause', {
      fontFamily: 'monospace', fontSize: '11px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(701);
    recruitGroup.push(subtitle);

    // Card layout: candidates + skip
    const cardCount = candidates.length + 1;
    const cardW = 130;
    const cardH = 200;
    const gap = 14;
    const totalW = cardCount * cardW + (cardCount - 1) * gap;
    const startX = cam.centerX - totalW / 2 + cardW / 2;
    const cardY = cam.centerY + 20;

    // Helper to clean up and proceed to loot
    const cleanupAndLoot = () => {
      this.hideLootRoster();
      for (const obj of recruitGroup) obj.destroy();
      this.lootGroup = null;
      this.showLootScreen();
    };

    // Render candidate cards
    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      const cx = startX + i * (cardW + gap);
      const u = c.unit;

      const cardColor = c.isLord ? 0x443322 : 0x2a2a44;
      const strokeColor = c.isLord ? 0xffdd44 : 0x66aacc;
      const card = this.add.rectangle(cx, cardY, cardW, cardH, cardColor, 1)
        .setStrokeStyle(2, strokeColor).setDepth(701).setInteractive({ useHandCursor: true });
      recruitGroup.push(card);

      let yOff = cardY - cardH / 2 + 12;

      // Lord tag
      if (c.isLord) {
        const tag = this.add.text(cx, yOff, '[LORD]', {
          fontFamily: 'monospace', fontSize: '9px', color: '#ffdd44', fontStyle: 'bold',
        }).setOrigin(0.5).setDepth(702);
        recruitGroup.push(tag);
        yOff += 14;
      }

      // Name
      const name = this.add.text(cx, yOff, c.displayName, {
        fontFamily: 'monospace', fontSize: '12px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(702);
      recruitGroup.push(name);
      yOff += 16;

      // Class
      const cls = this.add.text(cx, yOff, u.className, {
        fontFamily: 'monospace', fontSize: '9px', color: '#aaaaaa',
      }).setOrigin(0.5).setDepth(702);
      recruitGroup.push(cls);
      yOff += 14;

      // Level
      const lvl = this.add.text(cx, yOff, `Lv ${u.level}`, {
        fontFamily: 'monospace', fontSize: '10px', color: '#66ddff',
      }).setOrigin(0.5).setDepth(702);
      recruitGroup.push(lvl);
      yOff += 16;

      // Separator
      const sep = this.add.text(cx, yOff, 'â”€â”€â”€â”€â”€â”€â”€â”€â”€', {
        fontFamily: 'monospace', fontSize: '8px', color: '#555555',
      }).setOrigin(0.5).setDepth(702);
      recruitGroup.push(sep);
      yOff += 12;

      // Key stats
      const statColor = { HP: '#88ff88', STR: '#ff8888', MAG: '#aa88ff', SPD: '#ffff88', DEF: '#88bbff', RES: '#cc88ff' };
      const useMag = (u.stats.MAG || 0) > (u.stats.STR || 0);
      const displayStats = ['HP', useMag ? 'MAG' : 'STR', 'SPD', 'DEF'];
      for (const stat of displayStats) {
        const val = u.stats[stat] || 0;
        const line = this.add.text(cx, yOff, `${stat}: ${val}`, {
          fontFamily: 'monospace', fontSize: '9px', color: statColor[stat] || '#cccccc',
        }).setOrigin(0.5).setDepth(702);
        recruitGroup.push(line);
        yOff += 12;
      }
      yOff += 4;

      // Weapon proficiencies
      if (u.proficiencies && u.proficiencies.length > 0) {
        const profStr = u.proficiencies.map(p => {
          const short = { Sword: 'Swd', Lance: 'Lnc', Axe: 'Axe', Bow: 'Bow', Tome: 'Tome', Light: 'Lgt', Staff: 'Stf' };
          return `${short[p.type] || p.type}(${p.rank[0]})`;
        }).join(' ');
        const prof = this.add.text(cx, yOff, profStr, {
          fontFamily: 'monospace', fontSize: '7px', color: '#888888',
        }).setOrigin(0.5).setDepth(702);
        recruitGroup.push(prof);
        yOff += 12;
      }

      // Personal skill for lords
      if (c.isLord && u.skills && u.skills.length > 0) {
        const skillName = u.skills[0];
        const sk = this.add.text(cx, yOff, skillName, {
          fontFamily: 'monospace', fontSize: '7px', color: '#ffdd44',
          wordWrap: { width: cardW - 10 }, align: 'center',
        }).setOrigin(0.5).setDepth(702);
        recruitGroup.push(sk);
      }

      // Click handler
      card.on('pointerdown', () => {
        if (audio) audio.playSFX('sfx_confirm');
        this.runManager.roster.push(c.unit);
        cleanupAndLoot();
      });

      // Hover effect
      card.on('pointerover', () => card.setStrokeStyle(3, 0xffffff));
      card.on('pointerout', () => card.setStrokeStyle(2, strokeColor));
    }

    // Skip card
    const skipX = startX + candidates.length * (cardW + gap);
    const skipCard = this.add.rectangle(skipX, cardY, cardW, cardH, 0x333333, 1)
      .setStrokeStyle(2, 0x666666).setDepth(701).setInteractive({ useHandCursor: true });
    recruitGroup.push(skipCard);

    const skipIcon = this.add.text(skipX, cardY - 30, '>', {
      fontFamily: 'monospace', fontSize: '28px', color: '#888888', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(702);
    recruitGroup.push(skipIcon);

    const skipLabel = this.add.text(skipX, cardY + 10, 'SKIP', {
      fontFamily: 'monospace', fontSize: '14px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(702);
    recruitGroup.push(skipLabel);

    const skipDesc = this.add.text(skipX, cardY + 35, 'Continue\nto Loot', {
      fontFamily: 'monospace', fontSize: '9px', color: '#777777', align: 'center',
    }).setOrigin(0.5).setDepth(702);
    recruitGroup.push(skipDesc);

    skipCard.on('pointerdown', () => {
      if (audio) audio.playSFX('sfx_confirm');
      cleanupAndLoot();
    });
    skipCard.on('pointerover', () => skipCard.setStrokeStyle(3, 0xffffff));
    skipCard.on('pointerout', () => skipCard.setStrokeStyle(2, 0x666666));

    // Footer hints
    const inst = this.add.text(cam.centerX, cardY + cardH / 2 + 24, 'Choose a recruit to add to your roster', {
      fontFamily: 'monospace', fontSize: '11px', color: '#888888',
    }).setOrigin(0.5).setDepth(701);
    recruitGroup.push(inst);

    const hintText = this.add.text(cam.centerX, cardY + cardH / 2 + 42, '[R] Roster', {
      fontFamily: 'monospace', fontSize: '9px', color: '#666666',
    }).setOrigin(0.5).setDepth(701);
    recruitGroup.push(hintText);

    // Store for R key / cleanup
    this.lootGroup = recruitGroup;
  }

  /** Show post-battle loot selection. Normal: pick 1 of 3. Elite: pick 2 of 4. */
  showLootScreen() {
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.loot, this, 300);
    const lootGroup = [];
    const cam = this.cameras.main;

    // Elite pick-2 state
    this._elitePicksRemaining = this.isElite ? ELITE_MAX_PICKS : 1;
    this._lootCards = [];
    this._lootResolving = false;
    this._lootCleanedUp = false;

    // Dark overlay
    const overlay = this.add.rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.85)
      .setDepth(700).setInteractive();
    lootGroup.push(overlay);

    // Title
    const titleText = this.isElite ? 'ELITE BATTLE REWARDS' : 'BATTLE REWARDS';
    const title = this.add.text(cam.centerX, 30, titleText, {
      fontFamily: 'monospace', fontSize: '20px', color: '#ffdd44', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(701);
    lootGroup.push(title);

    // Calculate turn bonus gold
    let turnBonusGold = 0;
    let turnRating = null;
    if (this.turnPar != null && this.turnBonusConfig) {
      const result = getRating(this.turnManager.turnNumber, this.turnPar, this.turnBonusConfig);
      turnRating = result.rating;
      turnBonusGold = calculateBonusGold(result, this.runManager.currentAct, this.turnBonusConfig);
    }
    const totalGold = this.goldEarned + GOLD_BATTLE_BONUS + turnBonusGold;

    // Gold summary with breakdown
    const goldLines = [`Battle: ${this.goldEarned}G`, `Completion: ${GOLD_BATTLE_BONUS}G`];
    if (turnBonusGold > 0) {
      goldLines.push(`Turn ${turnRating}: +${turnBonusGold}G`);
    }
    goldLines.push(`Total: ${totalGold}G  |  Vault: ${this.runManager.gold}G`);

    const goldText = this.add.text(cam.centerX, 58, goldLines.join('  |  '), {
      fontFamily: 'monospace', fontSize: '12px', color: '#aaffaa',
    }).setOrigin(0.5).setDepth(701);
    lootGroup.push(goldText);

    // Tutorial hint for loot screen
    const hints = this.registry.get('hints');
    if (hints?.shouldShow('battle_loot')) {
      const hintMsg = this.isElite
        ? 'Elite battle! Choose 2 rewards. Press [R] for roster.'
        : 'Choose one reward. Weapons equip to a unit. Press [R] for roster.';
      showMinorHint(this, hintMsg);
    }

    // Generate loot choices
    const lootWeaponBonus = this.runManager?.metaEffects?.lootWeaponWeightBonus || 0;
    const lootCount = this.isElite ? ELITE_LOOT_CHOICES : LOOT_CHOICES;
    const choices = generateLootChoices(
      this.runManager.currentAct,
      this.gameData.lootTables,
      this.gameData.weapons,
      this.gameData.consumables,
      lootCount,
      lootWeaponBonus,
      this.gameData.accessories,
      this.gameData.whetstones,
      this.runManager.roster,
      this.isBoss,
      null,
      this.isElite
    );

    // Skip bonus gold
    const skipGold = calculateSkipLootBonus(totalGold);

    // Render cards: loot choices + 1 skip (dynamic sizing for 4 or 5 cards)
    const totalCards = choices.length + 1;
    const cardW = totalCards <= 4 ? 120 : 100;
    const cardH = 160;
    const gap = totalCards <= 4 ? 16 : 12;
    const totalW = totalCards * cardW + (totalCards - 1) * gap;
    const startX = cam.centerX - totalW / 2 + cardW / 2;
    const cardY = cam.centerY + 10;

    const typeIcons = { weapon: 'W', consumable: 'H', rare: 'R', gold: '$', accessory: 'A', forge: 'F' };
    const typeColors = { weapon: '#88bbff', consumable: '#88ff88', rare: '#ffaa55', gold: '#ffdd44', accessory: '#cc88ff', forge: '#ff8844' };

    for (let i = 0; i < choices.length; i++) {
      const choice = choices[i];
      const cx = startX + i * (cardW + gap);
      const cardIdx = i; // capture for closure

      // Card background
      const cardColor = choice.type === 'forge' ? 0x443322 : 0x333355;
      const strokeColor = choice.type === 'forge' ? 0xff8844 : 0x8888cc;
      const card = this.add.rectangle(cx, cardY, cardW, cardH, cardColor, 1)
        .setStrokeStyle(2, strokeColor).setDepth(701).setInteractive({ useHandCursor: true });
      lootGroup.push(card);

      // Track card ref for elite pick-2 graying
      this._lootCards.push({ bg: card });

      // Type icon
      const icon = this.add.text(cx, cardY - 55, typeIcons[choice.type] || '?', {
        fontFamily: 'monospace', fontSize: '28px', color: typeColors[choice.type] || '#ffffff',
        fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(702);
      lootGroup.push(icon);

      if (choice.type === 'gold') {
        // Gold choice
        const goldLabel = this.add.text(cx, cardY + 5, `${choice.goldAmount}G`, {
          fontFamily: 'monospace', fontSize: '16px', color: '#ffdd44',
        }).setOrigin(0.5).setDepth(702);
        lootGroup.push(goldLabel);

        const typeLabel = this.add.text(cx, cardY + 35, 'Gold', {
          fontFamily: 'monospace', fontSize: '10px', color: '#aaaaaa',
        }).setOrigin(0.5).setDepth(702);
        lootGroup.push(typeLabel);

        card.on('pointerdown', () => {
          const audio = this.registry.get('audio');
          if (audio) { audio.playSFX('sfx_gold'); audio.playSFX('sfx_confirm'); }
          this.runManager.addGold(choice.goldAmount);
          this.finalizeLootPick(lootGroup, cardIdx);
        });
      } else if (choice.type === 'forge') {
        // Forge whetstone card
        const item = choice.item;
        const nameLines = this.wrapText(item.name, 12);
        const nameLabel = this.add.text(cx, cardY + 5, nameLines, {
          fontFamily: 'monospace', fontSize: '11px', color: '#ff8844',
          align: 'center',
        }).setOrigin(0.5).setDepth(702);
        lootGroup.push(nameLabel);

        // Detail line
        let detail = item.forgeStat === 'choice' ? 'Choose stat' :
          item.forgeStat === 'might' ? '+1 Might' :
          item.forgeStat === 'crit' ? '+5 Crit' :
          item.forgeStat === 'hit' ? '+5 Hit' : '-1 Weight';
        const detailLabel = this.add.text(cx, cardY + 35, detail, {
          fontFamily: 'monospace', fontSize: '9px', color: '#cc8844',
        }).setOrigin(0.5).setDepth(702);
        lootGroup.push(detailLabel);

        card.on('pointerdown', () => {
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_confirm');
          this.showForgeLootPicker(item, lootGroup, cardIdx);
        });
      } else {
        // Item choice (weapon, consumable, rare, accessory)
        const item = choice.item;
        const nameLines = this.wrapText(item.name, 12);
        const nameLabel = this.add.text(cx, cardY + 5, nameLines, {
          fontFamily: 'monospace', fontSize: '11px', color: '#ffffff',
          align: 'center',
        }).setOrigin(0.5).setDepth(702);
        lootGroup.push(nameLabel);

        const priceLabel = this.add.text(cx, cardY + 35, `${item.price || 0}G`, {
          fontFamily: 'monospace', fontSize: '10px', color: '#aaaaaa',
        }).setOrigin(0.5).setDepth(702);
        lootGroup.push(priceLabel);

        // Detail line (weapon might/range, consumable uses, stat boost, or accessory effects)
        let detail = '';
        let detailColor = '#999999';
        if (item.might !== undefined) detail = `Mt:${item.might} Hit:${item.hit}`;
        else if (item.type === 'Accessory') detail = this.getAccessoryDetailText(item);
        else if (item.effect === 'statBoost') { detail = `+${item.value} ${item.stat}`; detailColor = '#88ff88'; }
        else if (item.uses !== undefined) detail = `Uses: ${item.uses}`;
        if (detail) {
          const detailLabel = this.add.text(cx, cardY + 52, detail, {
            fontFamily: 'monospace', fontSize: '8px', color: detailColor,
            wordWrap: { width: cardW - 10 }, align: 'center',
          }).setOrigin(0.5, 0).setDepth(702);
          lootGroup.push(detailLabel);
        }

        card.on('pointerdown', () => {
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_confirm');

          if (item.type === 'Scroll') {
            // Path 1: Scrolls go directly to team pool (like accessories)
            if (!this.runManager.scrolls) this.runManager.scrolls = [];
            this.runManager.scrolls.push({ ...item });
            this.finalizeLootPick(lootGroup, cardIdx);
          } else if (choice.type === 'accessory') {
            // Path 2: Accessories go to team pool (existing code)
            if (!this.runManager.accessories) this.runManager.accessories = [];
            this.runManager.accessories.push({ ...item });
            this.finalizeLootPick(lootGroup, cardIdx);
          } else if (item.type === 'Consumable' && item.effect === 'statBoost') {
            // Path 3a: Stat boosters â†’ immediate apply via unit picker
            this.showStatBoostUnitPicker(item, lootGroup, cardIdx);
          } else if (item.type === 'Consumable') {
            // Path 3b: Regular consumables show dedicated picker with consumable limits
            this.showConsumableUnitPicker(item, lootGroup, cardIdx);
          } else {
            // Path 3c: Weapons/staves show standard picker with inventory limits
            this.showLootUnitPicker(item, lootGroup, cardIdx);
          }
        });
      }
    }

    // Skip card (always ends loot screen immediately)
    const skipX = startX + choices.length * (cardW + gap);
    const skipCard = this.add.rectangle(skipX, cardY, cardW, cardH, 0x554433, 1)
      .setStrokeStyle(2, 0xccaa44).setDepth(701).setInteractive({ useHandCursor: true });
    lootGroup.push(skipCard);

    const skipIcon = this.add.text(skipX, cardY - 55, '$', {
      fontFamily: 'monospace', fontSize: '28px', color: '#ffdd44', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(702);
    lootGroup.push(skipIcon);

    const skipLabel = this.add.text(skipX, cardY + 5, `+${skipGold}G`, {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffdd44',
    }).setOrigin(0.5).setDepth(702);
    lootGroup.push(skipLabel);

    const skipDesc = this.add.text(skipX, cardY + 35, 'Skip Loot', {
      fontFamily: 'monospace', fontSize: '10px', color: '#ccaa66',
    }).setOrigin(0.5).setDepth(702);
    lootGroup.push(skipDesc);

    skipCard.on('pointerdown', () => {
      const audio = this.registry.get('audio');
      if (audio) { audio.playSFX('sfx_gold'); audio.playSFX('sfx_confirm'); }
      this.runManager.addGold(skipGold);
      this.cleanupLootScreen(lootGroup);
    });

    // Instruction
    const instText = this.isElite ? 'Choose 2 rewards' : 'Choose a reward';
    const inst = this.add.text(cam.centerX, cardY + cardH / 2 + 24, instText, {
      fontFamily: 'monospace', fontSize: '12px', color: '#888888',
    }).setOrigin(0.5).setDepth(701);
    lootGroup.push(inst);
    this._lootInstruction = inst;

    const hintText = this.add.text(cam.centerX, cardY + cardH / 2 + 42, '[R] Roster  |  [ESC] Settings', {
      fontFamily: 'monospace', fontSize: '9px', color: '#666666',
    }).setOrigin(0.5).setDepth(701);
    lootGroup.push(hintText);

    this.lootGroup = lootGroup;
  }

  /** Format accessory effects for loot card display. */
  getAccessoryDetailText(item) {
    const parts = [];
    // Stat effects
    if (item.effects) {
      const stats = Object.entries(item.effects);
      if (stats.length > 0) {
        const grouped = stats.map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${k}`);
        parts.push(grouped.join('/'));
      }
    }
    // Combat effects
    if (item.combatEffects) {
      const desc = {
        'Wrath Band':     '+15 Crit <50% HP',
        'Counter Seal':   'Block double attacks',
        'Pursuit Ring':   'Double at +3 SPD',
        'Nullify Ring':   'Negate effectiveness',
        'Life Ring':      '+3 Atk/+2 Def >75% HP',
        'Forest Charm':   '+10 Avo/+2 Def (forest)',
      };
      parts.push(desc[item.name] || 'Combat effect');
    }
    return parts.join('\n');
  }

  /** Simple text wrapping helper. */
  wrapText(text, maxChars) {
    if (text.length <= maxChars) return text;
    const words = text.split(' ');
    let lines = [];
    let line = '';
    for (const word of words) {
      if (line.length + word.length + 1 > maxChars && line.length > 0) {
        lines.push(line);
        line = word;
      } else {
        line = line ? line + ' ' + word : word;
      }
    }
    if (line) lines.push(line);
    return lines.join('\n');
  }

  /** Show forge loot picker: unit â†’ weapon â†’ (stat for Silver). */
  showForgeLootPicker(whetstone, lootGroup, cardIdx) {
    for (const obj of lootGroup) obj.setVisible(false);

    const pickerGroup = [];
    const cam = this.cameras.main;
    const roster = this.runManager.roster;

    const bg = this.add.rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.9)
      .setDepth(710).setInteractive();
    pickerGroup.push(bg);

    const title = this.add.text(cam.centerX, 60, `Apply ${whetstone.name}`, {
      fontFamily: 'monospace', fontSize: '16px', color: '#ff8844',
    }).setOrigin(0.5).setDepth(711);
    pickerGroup.push(title);

    const subtitle = this.add.text(cam.centerX, 82, 'Select a unit:', {
      fontFamily: 'monospace', fontSize: '11px', color: '#aaaaaa',
    }).setOrigin(0.5).setDepth(711);
    pickerGroup.push(subtitle);

    const btnW = 240;
    const topY = 110;
    const bottomY = cam.height - 70;
    const rowGap = Math.max(26, Math.min(42, Math.floor((bottomY - topY) / Math.max(roster.length, 1))));
    const btnH = Math.max(22, rowGap - 8);
    let validCount = 0;

    for (let i = 0; i < roster.length; i++) {
      const unit = roster[i];
      const forgeableCount = unit.inventory.filter(w =>
        whetstone.forgeStat !== 'choice' ? canForgeStat(w, whetstone.forgeStat) : canForge(w)
      ).length;
      const by = topY + i * rowGap;

      if (forgeableCount === 0) {
        const label = this.add.text(cam.centerX, by, `${unit.name}  (no forgeable weapons)`, {
          fontFamily: 'monospace', fontSize: '11px', color: '#666666',
        }).setOrigin(0.5).setDepth(712);
        pickerGroup.push(label);
        continue;
      }

      validCount++;
      const btn = this.add.rectangle(cam.centerX, by, btnW, btnH, 0x443322, 1)
        .setStrokeStyle(1, 0xff8844).setDepth(711).setInteractive({ useHandCursor: true });
      pickerGroup.push(btn);

      const label = this.add.text(cam.centerX, by, `${unit.name}  (${forgeableCount} weapon${forgeableCount > 1 ? 's' : ''})`, {
        fontFamily: 'monospace', fontSize: '11px', color: '#e0e0e0',
      }).setOrigin(0.5).setDepth(712);
      pickerGroup.push(label);

      btn.on('pointerdown', () => {
        try {
          for (const obj of pickerGroup) obj.destroy();
          this.showForgeWeaponPicker(whetstone, unit, lootGroup, cardIdx);
        } catch (err) {
          this.reportLootError('showForgeLootPicker:unitSelect', err, {
            unit: unit?.name,
            whetstone: whetstone?.name,
          });
          for (const obj of pickerGroup) obj.destroy();
          for (const obj of lootGroup) obj.setVisible(true);
        }
      });
    }

    if (validCount === 0) {
      const noWeapons = this.add.text(cam.centerX, cam.centerY + 10, 'No forgeable weapons in roster!', {
        fontFamily: 'monospace', fontSize: '12px', color: '#ff8888',
      }).setOrigin(0.5).setDepth(711);
      pickerGroup.push(noWeapons);
    }

    // Back button
    const backBtn = this.add.text(cam.centerX, cam.height - 24, '< Back', {
      fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa',
      backgroundColor: '#333333', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(711).setInteractive({ useHandCursor: true });
    pickerGroup.push(backBtn);

    backBtn.on('pointerdown', () => {
      for (const obj of pickerGroup) obj.destroy();
      for (const obj of lootGroup) obj.setVisible(true);
    });
  }

  /** Step 2: pick which weapon to forge. */
  showForgeWeaponPicker(whetstone, unit, lootGroup, cardIdx) {
    const pickerGroup = [];
    const cam = this.cameras.main;

    const bg = this.add.rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.9)
      .setDepth(710).setInteractive();
    pickerGroup.push(bg);

    const title = this.add.text(cam.centerX, 60, `${unit.name}: Select weapon to forge`, {
      fontFamily: 'monospace', fontSize: '14px', color: '#ff8844',
    }).setOrigin(0.5).setDepth(711);
    pickerGroup.push(title);

    const forgeableWeapons = unit.inventory.filter(w =>
      whetstone.forgeStat !== 'choice' ? canForgeStat(w, whetstone.forgeStat) : canForge(w)
    );
    const topY = 110;
    const bottomY = cam.height - 70;
    const rowGap = Math.max(30, Math.min(48, Math.floor((bottomY - topY) / Math.max(forgeableWeapons.length, 1))));
    const btnH = Math.max(24, rowGap - 8);

    for (let i = 0; i < forgeableWeapons.length; i++) {
      const wpn = forgeableWeapons[i];
      const level = wpn._forgeLevel || 0;
      const by = topY + i * rowGap;
      const wpnColor = isForged(wpn) ? '#44ff88' : '#e0e0e0';

      const btn = this.add.rectangle(cam.centerX, by, 280, btnH, 0x443322, 1)
        .setStrokeStyle(1, 0xff8844).setDepth(711).setInteractive({ useHandCursor: true });
      pickerGroup.push(btn);

      const label = this.add.text(cam.centerX, by - Math.floor(btnH * 0.22), wpn.name, {
        fontFamily: 'monospace', fontSize: '12px', color: wpnColor,
      }).setOrigin(0.5).setDepth(712);
      pickerGroup.push(label);

      const detail = this.add.text(cam.centerX, by + Math.floor(btnH * 0.28), `Mt:${wpn.might} Ht:${wpn.hit} Cr:${wpn.crit} Wt:${wpn.weight}  [${level}/${FORGE_MAX_LEVEL}]`, {
        fontFamily: 'monospace', fontSize: '9px', color: '#aaaaaa',
      }).setOrigin(0.5).setDepth(712);
      pickerGroup.push(detail);

      btn.on('pointerdown', () => {
        try {
          for (const obj of pickerGroup) obj.destroy();
          if (whetstone.forgeStat === 'choice') {
            // Silver Whetstone: pick stat
            this.showForgeStatPickerLoot(whetstone, wpn, lootGroup, cardIdx);
          } else {
            // Specific whetstone: apply immediately
            const result = applyForge(wpn, whetstone.forgeStat);
            if (!result.success) {
              this.reportLootError('showForgeWeaponPicker:applyForgeFailed', new Error('applyForge returned success=false'), {
                unit: unit?.name,
                weapon: wpn?.name,
                forgeStat: whetstone?.forgeStat,
                cardIdx,
              });
              this.showLootStatus('Forge failed. Choose another weapon.', '#ff8888');
              this.showForgeLootPicker(whetstone, lootGroup, cardIdx);
              return;
            }
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_gold');
            this.finalizeLootPick(lootGroup, cardIdx);
          }
        } catch (err) {
          this.reportLootError('showForgeWeaponPicker:pointerdown', err, {
            unit: unit?.name,
            weapon: wpn?.name,
            forgeStat: whetstone?.forgeStat,
            cardIdx,
          });
          this.showLootStatus('An error occurred while forging. Returning to rewards.', '#ff8888');
          for (const obj of lootGroup) obj.setVisible(true);
        }
      });
    }

    // Back button
    const backBtn = this.add.text(cam.centerX, cam.height - 24, '< Back', {
      fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa',
      backgroundColor: '#333333', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(711).setInteractive({ useHandCursor: true });
    pickerGroup.push(backBtn);

    backBtn.on('pointerdown', () => {
      for (const obj of pickerGroup) obj.destroy();
      this.showForgeLootPicker(whetstone, lootGroup, cardIdx);
    });
  }

  /** Step 3 (Silver Whetstone only): pick which stat to forge. */
  showForgeStatPickerLoot(whetstone, weapon, lootGroup, cardIdx) {
    const pickerGroup = [];
    const cam = this.cameras.main;

    const bg = this.add.rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.9)
      .setDepth(710).setInteractive();
    pickerGroup.push(bg);

    const title = this.add.text(cam.centerX, 100, `Forge ${weapon.name}: Choose stat`, {
      fontFamily: 'monospace', fontSize: '14px', color: '#ff8844',
    }).setOrigin(0.5).setDepth(711);
    pickerGroup.push(title);

    const stats = [
      { key: 'might', label: '+1 Might' },
      { key: 'crit', label: '+5 Crit' },
      { key: 'hit', label: '+5 Hit' },
      { key: 'weight', label: '-1 Weight' },
    ];

    const startY = 160;
    const btnH = 40;

    for (let i = 0; i < stats.length; i++) {
      const stat = stats[i];
      const statCount = getStatForgeCount(weapon, stat.key);
      const atStatCap = statCount >= FORGE_STAT_CAP;
      const by = startY + i * (btnH + 10);
      const color = atStatCap ? '#666666' : '#e0e0e0';
      const countLabel = atStatCap ? 'MAX' : `(${statCount}/${FORGE_STAT_CAP})`;

      const btn = this.add.rectangle(cam.centerX, by, 240, btnH, atStatCap ? 0x332222 : 0x443322, 1)
        .setStrokeStyle(1, atStatCap ? 0x666666 : 0xff8844).setDepth(711);
      pickerGroup.push(btn);

      const label = this.add.text(cam.centerX, by, `${stat.label}  ${countLabel}`, {
        fontFamily: 'monospace', fontSize: '13px', color,
      }).setOrigin(0.5).setDepth(712);
      pickerGroup.push(label);

      if (!atStatCap) {
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerdown', () => {
          applyForge(weapon, stat.key);
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          for (const obj of pickerGroup) obj.destroy();
          this.finalizeLootPick(lootGroup, cardIdx);
        });
      }
    }

    // Back button
    const backBtn = this.add.text(cam.centerX, startY + stats.length * (btnH + 10) + 20, '< Back', {
      fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa',
      backgroundColor: '#333333', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(711).setInteractive({ useHandCursor: true });
    pickerGroup.push(backBtn);

    backBtn.on('pointerdown', () => {
      for (const obj of pickerGroup) obj.destroy();
      this.showForgeLootPicker(whetstone, lootGroup, cardIdx);
    });
  }

  /** Show unit picker to give a loot item to a roster unit. */
  showLootUnitPicker(item, lootGroup, cardIdx) {
    // Hide loot cards temporarily
    for (const obj of lootGroup) obj.setVisible(false);

    const pickerGroup = [];
    const cam = this.cameras.main;

    const bg = this.add.rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.9)
      .setDepth(710).setInteractive();
    pickerGroup.push(bg);

    const title = this.add.text(cam.centerX, 80, `Give ${item.name} to:`, {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(711);
    pickerGroup.push(title);

    const roster = this.runManager.roster;
    const btnW = 200;
    const topY = 130;
    const bottomY = cam.height - 70;
    const rowGap = Math.max(34, Math.min(62, Math.floor((bottomY - topY) / Math.max(roster.length, 1))));
    const btnH = Math.max(24, rowGap - 12);

    for (let i = 0; i < roster.length; i++) {
      const unit = roster[i];
      const invCount = unit.inventory ? unit.inventory.length : 0;
      const full = invCount >= INVENTORY_MAX;
      const noProf = !hasProficiency(unit, item);
      const by = topY + i * rowGap;

      const btnColor = full ? 0x444444 : (noProf ? 0x554433 : 0x335566);
      const borderColor = full ? 0x666666 : (noProf ? 0xcc8844 : 0x66aacc);
      const btn = this.add.rectangle(cam.centerX, by, btnW, btnH, btnColor, 1)
        .setStrokeStyle(2, borderColor).setDepth(711);
      if (!full) btn.setInteractive({ useHandCursor: true });
      pickerGroup.push(btn);

      const nameColor = full ? '#666666' : (noProf ? '#cc8844' : '#ffffff');
      const label = this.add.text(cam.centerX, by - Math.floor(btnH * 0.22), unit.name + (noProf ? '  (no prof)' : ''), {
        fontFamily: 'monospace', fontSize: '13px', color: nameColor,
      }).setOrigin(0.5).setDepth(712);
      pickerGroup.push(label);

      const statusText = full ? 'Inventory full' : `${invCount}/${INVENTORY_MAX} items`;
      const invLabel = this.add.text(cam.centerX, by + Math.floor(btnH * 0.28), statusText, {
        fontFamily: 'monospace', fontSize: '9px', color: full ? '#aa4444' : '#aaaaaa',
      }).setOrigin(0.5).setDepth(712);
      pickerGroup.push(invLabel);

      if (!full) {
        btn.on('pointerdown', () => {
          addToInventory(unit, { ...item });
          for (const obj of pickerGroup) obj.destroy();
          this.finalizeLootPick(lootGroup, cardIdx);
        });
      }
    }

    // Back button
    const backBtn = this.add.text(cam.centerX, cam.height - 24, '< Back', {
      fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa',
      backgroundColor: '#333333', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(711).setInteractive({ useHandCursor: true });
    pickerGroup.push(backBtn);

    backBtn.on('pointerdown', () => {
      for (const obj of pickerGroup) obj.destroy();
      for (const obj of lootGroup) obj.setVisible(true);
    });
  }

  /** Show unit picker for consumables with separate limit checking. */
  showStatBoostUnitPicker(item, lootGroup, cardIdx) {
    // Hide loot cards temporarily
    for (const obj of lootGroup) obj.setVisible(false);

    const pickerGroup = [];
    const cam = this.cameras.main;

    const bg = this.add.rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.9)
      .setDepth(710).setInteractive();
    pickerGroup.push(bg);

    const title = this.add.text(cam.centerX, 80, `Use ${item.name} (+${item.value} ${item.stat}) on:`, {
      fontFamily: 'monospace', fontSize: '16px', color: '#88ff88',
    }).setOrigin(0.5).setDepth(711);
    pickerGroup.push(title);

    const roster = this.runManager.roster;
    const btnW = 200;
    const topY = 130;
    const bottomY = cam.height - 70;
    const rowGap = Math.max(34, Math.min(62, Math.floor((bottomY - topY) / Math.max(roster.length, 1))));
    const btnH = Math.max(24, rowGap - 12);

    for (let i = 0; i < roster.length; i++) {
      const unit = roster[i];
      const currentVal = unit.stats[item.stat] || 0;
      const by = topY + i * rowGap;

      const btn = this.add.rectangle(cam.centerX, by, btnW, btnH, 0x335566, 1)
        .setStrokeStyle(2, 0x66aacc).setDepth(711).setInteractive({ useHandCursor: true });
      pickerGroup.push(btn);

      const label = this.add.text(cam.centerX, by - Math.floor(btnH * 0.22), unit.name, {
        fontFamily: 'monospace', fontSize: '13px', color: '#ffffff',
      }).setOrigin(0.5).setDepth(712);
      pickerGroup.push(label);

      const statLabel = this.add.text(cam.centerX, by + Math.floor(btnH * 0.28), `${item.stat}: ${currentVal} â†’ ${currentVal + item.value}`, {
        fontFamily: 'monospace', fontSize: '9px', color: '#88ff88',
      }).setOrigin(0.5).setDepth(712);
      pickerGroup.push(statLabel);

      btn.on('pointerdown', () => {
        applyStatBoost(unit, item);
        const audio = this.registry.get('audio');
        if (audio) audio.playSFX('sfx_gold');
        for (const obj of pickerGroup) obj.destroy();
        this.finalizeLootPick(lootGroup, cardIdx);
      });
    }

    // Back button
    const backBtn = this.add.text(cam.centerX, cam.height - 24, '< Back', {
      fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa',
      backgroundColor: '#333333', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(711).setInteractive({ useHandCursor: true });
    pickerGroup.push(backBtn);

    backBtn.on('pointerdown', () => {
      for (const obj of pickerGroup) obj.destroy();
      for (const obj of lootGroup) obj.setVisible(true);
    });
  }

  showConsumableUnitPicker(item, lootGroup, cardIdx) {
    // Hide loot cards temporarily
    for (const obj of lootGroup) obj.setVisible(false);

    const pickerGroup = [];
    const cam = this.cameras.main;

    const bg = this.add.rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.9)
      .setDepth(710).setInteractive();
    pickerGroup.push(bg);

    const title = this.add.text(cam.centerX, 80, `Give ${item.name} to:`, {
      fontFamily: 'monospace', fontSize: '16px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(711);
    pickerGroup.push(title);

    const roster = this.runManager.roster;
    const btnW = 200;
    const topY = 130;
    const bottomY = cam.height - 70;
    const rowGap = Math.max(34, Math.min(62, Math.floor((bottomY - topY) / Math.max(roster.length, 1))));
    const btnH = Math.max(24, rowGap - 12);

    for (let i = 0; i < roster.length; i++) {
      const unit = roster[i];
      const consumableCount = unit.consumables ? unit.consumables.length : 0;
      const full = consumableCount >= CONSUMABLE_MAX;
      const by = topY + i * rowGap;

      const btn = this.add.rectangle(cam.centerX, by, btnW, btnH, full ? 0x444444 : 0x335566, 1)
        .setStrokeStyle(2, full ? 0x666666 : 0x66aacc).setDepth(711);
      if (!full) btn.setInteractive({ useHandCursor: true });
      pickerGroup.push(btn);

      const label = this.add.text(cam.centerX, by - Math.floor(btnH * 0.22), unit.name, {
        fontFamily: 'monospace', fontSize: '13px', color: full ? '#666666' : '#ffffff',
      }).setOrigin(0.5).setDepth(712);
      pickerGroup.push(label);

      const invLabel = this.add.text(cam.centerX, by + Math.floor(btnH * 0.28), full ? 'Consumables full' : `${consumableCount}/${CONSUMABLE_MAX} items`, {
        fontFamily: 'monospace', fontSize: '9px', color: full ? '#aa4444' : '#aaaaaa',
      }).setOrigin(0.5).setDepth(712);
      pickerGroup.push(invLabel);

      if (!full) {
        btn.on('pointerdown', () => {
          addToConsumables(unit, { ...item });
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          for (const obj of pickerGroup) obj.destroy();
          this.finalizeLootPick(lootGroup, cardIdx);
        });
      }
    }

    // Back button
    const backBtn = this.add.text(cam.centerX, cam.height - 24, '< Back', {
      fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa',
      backgroundColor: '#333333', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(711).setInteractive({ useHandCursor: true });
    pickerGroup.push(backBtn);

    backBtn.on('pointerdown', () => {
      for (const obj of pickerGroup) obj.destroy();
      for (const obj of lootGroup) obj.setVisible(true);
    });
  }

  /** Show compact read-only roster viewer during loot screen. */
  showLootRoster() {
    if (this.lootRosterVisible) return;
    this.lootRosterVisible = true;
    this.lootRosterGroup = [];
    const cam = this.cameras.main;
    const roster = this.runManager.roster;

    const panelW = 500;
    const lineH = 18;
    const headerH = 30;
    const panelH = headerH + roster.length * lineH + 16;
    const px = cam.centerX;
    const py = cam.centerY;

    const bg = this.add.rectangle(px, py, panelW, panelH, 0x111122, 0.95)
      .setStrokeStyle(2, 0x8888cc).setDepth(750).setInteractive();
    this.lootRosterGroup.push(bg);

    const title = this.add.text(px, py - panelH / 2 + 14, 'ROSTER', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffdd44', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(751);
    this.lootRosterGroup.push(title);

    const startY = py - panelH / 2 + headerH + 8;
    const leftX = px - panelW / 2 + 12;

    for (let i = 0; i < roster.length; i++) {
      const u = roster[i];
      const y = startY + i * lineH;
      const wpnName = u.weapon?.name || u.inventory?.[0]?.name || '-';
      const accName = u.accessory?.name || '-';
      const consumeNames = (u.consumables || []).map(c => c.name).join(', ') || '-';
      const invCount = (u.inventory || []).length;
      const line = `${u.name.padEnd(10)} ${u.className.padEnd(12)} Lv${String(u.level).padStart(2)} HP:${u.stats.HP}/${u.maxHP || u.stats.HP}  Wpn:${wpnName}  Acc:${accName}  Inv:${invCount}`;
      const txt = this.add.text(leftX, y, line, {
        fontFamily: 'monospace', fontSize: '9px', color: '#cccccc',
      }).setDepth(751);
      this.lootRosterGroup.push(txt);
    }

    const hint = this.add.text(px, py + panelH / 2 - 10, '[R] Close  |  [ESC] Close', {
      fontFamily: 'monospace', fontSize: '9px', color: '#888888',
    }).setOrigin(0.5).setDepth(751);
    this.lootRosterGroup.push(hint);
  }

  /** Hide loot roster viewer. */
  hideLootRoster() {
    if (!this.lootRosterVisible) return;
    this.lootRosterVisible = false;
    if (this.lootRosterGroup) {
      for (const obj of this.lootRosterGroup) obj.destroy();
      this.lootRosterGroup = null;
    }
  }

  /**
   * Unified exit path for all loot picks. Handles elite pick-2 counter.
   * Non-elite: immediate cleanup. Elite: gray out card, decrement, cleanup at 0.
   */
  finalizeLootPick(lootGroup, cardIndex) {
    if (this._lootResolving) return;
    if (!this.isElite || !this._elitePicksRemaining || this._elitePicksRemaining <= 1) {
      // Non-elite or last pick â€” clean up immediately
      this._lootResolving = true;
      this._lootCards = null;
      this._lootInstruction = null;
      // Defer cleanup/scene transition out of the current pointerdown stack.
      this.time.delayedCall(0, () => this.cleanupLootScreen(lootGroup));
      return;
    }

    this._elitePicksRemaining--;

    // Gray out the chosen card
    const cardRef = this._lootCards?.[cardIndex];
    if (cardRef?.bg) {
      cardRef.bg.setFillStyle(0x222222);
      cardRef.bg.setStrokeStyle(2, 0x444444);
      cardRef.bg.removeAllListeners('pointerdown');
      cardRef.bg.disableInteractive();
    }

    // Re-show loot cards (sub-pickers hide them)
    for (const obj of lootGroup) obj.setVisible(true);

    // Update instruction text
    if (this._lootInstruction) {
      this._lootInstruction.setText('Choose 1 more reward');
    }
  }

  /** Clean up loot screen and transition. */
  cleanupLootScreen(lootGroup) {
    if (this._lootCleanedUp) return;
    this._lootCleanedUp = true;
    this.hideLootRoster();
    if (this.lootSettingsOverlay) {
      this.lootSettingsOverlay.hide();
      this.lootSettingsOverlay = null;
    }
    const resolvedLootGroup = lootGroup || this.lootGroup || [];
    try {
      for (const obj of resolvedLootGroup) {
        try {
          if (obj && typeof obj.destroy === 'function') obj.destroy();
        } catch (objErr) {
          console.warn('[BattleScene][LootFlow] failed to destroy loot object', objErr);
        }
      }
      this.lootGroup = null;
      this.transitionAfterBattle();
    } catch (err) {
      this._lootResolving = false;
      this._lootCleanedUp = false;
      this.reportLootError('cleanupLootScreen', err, {
        isElite: this.isElite,
        picksRemaining: this._elitePicksRemaining,
      });
    }
  }

  showLootStatus(message, color = '#ff8888') {
    const cam = this.cameras.main;
    const status = this.add.text(cam.centerX, cam.height - 44, message, {
      fontFamily: 'monospace',
      fontSize: '10px',
      color,
      backgroundColor: '#000000cc',
      padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setDepth(799);
    this.time.delayedCall(1500, () => {
      if (status && status.active) status.destroy();
    });
  }

  reportLootError(context, err, extra = {}) {
    console.error('[BattleScene][LootFlow]', context, extra, err);
    this.showLootStatus('Loot error. Check console log.', '#ff8888');
  }

  onDefeat() {
    if (this.battleState === 'BATTLE_END') return;
    this.battleState = 'BATTLE_END';
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.defeat, this, 0);
    this.add.text(
      this.cameras.main.centerX, this.cameras.main.centerY,
      'DEFEAT',
      {
        fontFamily: 'monospace', fontSize: '28px', color: '#cc3333',
        backgroundColor: '#000000dd', padding: { x: 24, y: 12 },
      }
    ).setOrigin(0.5).setDepth(600);

    if (this.runManager) {
      this.runManager.failRun();
      this.time.delayedCall(2000, () => {
        this.scene.start('RunComplete', {
          gameData: this.gameData,
          runManager: this.runManager,
          result: 'defeat',
        });
      });
    } else {
      // Standalone mode â€” restart battle after delay
      this.time.delayedCall(2000, () => {
        this.scene.restart();
      });
    }
  }
}



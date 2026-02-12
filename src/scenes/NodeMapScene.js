// NodeMapScene — Visual node map with navigation + roster display

import Phaser from 'phaser';
import { RunManager, saveRun, clearSavedRun } from '../engine/RunManager.js';
import { ACT_CONFIG, NODE_TYPES, INVENTORY_MAX, CONSUMABLE_MAX, SHOP_REROLL_COST, SHOP_REROLL_ESCALATION, SHOP_FORGE_LIMITS, FORGE_MAX_LEVEL, FORGE_COSTS, FORGE_STAT_CAP, CHURCH_PROMOTE_COST } from '../utils/constants.js';
import { generateShopInventory, getSellPrice } from '../engine/LootSystem.js';
import {
  addToInventory,
  removeFromInventory,
  isLastCombatWeapon,
  hasProficiency,
  addToConsumables,
  canPromote,
  promoteUnit,
  resolvePromotionTargetClass,
} from '../engine/UnitManager.js';
import { canForge, canForgeStat, applyForge, isForged, getForgeCost, getStatForgeCount } from '../engine/ForgeSystem.js';
import { PauseOverlay } from '../ui/PauseOverlay.js';
import { SettingsOverlay } from '../ui/SettingsOverlay.js';
import { RosterOverlay } from '../ui/RosterOverlay.js';
import { MUSIC, getMusicKey, pickTrack } from '../utils/musicConfig.js';
import { pushRunSave, deleteRunSave } from '../cloud/CloudSync.js';
import { showImportantHint, showMinorHint } from '../ui/HintDisplay.js';
import { DEBUG_MODE } from '../utils/debugMode.js';
import { DebugOverlay } from '../ui/DebugOverlay.js';
import { startSceneLazy } from '../utils/sceneLoader.js';

// Layout constants
const MAP_TOP = 60;
const MAP_BOTTOM = 400;
const MAP_LEFT = 80;
const MAP_RIGHT = 560;
const ROSTER_Y = 440;
const NODE_SIZE = 24;

// Colors
const COLOR_BATTLE = 0xcc6633;
const COLOR_BOSS = 0xcc3333;
const COLOR_SHOP = 0xddaa33;
const COLOR_RECRUIT = 0x44ccaa;
const COLOR_CHURCH = 0xcccccc; // Light gray
const COLOR_ELITE = 0xcc5500; // Dark orange for elite seize battles
const COLOR_COMPLETED = 0x555555;
const COLOR_AVAILABLE = 0xffdd44;
const COLOR_EDGE = 0x666666;
const COLOR_EDGE_ACTIVE = 0xffdd44;
// Aura effects for special node types
const AURA_ELITE_COLOR = 0xcc2222;
const AURA_ELITE_RADIUS = 26;
const AURA_ELITE_ALPHA = [0.26, 0.62]; // [min, max] breathing range
const AURA_ELITE_DURATION = 900; // faster = menacing
const AURA_CHURCH_COLOR = 0xfff2d0; // warm, slightly whiter gold
const AURA_CHURCH_RADIUS = 28;
const AURA_CHURCH_ALPHA = [0.20, 0.55];
const AURA_CHURCH_DURATION = 1200; // slower = calming
const AURA_LOCKED_ALPHA_SCALE = 0.85; // visible but dim for locked nodes
const AURA_DEPTH = -1; // below nodes and edges
const NODE_DEPTH = 1; // keep nodes above aura layer
const SHOP_LIST_TOP_Y = 105;
const SHOP_LIST_BOTTOM_Y = 390;
const SHOP_SCROLL_STEP = 24;
const UNIT_PICKER_SCROLL_STEP = 30;

const OVERLAY_PANEL_W = 560;
const OVERLAY_PANEL_H = 440;
const OVERLAY_PANEL_DEPTH = 301;
const OVERLAY_CONTENT_DEPTH = 302;

const NODE_ICONS = {
  [NODE_TYPES.BATTLE]:  '\u2694',  // ⚔
  [NODE_TYPES.BOSS]:    '\u2620',  // ☠
  [NODE_TYPES.SHOP]:    '$',
  [NODE_TYPES.RECRUIT]: '!',
  [NODE_TYPES.CHURCH]:  '\u271D',  // ✝
};

const NODE_COLORS = {
  [NODE_TYPES.BATTLE]:  COLOR_BATTLE,
  [NODE_TYPES.BOSS]:    COLOR_BOSS,
  [NODE_TYPES.SHOP]:    COLOR_SHOP,
  [NODE_TYPES.RECRUIT]: COLOR_RECRUIT,
  [NODE_TYPES.CHURCH]:  COLOR_CHURCH,
};

export class NodeMapScene extends Phaser.Scene {
  constructor() {
    super('NodeMap');
  }

  init(data) {
    this.gameData = data.gameData || data;
    this.isTransitioning = false;
    this.isSceneReady = false;
    this.battleLaunchInFlight = false;
    const selectedDifficulty = data.difficultyId || this.registry.get('selectedDifficulty') || 'normal';
    if (data.runManager) {
      this.runManager = data.runManager;
      this.registry.set('selectedDifficulty', this.runManager.difficultyId || selectedDifficulty);
    } else {
      console.warn('NodeMapScene: no runManager provided, creating fallback (should not happen in normal flow)');
      const meta = this.registry.get('meta');
      const metaEffects = meta ? meta.getActiveEffects({
        weaponArtCatalog: this.gameData?.weaponArts?.arts || [],
      }) : null;
      this.runManager = new RunManager(this.gameData, metaEffects);
      this.runManager.startRun({ difficultyId: selectedDifficulty });
      this.registry.set('selectedDifficulty', this.runManager.difficultyId);
    }
  }

  create() {
    const audio = this.registry.get('audio');
    if (audio) {
      // Fire and forget; scene readiness gate below prevents early-click races.
      void audio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this);
    }

    this._bindInputHandlers();
    this.events.once('shutdown', () => this._onSceneShutdown());

    // Auto-save on every node map entry
    this.persistRunSave();

    this.pauseOverlay = null;
    this.settingsOverlay = null;
    this.rosterOverlay = null;
    this._touchTapDown = null;
    this._tapMoveThreshold = 12;
    this._touchScrollDrag = null;

    // Debug overlay (dev-only)
    if (DEBUG_MODE) {
      this.debugOverlay = new DebugOverlay(this);
      this.input.keyboard.addKey(192).on('down', () => {
        if (this.shopOverlay || this.rosterOverlay?.visible) return;
        this.debugOverlay.toggle();
      });
    }

    this.drawMap();
    this.input.enabled = false;
    void this.finalizeSceneReady();

    // Tutorial hint for node map
    const hints = this.registry.get('hints');
    if (hints?.shouldShow('nodemap_intro')) {
      showImportantHint(this, 'Choose your path. Battles give loot and gold.\nVillages let you buy, sell, and forge. Churches heal and promote.');
    }

    // HP persistence hint — show once after first battle return
    if (hints?.shouldShow('nodemap_hp_persist') && this.runManager.completedBattles >= 1) {
      showMinorHint(this, 'HP carries between battles. Visit Rest or Church nodes to heal.');
    }

  }

  _bindInputHandlers() {
    const input = this.input;
    const keyboard = input?.keyboard;

    // Idempotent unbind to avoid stacked listeners across scene lifecycles.
    this._unbindInputHandlers();

    this._onEsc = (event) => {
      if (event?.repeat) return;
      this.requestCancel();
    };
    this._onPointerDown = (pointer) => {
      this._touchTapDown = { x: pointer.x, y: pointer.y };
      this.onPointerDown(pointer);
    };
    this._onPointerMove = (pointer) => this.onPointerMove(pointer);
    this._onPointerUp = (pointer) => this.onPointerUp(pointer);
    this._onWheel = (pointer, gameObjects, deltaX, deltaY) => this.onWheel(pointer, deltaX, deltaY);

    if (keyboard?.on) keyboard.on('keydown-ESC', this._onEsc);
    if (input?.on) {
      input.on('pointerdown', this._onPointerDown);
      input.on('pointermove', this._onPointerMove);
      input.on('pointerup', this._onPointerUp);
      input.on('wheel', this._onWheel);
    }
  }

  _unbindInputHandlers() {
    const input = this.input;
    const keyboard = input?.keyboard;
    if (keyboard?.off && this._onEsc) keyboard.off('keydown-ESC', this._onEsc);
    if (input?.off) {
      if (this._onPointerDown) input.off('pointerdown', this._onPointerDown);
      if (this._onPointerMove) input.off('pointermove', this._onPointerMove);
      if (this._onPointerUp) input.off('pointerup', this._onPointerUp);
      if (this._onWheel) input.off('wheel', this._onWheel);
    }
  }

  _onSceneShutdown() {
    const audio = this.registry.get('audio');
    if (audio) audio.releaseMusic(this, 0);
    this._unbindInputHandlers();
  }

  async finalizeSceneReady() {
    try {
      // Give audio a short unlock window before we accept battle-node interactions.
      await this.ensureAudioUnlocked();
    } catch (_) {}
    if (this.sys?.isActive?.() === false) return;
    this.isSceneReady = true;
    if (this.input) this.input.enabled = true;
  }

  onPointerUp(pointer) {
    this._touchScrollDrag = null;
    if ((pointer.rightButtonDown && pointer.rightButtonDown()) || pointer.button === 2) return;
    if (pointer.pointerType === 'touch' && this._touchTapDown) {
      const dx = pointer.x - this._touchTapDown.x;
      const dy = pointer.y - this._touchTapDown.y;
      if ((dx * dx + dy * dy) > (this._tapMoveThreshold * this._tapMoveThreshold)) {
        this._touchTapDown = null;
        return;
      }
    }
    this._touchTapDown = null;
    if (this._isPointerOverInteractive(pointer)) return;
    this.requestCancel({ allowPause: false });
  }

  onPointerDown(pointer) {
    if (!pointer || pointer.pointerType !== 'touch') return;

    if (this.unitPickerState) {
      const state = this.unitPickerState;
      if (pointer.y >= state.viewportTop && pointer.y <= state.viewportBottom && (state.maxOffset || 0) > 0) {
        this._touchScrollDrag = {
          type: 'unit-picker',
          startY: pointer.y,
          startOffset: state.offset || 0,
        };
      }
      return;
    }

    if (!this.shopOverlay || !this.activeShopTab) return;
    if (this.forgePicker || this.unitPicker) return;
    if ((this.shopScrollMax || 0) <= 0) return;
    if (pointer.y < SHOP_LIST_TOP_Y || pointer.y > SHOP_LIST_BOTTOM_Y) return;
    this._touchScrollDrag = {
      type: 'shop',
      tab: this.activeShopTab,
      startY: pointer.y,
      startOffset: this.shopScrollOffsets?.[this.activeShopTab] || 0,
    };
  }

  onPointerMove(pointer) {
    if (!pointer || pointer.pointerType !== 'touch') return;
    const drag = this._touchScrollDrag;
    if (!drag) return;

    if (drag.type === 'unit-picker') {
      if (!this.unitPickerState) return;
      const max = this.unitPickerState.maxOffset || 0;
      if (max <= 0) return;
      const deltaY = pointer.y - drag.startY;
      const next = Phaser.Math.Clamp(drag.startOffset - deltaY, 0, max);
      if (next === this.unitPickerState.offset) return;
      this.unitPickerState.offset = next;
      this.renderUnitPicker();
      return;
    }

    if (drag.type === 'shop') {
      if (!this.shopOverlay || this.forgePicker || this.unitPicker) return;
      if (!this.activeShopTab || drag.tab !== this.activeShopTab) return;
      const max = this.shopScrollMax || 0;
      if (max <= 0) return;
      const deltaY = pointer.y - drag.startY;
      const next = Phaser.Math.Clamp(drag.startOffset - deltaY, 0, max);
      const current = this.shopScrollOffsets?.[drag.tab] || 0;
      if (next === current) return;
      this.shopScrollOffsets[drag.tab] = next;
      this.drawActiveTabContent();
    }
  }

  onWheel(pointer, deltaX, deltaY) {
    if (this.unitPickerState) {
      const step = Math.sign(deltaY || 0) * UNIT_PICKER_SCROLL_STEP;
      if (!step) return;
      const current = this.unitPickerState.offset || 0;
      const max = this.unitPickerState.maxOffset || 0;
      const next = Phaser.Math.Clamp(current + step, 0, max);
      if (next === current) return;
      this.unitPickerState.offset = next;
      this.renderUnitPicker();
      return;
    }

    if (!this.shopOverlay || !this.activeShopTab) return;
    if (this.forgePicker || this.unitPicker) return;
    if (!pointer) return;
    if (pointer.y < SHOP_LIST_TOP_Y || pointer.y > SHOP_LIST_BOTTOM_Y) return;
    if ((this.shopScrollMax || 0) <= 0) return;

    const step = Math.sign(deltaY || 0) * SHOP_SCROLL_STEP;
    if (!step) return;
    const key = this.activeShopTab;
    const current = this.shopScrollOffsets?.[key] || 0;
    const next = Phaser.Math.Clamp(current + step, 0, this.shopScrollMax || 0);
    if (next === current) return;
    this.shopScrollOffsets[key] = next;
    this.drawActiveTabContent();
  }

  _isPointerOverInteractive(pointer) {
    if (!this.input || !pointer) return false;
    let hit = [];
    if (typeof this.input.hitTestPointer === 'function') {
      hit = this.input.hitTestPointer(pointer) || [];
    } else if (this.input.manager?.hitTest) {
      hit = this.input.manager.hitTest(pointer, this.children.list, this.cameras.main) || [];
    }
    return Array.isArray(hit) && hit.some(obj =>
      obj
      && obj.visible !== false
      && obj.active !== false
      && obj.input?.enabled
    );
  }

  canRequestCancel({ allowPause = true } = {}) {
    if (DEBUG_MODE && this.debugOverlay?.visible) return true;
    if (this.forgePicker) return true;
    if (this.unitPicker || this.unitPickerState) return true;
    if (this.settingsOverlay?.visible) return true;
    if (this.rosterOverlay?.visible) return true;
    if (this.pauseOverlay?.visible) return true;
    if (this.shopOverlay) return true;
    if (this.churchOverlay) return true;
    if (allowPause) return true;
    return false;
  }

  requestCancel({ allowPause = true } = {}) {
    if (!this.canRequestCancel({ allowPause })) return false;
    if (DEBUG_MODE && this.debugOverlay?.visible) {
      this.debugOverlay.hide();
      return true;
    }
    if (this.forgePicker) {
      this.closeForgeStatPicker();
      return true;
    }
    if (this.unitPicker || this.unitPickerState) {
      this.closeUnitPicker();
      return true;
    }
    if (this.settingsOverlay?.visible) {
      this.settingsOverlay.hide();
      return true;
    }
    if (this.pauseOverlay?.visible) {
      this.pauseOverlay.hide();
      return true;
    }
    if (this.rosterOverlay?.visible) {
      this.rosterOverlay.hide();
      return true;
    }
    if (this.shopOverlay) {
      this.leaveShopNode();
      return true;
    }
    if (this.churchOverlay) {
      this.leaveChurchNode();
      return true;
    }
    if (allowPause) {
      this.showPauseMenu();
      return true;
    }
    return false;
  }

  persistRunSave() {
    const cloud = this.registry.get('cloud');
    const slot = this.registry.get('activeSlot');
    saveRun(this.runManager, cloud ? (d) => pushRunSave(cloud.userId, slot, d) : null);
  }

  showPauseMenu() {
    if (this.pauseOverlay?.visible) return;
    this.pauseOverlay = new PauseOverlay(this, {
      onResume: () => { this.pauseOverlay = null; },
      onSaveAndExit: () => {
        // Run is already auto-saved on NodeMap entry. Just navigate.
        const audio = this.registry.get('audio');
        if (audio) audio.stopMusic(this, 0);
        void startSceneLazy(this, 'Title', { gameData: this.gameData });
      },
      onAbandon: () => {
        const cloud = this.registry.get('cloud');
        const slot = this.registry.get('activeSlot');
        clearSavedRun(cloud ? () => deleteRunSave(cloud.userId, slot) : null);
        this.runManager.failRun();
        const audio = this.registry.get('audio');
        if (audio) audio.stopMusic(this, 0);
        void startSceneLazy(this, 'Title', { gameData: this.gameData });
      },
    });
    this.pauseOverlay.show();
  }

  drawMap() {
    // Clear everything
    this.children.removeAll(true);

    const rm = this.runManager;
    const nodeMap = rm.nodeMap;
    const actConfig = ACT_CONFIG[rm.currentAct];
    const availableNodes = rm.getAvailableNodes();
    const availableIds = new Set(availableNodes.map(n => n.id));

    // Title
    this.add.text(this.cameras.main.centerX, 20, `Act ${rm.actIndex + 1}: ${actConfig.name}`, {
      fontFamily: 'monospace', fontSize: '18px', color: '#ffdd44',
    }).setOrigin(0.5);

    // Gold display
    this.add.text(this.cameras.main.width - 20, 20, `${rm.gold}G`, {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffdd44',
    }).setOrigin(1, 0);

    // Difficulty label (non-Normal only, below gold)
    const diffLabel = rm.difficultyModifiers?.label || 'Normal';
    const diffColor = rm.difficultyModifiers?.color || '#44cc44';
    if (diffLabel !== 'Normal') {
      this.add.text(this.cameras.main.width - 20, 36, diffLabel, {
        fontFamily: 'monospace', fontSize: '10px', color: diffColor,
      }).setOrigin(1, 0);
    }

    // Gear icon — opens settings
    const gear = this.add.text(20, 16, '\u2699', {
      fontFamily: 'monospace', fontSize: '20px', color: '#888888',
    }).setInteractive({ useHandCursor: true });
    gear.on('pointerover', () => gear.setColor('#ffdd44'));
    gear.on('pointerout', () => gear.setColor('#888888'));
    gear.on('pointerdown', () => {
      if (this.settingsOverlay?.visible) return;
      this.settingsOverlay = new SettingsOverlay(this, () => { this.settingsOverlay = null; });
      this.settingsOverlay.show();
    });

    // Compute node positions — bottom-to-top (row 0 at bottom, boss at top)
    // X position is determined by column lane (fixed grid 0-4), not even distribution
    const totalRows = Math.max(...nodeMap.nodes.map(n => n.row)) + 1;
    const NUM_COLUMNS = 5; // Must match NodeMapGenerator.js
    const nodePositions = new Map();

    for (const node of nodeMap.nodes) {
      const yFrac = 1 - (node.row / Math.max(totalRows - 1, 1));
      const y = MAP_TOP + yFrac * (MAP_BOTTOM - MAP_TOP);
      // Use fixed column grid (0-4) to preserve column-lane spacing
      const xFrac = node.col / (NUM_COLUMNS - 1);
      const x = MAP_LEFT + xFrac * (MAP_RIGHT - MAP_LEFT);
      nodePositions.set(node.id, { x, y });
    }

    // Draw edges
    const graphics = this.add.graphics();
    for (const node of nodeMap.nodes) {
      const from = nodePositions.get(node.id);
      for (const edgeId of node.edges) {
        const to = nodePositions.get(edgeId);
        if (!from || !to) continue;
        const isActive = (node.completed && availableIds.has(edgeId)) ||
                         (rm.currentNodeId === null && node.id === nodeMap.startNodeId);
        graphics.lineStyle(2, isActive ? COLOR_EDGE_ACTIVE : COLOR_EDGE, isActive ? 0.8 : 0.4);
        graphics.lineBetween(from.x, from.y, to.x, to.y);
      }
    }

    // Draw nodes
    for (const node of nodeMap.nodes) {
      const pos = nodePositions.get(node.id);
      if (!pos) continue;

      const isAvailable = availableIds.has(node.id);
      const isCompleted = node.completed;
      const isLocked = !isAvailable && !isCompleted;
      const isEliteNode = node.type === NODE_TYPES.BATTLE && node.battleParams?.isElite;
      const isChurchNode = node.type === NODE_TYPES.CHURCH;

      let color;
      if (isCompleted) {
        color = COLOR_COMPLETED;
      } else if (isAvailable) {
        color = COLOR_AVAILABLE;
      } else if (isEliteNode) {
        color = COLOR_ELITE;
      } else {
        color = NODE_COLORS[node.type] || COLOR_BATTLE;
      }

      // Special node aura (elite/church). Completed nodes intentionally hide aura.
      if (!isCompleted && (isEliteNode || isChurchNode)) {
        const auraColor = isEliteNode ? AURA_ELITE_COLOR : AURA_CHURCH_COLOR;
        const auraRadius = isEliteNode ? AURA_ELITE_RADIUS : AURA_CHURCH_RADIUS;
        const auraAlphaRange = isEliteNode ? AURA_ELITE_ALPHA : AURA_CHURCH_ALPHA;
        const auraDuration = isEliteNode ? AURA_ELITE_DURATION : AURA_CHURCH_DURATION;
        const aura = this.add.circle(pos.x, pos.y, auraRadius, auraColor, auraAlphaRange[0])
          .setDepth(AURA_DEPTH);
        aura.setBlendMode(Phaser.BlendModes.ADD);

        if (isAvailable) {
          aura.setAlpha(auraAlphaRange[0]);
          this.tweens.add({
            targets: aura,
            alpha: auraAlphaRange[1],
            duration: auraDuration,
            yoyo: true,
            repeat: -1,
            ease: 'Sine.easeInOut',
          });
        } else if (isLocked) {
          // Static dim aura for locked nodes to reduce background motion noise.
          const lockedAlpha = isChurchNode
            ? Math.max(auraAlphaRange[0] * AURA_LOCKED_ALPHA_SCALE, 0.18)
            : Math.max(auraAlphaRange[0] * AURA_LOCKED_ALPHA_SCALE, 0.24);
          aura.setAlpha(lockedAlpha);
        }
      }

      // Node icon — use sprite if loaded, fall back to colored rectangle + unicode
      let spriteKey = node.type === NODE_TYPES.CHURCH ? 'node_rest' : `node_${node.type}`;
      // Elite seize battles use dark fortress sprite
      if (isEliteNode) {
        spriteKey = 'node_elite';
      }
      if (node.type === NODE_TYPES.BOSS) {
        const actId = this.runManager.nodeMap.actId;
        if (actId === 'finalBoss') spriteKey = 'node_boss_final';
      }
      let nodeObj;
      if (this.textures.exists(spriteKey)) {
        nodeObj = this.add.image(pos.x, pos.y, spriteKey)
          .setDisplaySize(NODE_SIZE + 8, NODE_SIZE + 8)
          .setDepth(NODE_DEPTH);
        if (isCompleted) nodeObj.setTint(0x555555);
        if (!isAvailable && !isCompleted) nodeObj.setAlpha(isEliteNode ? 0.75 : 0.5);
      } else {
        nodeObj = this.add.rectangle(pos.x, pos.y, NODE_SIZE, NODE_SIZE, color)
          .setStrokeStyle(2, isAvailable ? 0xffffff : 0x888888)
          .setDepth(NODE_DEPTH);
        const icon = NODE_ICONS[node.type] || '?';
        this.add.text(pos.x, pos.y, icon, {
          fontFamily: 'monospace', fontSize: '14px', color: isCompleted ? '#888888' : '#ffffff',
        }).setOrigin(0.5).setDepth(NODE_DEPTH + 1);
      }

      // Make available nodes interactive
      if (isAvailable) {
        nodeObj.setInteractive({ useHandCursor: true });

        // Pulse animation
        this.tweens.add({
          targets: nodeObj, scaleX: nodeObj.scaleX * 1.15, scaleY: nodeObj.scaleY * 1.15,
          duration: 600, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
        });

        nodeObj.on('pointerdown', () => this.onNodeClick(node));
        nodeObj.on('pointerover', () => this.showNodeTooltip(node, pos));
        nodeObj.on('pointerout', () => this.hideNodeTooltip());
      } else if (!isCompleted) {
        // Non-available, non-completed: hover tooltip for route planning (not clickable)
        nodeObj.setInteractive();
        nodeObj.on('pointerover', () => this.showNodeTooltip(node, pos));
        nodeObj.on('pointerout', () => this.hideNodeTooltip());
      }
    }

    // Roster bar
    this.drawRoster();

    // Roster button (bottom-right, near gear icon area)
    const rosterBtn = this.add.text(this.cameras.main.width - 20, MAP_BOTTOM + 14, '[ Roster ]', {
      fontFamily: 'monospace', fontSize: '12px', color: '#e0e0e0',
      backgroundColor: '#333333', padding: { x: 8, y: 4 },
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    rosterBtn.on('pointerover', () => rosterBtn.setColor('#ffdd44'));
    rosterBtn.on('pointerout', () => rosterBtn.setColor('#e0e0e0'));
    rosterBtn.on('pointerdown', () => {
      if (this.rosterOverlay?.visible) return;
      this.rosterOverlay = new RosterOverlay(this, this.runManager, this.gameData, {
        onClose: () => {
          this.rosterOverlay = null;
          // Auto-save after roster changes
          const cloud = this.registry.get('cloud');
          const slot = this.registry.get('activeSlot');
          saveRun(this.runManager, cloud ? (d) => pushRunSave(cloud.userId, slot, d) : null);
          this.drawMap(); // refresh roster bar
        },
      });
      this.rosterOverlay.show();
    });

    // Instructions
    this.add.text(this.cameras.main.centerX, MAP_BOTTOM + 20, 'Click a node to proceed', {
      fontFamily: 'monospace', fontSize: '11px', color: '#888888',
    }).setOrigin(0.5);
  }

  drawRoster() {
    const roster = this.runManager.roster;
    const startX = 40;
    const maxWidth = 560; // 640 - 40 margin on each side
    const spacing = Math.min(300, Math.floor(maxWidth / Math.max(roster.length, 1)));
    const compact = spacing < 160;

    for (let i = 0; i < roster.length; i++) {
      const unit = roster[i];
      if (!unit || !unit.stats) continue;
      const x = startX + i * spacing;

      // Name and class — truncate in compact mode
      const label = compact
        ? `${unit.name} Lv${unit.level}`
        : `${unit.name} Lv${unit.level} ${unit.className}`;
      this.add.text(x, ROSTER_Y, label, {
        fontFamily: 'monospace', fontSize: '12px', color: '#e0e0e0',
      });

      // HP bar — scale width with spacing
      const barWidth = Math.min(120, spacing - 20);
      const barHeight = 8;
      const barX = x;
      const barY = ROSTER_Y + 18;
      const ratio = unit.currentHP / unit.stats.HP;

      this.add.rectangle(barX + barWidth / 2, barY + barHeight / 2, barWidth, barHeight, 0x333333);
      const fillColor = ratio > 0.5 ? 0x44cc44 : ratio > 0.25 ? 0xcccc44 : 0xcc4444;
      this.add.rectangle(
        barX + (barWidth * ratio) / 2, barY + barHeight / 2,
        barWidth * ratio, barHeight, fillColor
      );

      // HP text (only if enough space)
      if (spacing >= 80) {
        this.add.text(barX + barWidth + 4, barY - 2, `${unit.currentHP}/${unit.stats.HP}`, {
          fontFamily: 'monospace', fontSize: '10px', color: '#aaaaaa',
        });
      }
    }
  }

  showNodeTooltip(node, pos) {
    this.hideNodeTooltip();
    let label;
    if (node.type === NODE_TYPES.BOSS) {
      label = 'Boss Battle (Seize)';
    } else if (node.type === NODE_TYPES.CHURCH) {
      label = 'Church — Heal, revive fallen, promote';
    } else if (node.type === NODE_TYPES.SHOP) {
      label = 'Village — Buy, sell, and forge';
    } else if (node.type === NODE_TYPES.RECRUIT) {
      label = 'Recruit — Battle with potential ally';
    } else if (node.battleParams?.isElite) {
      label = 'Elite Battle (Seize) — Harder fight, better loot';
    } else {
      const obj = node.battleParams?.objective || 'rout';
      label = `Battle (${obj})`;
    }
    if ((node.type === NODE_TYPES.BATTLE || node.type === NODE_TYPES.BOSS || node.type === NODE_TYPES.RECRUIT) && node.encounterLocked) {
      label += '\nEncounter Locked';
    }
    this.nodeTooltip = this.add.text(pos.x, pos.y - NODE_SIZE - 8, label, {
      fontFamily: 'monospace', fontSize: '10px', color: '#ffffff',
      backgroundColor: '#000000cc', padding: { x: 4, y: 2 },
    }).setOrigin(0.5, 1).setDepth(100);
    const halfW = this.nodeTooltip.width * 0.5;
    const margin = 6;
    const minX = halfW + margin;
    const maxX = this.cameras.main.width - halfW - margin;
    this.nodeTooltip.x = Phaser.Math.Clamp(this.nodeTooltip.x, minX, maxX);
  }

  hideNodeTooltip() {
    if (this.nodeTooltip) {
      this.nodeTooltip.destroy();
      this.nodeTooltip = null;
    }
  }

  onNodeClick(node) {
    if (this.isTransitioning) return;
    if (this.battleLaunchInFlight) return;
    if (!this.isSceneReady) return;
    if (this.shopOverlay || this.churchOverlay || this.rosterOverlay?.visible || this.pauseOverlay?.visible) return;
    if (node.type === NODE_TYPES.CHURCH) {
      this.handleChurch(node);
    } else if (node.type === NODE_TYPES.SHOP) {
      this.handleShop(node);
    } else {
      // Immediately lock node interactions before any async work begins.
      this.battleLaunchInFlight = true;
      this.isTransitioning = true;
      this.isSceneReady = false;
      if (this.input) this.input.enabled = false;
      void this.handleBattle(node);
    }
  }

  async handleBattle(node) {
    if (!this.battleLaunchInFlight) return;
    try {
      await this.ensureAudioUnlocked();
      const audio = this.registry.get('audio');
      if (audio) audio.releaseMusic(this, 0);

      const rm = this.runManager;
      const battleParams = rm.getBattleParams(node);
      const roster = rm.getRoster();
      const transitioned = await startSceneLazy(this, 'Battle', {
        gameData: this.gameData,
        runManager: rm,
        battleParams,
        roster,
        nodeId: node.id,
        isBoss: node.type === NODE_TYPES.BOSS,
        isElite: battleParams?.isElite || false,
      });
      if (transitioned === false) {
        this.battleLaunchInFlight = false;
        this.isTransitioning = false;
        this.isSceneReady = true;
        if (this.input) this.input.enabled = true;
        if (audio) void audio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this, 300);
      }
    } catch (err) {
      console.error('[NodeMapScene] Failed to start battle scene:', err);
      const audio = this.registry.get('audio');
      this.battleLaunchInFlight = false;
      this.isTransitioning = false;
      this.isSceneReady = true;
      if (this.input) this.input.enabled = true;
      if (audio) void audio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this, 300);
      this.showTransientMessage('Failed to enter battle. Please try again.', '#ff6666');
    }
  }

  async ensureAudioUnlocked(timeoutMs = 200) {
    const sound = this.sound;
    if (!sound?.locked) return;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        resolve();
      };
      if (typeof sound.once === 'function') {
        sound.once('unlocked', finish);
      }
      try {
        if (typeof sound.unlock === 'function') sound.unlock();
      } catch (_) {}
      this.time.delayedCall(timeoutMs, finish);
    });
  }

  handleChurch(node) {
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(pickTrack(MUSIC.rest), this, 300); // Peaceful music

    this.showChurchOverlay(node);
  }

  showChurchOverlay(node) {
    this.churchOverlay = [];
    this._churchNode = node;

    // Tutorial hint for church
    const hints = this.registry.get('hints');
    if (hints?.shouldShow('nodemap_church')) {
      showMinorHint(this, 'Heal, revive fallen allies, or promote units.');
    }

    // Dark overlay background
    const bg = this.add.rectangle(320, 240, 640, 480, 0x000000, 0.9).setDepth(300);
    this.churchOverlay.push(bg);

    // Centered panel container
    const panel = this.add.rectangle(320, 240, OVERLAY_PANEL_W, OVERLAY_PANEL_H, 0x111111, 0.95)
      .setDepth(OVERLAY_PANEL_DEPTH)
      .setStrokeStyle(2, 0x444444)
      .setInteractive();
    this.churchOverlay.push(panel);

    // Title
    const title = this.add.text(320, 40, 'Church', {
      fontFamily: 'monospace', fontSize: '22px', color: '#cccccc',
    }).setOrigin(0.5).setDepth(OVERLAY_CONTENT_DEPTH);
    this.churchOverlay.push(title);

    // Gold display
    this.churchGoldText = this.add.text(320, 70, `Gold: ${this.runManager.gold}G`, {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffdd44',
    }).setOrigin(0.5).setDepth(OVERLAY_CONTENT_DEPTH);
    this.churchOverlay.push(this.churchGoldText);

    const rm = this.runManager;
    let yOffset = 110;

    // Service 1: Heal All (Free)
    const healBtn = this.add.text(320, yOffset, '[ Heal All Units ] (Free)', {
      fontFamily: 'monospace', fontSize: '16px', color: '#44ff44',
      backgroundColor: '#222222', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(OVERLAY_CONTENT_DEPTH).setInteractive({ useHandCursor: true });
    healBtn.on('pointerover', () => healBtn.setBackgroundColor('#333333'));
    healBtn.on('pointerout', () => healBtn.setBackgroundColor('#222222'));
    healBtn.on('pointerdown', () => {
      for (const unit of rm.roster) {
        unit.currentHP = unit.stats.HP;
      }
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_heal');
      this.showChurchMessage('All units healed!', '#44ff44');
    });
    this.churchOverlay.push(healBtn);
    yOffset += 50;

    // Service 2: Revive Fallen Unit (1000g)
    if (rm.fallenUnits.length > 0) {
      const reviveLabel = this.add.text(320, yOffset, 'Revive Fallen Unit (1000G):', {
        fontFamily: 'monospace', fontSize: '14px', color: '#cccccc',
      }).setOrigin(0.5).setDepth(OVERLAY_CONTENT_DEPTH);
      this.churchOverlay.push(reviveLabel);
      yOffset += 25;

      for (const fallen of rm.fallenUnits) {
        const unitBtn = this.add.text(320, yOffset, `${fallen.name} (Lv${fallen.level} ${fallen.className})`, {
          fontFamily: 'monospace', fontSize: '14px', color: '#e0e0e0',
          backgroundColor: '#222222', padding: { x: 10, y: 4 },
        }).setOrigin(0.5).setDepth(OVERLAY_CONTENT_DEPTH).setInteractive({ useHandCursor: true });
        unitBtn.on('pointerover', () => {
          if (rm.gold >= 1000) unitBtn.setColor('#ffdd44');
          unitBtn.setBackgroundColor('#333333');
        });
        unitBtn.on('pointerout', () => {
          unitBtn.setColor('#e0e0e0');
          unitBtn.setBackgroundColor('#222222');
        });
        unitBtn.on('pointerdown', () => {
          if (rm.reviveFallenUnit(fallen.name, 1000)) {
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_heal');
            this.showChurchMessage(`${fallen.name} revived!`, '#44ff44');
            this.churchGoldText.setText(`Gold: ${rm.gold}G`);
            this.refreshChurchOverlay(node);
          } else {
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            this.showChurchMessage('Not enough gold or roster full!', '#ff4444');
          }
        });
        this.churchOverlay.push(unitBtn);
        yOffset += 30;
      }
      yOffset += 10;
    }

    // Service 3: Promote Unit
    const promoteLabel = this.add.text(320, yOffset, `Promote Unit (${CHURCH_PROMOTE_COST}G):`, {
      fontFamily: 'monospace', fontSize: '14px', color: '#cccccc',
    }).setOrigin(0.5).setDepth(OVERLAY_CONTENT_DEPTH);
    this.churchOverlay.push(promoteLabel);
    yOffset += 25;

    const eligibleUnits = rm.roster.filter(u => canPromote(u));
    if (eligibleUnits.length === 0) {
      const noneText = this.add.text(320, yOffset, '(No units eligible for promotion)', {
        fontFamily: 'monospace', fontSize: '12px', color: '#888888',
      }).setOrigin(0.5).setDepth(OVERLAY_CONTENT_DEPTH);
      this.churchOverlay.push(noneText);
    } else {
      for (const unit of eligibleUnits) {
        const unitBtn = this.add.text(320, yOffset, `${unit.name} (Lv${unit.level} ${unit.className})`, {
          fontFamily: 'monospace', fontSize: '14px', color: '#e0e0e0',
          backgroundColor: '#222222', padding: { x: 10, y: 4 },
        }).setOrigin(0.5).setDepth(OVERLAY_CONTENT_DEPTH).setInteractive({ useHandCursor: true });
        unitBtn.on('pointerover', () => {
          if (rm.gold >= CHURCH_PROMOTE_COST) unitBtn.setColor('#ffdd44');
          unitBtn.setBackgroundColor('#333333');
        });
        unitBtn.on('pointerout', () => {
          unitBtn.setColor('#e0e0e0');
          unitBtn.setBackgroundColor('#222222');
        });
        unitBtn.on('pointerdown', () => {
          if (rm.spendGold(CHURCH_PROMOTE_COST)) {
            const lordData = this.gameData.lords.find(l => l.name === unit.name);
            const promotedClassData = resolvePromotionTargetClass(unit, this.gameData.classes, this.gameData.lords);
            if (!promotedClassData) {
              rm.gold += CHURCH_PROMOTE_COST;
              const audio = this.registry.get('audio');
              if (audio) audio.playSFX('sfx_cancel');
              this.showChurchMessage('Promotion unavailable for this unit.', '#ff4444');
              return;
            }

            const promotionBonuses = lordData?.promotionBonuses || promotedClassData.promotionBonuses;
            if (!promotionBonuses) {
              rm.gold += CHURCH_PROMOTE_COST;
              const audio = this.registry.get('audio');
              if (audio) audio.playSFX('sfx_cancel');
              this.showChurchMessage('Promotion data missing.', '#ff4444');
              return;
            }

            promoteUnit(unit, promotedClassData, promotionBonuses, this.gameData.skills);

            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_levelup');
            this.showChurchMessage(`${unit.name} promoted to ${promotedClassData.name}!`, '#ffdd44');
            this.churchGoldText.setText(`Gold: ${rm.gold}G`);
            this.refreshChurchOverlay(node);
          } else {
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            this.showChurchMessage('Not enough gold!', '#ff4444');
          }
        });
        this.churchOverlay.push(unitBtn);
        yOffset += 30;
      }
    }

    // Leave button
    const leaveBtn = this.add.text(320, 440, '[ Leave Church ]', {
      fontFamily: 'monospace', fontSize: '16px', color: '#e0e0e0',
      backgroundColor: '#333333', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setDepth(OVERLAY_CONTENT_DEPTH).setInteractive({ useHandCursor: true });
    leaveBtn.on('pointerover', () => leaveBtn.setColor('#ffdd44'));
    leaveBtn.on('pointerout', () => leaveBtn.setColor('#e0e0e0'));
    leaveBtn.on('pointerdown', () => {
      this.leaveChurchNode();
    });
    this.churchOverlay.push(leaveBtn);
  }

  leaveChurchNode() {
    if (!this.churchOverlay) return;
    const node = this._churchNode;
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this, 300);
    this.closeChurchOverlay();
    if (node) {
      this.runManager.markNodeComplete(node.id);
      this.checkActComplete();
    }
  }

  showChurchMessage(text, color) {
    if (this.churchMessage) this.churchMessage.destroy();
    this.churchMessage = this.add.text(320, 95, text, {
      fontFamily: 'monospace', fontSize: '12px', color,
      backgroundColor: '#000000dd', padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setDepth(302);
    this.churchOverlay.push(this.churchMessage);

    this.time.delayedCall(2000, () => {
      if (this.churchMessage) {
        this.churchMessage.destroy();
        this.churchMessage = null;
      }
    });
  }

  showTransientMessage(text, color = '#ff6666') {
    if (this.transientMessage) this.transientMessage.destroy();
    this.transientMessage = this.add.text(this.cameras.main.centerX, 96, text, {
      fontFamily: 'monospace', fontSize: '12px', color,
      backgroundColor: '#000000dd', padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setDepth(400);
    this.time.delayedCall(2200, () => {
      if (this.transientMessage) {
        this.transientMessage.destroy();
        this.transientMessage = null;
      }
    });
  }

  refreshChurchOverlay(node) {
    this.closeChurchOverlay();
    this.showChurchOverlay(node);
  }

  closeChurchOverlay() {
    if (this.churchOverlay) {
      this.churchOverlay.forEach(o => o.destroy());
      this.churchOverlay = null;
    }
    if (this.churchMessage) {
      this.churchMessage.destroy();
      this.churchMessage = null;
    }
    this.churchGoldText = null;
    this._churchNode = null;
  }

  handleShop(node) {
    if (this.runManager.consumeSkipFirstShop()) {
      showMinorHint(this, 'Blessing effect: first shop skipped.');
      this.runManager.markNodeComplete(node.id);
      this.checkActComplete();
      return;
    }

    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(pickTrack(MUSIC.shop), this, 300);

    const rm = this.runManager;
    let shopItems = generateShopInventory(
      rm.currentAct, this.gameData.lootTables,
      this.gameData.weapons, this.gameData.consumables,
      this.gameData.accessories, rm.roster
    );
    shopItems = this.applyDifficultyShopPricing(shopItems);
    const shopItemDelta = rm.getShopItemCountDelta();
    if (shopItemDelta < 0 && shopItems.length > 0) {
      const trimmedCount = Math.max(1, shopItems.length + shopItemDelta);
      shopItems = shopItems.slice(0, trimmedCount);
    }
    this.showShopOverlay(node, shopItems);
  }

  applyDifficultyShopPricing(items) {
    const multiplier = this.runManager?.getDifficultyModifier?.('shopPriceMultiplier', 1) || 1;
    if (!Array.isArray(items)) return [];
    return items.map((entry) => ({
      ...entry,
      price: Math.max(1, Math.floor((entry.price || 0) * multiplier)),
    }));
  }

  showShopOverlay(node, shopItems) {
    this.shopOverlay = [];
    this.shopContentGroup = [];
    this.activeShopTab = 'buy';
    this.shopForgesUsed = 0;
    this.shopScrollOffsets = { buy: 0, sell: 0, forge: 0 };
    this.shopScrollMax = 0;

    // Tutorial hint for shop
    const hints = this.registry.get('hints');
    if (hints?.shouldShow('nodemap_shop')) {
      showMinorHint(this, 'Buy, Sell, and Forge tabs available.');
    }

    // Dark overlay background
    const bg = this.add.rectangle(320, 240, 640, 480, 0x000000, 0.9).setDepth(300);
    this.shopOverlay.push(bg);

    // Centered panel container
    const panel = this.add.rectangle(320, 240, OVERLAY_PANEL_W, OVERLAY_PANEL_H, 0x111111, 0.95)
      .setDepth(OVERLAY_PANEL_DEPTH)
      .setStrokeStyle(2, 0x444444)
      .setInteractive();
    this.shopOverlay.push(panel);

    // Title
    const title = this.add.text(320, 30, 'Village', {
      fontFamily: 'monospace', fontSize: '22px', color: '#ffdd44',
    }).setOrigin(0.5).setDepth(OVERLAY_CONTENT_DEPTH);
    this.shopOverlay.push(title);

    // Gold display
    this.shopGoldText = this.add.text(320, 58, `Gold: ${this.runManager.gold}G`, {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffdd44',
    }).setOrigin(0.5).setDepth(OVERLAY_CONTENT_DEPTH);
    this.shopOverlay.push(this.shopGoldText);

    this.shopBuyItems = shopItems.map((entry, i) => ({ ...entry, index: i }));
    this._shopNode = node;
    this.shopRerollCount = this.shopRerollCount || 0;

    // Tab bar
    this.drawShopTabs();

    // Draw active tab content
    this.drawActiveTabContent();

    // Leave button
    const leaveBtn = this.add.text(320, 440, '[ Leave Village ]', {
      fontFamily: 'monospace', fontSize: '16px', color: '#e0e0e0',
      backgroundColor: '#333333', padding: { x: 16, y: 8 },
    }).setOrigin(0.5).setDepth(OVERLAY_CONTENT_DEPTH).setInteractive({ useHandCursor: true });
    leaveBtn.on('pointerover', () => leaveBtn.setColor('#ffdd44'));
    leaveBtn.on('pointerout', () => leaveBtn.setColor('#e0e0e0'));
    leaveBtn.on('pointerdown', () => {
      this.leaveShopNode();
    });
    this.shopOverlay.push(leaveBtn);
  }

  leaveShopNode() {
    if (!this.shopOverlay) return;
    const node = this._shopNode;
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(getMusicKey('nodeMap', this.runManager.currentAct), this, 300);
    this.shopRerollCount = 0;
    this.closeShopOverlay();
    if (node) {
      this.runManager.markNodeComplete(node.id);
      this.checkActComplete();
    }
  }

  drawShopTabs() {
    // Destroy old tab objects
    if (this.shopTabObjects) this.shopTabObjects.forEach(o => o.destroy());
    this.shopTabObjects = [];

    const tabs = [
      { key: 'buy', label: 'Buy' },
      { key: 'sell', label: 'Sell' },
      { key: 'forge', label: 'Forge' },
    ];
    const tabY = 80;
    const tabW = 80;
    const startX = 320 - (tabs.length * tabW) / 2 + tabW / 2;

    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      const tx = startX + i * tabW;
      const isActive = this.activeShopTab === tab.key;
      const color = isActive ? '#ffdd44' : '#888888';
      const tabText = this.add.text(tx, tabY, tab.label, {
        fontFamily: 'monospace', fontSize: '14px', color,
        backgroundColor: isActive ? '#333355' : '#222222',
        padding: { x: 12, y: 4 },
      }).setOrigin(0.5).setDepth(OVERLAY_CONTENT_DEPTH).setInteractive({ useHandCursor: true });

      tabText.on('pointerdown', () => {
        if (this.activeShopTab === tab.key) return;
        this.activeShopTab = tab.key;
        this.drawShopTabs();
        this.drawActiveTabContent();
      });

      this.shopTabObjects.push(tabText);
      this.shopOverlay.push(tabText);
    }
  }

  drawActiveTabContent() {
    // Clear previous tab content
    this._hideForgeTooltip();
    if (this.shopContentGroup) this.shopContentGroup.forEach(o => o.destroy());
    this.shopContentGroup = [];

    if (this.activeShopTab === 'buy') {
      this.drawShopBuyList();
      this.drawRerollButton();
    } else if (this.activeShopTab === 'sell') {
      this.drawShopSellList();
    } else if (this.activeShopTab === 'forge') {
      this.drawShopForgeList();
    }

    this.drawShopScrollHint();
  }

  drawShopBuyList() {
    const startY = 105;
    const lineH = 24;
    this.shopScrollMax = Math.max(0, (this.shopBuyItems.length * lineH) - (SHOP_LIST_BOTTOM_Y - SHOP_LIST_TOP_Y));
    if (!this.shopScrollOffsets) this.shopScrollOffsets = { buy: 0, sell: 0, forge: 0 };
    this.shopScrollOffsets.buy = Phaser.Math.Clamp(this.shopScrollOffsets.buy || 0, 0, this.shopScrollMax);
    const offset = this.shopScrollOffsets.buy;

    this.shopBuyItems.forEach((entry, i) => {
      const y = startY + i * lineH - offset;
      if (y < SHOP_LIST_TOP_Y - lineH || y > SHOP_LIST_BOTTOM_Y) return;
      const affordable = this.runManager.gold >= entry.price;
      const color = affordable ? '#e0e0e0' : '#666666';
      const text = this.add.text(60, y, `${entry.item.name}  ${entry.price}G`, {
        fontFamily: 'monospace', fontSize: '12px', color,
      }).setDepth(OVERLAY_CONTENT_DEPTH);

      if (affordable) {
        text.setInteractive({ useHandCursor: true });
        text.on('pointerover', () => text.setColor('#ffdd44'));
        text.on('pointerout', () => text.setColor(color));
        text.on('pointerdown', () => this.onBuyItem(entry));
      }

      this.shopContentGroup.push(text);
      this.shopOverlay.push(text);
    });
  }

  onBuyItem(entry) {
    const rm = this.runManager;
    if (rm.gold < entry.price) return;

    // Path 1: Scrolls go to team pool
    if (entry.type === 'scroll') {
      rm.spendGold(entry.price);
      if (!rm.scrolls) rm.scrolls = [];
      rm.scrolls.push({ ...entry.item });
      const idx = this.shopBuyItems.indexOf(entry);
      if (idx !== -1) this.shopBuyItems.splice(idx, 1);
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_gold');
      this.refreshShop();
      this.showShopBanner(`Got ${entry.item.name}!`, '#88ff88');
      return;
    }

    // Path 2: Accessories go to team pool
    if (entry.type === 'accessory') {
      rm.spendGold(entry.price);
      if (!rm.accessories) rm.accessories = [];
      rm.accessories.push({ ...entry.item });
      const idx = this.shopBuyItems.indexOf(entry);
      if (idx !== -1) this.shopBuyItems.splice(idx, 1);
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_gold');
      this.refreshShop();
      this.showShopBanner(`Got ${entry.item.name}!`, '#88ff88');
      return;
    }

    // Path 3a: Consumables use consumables limit
    if (entry.item.type === 'Consumable') {
      this.showUnitPicker((unitIndex) => {
        const unit = rm.roster[unitIndex];
        const consumableCount = unit.consumables ? unit.consumables.length : 0;
        if (consumableCount >= CONSUMABLE_MAX) {
          if (!rm.spendGold(entry.price)) {
            this.showShopBanner('Not enough gold.', '#ff8888');
            return;
          }
          if (!rm.addToConvoy(entry.item)) {
            if (typeof rm.addGold === 'function') rm.addGold(entry.price);
            this.showShopBanner(`${unit.name}'s consumables are full!`, '#ff8888');
            return;
          }
          const idx = this.shopBuyItems.indexOf(entry);
          if (idx !== -1) this.shopBuyItems.splice(idx, 1);
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_gold');
          this.refreshShop();
          this.showShopBanner(`${entry.item.name} sent to convoy.`, '#88ccff');
          return;
        }
        rm.spendGold(entry.price);
        addToConsumables(unit, { ...entry.item });
        const idx = this.shopBuyItems.indexOf(entry);
        if (idx !== -1) this.shopBuyItems.splice(idx, 1);
        const audio = this.registry.get('audio');
        if (audio) audio.playSFX('sfx_gold');
        this.refreshShop();
        this.showShopBanner(`${unit.name} got ${entry.item.name}!`, '#88ff88');
      });
      return;
    }

    // Path 3b: Weapons/staves use main inventory limit
    this.showUnitPicker((unitIndex) => {
      const unit = rm.roster[unitIndex];
      if (unit.inventory.length >= INVENTORY_MAX) {
        if (!rm.spendGold(entry.price)) {
          this.showShopBanner('Not enough gold.', '#ff8888');
          return;
        }
        if (!rm.addToConvoy(entry.item)) {
          if (typeof rm.addGold === 'function') rm.addGold(entry.price);
          this.showShopBanner(`${unit.name}'s inventory is full!`, '#ff8888');
          return;
        }
        const idx = this.shopBuyItems.indexOf(entry);
        if (idx !== -1) this.shopBuyItems.splice(idx, 1);
        const audio = this.registry.get('audio');
        if (audio) audio.playSFX('sfx_gold');
        this.refreshShop();
        this.showShopBanner(`${entry.item.name} sent to convoy.`, '#88ccff');
        return;
      }
      rm.spendGold(entry.price);
      addToInventory(unit, { ...entry.item });
      const idx = this.shopBuyItems.indexOf(entry);
      if (idx !== -1) this.shopBuyItems.splice(idx, 1);
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_gold');
      this.refreshShop();
      this.showShopBanner(`${unit.name} got ${entry.item.name}!`, '#88ff88');
    }, entry.item);
  }

  drawShopSellList() {
    const startY = 105;
    const lineH = 22;
    const rm = this.runManager;
    let row = 0;
    let rowTotal = 0;
    for (const unit of rm.roster) {
      rowTotal += 1;
      rowTotal += unit.inventory.length;
    }
    this.shopScrollMax = Math.max(0, (rowTotal * lineH) - (SHOP_LIST_BOTTOM_Y - SHOP_LIST_TOP_Y));
    if (!this.shopScrollOffsets) this.shopScrollOffsets = { buy: 0, sell: 0, forge: 0 };
    this.shopScrollOffsets.sell = Phaser.Math.Clamp(this.shopScrollOffsets.sell || 0, 0, this.shopScrollMax);
    const offset = this.shopScrollOffsets.sell;

    for (let u = 0; u < rm.roster.length; u++) {
      const unit = rm.roster[u];
      const nameY = startY + row * lineH - offset;
      if (nameY >= SHOP_LIST_TOP_Y - lineH && nameY <= SHOP_LIST_BOTTOM_Y) {
        const nameText = this.add.text(60, nameY, `${unit.name}:`, {
          fontFamily: 'monospace', fontSize: '11px', color: '#aaaaaa',
        }).setDepth(OVERLAY_CONTENT_DEPTH);
        this.shopContentGroup.push(nameText);
        this.shopOverlay.push(nameText);
      }
      row++;

      for (let w = 0; w < unit.inventory.length; w++) {
        const wpn = unit.inventory[w];
        const sellPrice = getSellPrice(wpn);
        const y = startY + row * lineH - offset;
        if (sellPrice <= 0) { row++; continue; }
        if (y < SHOP_LIST_TOP_Y - lineH || y > SHOP_LIST_BOTTOM_Y) { row++; continue; }

        const locked = isLastCombatWeapon(unit, wpn);
        const equipped = wpn === unit.weapon ? '\u25b6' : ' ';
        const wpnColor = locked ? '#666666' : (isForged(wpn) ? '#44ff88' : '#e0e0e0');
        const text = this.add.text(70, y,
          `${equipped}${wpn.name}  ${locked ? '(last weapon)' : '+' + sellPrice + 'G'}`, {
          fontFamily: 'monospace', fontSize: '11px', color: wpnColor,
        }).setDepth(OVERLAY_CONTENT_DEPTH);

        if (!locked) {
          text.setInteractive({ useHandCursor: true });
          text.on('pointerover', () => text.setColor('#ffdd44'));
          text.on('pointerout', () => text.setColor(wpnColor));
          text.on('pointerdown', () => {
            rm.addGold(sellPrice);
            removeFromInventory(unit, wpn);
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_gold');
            this.refreshShop();
            this.showShopBanner(`Sold ${wpn.name} for ${sellPrice}G`, '#ffdd44');
          });
        }

        this.shopContentGroup.push(text);
        this.shopOverlay.push(text);
        row++;
      }
    }
  }

  drawShopForgeList() {
    this._hideForgeTooltip();
    const startY = 105;
    const lineH = 20;
    const rm = this.runManager;
    const forgeLimit = SHOP_FORGE_LIMITS[rm.currentAct] || 2;
    let row = 0;
    let rowTotal = 1.5;
    for (const unit of rm.roster) {
      const forgeableWeapons = unit.inventory.filter(w => canForge(w));
      if (forgeableWeapons.length === 0) continue;
      rowTotal += 1 + forgeableWeapons.length;
    }
    this.shopScrollMax = Math.max(0, (rowTotal * lineH) - (SHOP_LIST_BOTTOM_Y - SHOP_LIST_TOP_Y));
    if (!this.shopScrollOffsets) this.shopScrollOffsets = { buy: 0, sell: 0, forge: 0 };
    this.shopScrollOffsets.forge = Phaser.Math.Clamp(this.shopScrollOffsets.forge || 0, 0, this.shopScrollMax);
    const offset = this.shopScrollOffsets.forge;

    // Header: forges remaining
    const headerY = startY - offset;
    if (headerY >= SHOP_LIST_TOP_Y - lineH && headerY <= SHOP_LIST_BOTTOM_Y) {
      const header = this.add.text(60, headerY, `Forges remaining: ${forgeLimit - this.shopForgesUsed}/${forgeLimit}`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#ff8844',
      }).setDepth(OVERLAY_CONTENT_DEPTH);
      this.shopContentGroup.push(header);
      this.shopOverlay.push(header);
    }
    row += 1.5;

    const limitReached = this.shopForgesUsed >= forgeLimit;

    for (const unit of rm.roster) {
      const forgeableWeapons = unit.inventory.filter(w => canForge(w));
      if (forgeableWeapons.length === 0) continue;

      const nameY = startY + row * lineH - offset;
      if (nameY >= SHOP_LIST_TOP_Y - lineH && nameY <= SHOP_LIST_BOTTOM_Y) {
        const nameText = this.add.text(60, nameY, `${unit.name}:`, {
          fontFamily: 'monospace', fontSize: '11px', color: '#aaaaaa',
        }).setDepth(OVERLAY_CONTENT_DEPTH);
        this.shopContentGroup.push(nameText);
        this.shopOverlay.push(nameText);
      }
      row++;

      for (const wpn of forgeableWeapons) {
        const y = startY + row * lineH - offset;
        const level = wpn._forgeLevel || 0;
        const wpnColor = isForged(wpn) ? '#44ff88' : '#e0e0e0';
        const label = `  ${wpn.name}  [${level}/${FORGE_MAX_LEVEL}]`;
        if (y < SHOP_LIST_TOP_Y - lineH || y > SHOP_LIST_BOTTOM_Y) {
          row++;
          continue;
        }
        const wpnText = this.add.text(70, y, label, {
          fontFamily: 'monospace', fontSize: '11px', color: wpnColor,
        }).setDepth(OVERLAY_CONTENT_DEPTH);
        this.shopContentGroup.push(wpnText);
        this.shopOverlay.push(wpnText);

        // Hover tooltip for weapon stats
        wpnText.setInteractive({ useHandCursor: false });
        wpnText.on('pointerover', () => {
          this._showForgeTooltip(wpn, wpnText.x + wpnText.width + 10, wpnText.y);
        });
        wpnText.on('pointerout', () => this._hideForgeTooltip());

        if (level >= FORGE_MAX_LEVEL) {
          const maxLabel = this.add.text(350, y, 'MAX', {
            fontFamily: 'monospace', fontSize: '11px', color: '#888888',
          }).setDepth(OVERLAY_CONTENT_DEPTH);
          this.shopContentGroup.push(maxLabel);
          this.shopOverlay.push(maxLabel);
        } else if (limitReached) {
          const limitLabel = this.add.text(350, y, '(limit)', {
            fontFamily: 'monospace', fontSize: '11px', color: '#666666',
          }).setDepth(OVERLAY_CONTENT_DEPTH);
          this.shopContentGroup.push(limitLabel);
          this.shopOverlay.push(limitLabel);
        } else {
          const forgeBtn = this.add.text(350, y, '[ Forge ]', {
            fontFamily: 'monospace', fontSize: '11px', color: '#ff8844',
            backgroundColor: '#333333', padding: { x: 4, y: 1 },
          }).setDepth(OVERLAY_CONTENT_DEPTH).setInteractive({ useHandCursor: true });
          forgeBtn.on('pointerover', () => forgeBtn.setColor('#ffdd44'));
          forgeBtn.on('pointerout', () => forgeBtn.setColor('#ff8844'));
          forgeBtn.on('pointerdown', () => this.showForgeStatPicker(wpn));
          this.shopContentGroup.push(forgeBtn);
          this.shopOverlay.push(forgeBtn);
        }

        row++;
      }
    }

    if (row <= 1.5) {
      const emptyY = startY + row * lineH - offset;
      if (emptyY >= SHOP_LIST_TOP_Y - lineH && emptyY <= SHOP_LIST_BOTTOM_Y) {
        const emptyText = this.add.text(60, emptyY, 'No forgeable weapons in roster.', {
          fontFamily: 'monospace', fontSize: '11px', color: '#888888',
        }).setDepth(OVERLAY_CONTENT_DEPTH);
        this.shopContentGroup.push(emptyText);
        this.shopOverlay.push(emptyText);
      }
    }
  }

  drawShopScrollHint() {
    if (!this.shopOverlay || !this.shopContentGroup) return;
    if ((this.shopScrollMax || 0) <= 0) return;
    const offset = this.shopScrollOffsets?.[this.activeShopTab] || 0;
    const percent = this.shopScrollMax > 0
      ? Math.round((offset / this.shopScrollMax) * 100)
      : 0;
    const hint = this.add.text(445, 410, `Scroll: ${percent}%`, {
      fontFamily: 'monospace', fontSize: '10px', color: '#888888',
      backgroundColor: '#222222', padding: { x: 4, y: 2 },
    }).setDepth(OVERLAY_CONTENT_DEPTH);
    this.shopContentGroup.push(hint);
    this.shopOverlay.push(hint);
  }

  showForgeStatPicker(weapon) {
    if (this.forgePicker) this.forgePicker.forEach(o => o.destroy());
    this.forgePicker = [];

    const cx = 320;
    const cy = 240;
    const level = weapon._forgeLevel || 0;

    const pickerBg = this.add.rectangle(cx, cy, 320, 220, 0x222233, 0.97)
      .setDepth(450).setStrokeStyle(2, 0xff8844).setInteractive();
    this.forgePicker.push(pickerBg);

    const title = this.add.text(cx, cy - 88, `Forge ${weapon.name} (${level}/${FORGE_MAX_LEVEL})`, {
      fontFamily: 'monospace', fontSize: '12px', color: '#ffdd44',
    }).setOrigin(0.5).setDepth(451);
    this.forgePicker.push(title);

    const stats = [
      { key: 'might', label: '+1 Mt' },
      { key: 'crit', label: '+5 Crit' },
      { key: 'hit', label: '+5 Hit' },
      { key: 'weight', label: '-1 Wt' },
    ];

    const btnStartY = cy - 50;
    const btnH = 32;

    for (let i = 0; i < stats.length; i++) {
      const stat = stats[i];
      const statCount = getStatForgeCount(weapon, stat.key);
      const atStatCap = statCount >= FORGE_STAT_CAP;
      const cost = getForgeCost(weapon, stat.key);
      const affordable = cost > 0 && this.runManager.gold >= cost;
      const by = btnStartY + i * btnH;
      const color = atStatCap ? '#666666' : (affordable ? '#e0e0e0' : '#666666');

      const costLabel = atStatCap ? 'MAX' : `${cost}G`;
      const btn = this.add.text(cx, by, `${stat.label}  (${statCount}/${FORGE_STAT_CAP})  ${costLabel}`, {
        fontFamily: 'monospace', fontSize: '12px', color,
        backgroundColor: (affordable && !atStatCap) ? '#444444' : '#333333',
        padding: { x: 16, y: 4 },
      }).setOrigin(0.5).setDepth(451);

      if (affordable && !atStatCap) {
        btn.setInteractive({ useHandCursor: true });
        btn.on('pointerover', () => btn.setColor('#ffdd44'));
        btn.on('pointerout', () => btn.setColor(color));
        btn.on('pointerdown', () => {
          const result = applyForge(weapon, stat.key);
          if (result.success) {
            this.runManager.spendGold(result.cost);
            this.shopForgesUsed++;
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_gold');
            this.closeForgeStatPicker();
            this.refreshShop();
            this.showShopBanner(`Forged ${weapon.name}!`, '#ff8844');
          }
        });
      }

      this.forgePicker.push(btn);
    }

    // Cancel button
    const cancelBtn = this.add.text(cx, btnStartY + stats.length * btnH + 10, 'Cancel', {
      fontFamily: 'monospace', fontSize: '12px', color: '#888888',
      backgroundColor: '#333333', padding: { x: 12, y: 4 },
    }).setOrigin(0.5).setDepth(451).setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setColor('#ffdd44'));
    cancelBtn.on('pointerout', () => cancelBtn.setColor('#888888'));
    cancelBtn.on('pointerdown', () => this.closeForgeStatPicker());
    this.forgePicker.push(cancelBtn);
  }

  closeForgeStatPicker() {
    if (this.forgePicker) {
      this.forgePicker.forEach(o => o.destroy());
      this.forgePicker = null;
    }
  }

  _showForgeTooltip(wpn, anchorX, anchorY) {
    this._hideForgeTooltip();
    this.forgeTooltip = [];

    const line1 = `Mt: ${wpn.might}   Hit: ${wpn.hit}   Crt: ${wpn.crit}`;
    const line2 = `Wt: ${wpn.weight}   Rng: ${wpn.range}`;
    const mtCount = getStatForgeCount(wpn, 'might');
    const crCount = getStatForgeCount(wpn, 'crit');
    const htCount = getStatForgeCount(wpn, 'hit');
    const wtCount = getStatForgeCount(wpn, 'weight');
    const line3 = `Forge: Mt(${mtCount}/${FORGE_STAT_CAP}) Cr(${crCount}/${FORGE_STAT_CAP}) Ht(${htCount}/${FORGE_STAT_CAP}) Wt(${wtCount}/${FORGE_STAT_CAP})`;

    const lines = [line1, line2, line3];
    if (wpn.special) lines.push(`Special: ${wpn.special}`);

    const lineH = 14;
    const padX = 8;
    const padY = 6;
    const boxW = 220;
    const boxH = lines.length * lineH + padY * 2;

    // Clamp to canvas (640x480)
    let tx = anchorX;
    let ty = anchorY;
    if (tx + boxW > 635) tx = anchorX - boxW - 20;
    if (ty + boxH > 475) ty = 475 - boxH;
    if (tx < 5) tx = 5;
    if (ty < 5) ty = 5;

    const bg = this.add.rectangle(tx + boxW / 2, ty + boxH / 2, boxW, boxH, 0x111122, 0.95)
      .setDepth(310).setStrokeStyle(1, 0x4466aa);
    this.forgeTooltip.push(bg);

    const statsText = this.add.text(tx + padX, ty + padY, line1 + '\n' + line2, {
      fontFamily: 'monospace', fontSize: '9px', color: '#e0e0e0', lineSpacing: 4,
    }).setDepth(311);
    this.forgeTooltip.push(statsText);

    const forgeText = this.add.text(tx + padX, ty + padY + lineH * 2, line3, {
      fontFamily: 'monospace', fontSize: '9px', color: '#ff8844',
    }).setDepth(311);
    this.forgeTooltip.push(forgeText);

    if (wpn.special) {
      const specialText = this.add.text(tx + padX, ty + padY + lineH * 3, `Special: ${wpn.special}`, {
        fontFamily: 'monospace', fontSize: '9px', color: '#88ccff',
      }).setDepth(311);
      this.forgeTooltip.push(specialText);
    }
  }

  _hideForgeTooltip() {
    if (this.forgeTooltip) {
      this.forgeTooltip.forEach(o => o.destroy());
      this.forgeTooltip = null;
    }
  }

  refreshShop() {
    this.shopGoldText.setText(`Gold: ${this.runManager.gold}G`);
    this.drawActiveTabContent();
    this.drawShopTabs();
  }

  drawRerollButton() {
    const cost = SHOP_REROLL_COST + (this.shopRerollCount * SHOP_REROLL_ESCALATION);
    const affordable = this.runManager.gold >= cost;
    const color = affordable ? '#aaddff' : '#666666';
    const rerollBtn = this.add.text(60, 410, `[ Reroll ${cost}G ]`, {
      fontFamily: 'monospace', fontSize: '12px', color,
      backgroundColor: '#333333', padding: { x: 8, y: 4 },
    }).setDepth(OVERLAY_CONTENT_DEPTH);
    this.shopContentGroup.push(rerollBtn);
    this.shopOverlay.push(rerollBtn);

    if (affordable) {
      rerollBtn.setInteractive({ useHandCursor: true });
      rerollBtn.on('pointerover', () => rerollBtn.setColor('#ffdd44'));
      rerollBtn.on('pointerout', () => rerollBtn.setColor(color));
      rerollBtn.on('pointerdown', () => {
        this.runManager.spendGold(cost);
        this.shopRerollCount++;
        const newItems = generateShopInventory(
          this.runManager.currentAct, this.gameData.lootTables,
          this.gameData.weapons, this.gameData.consumables,
          this.gameData.accessories, this.runManager.roster
        );
        const pricedItems = this.applyDifficultyShopPricing(newItems);
        this.shopBuyItems = pricedItems.map((entry, i) => ({ ...entry, index: i }));
        const audio = this.registry.get('audio');
        if (audio) audio.playSFX('sfx_gold');
        this.refreshShop();
        this.showShopBanner('Shop restocked!', '#aaddff');
      });
    }
  }

  showUnitPicker(callback, itemForProfCheck) {
    this.closeUnitPicker();

    const rm = this.runManager;
    const viewportHeight = 280;
    const contentHeight = rm.roster.length * 30;
    const maxOffset = Math.max(0, contentHeight - viewportHeight);

    this.unitPickerState = {
      callback,
      itemForProfCheck,
      offset: 0,
      maxOffset,
      viewportTop: 120,
      viewportBottom: 120 + viewportHeight,
    };
    this.renderUnitPicker();
  }

  renderUnitPicker() {
    if (!this.unitPickerState) return;
    if (this.unitPicker) this.unitPicker.forEach(o => o.destroy());
    this.unitPicker = [];

    const rm = this.runManager;
    const state = this.unitPickerState;
    const cx = 320;
    const panelY = 260;
    const panelW = 280;
    const panelH = 360;
    const listTop = state.viewportTop;
    const listBottom = state.viewportBottom;
    const offset = state.offset || 0;

    const pickerBg = this.add.rectangle(cx, panelY, panelW, panelH, 0x222222, 0.95)
      .setDepth(400).setStrokeStyle(1, 0x888888).setInteractive();
    this.unitPicker.push(pickerBg);

    const pickerTitle = this.add.text(cx, 102, 'Give to:', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffdd44',
    }).setOrigin(0.5).setDepth(401);
    this.unitPicker.push(pickerTitle);

    const clipTop = this.add.rectangle(cx, listTop, panelW - 20, 1, 0x555555, 0.6).setDepth(401);
    const clipBottom = this.add.rectangle(cx, listBottom, panelW - 20, 1, 0x555555, 0.6).setDepth(401);
    this.unitPicker.push(clipTop, clipBottom);

    rm.roster.forEach((unit, i) => {
      const y = listTop + i * 30 - offset + 15;
      if (y < listTop - 15 || y > listBottom + 15) return;
      const noProf = state.itemForProfCheck && !hasProficiency(unit, state.itemForProfCheck);
      const label = `${unit.name} (${unit.inventory.length}/${INVENTORY_MAX})${noProf ? ' no prof' : ''}`;
      const color = noProf ? '#cc8844' : '#e0e0e0';
      const btn = this.add.text(cx, y, label, {
        fontFamily: 'monospace', fontSize: '13px', color,
        backgroundColor: '#444444', padding: { x: 12, y: 4 },
      }).setOrigin(0.5).setDepth(401).setInteractive({ useHandCursor: true });

      btn.on('pointerover', () => btn.setColor('#ffdd44'));
      btn.on('pointerout', () => btn.setColor(color));
      btn.on('pointerdown', () => {
        const cb = state.callback;
        this.closeUnitPicker();
        cb(i);
      });

      this.unitPicker.push(btn);
    });

    if (state.maxOffset > 0) {
      const pct = Math.round((offset / state.maxOffset) * 100);
      const hint = this.add.text(cx + panelW / 2 - 10, 102, `${pct}%`, {
        fontFamily: 'monospace', fontSize: '10px', color: '#888888',
      }).setOrigin(1, 0.5).setDepth(401);
      this.unitPicker.push(hint);
    }

    const cancelBtn = this.add.text(cx, 430, '[ Cancel ]', {
      fontFamily: 'monospace', fontSize: '12px', color: '#bbbbbb',
      backgroundColor: '#333333', padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setDepth(401).setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setColor('#ffdd44'));
    cancelBtn.on('pointerout', () => cancelBtn.setColor('#bbbbbb'));
    cancelBtn.on('pointerdown', () => this.closeUnitPicker());
    this.unitPicker.push(cancelBtn);
  }

  closeUnitPicker() {
    if (this.unitPicker) {
      this.unitPicker.forEach(o => o.destroy());
      this.unitPicker = null;
    }
    this.unitPickerState = null;
  }

  showShopBanner(msg, color) {
    const banner = this.add.text(320, 400, msg, {
      fontFamily: 'monospace', fontSize: '12px', color,
      backgroundColor: '#000000cc', padding: { x: 8, y: 4 },
    }).setOrigin(0.5).setDepth(500).setAlpha(0);

    this.tweens.add({
      targets: banner, alpha: 1, duration: 200,
      yoyo: true, hold: 800,
      onComplete: () => banner.destroy(),
    });
  }

  showWeaponArtsUnlockedBanner(artIds = []) {
    if (!Array.isArray(artIds) || artIds.length <= 0) return;
    const catalog = this.gameData?.weaponArts?.arts || [];
    const names = artIds
      .map((id) => catalog.find((art) => art?.id === id)?.name || id)
      .filter(Boolean);
    if (names.length <= 0) return;
    const suffix = names.length > 1 ? 's' : '';
    const label = names.length > 2
      ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more`
      : names.join(', ');
    this.showShopBanner(`Weapon Art${suffix} unlocked: ${label}`, '#88ddff');
  }

  closeShopOverlay() {
    this.closeForgeStatPicker();
    this._hideForgeTooltip();
    if (this.shopOverlay) {
      this.shopOverlay.forEach(o => o.destroy());
      this.shopOverlay = null;
    }
    if (this.shopContentGroup) {
      this.shopContentGroup.forEach(o => o.destroy());
      this.shopContentGroup = null;
    }
    if (this.shopTabObjects) {
      this.shopTabObjects.forEach(o => o.destroy());
      this.shopTabObjects = null;
    }
    if (this.unitPicker) {
      this.closeUnitPicker();
    }
    this._shopNode = null;
  }

  checkActComplete() {
    const rm = this.runManager;
    if (rm.isActComplete()) {
      if (rm.isRunComplete()) {
        rm.status = 'victory';
        rm.settleEndRunRewards(this.registry.get('meta'), 'victory');
        void startSceneLazy(this, 'RunComplete', {
          gameData: this.gameData,
          runManager: rm,
          result: 'victory',
        });
      } else {
        this.showActCompleteBanner(() => {
          const unlockedArtIds = rm.advanceAct();
          this.drawMap();
          this.showWeaponArtsUnlockedBanner(unlockedArtIds);
        });
      }
    } else {
      this.drawMap();
    }
  }

  showActCompleteBanner(onComplete) {
    const banner = this.add.text(
      this.cameras.main.centerX, this.cameras.main.centerY,
      'Act Complete!',
      {
        fontFamily: 'monospace', fontSize: '24px', color: '#ffdd44',
        backgroundColor: '#000000dd', padding: { x: 20, y: 10 },
      }
    ).setOrigin(0.5).setAlpha(0).setDepth(200);

    this.tweens.add({
      targets: banner, alpha: 1, duration: 300,
      yoyo: true, hold: 1200,
      onComplete: () => {
        banner.destroy();
        if (onComplete) onComplete();
      },
    });
  }
}


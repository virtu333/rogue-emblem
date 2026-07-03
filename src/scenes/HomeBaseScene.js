// HomeBaseScene — Meta-progression upgrade shop with tabbed UI

import Phaser from 'phaser';
import { resolveStartingLordDefs } from '../engine/Commander.js';
import { MUSIC } from '../utils/musicConfig.js';
import {
  MAX_STARTING_SKILLS,
  STARTING_ACCESSORY_TIERS,
  STARTING_STAFF_TIERS,
  CATEGORY_CURRENCY,
  REFUND_FEE,
  SAFE_BOTTOM_Y,
} from '../utils/constants.js';
import { showImportantHint, showMinorHint } from '../ui/HintDisplay.js';
import { transitionToScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { hasOpenOverlay } from '../utils/overlayStack.js';
import { ensureAudioUnlocked } from '../utils/audioUnlock.js';
import { isTouchPointer } from '../utils/runtimeFlags.js';
import { BoundingFocusController } from '../ui/BoundingFocusController.js';
import { InputAction } from '../utils/InputActions.js';
import { pushInputScope, popInputScope } from '../utils/inputFocus.js';

const CATEGORIES = [
  { key: 'recruit_stats', label: 'Recruits' },
  { key: 'lord_bonuses', label: 'Lords' },
  { key: 'economy', label: 'Economy' },
  { key: 'capacity', label: 'Battalion' },
  { key: 'starting_equipment', label: 'Equip' },
  { key: 'starting_skills', label: 'Skills' },
];

const GROWTH_SUFFIX = '_growth';
const FLAT_SUFFIX = '_flat';

// Progress bar config
const BAR_SEGMENT_W = 14;
const BAR_SEGMENT_H = 10;
const BAR_GAP = 3;
const BAR_FILLED = 0x88ccff;
const BAR_FILLED_MAX = 0xffdd44;
const BAR_EMPTY = 0x333344;

// Row heights
const ROW_H = 28; // stat rows (label + desc on same line area)
const ROW_H_NAMED = 34; // economy/capacity rows (name + desc needs more room)
const LORD_SKILLS_CARD_H = 84;
const TAB_CONTENT_TOP_Y = 72;
const TAB_CONTENT_BOTTOM_Y = 392;
const TAB_CONTENT_LEFT_X = 30;
const TAB_CONTENT_RIGHT_X = 610;
const TAB_SCROLL_STEP = 24;
const EXTRA_STARTER_TIER_LABELS = {
  1: 'Archer',
  2: 'Archer/Knight',
  3: 'Archer/Knight/Cavalier',
  4: 'Archer/Knight/Cavalier/Paladin',
};
const LOOT_CATEGORY_LABELS = {
  weapon: 'Weapons',
  healing: 'Healing',
  statBooster: 'Stat Booster',
  promotion: 'Promotion',
  skillScroll: 'Skill Scroll',
  weaponArtScroll: 'Weapon Art',
  legendaryWeapon: 'Legendary',
  accessory: 'Accessory',
  forge: 'Forge',
  gold: 'Gold',
};

const STAT_GAMEPLAY_HINTS = {
  HP: 'Hit Points — how much damage a unit can take.',
  STR: 'Strength — adds to physical attack damage.',
  MAG: 'Magic — adds to magical damage and healing.',
  SKL: 'Skill — improves hit rate, crit chance, and skill activation.',
  SPD: 'Speed — improves avoid. Double attack if SPD >= foe +5.',
  DEF: 'Defense — reduces physical damage taken.',
  RES: 'Resistance — reduces magical damage taken.',
  LCK: 'Luck — small hit/avoid bonus, reduces enemy crit.',
};
const GROWTH_HINT = 'Growth = % chance to gain +1 at each level-up.';
const FLAT_HINT_RECRUIT = 'Recruits start with this bonus at recruitment.';
const FLAT_HINT_LORD = 'Lords begin each run with this bonus.';

function beginSceneLifecycle(scene) {
  const nextGeneration =
    (Number.isInteger(scene?._sceneLifecycleGeneration) ? scene._sceneLifecycleGeneration : 0) + 1;
  scene._sceneLifecycleGeneration = nextGeneration;
  scene._sceneShuttingDown = false;
  scene._sceneShutdownCleanedUp = false;
  scene._sceneTimers = new Set();
  return nextGeneration;
}

function isSceneLifecycleActive(scene, generation = scene?._sceneLifecycleGeneration) {
  if (!scene || scene._sceneShuttingDown) return false;
  const currentGeneration = Number.isInteger(scene._sceneLifecycleGeneration)
    ? scene._sceneLifecycleGeneration
    : null;
  if (
    Number.isInteger(generation) &&
    Number.isInteger(currentGeneration) &&
    generation !== currentGeneration
  ) {
    return false;
  }
  return scene.sys?.isActive?.() !== false;
}

function trackSceneTimer(scene, timer) {
  if (!timer) return null;
  if (!scene._sceneTimers || typeof scene._sceneTimers.add !== 'function') {
    scene._sceneTimers = new Set();
  }
  scene._sceneTimers.add(timer);
  return timer;
}

function clearTrackedSceneTimer(scene, timer) {
  if (!timer) return;
  if (scene?._sceneTimers && typeof scene._sceneTimers.delete === 'function') {
    scene._sceneTimers.delete(timer);
  }
  try {
    timer.remove?.();
  } catch (_) {}
}

function clearAllSceneTimers(scene) {
  if (!scene?._sceneTimers || typeof scene._sceneTimers.values !== 'function') return;
  for (const timer of Array.from(scene._sceneTimers.values())) {
    clearTrackedSceneTimer(scene, timer);
  }
}

export class HomeBaseScene extends Phaser.Scene {
  constructor() {
    super('HomeBase');
  }

  init(data) {
    this.gameData = data.gameData;
    this.runManager = data.runManager || null;
    this.isTransitioning = false;
    this._corruptRunDetected = data.corruptRunDetected || false;
  }

  create() {
    const lifecycleGeneration = beginSceneLifecycle(this);

    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.homeBase, this);

    if (this._corruptRunDetected) {
      showMinorHint(this, 'Save data could not be loaded. Starting fresh for this slot.');
    }

    this.events.once('shutdown', () => HomeBaseScene.prototype._onSceneShutdown.call(this));

    this.meta = this.registry.get('meta');
    this.activeTab = 'recruit_stats';
    this.tabScrollOffsets = {};
    this.tabScrollMax = 0;
    this._touchTapDown = null;
    this._tapMoveThreshold = 12;
    this._touchScrollDrag = null;
    this._touchTooltipState = null;
    this.refundMode = false;
    this.confirmOverlayObjects = [];

    this._onEsc = () => {
      // A stacked overlay owns ESC while open; its own handler closes it.
      if (hasOpenOverlay(this)) return;
      this.requestCancel({ allowExit: true });
    };
    this._onPointerDown = (pointer) => {
      this._touchTapDown = { x: pointer.x, y: pointer.y };
      this.onPointerDown(pointer);
    };
    this._onPointerMove = (pointer) => this.onPointerMove(pointer);
    this._onPointerUp = (pointer) => this.onPointerUp(pointer);
    this._onPointerUpOutside = (pointer) => this.onPointerUpOutside(pointer);
    this._onWheelHandler = (pointer, gameObjects, deltaX, deltaY) =>
      this.onWheel(pointer, deltaX, deltaY);

    this.input.keyboard.on('keydown-ESC', this._onEsc);
    this.input.on('pointerdown', this._onPointerDown);
    this.input.on('pointermove', this._onPointerMove);
    this.input.on('pointerup', this._onPointerUp);
    this.input.on('pointerupoutside', this._onPointerUpOutside);
    this.input.on('wheel', this._onWheelHandler);

    const flags = this.registry.get('startupFlags');
    this.isMobileInput = Boolean(flags?.isMobile);
    if (this.isMobileInput) {
      const ge = this.game?.events;
      if (ge) {
        this._mobileHandlers = {
          cancel: () => this.requestCancel({ allowExit: false }),
          menu: () => this.requestCancel({ allowExit: true }),
        };
        for (const [action, handler] of Object.entries(this._mobileHandlers)) {
          ge.on(`mobile:${action}`, handler);
        }
        ge.emit('mobile:setContext', { context: 'homebase' });
      }
    }

    // Gamepad: a bounding-ring cursor over the actionable (hand-cursor) buttons,
    // registered on the input-focus stack. Rebuilt at the end of each drawUI.
    this._homeFocus = new BoundingFocusController(this, 912);
    this._onInputActionBound = (action, payload) => this._onInputAction(action, payload);
    pushInputScope(this, this._onInputActionBound);

    this.drawUI();

    // Tutorial hints for home base
    const hints = this.registry.get('hints');
    if (hints) {
      void HomeBaseScene.prototype._runStartupHints.call(this, hints, lifecycleGeneration);
    }
  }

  _onSceneShutdown() {
    if (this._sceneShutdownCleanedUp) return;
    this._sceneShutdownCleanedUp = true;
    this._sceneShuttingDown = true;
    this.isTransitioning = false;

    // Release the gamepad focus scope before the picker teardown below (whose
    // _refreshHomeFocus calls then no-op once _homeFocus is gone).
    popInputScope(this);
    this._onInputActionBound = null;
    if (this._homeFocus) {
      this._homeFocus.destroy();
      this._homeFocus = null;
    }

    clearAllSceneTimers(this);
    this._transientMessageTimer = null;

    this.refundMode = false;
    this._hideRefundConfirm?.();
    if (typeof this._hideMetaTooltips === 'function') {
      this._hideMetaTooltips();
    } else {
      this._hideUpgradeTooltip?.();
      if (this._prereqTooltip) {
        this._prereqTooltip.destroy();
        this._prereqTooltip = null;
      }
      if (this._tierTooltip) {
        this._tierTooltip.destroy();
        this._tierTooltip = null;
      }
      this._touchTooltipState = null;
    }
    this._destroySkillPicker?.();
    this._destroyCommanderPicker?.();
    if (this.transientMessage) {
      this.transientMessage.destroy();
      this.transientMessage = null;
    }

    this.input?.keyboard?.off?.('keydown-ESC', this._onEsc);
    this.input?.off?.('pointerdown', this._onPointerDown);
    this.input?.off?.('pointermove', this._onPointerMove);
    this.input?.off?.('pointerup', this._onPointerUp);
    this.input?.off?.('pointerupoutside', this._onPointerUpOutside);
    this.input?.off?.('wheel', this._onWheelHandler);

    if (this.isMobileInput) {
      const ge = this.game?.events;
      if (ge && this._mobileHandlers) {
        for (const [action, handler] of Object.entries(this._mobileHandlers)) {
          ge.off(`mobile:${action}`, handler);
        }
      }
      if (ge) ge.emit('mobile:setContext', { context: 'none', resetStack: true });
      this._mobileHandlers = null;
    }

    const audio = this.registry.get('audio');
    if (audio) audio.releaseMusic(this, 0);
  }

  async _runStartupHints(hints, lifecycleGeneration = this._sceneLifecycleGeneration) {
    try {
      if (!isSceneLifecycleActive(this, lifecycleGeneration)) return;
      if (hints.shouldShow('homebase_intro')) {
        await showImportantHint(
          this,
          'Spend Valor and Supply to upgrade your army.\nUpgrades persist across all runs.',
        );
      }
      if (!isSceneLifecycleActive(this, lifecycleGeneration)) return;
      if (hints.shouldShow('homebase_begin')) {
        void showMinorHint(this, 'Click Begin Run when ready.');
      }
    } catch (_) {}
  }

  drawUI() {
    this._hideMetaTooltips();
    this._hideRefundConfirm();
    this.children.removeAll(true);

    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    this.add.rectangle(w / 2, h / 2, w, h, 0x000622, 1).setOrigin(0.5);
    this.drawTabContent(this.activeTab);
    this.drawContentViewportChrome();
    this.drawScrollIndicators();
    this.drawHeader();
    this.drawTabs();
    this.drawBottomButtons();

    if (this.refundMode) {
      this.add
        .text(w / 2, TAB_CONTENT_BOTTOM_Y + 4, '-- REFUND MODE: Select an upgrade to refund --', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#cc8844',
        })
        .setOrigin(0.5, 0)
        .setDepth(911);
    }

    this._refreshHomeFocus?.();
  }

  // Collect the actionable buttons for gamepad focus. Hand-cursor + a pointerdown
  // listener selects exactly the clickable controls (tabs, affordable cost
  // buttons, scroll arrows, bottom buttons) and skips info-only labels. While a
  // picker modal is open, focus is restricted to its live objects.
  _refreshHomeFocus() {
    if (!this._homeFocus || this._sceneShuttingDown) return;
    const live = (arr) => Array.isArray(arr) && arr.some((o) => o?.scene);
    let pool;
    if (live(this._commanderPickerObjects)) pool = this._commanderPickerObjects;
    else if (live(this._skillPickerObjects)) pool = this._skillPickerObjects;
    else pool = this.children.list;
    const focusables = pool
      .filter(
        (o) =>
          o?.input?.enabled &&
          o.input?.cursor === 'pointer' &&
          typeof o.listenerCount === 'function' &&
          o.listenerCount('pointerdown') > 0,
      )
      .sort((a, b) => a.y - b.y || a.x - b.x);
    this._homeFocus.setObjects(focusables);
  }

  _cycleTab(dir) {
    const keys = CATEGORIES.map((c) => c.key);
    const i = keys.indexOf(this.activeTab);
    const next = keys[(((i + dir) % keys.length) + keys.length) % keys.length];
    if (next === this.activeTab) return;
    this._hideMetaTooltips();
    this.activeTab = next;
    if (this.tabScrollOffsets[this.activeTab] === undefined)
      this.tabScrollOffsets[this.activeTab] = 0;
    this.drawUI();
  }

  _onInputAction(action, payload) {
    if (action === InputAction.CANCEL || action === InputAction.PAUSE) {
      if (!hasOpenOverlay(this)) this.requestCancel({ allowExit: true });
      return;
    }
    const pickerOpen = Boolean(this._skillPickerObjects || this._commanderPickerObjects);
    switch (action) {
      case InputAction.NAVIGATE:
        this._homeFocus?.move(payload?.dy || payload?.dx || 0);
        break;
      case InputAction.CONFIRM:
        this._homeFocus?.activate();
        break;
      case InputAction.PREV_UNIT: // L1: previous tab (not while a picker is open)
        if (!pickerOpen) this._cycleTab(-1);
        break;
      case InputAction.NEXT_UNIT: // R1: next tab
        if (!pickerOpen) this._cycleTab(1);
        break;
    }
  }

  drawHeader() {
    const w = this.cameras.main.width;
    this.add.text(20, 12, 'HOME BASE', {
      fontFamily: 'monospace',
      fontSize: '20px',
      color: '#ffdd44',
      fontStyle: 'bold',
    });

    // Show both currencies — highlight the one used by the active tab
    const activeCurrency = CATEGORY_CURRENCY[this.activeTab] || null;
    const valorColor =
      activeCurrency === 'valor' ? '#ffcc44' : activeCurrency ? '#665522' : '#6b728f';
    const supplyColor =
      activeCurrency === 'supply' ? '#44ccbb' : activeCurrency ? '#225544' : '#6b728f';
    this.add
      .text(w - 20, 8, `Valor: ${this.meta.getTotalValor()}`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: valorColor,
      })
      .setOrigin(1, 0);
    this.add
      .text(w - 20, 24, `Supply: ${this.meta.getTotalSupply()}`, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: supplyColor,
      })
      .setOrigin(1, 0);
  }

  drawContentViewportChrome() {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const contentH = TAB_CONTENT_BOTTOM_Y - TAB_CONTENT_TOP_Y;
    const contentW = TAB_CONTENT_RIGHT_X - TAB_CONTENT_LEFT_X;
    const contentCx = (TAB_CONTENT_LEFT_X + TAB_CONTENT_RIGHT_X) / 2;
    const contentCy = TAB_CONTENT_TOP_Y + contentH / 2;

    // Frame around scrollable tab content.
    this.add
      .rectangle(contentCx, contentCy, contentW, contentH, 0x000000, 0)
      .setStrokeStyle(1, 0x1b2744, 0.9);

    // Occlusion strips hide scrolled content outside the viewport.
    this.add.rectangle(w / 2, TAB_CONTENT_TOP_Y / 2, w, TAB_CONTENT_TOP_Y, 0x000622, 1);
    this.add.rectangle(
      w / 2,
      TAB_CONTENT_BOTTOM_Y + (h - TAB_CONTENT_BOTTOM_Y) / 2,
      w,
      h - TAB_CONTENT_BOTTOM_Y,
      0x000622,
      1,
    );
  }

  drawScrollIndicators() {
    if ((this.tabScrollMax || 0) <= 0) return;
    const key = this.activeTab;
    const offset = this.tabScrollOffsets?.[key] || 0;
    const max = this.tabScrollMax || 0;
    const canUp = offset > 0;
    const canDown = offset < max;
    const x = TAB_CONTENT_RIGHT_X - 12;

    const makeArrow = (y, label, enabled, onClick) => {
      const btn = this.add
        .text(x, y, label, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: enabled ? '#a8cfff' : '#44506e',
          backgroundColor: '#0f1730',
          padding: { x: 6, y: 3 },
        })
        .setOrigin(0.5)
        .setDepth(910);
      if (!enabled) return;
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setColor('#ffdd44'));
      btn.on('pointerout', () => btn.setColor('#a8cfff'));
      btn.on('pointerdown', onClick);
    };

    makeArrow(TAB_CONTENT_TOP_Y + 14, '[^]', canUp, () => this._scrollTab(-TAB_SCROLL_STEP));
    makeArrow(TAB_CONTENT_BOTTOM_Y - 14, '[v]', canDown, () => this._scrollTab(TAB_SCROLL_STEP));

    this.add
      .text(TAB_CONTENT_RIGHT_X - 12, TAB_CONTENT_TOP_Y + 34, 'Scroll', {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#556287',
      })
      .setOrigin(0.5, 0)
      .setDepth(910);
  }

  _scrollTab(delta) {
    const key = this.activeTab;
    const current = this.tabScrollOffsets?.[key] || 0;
    const next = Phaser.Math.Clamp(current + delta, 0, this.tabScrollMax || 0);
    if (next === current) return;
    this.tabScrollOffsets[key] = next;
    const audio = this.registry.get('audio');
    if (audio) audio.playSFX('sfx_cursor');
    this.drawUI();
  }

  drawTabs() {
    let tabX = 30;
    const tabY = 44;

    for (const cat of CATEGORIES) {
      const isActive = cat.key === this.activeTab;
      const color = isActive ? '#ffdd44' : '#aaaaaa';

      const tab = this.add
        .text(tabX, tabY, cat.label, {
          fontFamily: 'monospace',
          fontSize: '13px',
          color,
          fontStyle: isActive ? 'bold' : '',
        })
        .setInteractive({ useHandCursor: true });

      if (isActive) {
        const bounds = tab.getBounds();
        this.add.rectangle(
          bounds.x + bounds.width / 2,
          bounds.y + bounds.height + 2,
          bounds.width,
          2,
          0xffdd44,
        );
      }

      tab.on('pointerover', () => {
        if (!isActive) tab.setColor('#ffffff');
      });
      tab.on('pointerout', () => {
        if (!isActive) tab.setColor('#aaaaaa');
      });
      tab.on('pointerdown', () => {
        if (this.activeTab !== cat.key) {
          this._hideMetaTooltips();
          this.activeTab = cat.key;
          if (this.tabScrollOffsets[this.activeTab] === undefined)
            this.tabScrollOffsets[this.activeTab] = 0;
          this.drawUI();
        }
      });

      tabX += tab.width + 24;
    }
  }

  drawTabContent(category) {
    if (category === 'starting_skills') {
      this._drawSkillsTab();
      return;
    }

    const upgrades = this.meta.upgradesData.filter((u) => u.category === category);
    const hasSubgroups = category === 'recruit_stats' || category === 'lord_bonuses';

    const offset = this._getTabScrollOffset(category);
    let y = TAB_CONTENT_TOP_Y - offset;

    if (hasSubgroups) {
      const growthUpgrades = upgrades.filter((u) => u.id.endsWith(GROWTH_SUFFIX));
      const flatUpgrades = upgrades.filter((u) => u.id.endsWith(FLAT_SUFFIX));

      this.add.text(40, y, 'Growth Bonuses', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
        fontStyle: 'bold',
      });
      y += 18;

      for (const upgrade of growthUpgrades) {
        this.drawUpgradeRow(upgrade, y);
        y += ROW_H;
      }

      y += 6;

      this.add.text(40, y, 'Stat Bonuses', {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#888888',
        fontStyle: 'bold',
      });
      y += 18;

      for (const upgrade of flatUpgrades) {
        this.drawUpgradeRow(upgrade, y);
        y += ROW_H;
      }

      const otherUpgrades = upgrades.filter(
        (u) => !u.id.endsWith(GROWTH_SUFFIX) && !u.id.endsWith(FLAT_SUFFIX),
      );
      if (otherUpgrades.length > 0) {
        y += 6;
        this.add.text(40, y, 'Other', {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#888888',
          fontStyle: 'bold',
        });
        y += 18;
        for (const upgrade of otherUpgrades) {
          this.drawUpgradeRow(upgrade, y);
          y += ROW_H_NAMED;
        }
      }
    } else {
      for (const upgrade of upgrades) {
        this.drawUpgradeRow(upgrade, y);
        y += ROW_H_NAMED;
      }
    }
  }

  drawUpgradeRow(upgrade, y) {
    const meta = this.meta;
    const level = meta.getUpgradeLevel(upgrade.id);
    const maxed = meta.isMaxed(upgrade.id);
    const affordable = meta.canAfford(upgrade.id);
    const hidden = level === 0 && meta.isMilestoneLocked(upgrade);
    const isStatUpgrade = upgrade.id.endsWith(GROWTH_SUFFIX) || upgrade.id.endsWith(FLAT_SUFFIX);
    const { current, next } = this._getValueTexts(upgrade, level);

    if (isStatUpgrade) {
      // Stat row: [Label] [Bar] [Desc] [Current → Next] [Cost]
      const labelX = 50;
      const barX = 100;
      const descX = barX + (BAR_SEGMENT_W + BAR_GAP) * upgrade.maxLevel + 10;
      const valuesX = 370;
      const costX = 530;

      const statLabel = this.add.text(labelX, y, hidden ? '???' : this._getStatLabel(upgrade), {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#e0e0e0',
      });
      const tooltipTab = this.activeTab;
      statLabel.setInteractive({ useHandCursor: true });
      statLabel.on('pointerover', () => {
        statLabel.setColor('#ffdd44');
        const tipLines = hidden
          ? this._getPrerequisiteTooltipLines(upgrade.id)
          : this._getUpgradeTooltipLines(upgrade);
        this._showUpgradeTooltip(labelX, y, tipLines, tooltipTab);
      });
      statLabel.on('pointerout', () => {
        statLabel.setColor('#e0e0e0');
        this._hideMetaTooltips();
      });
      if (hidden) {
        statLabel.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0 || !isTouchPointer(pointer)) return;
          this._toggleTouchTooltip(`hidden-label:${upgrade.id}:${tooltipTab}`, 'upgrade', () => {
            this._showUpgradeTooltip(
              labelX,
              y,
              this._getPrerequisiteTooltipLines(upgrade.id),
              tooltipTab,
            );
          });
        });
      }

      this._drawProgressBar(barX, y + 2, level, upgrade.maxLevel, maxed, upgrade, hidden);

      this.add.text(descX, y, hidden ? 'Requirements not met' : this._getActionDesc(upgrade), {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#888888',
        wordWrap: { width: 160 },
      });

      if (!hidden) {
        this._drawValueText(valuesX, y, current, next, maxed);
      }
      if (this.refundMode) {
        this._drawRefundButton(costX, y, upgrade);
      } else {
        this._drawCostButton(costX, y, upgrade, maxed, affordable);
      }
    } else {
      // Named row: [Name] [Bar] [Current → Next] [Cost]
      //            [Description below]
      const labelX = 50;
      const barX = 220;
      const valuesX = barX + (BAR_SEGMENT_W + BAR_GAP) * upgrade.maxLevel + 10;
      const costX = 530;

      const nameLabel = this.add.text(labelX, y, hidden ? '???' : upgrade.name, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#e0e0e0',
      });
      const tooltipTab = this.activeTab;
      nameLabel.setInteractive({ useHandCursor: true });
      nameLabel.on('pointerover', () => {
        nameLabel.setColor('#ffdd44');
        const tipLines = hidden
          ? this._getPrerequisiteTooltipLines(upgrade.id)
          : this._getUpgradeTooltipLines(upgrade);
        this._showUpgradeTooltip(labelX, y, tipLines, tooltipTab);
      });
      nameLabel.on('pointerout', () => {
        nameLabel.setColor('#e0e0e0');
        this._hideMetaTooltips();
      });
      if (hidden) {
        nameLabel.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0 || !isTouchPointer(pointer)) return;
          this._toggleTouchTooltip(`hidden-label:${upgrade.id}:${tooltipTab}`, 'upgrade', () => {
            this._showUpgradeTooltip(
              labelX,
              y,
              this._getPrerequisiteTooltipLines(upgrade.id),
              tooltipTab,
            );
          });
        });
      }

      this._drawProgressBar(barX, y + 2, level, upgrade.maxLevel, maxed, upgrade, hidden);

      if (!hidden) {
        this._drawValueText(valuesX, y, current, next, maxed);
      }

      this.add.text(
        labelX + 10,
        y + 16,
        hidden ? 'Requirements not met' : this._getActionDesc(upgrade),
        {
          fontFamily: 'monospace',
          fontSize: '9px',
          color: '#666666',
          wordWrap: { width: 200 },
        },
      );

      if (this.refundMode) {
        this._drawRefundButton(costX, y, upgrade);
      } else {
        this._drawCostButton(costX, y, upgrade, maxed, affordable);
      }
    }
  }

  _drawCostButton(x, y, upgrade, maxed, affordable) {
    if (maxed) {
      this.add.text(x, y, 'MAX', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffdd44',
      });
      return;
    }

    const prereqsMet = this.meta.meetsPrerequisites(upgrade.id);

    if (!prereqsMet) {
      const lockText = this.add
        .text(x, y, 'LOCKED', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#aa4444',
          backgroundColor: '#221111',
          padding: { x: 6, y: 2 },
        })
        .setInteractive();
      const tooltipTab = this.activeTab;

      // Tooltip on hover showing missing prerequisites
      lockText.on('pointerover', () => {
        this._showPrereqTooltip(x, y, upgrade.id, tooltipTab);
      });
      lockText.on('pointerout', () => {
        this._hideMetaTooltips();
      });
      lockText.on('pointerdown', (pointer) => {
        if (pointer?.button !== 0 || !isTouchPointer(pointer)) return;
        this._toggleTouchTooltip(`locked:${upgrade.id}:${tooltipTab}`, 'prereq', () => {
          this._showPrereqTooltip(x, y, upgrade.id, tooltipTab);
        });
      });
      return;
    }

    const cost = this.meta.getNextCost(upgrade.id);
    const currency = this.meta.getCurrencyForUpgrade(upgrade.id);
    const suffix = currency === 'valor' ? 'V' : 'S';
    const btnColor = affordable ? '#88ff88' : '#555555';
    const btn = this.add.text(x, y, `${cost}${suffix}`, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: btnColor,
      backgroundColor: affordable ? '#334433' : '#222222',
      padding: { x: 6, y: 2 },
    });

    if (affordable) {
      btn.setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setColor('#ffdd44'));
      btn.on('pointerout', () => btn.setColor(btnColor));
      btn.on('pointerdown', () => {
        if (this.meta.purchaseUpgrade(upgrade.id)) {
          const audio = this.registry.get('audio');
          if (audio) audio.playSFX('sfx_confirm');
          this.drawUI();
        }
      });
    }
  }

  _drawProgressBar(x, y, level, maxLevel, maxed, upgrade, hidden = false) {
    for (let i = 0; i < maxLevel; i++) {
      const filled = i < level;
      const color = filled ? (maxed ? BAR_FILLED_MAX : BAR_FILLED) : BAR_EMPTY;
      const rect = this.add.rectangle(
        x + i * (BAR_SEGMENT_W + BAR_GAP) + BAR_SEGMENT_W / 2,
        y + BAR_SEGMENT_H / 2,
        BAR_SEGMENT_W,
        BAR_SEGMENT_H,
        color,
      );

      if (upgrade && !hidden) {
        rect.setInteractive({ useHandCursor: false });
        const tierIndex = i;
        const tooltipTab = this.activeTab;
        rect.on('pointerover', () => {
          if (this.activeTab !== tooltipTab) return;
          if (this._tierTooltip) {
            this._tierTooltip.destroy();
            this._tierTooltip = null;
          }
          const tierNum = tierIndex + 1;
          const owned = tierIndex < level;
          const isNext = tierIndex === level;
          const status = owned ? ' (Owned)' : isNext ? ' (Next)' : '';
          const effect = this._formatEffectValue(upgrade.effects[tierIndex]);
          const cost = upgrade.costs?.[tierIndex];
          const currency = this.meta.getCurrencyForUpgrade(upgrade.id);
          const suffix = currency === 'valor' ? 'V' : 'S';
          const costLine =
            cost != null ? (owned ? `Paid: ${cost}${suffix}` : `Cost: ${cost}${suffix}`) : '';
          const lines = [`Tier ${tierNum}/${maxLevel}${status}`, effect, costLine].filter(Boolean);
          const tipText = lines.join('\n');

          const tipH = lines.length * 12 + 8; // ~12px per line + padding
          const tipX = rect.x;
          const above = y - tipH - 2;
          const below = y + BAR_SEGMENT_H + 6;
          let tipY = above >= TAB_CONTENT_TOP_Y ? above : below;
          if (tipY + tipH > TAB_CONTENT_BOTTOM_Y)
            tipY = Math.max(TAB_CONTENT_TOP_Y, TAB_CONTENT_BOTTOM_Y - tipH);

          this._tierTooltip = this.add
            .text(tipX, tipY, tipText, {
              fontFamily: 'monospace',
              fontSize: '9px',
              color: '#dddddd',
              backgroundColor: '#111122ee',
              padding: { x: 6, y: 4 },
            })
            .setOrigin(0.5, 0)
            .setDepth(950);
        });
        rect.on('pointerout', () => {
          this._hideTierTooltip();
        });
      }
    }
  }

  _getPrerequisiteTooltipLines(upgradeId) {
    const info = this.meta.getPrerequisiteInfo(upgradeId);
    if (!info?.missing?.length) return ['Requirements not met'];
    return ['Requires:', ...info.missing.map((missing) => `  ${missing}`)];
  }

  _getStatLabel(upgrade) {
    const effect = upgrade.effects[0];
    if (effect.recruitGrowth) return effect.recruitGrowth;
    if (effect.lordGrowth) return effect.lordGrowth;
    if (effect.stat) return effect.stat;
    if (effect.lordStat) return effect.lordStat;
    return upgrade.name;
  }

  _formatEffectValue(effect) {
    if (effect.recruitGrowth !== undefined || effect.lordGrowth !== undefined)
      return `+${effect.growthValue}%`;
    if (effect.stat !== undefined || effect.lordStat !== undefined) return `+${effect.value}`;
    if (effect.goldBonus !== undefined) return `+${effect.goldBonus}G`;
    if (effect.battleGoldMultiplier !== undefined)
      return `+${Math.round(effect.battleGoldMultiplier * 100)}%`;
    if (effect.extraVulnerary !== undefined) return `+${effect.extraVulnerary}`;
    if (effect.lootWeaponQualityBonus !== undefined) return `+${effect.lootWeaponQualityBonus}%`;
    if (effect.lootWeaponWeightBonus !== undefined) return `+${effect.lootWeaponWeightBonus}%`;
    if (effect.lootCategoryWeightBonuses !== undefined) {
      const display = this._formatLootCategoryBonuses(effect.lootCategoryWeightBonuses);
      if (display) return display;
    }
    if (effect.lordRecruitChanceBonus !== undefined)
      return `+${Math.round(effect.lordRecruitChanceBonus * 100)}%`;
    if (effect.recruitPromotionChanceBonus !== undefined)
      return `+${Math.round(effect.recruitPromotionChanceBonus * 100)}%`;
    if (effect.deployBonus !== undefined) return `+${effect.deployBonus}`;
    if (effect.rosterCapBonus !== undefined) return `+${effect.rosterCapBonus}`;
    if (effect.recruitStartingVulnerary !== undefined) return `+${effect.recruitStartingVulnerary}`;
    if (effect.extraStartingUnitTier !== undefined)
      return (
        EXTRA_STARTER_TIER_LABELS[effect.extraStartingUnitTier] ||
        `Tier ${effect.extraStartingUnitTier}`
      );
    if (effect.lethalArmoryTier !== undefined) return `Tier ${effect.lethalArmoryTier}`;
    if (effect.startingWeaponForge !== undefined) return `+${effect.startingWeaponForge}`;
    if (effect.deadlyArsenalTier !== undefined) return `Tier ${effect.deadlyArsenalTier}`;
    if (effect.deadlyArsenal !== undefined) return 'Tier 2';
    if (effect.recruitRandomSkill) return '+1 random combat skill';
    if (effect.startingAccessoryTier !== undefined)
      return STARTING_ACCESSORY_TIERS[effect.startingAccessoryTier] || '?';
    if (effect.startingStaffTier !== undefined)
      return STARTING_STAFF_TIERS[effect.startingStaffTier] || '?';
    if (effect.unlockSkill !== undefined) return 'Unlocked';
    if (effect.masterOfArms) return 'Enabled';
    if (effect.thirdLordMode !== undefined) {
      const labels = {
        random: 'Random lord',
        pick3: 'Pick 1 of 3',
        pick3_reroll: '+ Reroll',
        pick_all: 'Pick any lord',
      };
      return labels[effect.thirdLordMode] || '?';
    }
    return '?';
  }

  _getValueTexts(upgrade, level) {
    const current = level > 0 ? this._formatEffectValue(upgrade.effects[level - 1]) : null;
    const next = level < upgrade.maxLevel ? this._formatEffectValue(upgrade.effects[level]) : null;
    return { current, next };
  }

  _drawValueText(x, y, current, next, maxed) {
    if (maxed) {
      this.add.text(x, y, current, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffdd44',
      });
    } else if (current) {
      // current → next
      const curText = this.add.text(x, y, current, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#aaaaaa',
      });
      const arrowX = x + curText.width + 4;
      const arrowText = this.add.text(arrowX, y, '\u2192', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#666666',
      });
      this.add.text(arrowX + arrowText.width + 4, y, next, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#88ff88',
      });
    } else {
      // unpurchased — show next only
      this.add.text(x, y, next, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#88ff88',
      });
    }
  }

  _getActionDesc(upgrade) {
    const effect = upgrade?.effects ? upgrade.effects[0] : upgrade || {};
    const weaponArtUnlockText = this._getWeaponArtUnlockText(effect);
    if (effect.recruitGrowth !== undefined) return `${effect.recruitGrowth} growth rate`;
    if (effect.lordGrowth !== undefined) return `${effect.lordGrowth} growth rate`;
    if (effect.stat !== undefined) return `Base ${effect.stat}`;
    if (effect.lordStat !== undefined) return `Base ${effect.lordStat}`;
    if (effect.goldBonus !== undefined) return 'Starting gold bonus';
    if (effect.battleGoldMultiplier !== undefined) return 'Battle gold bonus';
    if (effect.extraVulnerary !== undefined) return 'Starting Vulnerary';
    if (effect.lootCategoryWeightBonuses !== undefined) {
      const desc = this._getLootCategoryBonusesDesc(effect.lootCategoryWeightBonuses);
      if (desc) return desc;
    }
    if (effect.lootWeaponQualityBonus !== undefined) return 'Higher chance for upgraded weapons';
    if (effect.lootWeaponWeightBonus !== undefined) return 'Higher chance for upgraded weapons';
    if (effect.lordRecruitChanceBonus !== undefined) return 'Lord recruit probability';
    if (effect.recruitPromotionChanceBonus !== undefined) return 'Recruit promotion probability';
    if (effect.deployBonus !== undefined) return 'Deploy slots';
    if (effect.rosterCapBonus !== undefined) return 'Max roster size';
    if (effect.recruitStartingVulnerary !== undefined) return 'Recruits start with Vulnerary';
    if (effect.extraStartingUnitTier !== undefined) return 'Extra random starting unit class pool';
    if (effect.lethalArmoryTier !== undefined) return 'Recruits can gain extra weapons';
    if (effect.startingWeaponForge !== undefined) return 'Forge starting weapons';
    if (effect.deadlyArsenalTier !== undefined || effect.deadlyArsenal !== undefined)
      return "Commander's starting weapon upgrades";
    if (effect.ironArms !== undefined) return 'Iron weapons can spawn with arts';
    if (effect.steelArms !== undefined) return 'Steel weapons can spawn with arts';
    if (effect.artAdept !== undefined) return 'Extra art on a lord starting weapon';
    if (effect.masterOfArms) return 'Recruits equipped for all proficiencies';
    if (effect.recruitRandomSkill) return 'Recruit starts with 1 random combat skill';
    if (effect.startingAccessoryTier !== undefined) return 'Starting accessory for your commander';
    if (effect.startingStaffTier !== undefined) {
      const selection = this._getHealedLordSelection();
      const seraSelected =
        !selection.commander || selection.commander === 'Sera' || selection.partner === 'Sera';
      return seraSelected
        ? "Sera's starting staff"
        : "Sera's starting staff (inactive: Sera not selected)";
    }
    if (effect.commanderChoiceTier !== undefined) return 'Choose your starting lords (Skills tab)';
    if (weaponArtUnlockText) return weaponArtUnlockText;
    return upgrade.description;
  }

  _getWeaponArtUnlockText(effect = {}) {
    const ids = new Set();
    const pushId = (value) => {
      if (!value) return;
      const id = String(value).trim();
      if (id) ids.add(id);
    };

    pushId(effect.unlockWeaponArt);
    if (Array.isArray(effect.unlockWeaponArts)) {
      for (const id of effect.unlockWeaponArts) pushId(id);
    }
    const hasBundleUnlock =
      effect.unlockWeaponArtsByWeaponType !== undefined &&
      effect.unlockWeaponArtsByWeaponType !== null;

    if (hasBundleUnlock && ids.size > 0) return `Unlocks ${ids.size}+ weapon arts`;
    if (hasBundleUnlock) return 'Unlocks weapon-art bundles';
    if (ids.size === 1) return 'Unlocks 1 weapon art';
    if (ids.size > 1) return `Unlocks ${ids.size} weapon arts`;
    return null;
  }

  _getUpgradeTooltipLines(upgrade) {
    if (!upgrade) return [];
    const effect = upgrade.effects?.[0];
    if (!effect) return upgrade.description ? [upgrade.description] : [];

    // Growth upgrades
    const statKey = effect.recruitGrowth || effect.lordGrowth;
    if (statKey) {
      const lines = [upgrade.name];
      const hint = STAT_GAMEPLAY_HINTS[statKey];
      lines.push(hint || upgrade.description || `${statKey} stat`);
      lines.push(GROWTH_HINT);
      return lines;
    }

    // Flat stat upgrades
    const flatKey = effect.stat || effect.lordStat;
    if (flatKey) {
      const lines = [upgrade.name];
      const hint = STAT_GAMEPLAY_HINTS[flatKey];
      lines.push(hint || upgrade.description || `${flatKey} stat`);
      lines.push(effect.lordStat ? FLAT_HINT_LORD : FLAT_HINT_RECRUIT);
      return lines;
    }

    // Named upgrades — show name + description
    if (upgrade.name && upgrade.description) {
      return [upgrade.name, upgrade.description];
    }

    return upgrade.description ? [upgrade.description] : [];
  }

  _showUpgradeTooltip(x, y, lines, expectedTab = this.activeTab) {
    if (this.activeTab !== expectedTab) return;
    this._hideUpgradeTooltip();
    if (!lines || lines.length === 0) return;
    const text = lines.join('\n');
    const tipX = Math.min(x, TAB_CONTENT_RIGHT_X - 290);

    // Render off-screen first to measure actual height (accounts for word wrap)
    const tip = this.add
      .text(tipX, -9999, text, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#dddddd',
        backgroundColor: '#111122ee',
        padding: { x: 6, y: 4 },
        wordWrap: { width: 280 },
      })
      .setDepth(950);

    const tipH = tip.height;
    const above = y - tipH - 4;
    const below = y + 20;
    let tipY = above >= TAB_CONTENT_TOP_Y ? above : below;
    if (tipY + tipH > TAB_CONTENT_BOTTOM_Y)
      tipY = Math.max(TAB_CONTENT_TOP_Y, TAB_CONTENT_BOTTOM_Y - tipH);
    tip.setY(tipY);

    this._upgradeTooltip = tip;
  }

  _showPrereqTooltip(x, y, upgradeId, expectedTab = this.activeTab) {
    if (this.activeTab !== expectedTab) return;
    this._hidePrereqTooltip();
    const lines = this._getPrerequisiteTooltipLines(upgradeId);
    if (!lines?.length) return;
    this._prereqTooltip = this.add
      .text(x - 120, y + 18, lines.join('\n'), {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#dddddd',
        backgroundColor: '#111122ee',
        padding: { x: 6, y: 4 },
        wordWrap: { width: 200 },
      })
      .setDepth(950);
  }

  _hideUpgradeTooltip() {
    if (this._upgradeTooltip) {
      this._upgradeTooltip.destroy();
      this._upgradeTooltip = null;
    }
  }

  _hidePrereqTooltip() {
    if (this._prereqTooltip) {
      this._prereqTooltip.destroy();
      this._prereqTooltip = null;
    }
  }

  _hideTierTooltip() {
    if (this._tierTooltip) {
      this._tierTooltip.destroy();
      this._tierTooltip = null;
    }
  }

  _hideMetaTooltips() {
    this._hidePrereqTooltip();
    this._hideTierTooltip();
    this._hideUpgradeTooltip();
    this._touchTooltipState = null;
  }

  _toggleTouchTooltip(targetKey, kind, showTooltip) {
    const sameTarget = this._touchTooltipState?.targetKey === targetKey;
    this._hideMetaTooltips();
    if (sameTarget) return false;
    showTooltip?.();
    const tooltipVisible =
      (kind === 'upgrade' && this._upgradeTooltip) || (kind === 'prereq' && this._prereqTooltip);
    if (tooltipVisible) {
      this._touchTooltipState = { targetKey, kind };
      return true;
    }
    return false;
  }

  _formatLootCategoryBonuses(weightBonuses) {
    if (!weightBonuses || typeof weightBonuses !== 'object') return null;
    const SHORT_LABELS = {
      skillScroll: 'Scroll',
      weaponArtScroll: 'W.Art',
      accessory: 'Accessory',
      weapon: 'Weapon',
      forge: 'Forge',
      legendaryWeapon: 'Legendary',
    };
    const entries = Object.entries(weightBonuses)
      .filter(([, value]) => Number(value) > 0)
      .map(([key]) => `+${SHORT_LABELS[key] || LOOT_CATEGORY_LABELS[key] || key}`);
    return entries.length > 0 ? entries.join(', ') : null;
  }

  _getLootCategoryBonusesDesc() {
    // Return null to fall through to upgrade.description from metaUpgrades.json
    return null;
  }

  // --- Skills tab custom layout ---

  /**
   * Saved selection healed against lords.json — a stale/corrupted name in a
   * meta save must display the pair the run will actually start with.
   */
  _getHealedLordSelection() {
    const [cmdDef, partnerDef] = resolveStartingLordDefs(
      { startingLords: this.meta?.getLordSelection?.() },
      this.gameData?.lords,
    );
    return { commander: cmdDef?.name, partner: partnerDef?.name };
  }

  _drawSkillsTab() {
    // Commander-first card order; defaults to Edric + Sera until the
    // Banner of Command selection changes it.
    const selection = this._getHealedLordSelection();
    const lords = [selection.commander, selection.partner]
      .map((name) => this.gameData.lords.find((l) => l.name === name))
      .filter(Boolean);
    const assignments = this.meta.getSkillAssignments();
    const unlocked = this.meta.getUnlockedSkills();
    const skillsData = this.gameData.skills || [];

    const offset = this._getTabScrollOffset('starting_skills');
    let y = TAB_CONTENT_TOP_Y - offset;

    // --- Starting lords section (Banner of Command) ---
    const commanderTier = this.meta.getCommanderChoiceTier();
    if (commanderTier >= 1) {
      y = this._drawCommanderSection(y, selection, commanderTier);
    }

    // --- Lord viewer section ---
    this.add.text(40, y, 'Lord Skills', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#888888',
      fontStyle: 'bold',
    });
    y += 18;

    const cardW = 270;
    const startX = 40;

    for (let li = 0; li < lords.length; li++) {
      const lord = lords[li];
      const cx = startX + li * cardW;
      const assigned = assignments[lord.name] || [];

      // Portrait slot remains legible for transparent or unusually framed art.
      const portraitKey = `portrait_lord_${lord.name.toLowerCase()}`;
      this.add.rectangle(cx + 40, y + 40, 40, 40, 0x111122, 1).setStrokeStyle(1, 0x666688);
      if (this.textures.exists(portraitKey)) {
        this.add
          .image(cx + 20, y + 20, portraitKey)
          .setDisplaySize(40, 40)
          .setOrigin(0);
      }

      // Name
      this.add.text(cx + 66, y, lord.name, {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#ffdd44',
        fontStyle: 'bold',
      });

      // Personal skill (locked)
      const personalName = lord.personalSkill.split(':')[0].trim();
      this.add.text(cx + 66, y + 16, `\u2605 ${personalName}`, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#ffcc66',
      });

      // Assignable skill slots (dynamic based on meta upgrade)
      const availableSlots = this.meta.getStartingSkillSlots();
      for (let s = 0; s < availableSlots; s++) {
        const slotY = y + 34 + s * 18;
        const skillId = assigned[s];

        if (skillId) {
          const skill = skillsData.find((sk) => sk.id === skillId);
          const skillName = skill ? skill.name : skillId;
          this.add.text(cx + 66, slotY, `\u25CB ${skillName}`, {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#88ccff',
          });

          // [x] remove button
          const removeBtn = this.add
            .text(cx + 200, slotY, '[x]', {
              fontFamily: 'monospace',
              fontSize: '10px',
              color: '#cc6666',
              backgroundColor: '#331111',
              padding: { x: 2, y: 1 },
            })
            .setInteractive({ useHandCursor: true });
          removeBtn.on('pointerover', () => removeBtn.setColor('#ff8888'));
          removeBtn.on('pointerout', () => removeBtn.setColor('#cc6666'));
          removeBtn.on('pointerdown', () => {
            this.meta.unassignSkill(lord.name, skillId);
            const audio = this.registry.get('audio');
            if (audio) audio.playSFX('sfx_cancel');
            this.drawUI();
          });
        } else {
          this.add.text(cx + 66, slotY, '\u25CB (empty)', {
            fontFamily: 'monospace',
            fontSize: '10px',
            color: '#555555',
          });

          // [+] assign button — only if there are unlocked skills to assign
          if (unlocked.length > 0) {
            const addBtn = this.add
              .text(cx + 200, slotY, '[+]', {
                fontFamily: 'monospace',
                fontSize: '10px',
                color: '#88ff88',
                backgroundColor: '#113311',
                padding: { x: 2, y: 1 },
              })
              .setInteractive({ useHandCursor: true });
            addBtn.on('pointerover', () => addBtn.setColor('#ccffcc'));
            addBtn.on('pointerout', () => addBtn.setColor('#88ff88'));
            addBtn.on('pointerdown', () => {
              this._showSkillPicker(lord.name, cx + 200, slotY);
            });
          }
        }
      }

      // Locked slot hint when 2nd slot not yet purchased
      if (availableSlots < MAX_STARTING_SKILLS) {
        const lockedSlotY = y + 34 + availableSlots * 18;
        this.add.text(cx + 66, lockedSlotY, '\u25CB Slot 2 \u2014 locked (Extra Skill Slot)', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#444444',
          wordWrap: { width: 190 },
        });
      }
    }

    y += LORD_SKILLS_CARD_H;

    // --- Skill unlock section ---
    this.add.text(40, y, 'Unlock Skills', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#888888',
      fontStyle: 'bold',
    });
    y += 18;

    const skillUpgrades = this.meta.upgradesData.filter((u) => u.category === 'starting_skills');
    for (const upgrade of skillUpgrades) {
      const level = this.meta.getUpgradeLevel(upgrade.id);
      const maxed = this.meta.isMaxed(upgrade.id);
      const affordable = this.meta.canAfford(upgrade.id);

      const labelX = 50;
      const descX = 160;
      const costX = 530;

      // Skill name — interactive with tooltip
      const baseColor = maxed ? '#88ccff' : '#e0e0e0';
      const skillLabel = this.add.text(labelX, y, upgrade.name, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: baseColor,
      });
      const tooltipTab = this.activeTab;

      // Look up skill details for tooltip
      const skillEffect = upgrade.effects?.[0];
      const skillId = skillEffect?.unlockSkill || skillEffect?.skillUnlock;
      const skillInfo = skillId ? skillsData.find((s) => s.id === skillId) : null;
      skillLabel.setInteractive({ useHandCursor: true });
      skillLabel.on('pointerover', () => {
        skillLabel.setColor('#ffdd44');
        let tipLines;
        if (skillInfo) {
          tipLines = [skillInfo.name, skillInfo.description];
          if (skillInfo.trigger) tipLines.push(`Trigger: ${skillInfo.trigger}`);
          if (skillInfo.activation) tipLines.push(`Activation: ${skillInfo.activation}`);
        } else {
          tipLines = [upgrade.name, upgrade.description].filter(Boolean);
        }
        this._showUpgradeTooltip(labelX, y, tipLines, tooltipTab);
      });
      skillLabel.on('pointerout', () => {
        skillLabel.setColor(baseColor);
        this._hideUpgradeTooltip();
      });

      // Short description
      this.add.text(descX, y, upgrade.description, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#666666',
      });

      // Cost / Unlocked / Refund
      if (this.refundMode) {
        if (maxed) {
          this._drawRefundButton(costX, y, upgrade);
        } else {
          this._drawRefundButton(costX, y, upgrade);
        }
      } else if (maxed) {
        this.add.text(costX, y, 'UNLOCKED', {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#ffdd44',
        });
      } else {
        const cost = this.meta.getNextCost(upgrade.id);
        const currency = this.meta.getCurrencyForUpgrade(upgrade.id);
        const suffix = currency === 'valor' ? 'V' : 'S';
        const btnColor = affordable ? '#88ff88' : '#555555';
        const btn = this.add.text(costX, y, `${cost}${suffix}`, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: btnColor,
          backgroundColor: affordable ? '#334433' : '#222222',
          padding: { x: 6, y: 2 },
        });
        if (affordable) {
          btn.setInteractive({ useHandCursor: true });
          btn.on('pointerover', () => btn.setColor('#ffdd44'));
          btn.on('pointerout', () => btn.setColor(btnColor));
          btn.on('pointerdown', () => {
            if (this.meta.purchaseUpgrade(upgrade.id)) {
              const audio = this.registry.get('audio');
              if (audio) audio.playSFX('sfx_confirm');
              this.drawUI();
            }
          });
        }
      }

      y += 22;
    }
  }

  _showSkillPicker(lordName, px, py) {
    // Destroy existing picker if any
    if (this._skillPickerObjects) {
      this._skillPickerObjects.forEach((o) => o.destroy());
      this._skillPickerObjects = null;
    }

    const unlocked = this.meta.getUnlockedSkills();
    const assignments = this.meta.getSkillAssignments();
    const assigned = assignments[lordName] || [];
    const skillsData = this.gameData.skills || [];

    // Skills available to assign: unlocked and not already on this lord
    const available = unlocked.filter((id) => !assigned.includes(id));
    if (available.length === 0) return;

    const objects = [];
    const bgW = 180;
    const bgH = available.length * 20 + 10;
    const bgX = Math.min(px, 440); // keep on screen
    const bgY = Math.min(py + 14, 480 - bgH - 5);

    // Background panel
    const bg = this.add
      .rectangle(bgX + bgW / 2, bgY + bgH / 2, bgW, bgH, 0x222233, 0.95)
      .setStrokeStyle(1, 0x4444aa)
      .setDepth(900);
    objects.push(bg);

    let iy = bgY + 5;
    for (const skillId of available) {
      const skill = skillsData.find((s) => s.id === skillId);
      const name = skill ? skill.name : skillId;
      const entry = this.add
        .text(bgX + 8, iy, name, {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#88ccff',
          backgroundColor: '#222233',
          padding: { x: 4, y: 2 },
        })
        .setDepth(901)
        .setInteractive({ useHandCursor: true });

      entry.on('pointerover', () => entry.setColor('#ffdd44'));
      entry.on('pointerout', () => entry.setColor('#88ccff'));
      entry.on('pointerdown', () => {
        this.meta.assignSkill(lordName, skillId);
        const audio = this.registry.get('audio');
        if (audio) audio.playSFX('sfx_confirm');
        this._destroySkillPicker();
        this.drawUI();
      });
      objects.push(entry);
      iy += 20;
    }

    // Cancel button
    const cancel = this.add
      .text(bgX + bgW - 8, bgY + 2, 'x', {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#cc6666',
      })
      .setOrigin(1, 0)
      .setDepth(901)
      .setInteractive({ useHandCursor: true });
    cancel.on('pointerdown', () => this._destroySkillPicker());
    objects.push(cancel);

    this._skillPickerObjects = objects;
    this._refreshHomeFocus?.(); // move gamepad focus into the picker
  }

  _destroySkillPicker() {
    if (this._skillPickerObjects) {
      this._skillPickerObjects.forEach((o) => o.destroy());
      this._skillPickerObjects = null;
      this._refreshHomeFocus?.(); // return focus to the base buttons
    }
  }

  // --- Commander selection (Banner of Command / Chosen Companions) ---

  _drawCommanderSection(y, selection, commanderTier) {
    this.add.text(40, y, 'Starting Lords', {
      fontFamily: 'monospace',
      fontSize: '12px',
      color: '#888888',
      fontStyle: 'bold',
    });
    y += 18;

    const drawChangeButton = (x, rowY, mode) => {
      const btn = this.add
        .text(x, rowY, '[CHANGE]', {
          fontFamily: 'monospace',
          fontSize: '10px',
          color: '#88ff88',
          backgroundColor: '#113311',
          padding: { x: 3, y: 1 },
        })
        .setInteractive({ useHandCursor: true });
      btn.on('pointerover', () => btn.setColor('#ccffcc'));
      btn.on('pointerout', () => btn.setColor('#88ff88'));
      btn.on('pointerdown', () => this._showCommanderPicker(mode));
    };

    this.add.text(50, y, `Commander: ${selection.commander}`, {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#ffdd44',
    });
    drawChangeButton(260, y, 'commander');
    y += 18;

    if (commanderTier >= 2) {
      this.add.text(50, y, `Partner: ${selection.partner}`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#e0e0e0',
      });
      drawChangeButton(260, y, 'partner');
    } else {
      this.add.text(50, y, `Partner: ${selection.partner} (locked — requires Chosen Companions)`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#555555',
      });
    }
    y += 24;
    return y;
  }

  _showCommanderPicker(mode) {
    this._destroyCommanderPicker();
    this._destroySkillPicker();
    this._hideMetaTooltips();

    const objects = [];
    const cam = this.cameras.main;
    const selection = this._getHealedLordSelection();
    const lords = this.gameData.lords || [];
    const isCommanderMode = mode === 'commander';
    const audio = this.registry.get('audio');

    const bg = this.add
      .rectangle(cam.centerX, cam.centerY, 640, 480, 0x000000, 0.92)
      .setDepth(900)
      .setInteractive();
    objects.push(bg);

    objects.push(
      this.add
        .text(cam.centerX, 26, isCommanderMode ? 'CHOOSE YOUR COMMANDER' : 'CHOOSE YOUR PARTNER', {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#ffdd44',
          fontStyle: 'bold',
        })
        .setOrigin(0.5)
        .setDepth(901),
    );
    objects.push(
      this.add
        .text(
          cam.centerX,
          46,
          isCommanderMode
            ? 'The commander leads the run — if they fall, the run ends.'
            : 'Your second starting lord.',
          { fontFamily: 'monospace', fontSize: '9px', color: '#aaaaaa' },
        )
        .setOrigin(0.5)
        .setDepth(901),
    );

    const cardW = 148;
    const cardH = 168;
    const gap = 8;
    const cols = 4;
    const rowYs = [60 + cardH / 2, 60 + cardH + 14 + cardH / 2];

    for (let i = 0; i < lords.length; i++) {
      const lord = lords[i];
      const rowIdx = Math.floor(i / cols);
      const colIdx = i % cols;
      const rowCount = Math.min(cols, lords.length - rowIdx * cols);
      const rowW = rowCount * cardW + (rowCount - 1) * gap;
      const cx = cam.centerX - rowW / 2 + cardW / 2 + colIdx * (cardW + gap);
      const cy = rowYs[rowIdx] ?? rowYs[rowYs.length - 1];

      const isCurrent = isCommanderMode
        ? selection.commander === lord.name
        : selection.partner === lord.name;
      // In partner mode the commander's card is informational only.
      const isBlocked = !isCommanderMode && selection.commander === lord.name;

      const card = this.add
        .rectangle(cx, cy, cardW, cardH, isBlocked ? 0x1a1a22 : 0x222233, 1)
        .setStrokeStyle(isCurrent ? 3 : 2, isCurrent ? 0xffdd44 : isBlocked ? 0x444444 : 0x666688)
        .setDepth(901);
      objects.push(card);

      let yOff = cy - cardH / 2 + 8;
      const portraitKey = `portrait_lord_${lord.name.toLowerCase()}`;
      objects.push(
        this.add
          .rectangle(cx, yOff + 20, 40, 40, 0x111122, 1)
          .setStrokeStyle(1, isBlocked ? 0x444444 : 0x666688)
          .setDepth(902),
      );
      if (this.textures.exists(portraitKey)) {
        objects.push(
          this.add
            .image(cx, yOff + 20, portraitKey)
            .setDisplaySize(32, 32)
            .setDepth(902),
        );
      }
      yOff += 42;

      const textColor = isBlocked ? '#777777' : '#ffffff';
      const addLine = (text, fontSize, color, dy) => {
        objects.push(
          this.add
            .text(cx, yOff, text, {
              fontFamily: 'monospace',
              fontSize,
              color,
              align: 'center',
              wordWrap: { width: cardW - 12 },
            })
            .setOrigin(0.5, 0)
            .setDepth(902),
        );
        yOff += dy;
      };

      addLine(lord.name, '12px', isBlocked ? '#999999' : '#ffdd44', 14);
      addLine(lord.class, '9px', isBlocked ? '#666666' : '#aaaaaa', 12);
      addLine(lord.weapon.replace(/\s*\((P|M)\)/g, ''), '8px', textColor, 11);
      addLine(`MOV ${lord.baseStats.MOV} · ${lord.moveType}`, '8px', '#88bbff', 11);
      const s = lord.baseStats;
      addLine(`HP${s.HP} STR${s.STR} MAG${s.MAG} SPD${s.SPD}`, '8px', textColor, 11);
      // Personal skill, full text (wrapped) — the heart of the pick
      addLine(lord.personalSkill, '8px', isBlocked ? '#776644' : '#ffcc66', 0);

      // Status tag pinned to the card's bottom edge
      const tag = isBlocked ? 'COMMANDER' : isCurrent ? 'CURRENT' : null;
      if (tag) {
        objects.push(
          this.add
            .text(cx, cy + cardH / 2 - 10, `[${tag}]`, {
              fontFamily: 'monospace',
              fontSize: '8px',
              color: isBlocked ? '#888888' : '#ffdd44',
              fontStyle: 'bold',
            })
            .setOrigin(0.5)
            .setDepth(902),
        );
      }

      if (!isBlocked) {
        card.setInteractive({ useHandCursor: true });
        card.on('pointerover', () => card.setStrokeStyle(3, 0xffffff));
        card.on('pointerout', () =>
          card.setStrokeStyle(isCurrent ? 3 : 2, isCurrent ? 0xffdd44 : 0x666688),
        );
        card.on('pointerdown', (pointer) => {
          if (pointer?.button !== 0) return;
          const ok = isCommanderMode
            ? this.meta.setCommander(lord.name)
            : this.meta.setPartner(lord.name);
          if (!ok) return;
          if (audio) audio.playSFX('sfx_confirm');
          this._destroyCommanderPicker();
          this.drawUI();
        });
      }
    }

    // Close button + hint
    const closeY = 462;
    const closeBtn = this.add
      .text(cam.centerX, closeY, '[ CLOSE ]', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#cc8888',
        backgroundColor: '#331111',
        padding: { x: 6, y: 2 },
      })
      .setOrigin(0.5)
      .setDepth(902)
      .setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ffaaaa'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#cc8888'));
    closeBtn.on('pointerdown', () => this._destroyCommanderPicker());
    objects.push(closeBtn);

    this._commanderPickerObjects = objects;
    this._refreshHomeFocus?.(); // move gamepad focus into the picker
  }

  _destroyCommanderPicker() {
    if (this._commanderPickerObjects) {
      this._commanderPickerObjects.forEach((o) => o.destroy());
      this._commanderPickerObjects = null;
      this._refreshHomeFocus?.(); // return focus to the base buttons
    }
  }

  drawBottomButtons() {
    const cx = this.cameras.main.centerX;
    const btnY = SAFE_BOTTOM_Y;

    // Refund button — label is currency-neutral; per-row buttons show V/S
    const canRefundAnything =
      this.meta.getTotalValor() >= REFUND_FEE || this.meta.getTotalSupply() >= REFUND_FEE;

    if (this.refundMode) {
      const cancelRefundBtn = this.add
        .text(cx - 190, btnY, '[ Cancel Refund ]', {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#ffdd44',
          backgroundColor: '#000000aa',
          padding: { x: 10, y: 8 },
        })
        .setOrigin(0.5)
        .setInteractive({ useHandCursor: true });
      cancelRefundBtn.on('pointerover', () => cancelRefundBtn.setColor('#ffffff'));
      cancelRefundBtn.on('pointerout', () => cancelRefundBtn.setColor('#ffdd44'));
      cancelRefundBtn.on('pointerdown', () => {
        this.refundMode = false;
        this.drawUI();
      });
    } else {
      const refundColor = canRefundAnything ? '#cc8844' : '#555555';
      const refundBtn = this.add
        .text(cx - 190, btnY, `[ Refund (${REFUND_FEE} fee) ]`, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: refundColor,
          backgroundColor: '#000000aa',
          padding: { x: 10, y: 8 },
        })
        .setOrigin(0.5);
      if (canRefundAnything) {
        refundBtn.setInteractive({ useHandCursor: true });
        refundBtn.on('pointerover', () => refundBtn.setColor('#ffdd44'));
        refundBtn.on('pointerout', () => refundBtn.setColor(refundColor));
        refundBtn.on('pointerdown', () => {
          this.refundMode = true;
          this.drawUI();
        });
      }
    }

    // Begin Run button
    const beginBtn = this.add
      .text(cx, btnY, '[ Begin Run ]', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#88ff88',
        backgroundColor: '#000000aa',
        padding: { x: 14, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    beginBtn.on('pointerover', () => beginBtn.setColor('#ffdd44'));
    beginBtn.on('pointerout', () => beginBtn.setColor('#88ff88'));
    beginBtn.on('pointerdown', async () => {
      await this.runTransition(() =>
        transitionToScene(
          this,
          'DifficultySelect',
          { gameData: this.gameData },
          { reason: TRANSITION_REASONS.BEGIN_RUN },
        ),
      );
    });

    // Back to Title button
    const backBtn = this.add
      .text(cx + 190, btnY, '[ Back to Title ]', {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#e0e0e0',
        backgroundColor: '#000000aa',
        padding: { x: 14, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    backBtn.on('pointerover', () => backBtn.setColor('#ffdd44'));
    backBtn.on('pointerout', () => backBtn.setColor('#e0e0e0'));
    backBtn.on('pointerdown', async () => {
      await this.runTransition(async () => {
        const audio = this.registry.get('audio');
        if (audio) audio.stopMusic(this, 0);
        return transitionToScene(
          this,
          'Title',
          { gameData: this.gameData },
          { reason: TRANSITION_REASONS.BACK },
        );
      });
    });
  }

  async runTransition(action) {
    const lifecycleGeneration = this._sceneLifecycleGeneration;
    if (!isSceneLifecycleActive(this, lifecycleGeneration)) return false;
    if (this.isTransitioning) return false;
    this.isTransitioning = true;
    if (this.input) this.input.enabled = false;
    try {
      await ensureAudioUnlocked(this);
      if (!isSceneLifecycleActive(this, lifecycleGeneration)) return false;
      const transitioned = await action();
      if (!isSceneLifecycleActive(this, lifecycleGeneration)) return false;
      if (transitioned) {
        const audio = this.registry.get('audio');
        if (audio) audio.playSFX('sfx_confirm');
        return true;
      }
      this.isTransitioning = false;
      if (this.input) this.input.enabled = true;
      this.showTransientMessage('Could not start transition. Try again.', '#ff8888');
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_cancel');
      return false;
    } catch (err) {
      if (!isSceneLifecycleActive(this, lifecycleGeneration)) return false;
      console.error('[HomeBaseScene] transition failed:', err);
      this.isTransitioning = false;
      if (this.input) this.input.enabled = true;
      const msg = (err?.message || '').includes('dynamically imported module')
        ? 'Update detected. Refresh page to continue.'
        : 'Transition failed. Please try again.';
      this.showTransientMessage(msg, '#ff8888');
      const audio = this.registry.get('audio');
      if (audio) audio.playSFX('sfx_cancel');
      return false;
    }
  }

  showTransientMessage(text, color = '#ff8888') {
    if (this.transientMessage) this.transientMessage.destroy();
    clearTrackedSceneTimer(this, this._transientMessageTimer);
    this._transientMessageTimer = null;
    this.transientMessage = this.add
      .text(this.cameras.main.centerX, 414, text, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color,
        backgroundColor: '#000000cc',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(950);
    this._transientMessageTimer = trackSceneTimer(
      this,
      this.time?.delayedCall?.(2200, () => {
        this._transientMessageTimer = null;
        if (this.transientMessage) {
          this.transientMessage.destroy();
          this.transientMessage = null;
        }
      }),
    );
  }

  onWheel(pointer, deltaX, deltaY) {
    if (!pointer) return;
    if (this._skillPickerObjects || this._commanderPickerObjects) return;
    if (pointer.y < TAB_CONTENT_TOP_Y || pointer.y > TAB_CONTENT_BOTTOM_Y) return;
    if ((this.tabScrollMax || 0) <= 0) return;

    const step = Math.sign(deltaY || 0) * TAB_SCROLL_STEP;
    if (!step) return;
    const key = this.activeTab;
    const current = this.tabScrollOffsets?.[key] || 0;
    const next = Phaser.Math.Clamp(current + step, 0, this.tabScrollMax || 0);
    if (next === current) return;
    this.tabScrollOffsets[key] = next;
    this.drawUI();
  }

  onPointerDown(pointer) {
    if (!isTouchPointer(pointer)) return;
    if (this._skillPickerObjects || this._commanderPickerObjects) return;
    if ((this.tabScrollMax || 0) <= 0) return;
    if (pointer.y < TAB_CONTENT_TOP_Y || pointer.y > TAB_CONTENT_BOTTOM_Y) return;
    const key = this.activeTab;
    this._touchScrollDrag = {
      key,
      startY: pointer.y,
      startOffset: this.tabScrollOffsets?.[key] || 0,
    };
  }

  onPointerMove(pointer) {
    if (!isTouchPointer(pointer)) return;
    if (!this._touchScrollDrag) return;
    const drag = this._touchScrollDrag;
    if (drag.key !== this.activeTab) return;
    const max = this.tabScrollMax || 0;
    if (max <= 0) return;
    const deltaY = pointer.y - drag.startY;
    const next = Phaser.Math.Clamp(drag.startOffset - deltaY, 0, max);
    const current = this.tabScrollOffsets?.[drag.key] || 0;
    if (next === current) return;
    this.tabScrollOffsets[drag.key] = next;
    this.drawUI();
  }

  _getTabViewportHeight() {
    return TAB_CONTENT_BOTTOM_Y - TAB_CONTENT_TOP_Y;
  }

  _estimateTabContentHeight(category) {
    if (category === 'starting_skills') {
      const skillUpgrades = this.meta.upgradesData.filter((u) => u.category === 'starting_skills');
      const commanderSection = this.meta.getCommanderChoiceTier?.() >= 1 ? 60 : 0;
      return commanderSection + 18 + LORD_SKILLS_CARD_H + 18 + skillUpgrades.length * 22;
    }

    const upgrades = this.meta.upgradesData.filter((u) => u.category === category);
    const hasSubgroups = category === 'recruit_stats' || category === 'lord_bonuses';
    if (hasSubgroups) {
      const growthUpgrades = upgrades.filter((u) => u.id.endsWith(GROWTH_SUFFIX));
      const flatUpgrades = upgrades.filter((u) => u.id.endsWith(FLAT_SUFFIX));
      const otherUpgrades = upgrades.filter(
        (u) => !u.id.endsWith(GROWTH_SUFFIX) && !u.id.endsWith(FLAT_SUFFIX),
      );
      let h = 18 + growthUpgrades.length * ROW_H + 6 + 18 + flatUpgrades.length * ROW_H;
      if (otherUpgrades.length > 0) {
        h += 6 + 18 + otherUpgrades.length * ROW_H_NAMED;
      }
      return h;
    }
    return upgrades.length * ROW_H_NAMED;
  }

  _getTabScrollOffset(category) {
    if (!this.tabScrollOffsets) this.tabScrollOffsets = {};
    const viewport = this._getTabViewportHeight();
    const content = this._estimateTabContentHeight(category);
    const max = Math.max(0, content - viewport);
    const current = this.tabScrollOffsets[category] || 0;
    const clamped = Phaser.Math.Clamp(current, 0, max);
    this.tabScrollOffsets[category] = clamped;
    if (category === this.activeTab) this.tabScrollMax = max;
    return clamped;
  }

  onPointerUp(pointer) {
    this._touchScrollDrag = null;
    if ((pointer.rightButtonDown && pointer.rightButtonDown()) || pointer.button === 2) return;
    if (isTouchPointer(pointer) && this._touchTapDown) {
      const dx = pointer.x - this._touchTapDown.x;
      const dy = pointer.y - this._touchTapDown.y;
      if (dx * dx + dy * dy > this._tapMoveThreshold * this._tapMoveThreshold) {
        this._touchTapDown = null;
        return;
      }
    }
    this._touchTapDown = null;
    const overInteractive = this._isPointerOverInteractive(pointer);
    if (isTouchPointer(pointer) && this._touchTooltipState && !overInteractive) {
      this._hideMetaTooltips();
      return;
    }
    if (overInteractive) return;
    this.requestCancel({ allowExit: false });
  }

  onPointerUpOutside(_pointer) {
    this._touchScrollDrag = null;
    this._touchTapDown = null;
  }

  _isPointerOverInteractive(pointer) {
    if (!this.input || !pointer) return false;
    let hit = [];
    if (typeof this.input.hitTestPointer === 'function') {
      hit = this.input.hitTestPointer(pointer) || [];
    } else if (this.input.manager?.hitTest) {
      hit = this.input.manager.hitTest(pointer, this.children.list, this.cameras.main) || [];
    }
    return (
      Array.isArray(hit) &&
      hit.some((obj) => obj && obj.visible !== false && obj.active !== false && obj.input?.enabled)
    );
  }

  _drawRefundButton(x, y, upgrade) {
    const level = this.meta.getUpgradeLevel(upgrade.id);
    if (level <= 0) {
      this.add.text(x, y, '---', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#444444',
      });
      return;
    }

    const check = this.meta.canRefund(upgrade.id);
    if (!check.success) {
      const reason =
        check.reason === 'blocked_by_dependent'
          ? 'BLOCKED'
          : check.reason === 'insufficient_fee'
            ? 'NO FEE'
            : 'BLOCKED';
      const blockText = this.add
        .text(x, y, reason, {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#aa4444',
          backgroundColor: '#221111',
          padding: { x: 6, y: 2 },
        })
        .setInteractive();

      blockText.on('pointerover', () => {
        const tipMsg = check.detail || check.reason;
        this._prereqTooltip = this.add
          .text(x - 120, y + 18, tipMsg, {
            fontFamily: 'monospace',
            fontSize: '9px',
            color: '#dddddd',
            backgroundColor: '#111122ee',
            padding: { x: 6, y: 4 },
            wordWrap: { width: 200 },
          })
          .setDepth(950);
      });
      blockText.on('pointerout', () => {
        if (this._prereqTooltip) {
          this._prereqTooltip.destroy();
          this._prereqTooltip = null;
        }
      });
      return;
    }

    const currency = this.meta.getCurrencyForUpgrade(upgrade.id);
    const suffix = currency === 'valor' ? 'V' : 'S';
    const tierCost = check.refundAmount;
    const btn = this.add
      .text(x, y, `[-1] +${tierCost}${suffix}`, {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#cc8844',
        backgroundColor: '#332211',
        padding: { x: 6, y: 2 },
      })
      .setInteractive({ useHandCursor: true });

    btn.on('pointerover', () => btn.setColor('#ffdd44'));
    btn.on('pointerout', () => btn.setColor('#cc8844'));
    btn.on('pointerdown', () => {
      this._showRefundConfirm(upgrade, level, tierCost, currency);
    });
  }

  _showRefundConfirm(upgrade, level, tierCost, currency) {
    this._hideRefundConfirm();
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const suffix = currency === 'valor' ? 'V' : 'S';

    // Full-screen blocker
    const blocker = this.add
      .rectangle(w / 2, h / 2, w, h, 0x000000, 0.6)
      .setDepth(850)
      .setInteractive();
    this.confirmOverlayObjects.push(blocker);

    // Panel
    const panelW = 360;
    const panelH = 100;
    const panel = this.add
      .rectangle(w / 2, h / 2, panelW, panelH, 0x111122, 0.95)
      .setStrokeStyle(2, 0xcc8844)
      .setDepth(851);
    this.confirmOverlayObjects.push(panel);

    // Message
    const msg = this.add
      .text(
        w / 2,
        h / 2 - 24,
        `Refund ${upgrade.name} tier ${level}?\nGet back ${tierCost}${suffix} (fee: ${REFUND_FEE}${suffix})`,
        {
          fontFamily: 'monospace',
          fontSize: '11px',
          color: '#dddddd',
          align: 'center',
        },
      )
      .setOrigin(0.5)
      .setDepth(851);
    this.confirmOverlayObjects.push(msg);

    // Refund button
    const confirmBtn = this.add
      .text(w / 2 - 60, h / 2 + 20, '[ Refund ]', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#cc8844',
        backgroundColor: '#332211',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(851)
      .setInteractive({ useHandCursor: true });
    confirmBtn.on('pointerover', () => confirmBtn.setColor('#ffdd44'));
    confirmBtn.on('pointerout', () => confirmBtn.setColor('#cc8844'));
    confirmBtn.on('pointerdown', () => {
      const result = this.meta.refundUpgrade(upgrade.id);
      if (result.success) {
        const audio = this.registry.get('audio');
        if (audio) audio.playSFX('sfx_confirm');
        this.refundMode = false;
        this.drawUI();
      }
    });
    this.confirmOverlayObjects.push(confirmBtn);

    // Cancel button
    const cancelBtn = this.add
      .text(w / 2 + 60, h / 2 + 20, '[ Cancel ]', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#aaaaaa',
        backgroundColor: '#222222',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(851)
      .setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setColor('#ffffff'));
    cancelBtn.on('pointerout', () => cancelBtn.setColor('#aaaaaa'));
    cancelBtn.on('pointerdown', () => {
      this._hideRefundConfirm();
    });
    this.confirmOverlayObjects.push(cancelBtn);
  }

  _hideRefundConfirm() {
    for (const obj of this.confirmOverlayObjects) {
      if (obj && typeof obj.destroy === 'function') obj.destroy();
    }
    this.confirmOverlayObjects = [];
  }

  canRequestCancel({ allowExit = true } = {}) {
    if (this.confirmOverlayObjects.length > 0) return true;
    if (this.refundMode) return true;
    if (this._skillPickerObjects) return true;
    if (this._commanderPickerObjects) return true;
    if (allowExit) return true;
    return false;
  }

  requestCancel({ allowExit = true } = {}) {
    if (this._sceneShuttingDown) return true;
    if (!this.canRequestCancel({ allowExit })) return false;
    if (this.confirmOverlayObjects.length > 0) {
      this._hideRefundConfirm();
      return true;
    }
    if (this.refundMode) {
      this.refundMode = false;
      this.drawUI();
      return true;
    }
    if (this._skillPickerObjects) {
      this._destroySkillPicker();
      return true;
    }
    if (this._commanderPickerObjects) {
      this._destroyCommanderPicker();
      return true;
    }
    if (allowExit) {
      this.runTransition(async () => {
        const audio = this.registry.get('audio');
        if (audio) audio.stopMusic(this, 0);
        return transitionToScene(
          this,
          'Title',
          { gameData: this.gameData },
          { reason: TRANSITION_REASONS.BACK },
        );
      });
      return true;
    }
    return false;
  }
}

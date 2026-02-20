// HomeBaseScene — Meta-progression upgrade shop with tabbed UI

import Phaser from 'phaser';
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
import { ensureAudioUnlocked } from '../utils/audioUnlock.js';

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
  }

  create() {
    const lifecycleGeneration = beginSceneLifecycle(this);

    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.homeBase, this);

    this.events.once('shutdown', () => HomeBaseScene.prototype._onSceneShutdown.call(this));

    this.meta = this.registry.get('meta');
    this.activeTab = 'recruit_stats';
    this.tabScrollOffsets = {};
    this.tabScrollMax = 0;
    this._touchTapDown = null;
    this._tapMoveThreshold = 12;
    this._touchScrollDrag = null;
    this.refundMode = false;
    this.confirmOverlayObjects = [];

    this._onEsc = () => this.requestCancel({ allowExit: true });
    this._onPointerDown = (pointer) => {
      this._touchTapDown = { x: pointer.x, y: pointer.y };
      this.onPointerDown(pointer);
    };
    this._onPointerMove = (pointer) => this.onPointerMove(pointer);
    this._onPointerUp = (pointer) => this.onPointerUp(pointer);
    this._onWheelHandler = (pointer, gameObjects, deltaX, deltaY) =>
      this.onWheel(pointer, deltaX, deltaY);

    this.input.keyboard.on('keydown-ESC', this._onEsc);
    this.input.on('pointerdown', this._onPointerDown);
    this.input.on('pointermove', this._onPointerMove);
    this.input.on('pointerup', this._onPointerUp);
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

    clearAllSceneTimers(this);
    this._transientMessageTimer = null;

    this.refundMode = false;
    this._hideRefundConfirm?.();
    this._hideUpgradeTooltip?.();
    this._destroySkillPicker?.();

    if (this._prereqTooltip) {
      this._prereqTooltip.destroy();
      this._prereqTooltip = null;
    }
    if (this._tierTooltip) {
      this._tierTooltip.destroy();
      this._tierTooltip = null;
    }
    if (this.transientMessage) {
      this.transientMessage.destroy();
      this.transientMessage = null;
    }

    this.input?.keyboard?.off?.('keydown-ESC', this._onEsc);
    this.input?.off?.('pointerdown', this._onPointerDown);
    this.input?.off?.('pointermove', this._onPointerMove);
    this.input?.off?.('pointerup', this._onPointerUp);
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
    if (this._prereqTooltip) {
      this._prereqTooltip.destroy();
      this._prereqTooltip = null;
    }
    if (this._tierTooltip) {
      this._tierTooltip.destroy();
      this._tierTooltip = null;
    }
    this._hideUpgradeTooltip();
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
          this._hideUpgradeTooltip();
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
    const isStatUpgrade = upgrade.id.endsWith(GROWTH_SUFFIX) || upgrade.id.endsWith(FLAT_SUFFIX);
    const { current, next } = this._getValueTexts(upgrade, level);

    if (isStatUpgrade) {
      // Stat row: [Label] [Bar] [Desc] [Current → Next] [Cost]
      const labelX = 50;
      const barX = 100;
      const descX = barX + (BAR_SEGMENT_W + BAR_GAP) * upgrade.maxLevel + 10;
      const valuesX = 370;
      const costX = 530;

      const statLabel = this.add.text(labelX, y, this._getStatLabel(upgrade), {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#e0e0e0',
      });
      const tooltipTab = this.activeTab;
      statLabel.setInteractive({ useHandCursor: true });
      statLabel.on('pointerover', () => {
        statLabel.setColor('#ffdd44');
        const tipLines = this._getUpgradeTooltipLines(upgrade);
        this._showUpgradeTooltip(labelX, y, tipLines, tooltipTab);
      });
      statLabel.on('pointerout', () => {
        statLabel.setColor('#e0e0e0');
        this._hideUpgradeTooltip();
      });

      this._drawProgressBar(barX, y + 2, level, upgrade.maxLevel, maxed, upgrade);

      this.add.text(descX, y, this._getActionDesc(upgrade), {
        fontFamily: 'monospace',
        fontSize: '10px',
        color: '#888888',
      });

      this._drawValueText(valuesX, y, current, next, maxed);
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

      const nameLabel = this.add.text(labelX, y, upgrade.name, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: '#e0e0e0',
      });
      const tooltipTab = this.activeTab;
      nameLabel.setInteractive({ useHandCursor: true });
      nameLabel.on('pointerover', () => {
        nameLabel.setColor('#ffdd44');
        const tipLines = this._getUpgradeTooltipLines(upgrade);
        this._showUpgradeTooltip(labelX, y, tipLines, tooltipTab);
      });
      nameLabel.on('pointerout', () => {
        nameLabel.setColor('#e0e0e0');
        this._hideUpgradeTooltip();
      });

      this._drawProgressBar(barX, y + 2, level, upgrade.maxLevel, maxed, upgrade);

      this._drawValueText(valuesX, y, current, next, maxed);

      this.add.text(labelX + 10, y + 16, this._getActionDesc(upgrade), {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: '#666666',
      });

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
        if (this.activeTab !== tooltipTab) return;
        const info = this.meta.getPrerequisiteInfo(upgrade.id);
        const tipText = 'Requires:\n' + info.missing.map((m) => '  ' + m).join('\n');
        this._prereqTooltip = this.add
          .text(x - 120, y + 18, tipText, {
            fontFamily: 'monospace',
            fontSize: '9px',
            color: '#dddddd',
            backgroundColor: '#111122ee',
            padding: { x: 6, y: 4 },
            wordWrap: { width: 200 },
          })
          .setDepth(950);
      });
      lockText.on('pointerout', () => {
        if (this._prereqTooltip) {
          this._prereqTooltip.destroy();
          this._prereqTooltip = null;
        }
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

  _drawProgressBar(x, y, level, maxLevel, maxed, upgrade) {
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

      if (upgrade) {
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
          if (this._tierTooltip) {
            this._tierTooltip.destroy();
            this._tierTooltip = null;
          }
        });
      }
    }
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
    if (effect.deployBonus !== undefined) return 'Deploy slots';
    if (effect.rosterCapBonus !== undefined) return 'Max roster size';
    if (effect.recruitStartingVulnerary !== undefined) return 'Recruits start with Vulnerary';
    if (effect.extraStartingUnitTier !== undefined) return 'Extra random starting unit class pool';
    if (effect.lethalArmoryTier !== undefined) return 'Recruits can gain extra weapons';
    if (effect.startingWeaponForge !== undefined) return 'Forge starting weapons';
    if (effect.deadlyArsenalTier !== undefined || effect.deadlyArsenal !== undefined)
      return 'Edric starting sword upgrades';
    if (effect.ironArms !== undefined) return 'Iron weapons can spawn with arts';
    if (effect.steelArms !== undefined) return 'Steel weapons can spawn with arts';
    if (effect.artAdept !== undefined) return 'Extra art on a lord starting weapon';
    if (effect.recruitRandomSkill) return 'Recruit starts with 1 random combat skill';
    if (effect.startingAccessoryTier !== undefined) return 'Starting accessory for Edric';
    if (effect.startingStaffTier !== undefined) return "Sera's starting staff";
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

  _hideUpgradeTooltip() {
    if (this._upgradeTooltip) {
      this._upgradeTooltip.destroy();
      this._upgradeTooltip = null;
    }
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

  _drawSkillsTab() {
    const lords = this.gameData.lords.filter((l) => l.name === 'Edric' || l.name === 'Sera');
    const assignments = this.meta.getSkillAssignments();
    const unlocked = this.meta.getUnlockedSkills();
    const skillsData = this.gameData.skills || [];

    const offset = this._getTabScrollOffset('starting_skills');
    let y = TAB_CONTENT_TOP_Y - offset;

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

      // Portrait
      const portraitKey = `portrait_lord_${lord.name.toLowerCase()}`;
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

      // Assignable skill slots
      for (let s = 0; s < MAX_STARTING_SKILLS; s++) {
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
    }

    y += 80;

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
    const bgY = py + 14;

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
  }

  _destroySkillPicker() {
    if (this._skillPickerObjects) {
      this._skillPickerObjects.forEach((o) => o.destroy());
      this._skillPickerObjects = null;
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
    if (this._skillPickerObjects) return;
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
    if (!pointer || pointer.pointerType !== 'touch') return;
    if (this._skillPickerObjects) return;
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
    if (!pointer || pointer.pointerType !== 'touch') return;
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
      return 18 + 80 + 18 + skillUpgrades.length * 22;
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
    if (pointer.pointerType === 'touch' && this._touchTapDown) {
      const dx = pointer.x - this._touchTapDown.x;
      const dy = pointer.y - this._touchTapDown.y;
      if (dx * dx + dy * dy > this._tapMoveThreshold * this._tapMoveThreshold) {
        this._touchTapDown = null;
        return;
      }
    }
    this._touchTapDown = null;
    if (this._isPointerOverInteractive(pointer)) return;
    this.requestCancel({ allowExit: false });
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
    if (allowExit) {
      const audio = this.registry.get('audio');
      if (audio) audio.stopMusic(this, 0);
      void transitionToScene(
        this,
        'Title',
        { gameData: this.gameData },
        { reason: TRANSITION_REASONS.BACK },
      );
      return true;
    }
    return false;
  }
}

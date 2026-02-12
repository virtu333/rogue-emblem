// RosterOverlay.js — Node map roster management (view stats, equip, trade, accessories)
// Follows PauseOverlay/SettingsOverlay pattern with this.objects[].

import { XP_STAT_NAMES, XP_PER_LEVEL, MAX_SKILLS, INVENTORY_MAX, CONSUMABLE_MAX } from '../utils/constants.js';
import { STAT_COLORS, UI_COLORS, getHPBarColor } from '../utils/uiStyles.js';
import {
  equipWeapon, addToInventory, removeFromInventory, isLastCombatWeapon, hasProficiency, canEquip,
  canPromote, promoteUnit, equipAccessory, unequipAccessory, resolvePromotionTargetClass,
  addToConsumables, removeFromConsumables, learnSkill,
} from '../engine/UnitManager.js';
import { isForged } from '../engine/ForgeSystem.js';
import { getStaffRemainingUses, getStaffMaxUses, parseRange, getStaticCombatStats } from '../engine/Combat.js';

const DEPTH_BG = 700;
const DEPTH_PANEL = 701;
const DEPTH_TEXT = 702;
const DEPTH_PICKER = 750;

const LIST_X = 20;
const LIST_WIDTH = 160;
const DETAIL_X = 190;
const DETAIL_WIDTH = 430;

const PANEL_TOP = 44;
const PANEL_BOTTOM = 462;
const PANEL_HEIGHT = PANEL_BOTTOM - PANEL_TOP;
const PANEL_CENTER_Y = (PANEL_TOP + PANEL_BOTTOM) / 2;

export class RosterOverlay {
  /**
   * @param {Phaser.Scene} scene
   * @param {import('../engine/RunManager.js').RunManager} runManager
   * @param {object} gameData
   * @param {{ onClose?: Function }} [callbacks]
   */
  constructor(scene, runManager, gameData, callbacks = {}) {
    this.scene = scene;
    this.runManager = runManager;
    this.gameData = gameData;
    this.onClose = callbacks.onClose || null;
    this.objects = [];
    this.detailObjects = [];
    this.tradeObjects = [];
    this.visible = false;

    // New state
    this.selection = { kind: 'unit', index: 0 };
    this._activeTab = 'stats'; // 'stats' | 'gear'
    this._convoyScrollOffset = 0;
    this._convoyScrollMax = 0;
    this._targetUnitIndex = 0; // for convoy withdraw default

    this._skillTooltip = null;
    this._weaponTooltip = null;
    this._listenersRegistered = false;
  }

  show() {
    if (this.visible) this.hide();
    this.visible = true;

    // Full-screen dark overlay (blocks clicks below)
    const bg = this.scene.add.rectangle(320, 240, 640, 480, 0x000000, 0.9)
      .setDepth(DEPTH_BG).setInteractive();
    this.objects.push(bg);

    // Header
    const title = this.scene.add.text(20, 12, 'Roster', {
      fontFamily: 'monospace', fontSize: '18px', color: '#ffdd44',
    }).setDepth(DEPTH_TEXT);
    this.objects.push(title);

    // Close button
    const closeBtn = this.scene.add.text(590, 12, '[ Close ]', {
      fontFamily: 'monospace', fontSize: '14px', color: '#e0e0e0',
      backgroundColor: '#333333', padding: { x: 8, y: 4 },
    }).setOrigin(1, 0).setDepth(DEPTH_TEXT).setInteractive({ useHandCursor: true });
    closeBtn.on('pointerover', () => closeBtn.setColor('#ffdd44'));
    closeBtn.on('pointerout', () => closeBtn.setColor('#e0e0e0'));
    closeBtn.on('pointerdown', () => this.hide());
    this.objects.push(closeBtn);

    // Divider line
    const divider = this.scene.add.rectangle(320, 38, 600, 2, 0x888888)
      .setDepth(DEPTH_TEXT);
    this.objects.push(divider);

    this._registerListeners();
    this.drawUnitList();
    this.drawUnitDetails();
  }

  hide() {
    if (!this.visible) return;
    this._unregisterListeners();
    this._destroyDetails();
    this._destroyTrade();
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
    if (this.onClose) this.onClose();
  }

  _clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  _registerListeners() {
    if (this._listenersRegistered) return;
    this._listenersRegistered = true;

    this._keyHandler = (event) => {
      if (!this.visible) return;
      
      if (event.code === 'ArrowUp') {
        this._cycleSelection(-1);
      } else if (event.code === 'ArrowDown') {
        this._cycleSelection(1);
      } else if (event.code === 'ArrowLeft' || event.code === 'ArrowRight') {
        if (this.selection.kind === 'unit') {
          this._activeTab = this._activeTab === 'stats' ? 'gear' : 'stats';
          this.drawUnitDetails();
        }
      }
    };

    const input = this.scene?.input;
    const kb = input?.keyboard;
    if (kb) kb.on('keydown', this._keyHandler);

    this._wheelHandler = (pointer, gameObjects, deltaX, deltaY) => {
      if (!this.visible || this.selection.kind !== 'convoy') return;
      if (pointer.x < DETAIL_X) return; // Only scroll in detail panel

      const step = Math.sign(deltaY) * 20;
      this._convoyScrollOffset = this._clamp(
        this._convoyScrollOffset + step,
        0,
        this._convoyScrollMax
      );
      this.drawUnitDetails();
    };
    if (input?.on) {
      input.on('wheel', this._wheelHandler);
    }

    // Touch/Drag handlers
    this._dragStart = null;
    this._pointerDownHandler = (pointer) => {
      if (!this.visible || this.selection.kind !== 'convoy') return;
      if (pointer.x < DETAIL_X) return;
      this._dragStart = { y: pointer.y, offset: this._convoyScrollOffset };
    };
    this._pointerMoveHandler = (pointer) => {
      if (!this._dragStart || !pointer.isDown) return;
      const dy = this._dragStart.y - pointer.y;
      this._convoyScrollOffset = this._clamp(
        this._dragStart.offset + dy,
        0,
        this._convoyScrollMax
      );
      this.drawUnitDetails();
    };
    this._pointerUpHandler = () => {
      this._dragStart = null;
    };

    if (input?.on) {
      input.on('pointerdown', this._pointerDownHandler);
      input.on('pointermove', this._pointerMoveHandler);
      input.on('pointerup', this._pointerUpHandler);
    }
  }

  _unregisterListeners() {
    if (!this._listenersRegistered) return;
    const input = this.scene?.input;
    const kb = input?.keyboard;
    if (kb) kb.off('keydown', this._keyHandler);
    if (input?.off) {
      input.off('wheel', this._wheelHandler);
      input.off('pointerdown', this._pointerDownHandler);
      input.off('pointermove', this._pointerMoveHandler);
      input.off('pointerup', this._pointerUpHandler);
    }
    this._listenersRegistered = false;
  }

  _cycleSelection(dir) {
    const rosterCount = this.runManager.roster.length;
    const totalCount = rosterCount + 1; // units + convoy
    
    let currentIndex = this.selection.kind === 'unit' ? this.selection.index : rosterCount;
    let nextIndex = (currentIndex + dir + totalCount) % totalCount;

    if (nextIndex < rosterCount) {
      this.select('unit', nextIndex);
    } else {
      this.select('convoy');
    }
  }

  select(kind, index = 0) {
    if (kind === 'unit') {
      const rosterCount = this.runManager.roster.length;
      if (rosterCount <= 0) {
        this.selection = { kind: 'convoy' };
      } else {
        const clamped = this._clamp(index, 0, rosterCount - 1);
        this.selection = { kind: 'unit', index: clamped };
        this._targetUnitIndex = clamped;
      }
    } else {
      this.selection = { kind: 'convoy' };
      this._convoyScrollOffset = 0;
    }
    this.drawUnitList();
    this.drawUnitDetails();
  }

  // --- Left panel: unit list ---

  drawUnitList() {
    // Remove old list objects (tagged)
    this.objects = this.objects.filter(o => {
      if (o._rosterList) { o.destroy(); return false; }
      return true;
    });

    const roster = this.runManager.roster;
    const startY = 50;
    const entryH = 42;

    // List background
    const listBg = this.scene.add.rectangle(
      LIST_X + LIST_WIDTH / 2, PANEL_CENTER_Y, LIST_WIDTH, PANEL_HEIGHT, 0x1a1a2e
    ).setDepth(DEPTH_PANEL).setStrokeStyle(1, 0x444444);
    listBg._rosterList = true;
    this.objects.push(listBg);

    // 1. Draw units
    for (let i = 0; i < roster.length; i++) {
      const unit = roster[i];
      const y = startY + i * entryH;
      const isSelected = this.selection.kind === 'unit' && this.selection.index === i;

      // Hit area
      const hitZone = this.scene.add.rectangle(
        LIST_X + LIST_WIDTH / 2, y + entryH / 2, LIST_WIDTH - 4, entryH - 2,
        isSelected ? 0x333355 : 0x000000, isSelected ? 1 : 0
      ).setDepth(DEPTH_PANEL + 1).setInteractive({ useHandCursor: true });
      hitZone._rosterList = true;

      // Name
      const nameColor = isSelected ? '#ffdd44' : '#e0e0e0';
      const nameText = this.scene.add.text(LIST_X + 8, y + 4,
        `${unit.name}  Lv${unit.level}`, {
        fontFamily: 'monospace', fontSize: '11px', color: nameColor,
      }).setDepth(DEPTH_TEXT);
      nameText._rosterList = true;

      // HP bar
      const barW = LIST_WIDTH - 50;
      const barH = 6;
      const barX = LIST_X + 10;
      const barY = y + 22;
      const ratio = unit.currentHP / unit.stats.HP;

      const barBg = this.scene.add.rectangle(barX + barW / 2, barY + barH / 2, barW, barH, 0x333333)
        .setDepth(DEPTH_TEXT);
      barBg._rosterList = true;
      const barFill = this.scene.add.rectangle(
        barX + (barW * ratio) / 2, barY + barH / 2,
        barW * ratio, barH, getHPBarColor(ratio)
      ).setDepth(DEPTH_TEXT);
      barFill._rosterList = true;

      const hpText = this.scene.add.text(LIST_X + LIST_WIDTH - 6, barY - 3,
        `${unit.currentHP}/${unit.stats.HP}`, {
        fontFamily: 'monospace', fontSize: '8px', color: '#aaaaaa',
      }).setOrigin(1, 0).setDepth(DEPTH_TEXT);
      hpText._rosterList = true;

      hitZone.on('pointerdown', () => this.select('unit', i));
      hitZone.on('pointerover', () => {
        if (!isSelected) nameText.setColor('#ffdd44');
      });
      hitZone.on('pointerout', () => {
        if (!isSelected) nameText.setColor('#e0e0e0');
      });

      this.objects.push(hitZone, nameText, barBg, barFill, hpText);
    }

    // 2. Draw Convoy entry
    const convoyY = startY + roster.length * entryH;
    const isConvoySelected = this.selection.kind === 'convoy';
    const convoyHitZone = this.scene.add.rectangle(
      LIST_X + LIST_WIDTH / 2, convoyY + entryH / 2, LIST_WIDTH - 4, entryH - 2,
      isConvoySelected ? 0x333355 : 0x000000, isConvoySelected ? 1 : 0
    ).setDepth(DEPTH_PANEL + 1).setInteractive({ useHandCursor: true });
    convoyHitZone._rosterList = true;

    const convoyColor = isConvoySelected ? '#ffdd44' : '#88ccff';
    const convoyText = this.scene.add.text(LIST_X + 8, convoyY + 12, 'Convoy Management', {
      fontFamily: 'monospace', fontSize: '11px', color: convoyColor,
    }).setDepth(DEPTH_TEXT);
    convoyText._rosterList = true;

    convoyHitZone.on('pointerdown', () => this.select('convoy'));
    convoyHitZone.on('pointerover', () => {
      if (!isConvoySelected) convoyText.setColor('#ffdd44');
    });
    convoyHitZone.on('pointerout', () => {
      if (!isConvoySelected) convoyText.setColor('#88ccff');
    });

    this.objects.push(convoyHitZone, convoyText);
  }

  // --- Right panel: unit details ---

  _destroyDetails() {
    this._hideSkillTooltip();
    this._hideWeaponSpecialTooltip();
    for (const obj of this.detailObjects) obj.destroy();
    this.detailObjects = [];
  }

  drawUnitDetails() {
    this._destroyDetails();
    this._destroyTrade();

    // Detail panel background
    const detailBg = this.scene.add.rectangle(
      DETAIL_X + DETAIL_WIDTH / 2, PANEL_CENTER_Y, DETAIL_WIDTH, PANEL_HEIGHT, 0x1a1a2e
    ).setDepth(DEPTH_PANEL).setStrokeStyle(1, 0x444444);
    this.detailObjects.push(detailBg);

    if (this.selection.kind === 'unit') {
      this._drawUnitDetail();
    } else {
      this._drawConvoyDetail();
    }
  }

  _drawUnitDetail() {
    const unit = this.runManager.roster[this.selection.index];
    if (!unit) return;

    let y = 50;
    const x = DETAIL_X + 12;

    // --- Fixed Header ---
    const tierLabel = unit.tier === 'promoted' ? 'Promoted' : 'Base';
    this._text(x, y, `${unit.name}  Lv${unit.level} ${unit.className}  (${tierLabel})`, '#ffdd44', '12px');

    // Portrait
    const portraitKey = this._getPortraitKey(unit);
    if (portraitKey && this.scene.textures.exists(portraitKey)) {
      const portrait = this.scene.add.image(
        DETAIL_X + DETAIL_WIDTH - 36, y + 20, portraitKey
      ).setDisplaySize(48, 48).setDepth(DEPTH_TEXT);
      this.detailObjects.push(portrait);
    }

    y += 18;
    if (unit.xp !== undefined) {
      this._text(x, y, `XP: ${unit.xp}/${XP_PER_LEVEL}`, '#88ccff', '10px');
      y += 14;
    }

    // HP Bar
    const barW = 180;
    const barH = 8;
    const ratio = unit.currentHP / unit.stats.HP;
    const barBg = this.scene.add.rectangle(x, y + 4, barW, barH, 0x333333).setOrigin(0, 0.5).setDepth(DEPTH_TEXT);
    const barFill = this.scene.add.rectangle(x, y + 4, barW * ratio, barH, getHPBarColor(ratio)).setOrigin(0, 0.5).setDepth(DEPTH_TEXT);
    const hpText = this._text(x + barW + 8, y, `${unit.currentHP}/${unit.stats.HP}`, STAT_COLORS.HP, '10px');
    this.detailObjects.push(barBg, barFill);
    y += 20;

    // --- Navigation Arrows ---
    const navX = DETAIL_X + DETAIL_WIDTH - 85;
    const navY = 50;
    
    // Unit navigation
    const upArrow = this.scene.add.text(navX, navY + 6, '\u25b2', {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffdd44',
    }).setOrigin(0.5).setDepth(DEPTH_TEXT).setInteractive({ useHandCursor: true });
    upArrow.on('pointerdown', () => this._cycleSelection(-1));
    this.detailObjects.push(upArrow);

    const downArrow = this.scene.add.text(navX, navY + 40, '\u25bc', {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffdd44',
    }).setOrigin(0.5).setDepth(DEPTH_TEXT).setInteractive({ useHandCursor: true });
    downArrow.on('pointerdown', () => this._cycleSelection(1));
    this.detailObjects.push(downArrow);

    // --- Tab Buttons ---
    this._drawTabButtons(x, y);
    y += 28;

    // --- Tab Content ---
    if (this._activeTab === 'stats') {
      this._drawStatsTab(x, y, unit);
    } else {
      this._drawGearTab(x, y, unit);
    }

    // --- Fixed Footer Actions ---
    const footerY = PANEL_BOTTOM - 25;
    if (this.runManager.roster.length > 1) {
      this._actionBtn(x, footerY, '[ Trade ]', () => this._showTradePicker(unit), '12px');
    }
  }

  _drawTabButtons(x, y) {
    const tabW = 80;
    const tabH = 18;
    const gap = 8;

    // Stats tab
    const isStats = this._activeTab === 'stats';
    const statsBtn = this.scene.add.rectangle(x + tabW / 2, y + tabH / 2, tabW, tabH, isStats ? 0x443300 : 0x222233)
      .setDepth(DEPTH_TEXT).setStrokeStyle(1, isStats ? 0xffdd44 : 0x666666).setInteractive({ useHandCursor: true });
    const statsLabel = this.scene.add.text(x + tabW / 2, y + tabH / 2, 'Stats', {
      fontFamily: 'monospace', fontSize: '10px', color: isStats ? '#ffffff' : '#888888',
    }).setOrigin(0.5).setDepth(DEPTH_TEXT + 1);
    statsBtn.on('pointerdown', () => { this._activeTab = 'stats'; this.drawUnitDetails(); });
    this.detailObjects.push(statsBtn, statsLabel);

    // Gear tab
    const gx = x + tabW + gap;
    const isGear = this._activeTab === 'gear';
    const gearBtn = this.scene.add.rectangle(gx + tabW / 2, y + tabH / 2, tabW, tabH, isGear ? 0x443300 : 0x222233)
      .setDepth(DEPTH_TEXT).setStrokeStyle(1, isGear ? 0xffdd44 : 0x666666).setInteractive({ useHandCursor: true });
    const gearLabel = this.scene.add.text(gx + tabW / 2, y + tabH / 2, 'Gear', {
      fontFamily: 'monospace', fontSize: '10px', color: isGear ? '#ffffff' : '#888888',
    }).setOrigin(0.5).setDepth(DEPTH_TEXT + 1);
    gearBtn.on('pointerdown', () => { this._activeTab = 'gear'; this.drawUnitDetails(); });
    this.detailObjects.push(gearBtn, gearLabel);

    // Tab cycle arrows (visible hint)
    this._text(gx + tabW + gap + 4, y + 4, '\u25c4 \u25ba', UI_COLORS.gray, '10px');
  }

  _drawStatsTab(x, y, unit) {
    const col2X = x + 160;

    // Stats
    this._text(x, y, '\u2500\u2500 Attributes \u2500\u2500', '#888888', '10px');
    y += 14;

    const leftStats = ['STR', 'MAG', 'SKL', 'SPD'];
    const rightStats = ['DEF', 'RES', 'LCK', 'MOV'];
    for (let s = 0; s < leftStats.length; s++) {
      const ls = leftStats[s];
      const rs = rightStats[s];
      const lVal = ls === 'MOV' ? (unit.mov || unit.stats.MOV) : unit.stats[ls];
      const rVal = rs === 'MOV' ? (unit.mov || unit.stats.MOV) : unit.stats[rs];
      this._text(x, y, `${ls.padEnd(4)}${String(lVal).padStart(3)}`, STAT_COLORS[ls], '10px');
      this._text(col2X, y, `${rs.padEnd(4)}${String(rVal).padStart(3)}`, STAT_COLORS[rs], '10px');
      y += 13;
    }

    // Effective Stats
    y += 6;
    const combat = getStaticCombatStats(unit, unit.weapon);
    this._text(x, y, `Atk ${String(combat.atk).padStart(3)}`, '#ffffff', '10px');
    this._text(col2X, y, `AS  ${String(combat.as).padStart(3)}`, (combat.as < unit.stats.SPD ? '#ff6666' : '#ffffff'), '10px');
    y += 16;

    // Proficiencies
    this._text(x, y, '\u2500\u2500 Proficiencies \u2500\u2500', '#888888', '10px');
    y += 14;
    if (unit.proficiencies && unit.proficiencies.length > 0) {
      const profStr = unit.proficiencies.map(p => `${p.type}(${p.rank[0]})`).join('  ');
      this._text(x, y, profStr, '#aaaacc', '10px');
      y += 16;
    } else {
      this._text(x, y, '(none)', '#888888', '10px');
      y += 16;
    }

    // Growths
    if (unit.faction !== 'enemy' && unit.growths) {
      this._text(x, y, '\u2500\u2500 Growths \u2500\u2500', '#888888', '10px');
      y += 14;
      const growthPairs = XP_STAT_NAMES.map(s => `${s}:${unit.growths[s] || 0}`);
      for (let i = 0; i < growthPairs.length; i += 4) {
        this._text(x, y, growthPairs.slice(i, i + 4).join('  '), '#888888', '9px');
        y += 12;
      }
    }
  }

  _drawGearTab(x, y, unit) {
    // Inventory
    this._text(x, y, '\u2500\u2500 Equipment \u2500\u2500', '#888888', '10px');
    y += 14;

    if (unit.inventory.length === 0) {
      this._text(x + 8, y, '(empty)', '#888888', '10px');
      y += 14;
    } else {
      for (const item of unit.inventory) {
        const isEquipped = item === unit.weapon;
        const marker = isEquipped ? '\u25b6 ' : '  ';
        let label;
        if (item.type === 'Staff') {
          const rem = getStaffRemainingUses(item, unit);
          const max = getStaffMaxUses(item, unit);
          const rng = parseRange(item.range);
          const rngStr = rng.min === rng.max ? `Rng${rng.max}` : `Rng${rng.min}-${rng.max}`;
          label = `${marker}${item.name} (${rem}/${max}) ${rngStr}`;
        } else if (item.might !== undefined) {
          const rng = parseRange(item.range);
          const rngStr = rng.min === rng.max ? `Rng${rng.max}` : `Rng${rng.min}-${rng.max}`;
          label = `${marker}${item.name} Mt${item.might} Ht${item.hit} Cr${item.crit} Wt${item.weight} ${rngStr}`;
        } else {
          label = `${marker}${item.name}`;
        }

        const color = isForged(item) ? '#44ff88' : '#e0e0e0';
        const weaponText = this._text(x, y, label, color, '9px');
        if (item.special) {
          weaponText.setInteractive({ useHandCursor: true });
          weaponText.on('pointerover', () => this._showWeaponSpecialTooltip(item, weaponText));
          weaponText.on('pointerout', () => this._hideWeaponSpecialTooltip());
        }

        const btnX = x + 280;
        const storeX = x + 340;
        if (!isEquipped && canEquip(unit, item)) {
          this._actionBtn(btnX, y, '[Equip]', () => {
            equipWeapon(unit, item);
            this.refresh();
          });
        }
        if (!isLastCombatWeapon(unit, item) && this.runManager.canAddToConvoy(item)) {
          this._actionBtn(storeX, y, '[Store]', () => {
            if (!this.runManager.addToConvoy(item)) return;
            removeFromInventory(unit, item);
            this.refresh();
          });
        }
        y += 13;
      }
    }

    // Consumables
    y += 4;
    this._text(x, y, '\u2500\u2500 Consumables \u2500\u2500', '#888888', '10px');
    y += 14;

    const consumables = unit.consumables || [];
    if (consumables.length === 0) {
      this._text(x + 8, y, '(empty)', '#888888', '10px');
      y += 14;
    } else {
      for (const item of consumables) {
        this._text(x + 8, y, `${item.name} (${item.uses})`, '#88ff88', '9px');
        const btnX = x + 280;
        const storeX = x + 340;
        if (item.effect === 'heal' || item.effect === 'healFull') {
          if (unit.currentHP < unit.stats.HP) {
            this._actionBtn(btnX, y, '[Use]', () => this._useHealItem(unit, item));
          }
        } else if (item.effect === 'promote') {
          if (canPromote(unit) && resolvePromotionTargetClass(unit, this.gameData.classes, this.gameData.lords)) {
            this._actionBtn(btnX, y, '[Use]', () => this._usePromote(unit, item));
          }
        }
        if (this.runManager.canAddToConvoy(item)) {
          this._actionBtn(storeX, y, '[Store]', () => {
            if (!this.runManager.addToConvoy(item)) return;
            removeFromConsumables(unit, item);
            this.refresh();
          });
        }
        y += 13;
      }
    }

    // Accessory
    y += 4;
    this._text(x, y, '\u2500\u2500 Accessory \u2500\u2500', '#888888', '10px');
    y += 14;
    if (unit.accessory) {
      const acc = unit.accessory;
      this._text(x + 8, y, acc.name, '#cc88ff', '9px');
      this._actionBtn(x + 280, y, '[Unequip]', () => {
        const old = unequipAccessory(unit);
        if (old) this.runManager.accessories.push(old);
        this.refresh();
      });
      y += 13;
    } else {
      this._text(x + 8, y, '(none)', '#888888', '10px');
      y += 14;
    }

    // Skills
    if (unit.skills && unit.skills.length > 0) {
      y += 4;
      this._text(x, y, `\u2500\u2500 Skills (${unit.skills.length}/${MAX_SKILLS}) \u2500\u2500`, '#888888', '10px');
      y += 14;
      for (const sid of unit.skills) {
        const skillData = this.gameData.skills?.find(s => s.id === sid);
        const name = skillData ? skillData.name : sid.replace(/_/g, ' ');
        const skillText = this._text(x + 8, y, name, '#88ffff', '9px');
        if (skillData?.description) {
          skillText.setInteractive({ useHandCursor: true });
          skillText.on('pointerover', () => this._showSkillTooltip(skillText, skillData.description));
          skillText.on('pointerout', () => this._hideSkillTooltip());
        }
        y += 12;
      }
    }
  }

  _drawConvoyDetail() {
    let y = 50;
    const x = DETAIL_X + 12;

    this._text(x, y, 'Convoy Management', '#ffdd44', '14px');
    y += 24;

    const caps = this.runManager.getConvoyCapacities();
    const counts = this.runManager.getConvoyCounts();
    const items = this.runManager.getConvoyItems();
    this._text(x, y, `Weapons: ${counts.weapons}/${caps.weapons}  Consumables: ${counts.consumables}/${caps.consumables}`, '#88ccff', '10px');
    y += 24;

    const roster = this.runManager.roster;
    if (!roster || roster.length === 0) {
      this._text(x, y, 'Withdrawing to: (no units)', '#666666', '10px');
      y += 20;
      this._text(x, y, 'No roster units available for withdraw.', '#888888', '10px');
      this._convoyScrollMax = 0;
      this._convoyScrollOffset = 0;
      return;
    }

    this._targetUnitIndex = this._clamp(this._targetUnitIndex, 0, roster.length - 1);
    const targetUnit = roster[this._targetUnitIndex];
    this._text(x, y, `Withdrawing to: ${targetUnit.name}`, '#aaaaaa', '10px');
    if (roster.length > 1) {
      this._actionBtn(x + 250, y, '[ Change ]', () => {
        this.showUnitPicker((idx) => {
          this._targetUnitIndex = idx;
          this.drawUnitDetails();
        });
      });
    }
    y += 20;

    const startY = y;
    const itemH = 18;
    const totalItems = items.weapons.length + items.consumables.length + (items.weapons.length > 0 ? 1 : 0) + (items.consumables.length > 0 ? 1 : 0);
    const visibleH = PANEL_BOTTOM - y - 40;
    this._convoyScrollMax = Math.max(0, (totalItems * itemH) - visibleH);
    this._convoyScrollOffset = this._clamp(this._convoyScrollOffset, 0, this._convoyScrollMax);

    let rowY = startY - this._convoyScrollOffset;

    const drawItem = (item, type, idx) => {
      if (rowY >= startY && rowY <= PANEL_BOTTOM - 40) {
        const color = type === 'weapon' ? (isForged(item) ? '#44ff88' : '#aaccff') : '#88ffcc';
        this._text(x + 8, rowY, item.name, color, '10px');
        
        const isFull = type === 'weapon' ? (targetUnit.inventory.length >= INVENTORY_MAX) : (targetUnit.consumables.length >= CONSUMABLE_MAX);
        if (isFull) {
          this._text(x + 250, rowY, '(unit full)', '#666666', '10px');
        } else {
          this._actionBtn(x + 250, rowY, '[ Withdraw ]', () => {
            const pulled = this.runManager.takeFromConvoy(type, idx);
            if (!pulled) return;
            if (type === 'weapon') addToInventory(targetUnit, pulled);
            else addToConsumables(targetUnit, pulled);
            this.drawUnitDetails();
          });
        }
      }
      rowY += itemH;
    };

    if (items.weapons.length > 0) {
      if (rowY >= startY && rowY <= PANEL_BOTTOM - 40) this._text(x, rowY, 'Weapons:', '#888888', '10px');
      rowY += itemH;
      items.weapons.forEach((wpn, i) => drawItem(wpn, 'weapon', i));
    }
    if (items.consumables.length > 0) {
      if (rowY >= startY && rowY <= PANEL_BOTTOM - 40) this._text(x, rowY, 'Consumables:', '#888888', '10px');
      rowY += itemH;
      items.consumables.forEach((item, i) => drawItem(item, 'consumable', i));
    }

    if (this._convoyScrollMax > 0) {
      const pct = Math.round((this._convoyScrollOffset / this._convoyScrollMax) * 100);
      this._text(x + DETAIL_WIDTH - 60, PANEL_BOTTOM - 25, `${pct}%`, '#888888', '10px');
    }
  }

  // --- Actions ---

  _useHealItem(unit, item) {
    const healAmt = item.effect === 'healFull' ? unit.stats.HP : item.value;
    unit.currentHP = Math.min(unit.stats.HP, unit.currentHP + healAmt);
    item.uses--;
    if (item.uses <= 0) {
      removeFromConsumables(unit, item);
    }
    const audio = this.scene.registry.get('audio');
    if (audio) audio.playSFX('sfx_heal');
    this._showBanner(`${unit.name} healed!`, '#88ff88');
    this.refresh();
  }

  _usePromote(unit, item) {
    // Find promotion data
    const lordData = this.gameData.lords.find(l => l.name === unit.name);
    const promotedClassData = resolvePromotionTargetClass(unit, this.gameData.classes, this.gameData.lords);
    if (!promotedClassData) {
      this._showBanner('Promotion to that class is currently unavailable.', '#ff8888');
      return;
    }
    let promotionBonuses;

    if (lordData) {
      promotionBonuses = lordData.promotionBonuses;
    } else {
      promotionBonuses = promotedClassData.promotionBonuses;
    }

    if (!promotionBonuses) return;

    // Track old types for new weapon grant
    const oldTypes = new Set(unit.proficiencies.map(p => p.type));

    promoteUnit(unit, promotedClassData, promotionBonuses, this.gameData.skills);

    // Grant Iron weapons for new proficiency types
    const lordPromoWeapons = lordData?.promotionWeapons;
    if (lordPromoWeapons) {
      const newType = lordPromoWeapons.match(/(\w+)/)?.[1];
      const typeMap = { Swords: 'Sword', Lances: 'Lance', Axes: 'Axe', Bows: 'Bow', Tomes: 'Tome', Staves: 'Staff', Light: 'Light' };
      const wpnType = typeMap[newType] || newType;
      const newWeapon = this.gameData.weapons.find(w => w.type === wpnType && w.tier === 'Iron');
      if (newWeapon && !unit.inventory.some(w => w.name === newWeapon.name)) {
        addToInventory(unit, newWeapon);
      }
    } else {
      for (const prof of unit.proficiencies) {
        if (oldTypes.has(prof.type)) continue;
        const newWeapon = this.gameData.weapons.find(w => w.type === prof.type && w.tier === 'Iron');
        if (newWeapon && !unit.inventory.some(w => w.name === newWeapon.name)) {
          addToInventory(unit, newWeapon);
        }
      }
    }

    // Consume the Master Seal
    item.uses--;
    if (item.uses <= 0) {
      removeFromConsumables(unit, item);
    }

    const audio = this.scene.registry.get('audio');
    if (audio) audio.playSFX('sfx_level_up');
    this._showBanner(`${unit.name} promoted to ${promotedClassData.name}!`, '#ffdd44');
    this.refresh();
  }

  _teachScroll(unit, scroll) {
    const result = learnSkill(unit, scroll.skillId);
    if (result.learned) {
      // Remove scroll from team pool
      const idx = this.runManager.scrolls.indexOf(scroll);
      if (idx !== -1) this.runManager.scrolls.splice(idx, 1);

      const audio = this.scene.registry.get('audio');
      if (audio) audio.playSFX('sfx_confirm');

      const skillData = this.gameData.skills.find(s => s.id === scroll.skillId);
      const skillName = skillData ? skillData.name : scroll.skillId;
      this._showBanner(`${unit.name} learned ${skillName}!`, '#88ffff');
      this.refresh();
    } else {
      const reason = result.reason === 'at_cap'
        ? 'Already knows 5 skills!'
        : 'Already knows this skill!';
      this._showBanner(reason, '#ff8888');
    }
  }

  // --- Trade ---

  _destroyTrade() {
    for (const obj of this.tradeObjects) obj.destroy();
    this.tradeObjects = [];
  }

  _showTradePicker(sourceUnit) {
    this._destroyTrade();

    const roster = this.runManager.roster;
    const targets = roster.filter((_, i) => i !== this.selection.index);
    const cx = 320;
    const itemH = 28;
    const titleH = 30;
    const pad = 12;
    const totalH = titleH + targets.length * itemH + itemH + pad; // title + targets + cancel + padding
    const cy = 240;
    const topY = cy - totalH / 2;

    const pickerBg = this.scene.add.rectangle(cx, cy, 260, totalH, 0x222222, 0.95)
      .setDepth(DEPTH_PICKER).setStrokeStyle(1, 0x888888);
    this.tradeObjects.push(pickerBg);

    const pickerTitle = this.scene.add.text(cx, topY + pad, 'Trade with:', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffdd44',
    }).setOrigin(0.5).setDepth(DEPTH_PICKER + 1);
    this.tradeObjects.push(pickerTitle);

    targets.forEach((unit, i) => {
      const y = topY + titleH + i * itemH + pad;
      const consumableCount = (unit.consumables || []).length;
      const btn = this.scene.add.text(cx, y, `${unit.name} (${unit.inventory.length}/${INVENTORY_MAX} | ${consumableCount}/${CONSUMABLE_MAX})`, {
        fontFamily: 'monospace', fontSize: '12px', color: '#e0e0e0',
        backgroundColor: '#444444', padding: { x: 12, y: 3 },
      }).setOrigin(0.5).setDepth(DEPTH_PICKER + 1).setInteractive({ useHandCursor: true });

      btn.on('pointerover', () => btn.setColor('#ffdd44'));
      btn.on('pointerout', () => btn.setColor('#e0e0e0'));
      btn.on('pointerdown', () => {
        this._destroyTrade();
        this._showTradeScreen(sourceUnit, unit);
      });
      this.tradeObjects.push(btn);
    });

    // Cancel
    const cancelY = topY + titleH + targets.length * itemH + pad;
    const cancelBtn = this.scene.add.text(cx, cancelY, 'Cancel', {
      fontFamily: 'monospace', fontSize: '12px', color: '#888888',
      backgroundColor: '#333333', padding: { x: 10, y: 3 },
    }).setOrigin(0.5).setDepth(DEPTH_PICKER + 1).setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setColor('#ffdd44'));
    cancelBtn.on('pointerout', () => cancelBtn.setColor('#888888'));
    cancelBtn.on('pointerdown', () => this._destroyTrade());
    this.tradeObjects.push(cancelBtn);
  }

  showUnitPicker(onSelect) {
    this._destroyTrade();

    const roster = this.runManager.roster;
    const cx = 320;
    const itemH = 28;
    const titleH = 30;
    const pad = 12;
    const totalH = titleH + roster.length * itemH + itemH + pad;
    const cy = 240;
    const topY = cy - totalH / 2;

    const pickerBg = this.scene.add.rectangle(cx, cy, 260, totalH, 0x222222, 0.95)
      .setDepth(DEPTH_PICKER).setStrokeStyle(1, 0x888888);
    this.tradeObjects.push(pickerBg);

    const pickerTitle = this.scene.add.text(cx, topY + pad, 'Select Unit:', {
      fontFamily: 'monospace', fontSize: '13px', color: '#ffdd44',
    }).setOrigin(0.5).setDepth(DEPTH_PICKER + 1);
    this.tradeObjects.push(pickerTitle);

    roster.forEach((unit, i) => {
      const y = topY + titleH + i * itemH + pad;
      const btn = this.scene.add.text(cx, y, unit.name, {
        fontFamily: 'monospace', fontSize: '12px', color: '#e0e0e0',
        backgroundColor: '#444444', padding: { x: 12, y: 3 },
      }).setOrigin(0.5).setDepth(DEPTH_PICKER + 1).setInteractive({ useHandCursor: true });

      btn.on('pointerover', () => btn.setColor('#ffdd44'));
      btn.on('pointerout', () => btn.setColor('#e0e0e0'));
      btn.on('pointerdown', () => {
        this._destroyTrade();
        onSelect(i);
      });
      this.tradeObjects.push(btn);
    });

    const cancelY = topY + titleH + roster.length * itemH + pad;
    const cancelBtn = this.scene.add.text(cx, cancelY, 'Cancel', {
      fontFamily: 'monospace', fontSize: '12px', color: '#888888',
      backgroundColor: '#333333', padding: { x: 10, y: 3 },
    }).setOrigin(0.5).setDepth(DEPTH_PICKER + 1).setInteractive({ useHandCursor: true });
    cancelBtn.on('pointerover', () => cancelBtn.setColor('#ffdd44'));
    cancelBtn.on('pointerout', () => cancelBtn.setColor('#888888'));
    cancelBtn.on('pointerdown', () => this._destroyTrade());
    this.tradeObjects.push(cancelBtn);
  }

  _showTradeScreen(unitA, unitB) {
    this._destroyTrade();

    const leftX = DETAIL_X + 20;
    const rightX = DETAIL_X + 230;
    let y = 55;

    // Trade overlay bg
    const tradeBg = this.scene.add.rectangle(
      DETAIL_X + DETAIL_WIDTH / 2, 240, DETAIL_WIDTH, 430, 0x1a1a2e, 0.98
    ).setDepth(DEPTH_PICKER).setStrokeStyle(1, 0x888888);
    this.tradeObjects.push(tradeBg);

    this._tradeText(leftX + 80, y, 'Trade Items', '#ffdd44', '14px');
    y += 22;

    // Column headers
    const aConsCount = (unitA.consumables || []).length;
    const bConsCount = (unitB.consumables || []).length;
    this._tradeText(leftX, y, `${unitA.name} (${unitA.inventory.length}/${INVENTORY_MAX} | ${aConsCount}/${CONSUMABLE_MAX})`, '#e0e0e0', '11px');
    this._tradeText(rightX, y, `${unitB.name} (${unitB.inventory.length}/${INVENTORY_MAX} | ${bConsCount}/${CONSUMABLE_MAX})`, '#e0e0e0', '11px');
    y += 18;

    // Left side items (unitA) → click to give to unitB
    const drawSide = (unit, otherUnit, xPos, startY) => {
      let sy = startY;

      // Inventory
      if (unit.inventory.length === 0) {
        this._tradeText(xPos, sy, '(empty)', '#888888', '10px');
        sy += 14;
      } else {
        for (const item of [...unit.inventory]) {
          const marker = item === unit.weapon ? '\u25b6 ' : '  ';
          const noProf = !hasProficiency(otherUnit, item);
          const baseColor = isForged(item) ? '#44ff88' : (noProf ? '#cc8844' : '#e0e0e0');
          let label = `${marker}${item.name}`;
          if (item.type === 'Staff') {
            const rem = getStaffRemainingUses(item, unit);
            const max = getStaffMaxUses(item, unit);
            label += ` (${rem}/${max})`;
          }
          if (noProf) label += ' (no prof)';

          const locked = isLastCombatWeapon(unit, item);
          if (!locked && otherUnit.inventory.length < INVENTORY_MAX) {
            const btn = this.scene.add.text(xPos, sy, label + '  \u25b6', {
              fontFamily: 'monospace', fontSize: '10px', color: baseColor,
            }).setDepth(DEPTH_PICKER + 2).setInteractive({ useHandCursor: true });
            btn.on('pointerover', () => btn.setColor('#ffdd44'));
            btn.on('pointerout', () => btn.setColor(baseColor));
            btn.on('pointerdown', () => {
              removeFromInventory(unit, item);
              addToInventory(otherUnit, item);
              this._showTradeScreen(unitA, unitB); // redraw
            });
            this.tradeObjects.push(btn);
          } else {
            this._tradeText(xPos, sy, label, '#666666', '10px');
          }
          sy += 14;
        }
      }

      // Consumables
      const consumables = unit.consumables || [];
      if (consumables.length > 0) {
        for (const item of [...consumables]) {
          const marker = '  ';
          const color = '#88ff88';
          const label = `${marker}${item.name} (${item.uses})`;

          if ((otherUnit.consumables || []).length < CONSUMABLE_MAX) {
            const btn = this.scene.add.text(xPos, sy, label + '  \u25b6', {
              fontFamily: 'monospace', fontSize: '10px', color,
            }).setDepth(DEPTH_PICKER + 2).setInteractive({ useHandCursor: true });
            btn.on('pointerover', () => btn.setColor('#ffdd44'));
            btn.on('pointerout', () => btn.setColor(color));
            btn.on('pointerdown', () => {
              const idx = unit.consumables.indexOf(item);
              if (idx !== -1) unit.consumables.splice(idx, 1);
              if (!otherUnit.consumables) otherUnit.consumables = [];
              otherUnit.consumables.push(item);
              this._showTradeScreen(unitA, unitB); // redraw
            });
            this.tradeObjects.push(btn);
          } else {
            this._tradeText(xPos, sy, label, '#666666', '10px');
          }
          sy += 14;
        }
      }

      return sy;
    };

    const leftEnd = drawSide(unitA, unitB, leftX, y);
    const rightEnd = drawSide(unitB, unitA, rightX, y);
    const endY = Math.max(leftEnd, rightEnd) + 16;

    // Done button
    const doneBtn = this.scene.add.text(
      DETAIL_X + DETAIL_WIDTH / 2, endY, '[ Done ]', {
      fontFamily: 'monospace', fontSize: '13px', color: '#e0e0e0',
      backgroundColor: '#333333', padding: { x: 16, y: 4 },
    }).setOrigin(0.5).setDepth(DEPTH_PICKER + 2).setInteractive({ useHandCursor: true });
    doneBtn.on('pointerover', () => doneBtn.setColor('#ffdd44'));
    doneBtn.on('pointerout', () => doneBtn.setColor('#e0e0e0'));
    doneBtn.on('pointerdown', () => {
      this._destroyTrade();
      this.refresh();
    });
    this.tradeObjects.push(doneBtn);
  }

  // --- Helpers ---

  refresh() {
    this.drawUnitList();
    this.drawUnitDetails();
  }

  _text(x, y, str, color = '#e0e0e0', fontSize = '10px') {
    const t = this.scene.add.text(x, y, str, {
      fontFamily: 'monospace', fontSize, color,
    }).setDepth(DEPTH_TEXT);
    this.detailObjects.push(t);
    return t;
  }

  _tradeText(x, y, str, color = '#e0e0e0', fontSize = '10px') {
    const t = this.scene.add.text(x, y, str, {
      fontFamily: 'monospace', fontSize, color,
    }).setDepth(DEPTH_PICKER + 2);
    this.tradeObjects.push(t);
    return t;
  }

  _actionBtn(x, y, label, onClick, fontSize = '10px') {
    const btn = this.scene.add.text(x, y, label, {
      fontFamily: 'monospace', fontSize, color: '#e0e0e0',
      backgroundColor: '#333333', padding: { x: 4, y: 1 },
    }).setDepth(DEPTH_TEXT).setInteractive({ useHandCursor: true });
    btn.on('pointerover', () => btn.setColor('#ffdd44'));
    btn.on('pointerout', () => btn.setColor('#e0e0e0'));
    btn.on('pointerdown', onClick);
    this.detailObjects.push(btn);
    return btn;
  }

  _getPortraitKey(unit) {
    // Lords have named portraits
    const lordData = this.gameData.lords.find(l => l.name === unit.name);
    if (lordData) return `portrait_lord_${unit.name.toLowerCase()}`;

    // Try current class
    const classKey = `portrait_generic_${unit.className.toLowerCase().replace(/ /g, '_')}`;
    if (this.scene.textures.exists(classKey)) return classKey;

    // Promoted fallback: use base class portrait
    const classData = this.gameData.classes.find(c => c.name === unit.className);
    if (classData?.promotesFrom) {
      const baseKey = `portrait_generic_${classData.promotesFrom.toLowerCase().replace(/ /g, '_')}`;
      if (this.scene.textures.exists(baseKey)) return baseKey;
    }
    return null;
  }

  _showSkillTooltip(anchor, description) {
    this._hideSkillTooltip();

    const tipX = Math.min(anchor.x + anchor.width + 8, 430);
    let tipY = anchor.y;

    const txt = this.scene.add.text(tipX + 6, tipY + 4, description, {
      fontFamily: 'monospace', fontSize: '9px', color: '#e0e0e0',
      wordWrap: { width: 200 },
    }).setDepth(DEPTH_PICKER + 2);

    const w = txt.width + 12;
    const h = txt.height + 8;

    // Clamp to canvas
    if (tipX + w > 636) { txt.x = 636 - w + 6; }
    if (tipY + h > 476) { tipY = 476 - h; txt.y = tipY + 4; }

    const bg = this.scene.add.rectangle(
      txt.x - 6 + w / 2, txt.y - 4 + h / 2, w, h, 0x222222, 0.95
    ).setDepth(DEPTH_PICKER + 1).setStrokeStyle(1, 0x888888);

    this._skillTooltip = [bg, txt];
  }

  _hideSkillTooltip() {
    if (this._skillTooltip) {
      for (const obj of this._skillTooltip) obj.destroy();
      this._skillTooltip = null;
    }
  }

  _showWeaponSpecialTooltip(weapon, textObject) {
    if (this._weaponTooltip) this._weaponTooltip.destroy();

    const tooltip = this.scene.add.container(0, 0).setDepth(DEPTH_TEXT + 1);
    const padding = 8;
    const maxWidth = 200;

    const descText = this.scene.add.text(0, 0, weapon.special, {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#ffffff',
      wordWrap: { width: maxWidth - padding * 2 }
    });

    const bg = this.scene.add.rectangle(
      0, 0,
      descText.width + padding * 2,
      descText.height + padding * 2,
      0x222222, 0.95
    ).setOrigin(0);

    tooltip.add([bg, descText]);
    descText.setPosition(padding, padding);

    // Position near weapon text, clamped to canvas
    const bounds = textObject.getBounds();
    let tx = bounds.right + 10;
    let ty = bounds.top;
    if (tx + bg.width > 640) tx = bounds.left - bg.width - 10;
    if (ty + bg.height > 480) ty = 480 - bg.height;
    if (tx < 0) tx = 5;
    if (ty < 0) ty = 5;

    tooltip.setPosition(tx, ty);
    this._weaponTooltip = tooltip;
  }

  _hideWeaponSpecialTooltip() {
    if (this._weaponTooltip) {
      this._weaponTooltip.destroy();
      this._weaponTooltip = null;
    }
  }

  _showBanner(msg, color) {
    const banner = this.scene.add.text(320, 240, msg, {
      fontFamily: 'monospace', fontSize: '14px', color,
      backgroundColor: '#000000cc', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setDepth(DEPTH_PICKER + 10).setAlpha(0);

    this.scene.tweens.add({
      targets: banner, alpha: 1, duration: 200,
      yoyo: true, hold: 800,
      onComplete: () => banner.destroy(),
    });
  }
}

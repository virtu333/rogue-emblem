// RosterOverlay.js — Node map roster management (view stats, equip, trade, accessories)
// Follows PauseOverlay/SettingsOverlay pattern with this.objects[].

import { XP_STAT_NAMES, XP_PER_LEVEL, MAX_SKILLS, INVENTORY_MAX, CONSUMABLE_MAX } from '../utils/constants.js';
import { STAT_COLORS, UI_COLORS, getHPBarColor } from '../utils/uiStyles.js';
import {
  equipWeapon, addToInventory, removeFromInventory,
  canPromote, promoteUnit, equipAccessory, unequipAccessory,
  removeFromConsumables, learnSkill,
} from '../engine/UnitManager.js';
import { isForged } from '../engine/ForgeSystem.js';
import { getStaffRemainingUses, getStaffMaxUses, parseRange } from '../engine/Combat.js';

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
    this.selectedIndex = 0;
    this._skillTooltip = null;
    this._weaponTooltip = null;
  }

  show() {
    this.hide();
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

    this.drawUnitList();
    this.drawUnitDetails();
  }

  hide() {
    this._destroyDetails();
    this._destroyTrade();
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
    if (this.onClose) this.onClose();
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

    for (let i = 0; i < roster.length; i++) {
      const unit = roster[i];
      const y = startY + i * entryH;
      const isSelected = i === this.selectedIndex;

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

      hitZone.on('pointerdown', () => {
        this.selectedIndex = i;
        this.drawUnitList();
        this.drawUnitDetails();
      });
      hitZone.on('pointerover', () => {
        if (i !== this.selectedIndex) nameText.setColor('#ffdd44');
      });
      hitZone.on('pointerout', () => {
        if (i !== this.selectedIndex) nameText.setColor('#e0e0e0');
      });

      this.objects.push(hitZone, nameText, barBg, barFill, hpText);
    }
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

    const unit = this.runManager.roster[this.selectedIndex];
    if (!unit) return;

    // Detail panel background
    const detailBg = this.scene.add.rectangle(
      DETAIL_X + DETAIL_WIDTH / 2, PANEL_CENTER_Y, DETAIL_WIDTH, PANEL_HEIGHT, 0x1a1a2e
    ).setDepth(DEPTH_PANEL).setStrokeStyle(1, 0x444444);
    this.detailObjects.push(detailBg);

    let y = 50;
    const x = DETAIL_X + 12;
    const col2X = DETAIL_X + 220;

    // --- Header ---
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

    // XP
    if (unit.xp !== undefined) {
      this._text(x, y, `XP: ${unit.xp}/${XP_PER_LEVEL}`, '#88ccff', '10px');
      y += 14;
    }

    // --- Stats (two columns) ---
    this._text(x, y, `HP  ${unit.currentHP}/${unit.stats.HP}`, STAT_COLORS.HP, '10px');
    const leftStats = ['STR', 'MAG', 'SKL', 'SPD'];
    const rightStats = ['DEF', 'RES', 'LCK', 'MOV'];
    y += 14;
    for (let s = 0; s < leftStats.length; s++) {
      const ls = leftStats[s];
      const rs = rightStats[s];
      const lVal = ls === 'MOV' ? (unit.mov || unit.stats.MOV) : unit.stats[ls];
      const rVal = rs === 'MOV' ? (unit.mov || unit.stats.MOV) : unit.stats[rs];
      this._text(x, y, `${ls.padEnd(4)}${String(lVal).padStart(3)}`, STAT_COLORS[ls], '10px');
      this._text(x + 90, y, `${rs.padEnd(4)}${String(rVal).padStart(3)}`, STAT_COLORS[rs], '10px');
      y += 13;
    }

    // --- Inventory ---
    y += 4;
    this._text(x, y, '\u2500\u2500 Inventory \u2500\u2500', '#888888', '10px');
    y += 14;

    if (unit.inventory.length === 0) {
      this._text(x, y, '(empty)', '#888888', '10px');
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
          label = `${marker}${item.name}  Mt${item.might} Ht${item.hit} Cr${item.crit} Wt${item.weight} ${rngStr}`;
        } else {
          label = `${marker}${item.name}`;
        }

        const color = isForged(item) ? '#44ff88' : '#e0e0e0';
        const weaponText = this._text(x, y, label, color, '10px');

        // Add tooltip for weapon specials
        if (item.special) {
          weaponText.setInteractive({ useHandCursor: true });
          weaponText.on('pointerover', () => {
            this._showWeaponSpecialTooltip(item, weaponText);
          });
          weaponText.on('pointerout', () => {
            this._hideWeaponSpecialTooltip();
          });
        }

        // Equip weapon button (if not already equipped)
        const btnX = x + 250;
        if (!isEquipped) {
          this._actionBtn(btnX, y, '[Equip]', () => {
            equipWeapon(unit, item);
            this.refresh();
          });
        }

        y += 14;
      }
    }

    // --- Consumables ---
    y += 4;
    this._text(x, y, '\u2500\u2500 Consumables \u2500\u2500', '#888888', '10px');
    y += 14;

    const consumables = unit.consumables || [];
    if (consumables.length === 0) {
      this._text(x, y, '(empty)', '#888888', '10px');
      y += 14;
    } else {
      for (const item of consumables) {
        const marker = '  ';
        const label = `${marker}${item.name} (${item.uses})`;
        this._text(x, y, label, '#88ff88', '10px');

        // Action buttons
        const btnX = x + 250;
        if (item.effect === 'heal' || item.effect === 'healFull') {
          if (unit.currentHP < unit.stats.HP) {
            this._actionBtn(btnX, y, '[Use]', () => this._useHealItem(unit, item));
          }
        } else if (item.effect === 'promote') {
          if (canPromote(unit)) {
            this._actionBtn(btnX, y, '[Use]', () => this._usePromote(unit, item));
          }
        }

        y += 14;
      }
    }

    // --- Team Scrolls ---
    y += 4;
    this._text(x, y, '\u2500\u2500 Team Scrolls \u2500\u2500', '#888888', '10px');
    y += 14;

    const scrollPool = this.runManager.scrolls || [];
    if (scrollPool.length === 0) {
      this._text(x, y, '(no scrolls)', '#888888', '10px');
      y += 14;
    } else {
      for (const scroll of scrollPool) {
        this._text(x, y, scroll.name, '#88ffff', '10px');

        // Check if unit can learn
        const canLearn = unit.skills.length < MAX_SKILLS
          && !unit.skills.includes(scroll.skillId);

        const btnX = x + 250;
        if (canLearn) {
          this._actionBtn(btnX, y, '[Teach]', () => this._teachScroll(unit, scroll));
        } else {
          const reason = unit.skills.length >= MAX_SKILLS ? '(cap)' : '(known)';
          this._text(btnX, y, reason, '#888888', '10px');
        }
        y += 14;
      }
    }

    // --- Accessory ---
    y += 4;
    this._text(x, y, '\u2500\u2500 Accessory \u2500\u2500', '#888888', '10px');
    y += 14;

    if (unit.accessory) {
      const fx = Object.entries(unit.accessory.effects || {}).filter(([, v]) => v).map(([k, v]) => `${k}+${v}`).join(' ');
      const ce = unit.accessory.combatEffects;
      let ceDesc = '';
      if (ce) {
        const parts = [];
        if (ce.critBonus) parts.push(`Crit+${ce.critBonus}`);
        if (ce.atkBonus) parts.push(`Atk+${ce.atkBonus}`);
        if (ce.defBonus) parts.push(`Def+${ce.defBonus}`);
        if (ce.preventEnemyDouble) parts.push('No double');
        if (ce.doubleThresholdReduction) parts.push(`Dbl-${ce.doubleThresholdReduction}`);
        if (ce.negateEffectiveness) parts.push('Negate eff.');
        if (ce.avoidBonus) parts.push(`Avo+${ce.avoidBonus}`);
        if (ce.condition) parts.push(`(${ce.condition.replace('_', ' ')})`);
        ceDesc = parts.join(' ');
      }
      const desc = [fx, ceDesc].filter(Boolean).join(' ');
      this._text(x, y, `${unit.accessory.name} (${desc})`, '#cc88ff', '10px');
      this._actionBtn(x + 250, y, '[Unequip]', () => {
        const old = unequipAccessory(unit);
        if (old) this.runManager.accessories.push(old);
        this.refresh();
      });
      y += 14;
    } else {
      this._text(x, y, '(none)', '#888888', '10px');
      y += 14;
    }

    // Team pool
    const pool = this.runManager.accessories || [];
    if (pool.length > 0) {
      this._text(x, y, 'Pool:', '#888888', '10px');
      y += 13;
      for (let a = 0; a < pool.length; a++) {
        const acc = pool[a];
        const fx = Object.entries(acc.effects || {}).map(([k, v]) => `${k}+${v}`).join(' ');
        this._text(x + 8, y, `${acc.name} (${fx})`, '#aa88cc', '10px');
        this._actionBtn(x + 250, y, '[Equip]', () => {
          const old = equipAccessory(unit, acc);
          // Remove from pool
          const idx = this.runManager.accessories.indexOf(acc);
          if (idx !== -1) this.runManager.accessories.splice(idx, 1);
          // Return old to pool
          if (old) this.runManager.accessories.push(old);
          this.refresh();
        });
        y += 13;
      }
    }

    // --- Skills ---
    if (unit.skills && unit.skills.length > 0) {
      y += 4;
      this._text(x, y, `\u2500\u2500 Skills (${unit.skills.length}/${MAX_SKILLS}) \u2500\u2500`, '#888888', '10px');
      y += 14;
      for (const sid of unit.skills) {
        const skillData = this.gameData.skills?.find(s => s.id === sid);
        const name = skillData ? skillData.name : sid.replace(/_/g, ' ');
        const skillText = this._text(x + 4, y, name, '#88ffff', '10px');
        if (skillData?.description) {
          skillText.setInteractive({ useHandCursor: true });
          skillText.on('pointerover', () => {
            this._showSkillTooltip(skillText, skillData.description);
          });
          skillText.on('pointerout', () => this._hideSkillTooltip());
        }
        y += 13;
      }
    }

    // --- Growths (player only) ---
    if (unit.faction !== 'enemy' && unit.growths) {
      y += 4;
      this._text(x, y, '\u2500\u2500 Growths \u2500\u2500', '#888888', '10px');
      y += 14;
      const growthPairs = XP_STAT_NAMES.map(s => `${s}:${unit.growths[s] || 0}`);
      // Show 4 per line
      for (let i = 0; i < growthPairs.length; i += 4) {
        this._text(x + 4, y, growthPairs.slice(i, i + 4).join('  '), '#888888', '10px');
        y += 13;
      }
    }

    // --- Trade button ---
    y += 8;
    if (this.runManager.roster.length > 1) {
      this._actionBtn(x, y, '[ Trade ]', () => this._showTradePicker(unit), '12px');
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
    let promotedClassName, promotionBonuses;

    if (lordData) {
      promotedClassName = lordData.promotedClass;
      promotionBonuses = lordData.promotionBonuses;
    } else {
      const baseClass = this.gameData.classes.find(c => c.name === unit.className);
      promotedClassName = baseClass?.promotesTo;
      const promotedClass = this.gameData.classes.find(c => c.name === promotedClassName);
      promotionBonuses = promotedClass?.promotionBonuses;
    }

    if (!promotedClassName || !promotionBonuses) return;

    const promotedClassData = this.gameData.classes.find(c => c.name === promotedClassName);
    if (!promotedClassData) return;

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
    this._showBanner(`${unit.name} promoted to ${promotedClassName}!`, '#ffdd44');
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
    const targets = roster.filter((_, i) => i !== this.selectedIndex);
    const cx = 320;
    const itemH = 28;
    const titleH = 30;
    const pad = 12;
    const totalH = titleH + targets.length * itemH + itemH + pad; // title + targets + cancel + padding
    const cy = 200;
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
          const color = isForged(item) ? '#44ff88' : '#e0e0e0';
          let label = `${marker}${item.name}`;
          if (item.type === 'Staff') {
            const rem = getStaffRemainingUses(item, unit);
            const max = getStaffMaxUses(item, unit);
            label += ` (${rem}/${max})`;
          }

          if (otherUnit.inventory.length < INVENTORY_MAX) {
            const btn = this.scene.add.text(xPos, sy, label + '  \u25b6', {
              fontFamily: 'monospace', fontSize: '10px', color,
            }).setDepth(DEPTH_PICKER + 2).setInteractive({ useHandCursor: true });
            btn.on('pointerover', () => btn.setColor('#ffdd44'));
            btn.on('pointerout', () => btn.setColor(color));
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

// UnitDetailOverlay.js — Center-screen full unit detail overlay (opened via V key or R key)
// Tabbed display: Stats tab (stats, proficiencies, growths, terrain) | Gear tab (inventory, consumables, accessory, skills)
// Optional roster cycling via UP/DOWN arrows when opened with roster context

import { XP_STAT_NAMES, XP_PER_LEVEL, MAX_SKILLS } from '../utils/constants.js';
import { STAT_COLORS, UI_COLORS, getHPBarColor } from '../utils/uiStyles.js';
import { isForged } from '../engine/ForgeSystem.js';
import {
  getStaticCombatStats,
  getStaffRemainingUses,
  getStaffMaxUses,
  getEffectiveStaffRange,
  parseRange
} from '../engine/Combat.js';

const OVERLAY_W = 400;
const OVERLAY_H = 370;
const CX = 320; // center x (640/2)
const CY = 240; // center y (480/2)
const DEPTH_BG = 750;
const DEPTH_PANEL = 751;
const DEPTH_TEXT = 752;
const DEPTH_TOOLTIP = 760;

export class UnitDetailOverlay {
  constructor(scene, gameData) {
    this.scene = scene;
    this.gameData = gameData;
    this.objects = [];        // frame objects (blocker, panel) — persist across unit cycling
    this._unitObjects = [];   // per-unit objects (header, portrait, HP, tabs, nav, footer)
    this._tabObjects = [];    // tab-specific objects (cleared on tab switch)
    this.visible = false;
    this._skillTooltip = null;
    this._activeTab = 'stats';
    this._unit = null;
    this._terrain = null;
    this._panel = null;
    this._keyHandlerLeft = null;
    this._keyHandlerRight = null;
    this._keyHandlerUp = null;
    this._keyHandlerDown = null;
    this._rosterUnits = null;
    this._rosterIndex = 0;
  }

  show(unit, terrain, gameData, rosterOptions) {
    this.hide();
    this.visible = true;
    if (gameData) this.gameData = gameData;
    this._activeTab = 'stats';

    // Store roster context (clamp index to valid range)
    this._rosterUnits = rosterOptions?.rosterUnits || null;
    const len = this._rosterUnits?.length || 0;
    this._rosterIndex = len > 0 ? Math.max(0, Math.min((rosterOptions?.rosterIndex ?? 0), len - 1)) : 0;

    const left = CX - OVERLAY_W / 2;
    const top = CY - OVERLAY_H / 2;

    // Dim background (visual only, not interactive)
    const blocker = this.scene.add.rectangle(CX, CY, 640, 480, 0x000000, 0.7)
      .setDepth(DEPTH_BG);
    this.objects.push(blocker);

    // Panel background
    this._panel = this.scene.add.rectangle(CX, CY, OVERLAY_W, OVERLAY_H, 0x1a1a2e, 1)
      .setDepth(DEPTH_PANEL).setStrokeStyle(2, 0x444444);
    this.objects.push(this._panel);

    // Scene-level click: close if outside panel bounds
    this._clickHandler = (pointer) => {
      if (!this.visible) return;
      const px = pointer.x, py = pointer.y;
      const panelLeft = this._panel.x - this._panel.width / 2;
      const panelRight = this._panel.x + this._panel.width / 2;
      const panelTop = this._panel.y - this._panel.height / 2;
      const panelBottom = this._panel.y + this._panel.height / 2;
      if (px < panelLeft || px > panelRight || py < panelTop || py > panelBottom) {
        this.hide();
      }
    };
    this.scene.input.on('pointerdown', this._clickHandler);

    // --- Keyboard listeners ---
    this._keyHandlerLeft = () => {
      this._activeTab = this._activeTab === 'stats' ? 'gear' : 'stats';
      this._refreshTabs();
    };
    this._keyHandlerRight = this._keyHandlerLeft;
    this.scene.input.keyboard.on('keydown-LEFT', this._keyHandlerLeft);
    this.scene.input.keyboard.on('keydown-RIGHT', this._keyHandlerRight);

    // UP/DOWN roster cycling (only when roster has 2+ units)
    if (this._rosterUnits && this._rosterUnits.length > 1) {
      this._keyHandlerUp = () => this._cycleUnit(-1);
      this._keyHandlerDown = () => this._cycleUnit(1);
      this.scene.input.keyboard.on('keydown-UP', this._keyHandlerUp);
      this.scene.input.keyboard.on('keydown-DOWN', this._keyHandlerDown);
    }

    // Render unit-specific content
    this._renderUnitContent(unit, terrain);
  }

  _renderUnitContent(unit, terrain) {
    // Destroy previous unit content (and tab content within it)
    this._hideSkillTooltip();
    for (const obj of this._tabObjects) obj.destroy();
    this._tabObjects = [];
    for (const obj of this._unitObjects) obj.destroy();
    this._unitObjects = [];

    this._unit = unit;
    this._terrain = terrain;

    const left = CX - OVERLAY_W / 2;
    const top = CY - OVERLAY_H / 2;
    let y = top + 10;
    const lx = left + 12;

    // --- Header ---
    const factionLabel = unit.faction === 'player' ? '' : unit.faction === 'npc' ? ' [NPC]' : ' [Enemy]';
    this._unitText(lx, y, `${unit.name}${factionLabel}`, UI_COLORS.gold, '12px');

    // Portrait (top-right)
    const portraitKey = this._getPortraitKey(unit);
    if (portraitKey && this.scene.textures.exists(portraitKey)) {
      const portrait = this.scene.add.image(left + OVERLAY_W - 36, y + 24, portraitKey)
        .setDisplaySize(48, 48).setDepth(DEPTH_TEXT);
      this._unitObjects.push(portrait);
    }

    // Navigation UI (arrows + counter) to the left of portrait
    if (this._rosterUnits && this._rosterUnits.length > 1) {
      const navX = left + OVERLAY_W - 72;
      const upArrow = this.scene.add.text(navX, y + 6, '\u25b2', {
        fontFamily: 'monospace', fontSize: '14px', color: '#ffdd44',
      }).setOrigin(0.5).setDepth(DEPTH_TEXT).setInteractive({ useHandCursor: true });
      upArrow.on('pointerdown', () => this._cycleUnit(-1));
      upArrow.on('pointerover', () => upArrow.setColor('#ffffff'));
      upArrow.on('pointerout', () => upArrow.setColor('#ffdd44'));
      this._unitObjects.push(upArrow);

      const counter = this.scene.add.text(navX, y + 24, `${this._rosterIndex + 1}/${this._rosterUnits.length}`, {
        fontFamily: 'monospace', fontSize: '9px', color: '#888888',
      }).setOrigin(0.5).setDepth(DEPTH_TEXT);
      this._unitObjects.push(counter);

      const downArrow = this.scene.add.text(navX, y + 42, '\u25bc', {
        fontFamily: 'monospace', fontSize: '14px', color: '#ffdd44',
      }).setOrigin(0.5).setDepth(DEPTH_TEXT).setInteractive({ useHandCursor: true });
      downArrow.on('pointerdown', () => this._cycleUnit(1));
      downArrow.on('pointerover', () => downArrow.setColor('#ffffff'));
      downArrow.on('pointerout', () => downArrow.setColor('#ffdd44'));
      this._unitObjects.push(downArrow);
    }

    y += 16;
    const tierStr = unit.tier === 'promoted' ? 'Promoted' : 'Base';
    this._unitText(lx, y, `Lv ${unit.level || 1}  ${unit.className || ''}  (${tierStr})`, UI_COLORS.white, '10px');

    if (unit.faction === 'player' && unit.xp !== undefined) {
      y += 14;
      this._unitText(lx, y, `XP: ${unit.xp}/${XP_PER_LEVEL}`, '#88ccff', '10px');
    }

    y += 14;
    if (unit.moveType) {
      this._unitText(lx, y, `Move: ${unit.moveType}`, UI_COLORS.gray, '10px');
      y += 14;
    }

    // --- HP Bar ---
    const hpRatio = unit.currentHP / unit.stats.HP;
    const barW = 180;
    const barH = 8;
    const barBg = this.scene.add.rectangle(lx, y + 1, barW, barH, 0x333333).setOrigin(0, 0).setDepth(DEPTH_TEXT);
    const barFill = this.scene.add.rectangle(lx, y + 1, barW * hpRatio, barH, getHPBarColor(hpRatio)).setOrigin(0, 0).setDepth(DEPTH_TEXT);
    this._unitObjects.push(barBg, barFill);
    this._unitText(lx + barW + 6, y, `${unit.currentHP}/${unit.stats.HP}`, STAT_COLORS.HP, '10px');
    y += 18;

    // --- Tab Buttons ---
    this._drawTabButtons(lx, y);
    y += 24;

    // Store content start y for tab drawing
    this._contentStartY = y;
    this._left = left;

    // --- Footer ---
    const footerY = top + OVERLAY_H - 18;
    const footerStr = (this._rosterUnits && this._rosterUnits.length > 1)
      ? '[ESC] Close    [\u25c4/\u25ba] Tab    [\u25b2/\u25bc] Unit'
      : '[ESC] Close    [LEFT/RIGHT] Switch Tab';
    this._unitText(lx, footerY, footerStr, UI_COLORS.gray, '9px');

    // --- Draw initial tab content ---
    this._drawTabContent();
  }

  _cycleUnit(direction) {
    if (!this._rosterUnits || this._rosterUnits.length <= 1) return;
    const len = this._rosterUnits.length;
    this._rosterIndex = (this._rosterIndex + direction + len) % len;
    const newUnit = this._rosterUnits[this._rosterIndex];

    // Look up terrain at new unit's grid position
    let terrain = null;
    const grid = this.scene.grid;
    if (grid?.mapLayout && newUnit.row != null && newUnit.col != null) {
      const terrainIndex = grid.mapLayout[newUnit.row]?.[newUnit.col];
      if (terrainIndex != null && this.gameData?.terrain) {
        terrain = this.gameData.terrain[terrainIndex];
      }
    }

    this._renderUnitContent(newUnit, terrain);
  }

  hide() {
    this._hideSkillTooltip();
    if (this._keyHandlerLeft) {
      this.scene.input.keyboard.off('keydown-LEFT', this._keyHandlerLeft);
      this.scene.input.keyboard.off('keydown-RIGHT', this._keyHandlerRight);
      this._keyHandlerLeft = null;
      this._keyHandlerRight = null;
    }
    if (this._keyHandlerUp) {
      this.scene.input.keyboard.off('keydown-UP', this._keyHandlerUp);
      this.scene.input.keyboard.off('keydown-DOWN', this._keyHandlerDown);
      this._keyHandlerUp = null;
      this._keyHandlerDown = null;
    }
    if (this._clickHandler) {
      this.scene.input.off('pointerdown', this._clickHandler);
      this._clickHandler = null;
    }
    for (const obj of this._tabObjects) obj.destroy();
    this._tabObjects = [];
    for (const obj of this._unitObjects) obj.destroy();
    this._unitObjects = [];
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
    this._unit = null;
    this._terrain = null;
    this._panel = null;
    this._rosterUnits = null;
    this._rosterIndex = 0;
  }

  // --- Tab System ---

  _drawTabButtons(x, y) {
    const tabW = 80;
    const tabH = 18;
    const gap = 8;

    // Stats tab button
    this._tabBtnStats = this.scene.add.rectangle(x + tabW / 2, y + tabH / 2, tabW, tabH, 0x443300)
      .setDepth(DEPTH_TEXT).setStrokeStyle(1, 0xffdd44).setInteractive({ useHandCursor: true });
    this._tabLabelStats = this.scene.add.text(x + tabW / 2, y + tabH / 2, 'Stats', {
      fontFamily: 'monospace', fontSize: '10px', color: '#ffffff',
    }).setOrigin(0.5).setDepth(DEPTH_TEXT + 1);
    this._tabBtnStats.on('pointerdown', () => { this._activeTab = 'stats'; this._refreshTabs(); });
    this._unitObjects.push(this._tabBtnStats, this._tabLabelStats);

    // Gear tab button
    const gx = x + tabW + gap;
    this._tabBtnGear = this.scene.add.rectangle(gx + tabW / 2, y + tabH / 2, tabW, tabH, 0x222233)
      .setDepth(DEPTH_TEXT).setStrokeStyle(1, 0x666666).setInteractive({ useHandCursor: true });
    this._tabLabelGear = this.scene.add.text(gx + tabW / 2, y + tabH / 2, 'Gear', {
      fontFamily: 'monospace', fontSize: '10px', color: '#888888',
    }).setOrigin(0.5).setDepth(DEPTH_TEXT + 1);
    this._tabBtnGear.on('pointerdown', () => { this._activeTab = 'gear'; this._refreshTabs(); });
    this._unitObjects.push(this._tabBtnGear, this._tabLabelGear);

    // Arrow hint
    this._unitText(gx + tabW + gap + 4, y + 3, '\u25c4 \u25ba', UI_COLORS.gray, '10px');
  }

  _refreshTabs() {
    // Update tab button styles
    if (this._activeTab === 'stats') {
      this._tabBtnStats.setFillStyle(0x443300).setStrokeStyle(1, 0xffdd44);
      this._tabLabelStats.setColor('#ffffff');
      this._tabBtnGear.setFillStyle(0x222233).setStrokeStyle(1, 0x666666);
      this._tabLabelGear.setColor('#888888');
    } else {
      this._tabBtnStats.setFillStyle(0x222233).setStrokeStyle(1, 0x666666);
      this._tabLabelStats.setColor('#888888');
      this._tabBtnGear.setFillStyle(0x443300).setStrokeStyle(1, 0xffdd44);
      this._tabLabelGear.setColor('#ffffff');
    }
    this._drawTabContent();
  }

  _drawTabContent() {
    this._hideSkillTooltip();
    for (const obj of this._tabObjects) obj.destroy();
    this._tabObjects = [];

    const left = this._left;
    const lx = left + 12;
    const rx = left + OVERLAY_W / 2 + 8;
    const top = CY - OVERLAY_H / 2;
    let y = this._contentStartY;

    if (this._activeTab === 'stats') {
      y = this._drawStatsTab(lx, rx, y);
    } else {
      y = this._drawGearTab(lx, y);
    }

    // Resize panel if needed
    const contentH = Math.max(OVERLAY_H, y - top + 20);
    if (this._panel) {
      this._panel.setSize(OVERLAY_W, contentH);
      this._panel.setPosition(CX, top + contentH / 2);
    }
  }

  _drawStatsTab(lx, rx, y) {
    const unit = this._unit;

    // Stats (2 columns)
    this._tabSep(lx, y); y += 12;
    const leftStats = ['STR', 'MAG', 'SKL', 'SPD'];
    const rightStats = ['DEF', 'RES', 'LCK', 'MOV'];
    for (let i = 0; i < leftStats.length; i++) {
      const ls = leftStats[i];
      const rs = rightStats[i];
      const lv = ls === 'MOV' ? (unit.mov ?? unit.stats.MOV) : unit.stats[ls];
      const rv = rs === 'MOV' ? (unit.mov ?? unit.stats.MOV) : unit.stats[rs];
      this._tabText(lx, y, `${ls.padEnd(4)}${String(lv).padStart(3)}`, STAT_COLORS[ls], '10px');
      this._tabText(rx, y, `${rs.padEnd(4)}${String(rv).padStart(3)}`, STAT_COLORS[rs], '10px');
      y += 13;
    }

    // Effective Stats (Atk, AS)
    const combat = getStaticCombatStats(unit, unit.weapon);
    const asColor = (combat.weight > 0) ? '#ff6666' : (combat.as > unit.stats.SPD ? '#44ff88' : STAT_COLORS.SPD);
    
    this._tabText(lx, y, `Atk ${String(combat.atk).padStart(3)}`, '#ffffff', '10px');
    this._tabText(rx, y, `AS  ${String(combat.as).padStart(3)}`, asColor, '10px');
    y += 15;

    // Proficiencies
    if (unit.proficiencies && unit.proficiencies.length > 0) {
      const profStr = unit.proficiencies.map(p => `${p.type}(${p.rank[0]})`).join('  ');
      this._tabText(lx, y, `Prof: ${profStr}`, '#aaaacc', '10px');
      y += 13;
    }

    // Affixes (Enemy/NPC only typically, but show for all if present)
    if (unit.affixes && unit.affixes.length > 0) {
      const affixNames = unit.affixes.map(aid => {
        const ad = this.gameData?.affixes?.affixes?.find(a => a.id === aid);
        return ad ? ad.name : aid;
      }).join(', ');
      const affixText = this._tabText(lx, y, `Affixes: ${affixNames}`, '#ff8844', '10px');
      
      // Multi-line tooltip for descriptions
      const descriptions = unit.affixes.map(aid => {
        const ad = this.gameData?.affixes?.affixes?.find(a => a.id === aid);
        return ad ? `${ad.name}: ${ad.description}` : aid;
      }).join('\n');

      affixText.setInteractive({ useHandCursor: true });
      affixText.on('pointerover', () => this._showSkillTooltip(affixText, descriptions));
      affixText.on('pointerout', () => this._hideSkillTooltip());
      
      y += 13;
    }

    // Growths (player/NPC only)
    if (unit.faction !== 'enemy' && unit.growths) {
      this._tabSep(lx, y); y += 12;
      const gStrs = XP_STAT_NAMES.map(s => `${s}:${unit.growths[s] || 0}`);
      this._tabText(lx, y, 'Growths: ' + gStrs.slice(0, 4).join(' '), UI_COLORS.gray, '9px');
      y += 12;
      this._tabText(lx, y, '         ' + gStrs.slice(4).join(' '), UI_COLORS.gray, '9px');
      y += 14;
    } else {
      y += 2;
    }

    // Terrain
    if (this._terrain) {
      this._tabSep(lx, y); y += 12;
      let tStr = `Terrain: ${this._terrain.name}`;
      if (parseInt(this._terrain.avoidBonus)) tStr += `  Avo+${this._terrain.avoidBonus}`;
      if (parseInt(this._terrain.defBonus)) tStr += `  Def+${this._terrain.defBonus}`;
      this._tabText(lx, y, tStr, '#aabb88', '9px');
      y += 14;
    }

    return y;
  }

  _drawGearTab(lx, y) {
    const unit = this._unit;

    // Inventory
    this._tabSep(lx, y); y += 12;
    if (unit.inventory && unit.inventory.length > 0) {
      for (const item of unit.inventory) {
        const marker = item === unit.weapon ? '\u25b6' : ' ';
        const color = isForged(item) ? '#44ff88' : UI_COLORS.white;
        let line;
        if (item.type === 'Staff') {
          const rem = getStaffRemainingUses(item, unit);
          const max = getStaffMaxUses(item, unit);
          const rng = getEffectiveStaffRange(item, unit);
          const rngStr = rng.min === rng.max ? `Rng${rng.max}` : `Rng${rng.min}-${rng.max}`;
          line = `${marker}${item.name} (${rem}/${max}) ${rngStr}`;
        } else if (item.might !== undefined) {
          const rng = parseRange(item.range);
          const rngStr = rng.min === rng.max ? `Rng${rng.max}` : `Rng${rng.min}-${rng.max}`;
          line = `${marker}${item.name} Mt${item.might} Ht${item.hit} Cr${item.crit} Wt${item.weight} ${rngStr}`;
        } else {
          line = `${marker}${item.name}`;
        }
        if (item.special) line += ' *';
        this._tabText(lx, y, line, color, '9px');
        y += 12;
      }
    } else {
      this._tabText(lx, y, '(no weapons)', UI_COLORS.gray, '9px');
      y += 12;
    }

    // Consumables
    if (unit.consumables && unit.consumables.length > 0) {
      for (const item of unit.consumables) {
        this._tabText(lx, y, ` ${item.name} (${item.uses})`, '#88ff88', '9px');
        y += 12;
      }
    }

    // Accessory
    if (unit.accessory) {
      this._tabSep(lx, y); y += 12;
      const fx = Object.entries(unit.accessory.effects || {}).filter(([, v]) => v).map(([k, v]) => `${k}+${v}`).join(' ');
      this._tabText(lx, y, `Acc: ${unit.accessory.name}`, '#cc88ff', '9px');
      if (fx) {
        this._tabText(lx + 180, y, fx, '#aa66dd', '9px');
      }
      y += 12;
      const ce = unit.accessory.combatEffects;
      if (ce) {
        const parts = [];
        if (ce.critBonus) parts.push(`Crit+${ce.critBonus}`);
        if (ce.atkBonus) parts.push(`Atk+${ce.atkBonus}`);
        if (ce.defBonus) parts.push(`Def+${ce.defBonus}`);
        if (ce.resBonus) parts.push(`Res+${ce.resBonus}`);
        if (ce.avoidBonus) parts.push(`Avo+${ce.avoidBonus}`);
        if (ce.hitBonus) parts.push(`Hit+${ce.hitBonus}`);
        if (ce.preventEnemyDouble) parts.push('No enemy double');
        if (ce.doubleThresholdReduction) parts.push(`Double-${ce.doubleThresholdReduction}`);
        if (ce.negateEffectiveness) parts.push('Negate effectiveness');
        if (ce.condition) parts.push(`(${ce.condition.replace('_', ' ')})`);
        if (parts.length) {
          this._tabText(lx + 8, y, parts.join('  '), '#aa66dd', '9px');
          y += 12;
        }
      }
    }

    // Skills
    if (unit.skills && unit.skills.length > 0) {
      this._tabSep(lx, y); y += 12;
      this._tabText(lx, y, `Skills (${unit.skills.length}/${MAX_SKILLS}):`, '#88ffff', '9px');
      y += 13;
      for (const sid of unit.skills) {
        const skillData = this.gameData?.skills?.find(s => s.id === sid);
        const name = skillData ? skillData.name : sid.replace(/_/g, ' ');
        const skillText = this._tabText(lx + 8, y, name, '#88ffff', '9px');
        if (skillData?.description) {
          skillText.setInteractive({ useHandCursor: true });
          skillText.on('pointerover', () => this._showSkillTooltip(skillText, skillData.description));
          skillText.on('pointerout', () => this._hideSkillTooltip());
        }
        y += 12;
      }
    }

    return y;
  }

  // --- Helpers ---

  _unitText(x, y, str, color, fontSize) {
    const t = this.scene.add.text(x, y, str, {
      fontFamily: 'monospace', fontSize: fontSize || '10px', color: color || UI_COLORS.white,
    }).setDepth(DEPTH_TEXT);
    this._unitObjects.push(t);
    return t;
  }

  _tabText(x, y, str, color, fontSize) {
    const t = this.scene.add.text(x, y, str, {
      fontFamily: 'monospace', fontSize: fontSize || '10px', color: color || UI_COLORS.white,
    }).setDepth(DEPTH_TEXT);
    this._tabObjects.push(t);
    return t;
  }

  _tabSep(x, y) {
    this._tabText(x, y, '\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500', UI_COLORS.gray, '9px');
  }

  _getPortraitKey(unit) {
    const lordData = this.gameData?.lords?.find(l => l.name === unit.name);
    if (lordData) return `portrait_lord_${unit.name.toLowerCase()}`;
    const classKey = `portrait_generic_${unit.className.toLowerCase().replace(/ /g, '_')}`;
    if (this.scene.textures.exists(classKey)) return classKey;
    const classData = this.gameData?.classes?.find(c => c.name === unit.className);
    if (classData?.promotesFrom) {
      const baseKey = `portrait_generic_${classData.promotesFrom.toLowerCase().replace(/ /g, '_')}`;
      if (this.scene.textures.exists(baseKey)) return baseKey;
    }
    return null;
  }

  _showSkillTooltip(anchor, description) {
    this._hideSkillTooltip();
    const tipX = Math.min(anchor.x + anchor.width + 8, 430);
    const tipY = Math.min(anchor.y, 440);
    const tipBg = this.scene.add.rectangle(tipX, tipY, 200, 10, 0x111111, 0.95)
      .setOrigin(0, 0).setDepth(DEPTH_TOOLTIP).setStrokeStyle(1, 0x555555);
    const tipText = this.scene.add.text(tipX + 4, tipY + 3, description, {
      fontFamily: 'monospace', fontSize: '9px', color: '#cccccc',
      wordWrap: { width: 192 },
    }).setDepth(DEPTH_TOOLTIP + 1);
    tipBg.setSize(200, tipText.height + 8);
    if (tipBg.y + tipBg.height > 480) tipBg.y = 480 - tipBg.height;
    tipText.y = tipBg.y + 3;
    this._skillTooltip = [tipBg, tipText];
  }

  _hideSkillTooltip() {
    if (this._skillTooltip) {
      for (const obj of this._skillTooltip) obj.destroy();
      this._skillTooltip = null;
    }
  }
}

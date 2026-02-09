// UnitDetailOverlay.js — Center-screen full unit detail overlay (opened via V key or tooltip click)
// Read-only display: portrait, stats, gear, skills, terrain

import { XP_STAT_NAMES, XP_PER_LEVEL, MAX_SKILLS } from '../utils/constants.js';
import { STAT_COLORS, UI_COLORS, getHPBarColor } from '../utils/uiStyles.js';
import { isForged } from '../engine/ForgeSystem.js';
import { getStaffRemainingUses, getStaffMaxUses, getEffectiveStaffRange, parseRange } from '../engine/Combat.js';

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
    this.objects = [];
    this.visible = false;
    this._skillTooltip = null;
  }

  show(unit, terrain, gameData) {
    this.hide();
    this.visible = true;
    if (gameData) this.gameData = gameData;

    const left = CX - OVERLAY_W / 2;
    const top = CY - OVERLAY_H / 2;

    // Full-screen click blocker
    const blocker = this.scene.add.rectangle(CX, CY, 640, 480, 0x000000, 0.7)
      .setDepth(DEPTH_BG).setInteractive();
    blocker.on('pointerdown', () => this.hide());
    this.objects.push(blocker);

    // Panel background
    const panel = this.scene.add.rectangle(CX, CY, OVERLAY_W, OVERLAY_H, 0x1a1a2e, 1)
      .setDepth(DEPTH_PANEL).setStrokeStyle(2, 0x444444);
    this.objects.push(panel);

    let y = top + 10;
    const lx = left + 12; // left column x
    const rx = left + OVERLAY_W / 2 + 8; // right column x

    // --- Header ---
    const factionLabel = unit.faction === 'player' ? '' : unit.faction === 'npc' ? ' [NPC]' : ' [Enemy]';
    this._text(lx, y, `${unit.name}${factionLabel}`, UI_COLORS.gold, '12px');

    // Portrait (top-right of panel)
    const portraitKey = this._getPortraitKey(unit);
    if (portraitKey && this.scene.textures.exists(portraitKey)) {
      const portrait = this.scene.add.image(left + OVERLAY_W - 36, y + 24, portraitKey)
        .setDisplaySize(48, 48).setDepth(DEPTH_TEXT);
      this.objects.push(portrait);
    }

    y += 16;
    const tierStr = unit.tier === 'promoted' ? 'Promoted' : 'Base';
    this._text(lx, y, `Lv ${unit.level || 1}  ${unit.className || ''}  (${tierStr})`, UI_COLORS.white, '10px');

    if (unit.faction === 'player' && unit.xp !== undefined) {
      y += 14;
      this._text(lx, y, `XP: ${unit.xp}/${XP_PER_LEVEL}`, '#88ccff', '10px');
    }

    y += 14;
    if (unit.moveType) {
      this._text(lx, y, `Move: ${unit.moveType}`, UI_COLORS.gray, '10px');
      y += 14;
    }

    // --- HP Bar ---
    const hpRatio = unit.currentHP / unit.stats.HP;
    const barW = 180;
    const barH = 8;
    const barBg = this.scene.add.rectangle(lx, y + 1, barW, barH, 0x333333).setOrigin(0, 0).setDepth(DEPTH_TEXT);
    const barFill = this.scene.add.rectangle(lx, y + 1, barW * hpRatio, barH, getHPBarColor(hpRatio)).setOrigin(0, 0).setDepth(DEPTH_TEXT);
    this.objects.push(barBg, barFill);
    this._text(lx + barW + 6, y, `${unit.currentHP}/${unit.stats.HP}`, STAT_COLORS.HP, '10px');
    y += 16;

    // --- Stats (2 columns) ---
    this._sep(lx, y); y += 12;
    const leftStats = ['STR', 'MAG', 'SKL', 'SPD'];
    const rightStats = ['DEF', 'RES', 'LCK', 'MOV'];
    for (let i = 0; i < leftStats.length; i++) {
      const ls = leftStats[i];
      const rs = rightStats[i];
      const lv = ls === 'MOV' ? (unit.mov ?? unit.stats.MOV) : unit.stats[ls];
      const rv = rs === 'MOV' ? (unit.mov ?? unit.stats.MOV) : unit.stats[rs];
      this._text(lx, y, `${ls.padEnd(4)}${String(lv).padStart(3)}`, STAT_COLORS[ls], '10px');
      this._text(rx, y, `${rs.padEnd(4)}${String(rv).padStart(3)}`, STAT_COLORS[rs], '10px');
      y += 13;
    }

    // --- Proficiencies ---
    if (unit.proficiencies && unit.proficiencies.length > 0) {
      const profStr = unit.proficiencies.map(p => `${p.type}(${p.rank[0]})`).join('  ');
      this._text(lx, y, `Prof: ${profStr}`, '#aaaacc', '10px');
      y += 13;
    }

    // --- Growths (player/NPC only) ---
    if (unit.faction !== 'enemy' && unit.growths) {
      this._sep(lx, y); y += 12;
      const gStrs = XP_STAT_NAMES.map(s => `${s}:${unit.growths[s] || 0}`);
      this._text(lx, y, 'Growths: ' + gStrs.slice(0, 4).join(' '), UI_COLORS.gray, '9px');
      y += 12;
      this._text(lx, y, '         ' + gStrs.slice(4).join(' '), UI_COLORS.gray, '9px');
      y += 14;
    } else {
      y += 2;
    }

    // --- Inventory ---
    this._sep(lx, y); y += 12;
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
        this._text(lx, y, line, color, '9px');
        y += 12;
      }
    } else {
      this._text(lx, y, '(no weapons)', UI_COLORS.gray, '9px');
      y += 12;
    }

    // Consumables
    if (unit.consumables && unit.consumables.length > 0) {
      for (const item of unit.consumables) {
        this._text(lx, y, ` ${item.name} (${item.uses})`, '#88ff88', '9px');
        y += 12;
      }
    }

    // --- Accessory ---
    if (unit.accessory) {
      this._sep(lx, y); y += 12;
      const fx = Object.entries(unit.accessory.effects || {}).filter(([, v]) => v).map(([k, v]) => `${k}+${v}`).join(' ');
      this._text(lx, y, `Acc: ${unit.accessory.name}`, '#cc88ff', '9px');
      if (fx) {
        this._text(lx + 180, y, fx, '#aa66dd', '9px');
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
          this._text(lx + 8, y, parts.join('  '), '#aa66dd', '9px');
          y += 12;
        }
      }
    }

    // --- Skills ---
    if (unit.skills && unit.skills.length > 0) {
      this._sep(lx, y); y += 12;
      this._text(lx, y, `Skills (${unit.skills.length}/${MAX_SKILLS}):`, '#88ffff', '9px');
      y += 13;
      for (const sid of unit.skills) {
        const skillData = this.gameData?.skills?.find(s => s.id === sid);
        const name = skillData ? skillData.name : sid.replace(/_/g, ' ');
        const skillText = this._text(lx + 8, y, name, '#88ffff', '9px');
        if (skillData?.description) {
          skillText.setInteractive({ useHandCursor: true });
          skillText.on('pointerover', () => this._showSkillTooltip(skillText, skillData.description));
          skillText.on('pointerout', () => this._hideSkillTooltip());
        }
        y += 12;
      }
    }

    // --- Terrain ---
    if (terrain) {
      this._sep(lx, y); y += 12;
      let tStr = `Terrain: ${terrain.name}`;
      if (parseInt(terrain.avoidBonus)) tStr += `  Avo+${terrain.avoidBonus}`;
      if (parseInt(terrain.defBonus)) tStr += `  Def+${terrain.defBonus}`;
      this._text(lx, y, tStr, '#aabb88', '9px');
      y += 14;
    }

    // --- Footer ---
    const footerY = top + OVERLAY_H - 18;
    this._text(lx, footerY, '[ESC] Close', UI_COLORS.gray, '9px');

    // Resize panel to fit content if needed
    const contentH = Math.max(OVERLAY_H, y - top + 20);
    if (contentH > OVERLAY_H) {
      panel.setSize(OVERLAY_W, contentH);
      panel.setPosition(CX, top + contentH / 2);
      blocker.setPosition(CX, CY); // blocker stays fullscreen
    }
  }

  hide() {
    this._hideSkillTooltip();
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
  }

  // --- Helpers ---

  _text(x, y, str, color, fontSize) {
    const t = this.scene.add.text(x, y, str, {
      fontFamily: 'monospace', fontSize: fontSize || '10px', color: color || UI_COLORS.white,
    }).setDepth(DEPTH_TEXT);
    this.objects.push(t);
    return t;
  }

  _sep(x, y) {
    this._text(x, y, '────────────────────────────────────────────', UI_COLORS.gray, '9px');
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
    // Clamp to canvas
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

// UnitInspectionPanel.js — Comprehensive unit inspection on right-click
// Two tabs: Stats (stats/growths/proficiencies/terrain) and Gear (inventory/consumables/accessory/skills)

import { XP_STAT_NAMES, XP_PER_LEVEL, MAX_SKILLS } from '../utils/constants.js';
import { STAT_COLORS, UI_COLORS } from '../utils/uiStyles.js';
import { isForged } from '../engine/ForgeSystem.js';
import { getStaffRemainingUses, getStaffMaxUses, getEffectiveStaffRange, parseRange } from '../engine/Combat.js';

export class UnitInspectionPanel {
  constructor(scene) {
    this.scene = scene;
    this.objects = [];
    this.visible = false;
    this.activeTab = 0; // 0 = Stats, 1 = Gear
    this._unit = null;
    this._terrain = null;
    this._gameData = null;
    this._panelX = 0;
    this._originX = 0;
    this._onKeyLeft = null;
    this._onKeyRight = null;
  }

  /**
   * Show detailed inspection panel for a unit.
   * @param {object} unit
   * @param {object} terrain - terrain data at unit's position (null for node map)
   * @param {object} gameData - full game data (for skill lookups)
   * @param {object} [posOverride] - optional { panelX, originX } to skip grid-based positioning
   */
  show(unit, terrain, gameData, posOverride) {
    this.hide();
    this.visible = true;
    this.activeTab = 0;

    // Store for re-rendering on tab switch
    this._unit = unit;
    this._terrain = terrain;
    this._gameData = gameData;

    const cam = this.scene.cameras.main;
    if (posOverride) {
      this._panelX = posOverride.panelX;
      this._originX = posOverride.originX;
    } else {
      const unitOnLeft = unit.col < Math.floor(this.scene.grid.cols / 2);
      this._panelX = unitOnLeft ? cam.width - 10 : 10;
      this._originX = unitOnLeft ? 1 : 0;
    }

    // Register keyboard listeners for tab switching
    this._onKeyLeft = () => {
      if (this.visible && this.activeTab > 0) this.switchTab(0);
    };
    this._onKeyRight = () => {
      if (this.visible && this.activeTab < 1) this.switchTab(1);
    };
    this.scene.input.keyboard.on('keydown-LEFT', this._onKeyLeft);
    this.scene.input.keyboard.on('keydown-RIGHT', this._onKeyRight);

    this._renderTab();
  }

  switchTab(tabIndex) {
    if (tabIndex === this.activeTab) return;
    this.activeTab = tabIndex;
    this._renderTab();
  }

  _renderTab() {
    // Destroy existing objects but keep state
    for (const obj of this.objects) obj.destroy();
    this.objects = [];

    const unit = this._unit;
    const terrain = this._terrain;
    const gameData = this._gameData;
    const panelX = this._panelX;
    const originX = this._originX;
    const panelY = 10;
    const lineHeight = 13;

    const lines = [];
    const colors = [];
    const addLine = (text, color = UI_COLORS.white) => {
      lines.push(text);
      colors.push(color);
    };

    // Header (shared across both tabs)
    this._buildHeaderLines(unit, addLine);

    // Tab bar placeholder lines — rendered as interactive objects below
    addLine('', UI_COLORS.gray); // tab labels
    addLine('', UI_COLORS.gray); // separator under tabs

    // Tab content
    if (this.activeTab === 0) {
      this._buildStatsLines(unit, terrain, gameData, addLine);
    } else {
      this._buildGearLines(unit, gameData, addLine);
    }

    // Calculate panel dimensions
    const panelWidth = 210;
    const panelHeight = lines.length * lineHeight + 16;

    // Panel background
    const bg = this.scene.add.rectangle(
      panelX + (originX === 1 ? -panelWidth / 2 : panelWidth / 2),
      panelY + panelHeight / 2,
      panelWidth, panelHeight,
      0x000000, 0.9
    ).setDepth(150).setStrokeStyle(1, UI_COLORS.panelBorder);
    this.objects.push(bg);

    // Render text lines
    const textX = originX === 1 ? panelX - panelWidth + 5 : panelX + 5;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === '') continue; // Skip tab bar placeholder
      const text = this.scene.add.text(textX, panelY + 6 + i * lineHeight, lines[i], {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: colors[i],
      }).setOrigin(0, 0).setDepth(151);
      this.objects.push(text);
    }

    // Render tab bar (interactive clickable labels)
    const tabBarIndex = this._getHeaderLineCount(unit);
    const tabBarY = panelY + 6 + tabBarIndex * lineHeight;
    this._renderTabBar(textX, tabBarY);
  }

  _buildHeaderLines(unit, addLine) {
    const factionLabel = unit.faction === 'player' ? '' : unit.faction === 'npc' ? ' [NPC]' : ' [Enemy]';
    addLine(`${unit.name}${factionLabel}`, UI_COLORS.gold);
    addLine(`Lv ${unit.level || 1} ${unit.className || ''}`, UI_COLORS.white);

    if (unit.faction === 'player' && unit.xp !== undefined) {
      addLine(`XP: ${unit.xp}/${XP_PER_LEVEL}`, '#88ccff');
    }

    if (unit.moveType) {
      addLine(`${unit.moveType} | ${unit.tier === 'promoted' ? 'Promoted' : 'Base'}`, UI_COLORS.gray);
    }
  }

  /** Count header lines (needed for tab bar positioning) */
  _getHeaderLineCount(unit) {
    let count = 2; // name + level
    if (unit.faction === 'player' && unit.xp !== undefined) count++;
    if (unit.moveType) count++;
    return count;
  }

  _renderTabBar(textX, y) {
    const tabNames = ['Stats', 'Gear'];
    let x = textX;

    for (let i = 0; i < tabNames.length; i++) {
      const isActive = i === this.activeTab;
      const label = ` ${tabNames[i]} `;
      const color = isActive ? UI_COLORS.gold : UI_COLORS.gray;

      // Create a temporary text to measure dimensions
      const tempText = this.scene.add.text(0, 0, label, {
        fontFamily: 'monospace',
        fontSize: '9px',
      });
      const btnWidth = tempText.width + 4;
      const btnHeight = tempText.height + 2;
      tempText.destroy();

      // Background button rectangle
      const bgColor = isActive ? 0x443300 : 0x222222;
      const btnBg = this.scene.add.rectangle(x, y - 1, btnWidth, btnHeight, bgColor, 1)
        .setOrigin(0, 0)
        .setDepth(151)
        .setStrokeStyle(1, isActive ? 0xffdd44 : 0x555555)
        .setInteractive({ useHandCursor: true });

      btnBg.on('pointerdown', () => this.switchTab(i));
      btnBg.on('pointerover', () => {
        if (i !== this.activeTab) {
          btnBg.setStrokeStyle(1, 0xaaaaaa);
        }
      });
      btnBg.on('pointerout', () => {
        btnBg.setStrokeStyle(1, i === this.activeTab ? 0xffdd44 : 0x555555);
      });

      this.objects.push(btnBg);

      // Tab text label
      const tabText = this.scene.add.text(x + 2, y, label, {
        fontFamily: 'monospace',
        fontSize: '9px',
        color: color,
      }).setOrigin(0, 0).setDepth(152);

      this.objects.push(tabText);
      x += btnWidth + 4;
    }

    // Navigation hint
    const hint = this.scene.add.text(x + 4, y, '\u25c4 \u25ba', {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: '#666666',
    }).setOrigin(0, 0).setDepth(152);
    this.objects.push(hint);

    // Separator after tab bar
    const sep = this.scene.add.text(textX, y + 15, '─────────────────────────', {
      fontFamily: 'monospace',
      fontSize: '9px',
      color: UI_COLORS.gray,
    }).setOrigin(0, 0).setDepth(151);
    this.objects.push(sep);
  }

  _buildStatsLines(unit, terrain, gameData, addLine) {
    // Stats with color coding
    addLine(`HP  ${String(unit.currentHP).padStart(3)}/${unit.stats.HP}`, STAT_COLORS.HP);
    for (const stat of XP_STAT_NAMES) {
      if (stat === 'HP') continue;
      addLine(`${stat.padEnd(4)} ${String(unit.stats[stat]).padStart(3)}`, STAT_COLORS[stat]);
    }
    addLine(`MOV  ${String(unit.mov || unit.stats.MOV).padStart(3)}`, STAT_COLORS.MOV);

    // Growth rates (player/NPC only)
    if (unit.faction !== 'enemy' && unit.growths) {
      addLine('─────────────────────────', UI_COLORS.gray);
      addLine('Growths:', UI_COLORS.gray);
      const growthStrs = [];
      for (const stat of XP_STAT_NAMES) {
        const g = unit.growths[stat] || 0;
        growthStrs.push(`${stat}:${g}`);
      }
      for (let i = 0; i < growthStrs.length; i += 3) {
        addLine('  ' + growthStrs.slice(i, i + 3).join(' '), UI_COLORS.gray);
      }
    }

    // Weapon proficiencies
    if (unit.proficiencies && unit.proficiencies.length > 0) {
      addLine('─────────────────────────', UI_COLORS.gray);
      const profStr = unit.proficiencies.map(p => `${p.type}(${p.rank[0]})`).join(' ');
      addLine(`Prof: ${profStr}`, '#aaaacc');
    }

    // Terrain info
    if (terrain) {
      addLine('─────────────────────────', UI_COLORS.gray);
      let terrainStr = `Trn: ${terrain.name}`;
      if (parseInt(terrain.avoidBonus)) terrainStr += ` Av+${terrain.avoidBonus}`;
      if (parseInt(terrain.defBonus)) terrainStr += ` Df+${terrain.defBonus}`;
      addLine(terrainStr, '#aabb88');
    }
  }

  _buildGearLines(unit, gameData, addLine) {
    // Inventory
    if (unit.inventory && unit.inventory.length > 0) {
      for (const item of unit.inventory) {
        const marker = item === unit.weapon ? '\u25b6' : ' ';
        const specialMarker = item.special ? '*' : '';
        const color = isForged(item) ? '#44ff88' : UI_COLORS.white;
        if (item.type === 'Staff') {
          const rem = getStaffRemainingUses(item, unit);
          const max = getStaffMaxUses(item, unit);
          const rng = getEffectiveStaffRange(item, unit);
          const rngStr = rng.min === rng.max ? `Rng${rng.max}` : `Rng${rng.min}-${rng.max}`;
          addLine(`${marker}${item.name}${specialMarker} (${rem}/${max}) ${rngStr}`, color);
        } else if (item.might !== undefined) {
          const rng = parseRange(item.range);
          const rngStr = rng.min === rng.max ? `Rng${rng.max}` : `Rng${rng.min}-${rng.max}`;
          addLine(`${marker}${item.name}${specialMarker} Mt${item.might} Ht${item.hit} Cr${item.crit} Wt${item.weight} ${rngStr}`, color);
        } else {
          addLine(`${marker}${item.name}`, color);
        }
      }
    } else {
      addLine('(no items)', UI_COLORS.gray);
    }

    // Consumables
    if (unit.consumables && unit.consumables.length > 0) {
      for (const item of unit.consumables) {
        addLine(` ${item.name} (${item.uses})`, '#88ff88');
      }
    }

    // Accessory
    if (unit.accessory) {
      addLine('─────────────────────────', UI_COLORS.gray);
      const fx = Object.entries(unit.accessory.effects || {}).filter(([, v]) => v).map(([k, v]) => `${k}+${v}`).join(' ');
      addLine(`Acc: ${unit.accessory.name}`, '#cc88ff');
      if (fx) addLine(`     ${fx}`, '#aa66dd');
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
        if (parts.length) addLine(`     ${parts.join(' ')}`, '#aa66dd');
      }
    }

    // Skills
    if (unit.skills && unit.skills.length > 0) {
      addLine('─────────────────────────', UI_COLORS.gray);
      addLine(`Skills (${unit.skills.length}/${MAX_SKILLS})`, '#88ffff');
      for (const sid of unit.skills) {
        const skillData = gameData?.skills?.find(s => s.id === sid);
        const name = skillData ? skillData.name : sid.replace(/_/g, ' ');
        addLine(`  ${name}`, '#88ffff');
        if (skillData?.description) {
          const wrapped = wrapText(skillData.description, 26);
          for (const wl of wrapped) {
            addLine(`    ${wl}`, UI_COLORS.gray);
          }
        }
      }
    }
  }

  hide() {
    for (const obj of this.objects) obj.destroy();
    this.objects = [];
    this.visible = false;
    this._unit = null;
    this._terrain = null;
    this._gameData = null;

    // Remove keyboard listeners
    if (this._onKeyLeft) {
      this.scene.input.keyboard.off('keydown-LEFT', this._onKeyLeft);
      this._onKeyLeft = null;
    }
    if (this._onKeyRight) {
      this.scene.input.keyboard.off('keydown-RIGHT', this._onKeyRight);
      this._onKeyRight = null;
    }
  }
}

function wrapText(text, maxChars) {
  const words = text.split(' ');
  const result = [];
  let line = '';
  for (const word of words) {
    if (line.length + word.length + 1 > maxChars && line.length > 0) {
      result.push(line);
      line = word;
    } else {
      line = line ? line + ' ' + word : word;
    }
  }
  if (line) result.push(line);
  return result;
}

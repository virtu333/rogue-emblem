// HomeBaseScene — Meta-progression upgrade shop with tabbed UI

import Phaser from 'phaser';
import { MUSIC } from '../utils/musicConfig.js';
import { MAX_STARTING_SKILLS, STARTING_ACCESSORY_TIERS, STARTING_STAFF_TIERS, CATEGORY_CURRENCY } from '../utils/constants.js';
import { clearSavedRun } from '../engine/RunManager.js';
import { deleteRunSave } from '../cloud/CloudSync.js';
import { showImportantHint, showMinorHint } from '../ui/HintDisplay.js';
import { startSceneLazy } from '../utils/sceneLoader.js';

const CATEGORIES = [
  { key: 'recruit_stats',      label: 'Recruits' },
  { key: 'lord_bonuses',       label: 'Lords' },
  { key: 'economy',            label: 'Economy' },
  { key: 'capacity',           label: 'Battalion' },
  { key: 'starting_equipment', label: 'Equip' },
  { key: 'starting_skills',    label: 'Skills' },
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
const ROW_H = 28;        // stat rows (label + desc on same line area)
const ROW_H_NAMED = 34;  // economy/capacity rows (name + desc needs more room)

export class HomeBaseScene extends Phaser.Scene {
  constructor() {
    super('HomeBase');
  }

  init(data) {
    this.gameData = data.gameData;
  }

  create() {
    const audio = this.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.homeBase, this);

    this.events.once('shutdown', () => {
      const audio = this.registry.get('audio');
      if (audio) audio.stopMusic(null, 0);
    });

    this.meta = this.registry.get('meta');
    this.activeTab = 'recruit_stats';
    this.selectedDifficulty = this.registry.get('selectedDifficulty') || 'normal';
    this._touchTapDown = null;
    this._tapMoveThreshold = 12;
    this.refreshDifficultyAvailability();

    this.input.keyboard.on('keydown-ESC', () => {
      this.requestCancel({ allowExit: true });
    });
    this.input.on('pointerdown', (pointer) => {
      this._touchTapDown = { x: pointer.x, y: pointer.y };
    });
    this.input.on('pointerup', (pointer) => this.onPointerUp(pointer));

    this.drawUI();

    // Tutorial hints for home base
    const hints = this.registry.get('hints');
    if (hints) {
      (async () => {
        if (hints.shouldShow('homebase_intro')) {
          await showImportantHint(this, 'Spend Valor and Supply to upgrade your army.\nUpgrades persist across all runs.');
        }
        if (hints.shouldShow('homebase_begin')) {
          showMinorHint(this, 'Click Begin Run when ready.');
        }
      })();
    }
  }

  drawUI() {
    this.refreshDifficultyAvailability();
    if (this._prereqTooltip) {
      this._prereqTooltip.destroy();
      this._prereqTooltip = null;
    }
    this.children.removeAll(true);

    const w = this.cameras.main.width;

    this.add.text(20, 12, 'HOME BASE', {
      fontFamily: 'monospace', fontSize: '20px', color: '#ffdd44', fontStyle: 'bold',
    });

    // Show both currencies — highlight the one used by the active tab
    const activeCurrency = CATEGORY_CURRENCY[this.activeTab] || 'supply';
    const valorColor = activeCurrency === 'valor' ? '#ffcc44' : '#665522';
    const supplyColor = activeCurrency === 'supply' ? '#44ccbb' : '#225544';
    this.add.text(w - 20, 8, `Valor: ${this.meta.getTotalValor()}`, {
      fontFamily: 'monospace', fontSize: '12px', color: valorColor,
    }).setOrigin(1, 0);
    this.add.text(w - 20, 24, `Supply: ${this.meta.getTotalSupply()}`, {
      fontFamily: 'monospace', fontSize: '12px', color: supplyColor,
    }).setOrigin(1, 0);

    this.drawTabs();
    this.drawTabContent(this.activeTab);
    this.drawBottomButtons();
  }

  drawTabs() {
    let tabX = 30;
    const tabY = 44;

    for (const cat of CATEGORIES) {
      const isActive = cat.key === this.activeTab;
      const color = isActive ? '#ffdd44' : '#aaaaaa';

      const tab = this.add.text(tabX, tabY, cat.label, {
        fontFamily: 'monospace', fontSize: '13px', color,
        fontStyle: isActive ? 'bold' : '',
      }).setInteractive({ useHandCursor: true });

      if (isActive) {
        const bounds = tab.getBounds();
        this.add.rectangle(
          bounds.x + bounds.width / 2, bounds.y + bounds.height + 2,
          bounds.width, 2, 0xffdd44
        );
      }

      tab.on('pointerover', () => { if (!isActive) tab.setColor('#ffffff'); });
      tab.on('pointerout', () => { if (!isActive) tab.setColor('#aaaaaa'); });
      tab.on('pointerdown', () => {
        if (this.activeTab !== cat.key) {
          this.activeTab = cat.key;
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

    const upgrades = this.meta.upgradesData.filter(u => u.category === category);
    const hasSubgroups = category === 'recruit_stats' || category === 'lord_bonuses';

    let y = 72;

    if (hasSubgroups) {
      const growthUpgrades = upgrades.filter(u => u.id.endsWith(GROWTH_SUFFIX));
      const flatUpgrades = upgrades.filter(u => u.id.endsWith(FLAT_SUFFIX));

      this.add.text(40, y, 'Growth Bonuses', {
        fontFamily: 'monospace', fontSize: '12px', color: '#888888', fontStyle: 'bold',
      });
      y += 18;

      for (const upgrade of growthUpgrades) {
        this.drawUpgradeRow(upgrade, y);
        y += ROW_H;
      }

      y += 6;

      this.add.text(40, y, 'Stat Bonuses', {
        fontFamily: 'monospace', fontSize: '12px', color: '#888888', fontStyle: 'bold',
      });
      y += 18;

      for (const upgrade of flatUpgrades) {
        this.drawUpgradeRow(upgrade, y);
        y += ROW_H;
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

      this.add.text(labelX, y, this._getStatLabel(upgrade), {
        fontFamily: 'monospace', fontSize: '12px', color: '#e0e0e0',
      });

      this._drawProgressBar(barX, y + 2, level, upgrade.maxLevel, maxed);

      this.add.text(descX, y, this._getActionDesc(upgrade), {
        fontFamily: 'monospace', fontSize: '10px', color: '#888888',
      });

      this._drawValueText(valuesX, y, current, next, maxed);
      this._drawCostButton(costX, y, upgrade, maxed, affordable);
    } else {
      // Named row: [Name] [Bar] [Current → Next] [Cost]
      //            [Description below]
      const labelX = 50;
      const barX = 220;
      const valuesX = barX + (BAR_SEGMENT_W + BAR_GAP) * upgrade.maxLevel + 10;
      const costX = 530;

      this.add.text(labelX, y, upgrade.name, {
        fontFamily: 'monospace', fontSize: '12px', color: '#e0e0e0',
      });

      this._drawProgressBar(barX, y + 2, level, upgrade.maxLevel, maxed);

      this._drawValueText(valuesX, y, current, next, maxed);

      this.add.text(labelX + 10, y + 16, this._getActionDesc(upgrade), {
        fontFamily: 'monospace', fontSize: '9px', color: '#666666',
      });

      this._drawCostButton(costX, y, upgrade, maxed, affordable);
    }
  }

  _drawCostButton(x, y, upgrade, maxed, affordable) {
    if (maxed) {
      this.add.text(x, y, 'MAX', {
        fontFamily: 'monospace', fontSize: '11px', color: '#ffdd44',
      });
      return;
    }

    const prereqsMet = this.meta.meetsPrerequisites(upgrade.id);

    if (!prereqsMet) {
      const lockText = this.add.text(x, y, 'LOCKED', {
        fontFamily: 'monospace', fontSize: '11px', color: '#aa4444',
        backgroundColor: '#221111', padding: { x: 6, y: 2 },
      }).setInteractive();

      // Tooltip on hover showing missing prerequisites
      lockText.on('pointerover', () => {
        const info = this.meta.getPrerequisiteInfo(upgrade.id);
        const tipText = 'Requires:\n' + info.missing.map(m => '  ' + m).join('\n');
        this._prereqTooltip = this.add.text(x - 120, y + 18, tipText, {
          fontFamily: 'monospace', fontSize: '9px', color: '#dddddd',
          backgroundColor: '#111122ee', padding: { x: 6, y: 4 },
          wordWrap: { width: 200 },
        }).setDepth(950);
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
      fontFamily: 'monospace', fontSize: '11px', color: btnColor,
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

  _drawProgressBar(x, y, level, maxLevel, maxed) {
    for (let i = 0; i < maxLevel; i++) {
      const filled = i < level;
      const color = filled ? (maxed ? BAR_FILLED_MAX : BAR_FILLED) : BAR_EMPTY;
      this.add.rectangle(
        x + i * (BAR_SEGMENT_W + BAR_GAP) + BAR_SEGMENT_W / 2,
        y + BAR_SEGMENT_H / 2,
        BAR_SEGMENT_W, BAR_SEGMENT_H, color
      );
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
    if (effect.recruitGrowth !== undefined || effect.lordGrowth !== undefined) return `+${effect.growthValue}%`;
    if (effect.stat !== undefined || effect.lordStat !== undefined) return `+${effect.value}`;
    if (effect.goldBonus !== undefined) return `+${effect.goldBonus}G`;
    if (effect.battleGoldMultiplier !== undefined) return `+${Math.round(effect.battleGoldMultiplier * 100)}%`;
    if (effect.extraVulnerary !== undefined) return `+${effect.extraVulnerary}`;
    if (effect.lootWeaponWeightBonus !== undefined) return `+${effect.lootWeaponWeightBonus}`;
    if (effect.deployBonus !== undefined) return `+${effect.deployBonus}`;
    if (effect.rosterCapBonus !== undefined) return `+${effect.rosterCapBonus}`;
    if (effect.startingWeaponForge !== undefined) return `+${effect.startingWeaponForge}`;
    if (effect.deadlyArsenal !== undefined) return 'Random';
    if (effect.recruitRandomSkill) return 'Random skill';
    if (effect.startingAccessoryTier !== undefined) return STARTING_ACCESSORY_TIERS[effect.startingAccessoryTier] || '?';
    if (effect.startingStaffTier !== undefined) return STARTING_STAFF_TIERS[effect.startingStaffTier] || '?';
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
        fontFamily: 'monospace', fontSize: '11px', color: '#ffdd44',
      });
    } else if (current) {
      // current → next
      const curText = this.add.text(x, y, current, {
        fontFamily: 'monospace', fontSize: '11px', color: '#aaaaaa',
      });
      const arrowX = x + curText.width + 4;
      const arrowText = this.add.text(arrowX, y, '\u2192', {
        fontFamily: 'monospace', fontSize: '11px', color: '#666666',
      });
      this.add.text(arrowX + arrowText.width + 4, y, next, {
        fontFamily: 'monospace', fontSize: '11px', color: '#88ff88',
      });
    } else {
      // unpurchased — show next only
      this.add.text(x, y, next, {
        fontFamily: 'monospace', fontSize: '11px', color: '#88ff88',
      });
    }
  }

  _getActionDesc(upgrade) {
    const effect = upgrade.effects[0];
    if (effect.recruitGrowth !== undefined) return `${effect.recruitGrowth} growth rate`;
    if (effect.lordGrowth !== undefined) return `${effect.lordGrowth} growth rate`;
    if (effect.stat !== undefined) return `Base ${effect.stat}`;
    if (effect.lordStat !== undefined) return `Base ${effect.lordStat}`;
    if (effect.goldBonus !== undefined) return 'Starting gold bonus';
    if (effect.battleGoldMultiplier !== undefined) return 'Battle gold bonus';
    if (effect.extraVulnerary !== undefined) return 'Starting Vulnerary';
    if (effect.lootWeaponWeightBonus !== undefined) return 'Better weapon drops';
    if (effect.deployBonus !== undefined) return 'Deploy slots';
    if (effect.rosterCapBonus !== undefined) return 'Max roster size';
    if (effect.startingWeaponForge !== undefined) return 'Forge starting weapons';
    if (effect.deadlyArsenal !== undefined) return 'Random Silver/Killer/Brave/Legend weapon';
    if (effect.recruitRandomSkill) return 'Recruit starts with combat skill';
    if (effect.startingAccessoryTier !== undefined) return 'Starting accessory for Edric';
    if (effect.startingStaffTier !== undefined) return "Sera's starting staff";
    return upgrade.description;
  }

  // --- Skills tab custom layout ---

  _drawSkillsTab() {
    const lords = this.gameData.lords.filter(l => l.name === 'Edric' || l.name === 'Sera');
    const assignments = this.meta.getSkillAssignments();
    const unlocked = this.meta.getUnlockedSkills();
    const skillsData = this.gameData.skills || [];

    let y = 72;

    // --- Lord viewer section ---
    this.add.text(40, y, 'Lord Skills', {
      fontFamily: 'monospace', fontSize: '12px', color: '#888888', fontStyle: 'bold',
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
        this.add.image(cx + 20, y + 20, portraitKey)
          .setDisplaySize(40, 40).setOrigin(0);
      }

      // Name
      this.add.text(cx + 66, y, lord.name, {
        fontFamily: 'monospace', fontSize: '13px', color: '#ffdd44', fontStyle: 'bold',
      });

      // Personal skill (locked)
      const personalName = lord.personalSkill.split(':')[0].trim();
      this.add.text(cx + 66, y + 16, `\u2605 ${personalName}`, {
        fontFamily: 'monospace', fontSize: '10px', color: '#ffcc66',
      });

      // Assignable skill slots
      for (let s = 0; s < MAX_STARTING_SKILLS; s++) {
        const slotY = y + 34 + s * 18;
        const skillId = assigned[s];

        if (skillId) {
          const skill = skillsData.find(sk => sk.id === skillId);
          const skillName = skill ? skill.name : skillId;
          this.add.text(cx + 66, slotY, `\u25CB ${skillName}`, {
            fontFamily: 'monospace', fontSize: '10px', color: '#88ccff',
          });

          // [x] remove button
          const removeBtn = this.add.text(cx + 200, slotY, '[x]', {
            fontFamily: 'monospace', fontSize: '10px', color: '#cc6666',
            backgroundColor: '#331111', padding: { x: 2, y: 1 },
          }).setInteractive({ useHandCursor: true });
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
            fontFamily: 'monospace', fontSize: '10px', color: '#555555',
          });

          // [+] assign button — only if there are unlocked skills to assign
          if (unlocked.length > 0) {
            const addBtn = this.add.text(cx + 200, slotY, '[+]', {
              fontFamily: 'monospace', fontSize: '10px', color: '#88ff88',
              backgroundColor: '#113311', padding: { x: 2, y: 1 },
            }).setInteractive({ useHandCursor: true });
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
      fontFamily: 'monospace', fontSize: '12px', color: '#888888', fontStyle: 'bold',
    });
    y += 18;

    const skillUpgrades = this.meta.upgradesData.filter(u => u.category === 'starting_skills');
    for (const upgrade of skillUpgrades) {
      const level = this.meta.getUpgradeLevel(upgrade.id);
      const maxed = this.meta.isMaxed(upgrade.id);
      const affordable = this.meta.canAfford(upgrade.id);

      const labelX = 50;
      const descX = 160;
      const costX = 530;

      // Skill name
      this.add.text(labelX, y, upgrade.name, {
        fontFamily: 'monospace', fontSize: '12px',
        color: maxed ? '#88ccff' : '#e0e0e0',
      });

      // Short description
      this.add.text(descX, y, upgrade.description, {
        fontFamily: 'monospace', fontSize: '9px', color: '#666666',
      });

      // Cost / Unlocked
      if (maxed) {
        this.add.text(costX, y, 'UNLOCKED', {
          fontFamily: 'monospace', fontSize: '11px', color: '#ffdd44',
        });
      } else {
        const cost = this.meta.getNextCost(upgrade.id);
        const currency = this.meta.getCurrencyForUpgrade(upgrade.id);
        const suffix = currency === 'valor' ? 'V' : 'S';
        const btnColor = affordable ? '#88ff88' : '#555555';
        const btn = this.add.text(costX, y, `${cost}${suffix}`, {
          fontFamily: 'monospace', fontSize: '11px', color: btnColor,
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
      this._skillPickerObjects.forEach(o => o.destroy());
      this._skillPickerObjects = null;
    }

    const unlocked = this.meta.getUnlockedSkills();
    const assignments = this.meta.getSkillAssignments();
    const assigned = assignments[lordName] || [];
    const skillsData = this.gameData.skills || [];

    // Skills available to assign: unlocked and not already on this lord
    const available = unlocked.filter(id => !assigned.includes(id));
    if (available.length === 0) return;

    const objects = [];
    const bgW = 180;
    const bgH = available.length * 20 + 10;
    const bgX = Math.min(px, 440); // keep on screen
    const bgY = py + 14;

    // Background panel
    const bg = this.add.rectangle(bgX + bgW / 2, bgY + bgH / 2, bgW, bgH, 0x222233, 0.95)
      .setStrokeStyle(1, 0x4444aa).setDepth(900);
    objects.push(bg);

    let iy = bgY + 5;
    for (const skillId of available) {
      const skill = skillsData.find(s => s.id === skillId);
      const name = skill ? skill.name : skillId;
      const entry = this.add.text(bgX + 8, iy, name, {
        fontFamily: 'monospace', fontSize: '10px', color: '#88ccff',
        backgroundColor: '#222233', padding: { x: 4, y: 2 },
      }).setDepth(901).setInteractive({ useHandCursor: true });

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
    const cancel = this.add.text(bgX + bgW - 8, bgY + 2, 'x', {
      fontFamily: 'monospace', fontSize: '10px', color: '#cc6666',
    }).setOrigin(1, 0).setDepth(901).setInteractive({ useHandCursor: true });
    cancel.on('pointerdown', () => this._destroySkillPicker());
    objects.push(cancel);

    this._skillPickerObjects = objects;
  }

  _destroySkillPicker() {
    if (this._skillPickerObjects) {
      this._skillPickerObjects.forEach(o => o.destroy());
      this._skillPickerObjects = null;
    }
  }

  drawBottomButtons() {
    const cx = this.cameras.main.centerX;
    const btnY = 450;
    const difficultyY = 410;

    const modes = this.gameData?.difficulty?.modes || {};
    const normalColor = modes.normal?.color || '#44cc44';
    const hardColorData = modes.hard?.color || '#ff8800';
    const lunaticLabel = modes.lunatic?.label || 'Lunatic';

    this.add.text(cx - 150, difficultyY, 'Difficulty:', {
      fontFamily: 'monospace', fontSize: '12px', color: '#aaaaaa',
    }).setOrigin(0, 0.5);

    const normalBtnColor = this.selectedDifficulty === 'normal' ? normalColor : '#e0e0e0';
    const normalBtn = this.add.text(cx - 62, difficultyY, '[Normal]', {
      fontFamily: 'monospace', fontSize: '12px', color: normalBtnColor,
      backgroundColor: '#222222', padding: { x: 6, y: 3 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    normalBtn.on('pointerdown', () => {
      this.selectedDifficulty = 'normal';
      this.registry.set('selectedDifficulty', this.selectedDifficulty);
      this.drawUI();
    });

    const hardColor = this.hardUnlocked ? (this.selectedDifficulty === 'hard' ? hardColorData : '#e0e0e0') : '#666666';
    const hardBtn = this.add.text(cx + 20, difficultyY, '[Hard]', {
      fontFamily: 'monospace', fontSize: '12px', color: hardColor,
      backgroundColor: '#222222', padding: { x: 6, y: 3 },
    }).setOrigin(0.5);
    if (this.hardUnlocked) {
      hardBtn.setInteractive({ useHandCursor: true });
      hardBtn.on('pointerdown', () => {
        this.selectedDifficulty = 'hard';
        this.registry.set('selectedDifficulty', this.selectedDifficulty);
        this.drawUI();
      });
    }

    this.add.text(cx + 112, difficultyY, `[${lunaticLabel}: Soon]`, {
      fontFamily: 'monospace', fontSize: '12px', color: '#666666',
      backgroundColor: '#222222', padding: { x: 6, y: 3 },
    }).setOrigin(0.5);

    const beginBtn = this.add.text(cx - 100, btnY, '[ Begin Run ]', {
      fontFamily: 'monospace', fontSize: '16px', color: '#88ff88',
      backgroundColor: '#000000aa', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    beginBtn.on('pointerover', () => beginBtn.setColor('#ffdd44'));
    beginBtn.on('pointerout', () => beginBtn.setColor('#88ff88'));
    beginBtn.on('pointerdown', async () => {
      const cloud = this.registry.get('cloud');
      const slot = this.registry.get('activeSlot');
      clearSavedRun(cloud ? () => deleteRunSave(cloud.userId, slot) : null);
      const audio = this.registry.get('audio');
      if (audio) audio.stopMusic(this, 0);
      await startSceneLazy(this, 'NodeMap', { gameData: this.gameData, difficultyId: this.selectedDifficulty });
    });

    const backBtn = this.add.text(cx + 100, btnY, '[ Back to Title ]', {
      fontFamily: 'monospace', fontSize: '16px', color: '#e0e0e0',
      backgroundColor: '#000000aa', padding: { x: 14, y: 8 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    backBtn.on('pointerover', () => backBtn.setColor('#ffdd44'));
    backBtn.on('pointerout', () => backBtn.setColor('#e0e0e0'));
    backBtn.on('pointerdown', async () => {
      const audio = this.registry.get('audio');
      if (audio) audio.stopMusic(this, 0);
      await startSceneLazy(this, 'Title', { gameData: this.gameData });
    });
  }

  refreshDifficultyAvailability() {
    if (this.selectedDifficulty !== 'normal' && this.selectedDifficulty !== 'hard') {
      this.selectedDifficulty = 'normal';
    }
    this.hardUnlocked = Boolean(this.meta?.hasMilestone?.('beatGame'));
    if (this.selectedDifficulty === 'hard' && !this.hardUnlocked) {
      this.selectedDifficulty = 'normal';
      this.registry.set('selectedDifficulty', this.selectedDifficulty);
    }
  }

  onPointerUp(pointer) {
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
    return Array.isArray(hit) && hit.some(obj =>
      obj
      && obj.visible !== false
      && obj.active !== false
      && obj.input?.enabled
    );
  }

  canRequestCancel({ allowExit = true } = {}) {
    if (this._skillPickerObjects) return true;
    if (allowExit) return true;
    return false;
  }

  requestCancel({ allowExit = true } = {}) {
    if (!this.canRequestCancel({ allowExit })) return false;
    if (this._skillPickerObjects) {
      this._destroySkillPicker();
      return true;
    }
    if (allowExit) {
      const audio = this.registry.get('audio');
      if (audio) audio.stopMusic(this, 0);
      void startSceneLazy(this, 'Title', { gameData: this.gameData });
      return true;
    }
    return false;
  }
}

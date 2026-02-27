// ColosseumOverlay.js — Overlay UI for the Colosseum node (Arena + Mercenary Board)
// Self-contained overlay class following RosterOverlay/PauseOverlay patterns.
// All Phaser objects pushed to this.objects[] and destroyed in bulk on hide().

import {
  getAvailableTiers,
  generateChallenger,
  calculateArenaReward,
  calculateArenaXP,
  canFight,
  getMaxFights,
  getArenaDistance,
  generateMercenaryCandidates,
} from '../engine/ColosseumEngine.js';
import { resolveCombat, getCombatForecast } from '../engine/Combat.js';
import { getSkillCombatMods, rollStrikeSkills, rollDefenseSkills } from '../engine/SkillSystem.js';
import { gainExperience, getDisplayLevel } from '../engine/UnitManager.js';
import { ROSTER_CAP, RECRUIT_PROMOTION_BASE_LEVEL } from '../utils/constants.js';
import { resolveRecruitScalingTargets } from '../engine/RecruitScaling.js';

// ── Layout constants (match NodeMapScene overlay pattern) ──
const BG_DEPTH = 300;
const PANEL_DEPTH = 301;
const CONTENT_DEPTH = 302;
const PANEL_W = 560;
const PANEL_H = 425;
const CX = 320;
const CY = 240;

// ── Shared text styles ──
const TITLE_STYLE = {
  fontFamily: 'monospace',
  fontSize: '18px',
  color: '#ffdd44',
  fontStyle: 'bold',
};
const HEADER_STYLE = {
  fontFamily: 'monospace',
  fontSize: '14px',
  color: '#ffdd44',
  fontStyle: 'bold',
};
const BODY_STYLE = {
  fontFamily: 'monospace',
  fontSize: '12px',
  color: '#e0e0e0',
};
const SMALL_STYLE = {
  fontFamily: 'monospace',
  fontSize: '10px',
  color: '#aaaaaa',
};
const GOLD_STYLE = {
  fontFamily: 'monospace',
  fontSize: '13px',
  color: '#ffdd44',
};

function btnStyle(color = '#ffdd44') {
  return {
    fontFamily: 'monospace',
    fontSize: '14px',
    color,
    backgroundColor: '#333333',
    padding: { x: 10, y: 5 },
  };
}

export class ColosseumOverlay {
  constructor(scene, runManager, gameData) {
    this.scene = scene;
    this.runManager = runManager;
    this.gameData = gameData;
    this.objects = [];
    this.visible = false;

    // Arena state
    this._fightsPerUnit = {}; // unitName → count
    this._levelsGainedThisVisit = {}; // unitName → count
    this._selectedUnit = null;
    this._selectedTier = null;
    this._challenger = null;
    this._unitSelectPage = 0;

    // Mercenary state
    this._mercCandidates = null;
    this._mercHired = false;
    this._mercGenerationFailed = false;
  }

  // ────────────────────────────────────────
  // Public API
  // ────────────────────────────────────────

  show(node, onLeave) {
    this._onLeave = onLeave;
    this._node = node;
    this._actId = this.runManager.currentAct;
    this.visible = true;
    this._unitSelectPage = 0;

    const colosseumData = this.gameData.colosseum;
    this._colosseumData = colosseumData;
    this._maxFights = getMaxFights(this._getDifficultyId(), colosseumData);

    this._showMenu();
  }

  /** Close the overlay visually (ESC path). Does NOT invoke the leave callback. */
  hide() {
    if (!this.visible) return;
    this.visible = false;
    this._clearScreen();
  }

  /** Explicitly leave the colosseum (Leave button). Hides overlay and fires leave callback. */
  leave() {
    this.hide();
    if (this._onLeave) this._onLeave();
  }

  // ────────────────────────────────────────
  // Screen management
  // ────────────────────────────────────────

  _clearScreen() {
    for (const obj of this.objects) {
      if (obj && typeof obj.destroy === 'function') obj.destroy();
    }
    this.objects = [];
  }

  _addBg() {
    const bg = this.scene.add
      .rectangle(CX, CY, 640, 480, 0x000000, 0.9)
      .setDepth(BG_DEPTH)
      .setInteractive();
    this.objects.push(bg);
  }

  _addPanel() {
    const panel = this.scene.add
      .rectangle(CX, CY, PANEL_W, PANEL_H, 0x111111, 0.95)
      .setDepth(PANEL_DEPTH)
      .setStrokeStyle(2, 0x444444)
      .setInteractive();
    this.objects.push(panel);
  }

  _addTitle(text) {
    const t = this.scene.add.text(CX, 50, text, TITLE_STYLE).setOrigin(0.5).setDepth(CONTENT_DEPTH);
    this.objects.push(t);
  }

  _addGold() {
    const t = this.scene.add
      .text(CX, 75, `Gold: ${this.runManager.gold}G`, GOLD_STYLE)
      .setOrigin(0.5)
      .setDepth(CONTENT_DEPTH);
    this.objects.push(t);
    return t;
  }

  _addBtn(x, y, label, color, callback) {
    const btn = this.scene.add
      .text(x, y, label, btnStyle(color))
      .setOrigin(0.5)
      .setDepth(CONTENT_DEPTH)
      .setInteractive({ useHandCursor: true })
      .on('pointerover', () => btn.setAlpha(0.8))
      .on('pointerout', () => btn.setAlpha(1))
      .on('pointerdown', callback);
    this.objects.push(btn);
    return btn;
  }

  // ────────────────────────────────────────
  // SCREEN: Main Menu
  // ────────────────────────────────────────

  _showMenu() {
    this._clearScreen();
    this._addBg();
    this._addPanel();
    this._addTitle('Colosseum');
    this._addGold();

    this._addBtn(CX, 170, '[ Arena ]', '#44ff44', () => this._showUnitSelect());
    this._addBtn(CX, 220, '[ Mercenary Board ]', '#66ddff', () => this._showMercBrowse());
    this._addBtn(CX, 300, '[ Leave ]', '#ff6666', () => this.leave());

    // Flavor text
    const flavor = this.scene.add
      .text(CX, 120, 'Train your fighters or hire seasoned mercenaries.', {
        ...BODY_STYLE,
        fontStyle: 'italic',
      })
      .setOrigin(0.5)
      .setDepth(CONTENT_DEPTH);
    this.objects.push(flavor);
  }

  // ────────────────────────────────────────
  // SCREEN: Unit Select (Arena)
  // ────────────────────────────────────────

  _showUnitSelect() {
    this._clearScreen();
    this._addBg();
    this._addPanel();
    this._addTitle('Arena — Select Fighter');
    this._addGold();

    const roster = this.runManager.roster || [];
    const unitsPerPage = 8;
    const maxPage = Math.max(0, Math.ceil(roster.length / unitsPerPage) - 1);
    this._unitSelectPage = Math.min(Math.max(this._unitSelectPage || 0, 0), maxPage);
    const startIndex = this._unitSelectPage * unitsPerPage;
    const pageRoster = roster.slice(startIndex, startIndex + unitsPerPage);

    const startY = 100;
    const lineH = 28;
    let y = startY;

    if (roster.length === 0) {
      const t = this.scene.add
        .text(CX, 200, 'No units available.', BODY_STYLE)
        .setOrigin(0.5)
        .setDepth(CONTENT_DEPTH);
      this.objects.push(t);
    } else {
      // Column headers
      const hdr = this.scene.add
        .text(65, y, 'Name             Class         Lv  HP    Fights', SMALL_STYLE)
        .setDepth(CONTENT_DEPTH);
      this.objects.push(hdr);
      y += lineH;

      for (const unit of pageRoster) {
        const fights = this._fightsPerUnit[unit.name] || 0;
        const eligible = canFight(unit, fights, this._maxFights);
        const hpStr = `${unit.currentHP}/${unit.stats.HP}`;
        const fightStr = `${fights}/${this._maxFights}`;

        const name = (unit.name || '???').padEnd(17);
        const cls = (unit.className || '').padEnd(14);
        const lv = getDisplayLevel(unit).padStart(2);
        const hp = hpStr.padStart(6);
        const ft = fightStr;

        const color = eligible ? '#e0e0e0' : '#666666';
        const line = this.scene.add
          .text(65, y, `${name}${cls}${lv}  ${hp}  ${ft}`, {
            ...BODY_STYLE,
            color,
          })
          .setDepth(CONTENT_DEPTH);
        this.objects.push(line);

        if (eligible) {
          line.setInteractive({ useHandCursor: true });
          line.on('pointerover', () => line.setColor('#ffdd44'));
          line.on('pointerout', () => line.setColor(color));
          line.on('pointerdown', () => {
            this._selectedUnit = unit;
            this._showTierSelect();
          });
        }

        y += lineH;
      }

      if (roster.length > unitsPerPage) {
        if (this._unitSelectPage > 0) {
          this._addBtn(CX - 120, 400, '[ Prev ]', '#aaaaaa', () => {
            this._unitSelectPage = Math.max(0, this._unitSelectPage - 1);
            this._showUnitSelect();
          });
        }
        const pageText = this.scene.add
          .text(CX, 400, `Page ${this._unitSelectPage + 1}/${maxPage + 1}`, SMALL_STYLE)
          .setOrigin(0.5)
          .setDepth(CONTENT_DEPTH);
        this.objects.push(pageText);
        if (this._unitSelectPage < maxPage) {
          this._addBtn(CX + 120, 400, '[ Next ]', '#aaaaaa', () => {
            this._unitSelectPage = Math.min(maxPage, this._unitSelectPage + 1);
            this._showUnitSelect();
          });
        }
      }
    }

    this._addBtn(CX, 430, '[ Back ]', '#aaaaaa', () => this._showMenu());
  }

  // ────────────────────────────────────────
  // SCREEN: Tier Select
  // ────────────────────────────────────────

  _showTierSelect(message = null) {
    this._clearScreen();
    this._addBg();
    this._addPanel();
    this._addTitle('Arena — Select Tier');
    this._addGold();

    const unit = this._selectedUnit;
    const info = this.scene.add
      .text(
        CX,
        95,
        `Fighter: ${unit.name} (Lv ${getDisplayLevel(unit)} ${unit.className})`,
        BODY_STYLE,
      )
      .setOrigin(0.5)
      .setDepth(CONTENT_DEPTH);
    this.objects.push(info);

    if (message) {
      const msg = this.scene.add
        .text(CX, 115, message, {
          ...SMALL_STYLE,
          color: '#ff8888',
        })
        .setOrigin(0.5)
        .setDepth(CONTENT_DEPTH);
      this.objects.push(msg);
    }

    const tiers = getAvailableTiers(this._actId, this._colosseumData);
    const tierColors = {
      bronze: '#cd7f32',
      silver: '#c0c0c0',
      gold: '#ffd700',
      platinum: '#e5e4e2',
    };

    let y = 140;
    for (const [tierName, tier] of tiers) {
      const canAfford = this._canAffordTier(tier);
      const color = canAfford ? tierColors[tierName] || '#e0e0e0' : '#666666';
      const label = `[ ${tierName.charAt(0).toUpperCase() + tierName.slice(1)} ]`;
      const detail = `Win: +${tier.goldReward}G  |  Lose: -${tier.entryFee}G  |  XP: ${tier.xpMultiplier}×`;

      if (canAfford) {
        this._addBtn(CX, y, label, color, () => {
          this._selectedTier = { name: tierName, ...tier };
          this._generateAndShowForecast();
        });
      } else {
        const disabledBtn = this.scene.add
          .text(CX, y, label, {
            ...btnStyle(color),
            backgroundColor: '#222222',
          })
          .setOrigin(0.5)
          .setDepth(CONTENT_DEPTH)
          .setAlpha(0.7);
        this.objects.push(disabledBtn);
      }

      const detailText = this.scene.add
        .text(CX, y + 20, detail, SMALL_STYLE)
        .setOrigin(0.5)
        .setDepth(CONTENT_DEPTH);
      this.objects.push(detailText);

      if (!canAfford) {
        const reasonText = this.scene.add
          .text(CX, y + 36, `Need ${tier.entryFee}G (have ${this.runManager.gold}G)`, {
            ...SMALL_STYLE,
            color: '#ff6666',
          })
          .setOrigin(0.5)
          .setDepth(CONTENT_DEPTH);
        this.objects.push(reasonText);
      }

      y += canAfford ? 55 : 68;
    }

    this._addBtn(CX, 430, '[ Back ]', '#aaaaaa', () => this._showUnitSelect());
  }

  // ────────────────────────────────────────
  // SCREEN: Forecast
  // ────────────────────────────────────────

  _generateAndShowForecast() {
    const unit = this._selectedUnit;
    const tier = this._selectedTier;
    const colosseumData = this._colosseumData;
    const actId = this._actId;
    const difficultyId = this._getDifficultyId();

    this._challenger = generateChallenger(
      unit.level,
      tier,
      actId,
      this.gameData.enemies,
      this.gameData.classes,
      this.gameData.weapons,
      difficultyId,
      colosseumData,
      Math.random,
    );

    this._showForecast();
  }

  _showForecast() {
    this._clearScreen();
    this._addBg();
    this._addPanel();
    this._addTitle('Arena — Pre-Fight');
    this._addGold();

    const unit = this._selectedUnit;
    const challenger = this._challenger.unit;
    const tier = this._selectedTier;

    // Build forecast
    const distance = getArenaDistance(unit.weapon, challenger.weapon);
    const plainTerrain = { avoidBonus: 0, defBonus: 0 };

    // Minimal skill context for forecast (arena = isolated 1v1, no allies)
    const skillsData = this.gameData.skills || [];
    const atkMods = getSkillCombatMods(
      unit,
      challenger,
      [unit],
      [challenger],
      skillsData,
      plainTerrain,
      true,
    );
    const defMods = getSkillCombatMods(
      challenger,
      unit,
      [challenger],
      [unit],
      skillsData,
      plainTerrain,
      false,
    );

    const forecast = getCombatForecast(
      unit,
      unit.weapon,
      challenger,
      challenger.weapon,
      distance,
      plainTerrain,
      plainTerrain,
      { atkMods, defMods },
    );

    // Layout: two columns
    const leftX = 145;
    const rightX = 500;
    let y = 105;

    // Unit column
    const makeCol = (x, name, cls, lv, hp, wpn, fc) => {
      const items = [
        `${name}`,
        `${cls} Lv ${lv}`,
        `HP: ${hp}`,
        `Weapon: ${wpn}`,
        '',
        `Atk: ${fc.damage}  Hit: ${fc.hit}%  Crit: ${fc.crit}%`,
        fc.doubles ? 'Doubles: Yes' : 'Doubles: No',
      ];
      for (const line of items) {
        const t = this.scene.add
          .text(x, y, line, BODY_STYLE)
          .setOrigin(0.5)
          .setDepth(CONTENT_DEPTH);
        this.objects.push(t);
        y += 18;
      }
    };

    y = 105;
    makeCol(
      leftX,
      unit.name,
      unit.className,
      unit.level,
      `${unit.currentHP}/${unit.stats.HP}`,
      unit.weapon?.name || 'None',
      forecast.attacker,
    );

    // VS
    const vs = this.scene.add
      .text(CX, 160, 'VS', {
        ...HEADER_STYLE,
        fontSize: '16px',
        color: '#ff6666',
      })
      .setOrigin(0.5)
      .setDepth(CONTENT_DEPTH);
    this.objects.push(vs);

    y = 105;
    makeCol(
      rightX,
      challenger.name,
      challenger.className,
      challenger.level,
      `${challenger.currentHP}/${challenger.stats.HP}`,
      challenger.weapon?.name || 'None',
      forecast.defender,
    );

    // Entry fee warning
    const feeText = this.scene.add
      .text(CX, 310, `Entry fee on loss: ${tier.entryFee}G`, { ...SMALL_STYLE, color: '#ff8888' })
      .setOrigin(0.5)
      .setDepth(CONTENT_DEPTH);
    this.objects.push(feeText);

    // Buttons
    this._addBtn(CX - 80, 370, '[ Fight! ]', '#44ff44', () => this._executeFight());
    this._addBtn(CX + 80, 370, '[ Withdraw ]', '#aaaaaa', () => this._showTierSelect());

    this._addBtn(CX, 430, '[ Back to Menu ]', '#aaaaaa', () => this._showMenu());
  }

  // ────────────────────────────────────────
  // SCREEN: Combat Log
  // ────────────────────────────────────────

  _executeFight() {
    const unit = this._selectedUnit;
    const challenger = this._challenger.unit;
    const tier = this._selectedTier;

    if (!this._canAffordTier(tier)) {
      this._showTierSelect(`Not enough gold to enter (${tier.entryFee}G required).`);
      return;
    }

    const distance = getArenaDistance(unit.weapon, challenger.weapon);
    const plainTerrain = { avoidBonus: 0, defBonus: 0 };

    // Build full skill context for resolution
    const skillsData = this.gameData.skills || [];
    const atkMods = getSkillCombatMods(
      unit,
      challenger,
      [unit],
      [challenger],
      skillsData,
      plainTerrain,
      true,
    );
    const defMods = getSkillCombatMods(
      challenger,
      unit,
      [challenger],
      [unit],
      skillsData,
      plainTerrain,
      false,
    );

    const skillCtx = {
      atkMods,
      defMods,
      rollStrikeSkills,
      rollDefenseSkills,
      skillsData,
    };

    const result = resolveCombat(
      unit,
      unit.weapon,
      challenger,
      challenger.weapon,
      distance,
      plainTerrain,
      plainTerrain,
      skillCtx,
    );

    // Determine outcome: KO wins, otherwise draw (no HP% comparison)
    let outcome;
    if (result.defenderDied) {
      outcome = 'win';
    } else if (result.attackerDied) {
      outcome = 'lose';
    } else {
      outcome = 'draw';
    }

    // Apply HP (arena clamp: min 1)
    unit.currentHP = Math.max(1, result.attackerHP);

    // Track fights
    this._fightsPerUnit[unit.name] = (this._fightsPerUnit[unit.name] || 0) + 1;

    // Show combat log with auto-advance
    this._showCombatLog(result.events, outcome, tier);
  }

  _showCombatLog(events, outcome, tier) {
    this._clearScreen();
    this._addBg();
    this._addPanel();
    this._addTitle('Arena — Combat');

    // Format events into text lines
    const lines = [];
    for (const evt of events) {
      if (evt.type !== 'strike') continue;

      // Skill activations before the strike description
      if (evt.skillActivations?.length > 0) {
        for (const sa of evt.skillActivations) {
          lines.push({
            text: `  ★ ${sa.name || sa.id} activates!`,
            color: '#ddaaff',
          });
        }
      }

      if (evt.miss) {
        lines.push({
          text: `${evt.attacker} attacks... Miss!`,
          color: '#888888',
        });
      } else if (evt.isCrit) {
        lines.push({
          text: `${evt.attacker} lands a critical hit! ${evt.damage} damage!`,
          color: '#ff4444',
        });
      } else {
        lines.push({
          text: `${evt.attacker} attacks for ${evt.damage} damage.`,
          color: '#e0e0e0',
        });
      }

      if (evt.heal > 0) {
        lines.push({
          text: `  ${evt.attacker} recovers ${evt.heal} HP.`,
          color: '#44ff44',
        });
      }
    }

    // Outcome line
    const outcomeColors = {
      win: '#44ff44',
      lose: '#ff4444',
      draw: '#ffdd44',
    };
    const outcomeLabels = {
      win: 'Victory!',
      lose: 'Defeat...',
      draw: 'Draw.',
    };
    lines.push({ text: '', color: '#000000' });
    lines.push({
      text: outcomeLabels[outcome],
      color: outcomeColors[outcome],
    });

    // Render lines with staggered timing
    const startY = 95;
    const lineH = 18;
    const maxVisible = Math.floor((380 - startY) / lineH);
    const scrollOffset = Math.max(0, lines.length - maxVisible);

    const visibleLines = lines.slice(scrollOffset);
    const delayPerLine = 350;

    visibleLines.forEach((line, i) => {
      const timer = this.scene.time.delayedCall(i * delayPerLine, () => {
        if (!this.visible) return;
        const y = startY + i * lineH;
        const t = this.scene.add
          .text(75, y, line.text, {
            ...BODY_STYLE,
            color: line.color,
          })
          .setDepth(CONTENT_DEPTH)
          .setAlpha(0);
        this.objects.push(t);

        // Fade in
        this.scene.tweens.add({
          targets: t,
          alpha: 1,
          duration: 150,
        });
      });
      this.objects.push(timer);
    });

    // After all lines shown, display "Continue" button
    const totalDelay = visibleLines.length * delayPerLine + 500;
    const continueTimer = this.scene.time.delayedCall(totalDelay, () => {
      if (!this.visible) return;
      this._addBtn(CX, 430, '[ Continue ]', '#ffdd44', () => this._showResult(outcome, tier));
    });
    this.objects.push(continueTimer);
  }

  // ────────────────────────────────────────
  // SCREEN: Result
  // ────────────────────────────────────────

  _showResult(outcome, tier) {
    this._clearScreen();
    this._addBg();
    this._addPanel();
    this._addTitle('Arena — Result');

    const unit = this._selectedUnit;
    const challenger = this._challenger.unit;
    const colosseumData = this._colosseumData;

    // Calculate XP
    const baseXP = calculateArenaXP(unit, challenger, outcome === 'win');
    const levelsGained = this._levelsGainedThisVisit[unit.name] || 0;

    const reward = calculateArenaReward(tier, outcome, baseXP, levelsGained, colosseumData);

    // Apply gold
    if (reward.goldDelta > 0) {
      this.runManager.awardGold(reward.goldDelta);
    } else if (reward.goldDelta < 0) {
      const spent = this.runManager.spendGold(Math.abs(reward.goldDelta));
      if (spent === false) {
        // Defensive log: this should not occur with tier affordability gating.
        console.warn('[ColosseumOverlay] Failed to deduct arena entry fee on loss.', {
          unit: unit?.name || null,
          tier: tier?.name || null,
          required: Math.abs(reward.goldDelta),
          gold: this.runManager.gold,
        });
      }
    }

    // Apply XP and track level-ups
    let levelUpInfo = null;
    if (reward.xpGained > 0) {
      const prevLevel = unit.level;
      const extendedLevelingEnabled =
        this.runManager?.getDifficultyModifier?.('extendedLevelingEnabled', false) || false;
      const xpResult = gainExperience(unit, reward.xpGained, { extendedLevelingEnabled });
      const extendedGain = xpResult.levelUps?.some((lu) => lu.isExtended);
      if (unit.level > prevLevel || extendedGain) {
        const actualLevelUps = xpResult.levelUps?.length || 0;
        this._levelsGainedThisVisit[unit.name] = levelsGained + actualLevelUps;
        const firstLvUp = xpResult.levelUps[0];
        const lastLvUp = xpResult.levelUps[xpResult.levelUps.length - 1];
        const fromStr = firstLvUp?.isExtended
          ? firstLvUp.extendedLevel - 1 === 0
            ? '20'
            : `20+${firstLvUp.extendedLevel - 1}`
          : String(prevLevel);
        const toStr = lastLvUp?.isExtended ? `20+${lastLvUp.extendedLevel}` : String(unit.level);
        levelUpInfo = {
          from: fromStr,
          to: toStr,
          ups: xpResult.levelUps,
        };
      }
    }

    // Display
    let y = 110;

    const outcomeColors = {
      win: '#44ff44',
      lose: '#ff4444',
      draw: '#ffdd44',
    };
    const outcomeLabels = {
      win: 'Victory!',
      lose: 'Defeat...',
      draw: 'Draw — fee refunded.',
    };

    const outcomeText = this.scene.add
      .text(CX, y, outcomeLabels[outcome], {
        ...HEADER_STYLE,
        fontSize: '16px',
        color: outcomeColors[outcome],
      })
      .setOrigin(0.5)
      .setDepth(CONTENT_DEPTH);
    this.objects.push(outcomeText);
    y += 35;

    // Fighter status
    const status = this.scene.add
      .text(CX, y, `${unit.name}: HP ${unit.currentHP}/${unit.stats.HP}`, BODY_STYLE)
      .setOrigin(0.5)
      .setDepth(CONTENT_DEPTH);
    this.objects.push(status);
    y += 30;

    // Gold change
    const goldSign = reward.goldDelta >= 0 ? '+' : '';
    const goldColor = reward.goldDelta >= 0 ? '#ffdd44' : '#ff6666';
    const goldText = this.scene.add
      .text(CX, y, `Gold: ${goldSign}${reward.goldDelta}G`, {
        ...BODY_STYLE,
        color: goldColor,
      })
      .setOrigin(0.5)
      .setDepth(CONTENT_DEPTH);
    this.objects.push(goldText);
    y += 22;

    // XP gained
    if (reward.xpGained > 0) {
      const xpText = this.scene.add
        .text(CX, y, `XP: +${reward.xpGained}`, {
          ...BODY_STYLE,
          color: '#66ddff',
        })
        .setOrigin(0.5)
        .setDepth(CONTENT_DEPTH);
      this.objects.push(xpText);
      y += 22;
    }

    // Level up
    if (levelUpInfo) {
      const lvText = this.scene.add
        .text(CX, y, `Level Up! ${levelUpInfo.from} → ${levelUpInfo.to}`, {
          ...HEADER_STYLE,
          color: '#44ff44',
        })
        .setOrigin(0.5)
        .setDepth(CONTENT_DEPTH);
      this.objects.push(lvText);
      y += 22;

      // Show stat gains from level-ups
      if (levelUpInfo.ups?.length > 0) {
        for (const lu of levelUpInfo.ups) {
          if (!lu.gains) continue;
          const gainStrs = Object.entries(lu.gains)
            .filter(([, v]) => v > 0)
            .map(([stat, v]) => `${stat}+${v}`);
          if (gainStrs.length > 0) {
            const gainText = this.scene.add
              .text(CX, y, gainStrs.join('  '), {
                ...SMALL_STYLE,
                color: '#88ff88',
              })
              .setOrigin(0.5)
              .setDepth(CONTENT_DEPTH);
            this.objects.push(gainText);
            y += 18;
          }
        }
      }
    }

    // Diminishing returns warning
    const drAfter = colosseumData?.arena?.diminishingReturnsAfterLevels ?? 2;
    const totalLevels = this._levelsGainedThisVisit[unit.name] || 0;
    if (totalLevels >= drAfter) {
      const drText = this.scene.add
        .text(CX, y + 10, 'XP diminishing returns active.', {
          ...SMALL_STYLE,
          color: '#ff8888',
        })
        .setOrigin(0.5)
        .setDepth(CONTENT_DEPTH);
      this.objects.push(drText);
    }

    // Buttons
    const fights = this._fightsPerUnit[unit.name] || 0;
    const canFightAgain = canFight(unit, fights, this._maxFights) && this._canAffordTier(tier);

    if (canFightAgain) {
      this._addBtn(CX - 90, 390, '[ Fight Again ]', '#44ff44', () =>
        this._generateAndShowForecast(),
      );
    }

    this._addBtn(canFightAgain ? CX + 90 : CX, 390, '[ Back to Menu ]', '#aaaaaa', () =>
      this._showMenu(),
    );

    // Updated gold display
    this._addGold();
  }

  // ────────────────────────────────────────
  // SCREEN: Mercenary Browse
  // ────────────────────────────────────────

  _showMercBrowse() {
    this._clearScreen();
    this._addBg();
    this._addPanel();
    this._addTitle('Mercenary Board');
    this._addGold();

    // Generate candidates once per visit
    if (!this._mercCandidates) {
      this._mercGenerationFailed = false;
      try {
        this._mercCandidates = generateMercenaryCandidates(
          this._actId,
          this._getLordLevel(),
          this.gameData.recruits,
          this.gameData.classes,
          this.gameData.weapons,
          this.gameData.skills,
          this._getDifficultyId(),
          this._colosseumData,
          Math.random,
        );
      } catch (err) {
        console.error('[ColosseumOverlay] Failed to generate mercenary candidates:', err);
        this._mercGenerationFailed = true;
        this._mercCandidates = [];
      }

      // Filter out malformed candidates before rendering.
      const rawCandidates = this._mercCandidates;
      if (!Array.isArray(rawCandidates)) {
        console.error('[ColosseumOverlay] Invalid mercenary candidate payload (non-array).');
        this._mercGenerationFailed = true;
        this._mercCandidates = [];
      } else {
        this._mercCandidates = rawCandidates.filter(
          (c) => c?.unit?.name && c?.unit?.stats && typeof c?.hireCost === 'number',
        );
        if (rawCandidates.length > 0 && this._mercCandidates.length === 0) {
          console.error('[ColosseumOverlay] All mercenary candidates were malformed.');
          this._mercGenerationFailed = true;
        }
      }
    }

    const candidates = this._mercCandidates;
    const rosterCount = (this.runManager.roster || []).length;
    const rosterCap = this._getRosterCap();
    const rosterFull = rosterCount >= rosterCap;

    if (candidates.length === 0) {
      const emptyMsg = this._mercGenerationFailed
        ? 'Mercenary board unavailable. Please try again later.'
        : 'No mercenaries available.';
      const t = this.scene.add
        .text(CX, 200, emptyMsg, BODY_STYLE)
        .setOrigin(0.5)
        .setDepth(CONTENT_DEPTH);
      this.objects.push(t);
    } else {
      let y = 105;
      const cardH = 95;

      for (let i = 0; i < candidates.length; i++) {
        const { unit, hireCost } = candidates[i];
        const hired = unit._hired;
        const canAfford = this.runManager.gold >= hireCost;
        const canHire = !hired && !this._mercHired && canAfford && !rosterFull;

        // Card background
        const cardBg = this.scene.add
          .rectangle(CX, y + cardH / 2 - 5, PANEL_W - 40, cardH, 0x1a1a1a)
          .setDepth(CONTENT_DEPTH)
          .setStrokeStyle(1, hired ? 0x444444 : 0x666666);
        this.objects.push(cardBg);

        // Name + class + level
        const nameText = this.scene.add
          .text(75, y, `${unit.name}  —  ${unit.className} Lv ${getDisplayLevel(unit)}`, {
            ...BODY_STYLE,
            color: hired ? '#666666' : '#e0e0e0',
          })
          .setDepth(CONTENT_DEPTH);
        this.objects.push(nameText);

        // Key stats
        const stats = unit.stats;
        const statLine = `HP:${stats.HP} STR:${stats.STR} MAG:${stats.MAG} SPD:${stats.SPD} DEF:${stats.DEF} RES:${stats.RES}`;
        const statText = this.scene.add
          .text(75, y + 18, statLine, {
            ...SMALL_STYLE,
            color: hired ? '#555555' : '#aaaaaa',
          })
          .setDepth(CONTENT_DEPTH);
        this.objects.push(statText);

        // Weapon + skill
        const weaponName = unit.weapon?.name || 'None';
        const skillNames = unit.skills?.length > 0 ? unit.skills.join(', ') : 'None';
        const gearLine = `Weapon: ${weaponName}  |  Skills: ${skillNames}`;
        const gearText = this.scene.add
          .text(75, y + 34, gearLine, {
            ...SMALL_STYLE,
            color: hired ? '#555555' : '#aaaaaa',
          })
          .setDepth(CONTENT_DEPTH);
        this.objects.push(gearText);

        // Price + hire button
        if (hired) {
          const hiredLabel = this.scene.add
            .text(490, y + 15, 'HIRED', {
              ...HEADER_STYLE,
              color: '#44ff44',
            })
            .setOrigin(0.5)
            .setDepth(CONTENT_DEPTH);
          this.objects.push(hiredLabel);
        } else {
          const priceColor = canAfford ? '#ffdd44' : '#ff4444';
          const priceText = this.scene.add
            .text(490, y + 5, `${hireCost}G`, {
              ...BODY_STYLE,
              color: priceColor,
            })
            .setOrigin(0.5)
            .setDepth(CONTENT_DEPTH);
          this.objects.push(priceText);

          if (canHire) {
            this._addBtn(490, y + 35, '[ Hire ]', '#44ff44', () => this._showMercConfirm(i));
          } else {
            let reason = '';
            if (this._mercHired) reason = 'Max 1 hire';
            else if (rosterFull) reason = 'Roster full';
            else if (!canAfford) reason = 'Not enough gold';

            const reasonText = this.scene.add
              .text(490, y + 35, reason, {
                ...SMALL_STYLE,
                color: '#ff6666',
              })
              .setOrigin(0.5)
              .setDepth(CONTENT_DEPTH);
            this.objects.push(reasonText);
          }
        }

        y += cardH + 10;
      }
    }

    this._addBtn(CX, 430, '[ Back ]', '#aaaaaa', () => this._showMenu());
  }

  // ────────────────────────────────────────
  // SCREEN: Mercenary Confirm
  // ────────────────────────────────────────

  _showMercConfirm(candidateIdx) {
    this._clearScreen();
    this._addBg();
    this._addPanel();
    this._addTitle('Hire Mercenary?');
    this._addGold();

    const { unit, hireCost } = this._mercCandidates[candidateIdx];

    let y = 120;

    // Unit details
    const nameText = this.scene.add
      .text(CX, y, `${unit.name}  —  ${unit.className} Lv ${getDisplayLevel(unit)}`, BODY_STYLE)
      .setOrigin(0.5)
      .setDepth(CONTENT_DEPTH);
    this.objects.push(nameText);
    y += 25;

    const stats = unit.stats;
    const statLine = `HP:${stats.HP}  STR:${stats.STR}  MAG:${stats.MAG}  SKL:${stats.SKL}  SPD:${stats.SPD}  DEF:${stats.DEF}  RES:${stats.RES}`;
    const statText = this.scene.add
      .text(CX, y, statLine, SMALL_STYLE)
      .setOrigin(0.5)
      .setDepth(CONTENT_DEPTH);
    this.objects.push(statText);
    y += 20;

    const weaponName = unit.weapon?.name || 'None';
    const skillNames = unit.skills?.length > 0 ? unit.skills.join(', ') : 'None';
    const gearText = this.scene.add
      .text(CX, y, `Weapon: ${weaponName}  |  Skills: ${skillNames}`, SMALL_STYLE)
      .setOrigin(0.5)
      .setDepth(CONTENT_DEPTH);
    this.objects.push(gearText);
    y += 40;

    // Cost
    const costText = this.scene.add
      .text(CX, y, `Hire cost: ${hireCost}G`, {
        ...BODY_STYLE,
        color: '#ffdd44',
      })
      .setOrigin(0.5)
      .setDepth(CONTENT_DEPTH);
    this.objects.push(costText);
    y += 25;

    const afterGold = this.scene.add
      .text(CX, y, `Gold after: ${this.runManager.gold - hireCost}G`, SMALL_STYLE)
      .setOrigin(0.5)
      .setDepth(CONTENT_DEPTH);
    this.objects.push(afterGold);

    // Buttons
    this._addBtn(CX - 80, 350, '[ Confirm ]', '#44ff44', () => {
      this._hireMercenary(candidateIdx);
    });
    this._addBtn(CX + 80, 350, '[ Cancel ]', '#aaaaaa', () => this._showMercBrowse());
  }

  // ────────────────────────────────────────
  // Mercenary hire logic
  // ────────────────────────────────────────

  _hireMercenary(candidateIdx) {
    const candidate = this._mercCandidates?.[candidateIdx];
    if (!candidate) {
      this._showMercBrowse();
      return false;
    }
    const { unit, hireCost } = candidate;
    const rosterCount = (this.runManager.roster || []).length;
    const rosterFull = rosterCount >= this._getRosterCap();

    if (unit?._hired || this._mercHired || rosterFull) {
      this._showMercBrowse();
      return false;
    }

    const spent = this.runManager.spendGold(hireCost);
    if (spent === false) {
      this._showMercBrowse();
      return false;
    }

    // Add to roster
    unit.faction = 'player';
    this.runManager.roster.push(unit);

    // Mark as hired
    unit._hired = true;
    this._mercHired = true;

    // Show updated browse screen
    this._showMercBrowse();
    return true;
  }

  // ────────────────────────────────────────
  // Helpers
  // ────────────────────────────────────────

  _canAffordTier(tier) {
    return Boolean(tier) && this.runManager.gold >= (tier.entryFee || 0);
  }

  _getDifficultyId() {
    return this.runManager?.difficultyId ?? this.runManager?.difficultyMode ?? 'normal';
  }

  _getRosterCap() {
    if (typeof this.runManager?.getRosterCap === 'function') {
      return this.runManager.getRosterCap();
    }
    return ROSTER_CAP + (this.runManager?.metaEffects?.rosterCapBonus || 0);
  }

  _getLordLevel() {
    const roster = this.runManager.roster || [];
    const { recruitTargetLevel } = resolveRecruitScalingTargets(roster);
    const hasEdric = roster.some(
      (u) => typeof u?.name === 'string' && u.name.trim().toLowerCase() === 'edric',
    );
    if (hasEdric) return recruitTargetLevel;

    // Fallback for custom rosters/campaigns that do not include Edric by name.
    const fallbackLords = roster.filter((u) => u?.isLord);
    if (fallbackLords.length === 0) return 1;

    // Use the highest effective lord level so scaling is stable regardless of roster order.
    let highestEffectiveLevel = 1;
    for (const lord of fallbackLords) {
      const rawLevel = Math.max(1, Math.trunc(Number(lord.level) || 1));
      const effectiveLevel =
        lord.tier === 'promoted' ? RECRUIT_PROMOTION_BASE_LEVEL + rawLevel : rawLevel;
      if (effectiveLevel > highestEffectiveLevel) highestEffectiveLevel = effectiveLevel;
    }
    return highestEffectiveLevel;
  }
}

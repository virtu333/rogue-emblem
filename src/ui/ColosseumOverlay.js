import { ArenaMenu } from './ArenaMenu.js';
import { growthCeremonies } from './GrowthCeremonyController.js';
import { levelUpDisplayResults } from './progressionDisplay.js';
import { saveServiceRun } from './serviceSave.js';
import { relinkWeapon } from '../engine/RunManager.js';
import { UI_PALETTE } from '../utils/uiStyles.js';
// ColosseumOverlay.js — Overlay UI for the Colosseum node (Arena + Mercenary Board)
// ArenaMenu owns rendering/input; this controller owns gameplay and visit persistence.

import {
  generateChallenger,
  calculateArenaReward,
  calculateArenaXP,
  canFight,
  getMaxFights,
  getArenaDistance,
  generateMercenaryCandidates,
  grantMercenaryClassSkills,
} from '../engine/ColosseumEngine.js';
import { resolveCombat, getCombatForecast } from '../engine/Combat.js';
import { getSkillCombatMods, rollStrikeSkills, rollDefenseSkills } from '../engine/SkillSystem.js';
import {
  gainExperience,
  grantSecondaryWeapons,
  checkLevelUpSkills,
} from '../engine/UnitManager.js';
import { ROSTER_CAP, RECRUIT_PROMOTION_BASE_LEVEL } from '../utils/constants.js';
import { resolveRecruitScalingTargets } from '../engine/RecruitScaling.js';
import { findCommander } from '../engine/Commander.js';

export class ColosseumOverlay {
  constructor(scene, runManager, gameData) {
    this.scene = scene;
    this.runManager = runManager;
    this.gameData = gameData;
    this.visible = false;

    // Arena state
    this._fightsPerUnit = {}; // unitName → count
    this._levelsGainedThisVisit = {}; // unitName → count
    this._selectedUnit = null;
    this._selectedTier = null;
    this._challenger = null;

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
    if (node?.colosseumState) {
      const state = structuredClone(node.colosseumState);
      this._fightsPerUnit = state.fightsPerUnit || {};
      this._levelsGainedThisVisit = state.levelsGained || {};
      this._mercCandidates = state.mercCandidates || null;
      this._mercCandidates?.forEach((candidate) => {
        relinkWeapon(candidate.unit);
        grantMercenaryClassSkills(candidate.unit, this.gameData.classes, this.gameData.skills);
      });
      this._mercHired = state.mercHired === true;
    }
    this.visible = true;

    const colosseumData = this.gameData.colosseum;
    this._colosseumData = colosseumData;
    this._maxFights = getMaxFights(this._getDifficultyId(), colosseumData);

    this._shutdown = () => this.hide();
    this.scene.events?.once?.('shutdown', this._shutdown);
    this._showMenu();
  }

  /** Close the overlay visually (ESC path). Does NOT invoke the leave callback. */
  hide() {
    if (!this.visible) return;
    this.visible = false;
    this._clearScreen();
    this.scene.events?.off?.('shutdown', this._shutdown);
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
    this.nativeMenu?.destroy();
    this.nativeMenu = null;
  }

  _showMenu() {
    this._clearScreen();
    this.nativeMenu = ArenaMenu.menu(this);
  }

  _showUnitSelect() {
    this._clearScreen();
    this.nativeMenu = ArenaMenu.units(this);
  }

  _showTierSelect(message = null) {
    this._clearScreen();
    this.nativeMenu = ArenaMenu.tiers(this, message);
  }

  _generateAndShowForecast() {
    this._settledResult = null;
    this._fightResolved = false;
    const unit = this._selectedUnit;
    const tier = this._selectedTier;
    const colosseumData = this._colosseumData;
    const actId = this._actId;
    const difficultyId = this._getDifficultyId();

    // generateChallenger expects the entrant's EFFECTIVE level (promotion at
    // RECRUIT_PROMOTION_BASE_LEVEL); a promoted entrant's raw level undersold
    // it by ~10 levels and produced trivially weak challengers.
    const rawEntrantLevel = Math.max(1, Math.trunc(Number(unit.level) || 1));
    const entrantEffectiveLevel =
      unit.tier === 'promoted' ? RECRUIT_PROMOTION_BASE_LEVEL + rawEntrantLevel : rawEntrantLevel;
    this._challenger = generateChallenger(
      entrantEffectiveLevel,
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

    const unit = this._selectedUnit;
    const challenger = this._challenger.unit;

    // Build forecast
    const distance = getArenaDistance(unit.weapon, challenger.weapon);
    const plainTerrain = { avoidBonus: 0, defBonus: 0 };

    // Minimal skill context for forecast (arena = isolated 1v1, no allies)
    const skillsData = this.gameData.skills || [];
    const masteryCtx = {
      classesData: this.gameData.classes,
      traitsData: this.gameData.traits || null,
    };
    const atkMods = getSkillCombatMods(
      unit,
      challenger,
      [unit],
      [challenger],
      skillsData,
      plainTerrain,
      true,
      null,
      masteryCtx,
    );
    const defMods = getSkillCombatMods(
      challenger,
      unit,
      [challenger],
      [unit],
      skillsData,
      plainTerrain,
      false,
      null,
      masteryCtx,
    );

    const forecast = getCombatForecast(
      unit,
      unit.weapon,
      challenger,
      challenger.weapon,
      distance,
      plainTerrain,
      plainTerrain,
      { atkMods, defMods, imbuesData: this.gameData.imbues || null },
    );

    this.nativeMenu = ArenaMenu.forecast(this, forecast);
  }

  _executeFight() {
    if (this._fightResolved) return;
    const unit = this._selectedUnit;
    const challenger = this._challenger.unit;
    const tier = this._selectedTier;

    if (!this._canAffordTier(tier)) {
      this._showTierSelect(`Not enough gold to enter (${tier.entryFee}G required).`);
      return;
    }
    if (!canFight(unit, this._fightsPerUnit[unit.name] || 0, this._maxFights)) return;
    this._fightResolved = true;

    const distance = getArenaDistance(unit.weapon, challenger.weapon);
    const plainTerrain = { avoidBonus: 0, defBonus: 0 };

    // Build full skill context for resolution
    const skillsData = this.gameData.skills || [];
    const masteryCtx = {
      classesData: this.gameData.classes,
      traitsData: this.gameData.traits || null,
    };
    const atkMods = getSkillCombatMods(
      unit,
      challenger,
      [unit],
      [challenger],
      skillsData,
      plainTerrain,
      true,
      null,
      masteryCtx,
    );
    const defMods = getSkillCombatMods(
      challenger,
      unit,
      [challenger],
      [unit],
      skillsData,
      plainTerrain,
      false,
      null,
      masteryCtx,
    );

    const skillCtx = {
      atkMods,
      defMods,
      rollStrikeSkills,
      rollDefenseSkills,
      skillsData,
      imbuesData: this.gameData.imbues || null,
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
    this._settleFight(outcome, tier);

    // Show combat log with auto-advance
    this._showCombatLog(result.events, outcome, tier);
  }

  _showCombatLog(events, outcome, tier) {
    this._clearScreen();

    // Format events into text lines
    const lines = [];
    for (const evt of events) {
      if (evt.type !== 'strike') continue;

      // Skill activations before the strike description
      if (evt.skillActivations?.length > 0) {
        for (const sa of evt.skillActivations) {
          lines.push({
            text: `  ★ ${sa.name || sa.id} activates!`,
            color: UI_PALETTE.rarityEpic,
          });
        }
      }

      if (evt.miss) {
        lines.push({
          text: `${evt.attacker} attacks... Miss!`,
          color: UI_PALETTE.muted,
        });
      } else if (evt.isCrit) {
        lines.push({
          text: `${evt.attacker} lands a critical hit! ${evt.damage} damage!`,
          color: UI_PALETTE.bad,
        });
      } else {
        lines.push({
          text: `${evt.attacker} attacks for ${evt.damage} damage.`,
          color: UI_PALETTE.text,
        });
      }

      if (evt.heal > 0) {
        lines.push({
          text: `  ${evt.attacker} recovers ${evt.heal} HP.`,
          color: UI_PALETTE.good,
        });
      }
    }

    // Outcome line
    const outcomeColors = {
      win: UI_PALETTE.good,
      lose: UI_PALETTE.bad,
      draw: UI_PALETTE.accent,
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

    this.nativeMenu = ArenaMenu.log(this, lines, outcome, tier);
  }

  _settleFight(outcome, tier) {
    if (this._settledResult) return this._settledResult;
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
          learnedSkills: checkLevelUpSkills(unit, this.gameData.classes),
        };
      }
    }

    this._settledResult = { reward, levelUpInfo };
    this._persistVisit();
    return this._settledResult;
  }

  _showResult(outcome, tier) {
    const settled = this._settleFight(outcome, tier);
    const { reward, levelUpInfo } = settled;
    this._clearScreen();
    const show = () => {
      if (!this.visible || !this.scene) return;
      this.nativeMenu = ArenaMenu.result(this, outcome, tier, reward, levelUpInfo);
    };
    // Arena levels are growth too: the level-up card plays once per fight,
    // after the fight is settled and saved (_settleFight), then the result.
    const growth = levelUpInfo?.ups?.length && !settled.presented ? growthCeremonies(this.scene) : null; // prettier-ignore
    if (!growth) {
      show();
      return;
    }
    settled.presented = true;
    const unit = this._selectedUnit;
    const learned = (levelUpInfo.learnedSkills || []).map(
      (id) => this.gameData.skills?.find((sk) => sk.id === id)?.name || id,
    );
    const results = levelUpDisplayResults(unit.stats, levelUpInfo.ups);
    void (async () => {
      for (let i = 0; i < results.length; i++) {
        if (!this.visible || growth.destroyed) break;
        await growth.showLevelUp({
          unit,
          result: results[i],
          learnedNames: i === results.length - 1 ? learned : [],
          frame: 'screen',
          cue: true,
        });
      }
      show();
    })();
  }

  _showMercBrowse() {
    this._clearScreen();

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
          this.gameData.traits || null,
          this.runManager.roster.map((unit) => unit.name),
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

      // Each mercenary shows (and keeps, once hired) a face the army lacks.
      this.runManager?.assignPortraitVariants?.(this._mercCandidates.map((c) => c.unit));

      // Apply Master of Arms to generated merc candidates
      if (this.runManager?.metaEffects?.masterOfArms && this._mercCandidates.length > 0) {
        for (const entry of this._mercCandidates) {
          if (entry?.unit) {
            grantSecondaryWeapons(
              entry.unit,
              this.gameData.weapons,
              entry.unit.weapon?.tier || 'Iron',
            );
          }
        }
      }
      this._persistVisit();
    }

    this.nativeMenu = ArenaMenu.mercs(this);
  }

  _showMercConfirm(candidateIdx) {
    this._clearScreen();

    this.nativeMenu = ArenaMenu.hire(this, candidateIdx);
  }

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
    this.runManager.grantRecruitBlessingConsumables?.(unit);
    this.runManager.roster.push(unit);

    // Mark as hired
    unit._hired = true;
    this._mercHired = true;
    this._persistVisit();

    // Joins your army (after the hire is saved), then the updated board.
    const growth = growthCeremonies(this.scene);
    if (growth) {
      this._clearScreen();
      void growth
        .showRecruit({ unit, kind: 'recruit', frame: 'screen' })
        .then(() => this.visible && this.scene && this._showMercBrowse());
      return true;
    }
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

  _persistVisit() {
    if (this._node)
      this._node.colosseumState = structuredClone({
        fightsPerUnit: this._fightsPerUnit,
        levelsGained: this._levelsGainedThisVisit,
        mercCandidates: this._mercCandidates,
        mercHired: this._mercHired,
      });
    this._saveWarning = saveServiceRun(this.scene);
  }

  _getLordLevel() {
    const roster = this.runManager.roster || [];
    const { recruitTargetLevel } = resolveRecruitScalingTargets(roster);
    const hasCommander = Boolean(findCommander(roster));
    if (hasCommander) return recruitTargetLevel;

    // Fallback for custom rosters/campaigns without a flagged commander or Edric.
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

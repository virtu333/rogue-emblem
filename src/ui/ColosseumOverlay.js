import { ArenaMenu } from './ArenaMenu.js';
import { MobileRosterSheet } from './MobileRosterSheet.js';
import { growthCeremonies } from './GrowthCeremonyController.js';
import { fillXpGauge } from './XpGaugeController.js';
import { xpGaugeRecord, xpGaugeTiming } from './xpGaugeModel.js';
import { xpSnapshot } from '../engine/XpProgress.js';
import { DOM_UI_DEPTHS } from '../utils/uiDepths.js';
import { levelUpDisplayResults } from './progressionDisplay.js';
import { saveServiceRun } from './serviceSave.js';
import { relinkWeapon } from '../engine/RunManager.js';
import { UI_PALETTE } from '../utils/uiStyles.js';
import { EarnedBlessingPick } from './EarnedBlessingPick.js';
import {
  COLOSSEUM_LEDGER_KEY,
  colosseumOfferDue,
  earnedPickOwed,
  prepareColosseumOffer,
} from '../engine/EarnedBlessings.js';
// ColosseumOverlay.js — Overlay UI for the Colosseum node (Arena + Mercenary Board)
// ArenaMenu owns rendering/input; this controller owns gameplay and visit persistence.
// The Colosseum's earned blessing (docs/specs/blessings-v3.md §6.6, D-8): the first win in a gold
// or platinum bout rolls its offer with the bout's own save (_settleFight); the colosseum's menu
// opens it (_showMenu: EarnedBlessingPick, saved by the service save), and the route map opens it
// if it is still owed when the party leaves.

import {
  generateChallenger,
  calculateArenaReward,
  calculateArenaXP,
  arenaEntryBlock,
  arenaEntryFee,
  arenaVisitBouts,
  arenaVisitBoutsLeft,
  arenaVisitCap,
  getMaxFights,
  getMaxFightsPerVisit,
  getArenaDistance,
  getArenaWeapon,
  generateMercenaryCandidates,
  grantMercenaryClassSkills,
} from '../engine/ColosseumEngine.js';
import { getCombatForecast } from '../engine/Combat.js';
import { getSkillCombatMods } from '../engine/SkillSystem.js';
import {
  arenaMaxRounds,
  arenaRoundOutcome,
  estimateArenaOdds,
  resolveArenaRound,
} from '../engine/ArenaBout.js';
import {
  gainExperience,
  grantMasterOfArmsWeapons,
  checkLevelUpSkills,
  equipWeapon,
  settleAccessoryHpOwed,
} from '../engine/UnitManager.js';
import { RECRUIT_PROMOTION_BASE_LEVEL } from '../utils/constants.js';
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
    // The rung's cap; the Mercenary Ledger's extra bout is read live (_maxVisitBouts).
    this._rungVisitBouts = getMaxFightsPerVisit(this._getDifficultyId(), colosseumData);

    this._shutdown = () => this.hide();
    this.scene.events?.once?.('shutdown', this._shutdown);
    this._showMenu();
  }

  /**
   * Bouts this visit allows: the rung's cap plus the Mercenary Ledger's (ColosseumEngine
   * arenaVisitCap), read every time, so a Ledger taken mid-visit opens its bout at once.
   */
  get _maxVisitBouts() {
    return arenaVisitCap(this._rungVisitBouts, this.runManager);
  }

  /** Close the overlay visually (ESC path). Does NOT invoke the leave callback. */
  hide() {
    if (!this.visible) return;
    this.visible = false;
    // An open earned pick closes with it, still owed (the route map offers it again).
    this._earnedPick?.destroy();
    this._earnedPick = null;
    this._sheet?.destroy();
    this._sheet = null;
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
    // A result whose EXP bar is still filling ends it (its level cards still play).
    const fill = this._arenaFill;
    this._arenaFill = null;
    fill?.finish();
    this.nativeMenu?.destroy();
    this.nativeMenu = null;
  }

  /** The route map, over the colosseum (the service map the shop and church use). */
  _viewMap(back) {
    if (!this.visible || this._viewingMap || typeof this.scene._showServiceMap !== 'function')
      return;
    this._viewingMap = true;
    this._clearScreen();
    this.scene._showServiceMap(() => {
      this._viewingMap = false;
      if (this.visible) back();
    });
  }

  /**
   * A unit sheet over the arena: the roster (run given: equip, trade, and the edits
   * save on close) or a mercenary's read-only card (run null). `back` redraws the
   * screen it came from, so HP, gear and level changes show.
   */
  _openSheet({ run, units = this.runManager.roster, unit = null }, back) {
    if (!this.visible || this._sheet) return;
    if (this.nativeMenu) this.nativeMenu.surface.root.inert = true;
    this._sheet = new MobileRosterSheet({
      scene: this.scene,
      run,
      units,
      index: Math.max(0, units.indexOf(unit)),
      gameData: this.gameData,
      onClose: () => {
        this._sheet?.destroy();
        this._sheet = null;
        if (run) this._persistVisit();
        if (this.visible) back();
      },
    });
  }

  _showMenu() {
    this._clearScreen();
    if (this._openOwedEarnedPick()) return;
    this.nativeMenu = ArenaMenu.menu(this);
  }

  /**
   * The Colosseum's earned pick, still owed (rolled by a gold or platinum win): opened in place of
   * the menu, which comes back once it is taken or left (saved first). False when none is owed or
   * it could not be shown (the menu then shows; the route map offers it after the visit).
   */
  _openOwedEarnedPick() {
    if (this._earnedPick) return true;
    const entry = earnedPickOwed(this.runManager, { keys: [COLOSSEUM_LEDGER_KEY] });
    if (!entry) return false;
    const pick = new EarnedBlessingPick(this.scene, {
      run: this.runManager,
      entry,
      save: () => {
        this._saveWarning = saveServiceRun(this.scene);
      },
      onDone: () => {
        if (this._earnedPick !== pick) return;
        this._earnedPick = null;
        if (this.visible) this._showMenu();
      },
    });
    this._earnedPick = pick;
    let opened = false;
    try {
      opened = pick.create();
    } catch (err) {
      console.warn('[ColosseumOverlay] earned pick failed to open:', err);
      pick.destroy();
    }
    if (!opened) this._earnedPick = null;
    return opened;
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
    this._bout = null;
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
      this.gameData.difficulty,
    );

    this._showForecast();
  }

  _showForecast() {
    this._clearScreen();

    const unit = this._selectedUnit;
    const challenger = this._challenger.unit;
    // The weapon the fight will use (Fight equips it); the forecast only plans it.
    const weapon = getArenaWeapon(unit);
    this._fighterWeapon = weapon;

    // Build forecast
    const distance = getArenaDistance(weapon, challenger.weapon);
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
      { ...masteryCtx, weapon },
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
      weapon,
      challenger,
      challenger.weapon,
      distance,
      plainTerrain,
      plainTerrain,
      { atkMods, defMods, imbuesData: this.gameData.imbues || null },
    );

    // The bout fought to the end, many times over on copies (its own seeded stream:
    // the run's dice never move, and the same matchup always shows the same odds).
    const odds = estimateArenaOdds(unit, challenger, this.gameData, {
      trials: 300,
      maxRounds: arenaMaxRounds(this._colosseumData),
    });
    this.nativeMenu = ArenaMenu.forecast(this, forecast, odds);
  }

  _executeFight() {
    if (this._fightResolved) return;
    const unit = this._selectedUnit;
    const tier = this._selectedTier;

    if (!this._canAffordTier(tier)) {
      this._showTierSelect(`Not enough gold to enter (${this._entryFee(tier)}G required).`);
      return;
    }
    if (this._entryBlock(unit)) return;
    // The entry fee is paid as the bout starts: a win returns it with the prize, a
    // draw returns it, a loss or a yield keeps it. Leaving mid-bout is a yield. The fee is
    // the run's (the Mercenary Ledger halves it), and the bout keeps what it paid.
    const fee = this._entryFee(tier);
    if (fee > 0 && this.runManager.spendGold(fee) === false) {
      this._showTierSelect(`Not enough gold to enter (${fee}G required).`);
      return;
    }
    // No battle start runs before an arena bout: settle a stale accessory debt here.
    settleAccessoryHpOwed(unit);
    this._fightResolved = true;
    // Fight with the planned weapon: equip it (a healer holding a staff draws its tome).
    const weapon = getArenaWeapon(unit);
    if (weapon !== unit.weapon) equipWeapon(unit, weapon);

    this._fightsPerUnit[unit.name] = (this._fightsPerUnit[unit.name] || 0) + 1;
    this._bout = { tier, round: 0, feePaid: fee, outcome: null };
    this._fightRound();
  }

  /** Fight the bout's next round; save it; show it (or the bout's end). */
  _fightRound() {
    const bout = this._bout;
    if (!bout || bout.outcome) return;
    bout.round += 1;
    const result = resolveArenaRound(this._selectedUnit, this._challenger.unit, this.gameData);
    const outcome = arenaRoundOutcome(result, bout.round, arenaMaxRounds(this._colosseumData));
    const unit = this._selectedUnit;
    const foe = this._challenger.unit;
    const lines = [
      { text: `Round ${bout.round}`, color: UI_PALETTE.accent },
      ...this._roundLines(result.events),
      {
        text: `${unit.name} HP ${unit.currentHP}/${unit.stats.HP} · ${foe.name} HP ${foe.currentHP}/${foe.stats.HP}`,
        color: UI_PALETTE.muted,
      },
    ];
    if (outcome) {
      bout.outcome = outcome;
      this._settleFight(outcome, bout.tier);
      this._showCombatLog(lines, outcome, bout.tier);
      return;
    }
    // Each round's HP is saved as it lands; a bout left here counts as a yield.
    this._persistVisit();
    this._clearScreen();
    this.nativeMenu = ArenaMenu.round(this, {
      round: bout.round,
      maxRounds: arenaMaxRounds(this._colosseumData),
      lines,
      fee: bout.feePaid,
    });
  }

  /** Give up the bout between rounds: the fee is gone, the fighter keeps its HP. */
  _yieldBout() {
    const bout = this._bout;
    if (!bout || bout.outcome) return;
    bout.outcome = 'yield';
    this._settleFight('yield', bout.tier);
    this._showResult('yield', bout.tier);
  }

  /** One round's strikes as log lines. */
  _roundLines(events) {
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

    return lines;
  }

  _showCombatLog(lines, outcome, tier) {
    this._clearScreen();
    lines = [...lines];
    // Outcome line
    const outcomeColors = {
      win: UI_PALETTE.good,
      lose: UI_PALETTE.bad,
      draw: UI_PALETTE.accent,
    };
    const outcomeLabels = {
      win: 'Victory!',
      lose: 'Defeat...',
      draw: 'Draw: the round limit was reached. Your fee is returned.',
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

    // The fee this bout paid (the Ledger's half fee, if held when it started) is what a loss
    // forfeits and a win or a draw hands back.
    const feePaid = this._bout?.feePaid || 0;
    const reward = calculateArenaReward(tier, outcome, baseXP, levelsGained, colosseumData, {
      entryFee: this._bout ? feePaid : undefined,
    });

    // Apply gold. The fee was paid as the bout started (_executeFight): the payout
    // is the net result plus that fee (a win: prize and fee; a draw: the fee back;
    // a loss or a yield: nothing). `reward.goldDelta` stays the bout's net result.
    const payout = reward.goldDelta + feePaid;
    if (payout > 0) this.runManager.awardGold(payout);

    // The Colosseum's earned blessing (D-8): the first gold or platinum win rolls its offer, saved
    // with this bout (_persistVisit below); the menu opens it.
    if (colosseumOfferDue(this.runManager, { tier: tier?.name, outcome }))
      prepareColosseumOffer(this.runManager, this._node?.id ?? null);

    // Apply XP and track level-ups
    let levelUpInfo = null;
    let xpRecord = null;
    if (reward.xpGained > 0) {
      const prevLevel = unit.level;
      const extendedLevelingEnabled =
        this.runManager?.getDifficultyModifier?.('extendedLevelingEnabled', false) || false;
      const before = xpSnapshot(unit, { extendedLevelingEnabled });
      const xpResult = gainExperience(unit, reward.xpGained, { extendedLevelingEnabled });
      // The result card's EXP bar (plain values; null when nothing counted: the cap).
      xpRecord = xpGaugeRecord(unit, {
        before,
        after: xpSnapshot(unit, { extendedLevelingEnabled }),
        levelUps: xpResult.levelUps,
      });
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

    this._settledResult = { reward, levelUpInfo, xpRecord };
    this._persistVisit();
    return this._settledResult;
  }

  _showResult(outcome, tier) {
    const settled = this._settleFight(outcome, tier);
    const { reward, levelUpInfo, xpRecord } = settled;
    this._clearScreen();
    // Arena levels are growth too: the level-up card plays once per fight, after the
    // fight is settled and saved (_settleFight). The result card's EXP bar fills once
    // (docs/specs/exp-bars.md §2.6) and hands off to the card, which opens over it.
    const growth = levelUpInfo?.ups?.length && !settled.presented ? growthCeremonies(this.scene) : null; // prettier-ignore
    if (growth) settled.presented = true;
    const fills = !settled.filled;
    settled.filled = true;
    this.nativeMenu = ArenaMenu.result(this, outcome, tier, reward, levelUpInfo, xpRecord);
    const view = this.nativeMenu?.xpView || null;
    const cards = growth ? () => this._playArenaLevelUps(growth, levelUpInfo) : null;
    if (!view || !xpRecord) {
      cards?.();
      return;
    }
    const settings = this.scene?.registry?.get?.('settings');
    const timing = fills
      ? xpGaugeTiming({
          speed: settings?.getBattleSpeed?.() || 'normal',
          reducedMotion: Boolean(settings?.getReduceMotion?.()),
        })
      : { animate: false };
    let fill = null;
    fill = fillXpGauge(view, xpRecord, timing, {
      // Runs at once for a static bar (fill not yet assigned), else when the fill ends.
      onFilled: () => {
        if (fill && this._arenaFill === fill) this._arenaFill = null;
        cards?.();
      },
    });
    if (!fill.isDone()) {
      this._arenaFill = fill;
      // A press on the bar skips to its end (and on to the card).
      view.gauge.addEventListener('pointerdown', () => fill.finish());
    }
  }

  /** The fight's level-up cards, over the result card that stays open under them. */
  async _playArenaLevelUps(growth, levelUpInfo) {
    const unit = this._selectedUnit;
    const learned = (levelUpInfo.learnedSkills || []).map(
      (id) => this.gameData.skills?.find((sk) => sk.id === id)?.name || id,
    );
    const results = levelUpDisplayResults(unit.stats, levelUpInfo.ups);
    for (let i = 0; i < results.length; i++) {
      if (!this.visible || growth.destroyed) break;
      await growth.showLevelUp({
        unit,
        result: results[i],
        learnedNames: i === results.length - 1 ? learned : [],
        frame: 'screen',
        cue: true,
        depth: DOM_UI_DEPTHS.RITE,
      });
    }
    this.nativeMenu?.focus?.();
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
          // Never a name already in the army, among the fallen, used this run, or
          // promised by a recruit node still ahead (the Loom shows who waits there).
          [
            ...(this.runManager.getTakenUnitNames?.() ||
              this.runManager.roster.map((unit) => unit.name)),
          ],
          // Mercenaries get the recruit meta upgrades (stat/growth, Skilled Recruits).
          this.runManager.getEffectiveMetaEffects?.() ?? this.runManager.metaEffects ?? null,
          // Their Mark roll: own stream keyed by run seed and name (UnitManager.createRecruitUnit).
          { runSeed: this.runManager.runSeed, marksData: this.gameData.marks || null },
          // Nomad's Pact: mercenaries join higher too (never below 0).
          { recruitLevelBonus: Math.max(0, this.runManager.getRecruitLevelBonus?.() || 0) },
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
            grantMasterOfArmsWeapons(entry.unit, this.gameData.weapons);
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

    if (unit?._hired || this._mercHired) {
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
    this.runManager.assignUnitUid?.(unit);
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

  /** The gold a bout of `tier` costs this run (ColosseumEngine.arenaEntryFee: the Ledger halves it). */
  _entryFee(tier) {
    return arenaEntryFee(tier, this.runManager);
  }

  _canAffordTier(tier) {
    return Boolean(tier) && this.runManager.gold >= this._entryFee(tier);
  }

  /** Bouts fought at this visit by everyone (the sum of the saved per-unit counts). */
  _visitBouts() {
    return arenaVisitBouts(this._fightsPerUnit);
  }

  /** Bouts left at this visit (Infinity when no cap is set). */
  _visitBoutsLeft() {
    return arenaVisitBoutsLeft(this._visitBouts(), this._maxVisitBouts);
  }

  /** Why `unit` can't enter the arena now ('' when it can): the visit's cap, then its own. */
  _entryBlock(unit) {
    return arenaEntryBlock(
      unit,
      this._fightsPerUnit[unit?.name] || 0,
      this._maxFights,
      this._visitBouts(),
      this._maxVisitBouts,
    );
  }

  _getDifficultyId() {
    return this.runManager?.difficultyId ?? this.runManager?.difficultyMode ?? 'normal';
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

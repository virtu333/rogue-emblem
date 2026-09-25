import { persistBattleDefeat } from './BattleFatalDecision.js';
import { captureBattleState } from './BattleCheckpointAdapter.js';
import { recordBattleTimeline } from './BattleTimelineRecorder.js';
import { readOnlyBattleReport } from '../engine/BattleTimelineFacts.js';
import { prepareBattleRewards } from '../engine/PendingBattleRewards.js';
import { PendingRewardController } from './PendingRewardController.js';
import { hasDOMHost } from '../utils/domUI.js';
import { TutorialController } from './TutorialController.js';
import {
  serializeUnit,
  getActTransitionKey,
  settleAndPersistEndRun,
} from '../engine/RunManager.js';
import { recordBattleParticipation, isMastered, getMasteryPerk } from '../engine/MasterySystem.js';
import { deedsFor } from './DeedController.js';
import { GrowthCeremonyController, growthCeremonies } from './GrowthCeremonyController.js';
import { buildNarrativeContext, selectDialogueEntries } from '../engine/NarrativeDirector.js';
import { getRating, calculateBonusGold } from '../engine/TurnBonusCalculator.js';
import { GOLD_BATTLE_BONUS, ELITE_MAX_PICKS } from '../utils/constants.js';
import { UI_DEPTHS } from '../utils/uiDepths.js';
import {
  transitionToScene,
  transitionToSceneWithBlockedRetry,
  restartScene,
  TRANSITION_REASONS,
  TRANSITION_RESULTS,
} from '../utils/SceneRouter.js';
import { retryBooleanAction } from '../utils/retry.js';
import { resetTransitionLocks } from '../utils/sceneLoader.js';
import { showImportantHint } from './HintDisplay.js';
import { MUSIC } from '../utils/musicConfig.js';
import { BossRecruitOverlay } from './BossRecruitOverlay.js';
import { pushRunSave } from '../cloud/CloudSync.js';
import { LordArrivalOverlay } from './LordArrivalOverlay.js';
import { LootScreenController } from './LootScreenController.js';
import { projectedRelief, projectedShadow } from './EclipseHudController.js';
import { presentQueuedLevelUps } from './BattlePresentationCheckpoint.js';
import { UI_PALETTE } from '../utils/uiStyles.js';

// Watchdog: a single RunComplete transition attempt that hangs past this is
// treated as failed so the retry loop (and ultimately the recovery UI) still runs.
const RUN_COMPLETE_TRANSITION_TIMEOUT_MS = 6000;

// Settle end-of-run rewards and persist the settled run before any scene
// transition, so a reload in between cannot pay the rewards twice.
function settleEndRunForScene(scene, result) {
  const cloud = scene.registry.get('cloud');
  const slot = scene.registry.get('activeSlot');
  return settleAndPersistEndRun(scene.runManager, scene.registry.get('meta'), result, {
    onSave: cloud ? (d) => pushRunSave(cloud.userId, slot, d) : null,
    slot,
  });
}

export class PostCombatController {
  constructor(scene) {
    this.scene = scene;
  }

  onVictory() {
    const scene = this.scene;
    if (scene.battleState === 'BATTLE_END') return;
    scene._reinforcementsPendingThisTurn = false;
    scene.battleState = 'BATTLE_END';
    const audio = scene.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.victory, scene, 0);
    scene._bossPresence?.hide?.();
    // The objective's word (ROUTED / SEIZED / ...) as a gold band; a tap moves
    // the flow on early. The canvas text remains the no-DOM fallback.
    let continueVictory = null;
    const band = hasDOMHost()
      ? scene._getCeremonies?.()?.showVictory(this.victoryBandContext(), {
          onSkip: () => continueVictory?.(),
        })
      : null;
    if (band) scene._victoryBanner = band;
    else {
      const victoryBanner = scene.add
        .text(scene.cameras.main.centerX, scene.cameras.main.centerY, 'VICTORY!', {
          fontFamily: 'monospace',
          fontSize: '28px',
          color: UI_PALETTE.accentText,
          backgroundColor: '#000000dd',
          padding: { x: 24, y: 12 },
        })
        .setOrigin(0.5)
        .setDepth(600);
      scene._victoryBanner = victoryBanner;
      scene._pinToScreen(victoryBanner);
    }
    // One continuation, fired by the timer or by skipping the band.
    const afterVictoryBand = (continuation) => {
      let started = false;
      let timer = null;
      const run = () => {
        if (started) return undefined;
        started = true;
        timer?.remove?.(false);
        band?.release();
        return continuation();
      };
      continueVictory = run;
      timer = scene.time.delayedCall(1500, run);
    };

    if (scene.battleParams.tutorialMode) {
      afterVictoryBand(async () => {
        if (!scene.scene?.isActive?.()) return;
        await showImportantHint(
          scene,
          "Victory! You've completed the tutorial.\nChoose Start first run on the title screen to begin your campaign.",
        );
        if (!scene.scene?.isActive?.()) return;
        (scene._tutorialController ||= new TutorialController(scene)).recordCompletion();
        scene._transitionTutorialToTitle();
      });
    } else if (scene.runManager) {
      scene.clearBattleScopedDeltas(scene.playerUnits);
      scene.clearBattleScopedDeltas(scene.escapedUnits || []);
      scene.clearBattleScopedDeltas(scene.nonDeployedUnits || []);
      // Escaped units (Escape objective) survived the battle off the field.
      // Record class-mastery participation on these live deployed survivors
      // BEFORE serializing — non-deployed and fallen units gain nothing.
      const classesData = scene.gameData?.classes || null;
      const traitsData = scene.gameData?.traits || null;
      const liveSurvivors = [...scene.playerUnits, ...(scene.escapedUnits || [])];
      // Deeds commit with the win, before the units are serialized and the
      // run is saved; their rite plays after the save (presentVictory).
      deedsFor(scene).commitVictory(liveSurvivors);
      const newlyMastered = [];
      for (const u of liveSurvivors) {
        const wasMastered = classesData ? isMastered(u, classesData, traitsData) : false;
        recordBattleParticipation(u);
        if (classesData && !wasMastered && isMastered(u, classesData, traitsData)) {
          const perk = getMasteryPerk(u, classesData, traitsData);
          newlyMastered.push({ name: u.name, className: u.className, perk });
        }
      }
      scene._newlyMasteredUnits = newlyMastered;
      const surviving = liveSurvivors.map((u) => serializeUnit(u));
      const rosterOrder = new Map((scene.runManager.roster || []).map((u, i) => [u.name, i]));
      const allUnits = [...surviving, ...(scene.nonDeployedUnits || [])].sort(
        (a, b) => (rosterOrder.get(a.name) ?? Infinity) - (rosterOrder.get(b.name) ?? Infinity),
      );
      const turnPressure = scene.getTurnPressureState();
      const completionGoldAward = Math.max(
        0,
        Math.floor(GOLD_BATTLE_BONUS * turnPressure.goldMultiplier),
      );
      scene._victoryPressureState = turnPressure;
      scene._completionGoldAward = completionGoldAward;
      const vaultGoldBeforeCompletion = Math.max(0, Math.trunc(scene.runManager.gold || 0));
      const hadCaravan = scene._caravanController?.hadCaravan() === true;
      const caravanSurvived = hadCaravan ? scene._caravanController.caravanSurvived() : false;
      if (hadCaravan && !caravanSurvived) {
        scene.showBriefBanner?.('Caravan destroyed.', UI_PALETTE.bad)?.catch?.(() => {});
      }
      const completionApplied = scene.runManager.completeBattle(
        allUnits,
        scene.nodeId,
        scene.goldEarned,
        {
          turnCount: scene.turnManager?.turnNumber,
          turnPar: scene.turnPar,
          completionGoldOverride: completionGoldAward,
          caravanSurvived,
        },
      );
      const vaultGoldAfterCompletion = Math.max(0, Math.trunc(scene.runManager.gold || 0));
      scene._battleCompletionAwardedGold = completionApplied
        ? Math.max(0, vaultGoldAfterCompletion - vaultGoldBeforeCompletion)
        : 0;
      // Preserve both the win and its unclaimed choices before presentation.
      if (completionApplied && !scene.runManager.isRunComplete() && hasDOMHost()) {
        prepareBattleRewards(scene.runManager, scene.gameData, this.rewardContext());
      }
      scene._persistBattleRunState?.();
      afterVictoryBand(async () => {
        if (!scene.scene?.isActive?.()) return;
        if (!completionApplied) {
          console.warn('[BattleScene] completeBattle no-op; skipping loot/recruit flow.');
          try {
            // Blocked-retry rides out transient cooldown/in-flight locks; the
            // lock-reset retry below is reserved for genuine failures.
            const result = await transitionToSceneWithBlockedRetry(
              scene,
              'NodeMap',
              {
                gameData: scene.gameData,
                runManager: scene.runManager,
              },
              { reason: TRANSITION_REASONS.BATTLE_COMPLETE },
            );
            if (result.status !== TRANSITION_RESULTS.STARTED) {
              console.warn('[BattleScene] completeBattle no-op transition blocked; retrying.');
              resetTransitionLocks(scene);
              const retryOk = await transitionToScene(
                scene,
                'NodeMap',
                {
                  gameData: scene.gameData,
                  runManager: scene.runManager,
                },
                { reason: TRANSITION_REASONS.BATTLE_COMPLETE },
              );
              if (!retryOk) {
                if (scene._victoryBanner) {
                  scene._victoryBanner.destroy();
                  scene._victoryBanner = null;
                }
                scene.showLootStatus?.(
                  'Transition failed. Refresh and continue run.',
                  UI_PALETTE.bad,
                );
              }
            }
          } catch (err) {
            console.warn('[BattleScene] completeBattle no-op transition failed:', err);
            if (scene._victoryBanner) {
              scene._victoryBanner.destroy();
              scene._victoryBanner = null;
            }
            scene.showLootStatus?.('Transition failed. Refresh and continue run.', UI_PALETTE.bad);
          }
          return;
        }
        try {
          // Enemy-phase counterattack levels are already in the completed-run
          // save. Present them here when victory skipped the next player turn.
          if (scene._pendingLevelUpPopups?.length) {
            await presentQueuedLevelUps(scene);
            if (!scene.scene?.isActive?.()) return;
          }
          if (scene.isBoss && scene._bossName && scene.runManager) {
            const bossName = scene._resolveBossDialogueName(scene._bossName);
            const dialogueKey = `boss_defeat_${bossName}`;
            const meta = scene.registry.get('meta');
            // Select BEFORE recording so a first kill doesn't see its own
            // flag; record BEFORE showing so skipping/refreshing mid-dialogue
            // can't lose the memory. The battle is already persisted as won
            // at this point, so the flag can never be a phantom.
            const entries = selectDialogueEntries(
              scene.gameData?.dialogue?.bossEncounters?.[bossName]?.defeat,
              buildNarrativeContext({ meta, runManager: scene.runManager, bossName }),
            );
            meta?.recordBossSlain?.(bossName);
            await scene._showStoryDialogueOnce(dialogueKey, entries);
          }
        } catch (err) {
          console.warn('[BattleScene] boss defeat dialogue failed:', err);
        }

        // Deeds earned this battle: committed and saved above; the rite only shows them.
        if (scene._newDeeds?.length) await deedsFor(scene).presentVictory();
        if (!scene.scene?.isActive?.()) return;
        if (scene.runManager.isRunComplete()) {
          // Final boss: award turn-bonus gold silently, skip loot screen
          scene._awardTurnBonusGold();
          scene.transitionAfterBattle();
        } else if (scene.isBoss) {
          scene.showBossRecruitScreen();
        } else {
          // Elite victory flavor
          if (scene.isElite) {
            try {
              const act = scene.battleParams?.act || 'act1';
              const elitePool =
                scene.gameData?.dialogue?.eliteVictory?.[act] ||
                scene.gameData?.dialogue?.eliteVictory?.act3;
              if (Array.isArray(elitePool) && elitePool.length > 0) {
                const line = elitePool[Math.floor(Math.random() * elitePool.length)];
                await scene.dialogueOverlay?.show(null, line, null);
              }
            } catch (_) {}
            if (!scene.scene?.isActive?.()) return;
          }
          if (scene.runManager.shouldTriggerThirdLord()) {
            scene._showThirdLordArrival();
          } else {
            scene.showLootScreen();
          }
        }
      });
    } else {
      // Standalone mode -- restart battle after delay
      scene.time.delayedCall(2000, () => {
        restartScene(scene, undefined, { reason: TRANSITION_REASONS.RETRY });
      });
    }
  }

  _awardTurnBonusGold() {
    const scene = this.scene;
    if (scene.turnPar == null || !scene.turnBonusConfig) return 0;
    const turnPressure = scene._victoryPressureState || scene.getTurnPressureState();
    const pressureGoldMultiplier = Number.isFinite(turnPressure?.goldMultiplier)
      ? turnPressure.goldMultiplier
      : 1;
    const result = getRating(scene.turnManager.turnNumber, scene.turnPar, scene.turnBonusConfig);
    const rawBonus = calculateBonusGold(result, scene.runManager.currentAct, scene.turnBonusConfig);
    const scaled = Math.max(0, Math.floor(rawBonus * pressureGoldMultiplier));
    if (scaled > 0 && typeof scene.runManager?.awardGold === 'function') {
      scene.runManager.awardGold(scaled);
    }
    return scaled;
  }

  async transitionAfterBattle() {
    const scene = this.scene;
    if (scene.isTransitioningOut) return false;
    scene.isTransitioningOut = true;
    try {
      if (scene.runManager.isActComplete() && !scene.runManager.pendingBattleReward) {
        if (scene.runManager.isRunComplete()) {
          scene.runManager.status = 'victory';
          settleEndRunForScene(scene, 'victory');
          const ok = await transitionToScene(
            scene,
            'RunComplete',
            {
              gameData: scene.gameData,
              runManager: scene.runManager,
              result: 'victory',
            },
            { reason: TRANSITION_REASONS.VICTORY },
          );
          if (!ok) throw new Error('Scene transition to RunComplete blocked');
        } else {
          const fromAct = scene.runManager.currentAct;
          scene.runManager.advanceAct();
          const toAct = scene.runManager.currentAct;
          const transKey = getActTransitionKey(fromAct, toAct);
          const entries = selectDialogueEntries(
            scene.gameData?.dialogue?.actTransitions?.[transKey],
            buildNarrativeContext({
              meta: scene.registry.get('meta'),
              runManager: scene.runManager,
            }),
          );
          // ACT n · region · grade, once per act (it shares the dialogue's
          // once-gate), with the story lines playing over it.
          const actCard =
            hasDOMHost() && !scene.runManager.hasShownDialogue?.(transKey)
              ? scene._getCeremonies?.()?.showActCard({
                  actId: toAct,
                  withLines: Array.isArray(entries) && entries.length > 0,
                })
              : null;
          try {
            await scene._showStoryDialogueOnce(transKey, entries, { category: 'actTransition' });
          } catch (err) {
            console.warn('[BattleScene] act transition dialogue failed:', err);
          }
          if (actCard) {
            try {
              const linesRead =
                Array.isArray(entries) &&
                entries.length > 0 &&
                !scene.dialogueOverlay?.lastSequenceSkippedAsSeen;
              if (linesRead) void actCard.close();
              else await actCard.finish();
            } catch (err) {
              console.warn('[BattleScene] act card failed:', err);
            }
          }
          const ok2 = await transitionToScene(
            scene,
            'NodeMap',
            {
              gameData: scene.gameData,
              runManager: scene.runManager,
            },
            { reason: TRANSITION_REASONS.BATTLE_COMPLETE },
          );
          if (!ok2) throw new Error('Scene transition to NodeMap blocked (act advance)');
        }
      } else {
        const ok3 = await transitionToScene(
          scene,
          'NodeMap',
          {
            gameData: scene.gameData,
            runManager: scene.runManager,
          },
          { reason: TRANSITION_REASONS.BATTLE_COMPLETE },
        );
        if (!ok3) throw new Error('Scene transition to NodeMap blocked');
      }
      return true;
    } catch (err) {
      scene.isTransitioningOut = false;
      scene.reportLootError('transitionAfterBattle', err, {
        isElite: scene.isElite,
        battleState: scene.battleState,
        nodeId: scene.nodeId,
      });
      scene.forceTransitionAfterBattle();
      return false;
    }
  }

  async forceTransitionAfterBattle() {
    const scene = this.scene;
    scene._postLootTransitionCompleted = true;
    scene._clearPostLootTransitionFallback();
    resetTransitionLocks(scene);
    try {
      let ok;
      const isRunComplete = scene.runManager?.isRunComplete?.();
      if (isRunComplete) {
        settleEndRunForScene(scene, 'victory');
        ok = await transitionToScene(
          scene,
          'RunComplete',
          {
            gameData: scene.gameData,
            runManager: scene.runManager,
            result: 'victory',
          },
          { reason: TRANSITION_REASONS.VICTORY },
        );
      } else {
        ok = await transitionToScene(
          scene,
          'NodeMap',
          {
            gameData: scene.gameData,
            runManager: scene.runManager,
          },
          { reason: TRANSITION_REASONS.BATTLE_COMPLETE },
        );
      }
      if (!ok) {
        console.error(
          '[BattleScene][LootFlow] forceTransitionAfterBattle: transition returned false',
        );
        if (isRunComplete) {
          scene.showVictoryTransitionRecovery();
        } else {
          scene.showLootStatus('Transition failed. Refresh and continue run.', UI_PALETTE.bad);
        }
      }
    } catch (err) {
      console.error('[BattleScene][LootFlow] forceTransitionAfterBattle failed', err);
      if (scene.runManager?.isRunComplete?.()) {
        scene.showVictoryTransitionRecovery();
      } else {
        scene.showLootStatus('Transition failed. Refresh and continue run.', UI_PALETTE.bad);
      }
    }
  }

  async transitionToRunCompleteWithRetry(result = 'defeat') {
    const scene = this.scene;
    const reason = result === 'victory' ? TRANSITION_REASONS.VICTORY : TRANSITION_REASONS.DEFEAT;
    return retryBooleanAction(
      (attempt) => {
        const timeoutToken = Symbol('runcomplete_transition_timeout');
        let timeoutHandle = null;
        const timeoutPromise = new Promise((resolve) => {
          timeoutHandle = setTimeout(
            () => resolve(timeoutToken),
            RUN_COMPLETE_TRANSITION_TIMEOUT_MS,
          );
          if (typeof timeoutHandle?.unref === 'function') timeoutHandle.unref();
        });
        const ok = transitionToScene(
          scene,
          'RunComplete',
          {
            gameData: scene.gameData,
            runManager: scene.runManager,
            result,
          },
          { reason },
        );
        return Promise.race([ok, timeoutPromise]).then((outcome) => {
          if (timeoutHandle) clearTimeout(timeoutHandle);
          if (outcome === timeoutToken) {
            console.warn(`[BattleScene] ${result} transition attempt timed out`, {
              attempt,
              result,
              timeoutMs: RUN_COMPLETE_TRANSITION_TIMEOUT_MS,
            });
            return false;
          }
          if (outcome !== true) {
            console.warn(`[BattleScene] ${result} transition attempt failed`, { attempt, result });
          }
          return outcome === true;
        });
      },
      {
        attempts: 4,
        initialDelayMs: 300,
        delayMultiplier: 2.0,
        wait: (ms) =>
          new Promise((resolve) => {
            if (scene.time?.delayedCall) scene.time.delayedCall(ms, resolve);
            else setTimeout(resolve, ms);
          }),
      },
    );
  }

  showBossRecruitScreen() {
    const scene = this.scene;
    const overlay = new BossRecruitOverlay(scene, scene.runManager, scene.gameData);
    scene._bossRecruitOverlay = overlay;
    scene.lootGroup = overlay.displayObjects;
    overlay.show((selectedUnit) => {
      if (selectedUnit) {
        scene.runManager.grantRecruitBlessingConsumables?.(selectedUnit);
        scene.runManager.roster.push(selectedUnit);
      }
      scene.lootGroup = null;
      scene._bossRecruitOverlay = null;
      const next = () => {
        if (scene.runManager.shouldTriggerThirdLord()) {
          scene._showThirdLordArrival();
        } else {
          scene.showLootScreen();
        }
      };
      if (selectedUnit && this._canPresentJoin()) this._presentJoin(selectedUnit, 'boss', next);
      else next();
    });
  }

  _showThirdLordArrival() {
    const scene = this.scene;
    const overlay = new LordArrivalOverlay(scene, scene.runManager, scene.gameData);
    scene._lordArrivalOverlay = overlay;
    scene.lootGroup = overlay.displayObjects;
    overlay.show((selectedUnit) => {
      scene.runManager.resolveThirdLord(selectedUnit);
      scene.lootGroup = null;
      scene._lordArrivalOverlay = null;
      const joined = selectedUnit && scene.runManager.roster?.includes?.(selectedUnit);
      const next = () => scene.showLootScreen();
      if (joined && this._canPresentJoin()) this._presentJoin(selectedUnit, 'lord', next);
      else next();
    });
  }

  _canPresentJoin() {
    return hasDOMHost() && GrowthCeremonyController.available();
  }

  /**
   * "Joins your army" for a unit already added to the roster: the join is
   * saved first (the won battle and its pending rewards are already saved),
   * so a refresh during the card can neither lose nor repeat the recruit.
   */
  _presentJoin(unit, kind, next) {
    const scene = this.scene;
    let card = null;
    try {
      scene._persistBattleRunState?.();
      card = growthCeremonies(scene)?.showRecruit({ unit, kind });
    } catch (err) {
      console.warn('[PostCombatController] join card failed:', err);
    }
    void Promise.resolve(card)
      .catch((err) => console.warn('[PostCombatController] join card failed:', err))
      .then(() => {
        if (scene.scene?.isActive?.() === false || scene.sys?.isActive?.() === false) return;
        next();
      });
  }

  /** Turn · par · rank for the victory band (presentation only). */
  victoryBandContext() {
    const s = this.scene;
    const turn = s.turnManager?.turnNumber;
    let rating = null;
    try {
      if (Number.isFinite(s.turnPar) && s.turnBonusConfig && Number.isFinite(turn))
        rating = getRating(turn, s.turnPar, s.turnBonusConfig)?.rating || null;
    } catch {
      rating = null;
    }
    return {
      objective: s.battleConfig?.objective,
      turn,
      par: Number.isFinite(s.turnPar) ? s.turnPar : null,
      rating,
      // The Eclipse: the shadow this victory commits (null when the clock is off),
      // and the flare an act boss's fall lifts.
      shadowGain: projectedShadow(s),
      shadowRelief: projectedRelief(s),
    };
  }

  rewardContext() {
    const s = this.scene;
    return {
      nodeId: s.nodeId,
      isElite: s.isElite,
      isBoss: s.isBoss,
      goldEarned: s.goldEarned,
      turnPar: s.turnPar,
      turnBonusConfig: s.turnBonusConfig,
      turnNumber: s.turnManager?.turnNumber,
      victoryPressureState: s._victoryPressureState,
      completionGoldAward: s._completionGoldAward,
      battleCompletionAwardedGold: s._battleCompletionAwardedGold,
      metaEffects: s.runManager?.metaEffects,
    };
  }

  showLootScreen() {
    const scene = this.scene;
    const audio = scene.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.loot, scene, 300);
    scene._elitePicksRemaining = scene.isElite ? ELITE_MAX_PICKS : 1;
    scene._lootCleanedUp = false;
    scene._lootResolving = false;
    if (hasDOMHost()) {
      prepareBattleRewards(scene.runManager, scene.gameData, this.rewardContext());
      scene._persistBattleRunState?.();
      scene._lootController = new PendingRewardController(scene, {
        onLeave: () => this.transitionAfterBattle(),
        onComplete: () => this.transitionAfterBattle(),
      });
      scene.lootGroup = scene._lootController.lootGroup;
      this._showMasteryNotice();
      return;
    }

    scene._lootController = new LootScreenController(scene, scene.runManager, scene.gameData, {
      isElite: scene.isElite,
      isBoss: scene.isBoss,
      goldEarned: scene.goldEarned,
      turnPar: scene.turnPar,
      turnBonusConfig: scene.turnBonusConfig,
      turnNumber: scene.turnManager?.turnNumber,
      victoryPressureState: scene._victoryPressureState,
      completionGoldAward: scene._completionGoldAward,
      battleCompletionAwardedGold: scene._battleCompletionAwardedGold,
      metaEffects: scene.runManager?.metaEffects,
    });
    scene._lootController.renderCards();
    scene.lootGroup = scene._lootController.lootGroup;
    this._showMasteryNotice();
  }

  // Transient toast announcing units that mastered their class this battle.
  // Non-blocking (rides on top of the loot screen), mirrors showLootStatus.
  _showMasteryNotice() {
    const scene = this.scene;
    const mastered = scene._newlyMasteredUnits;
    if (!Array.isArray(mastered) || mastered.length === 0) return;
    scene._newlyMasteredUnits = null;
    const rewards = scene._lootController?.mobileRewards;
    if (rewards?.visible) {
      rewards.masteryNotices = mastered;
      rewards.render();
      // A class mastered is growth: a sealed beat stamps it over the rewards.
      const first = mastered[0];
      growthCeremonies(scene)?.showSealed({
        title:
          mastered.length === 1
            ? `${first.name} mastered ${first.className}`
            : `${mastered.length} classes mastered`,
        detail: mastered
          .map((m) => m.perk?.name)
          .filter(Boolean)
          .join(' · '),
        skillId: 'mastery',
      });
      return;
    }
    const cam = scene.cameras.main;
    const lines = mastered
      .slice(0, 3)
      .map((m) => `${m.name} mastered ${m.className}!` + (m.perk?.name ? ` (${m.perk.name})` : ''));
    const text = scene.add
      .text(cam.centerX, 40, lines.join('\n'), {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: UI_PALETTE.accentText,
        align: 'center',
        backgroundColor: '#000000cc',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5, 0)
      // Must render above LootScreenController's full-screen dim rect (depth
      // UI_DEPTHS.LOOT_OVERLAY_DIM = 700) or the toast is invisible.
      .setDepth(UI_DEPTHS.MASTERY_NOTICE);
    scene._pinToScreen?.(text);
    scene.tweens.add({
      targets: text,
      alpha: 0,
      delay: 3200,
      duration: 900,
      onComplete: () => text.destroy(),
    });
  }

  showLootStatus(message, color = UI_PALETTE.bad) {
    const scene = this.scene;
    const cam = scene.cameras.main;
    const status = scene.add
      .text(cam.centerX, cam.height - 44, message, {
        fontFamily: 'monospace',
        fontSize: '10px',
        color,
        backgroundColor: '#000000cc',
        padding: { x: 8, y: 4 },
      })
      .setOrigin(0.5)
      .setDepth(799);
    scene._pinToScreen(status);
    scene.time.delayedCall(1500, () => {
      if (status && status.active) status.destroy();
    });
  }

  reportLootError(context, err, extra = {}) {
    const scene = this.scene;
    console.error('[BattleScene][LootFlow]', context, extra, err);
    scene.showLootStatus('Loot error. Check console log.', UI_PALETTE.bad);
  }

  onDefeat() {
    const scene = this.scene;
    if (scene.battleState === 'BATTLE_END') return;
    if (scene.runManager?.battleInProgress) {
      try {
        scene._timelineFacts = [...(scene._timelineFacts || []), 'Defeat. The run has ended.'];
        recordBattleTimeline(
          scene,
          captureBattleState(scene, { rngSeed: scene.runManager.rngSeed }),
        );
        scene.runManager.lastBattleReport = readOnlyBattleReport(scene._battleTimeline);
      } catch (error) {
        console.warn('[Timeline] terminal report unavailable:', error);
      }
    }
    const defeatBossName = scene.isBoss ? scene._resolveBossDialogueName?.(scene._bossName) : null;
    const defeatContext = {
      defeatedBy: defeatBossName || scene._commanderKillerName || null,
      wasBoss: Boolean(defeatBossName),
    };
    if (scene.runManager?.battleInProgress || scene._defeatDecision) {
      const result = persistBattleDefeat(scene, defeatContext);
      if (!result.ok) {
        scene.showVisionDialog({
          title: 'Defeat could not be saved',
          body: 'The battle is paused. Retry saving to finish this run. Closing the app now may return to the previous saved decision.',
          confirmLabel: 'Retry save',
          cancelLabel: 'Retry save',
          onConfirm: () => this.onDefeat(),
          onCancel: () => this.onDefeat(),
        });
        return;
      }
    }
    scene._reinforcementsPendingThisTurn = false;
    scene.battleState = 'BATTLE_END';
    scene.clearInspectionVisuals();
    scene.hideActionMenu();
    const audio = scene.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.defeat, scene, 0);
    scene._bossPresence?.hide?.();
    const band = hasDOMHost()
      ? scene._getCeremonies?.()?.showDefeat({
          commanderName: scene._fallenCommander?.name || null,
        })
      : null;
    if (!band) {
      const defeatBanner = scene.add
        .text(scene.cameras.main.centerX, scene.cameras.main.centerY, 'DEFEAT', {
          fontFamily: 'monospace',
          fontSize: '28px',
          color: UI_PALETTE.bad,
          backgroundColor: '#000000dd',
          padding: { x: 24, y: 12 },
        })
        .setOrigin(0.5)
        .setDepth(600);
      scene._pinToScreen(defeatBanner);
    }

    if (scene.battleParams.tutorialMode) {
      scene.time.delayedCall(1500, async () => {
        if (!scene.scene?.isActive?.()) return;
        await showImportantHint(
          scene,
          'Your lord fell! In a real run, this ends everything.\nTry again from the title screen.',
        );
        if (!scene.scene?.isActive?.()) return;
        scene._transitionTutorialToTitle();
      });
    } else if (scene.runManager) {
      scene.clearBattleScopedDeltas(scene.playerUnits);
      scene.clearBattleScopedDeltas(scene.nonDeployedUnits || []);
      // Narrative memory: attribute the run's end. A defeat inside a boss
      // battle is credited to the boss; otherwise to whoever felled the
      // commander (may be null for e.g. field-empty losses).
      if (!scene._defeatDecision?.durable) {
        scene.runManager.failRun(defeatContext);
        scene._persistBattleRunState?.();
      }
      scene.time.delayedCall(2000, async () => {
        if (!scene.scene?.isActive?.()) return;
        // Clear any stale transition locks -- the 2s delay gives legitimate
        // in-flight transitions plenty of time to finish.
        resetTransitionLocks(scene);
        const transitioned = await scene.transitionToRunCompleteWithRetry('defeat');
        if (!transitioned && scene.scene?.isActive?.()) scene.showDefeatTransitionRecovery();
      });
    } else {
      // Standalone mode -- restart battle after delay
      scene.time.delayedCall(2000, () => {
        restartScene(scene, undefined, { reason: TRANSITION_REASONS.RETRY });
      });
    }
  }

  destroy() {
    this.scene = null;
  }
}

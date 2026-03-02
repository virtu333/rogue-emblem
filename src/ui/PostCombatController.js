import { serializeUnit, getActTransitionKey } from '../engine/RunManager.js';
import { getRating, calculateBonusGold } from '../engine/TurnBonusCalculator.js';
import { GOLD_BATTLE_BONUS, ELITE_MAX_PICKS } from '../utils/constants.js';
import { transitionToScene, restartScene, TRANSITION_REASONS } from '../utils/SceneRouter.js';
import { retryBooleanAction } from '../utils/retry.js';
import { resetTransitionLocks } from '../utils/sceneLoader.js';
import { showImportantHint } from './HintDisplay.js';
import { MUSIC } from '../utils/musicConfig.js';
import { BossRecruitOverlay } from './BossRecruitOverlay.js';
import { LordArrivalOverlay } from './LordArrivalOverlay.js';
import { LootScreenController } from './LootScreenController.js';

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
    const victoryBanner = scene.add
      .text(scene.cameras.main.centerX, scene.cameras.main.centerY, 'VICTORY!', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#ffdd44',
        backgroundColor: '#000000dd',
        padding: { x: 24, y: 12 },
      })
      .setOrigin(0.5)
      .setDepth(600);
    scene._victoryBanner = victoryBanner;
    scene._pinToScreen(victoryBanner);

    if (scene.battleParams.tutorialMode) {
      scene.time.delayedCall(1500, async () => {
        if (!scene.scene?.isActive?.()) return;
        await showImportantHint(
          scene,
          "Victory! You've completed the tutorial.\nYou're ready for a real run -- good luck!",
        );
        if (!scene.scene?.isActive?.()) return;
        try {
          localStorage.setItem('emblem_rogue_tutorial_completed', '1');
        } catch (_) {}
        scene._transitionTutorialToTitle();
      });
    } else if (scene.runManager) {
      scene.clearBattleScopedDeltas(scene.playerUnits);
      scene.clearBattleScopedDeltas(scene.nonDeployedUnits || []);
      const surviving = scene.playerUnits.map((u) => serializeUnit(u));
      const allUnits = [...surviving, ...(scene.nonDeployedUnits || [])];
      const turnPressure = scene.getTurnPressureState();
      const completionGoldAward = Math.max(
        0,
        Math.floor(GOLD_BATTLE_BONUS * turnPressure.goldMultiplier),
      );
      scene._victoryPressureState = turnPressure;
      scene._completionGoldAward = completionGoldAward;
      const vaultGoldBeforeCompletion = Math.max(0, Math.trunc(scene.runManager.gold || 0));
      const completionApplied = scene.runManager.completeBattle(
        allUnits,
        scene.nodeId,
        scene.goldEarned,
        {
          completionGoldOverride: completionGoldAward,
        },
      );
      const vaultGoldAfterCompletion = Math.max(0, Math.trunc(scene.runManager.gold || 0));
      scene._battleCompletionAwardedGold = completionApplied
        ? Math.max(0, vaultGoldAfterCompletion - vaultGoldBeforeCompletion)
        : 0;
      scene.time.delayedCall(1500, async () => {
        if (!scene.scene?.isActive?.()) return;
        if (!completionApplied) {
          console.warn('[BattleScene] completeBattle no-op; skipping loot/recruit flow.');
          try {
            const ok = await transitionToScene(
              scene,
              'NodeMap',
              {
                gameData: scene.gameData,
                runManager: scene.runManager,
              },
              { reason: TRANSITION_REASONS.BATTLE_COMPLETE },
            );
            if (!ok) {
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
                scene.showLootStatus?.('Transition failed. Refresh and continue run.', '#ff8888');
              }
            }
          } catch (err) {
            console.warn('[BattleScene] completeBattle no-op transition failed:', err);
            if (scene._victoryBanner) {
              scene._victoryBanner.destroy();
              scene._victoryBanner = null;
            }
            scene.showLootStatus?.('Transition failed. Refresh and continue run.', '#ff8888');
          }
          return;
        }
        try {
          if (scene.isBoss && scene._bossName && scene.runManager) {
            const bossName = scene._resolveBossDialogueName(scene._bossName);
            const dialogueKey = `boss_defeat_${bossName}`;
            const entries = scene.gameData?.dialogue?.bossEncounters?.[bossName]?.defeat;
            await scene._showStoryDialogueOnce(dialogueKey, entries);
          }
        } catch (err) {
          console.warn('[BattleScene] boss defeat dialogue failed:', err);
        }

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
      if (scene.runManager.isActComplete()) {
        if (scene.runManager.isRunComplete()) {
          scene.runManager.status = 'victory';
          scene.runManager.settleEndRunRewards(scene.registry.get('meta'), 'victory');
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
          const entries = scene.gameData?.dialogue?.actTransitions?.[transKey];
          try {
            await scene._showStoryDialogueOnce(transKey, entries);
          } catch (err) {
            console.warn('[BattleScene] act transition dialogue failed:', err);
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
        scene.runManager.settleEndRunRewards(scene.registry.get('meta'), 'victory');
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
          scene.showLootStatus('Transition failed. Refresh and continue run.', '#ff8888');
        }
      }
    } catch (err) {
      console.error('[BattleScene][LootFlow] forceTransitionAfterBattle failed', err);
      if (scene.runManager?.isRunComplete?.()) {
        scene.showVictoryTransitionRecovery();
      } else {
        scene.showLootStatus('Transition failed. Refresh and continue run.', '#ff8888');
      }
    }
  }

  async transitionToRunCompleteWithRetry(result = 'defeat') {
    const scene = this.scene;
    const reason = result === 'victory' ? TRANSITION_REASONS.VICTORY : TRANSITION_REASONS.DEFEAT;
    return retryBooleanAction(
      (attempt) => {
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
        return ok.then((success) => {
          if (!success) {
            console.warn(`[BattleScene] ${result} transition attempt failed`, { attempt, result });
          }
          return success;
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
      if (selectedUnit) scene.runManager.roster.push(selectedUnit);
      scene.lootGroup = null;
      scene._bossRecruitOverlay = null;
      if (scene.runManager.shouldTriggerThirdLord()) {
        scene._showThirdLordArrival();
      } else {
        scene.showLootScreen();
      }
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
      scene.showLootScreen();
    });
  }

  showLootScreen() {
    const scene = this.scene;
    const audio = scene.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.loot, scene, 300);
    scene._elitePicksRemaining = scene.isElite ? ELITE_MAX_PICKS : 1;
    scene._lootCleanedUp = false;
    scene._lootResolving = false;

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
  }

  showLootStatus(message, color = '#ff8888') {
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
    scene.showLootStatus('Loot error. Check console log.', '#ff8888');
  }

  onDefeat() {
    const scene = this.scene;
    if (scene.battleState === 'BATTLE_END') return;
    scene._reinforcementsPendingThisTurn = false;
    scene.battleState = 'BATTLE_END';
    scene.clearInspectionVisuals();
    scene.hideActionMenu();
    const audio = scene.registry.get('audio');
    if (audio) audio.playMusic(MUSIC.defeat, scene, 0);
    const defeatBanner = scene.add
      .text(scene.cameras.main.centerX, scene.cameras.main.centerY, 'DEFEAT', {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#cc3333',
        backgroundColor: '#000000dd',
        padding: { x: 24, y: 12 },
      })
      .setOrigin(0.5)
      .setDepth(600);
    scene._pinToScreen(defeatBanner);

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
      scene.runManager.failRun();
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

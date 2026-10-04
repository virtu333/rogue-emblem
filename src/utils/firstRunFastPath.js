// firstRunFastPath — First-run onboarding shortcut, and the prologue's two starts.
//
// A brand-new save has nothing to do in Home Base (Valor/Supply are 0),
// Difficulty Select (Normal is the only unlocked mode), or Blessing Select
// (skipped by onboarding decision). This helper lets both new-game entry
// points (SlotPickerScene, TitleScene) drop such a save straight onto the
// act-1 node map. Later runs keep the full flow.
//
// The run-start path mirrors BlessingSelectScene._confirm's blessing-skip
// commit exactly (startRun normal → chooseBlessing(null) → transition →
// on success incrementRunsStarted + clearSavedRun) so resume/story/economy
// behave identically to the normal flow — the only difference is the three
// skipped menu scenes.
//
// A fresh slot is first offered the prologue (docs/specs/prologue-chapter.md §9):
// startPrologueRun begins the prologue run and opens its first chapter at once (the
// route map stays hidden until it is won); skipPrologueToFirstRun records the skip and
// takes today's fast path unchanged. Which of these a slot gets: engine/PrologueRouting.

import { RunManager, clearSavedRun } from '../engine/RunManager.js';
import { deleteRunSave } from '../cloud/CloudSync.js';
import { transitionToScene, TRANSITION_REASONS } from './SceneRouter.js';
import { isFirstRunSlot } from '../engine/PrologueRouting.js';
import { NODE_TYPES } from './constants.js';

export { isFirstRunSlot };

function cloudClearer(scene) {
  const cloud = scene.registry.get('cloud');
  return cloud
    ? (resolvedSlot, abandonedRun) => deleteRunSave(cloud.userId, resolvedSlot, abandonedRun)
    : null;
}

/**
 * Begin a run immediately on Normal with no blessing, skipping HomeBase /
 * DifficultySelect / BlessingSelect. Replicates the blessing-skip commit path.
 *
 * Registry meta/hints/activeSlot must already be staged by the caller (both
 * entry points do this before calling). Post-transition bookkeeping mirrors
 * BlessingSelectScene:172-179. Null-safe on meta (dev routes may have none).
 *
 * @param {Phaser.Scene} scene - the calling scene (provides registry + transition context)
 * @param {{ gameData: object, slot: number }} opts
 * @returns {Promise<boolean>} the transition result (true on success)
 */
export async function startFirstRunFastPath(scene, { gameData, slot }) {
  const meta = scene.registry.get('meta');
  const metaEffects = meta
    ? meta.getActiveEffects({ weaponArtCatalog: gameData?.weaponArts?.arts || [] })
    : null;

  const runManager = new RunManager(gameData, metaEffects);
  runManager.startRun({ difficultyId: 'normal', applyBlessingsAtStart: false });
  runManager.chooseBlessing(null); // sets activeBlessings=[], _blessingChosen=true

  const transitioned = await transitionToScene(
    scene,
    'NodeMap',
    { gameData, runManager, firstRun: true },
    // A tap can land inside the router's post-start cooldown (Title is barely
    // 350 ms old on a fast boot); a silent BLOCKED dropped New Game entirely.
    { reason: TRANSITION_REASONS.BEGIN_RUN, retryBlocked: true },
  );

  if (transitioned) {
    // The run is committed: count the attempt (finished runs are counted
    // separately when the run settles). Clear any stale run save only after
    // transition success — same post-transition order as BlessingSelectScene.
    meta?.incrementRunsStarted?.();
    clearSavedRun(cloudClearer(scene), slot);
  }

  return transitioned;
}

/**
 * Skip the prologue on a fresh slot: the slot remembers the skip (routing never
 * offers it again, the first run keeps today's cold open) and takes the fast path.
 */
export async function skipPrologueToFirstRun(scene, { gameData, slot }) {
  const meta = scene.registry.get('meta');
  const transitioned = await startFirstRunFastPath(scene, { gameData, slot });
  if (transitioned) meta?.setPrologueState?.('skipped');
  return transitioned;
}

/**
 * Begin the prologue run (RunManager.startPrologue) and open its first chapter at
 * once: the route map is first shown after it is won (§4). The battle's own entry
 * save (beginBattleInProgress) is the run's first save, so the stale run save of a
 * fresh slot is cleared before the transition. Nothing counts: runsStarted is never
 * incremented; the slot's meta records the prologue as in progress on success.
 * @param {Phaser.Scene} scene
 * @param {{ gameData: object, slot: number }} opts
 * @returns {Promise<boolean>}
 */
export async function startPrologueRun(scene, { gameData, slot }) {
  const prologue = gameData?.prologue;
  if (!prologue?.route) return false;
  const meta = scene.registry.get('meta');
  const runManager = new RunManager(gameData, null);
  runManager.startPrologue(gameData, prologue);
  const node = runManager.getAvailableNodes()[0];
  if (!node?.battleParams) return false;
  clearSavedRun(cloudClearer(scene), slot);
  const transitioned = await transitionToScene(
    scene,
    'Battle',
    {
      gameData,
      runManager,
      battleParams: runManager.getBattleParams(node),
      roster: runManager.getRoster(),
      nodeId: node.id,
      isBoss: node.type === NODE_TYPES.BOSS,
      isElite: false,
    },
    { reason: TRANSITION_REASONS.NEW_GAME, retryBlocked: true },
  );
  if (transitioned) meta?.setPrologueState?.('in_progress');
  return transitioned;
}

/**
 * Re-enter a prologue run's open chapter from the route map or a restart: the same
 * launch data NodeMapScene.handleBattle builds, from the node's locked config.
 */
export function prologueBattleLaunchData(runManager, node, gameData) {
  return {
    gameData,
    runManager,
    battleParams: runManager.getBattleParams(node),
    roster: runManager.getRoster(),
    nodeId: node.id,
    isBoss: node.type === NODE_TYPES.BOSS,
    isElite: false,
  };
}

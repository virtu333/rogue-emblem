import { markStartup } from './startupTelemetry.js';
import { captureResourceSnapshot } from './resourceSnapshot.js';

export const TRANSITION_REASONS = {
  BATTLE_COMPLETE: 'battle_complete',
  VICTORY: 'victory',
  DEFEAT: 'defeat',
  ENTER_BATTLE: 'enter_battle',
  BEGIN_RUN: 'begin_run',
  CONTINUE: 'continue',
  NEW_GAME: 'new_game',
  SAVE_EXIT: 'save_exit',
  ABANDON_RUN: 'abandon_run',
  RETRY: 'retry',
  RETURN_HOME: 'return_home',
  RETURN_TITLE: 'return_title',
  BOOT: 'boot',
  BACK: 'back',
};

const TRANSITION_REASON_VALUES = new Set(Object.values(TRANSITION_REASONS));

export function normalizeTransitionReason(reason, context = 'startSceneLazy') {
  if (reason == null) return null;
  if (TRANSITION_REASON_VALUES.has(reason)) return reason;
  if (import.meta?.env?.DEV) {
    console.warn(`[SceneLoader] Invalid transition reason in ${context}:`, reason);
  }
  return null;
}

const SCENE_LOADERS = {
  Title: () => import('../scenes/TitleScene.js').then(m => m.TitleScene),
  SlotPicker: () => import('../scenes/SlotPickerScene.js').then(m => m.SlotPickerScene),
  HomeBase: () => import('../scenes/HomeBaseScene.js').then(m => m.HomeBaseScene),
  DifficultySelect: () => import('../scenes/DifficultySelectScene.js').then(m => m.DifficultySelectScene),
  BlessingSelect: () => import('../scenes/BlessingSelectScene.js').then(m => m.BlessingSelectScene),
  NodeMap: () => import('../scenes/NodeMapScene.js').then(m => m.NodeMapScene),
  Battle: () => import('../scenes/BattleScene.js').then(m => m.BattleScene),
  RunComplete: () => import('../scenes/RunCompleteScene.js').then(m => m.RunCompleteScene),
};
let globalStartSceneInFlight = false;
let globalSceneStartCooldownUntil = 0;
const GLOBAL_SCENE_START_COOLDOWN_MS = 350;
const GLOBAL_SCENE_START_LOCK_MS = 700;
const AUDIO_DIAG_FLAG_KEY = 'emblem_rogue_audio_diag';

function isAudioDiagEnabled() {
  try {
    const host = globalThis?.location?.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    const raw = globalThis?.localStorage?.getItem(AUDIO_DIAG_FLAG_KEY);
    const forced = raw === '1' || raw === 'true';
    return isLocalHost || forced;
  } catch (_) {
    return false;
  }
}

function getAudioSnapshot(scene) {
  try {
    const audio = scene?.registry?.get?.('audioManager');
    if (!audio || typeof audio.getActiveMusicKeys !== 'function') {
      return { available: false, activeMusicKeys: [] };
    }
    return {
      available: true,
      activeMusicKeys: audio.getActiveMusicKeys(),
      currentMusicKey: audio.currentMusicKey || null,
      currentMusicOwner: audio.currentMusicOwner || null,
    };
  } catch (_) {
    return { available: false, activeMusicKeys: [] };
  }
}

function markAudioDiag(scene, phase, extra = {}) {
  if (!isAudioDiagEnabled()) return;
  const sourceScene = scene?.sys?.settings?.key || null;
  const snapshot = getAudioSnapshot(scene);
  const payload = { phase, sourceScene, ...snapshot, ...extra };
  markStartup('audio_diag', payload);
  console.info('[AudioDiag]', payload);
}

function hasScene(scene, key) {
  try {
    return Boolean(scene.scene.get(key));
  } catch (_) {
    return false;
  }
}

export async function ensureSceneLoaded(scene, key) {
  if (!scene || !key) return;
  if (hasScene(scene, key)) return;
  const load = SCENE_LOADERS[key];
  if (!load) throw new Error(`Unknown scene key: ${key}`);
  markStartup('scene_lazy_load_start', { key });
  const SceneClass = await load();
  if (!hasScene(scene, key)) {
    scene.scene.add(key, SceneClass, false);
  }
  markStartup('scene_lazy_load_complete', { key });
}

export async function startSceneLazy(scene, key, data = undefined, { reason } = {}) {
  if (!scene || !key) return false;
  const sourceKey = scene?.sys?.settings?.key || null;

  // Build transition metadata early so all exit paths can clean it up
  const meta = {
    reason: normalizeTransitionReason(reason),
    pre: null,
    from: sourceKey,
    to: key,
    token: Date.now(),
  };

  const now = Date.now();
  if (now < globalSceneStartCooldownUntil) {
    markAudioDiag(scene, 'transition_blocked_cooldown', { targetScene: key });
    return false;
  }
  if (scene.__startSceneLazyInFlight) {
    markAudioDiag(scene, 'transition_blocked_scene_inflight', { targetScene: key });
    return false;
  }
  if (globalStartSceneInFlight) {
    markAudioDiag(scene, 'transition_blocked_global_inflight', { targetScene: key });
    return false;
  }
  scene.__startSceneLazyInFlight = true;
  globalStartSceneInFlight = true;
  markAudioDiag(scene, 'transition_start', { targetScene: key });

  let started = false;
  const releaseTransitionLock = () => {
    globalStartSceneInFlight = false;
    scene.__startSceneLazyInFlight = false;
  };
  const scheduleRelease = () => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      markAudioDiag(scene, 'transition_lock_release', { targetScene: key });
      releaseTransitionLock();
    };
    const timer = setTimeout(release, GLOBAL_SCENE_START_LOCK_MS);
    if (typeof timer?.unref === 'function') timer.unref();
    try {
      if (typeof scene.events?.once === 'function') {
        scene.events.once('shutdown', release);
        scene.events.once('destroy', release);
      }
    } catch (_) {}
  };

  const cleanupMeta = () => {
    if (globalThis.__sceneState?._pendingTransitionMeta?.token === meta.token) {
      globalThis.__sceneState._pendingTransitionMeta = null;
    }
  };

  try {
    await ensureSceneLoaded(scene, key);
    const isActive = typeof scene.sys?.isActive === 'function'
      ? scene.sys.isActive()
      : true;
    if (!isActive) {
      markAudioDiag(scene, 'transition_blocked_inactive_source', { targetScene: key });
      return false;
    }

    // Capture pre-snapshot AFTER lock acquired, BEFORE scene.start()
    meta.pre = captureResourceSnapshot(scene);

    // Write metadata for SceneGuard to merge on the success path
    if (globalThis.__sceneState) {
      globalThis.__sceneState._pendingTransitionMeta = meta;
    }

    scene.scene.start(key, data);
    started = true;
    globalSceneStartCooldownUntil = Date.now() + GLOBAL_SCENE_START_COOLDOWN_MS;
    markAudioDiag(scene, 'transition_started', { targetScene: key });
    scheduleRelease();
    return true;
  } catch (err) {
    cleanupMeta();
    markAudioDiag(scene, 'transition_error', {
      targetScene: key,
      message: err?.message || String(err),
    });
    console.error('[SceneLoader] startSceneLazy failed:', key, err);
    return false;
  } finally {
    if (!started) {
      cleanupMeta();
      markAudioDiag(scene, 'transition_aborted', { targetScene: key });
      releaseTransitionLock();
    }
  }
}

export function __resetSceneLoaderForTests() {
  globalStartSceneInFlight = false;
  globalSceneStartCooldownUntil = 0;
}

import { markStartup } from './startupTelemetry.js';

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
const GLOBAL_SCENE_START_COOLDOWN_MS = 180;

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

export async function startSceneLazy(scene, key, data = undefined) {
  if (!scene || !key) return false;
  const now = Date.now();
  if (now < globalSceneStartCooldownUntil) return false;
  if (scene.__startSceneLazyInFlight) return false;
  if (globalStartSceneInFlight) return false;
  scene.__startSceneLazyInFlight = true;
  globalStartSceneInFlight = true;
  try {
    await ensureSceneLoaded(scene, key);
    const isActive = typeof scene.sys?.isActive === 'function'
      ? scene.sys.isActive()
      : true;
    if (!isActive) return false;
    scene.scene.start(key, data);
    globalSceneStartCooldownUntil = Date.now() + GLOBAL_SCENE_START_COOLDOWN_MS;
    return true;
  } finally {
    globalStartSceneInFlight = false;
    scene.__startSceneLazyInFlight = false;
  }
}

import { markStartup } from './startupTelemetry.js';

const SCENE_LOADERS = {
  Title: () => import('../scenes/TitleScene.js').then(m => m.TitleScene),
  SlotPicker: () => import('../scenes/SlotPickerScene.js').then(m => m.SlotPickerScene),
  HomeBase: () => import('../scenes/HomeBaseScene.js').then(m => m.HomeBaseScene),
  NodeMap: () => import('../scenes/NodeMapScene.js').then(m => m.NodeMapScene),
  Battle: () => import('../scenes/BattleScene.js').then(m => m.BattleScene),
  RunComplete: () => import('../scenes/RunCompleteScene.js').then(m => m.RunCompleteScene),
};

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
  await ensureSceneLoaded(scene, key);
  scene.scene.start(key, data);
}

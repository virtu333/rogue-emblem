// Scene-scoped timer tracking shared by NodeMapScene and its extracted
// controllers. Timers registered here are swept on scene shutdown via
// clearAllSceneTimers so delayed callbacks never fire into a dead scene.

export function trackSceneTimer(scene, timer) {
  if (!timer) return null;
  if (!scene._sceneTimers || typeof scene._sceneTimers.add !== 'function') {
    scene._sceneTimers = new Set();
  }
  scene._sceneTimers.add(timer);
  return timer;
}

export function clearTrackedSceneTimer(scene, timer) {
  if (!timer) return;
  if (scene?._sceneTimers && typeof scene._sceneTimers.delete === 'function') {
    scene._sceneTimers.delete(timer);
  }
  try {
    timer.remove?.();
  } catch (_) {}
}

export function clearAllSceneTimers(scene) {
  if (!scene?._sceneTimers || typeof scene._sceneTimers.values !== 'function') return;
  for (const timer of Array.from(scene._sceneTimers.values())) {
    clearTrackedSceneTimer(scene, timer);
  }
}

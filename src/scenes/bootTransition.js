import { transitionToScene } from '../utils/SceneRouter.js';
import { resetTransitionLocks } from '../utils/sceneLoader.js';

/**
 * Boot-scene transition with recovery tiers:
 * 1) normal SceneRouter transition
 * 2) reset locks and retry
 * 3) direct scene.start() bypass
 * Returns true when some tier started the target scene, false when all
 * three failed (the boot watchdog then surfaces recovery UI).
 */
export async function bootTransition(scene, key, data, reason) {
  const ok = await transitionToScene(scene, key, data, { reason });
  if (ok) return true;

  console.warn(`[BootScene] Transition to ${key} failed, resetting locks and retrying...`);
  resetTransitionLocks(scene);
  const retry = await transitionToScene(scene, key, data, { reason });
  if (retry) return true;

  console.error(`[BootScene] Retry to ${key} also failed, using direct scene.start fallback`);
  try {
    scene.scene.start(key, data); // scene-router-bypass
    return true;
  } catch (err) {
    console.error(`[BootScene] Direct scene.start fallback failed:`, err);
    // Watchdog timer (main.js) will surface recovery UI
    return false;
  }
}

import { startSceneLazy, TRANSITION_REASONS, normalizeTransitionReason } from './sceneLoader.js';
import { captureResourceSnapshot } from './resourceSnapshot.js';

function setPendingTransitionMeta(scene, to, reason) {
  if (!globalThis.__sceneState) return null;
  const token = Date.now();
  const from = scene?.sys?.settings?.key || null;
  globalThis.__sceneState._pendingTransitionMeta = {
    reason: reason || null,
    pre: captureResourceSnapshot(scene),
    from,
    to,
    token,
  };
  return token;
}

function clearPendingTransitionMeta(token) {
  if (!token) return;
  const pending = globalThis.__sceneState?._pendingTransitionMeta;
  if (pending?.token === token) {
    globalThis.__sceneState._pendingTransitionMeta = null;
  }
}

export { TRANSITION_REASONS };

/**
 * Transition from the current scene to a target scene via the lazy loader.
 * @param {object} scene
 * @param {string} key
 * @param {object|undefined} data
 * @param {{ reason?: string }} options
 * @returns {Promise<boolean>}
 */
export async function transitionToScene(scene, key, data = undefined, { reason } = {}) {
  return startSceneLazy(scene, key, data, { reason });
}

/**
 * Restart the current scene while preserving transition metadata semantics so
 * SceneGuard can attribute post-restart state to a reason code.
 * @param {object} scene
 * @param {object|undefined} data
 * @param {{ reason?: string }} options
 * @returns {boolean}
 */
export function restartScene(scene, data = undefined, { reason = TRANSITION_REASONS.RETRY } = {}) {
  if (!scene?.scene || typeof scene.scene.restart !== 'function') return false;
  const key = scene?.sys?.settings?.key;
  if (!key) return false;

  const token = setPendingTransitionMeta(scene, key, normalizeTransitionReason(reason, 'restartScene'));
  try {
    scene.scene.restart(data);
    return true;
  } catch (err) {
    clearPendingTransitionMeta(token);
    console.error('[SceneRouter] restartScene failed:', key, err);
    return false;
  }
}

/**
 * Sleep a scene key (or current scene when key omitted) through router guards.
 * @param {object} scene
 * @param {string|undefined} key
 * @returns {boolean}
 */
export function sleepScene(scene, key) {
  if (!scene?.scene || typeof scene.scene.sleep !== 'function') return false;
  try {
    if (key) scene.scene.sleep(key);
    else scene.scene.sleep();
    return true;
  } catch (err) {
    console.error('[SceneRouter] sleepScene failed:', key || scene?.sys?.settings?.key || 'current', err);
    return false;
  }
}

/**
 * Wake a scene key through router guards.
 * @param {object} scene
 * @param {string} key
 * @param {object|undefined} data
 * @returns {boolean}
 */
export function wakeScene(scene, key, data = undefined) {
  if (!scene?.scene || typeof scene.scene.wake !== 'function' || !key) return false;
  try {
    scene.scene.wake(key, data);
    return true;
  } catch (err) {
    console.error('[SceneRouter] wakeScene failed:', key, err);
    return false;
  }
}

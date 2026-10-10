/**
 * Capture a defensive snapshot of scene-level resource counts that are useful
 * for transition diagnostics.
 * @param {object} scene
 * @returns {{
 *   sounds: number,
 *   tweens: number,
 *   timers: number,
 *   objects: number,
 *   overlayOpen: number,
 *   listeners: {
 *     sceneEvents: number,
 *     input: number,
 *     keyboard: number,
 *     game: number,
 *     scale: number
 *   },
 *   listenerTotal: number
 * }}
 */
function countEmitterListeners(emitter) {
  if (!emitter) return 0;
  try {
    if (typeof emitter.eventNames === 'function') {
      const events = emitter.eventNames();
      let total = 0;
      for (const eventName of events) {
        if (typeof emitter.listenerCount === 'function') {
          total += emitter.listenerCount(eventName) || 0;
        } else if (typeof emitter.listeners === 'function') {
          total += emitter.listeners(eventName)?.length || 0;
        }
      }
      return total;
    }
  } catch (_) {}
  return 0;
}

function countOverlayOpenFromSceneState() {
  const overlays = globalThis.__sceneState?.overlays;
  if (!overlays || typeof overlays !== 'object') return 0;
  let open = 0;
  for (const value of Object.values(overlays)) {
    if (value === true) open++;
  }
  return open;
}

/**
 * Whether a playing sound is one a scene can leak. A fire-and-forget one-shot
 * (Phaser's `sound.play(key)`, which destroys the sound on `complete`; every
 * `AudioManager.playSFX` effect is one) ends and removes itself, so it is not a
 * leak however a transition falls: a few quick menu clicks leave as many 1.4 s
 * effects playing into the next scene. Music (`loop`) always counts.
 * @param {object} sound
 * @returns {boolean}
 */
export function isLeakableSound(sound) {
  if (!sound?.isPlaying) return false;
  if (sound.loop ?? sound.currentConfig?.loop) return true;
  const onComplete = sound.listeners?.('complete');
  return !(Array.isArray(onComplete) && onComplete.includes(sound.destroy));
}

/**
 * The number of playing sounds a scene can leak (`isLeakableSound`).
 * @param {object} soundManager
 * @returns {number}
 */
export function countLeakableSounds(soundManager) {
  return soundManager?.sounds?.filter(isLeakableSound)?.length || 0;
}

export function captureResourceSnapshot(scene) {
  let sounds = 0;
  let tweens = 0;
  let timers = 0;
  let objects = 0;

  try {
    sounds = countLeakableSounds(scene?.game?.sound);
  } catch (_) {}
  try {
    tweens = scene?.tweens?.getTweens?.()?.length || 0;
  } catch (_) {}
  try {
    timers = scene?.time?.getAllEvents?.()?.length || 0;
  } catch (_) {}
  try {
    objects = scene?.children?.list?.length || 0;
  } catch (_) {}

  const listeners = {
    sceneEvents: countEmitterListeners(scene?.events),
    input: countEmitterListeners(scene?.input),
    keyboard: countEmitterListeners(scene?.input?.keyboard),
    game: countEmitterListeners(scene?.game?.events),
    scale: countEmitterListeners(scene?.scale),
  };

  const listenerTotal =
    listeners.sceneEvents + listeners.input + listeners.keyboard + listeners.game + listeners.scale;

  return {
    sounds,
    tweens,
    timers,
    objects,
    overlayOpen: countOverlayOpenFromSceneState(),
    listeners,
    listenerTotal,
  };
}

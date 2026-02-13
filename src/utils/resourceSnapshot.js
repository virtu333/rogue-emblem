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

export function captureResourceSnapshot(scene) {
  let sounds = 0;
  let tweens = 0;
  let timers = 0;
  let objects = 0;

  try { sounds = scene?.game?.sound?.sounds?.filter((s) => s?.isPlaying)?.length || 0; } catch (_) {}
  try { tweens = scene?.tweens?.getTweens?.()?.length || 0; } catch (_) {}
  try { timers = scene?.time?.getAllEvents?.()?.length || 0; } catch (_) {}
  try { objects = scene?.children?.list?.length || 0; } catch (_) {}

  const listeners = {
    sceneEvents: countEmitterListeners(scene?.events),
    input: countEmitterListeners(scene?.input),
    keyboard: countEmitterListeners(scene?.input?.keyboard),
    game: countEmitterListeners(scene?.game?.events),
    scale: countEmitterListeners(scene?.scale),
  };

  const listenerTotal = listeners.sceneEvents
    + listeners.input
    + listeners.keyboard
    + listeners.game
    + listeners.scale;

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

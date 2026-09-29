import { LordArrivalOverlay } from './LordArrivalOverlay.js';
import { GrowthCeremonyController, growthCeremonies } from './GrowthCeremonyController.js';
import { saveServiceRun } from './serviceSave.js';
import { resolveThirdLordArrival } from '../engine/PendingThirdLord.js';
import { recordRunLordsMet } from '../engine/LordsMet.js';
import { hasDOMHost } from '../utils/domUI.js';

/**
 * Re-offer the lord arrival saved with a pending battle reward (the player
 * reloaded before choosing): the same candidates and the same rerolls spent, then
 * `onDone` (the rewards open next). The choice is saved before anything follows it.
 * @returns {LordArrivalOverlay}
 */
export function resumeLordArrival(scene, onDone) {
  const overlay = new LordArrivalOverlay(scene, scene.runManager, scene.gameData);
  overlay.show((unit) => {
    resolveThirdLordArrival(scene.runManager, unit);
    // The lord who arrived has joined: this save has met them.
    recordRunLordsMet(scene.registry?.get?.('meta'), scene.runManager);
    saveServiceRun(scene);
    const growth =
      unit && hasDOMHost() && GrowthCeremonyController.available() ? growthCeremonies(scene) : null;
    if (!growth) return onDone();
    void Promise.resolve(growth.showRecruit({ unit, kind: 'lord', frame: 'screen' }))
      .catch((err) => console.warn('[LordArrivalResume] join card failed:', err))
      .then(() => {
        if (scene.scene?.isActive?.() !== false) onDone();
      });
  });
  return overlay;
}

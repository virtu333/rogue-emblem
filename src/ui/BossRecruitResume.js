import { BossRecruitOverlay } from './BossRecruitOverlay.js';
import { GrowthCeremonyController, growthCeremonies } from './GrowthCeremonyController.js';
import { saveServiceRun } from './serviceSave.js';
import { resolveBossRecruit } from '../engine/PendingBossRecruit.js';
import { prepareThirdLord } from '../engine/PendingThirdLord.js';
import { recordRunLordsMet } from '../engine/LordsMet.js';
import { hasDOMHost } from '../utils/domUI.js';

/**
 * Re-offer the boss recruit draft saved with a pending battle reward (the
 * player reloaded before choosing): the same candidates, then `onDone` (the
 * rewards open next). The choice is saved before anything follows it.
 * @returns {BossRecruitOverlay}
 */
export function resumeBossRecruit(scene, onDone) {
  const overlay = new BossRecruitOverlay(scene, scene.runManager, scene.gameData);
  overlay.show((unit) => {
    resolveBossRecruit(scene.runManager, unit);
    // A lord picked here has joined: this save has met them.
    if (unit) recordRunLordsMet(scene.registry?.get?.('meta'), scene.runManager);
    // The arrival that follows a boss recruit is rolled in this same save.
    if (scene.runManager.shouldTriggerThirdLord())
      prepareThirdLord(scene.runManager, scene.gameData);
    saveServiceRun(scene);
    const growth =
      unit && hasDOMHost() && GrowthCeremonyController.available() ? growthCeremonies(scene) : null;
    if (!growth) return onDone();
    void Promise.resolve(growth.showRecruit({ unit, kind: 'boss', frame: 'screen' }))
      .catch((err) => console.warn('[BossRecruitResume] join card failed:', err))
      .then(() => {
        if (scene.scene?.isActive?.() !== false) onDone();
      });
  });
  return overlay;
}

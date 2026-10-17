import { saveRun } from '../engine/RunManager.js';
import { pushRunSave } from '../cloud/CloudSync.js';
import { recordRunDiscoveries } from '../engine/CompendiumDiscovery.js';
import { recordRunAchievements } from '../engine/AchievementFacts.js';
export function saveServiceRun(scene) {
  const cloud = scene.registry.get('cloud'),
    slot = scene.registry.get('activeSlot');
  if (!Number.isInteger(slot)) return ''; // Standalone/dev sessions have no durable slot.
  const result = saveRun(
    scene.runManager,
    cloud ? (data) => pushRunSave(cloud.userId, slot, data) : null,
    slot,
  );
  // What the run now shows (a reward's choices, a shop's stock, a purchase) has been met.
  recordRunDiscoveries(scene.registry.get('meta'), scene.runManager);
  // The achievements read the run once it is on disk (a gold hoard, a vow, a Mark...).
  if (result.ok)
    recordRunAchievements(scene.registry.get('meta'), scene.runManager, scene.gameData);
  return result.ok ? '' : ' Save failed: device storage may be full or unavailable.';
}

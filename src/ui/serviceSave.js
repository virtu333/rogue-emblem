import { saveRun } from '../engine/RunManager.js';
import { pushRunSave } from '../cloud/CloudSync.js';
import { recordRunDiscoveries } from '../engine/CompendiumDiscovery.js';
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
  return result.ok ? '' : ' Save failed: device storage may be full or unavailable.';
}

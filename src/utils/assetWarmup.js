import { markStartup } from './startupTelemetry.js';
import { retainPortraitDownloads } from '../ui/textureImageSource.js';

function isLoaded(scene, asset) {
  if (asset.type === 'image' || asset.type === 'atlas') {
    return scene.textures.exists(asset.key);
  }
  if (asset.type === 'audio') {
    return scene.cache.audio.has(asset.key);
  }
  return true;
}

function queueAsset(scene, asset) {
  if (asset.type === 'atlas') {
    scene.load.atlas(asset.key, asset.src, asset.data);
    return;
  }
  if (asset.type === 'image') {
    retainPortraitDownloads(scene.load);
    scene.load.image(asset.key, asset.src);
    return;
  }
  if (asset.type === 'audio') {
    scene.load.audio(asset.key, asset.src);
  }
}

// The warm-up runs on the loader of the scene that started it, and Phaser drops a
// loader's queue when its scene shuts down. So a scene that leaves before the warm-up is
// done hands it back (the flag clears) and the next scene that asks picks up what is
// still missing. Title starts it; the route map, Home Base and a battle pass
// `resumeOnly` and pick up only a warm-up handed back, so a dev route that skips the
// title loads nothing behind the page it opened.
export function startDeferredAssetWarmup(scene, options = {}) {
  if (typeof scene?.registry?.get !== 'function') return;
  if (scene.registry.get('deferredAssetWarmupStarted')) return;
  if (options.resumeOnly && !scene.registry.get('deferredAssetWarmupHandedBack')) return;
  const deferred = scene.registry.get('deferredAssets');
  if (!Array.isArray(deferred) || deferred.length === 0) return;

  const batchSize = Number.isFinite(options.batchSize) ? options.batchSize : 20;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 200;
  let active = true;
  scene.registry.set('deferredAssetWarmupStarted', true);
  scene.registry.set('deferredAssetWarmupHandedBack', false);
  markStartup('deferred_asset_warmup_start', { total: deferred.length, batchSize });

  const runBatch = () => {
    if (!active || !scene?.load || !scene?.cache || !scene?.textures) return;
    if (scene.load.isLoading && scene.load.isLoading()) {
      scene.time.delayedCall(delayMs, runBatch);
      return;
    }

    const pending = deferred.filter((asset) => !isLoaded(scene, asset));
    if (pending.length === 0) {
      scene.registry.set('deferredAssets', []);
      scene.registry.set('deferredAssetWarmupDone', true);
      markStartup('deferred_asset_warmup_complete');
      return;
    }

    const batch = pending.slice(0, batchSize);
    for (const asset of batch) queueAsset(scene, asset);
    markStartup('deferred_asset_batch_start', {
      count: batch.length,
      pendingBefore: pending.length,
      groups: Array.from(new Set(batch.map((a) => a.group).filter(Boolean))),
    });
    scene.load.once('complete', () => {
      markStartup('deferred_asset_batch_complete', { count: batch.length });
      scene.time.delayedCall(delayMs, runBatch);
    });
    scene.load.start();
  };

  scene.events.once('shutdown', () => {
    active = false;
    if (!scene.registry.get('deferredAssetWarmupDone')) {
      scene.registry.set('deferredAssetWarmupStarted', false);
      scene.registry.set('deferredAssetWarmupHandedBack', true);
      markStartup('deferred_asset_warmup_handed_back');
    }
  });
  runBatch();
}

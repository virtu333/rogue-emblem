import { markStartup } from './startupTelemetry.js';

function isLoaded(scene, asset) {
  if (asset.type === 'image') {
    return scene.textures.exists(asset.key);
  }
  if (asset.type === 'audio') {
    return scene.cache.audio.has(asset.key);
  }
  return true;
}

function queueAsset(scene, asset) {
  if (asset.type === 'image') {
    scene.load.image(asset.key, asset.src);
    return;
  }
  if (asset.type === 'audio') {
    scene.load.audio(asset.key, asset.src);
  }
}

export function startDeferredAssetWarmup(scene, options = {}) {
  if (!scene || scene.registry.get('deferredAssetWarmupStarted')) return;
  const deferred = scene.registry.get('deferredAssets');
  if (!Array.isArray(deferred) || deferred.length === 0) return;

  const batchSize = Number.isFinite(options.batchSize) ? options.batchSize : 20;
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 200;
  let active = true;
  scene.registry.set('deferredAssetWarmupStarted', true);
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
      groups: Array.from(new Set(batch.map(a => a.group).filter(Boolean))),
    });
    scene.load.once('complete', () => {
      markStartup('deferred_asset_batch_complete', { count: batch.length });
      scene.time.delayedCall(delayMs, runBatch);
    });
    scene.load.start();
  };

  scene.events.once('shutdown', () => {
    active = false;
  });
  runBatch();
}

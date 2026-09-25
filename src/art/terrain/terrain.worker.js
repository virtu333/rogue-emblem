// Web Worker entry: paints a battlefield off the main thread and transfers
// the pixels and the repaint buffers back (zero-copy). Loaded by canvas.js
// via `new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' })`.
import { renderBattlefieldTerrain } from './index.js';
import { packResult } from './async.js';

self.onmessage = (event) => {
  const { id, options } = event.data || {};
  try {
    const t0 = performance.now();
    const result = renderBattlefieldTerrain(options);
    const workMs = performance.now() - t0;
    const packed = packResult(result);
    const { transfer, ...message } = packed;
    self.postMessage({ id, ok: true, result: message, workMs }, transfer);
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.message || error) });
  }
};

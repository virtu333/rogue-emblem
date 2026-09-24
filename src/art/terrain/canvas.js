// Browser adapter for the procedural terrain: canvases, non-blocking
// painting (Worker first, time-sliced main thread as fallback), in-place
// repaint of a painted canvas, and the palette-cycling shimmer overlay.
// No Phaser dependency: hand the canvas to `scene.textures.addCanvas(...)`.
import {
  renderBattlefieldTerrain,
  repaintCells,
  syncTerrainLayout,
  namesFromLayout,
} from './index.js';
import { renderTerrainSliced, unpackResult } from './async.js';
import { collectShimmer, shimmerFrame } from './shimmer.js';

/** An HTMLCanvasElement when a document exists, else an OffscreenCanvas. */
export function createCanvas(width, height) {
  if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    return c;
  }
  if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(width, height);
  throw new Error('No canvas implementation available');
}

/** Copy a result (or a rectangle of it) into a canvas of the same size. */
export function putResult(canvas, result, rect = null) {
  const ctx = canvas.getContext('2d');
  const image = new ImageData(result.pixels, result.width, result.height);
  if (rect) ctx.putImageData(image, 0, 0, rect.x, rect.y, rect.width, rect.height);
  else ctx.putImageData(image, 0, 0);
  return canvas;
}

/**
 * Paint synchronously into a new canvas (tests, tools, tiny maps).
 * @returns {{canvas: HTMLCanvasElement|OffscreenCanvas, result: object}}
 */
export function paintTerrainCanvas(options) {
  const result = renderBattlefieldTerrain(options);
  const canvas = createCanvas(result.width, result.height);
  putResult(canvas, result);
  return { canvas, result };
}

// One long-lived worker: a fresh worker runs cold (interpreted) code, so
// reusing it makes every paint after the first one fast. Requests are
// serialised; an aborted request's result is simply dropped.
let workerSupported = null;
let shared = null; // { worker, pending: Map<id, {resolve, reject, t0}>, nextId }

function sharedWorker() {
  if (shared) return shared;
  if (workerSupported === false || typeof Worker !== 'function') return null;
  let worker;
  try {
    worker = new Worker(new URL('./terrain.worker.js', import.meta.url), { type: 'module' });
  } catch {
    workerSupported = false;
    return null;
  }
  const pending = new Map();
  shared = { worker, pending, nextId: 1 };
  worker.onmessage = ({ data }) => {
    const job = pending.get(data?.id);
    if (!job) return;
    pending.delete(data.id);
    if (!data.ok) return job.reject(new Error(data.error || 'Terrain worker failed'));
    workerSupported = true;
    const result = unpackResult(data.result);
    result.stats = { mode: 'worker', workMs: data.workMs, wallMs: performance.now() - job.t0 };
    job.resolve(result);
  };
  worker.onerror = (e) => {
    // Module workers unsupported / blocked: remember and fall back.
    e.preventDefault?.();
    workerSupported = false;
    const jobs = [...pending.values()];
    disposeTerrainWorker();
    for (const job of jobs)
      job.reject(Object.assign(new Error('worker-unavailable'), { fallback: true }));
  };
  return shared;
}

/** Terminate the shared terrain worker (e.g. when leaving battles for good). */
export function disposeTerrainWorker() {
  if (!shared) return;
  shared.worker.terminate();
  shared = null;
}

function paintInWorker(options, signal) {
  const w = sharedWorker();
  if (!w) return null;
  return new Promise((resolve, reject) => {
    const id = w.nextId++;
    const onAbort = () => {
      w.pending.delete(id);
      const e = new Error('Terrain painting aborted');
      e.name = 'AbortError';
      reject(e);
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
    const done = (fn) => (value) => {
      signal?.removeEventListener?.('abort', onAbort);
      fn(value);
    };
    w.pending.set(id, { resolve: done(resolve), reject: done(reject), t0: performance.now() });
    // Structured clone: only plain data crosses (names, not terrain objects).
    const names = options.names || namesFromLayout(options.mapLayout, options.terrainData);
    w.worker.postMessage({
      id,
      options: { names, biome: options.biome, seed: options.seed, cellPx: options.cellPx },
    });
  });
}

/**
 * Paint without blocking the main thread noticeably: in a module Worker when
 * possible, otherwise in <= budgetMs slices on the main thread.
 *
 * @param {object} options  { mapLayout, terrainData | names, biome, seed, cellPx }
 * @param {object} [o]
 * @param {'auto'|'worker'|'sliced'} [o.mode='auto']
 * @param {number} [o.budgetMs=8]
 * @param {AbortSignal} [o.signal]  e.g. aborted when the battle scene shuts down
 * @returns {Promise<{canvas, result}>}  result.stats describes how it ran
 */
export async function paintTerrainCanvasAsync(options, o = {}) {
  const mode = o.mode || 'auto';
  let result = null;
  if (mode !== 'sliced') {
    try {
      result = await paintInWorker(options, o.signal);
    } catch (error) {
      if (!error?.fallback || mode === 'worker') throw error;
    }
  }
  if (!result) {
    result = await renderTerrainSliced(options, o);
    result.stats.mode = 'sliced';
  }
  if (o.signal?.aborted) {
    const e = new Error('Terrain painting aborted');
    e.name = 'AbortError';
    throw e;
  }
  const canvas = createCanvas(result.width, result.height);
  putResult(canvas, result);
  return { canvas, result };
}

/**
 * Apply mid-battle terrain changes to a painted canvas: repaints the 3x3
 * neighbourhoods and uploads only those rectangles.
 * @returns {{x,y,width,height}[]} updated rectangles in canvas px
 */
export function repaintTerrainCanvas(canvas, result, cells, source) {
  const rects = repaintCells(result, cells, source);
  for (const r of rects) putResult(canvas, result, r);
  return rects;
}

/** Same as repaintTerrainCanvas, diffing a whole layout (e.g. after a snapshot restore). */
export function syncTerrainCanvas(canvas, result, mapLayout, terrainData) {
  const rects = syncTerrainLayout(result, mapLayout, terrainData);
  for (const r of rects) putResult(canvas, result, r);
  return rects;
}

export function prefersReducedMotion() {
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Palette-cycling shimmer for water glints, live lava seams / vents and acid.
 * The overlay canvas is at ART resolution (1 px per art px, i.e. the terrain
 * canvas size / result.scale); draw it over the terrain scaled by
 * result.scale with nearest filtering (Phaser: pixelArt / NEAREST). Only
 * animated pixels are opaque. Returns null when reduced motion is requested
 * or nothing on the map animates.
 *
 * @param {object} result
 * @param {object} [o]
 * @param {number} [o.fps=8]          palette steps are 180-300 ms, 8 fps is plenty
 * @param {boolean} [o.reducedMotion] default: the OS preference
 * @param {(canvas) => void} [o.onFrame] called after each changed frame (e.g. texture.refresh())
 */
export function createShimmerOverlay(result, o = {}) {
  if (o.reducedMotion ?? prefersReducedMotion()) return null;
  const S = result.state;
  let shimmer = collectShimmer(S);
  if (!shimmer.count) return null;
  const canvas = createCanvas(S.W, S.H);
  const ctx = canvas.getContext('2d');
  let image = new ImageData(S.W, S.H);
  let out32 = new Uint32Array(image.data.buffer);
  const frameMs = 1000 / (o.fps ?? 8);
  let raf = 0,
    last = -Infinity,
    running = false;
  const draw = (t) => {
    const changed = shimmerFrame(shimmer, out32, t);
    if (!changed) return 0;
    const b = shimmer.bounds;
    ctx.putImageData(image, 0, 0, b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0);
    o.onFrame?.(canvas);
    return changed;
  };
  const tick = (t) => {
    if (!running) return;
    raf = requestAnimationFrame(tick);
    // Nothing animates while hidden (art bible); rAF also pauses itself.
    if (globalThis.document?.hidden) return;
    if (t - last < frameMs) return;
    last = t;
    draw(t);
  };
  draw(0);
  return {
    canvas,
    get count() {
      return shimmer.count;
    },
    start() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    },
    stop() {
      running = false;
      cancelAnimationFrame(raf);
    },
    /** Re-collect after repaintCells (animated pixels may have changed). */
    refresh() {
      shimmer = collectShimmer(S);
      image = new ImageData(S.W, S.H);
      out32 = new Uint32Array(image.data.buffer);
      ctx.clearRect(0, 0, S.W, S.H);
      draw(performance.now());
    },
    /** Render one frame at time t (ms) and return how many pixels changed. */
    frame(t) {
      return draw(t);
    },
    destroy() {
      this.stop();
      shimmer = {
        count: 0,
        index: new Int32Array(0),
        cls: new Uint8Array(0),
        phase: new Uint16Array(0),
        bounds: null,
      };
    },
  };
}

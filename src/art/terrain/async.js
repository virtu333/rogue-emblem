// Non-blocking painting without a DOM: time-sliced rendering on the calling
// thread (any environment) and rehydration of a result painted elsewhere
// (a Worker). The browser-specific pieces live in canvas.js.
import { createTerrainJob } from './index.js';
import { TerrainState } from './state.js';

/** Buffers that make a state repaintable; everything else is rebuilt lazily. */
export const STATE_BUFFERS = Object.freeze([
  'matRaw',
  'mat1',
  'mat',
  'dU',
  'dD',
  'dL',
  'dR',
  'shadow',
  'anim',
  'idx',
  'owner',
]);

const defaultYield = () =>
  new Promise((resolve) => {
    if (typeof MessageChannel === 'function') {
      // a macrotask that is not clamped like nested setTimeout(0)
      const ch = new MessageChannel();
      ch.port1.onmessage = () => {
        ch.port1.close();
        resolve();
      };
      ch.port2.postMessage(0);
    } else setTimeout(resolve, 0);
  });

/**
 * Paint in slices of at most ~budgetMs of work, yielding to the event loop
 * between slices so input and animation stay responsive at battle start.
 *
 * @param {object} options  same as renderBattlefieldTerrain
 * @param {object} [o]
 * @param {number} [o.budgetMs=8]   work per slice before yielding
 * @param {number} [o.bandCells=1]  rows of cells per work unit
 * @param {AbortSignal} [o.signal]  abort -> rejects with an AbortError
 * @param {() => Promise<void>} [o.yieldFn]  custom scheduler (tests)
 * @param {() => number} [o.now]
 * @returns {Promise<object>} the same result as renderBattlefieldTerrain, plus
 *   `stats: { slices, units, maxSliceMs, p95SliceMs, workMs, wallMs }`
 */
export async function renderTerrainSliced(options, o = {}) {
  const budget = o.budgetMs ?? 8;
  const now = o.now || (() => globalThis.performance?.now?.() ?? Date.now());
  const yieldFn = o.yieldFn || defaultYield;
  const job = createTerrainJob(options);
  const steps = job.steps(o.bandCells ?? 1);
  const t0 = now();
  const sliceMs = [];
  let slices = 0,
    units = 0,
    maxSlice = 0,
    work = 0,
    done = false;
  while (!done) {
    if (o.signal?.aborted) throw abortError();
    const s0 = now();
    do {
      done = steps.next().done;
      if (!done) units++;
    } while (!done && now() - s0 < budget);
    const dt = now() - s0;
    sliceMs.push(dt);
    work += dt;
    maxSlice = Math.max(maxSlice, dt);
    slices++;
    if (!done) await yieldFn();
  }
  const f0 = now();
  const result = job.finish();
  const finishMs = now() - f0;
  sliceMs.sort((a, b) => a - b);
  result.stats = {
    p95SliceMs: sliceMs[Math.min(sliceMs.length - 1, Math.floor(sliceMs.length * 0.95))] || 0,
    slices,
    units,
    maxSliceMs: Math.max(maxSlice, finishMs),
    workMs: work + finishMs,
    wallMs: now() - t0,
  };
  return result;
}

function abortError() {
  const e = new Error('Terrain painting aborted');
  e.name = 'AbortError';
  return e;
}

/** Serialise a result's state for postMessage (buffers are transferable). */
export function packResult(result) {
  const S = result.state;
  const buffers = {};
  for (const k of STATE_BUFFERS) buffers[k] = S[k];
  return {
    width: result.width,
    height: result.height,
    cellPx: result.cellPx,
    scale: result.scale,
    cols: result.cols,
    rows: result.rows,
    biome: result.biome,
    seed: result.seed,
    pixels: result.pixels,
    names: S.names,
    buffers,
    transfer: [result.pixels.buffer, ...STATE_BUFFERS.map((k) => S[k].buffer)],
  };
}

/** Rebuild a repaintable result from packResult() output. */
export function unpackResult(packed) {
  const state = new TerrainState({ names: packed.names, biome: packed.biome, seed: packed.seed });
  for (const k of STATE_BUFFERS) {
    const src = packed.buffers[k];
    if (!src || src.length !== state[k].length) throw new Error(`Bad terrain buffer ${k}`);
    state[k] = src;
  }
  state.rendered = true;
  const { buffers: _b, names: _n, transfer: _t, ...rest } = packed;
  return { ...rest, state };
}

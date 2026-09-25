// LoopedMusic — a Web Audio music voice with an intro, a seamless loop region
// and optional synchronized layers (e.g. the "calm" and "full" mixes of an
// adaptive battle theme).
//
// It mimics the slice of Phaser's sound API that AudioManager relies on
// (key, loop, isPlaying, volume, play, stop, destroy, setVolume) so the
// manager's ownership, fade and watchdog logic keeps working unchanged.
//
// Every layer is started at the same context time with the same loop points,
// so switching layers is a sample-aligned crossfade of gains: the music never
// restarts or drifts.

export const LOOP_DURATION_TOLERANCE_S = 0.25;

/**
 * Loop points are only trusted when the decoded buffer is the file they were
 * computed for (a stale cached track from an older build would otherwise loop
 * an arbitrary slice of the wrong audio).
 */
export function validLoopFor(buffer, loop) {
  if (!buffer || !loop) return null;
  const { loopStart, loopEnd, duration } = loop;
  if (!(Number.isFinite(loopStart) && Number.isFinite(loopEnd) && loopEnd > loopStart)) {
    return null;
  }
  const bufDuration = Number(buffer.duration);
  if (!Number.isFinite(bufDuration) || loopEnd > bufDuration) return null;
  if (Number.isFinite(duration) && Math.abs(bufDuration - duration) > LOOP_DURATION_TOLERANCE_S) {
    return null;
  }
  return { loopStart, loopEnd };
}

const LOOP_POINT_TOLERANCE_S = 0.001;

/** Freeze an AudioParam at its current value so a new ramp starts from there. */
function holdAt(param, now) {
  if (typeof param.cancelAndHoldAtTime === 'function') {
    param.cancelAndHoldAtTime(now);
  } else {
    const current = param.value;
    param.cancelScheduledValues?.(now);
    param.setValueAtTime(current, now);
  }
}

/**
 * A secondary layer can play alongside the primary only if it is the same
 * length and loops over the same region: it must fit the primary's loop, and
 * any valid loop points of its own must match it. A layer with no usable loop
 * entry of its own inherits the primary's when its buffer fits.
 */
export function sharesTimeline(buffer, loop, primaryBuffer, primaryLoop) {
  const dur = Number(buffer?.duration);
  const primaryDur = Number(primaryBuffer?.duration);
  if (!Number.isFinite(dur) || !Number.isFinite(primaryDur)) return false;
  if (Math.abs(dur - primaryDur) > LOOP_DURATION_TOLERANCE_S) return false;
  if (!primaryLoop) return !loop;
  if (primaryLoop.loopEnd > dur) return false;
  if (!loop) return true;
  return (
    Math.abs(loop.loopStart - primaryLoop.loopStart) <= LOOP_POINT_TOLERANCE_S &&
    Math.abs(loop.loopEnd - primaryLoop.loopEnd) <= LOOP_POINT_TOLERANCE_S
  );
}

export class LoopedMusic {
  /**
   * @param {object} opts
   * @param {AudioContext} opts.context
   * @param {AudioNode} opts.destination
   * @param {string} opts.key            music key (the primary layer)
   * @param {Object<string, AudioBuffer>} opts.layers  layer name -> buffer ('full' required)
   * @param {Object<string, object>} [opts.loops]      layer name -> loop entry
   * @param {string} [opts.layer]        initially audible layer
   * @param {number} [opts.volume]
   */
  constructor({ context, destination, key, layers, loops = {}, layer = 'full', volume = 1 }) {
    this.context = context;
    this.destination = destination;
    this.key = key;
    this.loop = true;
    this.config = { loop: true };
    this.volume = volume;
    this.isPlaying = false;
    this.isPaused = false;
    this.pendingRemove = false;
    this._destroyed = false;
    this._layers = new Map();
    this._startTime = null;

    this._out = context.createGain();
    this._out.gain.value = volume;
    // Ducking has its own stage so it never fights the volume fades on _out.
    this._duck = context.createGain();
    this._duck.gain.value = 1;
    this._out.connect(this._duck);
    this._duck.connect(destination);

    const given = Object.keys(layers).filter((n) => layers[n]);
    const primaryName = given.includes('full') ? 'full' : given[0];
    const primaryLoop = validLoopFor(layers[primaryName], loops[primaryName]);
    // Every layer loops with the primary's region; a layer that can't share it
    // (e.g. a stale cached file) is dropped and the primary plays alone.
    const names = given.filter(
      (n) =>
        n === primaryName ||
        sharesTimeline(
          layers[n],
          validLoopFor(layers[n], loops[n]),
          layers[primaryName],
          primaryLoop,
        ),
    );
    this.layer = names.includes(layer) ? layer : primaryName;
    for (const name of names) {
      const gain = context.createGain();
      gain.gain.value = name === this.layer ? 1 : 0;
      gain.connect(this._out);
      this._layers.set(name, { buffer: layers[name], loop: primaryLoop, gain, source: null });
    }
  }

  get layerNames() {
    return Array.from(this._layers.keys());
  }

  hasLayer(name) {
    return this._layers.has(name);
  }

  play() {
    if (this._destroyed || this.isPlaying) return false;
    // All layers share one start time; a small lead keeps them sample-aligned
    // even if creating the sources takes a moment.
    const when = this.context.currentTime + 0.03;
    for (const entry of this._layers.values()) {
      const source = this.context.createBufferSource();
      source.buffer = entry.buffer;
      source.loop = true;
      if (entry.loop) {
        source.loopStart = entry.loop.loopStart;
        source.loopEnd = entry.loop.loopEnd;
      }
      source.connect(entry.gain);
      source.start(when, 0);
      entry.source = source;
    }
    this._startTime = when;
    this.isPlaying = true;
    return true;
  }

  stop() {
    for (const entry of this._layers.values()) {
      if (!entry.source) continue;
      try {
        entry.source.stop();
      } catch (_) {}
      try {
        entry.source.disconnect();
      } catch (_) {}
      entry.source = null;
    }
    this.isPlaying = false;
    return true;
  }

  destroy() {
    if (this._destroyed) return;
    this.stop();
    for (const entry of this._layers.values()) {
      try {
        entry.gain.disconnect();
      } catch (_) {}
    }
    try {
      this._out.disconnect();
    } catch (_) {}
    try {
      this._duck.disconnect();
    } catch (_) {}
    this._layers.clear();
    this._destroyed = true;
    this.pendingRemove = true;
  }

  setVolume(value) {
    const v = Math.max(0, Number(value) || 0);
    this.volume = v;
    const param = this._out.gain;
    const now = this.context.currentTime;
    // Short smoothing so per-frame fade updates never zipper.
    if (typeof param.setTargetAtTime === 'function') {
      param.cancelScheduledValues?.(now);
      param.setTargetAtTime(v, now, 0.015);
    } else {
      param.value = v;
    }
    return this;
  }

  /**
   * Lower the music under a stinger: ramp to `level` over `attack` seconds,
   * hold it `hold` seconds, then return to full over `release` seconds.
   * A later duck or unduck replaces the pending envelope.
   */
  duck(level, { attack = 0.08, hold = 0, release = 0.8 } = {}) {
    if (this._destroyed) return false;
    const target = Math.max(0, Math.min(1, Number(level)));
    if (!Number.isFinite(target)) return false;
    const param = this._duck.gain;
    const now = this.context.currentTime;
    holdAt(param, now);
    const down = now + Math.max(0.005, attack);
    param.linearRampToValueAtTime(target, down);
    if (hold > 0 || release > 0) {
      const up = down + Math.max(0, hold);
      param.setValueAtTime(target, up);
      param.linearRampToValueAtTime(1, up + Math.max(0.005, release));
    }
    return true;
  }

  /** Bring a ducked track back to full over `release` seconds. */
  unduck(release = 0.4) {
    if (this._destroyed) return false;
    const param = this._duck.gain;
    const now = this.context.currentTime;
    holdAt(param, now);
    param.linearRampToValueAtTime(1, now + Math.max(0.005, release));
    return true;
  }

  /** Crossfade to another layer over fadeMs (equal-gain: the layers share material). */
  setLayer(name, fadeMs = 1500) {
    if (!this._layers.has(name) || this._destroyed) return false;
    if (name === this.layer) return false;
    this.layer = name;
    const now = this.context.currentTime;
    const dur = Math.max(0, fadeMs) / 1000;
    for (const [layerName, entry] of this._layers) {
      const target = layerName === name ? 1 : 0;
      const param = entry.gain.gain;
      if (dur > 0 && typeof param.linearRampToValueAtTime === 'function') {
        // Hold wherever an earlier crossfade had got to, then ramp from there.
        holdAt(param, now);
        param.linearRampToValueAtTime(target, now + dur);
      } else {
        param.cancelScheduledValues?.(now);
        param.value = target;
      }
    }
    return true;
  }
}

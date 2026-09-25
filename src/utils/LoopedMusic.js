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
    this._out.connect(destination);

    const names = Object.keys(layers).filter((n) => layers[n]);
    this.layer = names.includes(layer) ? layer : names.includes('full') ? 'full' : names[0];
    for (const name of names) {
      const gain = context.createGain();
      gain.gain.value = name === this.layer ? 1 : 0;
      gain.connect(this._out);
      this._layers.set(name, {
        buffer: layers[name],
        loop: validLoopFor(layers[name], loops[name]),
        gain,
        source: null,
      });
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
    // Layers only stay aligned if they loop identically; a layer whose loop
    // points don't validate falls back to the primary layer's.
    const primary = this._layers.get('full') || this._layers.values().next().value;
    for (const entry of this._layers.values()) {
      const source = this.context.createBufferSource();
      source.buffer = entry.buffer;
      source.loop = true;
      const loop = entry.loop || primary?.loop;
      if (loop) {
        source.loopStart = loop.loopStart;
        source.loopEnd = loop.loopEnd;
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
        if (typeof param.cancelAndHoldAtTime === 'function') {
          param.cancelAndHoldAtTime(now);
        } else {
          const current = param.value;
          param.cancelScheduledValues?.(now);
          param.setValueAtTime(current, now);
        }
        param.linearRampToValueAtTime(target, now + dur);
      } else {
        param.cancelScheduledValues?.(now);
        param.value = target;
      }
    }
    return true;
  }
}

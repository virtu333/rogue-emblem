// StingerPlayer — one-shot musical cues (level up, promotion, boss cards...).
//
// Stingers are short files from assets/audio/stingers/, decoded into a small
// LRU of AudioBuffers kept apart from the music cache (a stinger must never
// evict a music track) and played straight through Web Audio so a skipped
// ceremony can fade its cue out instead of cutting it.

export const STINGER_FADE_MS = 140;

export class StingerPlayer {
  /**
   * @param {object} opts
   * @param {() => AudioContext|null} opts.getContext
   * @param {() => AudioNode|null} opts.getDestination
   * @param {(key: string) => Promise<AudioBuffer>} opts.loadBuffer  fetch + decode one file
   * @param {number} [opts.maxCached]  decoded stingers kept in memory
   */
  constructor({ getContext, getDestination, loadBuffer, maxCached = 10 }) {
    this._getContext = getContext;
    this._getDestination = getDestination;
    this._loadBuffer = loadBuffer;
    this.maxCached = maxCached;
    this._buffers = new Map(); // key -> AudioBuffer, in LRU order (oldest first)
    this._loading = new Map(); // key -> Promise<AudioBuffer>
    this._voices = new Set();
    this._pinned = new Set(); // keys the LRU never evicts (the current key's ceremony cues)
  }

  /**
   * Keep these decoded stingers resident (replaces the previous pins). The
   * common ceremony cues are pinned in the current track's key, so a burst of
   * other cues (boss cards, arrivals...) can never evict the level-up cue and
   * leave a level-up to its fallback sound.
   */
  pin(keys = []) {
    this._pinned = new Set((keys || []).filter(Boolean));
    this._evict();
  }

  isPinned(key) {
    return this._pinned.has(key);
  }

  has(key) {
    return this._buffers.has(key);
  }

  get playing() {
    return this._voices.size > 0;
  }

  /** Decode a stinger into the cache (deduplicated; resolves to the buffer). */
  load(key) {
    if (!key) return Promise.reject(new Error('no-stinger-key'));
    if (this._buffers.has(key)) {
      this._touch(key);
      return Promise.resolve(this._buffers.get(key));
    }
    if (this._loading.has(key)) return this._loading.get(key);
    const promise = Promise.resolve()
      .then(() => this._loadBuffer(key))
      .then((buffer) => {
        if (!buffer) throw new Error(`stinger-empty:${key}`);
        this._buffers.set(key, buffer);
        this._evict();
        return buffer;
      })
      .finally(() => this._loading.delete(key));
    this._loading.set(key, promise);
    return promise;
  }

  /**
   * Start a cached stinger at `volume` (linear gain). Returns a voice with
   * stop(fadeMs), or null when the file isn't decoded yet or audio is off.
   */
  play(key, { volume = 1 } = {}) {
    const buffer = this._buffers.get(key);
    const context = this._getContext?.();
    const destination = this._getDestination?.();
    if (!buffer || !context || !destination || !(volume > 0)) return null;
    if (typeof context.createBufferSource !== 'function') return null;
    this._touch(key);
    const gain = context.createGain();
    gain.gain.value = volume;
    gain.connect(destination);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(gain);
    // startTime: the context time the cue began (a hinge cue schedules the next
    // track from it)
    const voice = { key, source, gain, stopped: false, stop: null, startTime: null };
    const finish = () => {
      if (voice.stopped) return;
      voice.stopped = true;
      this._voices.delete(voice);
      try {
        source.disconnect();
      } catch (_) {}
      try {
        gain.disconnect();
      } catch (_) {}
    };
    source.onended = finish;
    voice.stop = (fadeMs = STINGER_FADE_MS) => {
      if (voice.stopped) return;
      const now = context.currentTime;
      const fade = Math.max(0, fadeMs) / 1000;
      const param = gain.gain;
      try {
        if (fade > 0 && typeof param.linearRampToValueAtTime === 'function') {
          param.cancelScheduledValues?.(now);
          param.setValueAtTime(param.value, now);
          param.linearRampToValueAtTime(0, now + fade);
          source.stop(now + fade + 0.02);
        } else {
          source.stop();
        }
      } catch (_) {
        finish();
      }
    };
    this._voices.add(voice);
    voice.startTime = Number(context.currentTime) || 0;
    source.start(voice.startTime);
    return voice;
  }

  /** Fade out every sounding stinger. */
  stopAll(fadeMs = STINGER_FADE_MS) {
    for (const voice of Array.from(this._voices)) voice.stop(fadeMs);
  }

  /** Drop every decoded buffer that isn't playing. */
  clear() {
    const busy = new Set(Array.from(this._voices, (v) => v.key));
    for (const key of Array.from(this._buffers.keys())) {
      if (!busy.has(key)) this._buffers.delete(key);
    }
  }

  _touch(key) {
    const buffer = this._buffers.get(key);
    if (!buffer) return;
    this._buffers.delete(key);
    this._buffers.set(key, buffer);
  }

  _evict() {
    const busy = new Set(Array.from(this._voices, (v) => v.key));
    for (const key of Array.from(this._buffers.keys())) {
      if (this._buffers.size <= this.maxCached) break;
      if (!busy.has(key) && !this._pinned.has(key)) this._buffers.delete(key);
    }
  }
}

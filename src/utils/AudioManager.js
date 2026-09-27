// AudioManager - lightweight wrapper around Phaser's sound manager.

import { LoopedMusic } from './LoopedMusic.js';
import { STINGER_PRELOAD, getMusicLayers, getMusicLoop } from './musicConfig.js';
import { MUSIC_STINGERS } from './musicStingers.js';
import { STINGER_FADE_MS, StingerPlayer } from './StingerPlayer.js';

// A cue not decoded yet may take this long to decode before its fallback plays
// (from prefetched bytes it takes a fraction of this; see prefetchStingers).
export const STINGER_MIN_WAIT_MS = 700;
// Compressed stinger files kept in memory (about 90 KB each).
const STINGER_BYTES_MAX = 48;

function isDecodedAudioBuffer(buffer) {
  return Boolean(
    buffer && typeof buffer.getChannelData === 'function' && Number.isFinite(buffer.duration),
  );
}

const MUSIC_INTENSITIES = ['calm', 'full', 'enrage'];

export class AudioManager {
  constructor(soundManager, options = {}) {
    this.sound = soundManager;
    this.currentMusic = null;
    this.currentMusicKey = null;
    this.currentMusicOwner = null;
    this.musicVolume = 0.5;
    this.sfxVolume = 0.7;
    this.debugMusic = false;
    this.loadingMusic = new Map();
    this._musicRequestSeq = 0;
    this._musicCacheLru = [];
    this.maxCachedMusicTracks = this._toPositiveInt(options.maxCachedMusicTracks, 4);
    // Decoded PCM is what costs memory (a 90 s stereo track is ~35 MB), so the
    // cache also answers to a byte budget. 0 disables it.
    this.maxCachedMusicBytes =
      this._toPositiveInt(options.maxCachedMusicMegabytes, 0) * 1024 * 1024;
    this.musicLoadTimeoutMs = this._toPositiveInt(options.musicLoadTimeoutMs, 7000);
    this.mobileMusicLoadTimeoutMs = this._toPositiveInt(options.mobileMusicLoadTimeoutMs, 12000);
    this.isMobile = Boolean(options.isMobile);
    this._trackedMusicSounds = new Set();
    // Adaptive tracks: which layer ('calm' | 'full') new and current music plays.
    this.musicIntensity = 'full';
    this.currentMusicLayerKeys = [];
    // Primary + layer keys of the newest playMusic request still loading. The
    // cache budget must keep them: loading one layer can't evict its siblings.
    this._pendingMusicKeys = [];
    // Layers being reloaded for the playing voice (see _restoreMissingLayer).
    this._restoringMusicKeys = new Set();
    // One-shot cues (level up, promotion, boss cards) in the current track's key.
    this.stingers = new StingerPlayer({
      getContext: () => (this._canUseLoopedMusic() ? this.sound.context : null),
      getDestination: () => this.sound?.destination || this.sound?.context?.destination || null,
      loadBuffer: (key) => this._fetchAndDecodeStinger(key),
      maxCached: this._toPositiveInt(options.maxCachedStingers, 10),
    });
    this._stingerSeq = 0;
    // key -> ArrayBuffer (compressed, LRU order) and key -> Promise while fetching
    this._stingerBytes = new Map();
    this._stingerFetches = new Map();
  }

  /** Convert linear slider value (0-1) to perceptual volume via quadratic curve. */
  _curve(linear) {
    return linear * linear;
  }

  /**
   * Play looping background music with optional fade-in. `layers` adds layers
   * beyond the track's own (a boss's enrage layer: { enrage: key }); those
   * named in `layerGains` are additive, sounding at their own level alongside
   * the mix (see setMusicLayerGain). `startAt` (a Web Audio context time)
   * schedules the start, e.g. on the downbeat a hinge cue hands over to.
   */
  async playMusic(
    key,
    ownerOrScene,
    fadeMs = 500,
    { layers = null, layerGains = null, startAt = null } = {},
  ) {
    let pendingKeys = null;
    try {
      if (!key) return;
      const owner = this._resolveOwnerToken(ownerOrScene);
      const scene = this._resolveSceneContext(ownerOrScene);

      if (this.currentMusicKey === key && this.currentMusic?.isPlaying) {
        // If duplicate/stray looping tracks exist, recover by forcing a clean restart.
        const active = this._getLoopingMusicSounds();
        const hasOverlap = active.some((sound) => sound !== this.currentMusic);
        if (!hasOverlap) {
          // Invalidate any in-flight load for a DIFFERENT track: "keep playing
          // X" must supersede an older "switch to Y" request still loading,
          // or Y lands later and replaces X (rapid shop open/close race).
          this._musicRequestSeq++;
          // Transfer ownership to the latest requester so its later
          // stop/release calls aren't blocked by a stale owner, and the
          // track continues seamlessly across scene hops sharing it.
          if (owner) this.currentMusicOwner = owner;
          return;
        }
        this.stopAllMusic(scene, 0);
      }

      const requestSeq = ++this._musicRequestSeq;

      // Defer if audio context is locked (browser autoplay policy)
      if (this.sound.locked) {
        this._pendingMusic = { key, ownerOrScene, fadeMs, layers, layerGains };
        if (!this._unlockListenerAdded) {
          this._unlockListenerAdded = true;
          this.sound.once('unlocked', () => {
            this._unlockListenerAdded = false;
            if (this._pendingMusic) {
              const p = this._pendingMusic;
              this._pendingMusic = null;
              void this.playMusic(p.key, p.ownerOrScene, p.fadeMs, {
                layers: p.layers,
                layerGains: p.layerGains,
              });
            }
          });
        }
        return;
      }

      const cache = this.sound.game.cache.audio;
      // Every buffer this track plays from: the budget keeps all of them while
      // they load and until the new voice holds them.
      const layerKeys = this._layerKeysFor(key, layers);
      pendingKeys = [key, ...layerKeys];
      this._pendingMusicKeys = pendingKeys;

      if (!cache.has(key)) {
        try {
          await this._ensureMusicLoaded(key, scene);
        } catch (_) {
          return;
        }
      }
      // Adaptive tracks also need their other layers; a layer that fails to
      // load just leaves the track single-layered (it can join later, see
      // setMusicIntensity).
      if (layerKeys.length > 0 && this._canUseLoopedMusic()) {
        await Promise.allSettled(
          layerKeys.filter((k) => !cache.has(k)).map((k) => this._ensureMusicLoaded(k, scene)),
        );
      }

      // A newer request started while this one was loading.
      if (requestSeq !== this._musicRequestSeq) return;

      // The primary should still be cached (the budget preserves pending keys),
      // but if anything removed it, keep the old music rather than stopping it
      // for a track that can't start.
      if (!cache.has(key)) return;

      // Defensive stop: clear any orphan looping music before starting new track.
      this.stopAllMusic(scene, 0);

      this._touchMusicCacheKey(key);
      for (const layerKey of layerKeys) {
        if (cache.has(layerKey)) this._touchMusicCacheKey(layerKey);
      }
      this._enforceMusicCacheBudget({ preserveKeys: pendingKeys });

      // iOS can leave the shared Web Audio context suspended/interrupted after a
      // backgrounding even when Phaser still reports unlocked — nudge it running.
      const audioCtx = this.sound.context;
      if (audioCtx && audioCtx.state !== 'running') {
        audioCtx.resume?.().catch(() => {});
      }

      this.currentMusic = this._createMusicSound(
        key,
        fadeMs > 0 ? 0 : this._curve(this.musicVolume),
        layers,
        layerGains,
      );
      this.currentMusicKey = key;
      this.currentMusicOwner = owner;
      this._trackMusicSound(this.currentMusic);
      if (Number.isFinite(startAt) && this.currentMusic instanceof LoopedMusic) {
        this.currentMusic.play(startAt);
      } else {
        this.currentMusic.play();
      }
      // The voice now holds its buffers (and is protected as live); a layer it
      // dropped (off the primary's timeline) no longer needs to be kept.
      if (this._pendingMusicKeys === pendingKeys) {
        this._pendingMusicKeys = [];
        this._enforceMusicCacheBudget();
      }
      // The common ceremony cues, decoded ahead in this track's key and kept
      // resident while it plays (a level-up must never fall back to its SFX);
      // every other cue fetched ahead, so none of them waits on the network.
      this.preloadStingers(STINGER_PRELOAD, null, { pin: true });
      this.prefetchStingers(Object.keys(MUSIC_STINGERS));

      if (fadeMs > 0 && scene?.tweens) {
        this._tweenSoundVolume(scene, this.currentMusic, 0, 1, fadeMs);
      }
    } catch (err) {
      // Never surface async audio errors to scene callers (fire-and-forget usage).
      if (this.debugMusic) console.warn('[AudioManager] playMusic failed:', key, err);
    } finally {
      if (pendingKeys && this._pendingMusicKeys === pendingKeys) this._pendingMusicKeys = [];
    }
  }

  // --- Seamless loops and adaptive layers ---

  _canUseLoopedMusic() {
    const ctx = this.sound?.context;
    return Boolean(
      ctx && typeof ctx.createBufferSource === 'function' && typeof ctx.createGain === 'function',
    );
  }

  /** Layer name -> key for a track: its own adaptive layers plus any requested extras. */
  _layerMapFor(key, extra = null) {
    const own = getMusicLayers(key);
    const more = extra && typeof extra === 'object' ? extra : null;
    if (!own && !more) return null;
    return { ...(own || {}), ...(more || {}), full: key };
  }

  _layerKeysFor(key, extra = null) {
    const layers = this._layerMapFor(key, extra);
    if (!layers) return [];
    return Object.entries(layers)
      .filter(([name]) => name !== 'full')
      .map(([, layerKey]) => layerKey);
  }

  /**
   * A Web Audio voice with the track's intro + seamless loop region (and its
   * adaptive layers) when the decoded buffer and loop points are available;
   * otherwise a plain Phaser looping sound.
   */
  _createMusicSound(key, volume, extraLayers = null, layerGains = null) {
    const cache = this.sound.game.cache.audio;
    const buffer = typeof cache.get === 'function' ? cache.get(key) : null;
    const loop = getMusicLoop(key);
    const layerMap = this._layerMapFor(key, extraLayers);
    this.currentMusicLayerKeys = [];
    if (this._canUseLoopedMusic() && isDecodedAudioBuffer(buffer) && (loop || layerMap)) {
      const layers = { full: buffer };
      const loops = { full: loop };
      for (const [name, layerKey] of Object.entries(layerMap || {})) {
        if (name === 'full') continue;
        const layerBuffer = cache.get(layerKey);
        if (!isDecodedAudioBuffer(layerBuffer)) continue;
        layers[name] = layerBuffer;
        loops[name] = getMusicLoop(layerKey);
      }
      try {
        const music = new LoopedMusic({
          context: this.sound.context,
          destination: this.sound.destination || this.sound.context.destination,
          key,
          layers,
          loops,
          keys: { ...(layerMap || {}), full: key },
          layer: layers[this.musicIntensity] ? this.musicIntensity : 'full',
          layerGains: layerGains || {},
          volume,
        });
        // The layers the voice actually kept (one off the primary's timeline is dropped).
        this.currentMusicLayerKeys = music.bufferKeys.filter((k) => k !== key);
        for (const layerKey of this.currentMusicLayerKeys) this._touchMusicCacheKey(layerKey);
        return music;
      } catch (err) {
        if (this.debugMusic) console.warn('[AudioManager] looped music failed:', key, err);
        this.currentMusicLayerKeys = [];
      }
    }
    return this.sound.add(key, { loop: true, volume });
  }

  /**
   * Choose the layer of layered music: 'calm' (map, no fighting), 'full'
   * (combat) or 'enrage' (a boss's enrage layer). Applies to the current track
   * with a crossfade, and to the next layered track that starts; a track
   * without that layer plays its full mix.
   */
  setMusicIntensity(level, fadeMs = 1500) {
    this.musicIntensity = MUSIC_INTENSITIES.includes(level) ? level : 'full';
    const music = this.currentMusic;
    if (music && typeof music.setLayer === 'function') {
      if (music.hasLayer?.(this.musicIntensity)) music.setLayer(this.musicIntensity, fadeMs);
      // The track wants this layer but has no buffer for it: keep playing the
      // current layer and bring the missing one in once it's decoded.
      else this._restoreMissingLayer(music, this.musicIntensity, fadeMs);
    }
    return this.musicIntensity;
  }

  /** One reload attempt per voice and layer; the layer joins on the running timeline. */
  _restoreMissingLayer(music, name, fadeMs) {
    const layerKey = music?.layerKeys?.[name];
    if (!layerKey || typeof music.addLayer !== 'function' || !music.isPlaying) return;
    if (!this._canUseLoopedMusic()) return;
    if (!music.__layerRestores) music.__layerRestores = new Set();
    if (music.__layerRestores.has(name)) return;
    music.__layerRestores.add(name);
    const cache = this.sound.game.cache.audio;
    // Pinned from load until the voice holds it, so the budget can't take it back.
    this._restoringMusicKeys.add(layerKey);
    const attach = () => {
      this._restoringMusicKeys.delete(layerKey);
      if (this.currentMusic !== music || !music.isPlaying || music.hasLayer(name)) return;
      const buffer = cache.get(layerKey);
      if (!isDecodedAudioBuffer(buffer)) return;
      if (!music.addLayer(name, buffer, getMusicLoop(layerKey), layerKey)) return;
      if (!this.currentMusicLayerKeys.includes(layerKey)) this.currentMusicLayerKeys.push(layerKey);
      this._touchMusicCacheKey(layerKey);
      if (this.musicIntensity === name) music.setLayer(name, fadeMs);
    };
    if (cache.has(layerKey)) {
      attach();
      return;
    }
    this._ensureMusicLoaded(layerKey, null).then(attach, (err) => {
      this._restoringMusicKeys.delete(layerKey);
      if (this.debugMusic) console.warn('[AudioManager] layer reload failed:', layerKey, err);
    });
  }

  getMusicIntensity() {
    return this.musicIntensity;
  }

  /** The Web Audio clock (seconds), or null without Web Audio. */
  audioTime() {
    const t = Number(this.sound?.context?.currentTime);
    return this._canUseLoopedMusic() && Number.isFinite(t) ? t : null;
  }

  /** Level (0-1) of an additive layer of the current track, over fadeMs. */
  setMusicLayerGain(name, gain, fadeMs = 800) {
    const music = this.currentMusic;
    if (!music || typeof music.setLayerGain !== 'function') return false;
    return music.setLayerGain(name, gain, fadeMs);
  }

  /** Decode tracks ahead of use (fire-and-forget), e.g. a finale waiting on a trigger. */
  preloadMusic(keys, ownerOrScene = null) {
    const scene = this._resolveSceneContext(ownerOrScene);
    for (const key of keys || []) {
      if (!key || this.sound?.game?.cache?.audio?.has?.(key)) continue;
      this._ensureMusicLoaded(key, scene)
        .then(() => this._touchMusicCacheKey(key))
        .catch(() => {});
    }
  }

  // --- Stingers: one-shot cues in the key of the music under them ---

  /** File key of stinger `name` in `tonic` (default: the current track's key). */
  stingerKeyFor(name, tonic = null) {
    const entry = MUSIC_STINGERS[name];
    if (!entry) return null;
    if (!entry.keyed) return `stinger_${name}`;
    const want = tonic || getMusicLoop(this.currentMusicKey)?.tonic || 'D';
    const pick = entry.tonics.includes(want)
      ? want
      : entry.tonics.includes('D')
        ? 'D'
        : entry.tonics[0];
    return pick ? `stinger_${name}_${pick}` : null;
  }

  /**
   * Decode stingers ahead of use (fire-and-forget). `pin` keeps exactly these
   * keys resident (the previous pins are released).
   */
  preloadStingers(names, tonic = null, { pin = false } = {}) {
    if (!this._canUseLoopedMusic()) return;
    const keys = [];
    for (const name of names || []) {
      const key = this.stingerKeyFor(name, tonic);
      if (!key) continue;
      keys.push(key);
      if (!this.stingers.has(key)) this.stingers.load(key).catch(() => {});
    }
    if (pin) this.stingers.pin?.(keys);
  }

  /** Fetch stingers' compressed files ahead of use, without decoding (fire-and-forget). */
  prefetchStingers(names, tonic = null) {
    if (!this._canUseLoopedMusic()) return;
    for (const name of names || []) {
      const key = this.stingerKeyFor(name, tonic);
      if (key && !this.stingers.has(key)) this._stingerBytesFor(key).catch(() => {});
    }
  }

  /** The compressed file of stinger `key`: kept, in flight, or fetched now. */
  _stingerBytesFor(key) {
    const kept = this._stingerBytes.get(key);
    if (kept) {
      this._stingerBytes.delete(key);
      this._stingerBytes.set(key, kept);
      return Promise.resolve(kept);
    }
    if (this._stingerFetches.has(key)) return this._stingerFetches.get(key);
    const promise = this._fetchStingerBytes(key)
      .then((bytes) => {
        this._stingerBytes.set(key, bytes);
        while (this._stingerBytes.size > STINGER_BYTES_MAX) {
          this._stingerBytes.delete(this._stingerBytes.keys().next().value);
        }
        return bytes;
      })
      .finally(() => this._stingerFetches.delete(key));
    this._stingerFetches.set(key, promise);
    return promise;
  }

  /**
   * Play stinger `name` at the music volume, ducking the current track under
   * it until its notes end. When it can't sound (no Web Audio, music muted,
   * not decoded within `waitMs`), `fallbackSfx` plays instead so a ceremony
   * never goes silent. Resolves to the voice (stop(fadeMs)) or null.
   */
  async playStinger(
    name,
    { volume = 1, duck = 0.35, fallbackSfx = null, tonic = null, waitMs = 0 } = {},
  ) {
    const seq = ++this._stingerSeq;
    const entry = MUSIC_STINGERS[name];
    const key = this.stingerKeyFor(name, tonic);
    const gain = this._curve(this.musicVolume) * volume;
    const fallback = () => {
      if (fallbackSfx) this.playSFX(fallbackSfx);
      return null;
    };
    if (!entry || !key || !(gain > 0) || !this._canUseLoopedMusic()) return fallback();
    if (!this.stingers.has(key)) {
      const loaded = this.stingers.load(key).catch(() => null);
      // a cue still decoding is worth a moment's wait: its fallback is a click
      const wait = Math.max(Number(waitMs) || 0, STINGER_MIN_WAIT_MS);
      const buffer = await Promise.race([
        loaded,
        new Promise((resolve) => setTimeout(() => resolve(null), wait)),
      ]);
      // stopStingers() or a newer cue came first: stay silent
      if (seq !== this._stingerSeq) return null;
      if (!buffer) return fallback();
    }
    const voice = this.stingers.play(key, { volume: gain });
    if (!voice) return fallback();
    if (duck < 1) {
      this.duckMusic(duck, { hold: Math.max(0, (entry.notesEnd || 0) - 0.1), release: 0.9 });
    }
    return voice;
  }

  /** Fade out every stinger (a skipped ceremony) and bring the music back up. */
  stopStingers(fadeMs = STINGER_FADE_MS) {
    this._stingerSeq++;
    const wasPlaying = this.stingers.playing;
    this.stingers.stopAll(fadeMs);
    if (wasPlaying) this.currentMusic?.unduck?.(0.35);
  }

  /** Lower the current track (e.g. under a ceremony); see LoopedMusic.duck. */
  duckMusic(level, opts) {
    return Boolean(this.currentMusic?.duck?.(level, opts));
  }

  _getStingerSources(key) {
    return [`assets/audio/stingers/${key}.mp3`];
  }

  async _fetchAndDecodeStinger(key) {
    const context = this.sound?.context;
    if (!context || typeof fetch !== 'function') throw new Error('no-audio-context');
    const bytes = await this._stingerBytesFor(key);
    // decodeAudioData detaches its input: decode a copy, keep the file
    return this._decodeAudioData(context, bytes.slice(0));
  }

  async _fetchStingerBytes(key) {
    if (typeof fetch !== 'function') throw new Error('no-fetch');
    let lastErr = null;
    for (const src of this._getStingerSources(key)) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeout = setTimeout(() => controller?.abort(), this.musicLoadTimeoutMs);
      try {
        const response = await fetch(src, { signal: controller?.signal });
        if (!response?.ok) throw new Error(`http-${response?.status || 'error'}`);
        return await response.arrayBuffer();
      } catch (err) {
        lastErr = err;
      } finally {
        clearTimeout(timeout);
      }
    }
    throw lastErr || new Error(`stinger-load-failed:${key}`);
  }

  _getMusicSources(key) {
    // mp3 decodes everywhere (Safari included); ogg twins were dropped to
    // halve the audio payload.
    return [`assets/audio/music/${key}.mp3`];
  }

  _ensureMusicLoaded(key, scene, timeoutMs = null) {
    const effectiveTimeoutMs = this._toPositiveInt(
      timeoutMs,
      this.isMobile ? this.mobileMusicLoadTimeoutMs : this.musicLoadTimeoutMs,
    );
    if (this.sound.game.cache.audio.has(key)) return Promise.resolve();
    if (this.loadingMusic.has(key)) return this.loadingMusic.get(key);

    const promise = (async () => {
      if (this._canUseWebAudioFetchDecode()) {
        try {
          await this._fetchAndDecodeMusic(key, effectiveTimeoutMs);
          return;
        } catch (err) {
          // Fall back to scene loader only when available.
          if (!scene?.load) throw err;
        }
      }
      await this._loadMusicWithSceneLoader(key, scene, effectiveTimeoutMs);
    })().finally(() => {
      this.loadingMusic.delete(key);
    });

    this.loadingMusic.set(key, promise);
    return promise;
  }

  _canUseWebAudioFetchDecode() {
    return Boolean(
      this.sound?.context &&
      this.sound?.game?.cache?.audio &&
      typeof this.sound.game.cache.audio.add === 'function' &&
      typeof fetch === 'function',
    );
  }

  async _fetchAndDecodeMusic(key, timeoutMs) {
    const cache = this.sound?.game?.cache?.audio;
    if (!cache || typeof cache.add !== 'function') {
      throw new Error('no-audio-cache');
    }
    const context = this.sound?.context;
    if (!context) throw new Error('no-audio-context');

    const sources = this._getMusicSources(key);
    let lastErr = null;
    for (const src of sources) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timeoutHandle = setTimeout(() => {
        try {
          controller?.abort();
        } catch (_) {}
      }, timeoutMs);
      try {
        const response = await fetch(src, { signal: controller?.signal });
        if (!response?.ok) throw new Error(`http-${response?.status || 'error'}`);
        const bytes = await response.arrayBuffer();
        const decoded = await this._decodeAudioData(context, bytes);
        cache.add(key, decoded);
        this._markMusicCached(key);
        return;
      } catch (err) {
        lastErr = err;
      } finally {
        clearTimeout(timeoutHandle);
      }
    }
    throw lastErr || new Error(`music-load-failed:${key}`);
  }

  _decodeAudioData(context, bytes) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const done = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const fail = (err) => {
        if (settled) return;
        settled = true;
        reject(err || new Error('decode-failed'));
      };
      try {
        const data = bytes?.slice ? bytes.slice(0) : bytes;
        const maybePromise = context.decodeAudioData(data, done, fail);
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(done).catch(fail);
        }
      } catch (err) {
        fail(err);
      }
    });
  }

  _loadMusicWithSceneLoader(key, scene, timeoutMs) {
    const loader = scene?.load;
    if (!loader) return Promise.reject(new Error('no-loader'));

    return new Promise((resolve, reject) => {
      const completeEvent = `filecomplete-audio-${key}`;
      const timeoutHandle = setTimeout(() => {
        cleanup();
        reject(new Error(`music-load-timeout:${key}`));
      }, timeoutMs);
      const cleanup = () => {
        clearTimeout(timeoutHandle);
        try {
          loader.off(completeEvent, onFileComplete);
        } catch (_) {}
        try {
          loader.off('loaderror', onLoadError);
        } catch (_) {}
        try {
          if (scene?.events) scene.events.off('shutdown', onSceneShutdown);
        } catch (_) {}
      };
      const onFileComplete = () => {
        this._markMusicCached(key);
        cleanup();
        resolve();
      };
      const onLoadError = (file) => {
        if (file?.key !== key) return;
        cleanup();
        reject(new Error(`music-load-failed:${key}`));
      };
      const onSceneShutdown = () => {
        cleanup();
        reject(new Error(`music-load-cancelled:${key}`));
      };

      loader.once(completeEvent, onFileComplete);
      loader.on('loaderror', onLoadError);
      if (scene?.events) scene.events.once('shutdown', onSceneShutdown);
      loader.audio(key, this._getMusicSources(key));

      const currentlyLoading =
        typeof loader.isLoading === 'function' ? loader.isLoading() : Boolean(loader.isLoading);
      if (!currentlyLoading) loader.start();
    });
  }

  /** Stop current music with optional fade-out. */
  stopMusic(ownerOrScene, fadeMs = 500, force = false) {
    this._pendingMusic = null;
    // Invalidate any in-flight playMusic() request still awaiting async load.
    this._musicRequestSeq += 1;

    const owner = this._resolveOwnerToken(ownerOrScene);
    const scene = this._resolveSceneContext(ownerOrScene);
    if (!force && owner && this.currentMusicOwner && owner !== this.currentMusicOwner) {
      return false;
    }

    if (!this.currentMusic) {
      if (force || !owner) this.stopAllMusic(scene, fadeMs);
      return false;
    }

    this._stopCurrentMusic(scene, fadeMs);
    return true;
  }

  /** Stop music only if this owner currently controls it. */
  releaseMusic(ownerOrScene, fadeMs = 0) {
    const owner = this._resolveOwnerToken(ownerOrScene);
    if (!owner) return false;
    if (this.currentMusicOwner && owner !== this.currentMusicOwner) return false;
    const scene = this._resolveSceneContext(ownerOrScene);
    this._pendingMusic = null;
    this._musicRequestSeq += 1;
    if (!this.currentMusic) return false;
    this._stopCurrentMusic(scene, fadeMs);
    return true;
  }

  /** Stop all currently playing looping music sounds (including orphaned tracks). */
  stopAllMusic(scene, fadeMs = 0) {
    this._pendingMusic = null;
    this._musicRequestSeq += 1;
    const looping = this._getLoopingMusicSounds();
    if (this.debugMusic && looping.length > 1) {
      console.warn(
        '[AudioManager] overlapping looping tracks detected:',
        looping.map((s) => s.key),
      );
    }
    for (const sound of looping) {
      this._stopSound(sound, scene, fadeMs);
    }
    this.currentMusic = null;
    this.currentMusicKey = null;
    this.currentMusicOwner = null;
    this.currentMusicLayerKeys = [];
  }

  /** Return active looping music keys for diagnostics. */
  getActiveMusicKeys() {
    return this._getLoopingMusicSounds().map((s) => s.key);
  }

  _getLoopingMusicSounds() {
    const managerSounds = Array.isArray(this.sound?.sounds) ? this.sound.sounds : [];
    const trackedSounds = Array.from(this._trackedMusicSounds || []);
    const uniqueSounds = new Set([...managerSounds, ...trackedSounds]);
    return Array.from(uniqueSounds).filter((s) => {
      if (!s) return false;
      const isDestroyed = Boolean(
        this._safeRead(s, 'pendingDestroy') ||
        this._safeRead(s, 'pendingRemove') ||
        this._safeRead(s, '_destroyed') ||
        this._safeRead(s, 'destroyed'),
      );
      if (isDestroyed) {
        if (this._trackedMusicSounds) this._trackedMusicSounds.delete(s);
        return false;
      }
      const key = this._safeRead(s, 'key');
      if (!key) return false;
      // Include any music-key sounds even if Phaser does not currently
      // report them as active; this lets stopAllMusic clean up stale
      // instances that can otherwise overlap after scene transitions.
      if (this._isMusicKey(key)) return true;
      const isLooping = Boolean(
        this._safeRead(s, 'loop') || this._safeRead(this._safeRead(s, 'config'), 'loop'),
      );
      const isActive = Boolean(this._safeRead(s, 'isPlaying') || this._safeRead(s, 'isPaused'));
      const matchesCurrent = s === this.currentMusic || key === this.currentMusicKey;
      return isActive && (isLooping || matchesCurrent);
    });
  }

  _trackMusicSound(sound) {
    if (!sound || !this._trackedMusicSounds) return;
    const key = this._safeRead(sound, 'key');
    if (!this._isMusicKey(key)) return;
    this._trackedMusicSounds.add(sound);
  }

  _safeRead(obj, prop) {
    try {
      return obj?.[prop];
    } catch (_) {
      return undefined;
    }
  }

  _isMusicKey(key) {
    return typeof key === 'string' && key.startsWith('music_');
  }

  _toPositiveInt(value, fallback) {
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed > 0) return Math.round(parsed);
    return fallback;
  }

  _markMusicCached(key) {
    if (!this._isMusicKey(key)) return;
    this._touchMusicCacheKey(key);
    this._enforceMusicCacheBudget({ preserveKeys: [key] });
  }

  _touchMusicCacheKey(key) {
    if (!this._isMusicKey(key)) return;
    this._musicCacheLru = this._musicCacheLru.filter((k) => k !== key);
    this._musicCacheLru.push(key);
  }

  _enforceMusicCacheBudget({ preserveKeys = [] } = {}) {
    const max = this.maxCachedMusicTracks;
    if (!Number.isFinite(max) || max <= 0) return;
    const maxBytes = this.maxCachedMusicBytes;
    const over = () =>
      this._musicCacheLru.length > max || (maxBytes > 0 && this._cachedMusicBytes() > maxBytes);
    if (!over()) return;
    const preserve = new Set(
      [
        ...preserveKeys,
        this.currentMusicKey,
        ...(this.currentMusicLayerKeys || []),
        ...(this._pendingMusicKeys || []),
        ...(this._restoringMusicKeys || []),
        ...this.loadingMusic.keys(),
        ...this._liveMusicBufferKeys(),
      ].filter(Boolean),
    );
    while (over()) {
      const victim = this._musicCacheLru.find((key) => !preserve.has(key));
      if (!victim) break;
      if (!this._evictCachedMusic(victim)) break;
    }
  }

  /** Decoded bytes held by cached music tracks (PCM float32; 0 for non-Web-Audio entries). */
  _cachedMusicBytes() {
    const cache = this.sound?.game?.cache?.audio;
    if (!cache || typeof cache.get !== 'function') return 0;
    let total = 0;
    for (const key of this._musicCacheLru) {
      const buffer = cache.get(key);
      if (isDecodedAudioBuffer(buffer)) {
        total += (Number(buffer.length) || 0) * (Number(buffer.numberOfChannels) || 1) * 4;
      }
    }
    return total;
  }

  _evictCachedMusic(key) {
    const cache = this.sound?.game?.cache?.audio;
    if (!cache || typeof cache.remove !== 'function') return false;
    if (!this._isMusicKey(key)) return false;
    if (key === this.currentMusicKey) return false;
    if ((this.currentMusicLayerKeys || []).includes(key)) return false;
    if ((this._pendingMusicKeys || []).includes(key)) return false;
    if (this._restoringMusicKeys?.has(key)) return false;
    if (this._hasLiveSoundForKey(key)) return false;
    try {
      cache.remove(key);
    } catch (_) {
      return false;
    }
    this._musicCacheLru = this._musicCacheLru.filter((k) => k !== key);
    return true;
  }

  _hasLiveSoundForKey(key) {
    return this._liveMusicBufferKeys().has(key);
  }

  /**
   * Keys of every buffer a sounding voice plays from: Phaser sounds by key,
   * LoopedMusic voices (current, or fading out) by each layer they hold.
   */
  _liveMusicBufferKeys() {
    const keys = new Set();
    const managerSounds = Array.isArray(this.sound?.sounds) ? this.sound.sounds : [];
    const sounds = new Set([...managerSounds, ...(this._trackedMusicSounds || [])]);
    for (const sound of sounds) {
      if (!sound) continue;
      if (this._safeRead(sound, '_destroyed') || this._safeRead(sound, 'pendingRemove')) continue;
      if (!(this._safeRead(sound, 'isPlaying') || this._safeRead(sound, 'isPaused'))) continue;
      const key = this._safeRead(sound, 'key');
      if (key) keys.add(key);
      const bufferKeys = this._safeRead(sound, 'bufferKeys');
      if (Array.isArray(bufferKeys)) for (const k of bufferKeys) if (k) keys.add(k);
    }
    return keys;
  }

  _resolveOwnerToken(ownerOrScene) {
    if (!ownerOrScene) return null;
    if (typeof ownerOrScene === 'string') return ownerOrScene;
    const sceneObj = this._safeRead(ownerOrScene, 'scene');
    const key =
      this._safeRead(sceneObj, 'key') ||
      this._safeRead(this._safeRead(ownerOrScene, 'sys'), 'settings')?.key;
    return typeof key === 'string' ? key : null;
  }

  _resolveSceneContext(ownerOrScene) {
    if (!ownerOrScene || typeof ownerOrScene === 'string') return null;
    return ownerOrScene;
  }

  _stopCurrentMusic(scene, fadeMs) {
    const music = this.currentMusic;
    this.currentMusic = null;
    this.currentMusicKey = null;
    this.currentMusicOwner = null;
    this.currentMusicLayerKeys = [];
    if (!music) return;

    if (fadeMs > 0 && scene?.tweens) {
      this._stopSound(music, scene, fadeMs);
      return;
    }
    this._stopSound(music, scene, 0);
  }

  _stopSound(sound, scene, fadeMs) {
    if (!sound) return;
    const alreadyStopped = Boolean(sound.__audioStopped);
    sound.__audioStopped = true;
    this._killSoundTweens(scene, sound);
    if (!alreadyStopped && fadeMs > 0 && scene?.tweens) {
      const startVolume = this._readSoundVolume(sound);
      const fullVolume = this._curve(this.musicVolume);
      const startRatio = fullVolume > 0 ? Math.min(1, startVolume / fullVolume) : 0;
      let fadeCompleted = false;
      const cleanup = () => {
        if (fadeCompleted) return;
        fadeCompleted = true;
        if (this._trackedMusicSounds) this._trackedMusicSounds.delete(sound);
        try {
          sound.stop();
        } catch (_) {}
        try {
          sound.destroy();
        } catch (_) {}
        // Its buffers were protected while it sounded; let the budget see them now.
        this._enforceMusicCacheBudget();
      };
      this._tweenSoundVolume(scene, sound, startRatio, 0, fadeMs, cleanup);
      // Safety net: force-destroy if tween's onComplete never fires (e.g. scene destroyed mid-fade)
      setTimeout(cleanup, fadeMs + 500);
      return;
    }
    if (this._trackedMusicSounds) this._trackedMusicSounds.delete(sound);
    try {
      sound.stop();
    } catch (_) {}
    try {
      sound.destroy();
    } catch (_) {}
  }

  _readSoundVolume(sound) {
    try {
      if (typeof sound.volume === 'number' && Number.isFinite(sound.volume)) return sound.volume;
      if (typeof sound.config?.volume === 'number' && Number.isFinite(sound.config.volume))
        return sound.config.volume;
    } catch (_) {}
    return 1;
  }

  _killSoundTweens(scene, sound) {
    try {
      if (scene?.tweens && typeof scene.tweens.killTweensOf === 'function') {
        scene.tweens.killTweensOf(sound);
      }
      const fadeProxy = sound?.__audioFadeProxy;
      if (fadeProxy && scene?.tweens && typeof scene.tweens.killTweensOf === 'function') {
        scene.tweens.killTweensOf(fadeProxy);
      }
      // Clear the proxy so setMusicVolume doesn't skip this sound forever.
      if (fadeProxy) sound.__audioFadeProxy = null;
    } catch (_) {}
  }

  /**
   * Fade a music sound between volume ratios (0..1 of the live music volume).
   * The tween animates a ratio rather than an absolute volume so mid-fade
   * volume-slider changes apply immediately instead of losing to the tween.
   */
  _tweenSoundVolume(scene, sound, fromRatio, toRatio, duration, onComplete = null) {
    if (!scene?.tweens || !sound || typeof sound.setVolume !== 'function') return;
    this._killSoundTweens(scene, sound);
    const proxy = { value: fromRatio };
    sound.__audioFadeProxy = proxy;
    const applyVolume = () => {
      try {
        if (sound.__audioStopped && toRatio > 0) return;
        sound.setVolume(proxy.value * this._curve(this.musicVolume));
      } catch (_) {}
    };
    applyVolume();
    const finalize = () => {
      if (sound.__audioFadeProxy !== proxy) return;
      sound.__audioFadeProxy = null;
      try {
        if (!sound.__audioStopped) sound.setVolume(toRatio * this._curve(this.musicVolume));
      } catch (_) {}
    };
    scene.tweens.add({
      targets: proxy,
      value: toRatio,
      duration,
      onUpdate: applyVolume,
      onComplete: () => {
        finalize();
        if (onComplete) onComplete();
      },
    });
    // Safety net: if the scene dies mid-fade Phaser kills the tween without
    // firing onComplete, stranding the proxy (setMusicVolume skips the sound
    // forever) and the music at partial volume. Snap to the target instead.
    const timer = setTimeout(finalize, duration + 500);
    if (typeof timer?.unref === 'function') timer.unref();
  }

  /** Start periodic sweep that kills orphaned looping music sounds. */
  startOverlapWatchdog(intervalMs = 5000) {
    this.stopOverlapWatchdog();
    this._watchdogInterval = setInterval(() => this._runOverlapSweep(), intervalMs);
  }

  /** Stop the overlap watchdog. */
  stopOverlapWatchdog() {
    if (this._watchdogInterval) {
      clearInterval(this._watchdogInterval);
      this._watchdogInterval = null;
    }
  }

  /** Sweep for orphaned looping music and force-destroy any found. */
  _runOverlapSweep() {
    const active = this._getLoopingMusicSounds();
    for (const sound of active) {
      if (sound === this.currentMusic) continue;
      // Already stopping (likely mid fade-out) -- its cleanup is scheduled;
      // hard-cutting here would audibly clip legitimate fades.
      if (sound.__audioStopped) continue;
      if (this.debugMusic) {
        console.warn('[AudioManager] watchdog killing orphan:', sound.key);
      }
      this._stopSound(sound, null, 0);
    }
  }

  /** Play a one-shot sound effect. */
  playSFX(key, volume) {
    const vol = (volume ?? 1.0) * this._curve(this.sfxVolume);
    if (!this.sound.game.cache.audio.has(key)) return;
    this.sound.play(key, { volume: vol });
  }

  setMusicVolume(level) {
    this.musicVolume = Math.max(0, Math.min(1, level));
    const nextVolume = this._curve(this.musicVolume);
    for (const sound of this._getLoopingMusicSounds()) {
      try {
        // Mid-fade sounds rescale on the tween's next update; setting the full
        // volume here would pop them to 100% for a frame.
        if (sound.__audioFadeProxy) continue;
        if (typeof sound.setVolume === 'function') sound.setVolume(nextVolume);
      } catch (_) {}
    }
  }

  setSFXVolume(level) {
    this.sfxVolume = Math.max(0, Math.min(1, level));
  }
}

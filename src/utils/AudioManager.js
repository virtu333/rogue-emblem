// AudioManager - lightweight wrapper around Phaser's sound manager.

export class AudioManager {
  constructor(soundManager) {
    this.sound = soundManager;
    this.currentMusic = null;
    this.currentMusicKey = null;
    this.currentMusicOwner = null;
    this.musicVolume = 0.5;
    this.sfxVolume = 0.7;
    this.debugMusic = false;
    this.loadingMusic = new Map();
    this._musicRequestSeq = 0;
  }

  /** Convert linear slider value (0-1) to perceptual volume via quadratic curve. */
  _curve(linear) {
    return linear * linear;
  }

  /** Play looping background music with optional fade-in. */
  async playMusic(key, ownerOrScene, fadeMs = 500) {
    try {
      if (!key) return;
      const owner = this._resolveOwnerToken(ownerOrScene);
      const scene = this._resolveSceneContext(ownerOrScene);

      if (this.currentMusicKey === key && this.currentMusic?.isPlaying) {
        // If duplicate/stray looping tracks exist, recover by forcing a clean restart.
        const active = this._getLoopingMusicSounds();
        const hasOverlap = active.some((sound) => sound !== this.currentMusic);
        const sameOwner = !owner || !this.currentMusicOwner || this.currentMusicOwner === owner;
        if (sameOwner && !hasOverlap) return;
        this.stopAllMusic(scene, 0);
      }

      const requestSeq = ++this._musicRequestSeq;

      // Defer if audio context is locked (browser autoplay policy)
      if (this.sound.locked) {
        this._pendingMusic = { key, ownerOrScene, fadeMs };
        if (!this._unlockListenerAdded) {
          this._unlockListenerAdded = true;
          this.sound.once('unlocked', () => {
            this._unlockListenerAdded = false;
            if (this._pendingMusic) {
              const p = this._pendingMusic;
              this._pendingMusic = null;
              void this.playMusic(p.key, p.ownerOrScene, p.fadeMs);
            }
          });
        }
        return;
      }

      if (!this.sound.game.cache.audio.has(key)) {
        try {
          await this._ensureMusicLoaded(key, scene);
        } catch (_) {
          return;
        }
      }

      // A newer request started while this one was loading.
      if (requestSeq !== this._musicRequestSeq) return;

      // Defensive stop: clear any orphan looping music before starting new track.
      this.stopAllMusic(scene, 0);

      if (!this.sound.game.cache.audio.has(key)) return;

      this.currentMusic = this.sound.add(key, { loop: true, volume: fadeMs > 0 ? 0 : this._curve(this.musicVolume) });
      this.currentMusicKey = key;
      this.currentMusicOwner = owner;
      this.currentMusic.play();

      if (fadeMs > 0 && scene?.tweens) {
        scene.tweens.add({
          targets: this.currentMusic,
          volume: this._curve(this.musicVolume),
          duration: fadeMs,
        });
      }
    } catch (err) {
      // Never surface async audio errors to scene callers (fire-and-forget usage).
      if (this.debugMusic) console.warn('[AudioManager] playMusic failed:', key, err);
    }
  }

  _getMusicSources(key) {
    // Keep .ogg first to preserve existing behavior where available.
    return [`assets/audio/music/${key}.ogg`, `assets/audio/music/${key}.mp3`];
  }

  _ensureMusicLoaded(key, scene, timeoutMs = 5000) {
    if (this.sound.game.cache.audio.has(key)) return Promise.resolve();
    if (this.loadingMusic.has(key)) return this.loadingMusic.get(key);

    const promise = (async () => {
      if (this._canUseWebAudioFetchDecode()) {
        try {
          await this._fetchAndDecodeMusic(key, timeoutMs);
          return;
        } catch (err) {
          // Fall back to scene loader only when available.
          if (!scene?.load) throw err;
        }
      }
      await this._loadMusicWithSceneLoader(key, scene, timeoutMs);
    })().finally(() => {
      this.loadingMusic.delete(key);
    });

    this.loadingMusic.set(key, promise);
    return promise;
  }

  _canUseWebAudioFetchDecode() {
    return Boolean(
      this.sound?.context
      && this.sound?.game?.cache?.audio
      && typeof this.sound.game.cache.audio.add === 'function'
      && typeof fetch === 'function',
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
        try { controller?.abort(); } catch (_) {}
      }, timeoutMs);
      try {
        const response = await fetch(src, { signal: controller?.signal });
        if (!response?.ok) throw new Error(`http-${response?.status || 'error'}`);
        const bytes = await response.arrayBuffer();
        const decoded = await this._decodeAudioData(context, bytes);
        cache.add(key, decoded);
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
        try { loader.off(completeEvent, onFileComplete); } catch (_) {}
        try { loader.off('loaderror', onLoadError); } catch (_) {}
        try { if (scene?.events) scene.events.off('shutdown', onSceneShutdown); } catch (_) {}
      };
      const onFileComplete = () => {
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

      const currentlyLoading = typeof loader.isLoading === 'function'
        ? loader.isLoading()
        : Boolean(loader.isLoading);
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
      console.warn('[AudioManager] overlapping looping tracks detected:', looping.map(s => s.key));
    }
    for (const sound of looping) {
      this._stopSound(sound, scene, fadeMs);
    }
    this.currentMusic = null;
    this.currentMusicKey = null;
    this.currentMusicOwner = null;
  }

  /** Return active looping music keys for diagnostics. */
  getActiveMusicKeys() {
    return this._getLoopingMusicSounds().map(s => s.key);
  }

  _getLoopingMusicSounds() {
    const sounds = Array.isArray(this.sound?.sounds) ? this.sound.sounds : [];
    return sounds.filter((s) => {
      if (!s) return false;
      const key = this._safeRead(s, 'key');
      if (!key) return false;
      // Include any music-key sounds even if Phaser does not currently
      // report them as active; this lets stopAllMusic clean up stale
      // instances that can otherwise overlap after scene transitions.
      if (this._isMusicKey(key)) return true;
      const isLooping = Boolean(this._safeRead(s, 'loop') || this._safeRead(this._safeRead(s, 'config'), 'loop'));
      const isActive = Boolean(this._safeRead(s, 'isPlaying') || this._safeRead(s, 'isPaused'));
      const matchesCurrent = s === this.currentMusic || key === this.currentMusicKey;
      return isActive && (isLooping || matchesCurrent);
    });
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

  _resolveOwnerToken(ownerOrScene) {
    if (!ownerOrScene) return null;
    if (typeof ownerOrScene === 'string') return ownerOrScene;
    const sceneObj = this._safeRead(ownerOrScene, 'scene');
    const key = this._safeRead(sceneObj, 'key')
      || this._safeRead(this._safeRead(ownerOrScene, 'sys'), 'settings')?.key;
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
    if (!music) return;

    if (fadeMs > 0 && scene?.tweens) {
      this._stopSound(music, scene, fadeMs);
      return;
    }
    this._stopSound(music, scene, 0);
  }

  _stopSound(sound, scene, fadeMs) {
    if (!sound) return;
    if (sound.__audioStopped) return;
    sound.__audioStopped = true;
    if (fadeMs > 0 && scene?.tweens) {
      scene.tweens.add({
        targets: sound,
        volume: 0,
        duration: fadeMs,
        onComplete: () => { sound.stop(); sound.destroy(); },
      });
      return;
    }
    try { sound.stop(); } catch (_) {}
    try { sound.destroy(); } catch (_) {}
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
      if (typeof sound.setVolume === 'function') sound.setVolume(nextVolume);
    }
  }

  setSFXVolume(level) {
    this.sfxVolume = Math.max(0, Math.min(1, level));
  }
}

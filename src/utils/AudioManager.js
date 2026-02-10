// AudioManager — Lightweight wrapper around Phaser's sound manager

export class AudioManager {
  constructor(soundManager) {
    this.sound = soundManager;
    this.currentMusic = null;
    this.currentMusicKey = null;
    this.musicVolume = 0.5;
    this.sfxVolume = 0.7;
    this.debugMusic = false;
  }

  /** Convert linear slider value (0-1) to perceptual volume via quadratic curve. */
  _curve(linear) {
    return linear * linear;
  }

  /** Play looping background music with optional fade-in. */
  playMusic(key, scene, fadeMs = 500) {
    if (!key) return;
    if (this.currentMusicKey === key && this.currentMusic?.isPlaying) return;

    // Defer if audio context is locked (browser autoplay policy)
    if (this.sound.locked) {
      this._pendingMusic = { key };
      if (!this._unlockListenerAdded) {
        this._unlockListenerAdded = true;
        this.sound.once('unlocked', () => {
          this._unlockListenerAdded = false;
          if (this._pendingMusic) {
            const p = this._pendingMusic;
            this._pendingMusic = null;
            // Play at full volume immediately — no fade (scene ref may be stale)
            this.playMusic(p.key, null, 0);
          }
        });
      }
      return;
    }

    // Defensive stop: clear any orphan looping music before starting new track.
    this.stopAllMusic(scene, 0);

    if (!this.sound.get(key) && !this.sound.game.cache.audio.has(key)) return;

    this.currentMusic = this.sound.add(key, { loop: true, volume: fadeMs > 0 ? 0 : this._curve(this.musicVolume) });
    this.currentMusicKey = key;
    this.currentMusic.play();

    if (fadeMs > 0 && scene?.tweens) {
      scene.tweens.add({
        targets: this.currentMusic,
        volume: this._curve(this.musicVolume),
        duration: fadeMs,
      });
    }
  }

  /** Stop current music with optional fade-out. */
  stopMusic(scene, fadeMs = 500) {
    this._pendingMusic = null;
    if (!this.currentMusic) {
      this.stopAllMusic(scene, fadeMs);
      return;
    }

    const music = this.currentMusic;
    this.currentMusic = null;
    this.currentMusicKey = null;

    if (fadeMs > 0 && scene?.tweens) {
      scene.tweens.add({
        targets: music,
        volume: 0,
        duration: fadeMs,
        onComplete: () => { music.stop(); music.destroy(); },
      });
    } else {
      music.stop();
      music.destroy();
    }
  }

  /** Stop all currently playing looping music sounds (including orphaned tracks). */
  stopAllMusic(scene, fadeMs = 0) {
    const looping = this._getLoopingMusicSounds();
    if (this.debugMusic && looping.length > 1) {
      console.warn('[AudioManager] overlapping looping tracks detected:', looping.map(s => s.key));
    }
    for (const sound of looping) {
      this._stopSound(sound, scene, fadeMs);
    }
    this.currentMusic = null;
    this.currentMusicKey = null;
  }

  /** Return active looping music keys for diagnostics. */
  getActiveMusicKeys() {
    return this._getLoopingMusicSounds().map(s => s.key);
  }

  _getLoopingMusicSounds() {
    const sounds = Array.isArray(this.sound?.sounds) ? this.sound.sounds : [];
    return sounds.filter(s => s && s.key && (s.loop || s.config?.loop) && (s.isPlaying || s.isPaused));
  }

  _stopSound(sound, scene, fadeMs) {
    if (!sound) return;
    if (fadeMs > 0 && scene?.tweens) {
      scene.tweens.add({
        targets: sound,
        volume: 0,
        duration: fadeMs,
        onComplete: () => { sound.stop(); sound.destroy(); },
      });
      return;
    }
    sound.stop();
    sound.destroy();
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

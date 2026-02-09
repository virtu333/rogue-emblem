// AudioManager — Lightweight wrapper around Phaser's sound manager

export class AudioManager {
  constructor(soundManager) {
    this.sound = soundManager;
    this.currentMusic = null;
    this.currentMusicKey = null;
    this.musicVolume = 0.5;
    this.sfxVolume = 0.7;
  }

  /** Play looping background music with optional fade-in. */
  playMusic(key, scene, fadeMs = 500) {
    if (this.currentMusicKey === key) return; // already playing

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

    this.stopMusic(scene, 0); // instant stop previous

    // Defensive: stop any orphaned sounds from previous scenes
    this._cleanupOrphans();

    if (!this.sound.get(key) && !this.sound.game.cache.audio.has(key)) return;

    this.currentMusic = this.sound.add(key, { loop: true, volume: fadeMs > 0 ? 0 : this.musicVolume });
    this.currentMusicKey = key;
    this.currentMusic.play();

    if (fadeMs > 0 && scene?.tweens) {
      scene.tweens.add({
        targets: this.currentMusic,
        volume: this.musicVolume,
        duration: fadeMs,
      });
    }
  }

  /** Stop current music with optional fade-out. */
  stopMusic(scene, fadeMs = 500) {
    this._pendingMusic = null;
    if (!this.currentMusic) {
      // Even with no tracked music, clean up orphans (e.g. from crashed scenes)
      this._cleanupOrphans();
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

    this._cleanupOrphans();
  }

  /** Stop any orphaned looping or long-duration sounds left over from previous scenes. */
  _cleanupOrphans() {
    if (!this.sound.sounds) return;
    for (let i = this.sound.sounds.length - 1; i >= 0; i--) {
      const s = this.sound.sounds[i];
      if (!s) continue;
      // Catch looping sounds even if paused/fading (not just isPlaying)
      if ((s.isPlaying || s.loop) && (s.loop || s.duration > 10000)) {
        s.stop();
        s.destroy();
      }
    }
  }

  /** Play a one-shot sound effect. */
  playSFX(key, volume) {
    const vol = (volume ?? 1.0) * this.sfxVolume;
    if (!this.sound.game.cache.audio.has(key)) return;
    this.sound.play(key, { volume: vol });
  }

  setMusicVolume(level) {
    this.musicVolume = Math.max(0, Math.min(1, level));
    if (this.currentMusic) this.currentMusic.setVolume(this.musicVolume);
  }

  setSFXVolume(level) {
    this.sfxVolume = Math.max(0, Math.min(1, level));
  }
}

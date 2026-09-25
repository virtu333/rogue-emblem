// BattleMusicController — starts a battle's music and drives the calm/full
// layers of adaptive battle themes (see engine/MusicIntensity.js).
//
// Boss themes and any single-layer track simply play; layer requests are
// no-ops for them.

import {
  INTENSITY,
  createIntensityState,
  initialIntensity,
  nextIntensity,
} from '../engine/MusicIntensity.js';
import { getBossMusicKey, getMusicKey, getMusicLayers } from '../utils/musicConfig.js';

const RISE_FADE_MS = 1200;
const SETTLE_FADE_MS = 3000;

export default class BattleMusicController {
  /**
   * @param {Phaser.Scene} scene BattleScene
   * @param {object} [options]
   * @param {() => boolean} [options.playersInDanger] true when a player unit stands
   *   inside the (visible) enemy threat range
   */
  constructor(scene, { playersInDanger } = {}) {
    this.scene = scene;
    this._playersInDanger = playersInDanger || (() => false);
    this.state = createIntensityState();
    this.key = null;
    this.adaptive = false;
  }

  _audio() {
    return this.scene?.registry?.get?.('audio') || null;
  }

  _danger() {
    try {
      return Boolean(this._playersInDanger());
    } catch (_) {
      return false;
    }
  }

  /** Choose and start the battle's track. Returns the music key. */
  create({
    act = 'act1',
    isBoss = false,
    bossName = null,
    fadeMs = 800,
    releaseFirst = false,
  } = {}) {
    const key = isBoss ? getBossMusicKey(bossName, act) : getMusicKey('battle', act);
    this.key = key;
    this.adaptive = Boolean(getMusicLayers(key));
    this.state = createIntensityState();
    this.state.level = this.adaptive
      ? initialIntensity({ playersInDanger: this._danger() })
      : INTENSITY.FULL;
    const audio = this._audio();
    if (audio) {
      if (releaseFirst) audio.releaseMusic(this.scene, 0);
      audio.setMusicIntensity?.(this.state.level, 0);
      void audio.playMusic(key, this.scene, fadeMs);
    }
    return key;
  }

  _apply(prevLevel, fadeMs) {
    if (!this.adaptive || this.state.level === prevLevel) return;
    this._audio()?.setMusicIntensity?.(this.state.level, fadeMs);
  }

  /** Any exchange of blows (either side). */
  onCombat() {
    const prev = this.state.level;
    this.state = nextIntensity(this.state, { type: 'combat' });
    this._apply(prev, RISE_FADE_MS);
  }

  /** A phase is starting. */
  onPhaseStart(phase) {
    const prev = this.state.level;
    this.state = nextIntensity(this.state, {
      type: 'phase',
      phase,
      playersInDanger: this.adaptive ? this._danger() : false,
    });
    this._apply(prev, this.state.level === INTENSITY.CALM ? SETTLE_FADE_MS : RISE_FADE_MS);
  }

  destroy() {
    this.scene = null;
    this._playersInDanger = () => false;
  }
}

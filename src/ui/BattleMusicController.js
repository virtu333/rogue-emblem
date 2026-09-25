// BattleMusicController — starts a battle's music and drives its layers:
// the calm/full layers of adaptive battle themes (see engine/MusicIntensity.js)
// and, for a boss, the boss's own enrage layer once turn pressure enrages it.
// Single-layer tracks simply play; layer requests are no-ops for them.

import {
  INTENSITY,
  createIntensityState,
  initialIntensity,
  nextIntensity,
} from '../engine/MusicIntensity.js';
import {
  MUSIC,
  getBossEnrageLayer,
  getBossMusicKey,
  getMusicKey,
  getMusicLayers,
} from '../utils/musicConfig.js';

const RISE_FADE_MS = 1200;
const SETTLE_FADE_MS = 3000;
const ENRAGE_FADE_MS = 2500;

export default class BattleMusicController {
  /**
   * @param {Phaser.Scene} scene BattleScene
   * @param {object} [options]
   * @param {() => boolean} [options.playersInDanger] true when a player unit stands
   *   inside the (visible) enemy threat range
   * @param {() => boolean} [options.bossEnraged] true once turn pressure has
   *   enraged the boss (read at start and each phase, so a resumed battle catches up)
   */
  constructor(scene, { playersInDanger, bossEnraged } = {}) {
    this.scene = scene;
    this._playersInDanger = playersInDanger || (() => false);
    this._bossEnraged = bossEnraged || (() => false);
    this.state = createIntensityState();
    this.key = null;
    this.adaptive = false;
    this.enrageLayer = null;
    this.enraged = false;
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

  _isEnraged() {
    try {
      return Boolean(this._bossEnraged());
    } catch (_) {
      return false;
    }
  }

  /**
   * Choose and start the battle's track. Returns the music key. Bosses play
   * their theme; an escape map plays the pursuit theme; otherwise the act's
   * battle pool.
   */
  create({
    act = 'act1',
    isBoss = false,
    bossName = null,
    objective = null,
    fadeMs = 800,
    releaseFirst = false,
  } = {}) {
    let key;
    if (isBoss) key = getBossMusicKey(bossName, act);
    else if (objective === 'escape' && MUSIC.escape) key = MUSIC.escape;
    else key = getMusicKey('battle', act);
    this.key = key;
    this.adaptive = Boolean(getMusicLayers(key));
    this.enrageLayer = isBoss ? getBossEnrageLayer(key, bossName) : null;
    this.enraged = Boolean(this.enrageLayer) && this._isEnraged();
    this.state = createIntensityState();
    this.state.level = this.adaptive
      ? initialIntensity({ playersInDanger: this._danger() })
      : INTENSITY.FULL;
    const audio = this._audio();
    if (audio) {
      if (releaseFirst) audio.releaseMusic(this.scene, 0);
      audio.setMusicIntensity?.(this.enraged ? 'enrage' : this.state.level, 0);
      if (this.enrageLayer) {
        void audio.playMusic(key, this.scene, fadeMs, { layers: { enrage: this.enrageLayer } });
      } else void audio.playMusic(key, this.scene, fadeMs);
    }
    return key;
  }

  /** Turn pressure enraged the boss: its theme crossfades to the boss's enrage layer. */
  onBossEnrage(fadeMs = ENRAGE_FADE_MS) {
    if (!this.enrageLayer || this.enraged) return false;
    this.enraged = true;
    this._audio()?.setMusicIntensity?.('enrage', fadeMs);
    return true;
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
    if (this.enrageLayer && !this.enraged && this._isEnraged()) this.onBossEnrage();
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
    this._bossEnraged = () => false;
  }
}

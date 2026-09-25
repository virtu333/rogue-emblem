// BattleMusicController — starts a battle's music and drives its layers:
// the calm/full layers of adaptive battle themes (see engine/MusicIntensity.js)
// and, for a boss, the boss's own enrage layer once turn pressure enrages it.
// Single-layer tracks simply play; layer requests are no-ops for them.
//
// The Entity is different: its theme plays until the first time anyone wounds
// it (or turn pressure enrages it first). Then the theme stops dead, a silence,
// one violin's Thread (the hinge cue), and the finale starts on the downbeat
// the cue hands over to. Under the finale the Entity's hum is a stem of its
// own whose level follows the Entity's remaining HP (see ENTITY_FINALE).

import {
  INTENSITY,
  createIntensityState,
  initialIntensity,
  nextIntensity,
} from '../engine/MusicIntensity.js';
import {
  ENTITY_FINALE,
  MUSIC,
  getBossEnrageLayer,
  getBossMusicKey,
  getMusicKey,
  getMusicLayers,
} from '../utils/musicConfig.js';
import { MUSIC_STINGERS } from '../utils/musicStingers.js';

const RISE_FADE_MS = 1200;
const SETTLE_FADE_MS = 3000;
const ENRAGE_FADE_MS = 2500;
const HUM_FADE_MS = 900;
// how long the hinge cue may take to decode before the finale starts without it
const HINGE_WAIT_MS = 1500;
// one bar of the finale (12/8 at dotted quarter = 136): the hinge cue is two
const FINALE_BAR_MS = 1000 * ((MUSIC_STINGERS[ENTITY_FINALE.hinge]?.handoff || 3.529) / 2);

/** The Entity's hum level under its finale: full at full HP, gone as it dies. */
export function entityHumGain(ratio) {
  const r = Number(ratio);
  return Number.isFinite(r) ? Math.max(0, Math.min(1, r)) : 1;
}

export default class BattleMusicController {
  /**
   * @param {Phaser.Scene} scene BattleScene
   * @param {object} [options]
   * @param {() => boolean} [options.playersInDanger] true when a player unit stands
   *   inside the (visible) enemy threat range
   * @param {() => boolean} [options.bossEnraged] true once turn pressure has
   *   enraged the boss (read at start and each phase, so a resumed battle catches up)
   * @param {() => ({current: number, max: number, ratio: number}|null)} [options.entityHealth]
   *   the Entity's health (null when there is no Entity)
   * @param {(beat: {leadMs: number, barMs: number}) => void} [options.onFinale]
   *   the finale's answer is coming: its first downbeat is `leadMs` from now
   *   (the allies' rally lines ride on it); not called for a resumed battle
   */
  constructor(scene, { playersInDanger, bossEnraged, entityHealth, onFinale } = {}) {
    this.scene = scene;
    this._playersInDanger = playersInDanger || (() => false);
    this._bossEnraged = bossEnraged || (() => false);
    this._entityHealth = entityHealth || (() => null);
    this._onFinale = onFinale || null;
    this.state = createIntensityState();
    this.key = null;
    this.adaptive = false;
    this.enrageLayer = null;
    this.enraged = false;
    // Entity finale: null (not an Entity battle) | 'theme' | 'hinge' | 'finale'
    this.entityStage = null;
    this._finaleToken = 0;
    this._finaleTimer = null;
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

  _health() {
    try {
      const h = this._entityHealth();
      return h && Number(h.max) > 0 ? h : null;
    } catch (_) {
      return null;
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
    const health = isBoss && key === ENTITY_FINALE.theme ? this._health() : null;
    this.entityStage = health ? 'theme' : null;
    const audio = this._audio();
    if (audio) {
      if (releaseFirst) audio.releaseMusic(this.scene, 0);
      audio.setMusicIntensity?.(this.enraged ? 'enrage' : this.state.level, 0);
    }
    // A resumed battle where the Entity is already wounded (or enraged) goes
    // straight to the finale: the hinge belongs to the moment of the wound.
    if (health && (health.current < health.max || this._isEnraged())) {
      this._playFinale({ fadeMs });
      return this.key;
    }
    if (audio) {
      if (this.enrageLayer) {
        void audio.playMusic(key, this.scene, fadeMs, { layers: { enrage: this.enrageLayer } });
      } else void audio.playMusic(key, this.scene, fadeMs);
      if (this.entityStage) {
        audio.preloadMusic?.([ENTITY_FINALE.track, ENTITY_FINALE.hum], this.scene);
        audio.preloadStingers?.([ENTITY_FINALE.hinge]);
      }
    }
    return key;
  }

  /**
   * Turn pressure enraged the boss: its theme crossfades to the boss's enrage
   * layer. For the Entity it starts the finale, if no wound has already.
   */
  onBossEnrage(fadeMs = ENRAGE_FADE_MS) {
    if (this.entityStage) return this._startFinale();
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

  /** An exchange of blows has been resolved and its damage applied. */
  onCombatResolved() {
    this._checkEntity();
  }

  /** A phase is starting. */
  onPhaseStart(phase) {
    this._checkEntity();
    if (this.enrageLayer && !this.enraged && this._isEnraged()) this.onBossEnrage();
    if (this.entityStage === 'theme' && this._isEnraged()) this._startFinale();
    const prev = this.state.level;
    this.state = nextIntensity(this.state, {
      type: 'phase',
      phase,
      playersInDanger: this.adaptive ? this._danger() : false,
    });
    this._apply(prev, this.state.level === INTENSITY.CALM ? SETTLE_FADE_MS : RISE_FADE_MS);
  }

  // ------------------------------------------------------------ the Entity finale

  /** First wound -> the finale; afterwards the hum follows the Entity's HP. */
  _checkEntity() {
    if (!this.entityStage) return;
    const health = this._health();
    if (!health) return;
    if (this.entityStage === 'theme' && health.current < health.max) {
      this._startFinale();
    } else if (this.entityStage === 'finale') {
      this._audio()?.setMusicLayerGain?.('hum', entityHumGain(health.ratio), HUM_FADE_MS);
    }
  }

  /** The hinge: the theme stops dead, then a silence, then the answer. */
  _startFinale() {
    if (this.entityStage !== 'theme') return false;
    this.entityStage = 'hinge';
    const audio = this._audio();
    if (!audio) {
      this.entityStage = 'finale';
      return true;
    }
    audio.stopMusic(this.scene, ENTITY_FINALE.cutMs, true);
    const token = ++this._finaleToken;
    this._finaleTimer = setTimeout(() => {
      this._finaleTimer = null;
      void this._answer(token);
    }, ENTITY_FINALE.silenceMs);
    return true;
  }

  /** Still the Entity's silence: nothing else has taken the music, and it lives. */
  _hingeCurrent(token) {
    if (token !== this._finaleToken || !this.scene || this.entityStage !== 'hinge') return false;
    const audio = this._audio();
    if (!audio || audio.currentMusicKey) return false;
    const health = this._health();
    return !health || health.current > 0;
  }

  async _answer(token) {
    if (!this._hingeCurrent(token)) return;
    const audio = this._audio();
    const hinge = MUSIC_STINGERS[ENTITY_FINALE.hinge];
    let voice = null;
    try {
      voice = await audio.playStinger?.(ENTITY_FINALE.hinge, { duck: 1, waitMs: HINGE_WAIT_MS });
    } catch (_) {
      voice = null;
    }
    if (!this._hingeCurrent(token)) {
      voice?.stop?.();
      return;
    }
    const handoff = Number(hinge?.handoff ?? hinge?.notesEnd);
    const startAt =
      voice && Number.isFinite(voice.startTime) && Number.isFinite(handoff)
        ? voice.startTime + handoff
        : null;
    this._playFinale({ startAt });
    // the downbeat everyone answers on: how far away it is on the audio clock
    const now = audio.audioTime?.();
    const leadMs =
      startAt !== null && Number.isFinite(now) ? Math.max(0, (startAt - now) * 1000) : 0;
    try {
      this._onFinale?.({ leadMs, barMs: FINALE_BAR_MS });
    } catch (_) {
      /* the rally is decoration */
    }
  }

  _playFinale({ startAt = null, fadeMs = 0 } = {}) {
    this.entityStage = 'finale';
    this.key = ENTITY_FINALE.track;
    const audio = this._audio();
    if (!audio) return;
    const health = this._health();
    void audio.playMusic(ENTITY_FINALE.track, this.scene, fadeMs, {
      layers: { hum: ENTITY_FINALE.hum },
      layerGains: { hum: entityHumGain(health ? health.ratio : 1) },
      startAt,
    });
  }

  destroy() {
    this._finaleToken++;
    if (this._finaleTimer) clearTimeout(this._finaleTimer);
    this._finaleTimer = null;
    this.scene = null;
    this._playersInDanger = () => false;
    this._bossEnraged = () => false;
    this._entityHealth = () => null;
    this._onFinale = null;
  }
}

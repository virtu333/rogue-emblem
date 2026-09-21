// SettingsManager — Pure class wrapping localStorage for user settings
// No Phaser deps.

import { BATTLE_SPEEDS } from './combatTiming.js';

const STORAGE_KEY = 'emblem_rogue_settings';

function prefersReducedMotion() {
  try {
    return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  } catch (_) {
    return false;
  }
}

// Shared by local startup and cloud hydration. Normalize each new key independently.
export function normalizeSettings(saved = {}) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const legacyReduced = saved.reducedEffects === true;
  const volume = (value, fallback) =>
    Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
  return {
    ...(Number.isFinite(saved.savedAt) ? { savedAt: saved.savedAt } : {}),
    hints: typeof saved.hints === 'boolean' ? saved.hints : true,
    skipSeenDialogue: saved.skipSeenDialogue === true,
    battleSpeed: BATTLE_SPEEDS.includes(saved.battleSpeed) ? saved.battleSpeed : 'normal',
    musicVolume: volume(saved.musicVolume, 0.5),
    sfxVolume: volume(saved.sfxVolume, 0.7),
    reduceMotion:
      typeof saved.reduceMotion === 'boolean' ? saved.reduceMotion : prefersReducedMotion(),
    effectsQuality: ['high', 'low'].includes(saved.effectsQuality)
      ? saved.effectsQuality
      : legacyReduced
        ? 'low'
        : 'high',
  };
}

export class SettingsManager {
  constructor() {
    this.onSave = null;
    this.data = normalizeSettings();
    this.migrationResult = null;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        this.data = normalizeSettings(saved);
        if (
          !Number.isFinite(saved.savedAt) ||
          Object.keys(saved).length !== Object.keys(this.data).length ||
          Object.keys(this.data).some((key) => saved[key] !== this.data[key])
        ) {
          this.migrationResult = this._save();
        }
      }
    } catch (_) {
      /* incognito / malformed data */
    }
  }

  adoptPersisted() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (saved && Number(saved.savedAt) > Number(this.data.savedAt || 0)) {
        this.data = normalizeSettings(saved);
        this.onHydrate?.(this.data);
      }
    } catch {
      /* Keep the last valid in-memory preferences. */
    }
  }

  get(key) {
    this.adoptPersisted();
    return this.data[key];
  }

  set(key, value) {
    this.adoptPersisted();
    this.data[key] = value;
    return this._save();
  }

  getMusicVolume() {
    this.adoptPersisted();
    return this.data.musicVolume;
  }
  setMusicVolume(v) {
    this.set('musicVolume', Math.max(0, Math.min(1, v)));
  }

  getSFXVolume() {
    this.adoptPersisted();
    return this.data.sfxVolume;
  }
  setSFXVolume(v) {
    this.set('sfxVolume', Math.max(0, Math.min(1, v)));
  }

  getHints() {
    this.adoptPersisted();
    return this.data.hints;
  }
  setHints(value) {
    return this.set('hints', !!value);
  }

  getSkipSeenDialogue() {
    return this.get('skipSeenDialogue') === true;
  }
  setSkipSeenDialogue(value) {
    return this.set('skipSeenDialogue', value === true);
  }

  getBattleSpeed() {
    this.adoptPersisted();
    return this.data.battleSpeed;
  }
  setBattleSpeed(value) {
    if (!BATTLE_SPEEDS.includes(value)) return { ok: false, reason: 'invalid_speed' };
    return this.set('battleSpeed', value);
  }

  getReduceMotion() {
    this.adoptPersisted();
    return this.data.reduceMotion;
  }
  setReduceMotion(value) {
    return this.set('reduceMotion', !!value);
  }
  getEffectsQuality() {
    this.adoptPersisted();
    return this.data.effectsQuality;
  }
  setEffectsQuality(value) {
    if (!['high', 'low'].includes(value)) return { ok: false, reason: 'invalid_quality' };
    return this.set('effectsQuality', value);
  }

  _save() {
    this.data.savedAt = Math.max(Date.now(), Number(this.data.savedAt || 0) + 1);
    let localOk = false;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      localOk = true;
    } catch (err) {
      console.warn('[Settings] localStorage write failed:', err?.message || err);
    }

    if (localOk && this.onSave) {
      try {
        this.onSave(this.data);
      } catch (err) {
        console.warn('[Settings] onSave callback error:', err?.message || err);
      }
    }

    return { ok: localOk };
  }
}

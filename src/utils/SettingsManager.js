// SettingsManager — Pure class wrapping localStorage for user settings
// No Phaser deps.

const STORAGE_KEY = 'emblem_rogue_settings';

function detectMobileUA() {
  try {
    const ua = globalThis?.navigator?.userAgent || '';
    return /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|IEMobile|Opera Mini/i.test(ua);
  } catch (_) {
    return false;
  }
}

const DEFAULTS = {
  musicVolume: 0.5,
  sfxVolume: 0.7,
  reducedEffects: detectMobileUA(),
};

export class SettingsManager {
  constructor() {
    this.onSave = null;
    this.data = { ...DEFAULTS };
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw);
        for (const key of Object.keys(DEFAULTS)) {
          if (saved[key] !== undefined) this.data[key] = saved[key];
        }
      }
    } catch (_) { /* incognito / quota exceeded */ }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this._save();
  }

  getMusicVolume() { return this.data.musicVolume; }
  setMusicVolume(v) { this.set('musicVolume', Math.max(0, Math.min(1, v))); }

  getSFXVolume() { return this.data.sfxVolume; }
  setSFXVolume(v) { this.set('sfxVolume', Math.max(0, Math.min(1, v))); }

  getReducedEffects() { return !!this.data.reducedEffects; }
  setReducedEffects(v) { this.set('reducedEffects', !!v); }

  _save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (_) { /* incognito / quota exceeded */ }
    if (this.onSave) this.onSave(this.data);
  }
}

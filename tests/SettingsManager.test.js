import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettingsManager, normalizeSettings } from '../src/utils/SettingsManager.js';

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, val) => {
    store[key] = val;
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

describe('SettingsManager', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses default values when no saved data', () => {
    const sm = new SettingsManager();
    expect(sm.getMusicVolume()).toBe(0.5);
    expect(sm.getSFXVolume()).toBe(0.7);
    expect(typeof sm.getReduceMotion()).toBe('boolean');
  });

  it('loads saved values from localStorage', () => {
    store['emblem_rogue_settings'] = JSON.stringify({
      musicVolume: 0.3,
      sfxVolume: 0.8,
      reducedEffects: true,
    });
    const sm = new SettingsManager();
    expect(sm.getMusicVolume()).toBe(0.3);
    expect(sm.getSFXVolume()).toBe(0.8);
    expect(sm.getEffectsQuality()).toBe('low');
  });

  it('ignores unknown keys in saved data', () => {
    store['emblem_rogue_settings'] = JSON.stringify({ musicVolume: 0.3, unknownKey: 42 });
    const sm = new SettingsManager();
    expect(sm.getMusicVolume()).toBe(0.3);
    expect(sm.get('unknownKey')).toBeUndefined();
  });

  it('set() persists to localStorage', () => {
    const sm = new SettingsManager();
    sm.setMusicVolume(0.2);
    expect(localStorageMock.setItem).toHaveBeenCalled();
    const saved = JSON.parse(store['emblem_rogue_settings']);
    expect(saved.musicVolume).toBeCloseTo(0.2);
  });

  it('clamps volume to 0-1 range', () => {
    const sm = new SettingsManager();
    sm.setMusicVolume(-0.5);
    expect(sm.getMusicVolume()).toBe(0);
    sm.setSFXVolume(1.5);
    expect(sm.getSFXVolume()).toBe(1);
  });

  it('get/set work for arbitrary keys', () => {
    const sm = new SettingsManager();
    sm.set('musicVolume', 0.9);
    expect(sm.get('musicVolume')).toBe(0.9);
  });

  it('persists independent motion and quality settings', () => {
    const sm = new SettingsManager();
    sm.setReduceMotion(true);
    sm.setEffectsQuality('low');
    expect(sm.getEffectsQuality()).toBe('low');
    const saved = JSON.parse(store['emblem_rogue_settings']);
    expect(saved.reduceMotion).toBe(true);
    expect(saved.effectsQuality).toBe('low');
    expect(saved.reducedEffects).toBeUndefined();
  });

  it('survives localStorage throwing', () => {
    localStorageMock.getItem.mockImplementationOnce(() => {
      throw new Error('blocked');
    });
    const sm = new SettingsManager();
    expect(sm.getMusicVolume()).toBe(0.5); // falls back to defaults
  });
});

describe('effects settings migration', () => {
  it.each([
    [{ reducedEffects: true }, false, 'low'],
    [{ reducedEffects: false }, false, 'high'],
    [{ reducedEffects: true, reduceMotion: false }, false, 'low'],
    [{ reducedEffects: true, effectsQuality: 'high' }, false, 'high'],
    [{ reducedEffects: true, reduceMotion: false, effectsQuality: 'high' }, false, 'high'],
    [{ reducedEffects: true, reduceMotion: 'false', effectsQuality: 'ultra' }, false, 'low'],
    [{ reduceMotion: true, effectsQuality: 'low' }, true, 'low'],
    [null, false, 'high'],
  ])('normalizes legacy and partial keys %j', (saved, motion, quality) => {
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    expect(normalizeSettings(saved)).toMatchObject({
      reduceMotion: motion,
      effectsQuality: quality,
    });
    vi.unstubAllGlobals();
  });
  it('respects OS preference without overriding an explicit new choice', () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    expect(normalizeSettings({ reducedEffects: false }).reduceMotion).toBe(true);
    expect(normalizeSettings({ reducedEffects: true })).toMatchObject({
      reduceMotion: true,
      effectsQuality: 'low',
    });
    expect(normalizeSettings({ reduceMotion: false }).reduceMotion).toBe(false);
    vi.unstubAllGlobals();
  });
  it('persists migration once and keeps quality independent from motion', () => {
    store.emblem_rogue_settings = JSON.stringify({ reducedEffects: true });
    const settings = new SettingsManager();
    expect(settings.migrationResult).toEqual({ ok: true });
    expect(settings.getReduceMotion()).toBe(false);
    settings.setReduceMotion(true);
    settings.setEffectsQuality('high');
    expect(settings.getReduceMotion()).toBe(true);
    settings.setReduceMotion(false);
    expect(settings.getEffectsQuality()).toBe('high');
    expect(new SettingsManager().migrationResult).toBeNull();
    expect(settings.setEffectsQuality('invalid').ok).toBe(false);
  });
  it('does not claim durability when migration write fails; retries on next startup', () => {
    store.emblem_rogue_settings = JSON.stringify({ reducedEffects: true });
    localStorageMock.setItem.mockImplementationOnce(() => {
      throw new Error('quota');
    });
    expect(new SettingsManager().migrationResult).toEqual({ ok: false });
    expect(JSON.parse(store.emblem_rogue_settings)).toEqual({ reducedEffects: true });
    expect(new SettingsManager().migrationResult).toEqual({ ok: true });
  });
});

describe('battle speed setting', () => {
  it.each(['normal', 'fast', 'instant'])('persists %s independently', (speed) => {
    const settings = new SettingsManager();
    settings.setReduceMotion(true);
    settings.setEffectsQuality('low');
    expect(settings.setBattleSpeed(speed).ok).toBe(true);
    const restored = new SettingsManager();
    expect(restored.getBattleSpeed()).toBe(speed);
    expect(restored.getReduceMotion()).toBe(true);
    expect(restored.getEffectsQuality()).toBe('low');
    expect(restored.setBattleSpeed('turbo').ok).toBe(false);
    expect(restored.getBattleSpeed()).toBe(speed);
  });
  it('defaults old and invalid settings to normal', () => {
    expect(normalizeSettings({ reducedEffects: true }).battleSpeed).toBe('normal');
    expect(normalizeSettings({ battleSpeed: 2 }).battleSpeed).toBe('normal');
  });
});

it('adopts newer cloud settings before editing a different setting', () => {
  const settings = new SettingsManager();
  settings.setBattleSpeed('normal');
  localStorage.setItem(
    'emblem_rogue_settings',
    JSON.stringify({
      ...settings.data,
      battleSpeed: 'fast',
      effectsQuality: 'low',
      savedAt: settings.data.savedAt + 50,
    }),
  );
  expect(settings.getBattleSpeed()).toBe('fast');
  settings.setMusicVolume(0.2);
  expect(settings.getEffectsQuality()).toBe('low');
  expect(JSON.parse(localStorage.getItem('emblem_rogue_settings')).battleSpeed).toBe('fast');
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettingsManager, normalizeSettings } from '../src/utils/SettingsManager.js';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key) => store[key] ?? null),
    setItem: vi.fn((key, val) => {
      store[key] = val;
    }),
    removeItem: vi.fn((key) => {
      delete store[key];
    }),
  },
  writable: true,
});

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

describe('Atmosphere setting', () => {
  it('defaults to auto (device default) for new and existing saves', () => {
    expect(normalizeSettings().atmosphere).toBe('auto');
    expect(normalizeSettings({ musicVolume: 0.2 }).atmosphere).toBe('auto');
    expect(normalizeSettings({ atmosphere: 'ultra' }).atmosphere).toBe('auto');
    expect(normalizeSettings({ atmosphere: 42 }).atmosphere).toBe('auto');
    for (const mode of ['full', 'reduced', 'off'])
      expect(normalizeSettings({ atmosphere: mode }).atmosphere).toBe(mode);
  });

  it('migrates an existing save once, keeping every earlier choice', () => {
    store.emblem_rogue_settings = JSON.stringify({
      savedAt: 5,
      hints: false,
      skipSeenDialogue: true,
      battleSpeed: 'fast',
      musicVolume: 0.1,
      sfxVolume: 0.2,
      reduceMotion: true,
      effectsQuality: 'low',
    });
    const settings = new SettingsManager();
    expect(settings.migrationResult).toEqual({ ok: true });
    expect(settings.getAtmosphere()).toBe('auto');
    const saved = JSON.parse(store.emblem_rogue_settings);
    expect(saved).toMatchObject({
      hints: false,
      skipSeenDialogue: true,
      battleSpeed: 'fast',
      musicVolume: 0.1,
      sfxVolume: 0.2,
      reduceMotion: true,
      effectsQuality: 'low',
      atmosphere: 'auto',
    });
    expect(new SettingsManager().migrationResult).toBeNull();
  });

  it('persists explicit choices and rejects invalid ones', () => {
    const settings = new SettingsManager();
    expect(settings.setAtmosphere('off').ok).toBe(true);
    expect(new SettingsManager().getAtmosphere()).toBe('off');
    expect(settings.setAtmosphere('reduced').ok).toBe(true);
    expect(settings.setAtmosphere('bright')).toEqual({ ok: false, reason: 'invalid_atmosphere' });
    expect(new SettingsManager().getAtmosphere()).toBe('reduced');
  });

  it('notifies change listeners live and unsubscribes cleanly', () => {
    const settings = new SettingsManager();
    const seen = [];
    const off = settings.onChange((data) => seen.push(data.atmosphere));
    settings.setAtmosphere('full');
    settings.setEffectsQuality('low');
    expect(seen).toEqual(['full', 'full']);
    off();
    settings.setAtmosphere('off');
    expect(seen).toHaveLength(2);
  });

  it('a throwing listener never breaks saving or other listeners', () => {
    const settings = new SettingsManager();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const calls = [];
    settings.onChange(() => {
      throw new Error('boom');
    });
    settings.onChange(() => calls.push(1));
    expect(settings.setAtmosphere('off').ok).toBe(true);
    expect(calls).toEqual([1]);
    warn.mockRestore();
  });

  it('adopting newer settings from another writer (cloud hydration) notifies too', () => {
    const settings = new SettingsManager();
    const seen = [];
    settings.onChange((data) => seen.push(data.atmosphere));
    store.emblem_rogue_settings = JSON.stringify({
      ...settings.data,
      atmosphere: 'off',
      savedAt: Number(settings.data.savedAt || 0) + 1000,
    });
    expect(settings.getAtmosphere()).toBe('off');
    expect(seen).toEqual(['off']);
  });
});

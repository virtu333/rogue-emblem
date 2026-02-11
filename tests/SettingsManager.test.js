import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettingsManager } from '../src/utils/SettingsManager.js';

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] ?? null),
  setItem: vi.fn((key, val) => { store[key] = val; }),
  removeItem: vi.fn((key) => { delete store[key]; }),
};
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock, writable: true });

describe('SettingsManager', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    vi.clearAllMocks();
  });

  it('uses default values when no saved data', () => {
    const sm = new SettingsManager();
    expect(sm.getMusicVolume()).toBe(0.5);
    expect(sm.getSFXVolume()).toBe(0.7);
    expect(typeof sm.getReducedEffects()).toBe('boolean');
  });

  it('loads saved values from localStorage', () => {
    store['emblem_rogue_settings'] = JSON.stringify({ musicVolume: 0.3, sfxVolume: 0.8, reducedEffects: true });
    const sm = new SettingsManager();
    expect(sm.getMusicVolume()).toBe(0.3);
    expect(sm.getSFXVolume()).toBe(0.8);
    expect(sm.getReducedEffects()).toBe(true);
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

  it('persists reduced effects toggle', () => {
    const sm = new SettingsManager();
    sm.setReducedEffects(true);
    expect(sm.getReducedEffects()).toBe(true);
    const saved = JSON.parse(store['emblem_rogue_settings']);
    expect(saved.reducedEffects).toBe(true);
  });

  it('survives localStorage throwing', () => {
    localStorageMock.getItem.mockImplementationOnce(() => { throw new Error('blocked'); });
    const sm = new SettingsManager();
    expect(sm.getMusicVolume()).toBe(0.5); // falls back to defaults
  });
});

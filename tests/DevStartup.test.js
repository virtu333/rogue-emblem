import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import { parseDevStartupConfig, buildDevStartupRoute } from '../src/utils/devStartup.js';

function createRegistry() {
  const store = new Map();
  return {
    get(key) {
      return store.get(key);
    },
    set(key, value) {
      store.set(key, value);
      return value;
    },
  };
}

describe('dev startup helpers', () => {
  it('parses dev scene config from query string in dev mode', () => {
    const config = parseDevStartupConfig('?devScene=battle&preset=battle_smoke&seed=123&devTools=1', { devMode: true });
    expect(config).toEqual({
      enabled: true,
      sceneKey: 'Battle',
      preset: 'battle_smoke',
      seed: 123,
      difficultyId: 'normal',
      devTools: true,
      qaStep: null,
      qaDescription: null,
    });
  });

  it('ignores unknown scene aliases', () => {
    const config = parseDevStartupConfig('?devScene=unknown', { devMode: true });
    expect(config).toBeNull();
  });

  it('resolves qaStep without explicit scene', () => {
    const config = parseDevStartupConfig('?qaStep=4&devTools=1', { devMode: true });
    expect(config.sceneKey).toBe('NodeMap');
    expect(config.preset).toBe('weapon_arts');
    expect(config.qaStep).toBe(4);
    expect(config.devTools).toBe(true);
  });

  it('builds NodeMap route with weapon art preset state', () => {
    const gameData = loadGameData();
    const registry = createRegistry();
    const config = parseDevStartupConfig('?devScene=nodemap&preset=weapon_arts&seed=9&devTools=1', { devMode: true });
    const route = buildDevStartupRoute(gameData, registry, config);

    expect(route.key).toBe('NodeMap');
    expect(route.data.runManager).toBeTruthy();
    expect(route.data.runManager.scrolls.length).toBeGreaterThan(0);
    expect(route.data.runManager.gold).toBeGreaterThan(0);
    expect(registry.get('devToolsEnabled')).toBe(true);
  });

  it('builds battle smoke route with node and roster payload', () => {
    const gameData = loadGameData();
    const registry = createRegistry();
    const config = parseDevStartupConfig('?devScene=battle&preset=battle_smoke&seed=42', { devMode: true });
    const route = buildDevStartupRoute(gameData, registry, config);

    expect(route.key).toBe('Battle');
    expect(route.data.nodeId).toBeTruthy();
    expect(Array.isArray(route.data.roster)).toBe(true);
    expect(route.data.roster.length).toBeGreaterThan(0);
    expect(route.data.battleParams?.act).toBeTruthy();
  });

  it('builds late-act QA battle route from qaStep', () => {
    const gameData = loadGameData();
    const registry = createRegistry();
    const config = parseDevStartupConfig('?qaStep=7', { devMode: true });
    const route = buildDevStartupRoute(gameData, registry, config);

    expect(route.key).toBe('Battle');
    expect(config.qaStep).toBe(7);
    expect(route.data.battleParams).toBeTruthy();
    expect(route.data.runManager.currentAct).toBeTruthy();
  });
});

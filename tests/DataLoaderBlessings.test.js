import { describe, expect, it } from 'vitest';
import { DataLoader } from '../src/engine/DataLoader.js';

function makeMinimalPayload(path) {
  const defaults = {
    'data/terrain.json': [],
    'data/lords.json': [],
    'data/classes.json': [],
    'data/weapons.json': [],
    'data/skills.json': [],
    'data/mapSizes.json': [],
    'data/mapTemplates.json': {},
    'data/enemies.json': {},
    'data/consumables.json': [],
    'data/lootTables.json': {},
    'data/recruits.json': {},
    'data/metaUpgrades.json': [],
    'data/accessories.json': [],
    'data/whetstones.json': [],
    'data/turnBonus.json': {},
  };
  return defaults[path];
}

describe('DataLoader blessings integration', () => {
  it('loads successfully when optional blessings file is missing', async () => {
    const loader = new DataLoader();
    loader.loadJSON = async (path) => makeMinimalPayload(path);
    loader.loadOptionalJSON = async () => null;
    const data = await loader.loadAll();
    expect(data.blessings).toBeNull();
  });

  it('throws cleanly for invalid blessings payload', async () => {
    const loader = new DataLoader();
    loader.loadJSON = async (path) => makeMinimalPayload(path);
    loader.loadOptionalJSON = async () => ({ version: 1, blessings: [] });
    await expect(loader.loadAll()).rejects.toThrow('Invalid blessings data');
  });
});


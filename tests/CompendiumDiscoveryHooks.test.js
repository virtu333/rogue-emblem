// Compendium discovery, the scenes' hooks (review of PR #331): the battle and route-map
// scenes are where a save meets items and skills, so each hook is driven through the
// scene method that owns it and the outcome is read from the save's meta.
//
// Ways this can fail: a hook removed or moved off the path that runs (an exchange, an
// enemy status staff, the battle checkpoint, the route map's save); the foe path
// recording the foe's bag or the player's own side as met.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));

import { BattleScene } from '../src/scenes/BattleScene.js';
import { NodeMapScene } from '../src/scenes/NodeMapScene.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import { getMetaKey } from '../src/engine/SlotManager.js';
import { loadGameData } from './testData.js';

const store = new Map();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    key: (i) => [...store.keys()][i] ?? null,
    get length() {
      return store.size;
    },
  });
});

const gameData = loadGameData();
const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));
const consumable = (name) => structuredClone(gameData.consumables.find((c) => c.name === name));
const newMeta = () => new MetaProgressionManager(gameData.metaUpgrades, getMetaKey(1));
const registryWith = (meta) => {
  const values = new Map([
    ['activeSlot', 1],
    ['meta', meta],
  ]);
  return { get: (key) => values.get(key) ?? null, set: (key, value) => values.set(key, value) };
};

describe('BattleScene discovery hooks', () => {
  it('an exchange records the foe in hand (weapon, ring, skills), never its bag or the player', async () => {
    const meta = newMeta();
    const scene = Object.create(BattleScene.prototype);
    scene.registry = registryWith(meta);
    scene._runCombatResolutionAtSpeed = vi.fn(async () => ({ result: {}, selectedArt: null }));
    const player = { faction: 'player', weapon: weapon('Rapier'), skills: ['sol'] };
    const foe = {
      faction: 'enemy',
      weapon: weapon('Gravesong'),
      accessory: { name: 'Power Ring', type: 'Accessory' },
      inventory: [weapon('Silver Sword')],
      consumables: [consumable('Elixir')],
      skills: ['luna'],
    };
    await scene._runCombatResolution(player, foe, {});
    expect(scene._runCombatResolutionAtSpeed).toHaveBeenCalledTimes(1);
    expect(meta.itemsSeen).toEqual(['Gravesong', 'Power Ring']);
    expect(meta.skillsSeen).toEqual(['luna']);
    // Persisted with the save, not only in memory.
    expect(newMeta().hasSeenItem('Gravesong')).toBe(true);
  });

  it("an enemy's status staff is met when it is raised against the army", async () => {
    const meta = newMeta();
    const scene = Object.create(BattleScene.prototype);
    scene.registry = registryWith(meta);
    const staff = weapon('Silence Staff');
    expect(staff).toBeTruthy();
    const enemy = { faction: 'enemy', name: 'Cleric', statusStaff: staff, weapon: null };
    // The rest of the cast needs a live scene; the record is made before any of it.
    await scene
      .executeEnemyStatusStaff(enemy, { faction: 'player', name: 'Edric' })
      .catch(() => {});
    expect(meta.hasSeenItem('Silence Staff')).toBe(true);
  });

  it('the battle checkpoint records what the run now holds', () => {
    const meta = newMeta();
    const scene = new BattleScene();
    scene.init({ gameData: { skills: [] } });
    scene.registry = registryWith(meta);
    scene.runManager = new RunManager({});
    scene.runManager.roster = [{ name: 'Edric', weapon: weapon('Rapier'), skills: ['sol'] }];
    scene.runManager.beginBattleInProgress('n1', {});
    expect(scene._persistBattleRunState(null, { session: scene._battleSession }).ok).toBe(true);
    expect(meta.hasSeenItem('Rapier')).toBe(true);
    expect(meta.hasSeenSkill('sol')).toBe(true);
  });
});

describe('NodeMapScene discovery hook', () => {
  it("the route map's run save records a shop's stock and the convoy", () => {
    const meta = newMeta();
    const scene = Object.create(NodeMapScene.prototype);
    scene.registry = registryWith(meta);
    scene.runManager = new RunManager({});
    scene.runManager.shopStateByNodeId = { n2: { items: [{ item: weapon('Silver Lance') }] } };
    scene.runManager.convoy.weapons.push(weapon('Steel Axe'));
    expect(scene.persistRunSave().ok).toBe(true);
    expect(meta.hasSeenItem('Silver Lance')).toBe(true);
    expect(meta.hasSeenItem('Steel Axe')).toBe(true);
  });
});

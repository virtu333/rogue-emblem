// A route-map node tagged "Caravan" keeps its promise (playtest 2026-09-29): the battle
// map is chosen from templates that can carry a merchant, a layout with no room for her
// is drawn again from the same seed, and a map that still finds none drops the tag.
import { describe, it, expect, vi } from 'vitest';
import { generateNodeMap, pickTemplateForNode } from '../src/engine/NodeMapGenerator.js';
import { generateBattle, generateBattleLayout } from '../src/engine/MapGenerator.js';
import { validateMapTemplatesConfig } from '../src/engine/MapTemplateEngine.js';
import { templateAllowsCaravan } from '../src/engine/CaravanSystem.js';
import { RunManager } from '../src/engine/RunManager.js';
import { NODE_TYPES } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function withSeed(seed, fn) {
  const original = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = original;
  }
}

const ACTS = ['act2', 'act3', 'act4'];
const SEEDS = 40;
const DEPLOY_COUNTS = [3, 4, 5, 6];

// Every BATTLE node that rolled a caravan, over seeded act maps (bonus 1 makes every
// eligible BATTLE node roll one, so the property sees rout and seize nodes alike).
function caravanNodes() {
  const out = [];
  for (const act of ACTS)
    for (let s = 1; s <= SEEDS; s++) {
      const map = withSeed(s * 131 + act.charCodeAt(3) * 977, () =>
        generateNodeMap(act, { name: act, rows: 9 }, data.mapTemplates, { caravanChanceBonus: 1 }),
      );
      for (const node of map.nodes)
        if (node.type === NODE_TYPES.BATTLE && node.battleParams?.hasCaravan)
          out.push({ act, node });
    }
  return out;
}
const nodes = caravanNodes();

describe('a caravan-tagged node gets a caravan', () => {
  it('covers rout and seize nodes in every eligible act', () => {
    expect(new Set(nodes.map((n) => n.act))).toEqual(new Set(ACTS));
    expect(new Set(nodes.map((n) => n.node.battleParams.objective))).toEqual(
      new Set(['rout', 'seize']),
    );
    expect(nodes.length).toBeGreaterThan(300);
  });

  it('places one on every generated battle, whatever the deploy count', () => {
    const misses = [];
    for (const { act, node } of nodes)
      for (const deployCount of DEPLOY_COUNTS) {
        const params = { ...node.battleParams, deployCount, difficultyId: 'normal' };
        const config = withSeed(params.battleSeed + deployCount, () =>
          generateBattle(params, data),
        );
        if (!config.caravanSpawn)
          misses.push(`${act}/${node.id}/${config.templateId}/${deployCount}`);
      }
    expect(misses).toEqual([]);
  }, 120_000);

  it('is the same map and caravan for the same seed', () => {
    for (const { node } of nodes.slice(0, 40)) {
      const params = { ...node.battleParams, deployCount: 4, difficultyId: 'normal' };
      const run = () => withSeed(params.battleSeed, () => generateBattle(params, data));
      expect(run()).toEqual(run());
    }
  });
});

describe('template choice for a caravan node', () => {
  it('marks the cramped templates and leaves the rest open', () => {
    const flagged = Object.values(data.mapTemplates)
      .flat()
      .filter((t) => !templateAllowsCaravan(t))
      .map((t) => t.id)
      .sort();
    expect(flagged).toEqual(['chokepoint', 'great_hall']);
  });

  it('never gives a caravan node a template marked caravan: false', () => {
    for (const { node } of nodes) {
      const id = node.templateId;
      const template = Object.values(data.mapTemplates)
        .flat()
        .find((t) => t.id === id);
      expect(template?.caravan, `${node.id} -> ${id}`).not.toBe(false);
      expect(node.battleParams.templateId).toBe(id);
    }
  });

  it('still hands those templates to nodes without a caravan', () => {
    const picked = new Set();
    for (let s = 1; s <= 200; s++)
      picked.add(withSeed(s, () => pickTemplateForNode('seize', data.mapTemplates, 'act3')).id);
    expect(picked.has('great_hall')).toBe(true);
    const withCaravan = new Set();
    for (let s = 1; s <= 200; s++)
      withCaravan.add(
        withSeed(s, () =>
          pickTemplateForNode('seize', data.mapTemplates, 'act3', false, null, { caravan: true }),
        ).id,
      );
    expect(withCaravan.has('great_hall')).toBe(false);
    expect(withCaravan.size).toBeGreaterThan(1);
  });

  it('spends one random draw either way, so the node rolls after it do not shift', () => {
    for (const caravan of [false, true]) {
      const spy = vi.spyOn(Math, 'random');
      pickTemplateForNode('seize', data.mapTemplates, 'act3', false, 'castle', { caravan });
      expect(spy).toHaveBeenCalledTimes(1);
      spy.mockRestore();
    }
  });

  it('keeps a template when nothing else fits', () => {
    const only = { seize: [{ id: 'great_hall', name: 'Great Hall', caravan: false }] };
    expect(pickTemplateForNode('seize', only, 'act3', false, null, { caravan: true }).id).toBe(
      'great_hall',
    );
  });
});

describe('a layout with no room for the merchant is drawn again', () => {
  const params = {
    act: 'act3',
    objective: 'seize',
    templateId: 'great_hall',
    hasCaravan: true,
    deployCount: 6,
    difficultyId: 'normal',
  };

  it('finds a caravan on a template whose first layout often has none', () => {
    let firstMisses = 0;
    let finalMisses = 0;
    for (let s = 1; s <= 80; s++) {
      if (!withSeed(s, () => generateBattleLayout(params, data)).caravanSpawn) firstMisses++;
      if (!withSeed(s, () => generateBattle(params, data)).caravanSpawn) finalMisses++;
    }
    expect(firstMisses).toBeGreaterThan(10);
    expect(finalMisses).toBeLessThanOrEqual(1);
  });

  it('leaves a first layout that fits untouched', () => {
    let fitted = 0;
    for (let s = 1; s <= 30; s++) {
      const first = withSeed(s, () => generateBattleLayout(params, data));
      if (!first.caravanSpawn) continue;
      fitted++;
      expect(withSeed(s, () => generateBattle(params, data))).toEqual(first);
    }
    expect(fitted).toBeGreaterThan(5);
  });

  it('is deterministic when it retries', () => {
    for (let s = 1; s <= 20; s++)
      expect(withSeed(s, () => generateBattle(params, data))).toEqual(
        withSeed(s, () => generateBattle(params, data)),
      );
  });
});

describe('the route-map tag follows the locked map', () => {
  function runWithCaravanNode() {
    const rm = new RunManager(data);
    rm.startRun();
    const node = rm.nodeMap.nodes.find((n) => n.type === NODE_TYPES.BATTLE && n.battleParams);
    node.battleParams.hasCaravan = true;
    return { rm, node };
  }

  it('drops the tag when the locked map has no caravan', () => {
    const { rm, node } = runWithCaravanNode();
    rm.lockBattleConfig(node.id, { cols: 9, rows: 7, objective: 'rout' });
    expect(node.battleParams.hasCaravan).toBe(false);
  });

  it('keeps the tag when the locked map placed one', () => {
    const { rm, node } = runWithCaravanNode();
    rm.lockBattleConfig(node.id, {
      cols: 9,
      rows: 7,
      objective: 'rout',
      caravanSpawn: { col: 4, row: 3, exit: { dc: 0, dr: 1 } },
    });
    expect(node.battleParams.hasCaravan).toBe(true);
  });

  it('settles a save whose locked map never had one', () => {
    const { rm, node } = runWithCaravanNode();
    rm.lockBattleConfig(node.id, {
      cols: 9,
      rows: 7,
      objective: 'rout',
      caravanSpawn: { col: 1, row: 1 },
    });
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    delete saved.battleConfigsByNodeId[node.id].caravanSpawn;
    const restored = RunManager.fromJSON(saved, data);
    const restoredNode = restored.nodeMap.nodes.find((n) => n.id === node.id);
    expect(restoredNode.battleParams.hasCaravan).toBe(false);
    // The lock itself is untouched: no reroll.
    expect(restored.getLockedBattleConfig(node.id).objective).toBe('rout');
  });

  it('leaves an unlocked node tagged', () => {
    const { rm, node } = runWithCaravanNode();
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    expect(restored.nodeMap.nodes.find((n) => n.id === node.id).battleParams.hasCaravan).toBe(true);
  });
});

describe('the caravan template flag is data', () => {
  const clone = () => structuredClone(data.mapTemplates);

  it('ships valid', () => {
    expect(validateMapTemplatesConfig(clone()).errors).toEqual([]);
  });

  it('must be a boolean', () => {
    const bad = clone();
    bad.rout[0].caravan = 'no';
    const { errors } = validateMapTemplatesConfig(bad);
    expect(errors.some((e) => e.includes('caravan must be a boolean'))).toBe(true);
  });
});

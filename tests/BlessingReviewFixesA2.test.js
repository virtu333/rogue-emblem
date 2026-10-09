// Review fixes for the Task 2 blessings (Advance Pay, Quartermaster Cache, Blood Forge) and the
// blessing names. Each test names a way the first pass could fail.
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => store[key] ?? null,
    setItem: (key, val) => {
      store[key] = String(val);
    },
    removeItem: (key) => {
      delete store[key];
    },
  },
  configurable: true,
  writable: true,
});

const data = loadGameData();

function plainRun(seed = 7001) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, applyBlessingsAtStart: false });
  return rm;
}

function runHolding(id) {
  const rm = plainRun();
  rm.activeBlessings = [{ id, rolledCost: null }];
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
  return rm;
}

describe('a blessing never shares a name with an item', () => {
  // Item names are identity (saves, weapon-art gates, icons key on them): a card called
  // "Holdfast" next to Cael's Holdfast axe would read as the same thing.
  it('no blessing is named after a weapon, accessory, consumable, whetstone or imbue', () => {
    const itemNames = new Set(
      [
        ...data.weapons,
        ...(data.accessories || []),
        ...(Array.isArray(data.consumables) ? data.consumables : []),
        ...(data.whetstones?.whetstones || data.whetstones || []),
        ...(data.imbues?.imbues || []),
        // The imbue's stone and the Prismatic Stone are the real inventory items.
        ...(data.imbues?.imbues || []).map((imbue) => imbue.stone),
        data.imbues?.prismaticStone,
      ]
        .map((item) => item?.name)
        .filter(Boolean),
    );
    expect(itemNames.has('Holdfast')).toBe(true); // Cael's axe: the guard sees real names
    expect(itemNames.has('Vampiric Imbuing Stone')).toBe(true);
    expect(itemNames.has('Prismatic Stone')).toBe(true);
    const clashes = data.blessings.blessings
      .filter((b) => itemNames.has(b.name))
      .map((b) => `${b.id}: ${b.name}`);
    expect(clashes).toEqual([]);
  });

  it('the stationary blessing keeps its id and reads Hold the Line', () => {
    const row = data.blessings.blessings.find((b) => b.id === 'terrain_mastery');
    expect(row.name).toBe('Hold the Line');
  });
});

describe('Advance Pay history', () => {
  it('records the recurring amount at the shrine, not an applied amount nothing paid', () => {
    const rm = runHolding('coin_of_fate');
    const record = rm.blessingHistory.find((e) => e.effectType === 'act_start_gold');
    expect(record.details.recurringValue).toBe(250);
    expect(record.details).not.toHaveProperty('appliedValue');
    // The 500 the shrine did pay is still recorded as applied.
    const paid = rm.blessingHistory.find((e) => e.effectType === 'gold_delta');
    expect(paid.details.appliedValue).toBe(500);
  });
});

describe('Quartermaster Cache history stage', () => {
  const stages = (rm) =>
    rm.blessingHistory
      .filter((e) => e.effectType === 'act_start_convoy_item' && e.details.act)
      .map((e) => e.stage);

  it('a cache taken at the shrine records its first delivery as run_start', () => {
    expect(stages(runHolding('quartermaster_cache'))).toEqual(['run_start']);
  });

  it('a cache taken at a church records its first delivery as mid_run, later ones as act_transition', () => {
    const rm = plainRun();
    rm.advanceAct();
    expect(rm.addBlessingMidRun('quartermaster_cache')).toBe(true);
    expect(stages(rm)).toEqual(['mid_run']);
    rm.advanceAct();
    expect(stages(rm)).toEqual(['mid_run', 'act_transition']);
  });
});

describe('Blood Forge price', () => {
  it('a Blood-Forged weapon sells for what it did before', () => {
    const base = plainRun();
    const steelPrice = base.roster
      .find((u) => u.name === 'Edric')
      .inventory.find((w) => w.name === 'Steel Sword').price;
    const rm = runHolding('blood_forge');
    const steel = rm.roster
      .find((u) => u.name === 'Edric')
      .inventory.find((w) => w._baseName === 'Steel Sword');
    expect(steel._forgeLevel).toBe(2);
    expect(steel.price).toBe(steelPrice);
    const glimmer = rm.roster
      .find((u) => u.name === 'Sera')
      .inventory.find((w) => w._baseName === 'Glimmer');
    const baseGlimmer = base.roster
      .find((u) => u.name === 'Sera')
      .inventory.find((w) => w.name === 'Glimmer');
    expect(glimmer.price).toBe(baseGlimmer.price);
  });
});

describe('blessing card text', () => {
  // The longest description in the catalog (Bloodless Art, 100 characters) is laid out in the
  // widest hand below; a longer one needs the cap raised AND a look at the layout specs.
  const LONGEST_ALLOWED = 100;

  it('Nomad’s Pact reads short enough for the card, and no description passes the longest laid out', () => {
    const rows = data.blessings.blessings;
    expect(rows.find((b) => b.id === 'nomad_pact').description.length).toBeLessThanOrEqual(82);
    const longest = rows.map((b) => b.description.length).reduce((a, c) => Math.max(a, c), 0);
    expect(longest).toBeLessThanOrEqual(LONGEST_ALLOWED);
  });

  it('the widest real hand in the layout specs holds the three longest descriptions', () => {
    // tests/e2e/choice-screens.spec.js and portrait-cards.spec.js lay out this hand. A new
    // longer card must be added to it, or its text goes unmeasured.
    const rows = data.blessings.blessings;
    const longestThree = [...rows]
      .sort((a, b) => b.description.length - a.description.length)
      .slice(0, 3)
      .map((b) => b.id)
      .sort();
    expect(longestThree).toEqual(['bloodless_art', 'slow_fuse', 'terrain_mastery']);
    for (const spec of ['choice-screens', 'portrait-cards']) {
      const source = readFileSync(`tests/e2e/${spec}.spec.js`, 'utf8');
      for (const id of longestThree)
        expect(source, `${spec} lays out ${id}`).toMatch(
          new RegExp(`\\[[^\\]]*'${id}'[^\\]]*\\]\\.map|ids = \\[[^\\]]*'${id}'`),
        );
    }
  });
});

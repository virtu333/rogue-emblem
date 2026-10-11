// Compendium discovery (playtest 2026-10-11): Arms, Items and Skills entries fill in as a
// save meets them (offered, owned, or used against the army) and stay "???" until then.
// A legendary weapon's entry shows its weapon arts in the shop's words.
//
// Ways this can fail, each pinned below: a forged or worn copy recorded under its "+N"
// name (the entry never fills in); offered items (a reward's choices, a shop's stock)
// missed; a foe's bag counted as met; the record lost on reload, on a stale manager's
// save or on an old save's load (no backfill); a locked entry leaking its name, picture
// or text (list, detail or search); the legendary's art missing from its entry.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));

import {
  discoveriesFromMetaSave,
  discoveriesInRun,
  discoveriesOfFoes,
  discoveriesOfMetaSave,
  discoveriesInUpgrades,
  discoveryView,
  itemCatalogNames,
  mergeSeen,
  recordFoesEncountered,
  recordRunDiscoveries,
  withDiscoveryKeys,
} from '../src/engine/CompendiumDiscovery.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import {
  discoveriesAcrossSlots,
  getMetaKey,
  getRunKey,
  getSlotSummary,
} from '../src/engine/SlotManager.js';
import { CompendiumOverlay, TAB_DEFS } from '../src/ui/CompendiumOverlay.js';
import { compendiumEntries } from '../src/ui/ReferenceMenu.js';
import { LOCKED_NAME } from '../src/ui/compendiumLocked.js';
import { saveServiceRun } from '../src/ui/serviceSave.js';
import { loadGameData } from './testData.js';

const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null)),
  setItem: vi.fn((key, val) => {
    store[key] = String(val);
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
  key: vi.fn((i) => Object.keys(store)[i] ?? null),
  get length() {
    return Object.keys(store).length;
  },
};
Object.defineProperty(globalThis, 'localStorage', {
  value: localStorageMock,
  configurable: true,
  writable: true,
});

// These tests count every catalog entry, so they read the Descent as on (a dark build lists
// fewer: tests/DescentReferenceGating.test.js).
const gameData = { ...loadGameData(), descent: { enabled: true } };
const META_1 = getMetaKey(1);
const weapon = (name) => structuredClone(gameData.weapons.find((w) => w.name === name));
const tab = (key) => TAB_DEFS.findIndex((t) => t.key === key);
/** A raw meta save that has met these (as the current build writes it). */
const seenSave = (found, extra = {}) => ({
  ...extra,
  purchasedUpgrades: withDiscoveryKeys(extra.purchasedUpgrades, found),
});

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  localStorageMock.setItem.mockClear();
});

function metaWrites() {
  return localStorageMock.setItem.mock.calls.filter(([key]) => key === META_1).length;
}

describe('what a run shows as met', () => {
  it('reads every unit, store, unclaimed reward and shop, by catalog name', () => {
    const forged = { ...weapon('Iron Sword'), name: 'Iron Sword +2', _baseName: 'Iron Sword' };
    const worn = { ...weapon('Steel Axe'), name: 'Steel Axe -1', _baseName: 'Steel Axe' };
    const run = {
      roster: [
        {
          name: 'Edric',
          weapon: forged,
          inventory: [forged, worn],
          consumables: [{ name: 'Vulnerary', type: 'Consumable' }],
          accessory: { name: 'Power Ring', type: 'Accessory', _boundSkill: 'vantage' },
          skills: ['sol'],
          benchedSkills: ['luna'],
        },
      ],
      fallenUnits: [{ name: 'Gil', inventory: [weapon('Javelin')], skills: ['pavise'] }],
      convoy: { weapons: [weapon('Hand Axe')], consumables: [{ name: 'Elixir' }] },
      accessories: [{ name: 'Speed Ring' }],
      scrolls: [{ name: 'Astra Scroll', type: 'Scroll', skillId: 'astra' }],
      pendingBattleReward: {
        choices: [
          { type: 'weapon', item: weapon('Starfall') },
          { type: 'gold', goldAmount: 50 },
        ],
      },
      shopStateByNodeId: { n3: { items: [{ item: weapon('Rapier'), price: 1000 }] } },
      activeCaravanShop: { shopState: { items: [{ item: { name: 'Master Seal' } }] } },
    };
    const found = discoveriesInRun(run);
    expect(found.items).toEqual(
      [
        'Astra Scroll',
        'Elixir',
        'Hand Axe',
        'Iron Sword',
        'Javelin',
        'Master Seal',
        'Power Ring',
        'Rapier',
        'Speed Ring',
        'Starfall',
        'Steel Axe',
        'Vulnerary',
      ].sort(),
    );
    expect(found.skills).toEqual(['astra', 'luna', 'pavise', 'sol', 'vantage']);
  });

  it('a foe shows the weapon in its hands and its skills, never its bag; allies show nothing', () => {
    const foe = {
      faction: 'enemy',
      weapon: weapon('Eldritch Grasp'),
      inventory: [weapon('Eldritch Grasp'), weapon('Silver Lance')],
      skills: ['vantage'],
    };
    const ally = { faction: 'player', weapon: weapon('Rapier'), skills: ['sol'] };
    expect(discoveriesOfFoes([foe, ally])).toEqual({
      items: ['Eldritch Grasp'],
      skills: ['vantage'],
    });
  });

  it('an old save backfills from its victory records and assigned skills', () => {
    const saved = {
      runRecords: [
        {
          roster: [
            {
              name: 'Edric',
              weapon: 'Rapier +1',
              items: ['Vulnerary'],
              accessory: 'Power Ring',
              skills: ['sol'],
            },
          ],
        },
      ],
      skillAssignments: { Sera: ['miracle'] },
    };
    expect(discoveriesFromMetaSave(saved)).toEqual({
      items: ['Power Ring', 'Rapier', 'Vulnerary'],
      skills: ['miracle', 'sol'],
    });
    // A save's keys are always unioned with its records (a copy that lost keys keeps
    // what its records show).
    expect(discoveriesOfMetaSave(seenSave({ items: ['Starfall'] }, saved))).toEqual({
      items: ['Power Ring', 'Rapier', 'Starfall', 'Vulnerary'],
      skills: ['miracle', 'sol'],
    });
  });

  it('drops junk and keeps a sorted set', () => {
    expect(mergeSeen(['b', 'a', 'b', '', 7, null, 'x'.repeat(81)], ['c'])).toEqual(['a', 'b', 'c']);
  });
});

describe('MetaProgressionManager discoveries', () => {
  it('records once, saves, and a reload keeps them', () => {
    const meta = new MetaProgressionManager(gameData.metaUpgrades, META_1);
    expect(meta.itemsSeen).toEqual([]);
    expect(meta.recordDiscoveries({ items: ['Starfall'], skills: ['sol'] })).toBe(true);
    expect(metaWrites()).toBe(1);
    expect(meta.recordDiscoveries({ items: ['Starfall'], skills: [] })).toBe(false);
    expect(meta.recordDiscoveries(undefined)).toBe(false);
    expect(metaWrites()).toBe(1);
    const reloaded = new MetaProgressionManager(gameData.metaUpgrades, META_1);
    expect(reloaded.hasSeenItem('Starfall')).toBe(true);
    expect(reloaded.hasSeenSkill('sol')).toBe(true);
    expect(reloaded.hasSeenItem('Rapier')).toBe(false);
  });

  it('an old save backfills from its records and its slot run on load', () => {
    store[META_1] = JSON.stringify({
      savedAt: 10,
      runRecords: [{ roster: [{ name: 'Edric', weapon: 'Rapier' }] }],
    });
    store[getRunKey(1)] = JSON.stringify({ roster: [{ name: 'Sera', weapon: weapon('Heal') }] });
    const meta = new MetaProgressionManager(gameData.metaUpgrades, META_1);
    expect(meta.itemsSeen).toEqual(['Heal', 'Rapier']);
  });

  it('an older build (fixed field list, max-merged upgrades) carries the discoveries through', () => {
    const level = 2;
    store[META_1] = JSON.stringify({ savedAt: 5, purchasedUpgrades: { recruit_hp_growth: level } });
    const meta = new MetaProgressionManager(gameData.metaUpgrades, META_1);
    meta.recordDiscoveries({ items: ['Starfall'], skills: ['sol'] });
    // What a build from before the lists does to a save: copy `purchasedUpgrades` whole,
    // max-merge it with a newer disk copy key by key, and write only the fields it knows
    // (its own `_save`'s list, as on main before PR #331).
    const OLDER_BUILD_FIELDS = [
      'balanceRevision',
      'solRefundBasis',
      'totalValor',
      'totalSupply',
      'purchasedUpgrades',
      'retiredUpgradeRefunds',
      'legacyTierCosts',
      'runsCompleted',
      'runsStarted',
      'lastDifficulty',
      'skillAssignments',
      'lordSelection',
      'milestones',
      'storyFlags',
      'runRecords',
      'settledRunIds',
      'seenDialogueKeys',
      'deedsEarned',
      'lordsMet',
      'hintState',
      'prologue',
      'savedAt',
    ];
    const loaded = JSON.parse(store[META_1]);
    const upgrades = { ...loaded.purchasedUpgrades };
    for (const [id, value] of Object.entries(loaded.purchasedUpgrades))
      upgrades[id] = Math.max(Number(upgrades[id]) || 0, Number(value) || 0);
    const olderSave = Object.fromEntries(
      OLDER_BUILD_FIELDS.map((key) => [key, key === 'purchasedUpgrades' ? upgrades : loaded[key]]),
    );
    store[META_1] = JSON.stringify(olderSave);
    const reloaded = new MetaProgressionManager(gameData.metaUpgrades, META_1);
    expect(reloaded.hasSeenItem('Starfall')).toBe(true);
    expect(reloaded.hasSeenSkill('sol')).toBe(true);
    // In memory the upgrades are upgrades only; the tier and the slot card's count are
    // what was bought.
    expect(reloaded.purchasedUpgrades).toEqual({ recruit_hp_growth: level });
    expect(reloaded.getUpgradeLevel('recruit_hp_growth')).toBe(level);
    expect(getSlotSummary(1).upgradesOwned).toBe(level);
  });

  it('an old save backfills renamed and imbued items under their catalog names', () => {
    store[META_1] = JSON.stringify({
      runRecords: [{ roster: [{ name: 'Edric', weapon: 'Killing Edge +2', items: ['Bolting'] }] }],
    });
    store[getRunKey(1)] = JSON.stringify({
      roster: [
        {
          name: 'Sera',
          weapon: {
            name: 'Vampiric Wo Dao +1',
            _baseName: 'Vampiric Wo Dao',
            _imbueId: 'vampiric',
          },
        },
      ],
    });
    const meta = new MetaProgressionManager(gameData.metaUpgrades, META_1);
    expect(meta.itemsSeen).toEqual(['Breachbolt', 'Jian', 'Keen Sword']);
    expect(itemCatalogNames({ name: 'Cruel Iron Sword', _imbueId: 'keen' })).toEqual([
      'Iron Sword',
    ]);
  });

  it('a stale manager adopting a newer disk save unions both lists', () => {
    const stale = new MetaProgressionManager(gameData.metaUpgrades, META_1);
    stale.recordDiscoveries({ items: ['Rapier'] });
    const other = new MetaProgressionManager(gameData.metaUpgrades, META_1);
    other.recordDiscoveries({ items: ['Starfall'] });
    stale.recordDiscoveries({ skills: ['luna'] });
    const disk = JSON.parse(store[META_1]);
    expect(discoveriesInUpgrades(disk.purchasedUpgrades)).toEqual({
      items: ['Rapier', 'Starfall'],
      skills: ['luna'],
    });
  });

  it('the hooks record a run and a foe, and do nothing without a meta', () => {
    const meta = new MetaProgressionManager(gameData.metaUpgrades, META_1);
    expect(recordRunDiscoveries(meta, { roster: [{ weapon: weapon('Rapier') }] })).toBe(true);
    expect(recordFoesEncountered(meta, [{ faction: 'enemy', weapon: weapon('Gravesong') }])).toBe(
      true,
    );
    expect(meta.itemsSeen).toEqual(['Gravesong', 'Rapier']);
    expect(recordRunDiscoveries(undefined, { roster: [] })).toBe(false);
  });

  it('a service save (shop, rewards) records what the run now shows', () => {
    const meta = new MetaProgressionManager(gameData.metaUpgrades, META_1);
    const registry = new Map([
      ['activeSlot', 1],
      ['meta', meta],
    ]);
    const runManager = {
      toJSON: () => ({ status: 'active' }),
      shopStateByNodeId: { n1: { items: [{ item: weapon('Rapier') }] } },
    };
    expect(saveServiceRun({ registry, runManager })).toBe('');
    expect(meta.hasSeenItem('Rapier')).toBe(true);
  });
});

describe('discoveriesAcrossSlots', () => {
  it('unions every slot: its lists or backfill, and its run', () => {
    store[getMetaKey(1)] = JSON.stringify(seenSave({ items: ['Starfall'], skills: ['sol'] }));
    store[getMetaKey(2)] = JSON.stringify({ runRecords: [{ roster: [{ weapon: 'Rapier' }] }] });
    store[getRunKey(3)] = JSON.stringify({ roster: [{ skills: ['luna'] }] });
    expect(discoveriesAcrossSlots()).toEqual({
      items: ['Rapier', 'Starfall'],
      skills: ['luna', 'sol'],
    });
  });
});

describe('the Compendium', () => {
  const overlay = (seen = {}) => {
    const view = Object.create(CompendiumOverlay.prototype);
    view.gameData = gameData;
    view.searchQuery = '';
    view._discovery = discoveryView(seen);
    return view;
  };
  const entryNamed = (entries, name) => entries.find((e) => e.name === name);

  it('an entry not met is a "???" row that says only its kind and how many are found', () => {
    const entries = compendiumEntries(
      overlay({ items: ['Iron Sword'] }),
      tab('weapons'),
      0,
      'weapons',
    );
    expect(entries).toHaveLength(gameData.weapons.length);
    expect(entryNamed(entries, 'Iron Sword').locked).toBeUndefined();
    expect(entryNamed(entries, 'Starfall')).toBeUndefined();
    const index = gameData.weapons.findIndex((w) => w.name === 'Starfall');
    const locked = entries[index];
    expect(locked).toMatchObject({ name: LOCKED_NAME, summary: 'Bow', locked: true });
    // Its kind's generic icon: a nameless bow, never Starfall's picture.
    expect(locked.art.subject).toEqual({ name: '', type: 'Bow' });
    expect(locked.item).toBeUndefined();
    const text = JSON.stringify(locked);
    expect(text).not.toMatch(/Starfall|stars came down/);
    expect(locked.lines.at(-1)).toBe(`1 of ${gameData.weapons.length} found.`);
  });

  it('skills fill in by id; Items by name', () => {
    const skills = compendiumEntries(overlay({ skills: ['sol'] }), tab('skills'), 0, 'skills');
    expect(skills.filter((e) => !e.locked).map((e) => e.name)).toEqual(['Sol']);
    const items = compendiumEntries(overlay({ items: ['Vulnerary'] }), tab('items'), 0, 'items');
    expect(items.filter((e) => !e.locked).map((e) => e.name)).toEqual(['Vulnerary']);
  });

  it('every other tab is never locked', () => {
    for (const key of ['weaponArts', 'classes', 'terrain', 'affixes']) {
      const entries = compendiumEntries(overlay(), tab(key), 0, key);
      expect(
        entries.some((e) => e.locked),
        key,
      ).toBe(false);
    }
  });

  it("a legendary's entry shows its weapon arts in the shop's words", () => {
    const entries = compendiumEntries(overlay({ all: true }), tab('weapons'), 0, 'weapons');
    const starfall = entryNamed(entries, 'Starfall');
    expect(starfall.lines).toEqual(
      expect.arrayContaining([
        'Weapon art: Starfall Volley',
        'Cost: 5 HP · 3 per battle · 1 per turn',
        'Effect: +5 Attack · +20 Hit · +15 Crit',
        'Needs: Bow · Master rank',
      ]),
    );
    // Two arts, both listed.
    const breachbolt = entryNamed(entries, 'Breachbolt').lines.filter((l) =>
      l.startsWith('Weapon art:'),
    );
    expect(breachbolt).toHaveLength(2);
    // An ordinary weapon has none.
    expect(entryNamed(entries, 'Iron Sword').lines.some((l) => l.startsWith('Weapon art'))).toBe(
      false,
    );
  });

  it("a legendary art names the weapons that carry it, once they're found", () => {
    const art = (seen) =>
      compendiumEntries(overlay(seen), tab('weaponArts'), 0, 'weaponArts').find(
        (e) => e.name === 'Starfall Volley',
      );
    expect(art({ items: ['Starfall'] }).lines).toContain(
      'Carried by: Starfall, a weapon not found yet',
    );
    expect(art({ all: true }).lines).toContain("Carried by: Starfall, Hermit's Bow");
    expect(art({}).lines).toContain('Carried by: 2 weapons not found yet');
  });

  it('search never finds an entry not met, and finds it once met', () => {
    const scene = {
      registry: new Map(),
      cameras: { main: { centerX: 320, centerY: 240 } },
    };
    const searchFor = (query) => {
      const view = new CompendiumOverlay(scene, gameData, () => {});
      view._buildSearchIndex();
      view._draw = () => {};
      view._setSearchQuery(query);
      // Hits in the Arms tab (the Arts tab names "Starfall Volley" whatever is found).
      return view.searchResults.filter((r) => r.tabIndex === tab('weapons')).length;
    };
    expect(searchFor('Starfall')).toBe(0);
    store[getMetaKey(1)] = JSON.stringify(seenSave({ items: ['Starfall'] }));
    expect(searchFor('Starfall')).toBeGreaterThan(0);
    // The open save's lists and the run in play count before anything is written.
    delete store[getMetaKey(1)];
    scene.registry.set('meta', { itemsSeen: ['Starfall'], skillsSeen: [] });
    expect(searchFor('Starfall')).toBeGreaterThan(0);
    scene.registry.delete('meta');
    scene.runManager = { roster: [{ weapon: weapon('Starfall') }] };
    expect(searchFor('Starfall')).toBeGreaterThan(0);
  });
});

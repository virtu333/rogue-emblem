// Lords met (playtest 2026-09-29, row 15): a save shows only the lords who have joined
// an army on it. Edric and Sera from the start; the others once recruited (third
// lord, boss recruit, recruit node). The record is written on every join path at the
// join, survives reloads and merges, and is backfilled once for older saves.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../src/ui/BossRecruitOverlay.js', () => ({
  BossRecruitOverlay: class {
    constructor() {
      this.displayObjects = [];
    }
    show(onComplete) {
      onComplete(globalThis.__joiningUnit);
    }
  },
}));
vi.mock('../src/ui/LordArrivalOverlay.js', () => ({
  LordArrivalOverlay: class {
    constructor() {
      this.displayObjects = [];
    }
    show(onComplete) {
      onComplete(globalThis.__joiningUnit);
    }
  },
}));

import {
  ALWAYS_MET_LORD_NAMES,
  lordNamesInRun,
  lordsMetFromMetaSave,
  lordsMetOfMetaSave,
  mergeLordNames,
  metLords,
  recordRunLordsMet,
} from '../src/engine/LordsMet.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { RunManager, saveRun } from '../src/engine/RunManager.js';
import { getMetaKey, getRunKey, metLordNamesAcrossSlots } from '../src/engine/SlotManager.js';
import { createLordUnit } from '../src/engine/UnitManager.js';
import { recordBattleRecruit, fallenBattleRecruits } from '../src/engine/BattleRecruits.js';
import { PostCombatController } from '../src/ui/PostCombatController.js';
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

const gameData = loadGameData();
const upgradesData = gameData.metaUpgrades;
const META_1 = getMetaKey(1);

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
  localStorageMock.setItem.mockClear();
  delete globalThis.__joiningUnit;
});

function lordUnit(name) {
  const def = gameData.lords.find((l) => l.name === name);
  const cls = gameData.classes.find((c) => c.name === def.class);
  const unit = createLordUnit(def, cls, gameData.weapons);
  unit.faction = 'player';
  return unit;
}

function metaWrites() {
  return localStorageMock.setItem.mock.calls.filter(([key]) => key === META_1).length;
}

describe('LordsMet rules', () => {
  it('Edric and Sera are the only lords a new save has met', () => {
    expect(ALWAYS_MET_LORD_NAMES).toEqual(['Edric', 'Sera']);
    expect(lordsMetOfMetaSave(null)).toEqual(['Edric', 'Sera']);
    expect(lordsMetFromMetaSave({})).toEqual(['Edric', 'Sera']);
  });

  it('merges names as a sorted set and drops junk', () => {
    expect(mergeLordNames(['Voss', 'Cael'], ['Cael', 'Astrid', '', 42, null], 'x')).toEqual([
      'Astrid',
      'Cael',
      'Voss',
    ]);
  });

  it('reads the lords of a run from its roster and its fallen, never recruits', () => {
    const run = {
      roster: [
        { name: 'Edric', isLord: true },
        { name: 'Daska', isLord: false },
        { name: 'Kira', isLord: true },
      ],
      fallenUnits: [{ name: 'Voss', isLord: true }, { name: 'Wren' }],
    };
    expect(lordNamesInRun(run)).toEqual(['Edric', 'Kira', 'Voss']);
    expect(lordNamesInRun(null)).toEqual([]);
    expect(lordNamesInRun({ roster: 'bad' })).toEqual([]);
  });

  it('keeps lords.json order and always the default pair', () => {
    const names = (list) => list.map((l) => l.name);
    expect(names(metLords(gameData.lords, new Set()))).toEqual(['Edric', 'Sera']);
    expect(names(metLords(gameData.lords, ['Cael', 'Kira']))).toEqual([
      'Edric',
      'Kira',
      'Sera',
      'Cael',
    ]);
    expect(names(metLords(gameData.lords, (n) => n === 'Voss'))).toEqual(['Edric', 'Voss', 'Sera']);
  });
});

describe('MetaProgressionManager.lordsMet', () => {
  it('a fresh save has met Edric and Sera only, even with Banner of Command owned', () => {
    const meta = new MetaProgressionManager(upgradesData, META_1);
    meta.milestones.add('beatHard');
    meta.purchasedUpgrades.legendary_heir = 1;
    meta.purchasedUpgrades.commander_choice = 1;
    meta.purchasedUpgrades.partner_choice = 1;
    expect(meta.getLordsMet()).toEqual(['Edric', 'Sera']);
    expect(meta.hasMetLord('Edric')).toBe(true);
    expect(meta.hasMetLord('Sera')).toBe(true);
    for (const name of ['Kira', 'Voss', 'Rowan', 'Astrid', 'Cael'])
      expect(meta.hasMetLord(name)).toBe(false);
  });

  it('recording is idempotent: one write for a new lord, none for a known one', () => {
    const meta = new MetaProgressionManager(upgradesData, META_1);
    expect(meta.recordLordsMet(['Kira'])).toBe(true);
    expect(metaWrites()).toBe(1);
    expect(meta.recordLordsMet(['Kira', 'Edric'])).toBe(false);
    expect(meta.recordLordsMet([])).toBe(false);
    expect(meta.recordLordsMet(undefined)).toBe(false);
    expect(metaWrites()).toBe(1);
    expect(meta.getLordsMet()).toEqual(['Edric', 'Kira', 'Sera']);
  });

  it('saves the list and a reload keeps it', () => {
    const meta = new MetaProgressionManager(upgradesData, META_1);
    meta.recordLordsMet(['Cael', 'Astrid']);
    expect(JSON.parse(store[META_1]).lordsMet).toEqual(['Astrid', 'Cael', 'Edric', 'Sera']);
    const reloaded = new MetaProgressionManager(upgradesData, META_1);
    expect(reloaded.getLordsMet()).toEqual(['Astrid', 'Cael', 'Edric', 'Sera']);
    expect(reloaded.hasMetLord('Cael')).toBe(true);
    expect(reloaded.hasMetLord('Voss')).toBe(false);
  });

  it('a stale manager adopting a newer disk save unions both lists', () => {
    const stale = new MetaProgressionManager(upgradesData, META_1);
    stale.recordLordsMet(['Voss']);
    const other = new MetaProgressionManager(upgradesData, META_1);
    other.recordLordsMet(['Kira']); // newer on disk, without Rowan
    stale.recordLordsMet(['Rowan']);
    const onDisk = JSON.parse(store[META_1]).lordsMet;
    expect(onDisk).toEqual(['Edric', 'Kira', 'Rowan', 'Sera', 'Voss']);
  });

  it('reset() forgets every lord but the default pair', () => {
    const meta = new MetaProgressionManager(upgradesData, META_1);
    meta.recordLordsMet(['Kira']);
    meta.reset();
    expect(meta.getLordsMet()).toEqual(['Edric', 'Sera']);
  });

  describe('backfill for saves from before the list', () => {
    const load = (saved, run = null) => {
      store[META_1] = JSON.stringify({ totalValor: 0, savedAt: 5, ...saved });
      if (run) store[getRunKey(1)] = JSON.stringify(run);
      return new MetaProgressionManager(upgradesData, META_1).getLordsMet();
    };

    it('nothing to go on: the default pair', () => {
      expect(load({})).toEqual(['Edric', 'Sera']);
    });
    it('from the commander-choice picks', () => {
      expect(load({ lordSelection: { commander: 'Kira', partner: 'Cael' } })).toEqual([
        'Cael',
        'Edric',
        'Kira',
        'Sera',
      ]);
    });
    it('from lords holding starting skills', () => {
      expect(load({ skillAssignments: { Voss: ['sol'] } })).toEqual(['Edric', 'Sera', 'Voss']);
    });
    it('from lords who fell in a run', () => {
      expect(load({ storyFlags: { lordFalls: { Rowan: 2 } } })).toEqual(['Edric', 'Rowan', 'Sera']);
    });
    it('from the lords (not recruits) of run records', () => {
      const record = {
        id: 'r1',
        endedAt: 1,
        difficulty: 'normal',
        roster: [
          { name: 'Astrid', className: 'Sky Lancer', level: 9, isLord: true },
          { name: 'Daska', className: 'Archer', level: 9, isLord: false },
        ],
      };
      expect(load({ runRecords: [record] })).toEqual(['Astrid', 'Edric', 'Sera']);
    });
    it("from the slot's run in progress, living and fallen", () => {
      const run = {
        roster: [
          { name: 'Edric', isLord: true },
          { name: 'Kira', isLord: true },
        ],
        fallenUnits: [{ name: 'Cael', isLord: true }],
      };
      expect(load({}, run)).toEqual(['Cael', 'Edric', 'Kira', 'Sera']);
    });
    it('a save that has the list is not re-derived from its records', () => {
      expect(load({ lordsMet: ['Edric', 'Sera'], skillAssignments: { Voss: ['sol'] } })).toEqual([
        'Edric',
        'Sera',
      ]);
    });
    it('keeps an existing Banner of Command pick valid', () => {
      store[META_1] = JSON.stringify({
        savedAt: 5,
        milestones: ['beatHard'],
        purchasedUpgrades: { legendary_heir: 1, commander_choice: 1, partner_choice: 1 },
        lordSelection: { commander: 'Astrid', partner: 'Rowan' },
      });
      const meta = new MetaProgressionManager(upgradesData, META_1);
      expect(meta.getLordSelection()).toEqual({ commander: 'Astrid', partner: 'Rowan' });
    });
  });
});

describe('metLordNamesAcrossSlots (the Compendium)', () => {
  it('unions every slot: its list or backfill, and its run', () => {
    expect([...metLordNamesAcrossSlots()].sort()).toEqual(['Edric', 'Sera']);
    store[getMetaKey(1)] = JSON.stringify({ lordsMet: ['Kira'] });
    store[getMetaKey(2)] = JSON.stringify({ skillAssignments: { Voss: [] } });
    store[getRunKey(3)] = JSON.stringify({
      roster: [{ name: 'Rowan', isLord: true }],
      fallenUnits: [{ name: 'Cael', isLord: true }],
    });
    store[getRunKey(2)] = '{not json';
    expect([...metLordNamesAcrossSlots()].sort()).toEqual([
      'Cael',
      'Edric',
      'Kira',
      'Rowan',
      'Sera',
      'Voss',
    ]);
  });
});

describe('every lord join path records the lord at the join', () => {
  function startedRun() {
    const rm = new RunManager(gameData, null);
    rm.startRun();
    return rm;
  }

  it('the starting pair', () => {
    const meta = new MetaProgressionManager(upgradesData, META_1);
    const rm = startedRun();
    expect(rm.lordNamesInRun()).toEqual(['Edric', 'Sera']);
    expect(recordRunLordsMet(meta, rm)).toBe(false);
    expect(meta.getLordsMet()).toEqual(['Edric', 'Sera']);
  });

  it('the third lord (RunManager.resolveThirdLord)', () => {
    const meta = new MetaProgressionManager(upgradesData, META_1);
    const rm = startedRun();
    rm.resolveThirdLord(lordUnit('Kira'));
    expect(recordRunLordsMet(meta, rm)).toBe(true);
    expect(new MetaProgressionManager(upgradesData, META_1).hasMetLord('Kira')).toBe(true);
  });

  it('a boss recruit (RunManager.addBossRecruit)', () => {
    const meta = new MetaProgressionManager(upgradesData, META_1);
    const rm = startedRun();
    const cael = lordUnit('Cael');
    expect(rm.addBossRecruit(cael)).toBe(true);
    expect(rm.roster).toContain(cael);
    expect(typeof cael.unitUid).toBe('string');
    recordRunLordsMet(meta, rm);
    expect(new MetaProgressionManager(upgradesData, META_1).hasMetLord('Cael')).toBe(true);
  });

  it('a recruit-node lord who joined by Talk and survived, or fell', () => {
    for (const falls of [false, true]) {
      for (const key of Object.keys(store)) delete store[key];
      const meta = new MetaProgressionManager(upgradesData, META_1);
      const rm = startedRun();
      const node = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.startNodeId);
      const voss = lordUnit('Voss');
      voss.battleEntityId = 'u9';
      const playerUnits = [...rm.roster.map((u) => structuredClone(u)), voss];
      const recruits = recordBattleRecruit([], voss);
      const survivors = falls ? playerUnits.filter((u) => u !== voss) : playerUnits;
      expect(
        rm.completeBattle(survivors, node.id, 0, {
          fallenRecruits: fallenBattleRecruits(recruits, survivors, rm.roster),
        }),
      ).toBe(true);
      recordRunLordsMet(meta, rm);
      expect(new MetaProgressionManager(upgradesData, META_1).hasMetLord('Voss')).toBe(true);
    }
  });

  it('a lord in a loaded run counts even if the meta write was missed', () => {
    const rm = startedRun();
    rm.resolveThirdLord(lordUnit('Astrid'));
    expect(saveRun(rm, null, 1).ok).toBe(true);
    const meta = new MetaProgressionManager(upgradesData, META_1);
    expect(meta.hasMetLord('Astrid')).toBe(true);
  });

  describe('PostCombatController', () => {
    function sceneFor(rm, meta) {
      return {
        gameData,
        runManager: rm,
        registry: { get: (key) => (key === 'meta' ? meta : null) },
        scene: { isActive: () => true },
        sys: { isActive: () => true },
        _persistBattleRunState: vi.fn(),
        showLootScreen: vi.fn(),
        _showThirdLordArrival: vi.fn(),
      };
    }

    it('boss recruit: the picked lord joins and is met before the loot screen', () => {
      const meta = new MetaProgressionManager(upgradesData, META_1);
      const rm = startedRun();
      const scene = sceneFor(rm, meta);
      scene.showLootScreen = vi.fn(() => {
        expect(new MetaProgressionManager(upgradesData, META_1).hasMetLord('Rowan')).toBe(true);
      });
      globalThis.__joiningUnit = lordUnit('Rowan');
      new PostCombatController(scene).showBossRecruitScreen();
      expect(rm.roster.map((u) => u.name)).toContain('Rowan');
      expect(scene.showLootScreen).toHaveBeenCalledTimes(1);
    });

    it('boss recruit of a recruit leaves the list alone', () => {
      const meta = new MetaProgressionManager(upgradesData, META_1);
      const rm = startedRun();
      const recruit = lordUnit('Rowan');
      recruit.isLord = false;
      recruit.name = 'Daska';
      globalThis.__joiningUnit = recruit;
      new PostCombatController(sceneFor(rm, meta)).showBossRecruitScreen();
      expect(meta.getLordsMet()).toEqual(['Edric', 'Sera']);
    });

    it('third lord arrival: the lord is met as it joins', () => {
      const meta = new MetaProgressionManager(upgradesData, META_1);
      const rm = startedRun();
      const scene = sceneFor(rm, meta);
      globalThis.__joiningUnit = lordUnit('Astrid');
      new PostCombatController(scene)._showThirdLordArrival();
      expect(rm.roster.map((u) => u.name)).toContain('Astrid');
      expect(new MetaProgressionManager(upgradesData, META_1).hasMetLord('Astrid')).toBe(true);
      expect(scene.showLootScreen).toHaveBeenCalledTimes(1);
    });
  });
});

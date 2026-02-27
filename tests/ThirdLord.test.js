import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import { generateThirdLordCandidates, getAvailableLords } from '../src/engine/BossRecruitSystem.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const upgradesData = gameData.metaUpgrades;

// Mock localStorage
const store = {};
const localStorageMock = {
  getItem: vi.fn((key) => store[key] || null),
  setItem: vi.fn((key, val) => {
    store[key] = val;
  }),
  removeItem: vi.fn((key) => {
    delete store[key];
  }),
};
vi.stubGlobal('localStorage', localStorageMock);

function clearStore() {
  for (const key of Object.keys(store)) delete store[key];
}

const STARTING_LORDS = new Set(['Edric', 'Sera']);
const RECRUITABLE_LORD_NAMES = gameData.lords
  .map((l) => l.name)
  .filter((n) => !STARTING_LORDS.has(n));

function makeBaseRoster() {
  return [
    {
      name: 'Edric',
      className: 'Lord',
      isLord: true,
      level: 8,
      faction: 'player',
      stats: { HP: 24, STR: 10, MAG: 2, SKL: 8, SPD: 9, DEF: 7, RES: 4, LCK: 6 },
    },
    {
      name: 'Sera',
      className: 'Light Sage',
      isLord: true,
      level: 7,
      faction: 'player',
      stats: { HP: 20, STR: 3, MAG: 10, SKL: 7, SPD: 8, DEF: 4, RES: 9, LCK: 7 },
    },
  ];
}

// ── Meta Upgrade Tests ──────────────────────────────────────

describe('Power of Friendship — Meta Upgrade', () => {
  beforeEach(clearStore);

  it('legendary_heir upgrade exists with correct structure', () => {
    const upgrade = upgradesData.find((u) => u.id === 'legendary_heir');
    expect(upgrade).toBeDefined();
    expect(upgrade.category).toBe('lord_bonuses');
    expect(upgrade.maxLevel).toBe(4);
    expect(upgrade.costs).toEqual([1000, 500, 250, 750]);
    expect(upgrade.requires).toEqual({ milestones: ['beatHard'] });
  });

  it('thirdLordMode is null when upgrade not purchased', () => {
    const meta = new MetaProgressionManager(upgradesData, 'test_meta');
    const effects = meta.getActiveEffects();
    expect(effects.thirdLordMode).toBeNull();
  });

  it('each tier returns correct mode string', () => {
    const modes = ['random', 'pick3', 'pick3_reroll', 'pick_all'];
    for (let tier = 1; tier <= 4; tier++) {
      clearStore();
      const meta = new MetaProgressionManager(upgradesData, 'test_meta');
      meta.milestones = new Set(['beatHard']);
      meta.totalValor = 100000;
      for (let i = 0; i < tier; i++) {
        meta.purchaseUpgrade('legendary_heir');
      }
      const effects = meta.getActiveEffects();
      expect(effects.thirdLordMode).toBe(modes[tier - 1]);
    }
  });

  it('requires beatHard milestone', () => {
    const meta = new MetaProgressionManager(upgradesData, 'test_meta');
    meta.totalValor = 100000;
    // Without milestone — should not meet prerequisites
    expect(meta.meetsPrerequisites('legendary_heir')).toBe(false);
    // With milestone
    meta.milestones = new Set(['beatHard']);
    expect(meta.meetsPrerequisites('legendary_heir')).toBe(true);
  });
});

// ── RunManager State Tests ──────────────────────────────────

describe('Power of Friendship — RunManager State', () => {
  beforeEach(clearStore);

  it('shouldTriggerThirdLord returns false when no upgrade', () => {
    const rm = new RunManager(gameData);
    rm.completedBattles = 3;
    expect(rm.shouldTriggerThirdLord()).toBe(false);
  });

  it('shouldTriggerThirdLord returns false when wrong battle count', () => {
    const rm = new RunManager(gameData, { thirdLordMode: 'random' });
    rm.completedBattles = 2;
    expect(rm.shouldTriggerThirdLord()).toBe(false);
    rm.completedBattles = 4;
    expect(rm.shouldTriggerThirdLord()).toBe(false);
  });

  it('shouldTriggerThirdLord returns false when already joined', () => {
    const rm = new RunManager(gameData, { thirdLordMode: 'random' });
    rm.completedBattles = 3;
    rm.thirdLordJoined = true;
    expect(rm.shouldTriggerThirdLord()).toBe(false);
  });

  it('shouldTriggerThirdLord returns true when conditions met', () => {
    const rm = new RunManager(gameData, { thirdLordMode: 'pick3' });
    rm.completedBattles = 3;
    expect(rm.shouldTriggerThirdLord()).toBe(true);
  });

  it('resolveThirdLord with unit pushes to roster and sets flag', () => {
    const rm = new RunManager(gameData, { thirdLordMode: 'random' });
    const unit = { name: 'Kira', isLord: true };
    rm.resolveThirdLord(unit);
    expect(rm.thirdLordJoined).toBe(true);
    expect(rm.roster.some((u) => u.name === 'Kira')).toBe(true);
  });

  it('resolveThirdLord with null sets flag without pushing', () => {
    const rm = new RunManager(gameData, { thirdLordMode: 'random' });
    const rosterLen = rm.roster.length;
    rm.resolveThirdLord(null);
    expect(rm.thirdLordJoined).toBe(true);
    expect(rm.roster.length).toBe(rosterLen);
  });

  it('canRerollThirdLord only true for pick3_reroll mode', () => {
    const rm = new RunManager(gameData, { thirdLordMode: 'pick3_reroll' });
    expect(rm.canRerollThirdLord()).toBe(true);

    rm.consumeThirdLordReroll();
    expect(rm.canRerollThirdLord()).toBe(false);
  });

  it('canRerollThirdLord false for other modes', () => {
    const rm = new RunManager(gameData, { thirdLordMode: 'pick3' });
    expect(rm.canRerollThirdLord()).toBe(false);
  });

  it('serialization round-trip preserves both flags', () => {
    const rm = new RunManager(gameData, { thirdLordMode: 'pick3_reroll' });
    rm.thirdLordJoined = true;
    rm.thirdLordRerolled = true;
    const json = rm.toJSON();
    expect(json.thirdLordJoined).toBe(true);
    expect(json.thirdLordRerolled).toBe(true);

    const rm2 = RunManager.fromJSON(json, gameData);
    expect(rm2.thirdLordJoined).toBe(true);
    expect(rm2.thirdLordRerolled).toBe(true);
  });
});

// ── Legacy Save Tests ───────────────────────────────────────

describe('Power of Friendship — Legacy Save Compat', () => {
  beforeEach(clearStore);

  it('old save with completedBattles >= 3 and missing thirdLordJoined defaults to true', () => {
    const rm = new RunManager(gameData);
    const json = rm.toJSON();
    delete json.thirdLordJoined;
    delete json.thirdLordRerolled;
    json.completedBattles = 5;

    const rm2 = RunManager.fromJSON(json, gameData);
    expect(rm2.thirdLordJoined).toBe(true);
  });

  it('old save with completedBattles < 3 and missing thirdLordJoined defaults to false', () => {
    const rm = new RunManager(gameData);
    const json = rm.toJSON();
    delete json.thirdLordJoined;
    delete json.thirdLordRerolled;
    json.completedBattles = 1;

    const rm2 = RunManager.fromJSON(json, gameData);
    expect(rm2.thirdLordJoined).toBe(false);
  });
});

// ── Generation Tests ────────────────────────────────────────

describe('Power of Friendship — generateThirdLordCandidates', () => {
  it('random mode returns 1 candidate', () => {
    const result = generateThirdLordCandidates(makeBaseRoster(), gameData, {}, [], 'random');
    expect(result).not.toBeNull();
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].isLord).toBe(true);
    expect(result.mode).toBe('random');
  });

  it('pick3 mode returns up to 3 candidates', () => {
    const result = generateThirdLordCandidates(makeBaseRoster(), gameData, {}, [], 'pick3');
    expect(result).not.toBeNull();
    expect(result.candidates.length).toBeGreaterThanOrEqual(1);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
    expect(result.mode).toBe('pick3');
  });

  it('pick_all mode returns all available lords', () => {
    const result = generateThirdLordCandidates(makeBaseRoster(), gameData, {}, [], 'pick_all');
    expect(result).not.toBeNull();
    expect(result.candidates.length).toBe(RECRUITABLE_LORD_NAMES.length);
  });

  it('candidates receive class growth contributions (not just personal growths)', () => {
    const result = generateThirdLordCandidates(makeBaseRoster(), gameData, {}, [], 'pick_all');
    expect(result).not.toBeNull();
    for (const c of result.candidates) {
      const lordDef = gameData.lords.find((l) => l.name === c.unit.name);
      expect(lordDef).toBeDefined();
      // Class growthRanges (e.g. HP 50-65) add to personalGrowths;
      // if class contribution is missing, unitGrowths.HP === personal.HP
      const personal = lordDef.personalGrowths;
      const unitGrowths = c.unit.growths;
      expect(unitGrowths.HP).toBeGreaterThan(personal.HP);
    }
  });

  it('returns null when pool exhausted', () => {
    const fullRoster = [
      ...makeBaseRoster(),
      ...RECRUITABLE_LORD_NAMES.map((name) => ({
        name,
        className: 'Lord',
        isLord: true,
        level: 5,
        faction: 'player',
        stats: { HP: 20, STR: 8, MAG: 3, SKL: 6, SPD: 7, DEF: 5, RES: 3, LCK: 5 },
      })),
    ];
    const result = generateThirdLordCandidates(fullRoster, gameData, {}, [], 'random');
    expect(result).toBeNull();
  });
});

// ── Integration Tests ───────────────────────────────────────

describe('Power of Friendship — Integration', () => {
  it('chosen lord excluded from subsequent getAvailableLords', () => {
    const roster = makeBaseRoster();
    const result = generateThirdLordCandidates(roster, gameData, {}, [], 'random');
    expect(result).not.toBeNull();
    const chosenName = result.candidates[0].unit.name;

    // Simulate adding to roster
    roster.push(result.candidates[0].unit);
    const remaining = getAvailableLords(roster, gameData.lords, []);
    expect(remaining.find((l) => l.name === chosenName)).toBeUndefined();
  });

  it('fallen lords excluded from candidates', () => {
    const roster = makeBaseRoster();
    const fallenUnits = RECRUITABLE_LORD_NAMES.map((name) => ({ name }));
    const result = generateThirdLordCandidates(roster, gameData, {}, fallenUnits, 'pick_all');
    expect(result).toBeNull();
  });
});

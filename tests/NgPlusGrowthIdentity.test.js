// NG+ growth identity (docs/specs/ng-plus.md §12): a veteran keeps its own growths (the roll
// and its traits), never the Home Base upgrades, rung scaling or blessings of the run it rode
// out of; the run it comes back to lays its own on top. Records saved before that (legacy)
// come back exactly as they were. Real RunManager and MetaProgressionManager on shipped data.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => {
      store[k] = String(v);
    },
    removeItem: (k) => {
      delete store[k];
    },
  },
  writable: true,
});

import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { getMetaKey } from '../src/engine/SlotManager.js';
import { reclassUnit } from '../src/engine/UnitManager.js';
import {
  NG_PLUS_COST,
  defaultNgPlusState,
  normalizeNgPlusState,
  runStartOf,
} from '../src/engine/NgPlusState.js';
import { rideCandidates } from '../src/engine/NgPlusRun.js';

const data = loadGameData();
const META_KEY = getMetaKey(1);
const STATS = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];
// Recruit growth upgrades as Home Base hands them to a run (metaEffects.growthBonuses).
const META_GROWTHS = { HP: 5, SPD: 10 };
// growthBonusMultiplier per rung (difficulty.json): Nightfall 0.8, Black Sun 0.5.
const multOf = (id) => data.difficulty.modes?.[id]?.growthBonusMultiplier ?? null;

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});
afterEach(() => vi.restoreAllMocks());

const unlockedMeta = () => {
  const meta = new MetaProgressionManager(data.metaUpgrades, META_KEY);
  meta.milestones.add('beatLunatic');
  meta.addValor(NG_PLUS_COST.valor);
  meta.addSupply(NG_PLUS_COST.supply);
  expect(meta.unlockNgPlus()).toEqual({ ok: true });
  return meta;
};

function startRun({ difficultyId, seed, metaEffects = null, ngPlus = null }) {
  const rm = new RunManager(data, metaEffects);
  rm.startRun({ runSeed: seed, applyBlessingsAtStart: false, difficultyId, ngPlus });
  return rm;
}

/** A recruit joining at the run's start (the Vanguard Cadre's path: meta upgrades, traits). */
function addRecruit(rm, className = 'Fighter') {
  rm.roster.push(rm._createExtraStartingUnit(className));
  rm.ensureUnitUids();
  return rm.roster.at(-1);
}

/** Scholar's Vow's +5 to every growth, applied to the roster as the shrine applies it. */
function takeAllGrowthsBlessing(rm) {
  rm.activeBlessings = [
    {
      id: 'scholar_vow',
      boons: [{ type: 'all_growths_delta', params: { value: 5 } }],
      rolledCost: { label: 'none', effects: [] },
    },
  ];
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
}

function win(rm, meta) {
  rm.actIndex = rm.actSequence.length - 1;
  rm.status = 'victory';
  rm.settleEndRunRewards(meta, 'victory');
}

const scaled = (bonuses, mult) =>
  Object.fromEntries(Object.entries(bonuses).map(([stat, v]) => [stat, Math.round(v * mult)]));

const minus = (growths, ...deltas) => {
  const out = { ...growths };
  for (const delta of deltas)
    for (const [stat, v] of Object.entries(delta)) out[stat] = (out[stat] || 0) - v;
  return out;
};

describe('a veteran keeps its own growths, not the run’s upgrades and blessings', () => {
  it('a Nightfall recruit with Home Base growth upgrades and a growth blessing is kept without either', () => {
    // Failure (the review's probe): the record keeps 60 SPD where the recruit rolled 56, the
    // upgrade and the blessing it rode with saved into its identity for every later run.
    expect(multOf('hard')).toBe(0.8);
    const rm = startRun({
      difficultyId: 'hard',
      seed: 41,
      metaEffects: { growthBonuses: META_GROWTHS },
    });
    const recruit = addRecruit(rm);
    const beforeBlessing = { ...recruit.growths };
    takeAllGrowthsBlessing(rm);
    const blessing = Object.fromEntries(STATS.map((s) => [s, Math.round(5 * 0.8)]));
    expect(recruit.growths).toEqual(
      Object.fromEntries(
        Object.entries(beforeBlessing).map(([s, v]) => [s, v + (blessing[s] || 0)]),
      ),
    );
    const meta = scaled(META_GROWTHS, 0.8);
    const candidate = rideCandidates(rm).find((c) => c.ref === recruit.unitUid);
    // Its own growths: everything it has, less the blessing's and the upgrades' parts.
    expect(candidate.identity.growths).toEqual(minus(recruit.growths, blessing, meta));
    expect(candidate.identity.growthsBasis).toBe('innate');
  });

  it('comes back on Black Sun with Black Sun’s scaled upgrades and no blessing it did not take', () => {
    // Failure: the veteran returns with the old run's upgrade share and blessing still in
    // its growths (counted twice), and this run's upgrades never reach it.
    const metaManager = unlockedMeta();
    const rm = startRun({
      difficultyId: 'lunatic',
      seed: 43,
      metaEffects: { growthBonuses: META_GROWTHS },
    });
    const recruit = addRecruit(rm);
    takeAllGrowthsBlessing(rm);
    win(rm, metaManager);
    expect(metaManager.chooseNgPlusRide([{ ref: recruit.unitUid }])).toMatchObject({ ok: true });
    const record = metaManager.getNgPlus().barracks.find((r) => r.kind === 'recruit');
    expect(record.growthsBasis).toBe('innate');
    const innate = minus(
      recruit.growths,
      Object.fromEntries(STATS.map((s) => [s, Math.round(5 * 0.5)])),
      scaled(META_GROWTHS, 0.5),
    );
    expect(record.growths).toEqual(innate);

    expect(metaManager.setNgPlusBring([record.id]).ok).toBe(true);
    expect(multOf('lunatic')).toBe(0.5);
    const next = startRun({
      difficultyId: 'lunatic',
      seed: 44,
      metaEffects: { growthBonuses: META_GROWTHS },
      ngPlus: metaManager.ngPlusRunStart('lunatic'),
    });
    const vet = next.roster.find((u) => u.name === record.name);
    const blackSunMeta = scaled(META_GROWTHS, 0.5); // HP round(2.5) = 3, SPD 5
    expect(vet.growths).toEqual(minus(innate, scaled(blackSunMeta, -1)));

    // Riding again keeps the same identity: no compounding across loops.
    win(next, metaManager);
    const again = rideCandidates(next).find((c) => c.ref === vet.unitUid);
    expect(again.identity.growths).toEqual(innate);
  });

  it('a blessing taken in the veteran’s new run reaches it like the rest of the roster', () => {
    // Failure: veterans join after the run-start blessings and miss them.
    const state = defaultNgPlusState();
    const growths = { HP: 70, STR: 50, MAG: 0, SKL: 40, SPD: 40, DEF: 30, RES: 10, LCK: 30 };
    state.barracks.push({
      id: 'vet:x:1',
      kind: 'recruit',
      name: 'Bjorn',
      keptSkills: [],
      skillKinds: {},
      keptItems: [],
      rides: 1,
      className: 'Fighter',
      growths,
      growthsBasis: 'innate',
      traits: [],
    });
    state.bring = ['vet:x:1'];
    const rm = startRun({ difficultyId: 'lunatic', seed: 5, ngPlus: runStartOf(state) });
    takeAllGrowthsBlessing(rm);
    const vet = rm.roster.find((u) => u.name === 'Bjorn');
    const bonus = Math.round(5 * 0.5);
    expect(vet.growths).toEqual(
      Object.fromEntries(Object.entries(growths).map(([s, v]) => [s, v + bonus])),
    );
  });

  it('a recruit made as a promoted class is kept on its base roll, its traits’ growths in', () => {
    // Failure: the promoted class's growth bonus, or a trait's growth change, is lost or kept
    // twice. Expected values come from the class data and the trait data, not the code.
    const rm = startRun({ difficultyId: 'hard', seed: 47 });
    const recruit = addRecruit(rm, 'Fighter');
    recruit.traits = ['hardy'];
    const hardy = data.traits.find((t) => t.id === 'hardy');
    const hardyHp = hardy.creationMods.growths.HP;
    const rolled = { ...recruit.rolledGrowths };
    const warrior = data.classes.find((c) => c.name === 'Warrior');
    recruit.className = 'Warrior';
    recruit.tier = 'promoted';
    recruit.baseClass = 'Fighter';
    for (const [s, v] of Object.entries(warrior.growthBonuses || {})) recruit.growths[s] += v;
    const candidate = rideCandidates(rm).find((c) => c.ref === recruit.unitUid);
    expect(candidate.identity.className).toBe('Fighter');
    expect(candidate.identity.growths).toEqual({ ...rolled, HP: rolled.HP + hardyHp });
  });

  it('a reclass re-rolls the recruit’s own growths, and that roll is what is kept', () => {
    // Failure: a reclassed unit is kept with its old class's roll, or as a legacy identity.
    const rm = startRun({
      difficultyId: 'hard',
      seed: 53,
      metaEffects: { growthBonuses: META_GROWTHS },
    });
    const recruit = addRecruit(rm, 'Fighter');
    recruit.traits = [];
    const fighter = data.classes.find((c) => c.name === 'Fighter');
    const mercenary = data.classes.find((c) => c.name === 'Mercenary');
    expect(
      reclassUnit(recruit, mercenary, fighter, data.classes, data.skills, data.traits),
    ).toBeTruthy();
    // A reclass's new growths are a bare roll (no upgrades): they are its own growths.
    const candidate = rideCandidates(rm).find((c) => c.ref === recruit.unitUid);
    expect(candidate.identity.className).toBe('Mercenary');
    expect(candidate.identity.growthsBasis).toBe('innate');
    expect(candidate.identity.growths).toEqual(recruit.growths);
  });

  it('the roll survives a save and a load of the run', () => {
    // Failure: the roll is not saved, so a run reloaded before its win keeps a legacy record.
    const rm = startRun({
      difficultyId: 'hard',
      seed: 59,
      metaEffects: { growthBonuses: META_GROWTHS },
    });
    const recruit = addRecruit(rm);
    const rolled = { ...recruit.rolledGrowths };
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    const unit = loaded.roster.find((u) => u.unitUid === recruit.unitUid);
    expect(unit.rolledGrowths).toEqual(rolled);
    const candidate = rideCandidates(loaded).find((c) => c.ref === recruit.unitUid);
    expect(candidate.identity.growthsBasis).toBe('innate');
  });
});

describe('legacy records (saved before identities were innate) are kept as they are', () => {
  const legacyRecord = () => ({
    id: 'vet:old:7',
    kind: 'recruit',
    name: 'Jeffrey',
    keptSkills: ['vantage'],
    skillKinds: { vantage: 'skill' },
    keptItems: [
      { ...structuredClone(data.weapons.find((w) => w.name === 'Steel Axe')), uid: 'itm_old_axe' },
    ],
    rides: 2,
    rideLog: [],
    className: 'Fighter',
    growths: { HP: 84, STR: 61, MAG: 4, SKL: 45, SPD: 60, DEF: 34, RES: 14, LCK: 39 },
    traits: [],
  });

  it('loads with its growths, skills and items, and is never marked innate', () => {
    // Failure: the migration guesses a roll (drops growths) or loses the veteran's kit.
    const state = normalizeNgPlusState({ ...defaultNgPlusState(), barracks: [legacyRecord()] });
    const record = state.barracks[0];
    expect(record.growths).toEqual(legacyRecord().growths);
    expect(record.growthsBasis).toBeUndefined();
    expect(record.keptSkills).toEqual(['vantage']);
    expect(record.keptItems.map((i) => i.uid)).toEqual(['itm_old_axe']);
    expect(record.rides).toBe(2);
  });

  it('comes back with exactly its saved growths, no upgrade added on top', () => {
    // Failure: this run's upgrades are added to growths that already hold an older run's.
    const state = defaultNgPlusState();
    state.barracks.push(legacyRecord());
    state.bring = ['vet:old:7'];
    const rm = startRun({
      difficultyId: 'lunatic',
      seed: 61,
      metaEffects: { growthBonuses: META_GROWTHS },
      ngPlus: runStartOf(state),
    });
    const vet = rm.roster.find((u) => u.name === 'Jeffrey');
    expect(vet.growths).toEqual(legacyRecord().growths);
    expect(vet.inventory.some((i) => i.uid === 'itm_old_axe')).toBe(true);
    expect(vet.skills).toContain('vantage');
    // Riding again with a legacy identity changes nothing on its record.
    expect(
      rideCandidates(rm).find((c) => c.name === 'Jeffrey').identity.growthsBasis,
    ).toBeUndefined();
  });
});

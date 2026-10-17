// NG+ innate growths across builds (docs/specs/ng-plus.md §12): a build from before the
// `growthsBasis` marker (#437) rebuilds every Barracks record through its own whitelist and so
// drops the marker while keeping the innate numbers. The meta save keeps a second copy of the
// marker under its own key (`ngPlusInnateGrowths`), which that build keeps as a key it does
// not know, so the next build still reads the veteran as innate. These tests write through the
// older build's real code: tests/fixtures/legacy/pre437 is MetaProgressionManager.js and
// NgPlusState.js as they stood on main just before #437, only their import paths rewritten.
import { beforeEach, describe, expect, it } from 'vitest';

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
import { MetaProgressionManager as OlderBuildMeta } from './fixtures/legacy/pre437/MetaProgressionManager.js';
import { getMetaKey } from '../src/engine/SlotManager.js';
import {
  NG_PLUS_COST,
  defaultNgPlusState,
  innateGrowthsLedgerOf,
  restoreInnateGrowths,
} from '../src/engine/NgPlusState.js';

const data = loadGameData();
const META_KEY = getMetaKey(1);
// Recruit growth upgrades as Home Base hands them to a run (metaEffects.growthBonuses).
const META_GROWTHS = { HP: 20, SPD: 20 };

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

const disk = () => JSON.parse(store[META_KEY]);
const diskRecruit = () => disk().ngPlus.barracks.find((r) => r.kind === 'recruit');

const unlockedMeta = () => {
  const meta = new MetaProgressionManager(data.metaUpgrades, META_KEY);
  meta.milestones.add('beatLunatic');
  meta.addValor(NG_PLUS_COST.valor);
  meta.addSupply(NG_PLUS_COST.supply);
  expect(meta.unlockNgPlus()).toEqual({ ok: true });
  return meta;
};

function startRun({ difficultyId, seed, ngPlus = null }) {
  const rm = new RunManager(data, { growthBonuses: META_GROWTHS });
  rm.startRun({ runSeed: seed, applyBlessingsAtStart: false, difficultyId, ngPlus });
  return rm;
}

/** A Nightfall win with one recruit; its ride left open. Returns the recruit. */
function winWithRecruit(meta, seed) {
  const rm = startRun({ difficultyId: 'hard', seed });
  rm.roster.push(rm._createExtraStartingUnit('Fighter'));
  rm.ensureUnitUids();
  const recruit = rm.roster.at(-1);
  rm.actIndex = rm.actSequence.length - 1;
  rm.status = 'victory';
  rm.settleEndRunRewards(meta, 'victory');
  return recruit;
}

/** An ordinary write by the older build: open the slot, bank one Valor. */
function olderBuildWrites() {
  const older = new OlderBuildMeta(data.metaUpgrades, META_KEY);
  older.addValor(1);
  return older;
}

/** The veteran as a Black Sun NG+ run brings it, with Black Sun's share of the upgrades. */
function broughtOnBlackSun(meta, id) {
  expect(meta.setNgPlusBring([id]).ok).toBe(true);
  const rm = startRun({
    difficultyId: 'lunatic',
    seed: 71,
    ngPlus: meta.ngPlusRunStart('lunatic'),
  });
  const { name } = meta.getNgPlus().barracks.find((r) => r.id === id);
  return rm.roster.find((u) => u.name === name);
}

describe('an innate veteran survives a write by a build from before the marker', () => {
  it('a Barracks record keeps its upgrades on Black Sun after the older build saves the slot', () => {
    // Failure (the review's probe): the older build's write drops `growthsBasis`, this build
    // reads the record as legacy and the veteran comes back with no Home Base growths
    // (+20 HP/SPD at Black Sun's 0.5 is +10 each: 80/50 became 70/40).
    const meta = unlockedMeta();
    const recruit = winWithRecruit(meta, 43);
    expect(meta.chooseNgPlusRide([{ ref: recruit.unitUid }])).toMatchObject({ ok: true });
    const innate = { ...diskRecruit().growths };
    expect(diskRecruit().growthsBasis).toBe('innate');

    olderBuildWrites();
    // The older build really did strip the marker and keep the numbers.
    expect(diskRecruit().growthsBasis).toBeUndefined();
    expect(diskRecruit().growths).toEqual(innate);

    const reopened = new MetaProgressionManager(data.metaUpgrades, META_KEY);
    const record = reopened.getNgPlus().barracks.find((r) => r.kind === 'recruit');
    expect(record.growthsBasis).toBe('innate');
    const vet = broughtOnBlackSun(reopened, record.id);
    expect(vet.growths).toEqual({ ...innate, HP: innate.HP + 10, SPD: innate.SPD + 10 });
    // This build's next write puts the marker back on the record itself.
    expect(diskRecruit().growthsBasis).toBe('innate');
  });

  it('a ride still open when the older build saves becomes an innate record', () => {
    // Failure: the pending candidate's identity loses its marker in the older write, and the
    // record this build makes from it is legacy from its first day.
    const meta = unlockedMeta();
    const recruit = winWithRecruit(meta, 47);
    expect(disk().ngPlus.pendingRide.candidates.at(-1).identity.growthsBasis).toBe('innate');

    olderBuildWrites();
    expect(disk().ngPlus.pendingRide.candidates.at(-1).identity.growthsBasis).toBeUndefined();

    const reopened = new MetaProgressionManager(data.metaUpgrades, META_KEY);
    expect(reopened.chooseNgPlusRide([{ ref: recruit.unitUid }])).toMatchObject({ ok: true });
    expect(diskRecruit().growthsBasis).toBe('innate');
  });

  it('a manager left open while the older build saves takes the marker back when it adopts', () => {
    // Failure: the stale manager adopts the older build's newer copy whole (adoptNgPlusState)
    // and writes the record back as legacy.
    const meta = unlockedMeta();
    const recruit = winWithRecruit(meta, 53);
    expect(meta.chooseNgPlusRide([{ ref: recruit.unitUid }])).toMatchObject({ ok: true });
    const older = olderBuildWrites();
    expect(older.savedAt).toBeGreaterThan(meta.savedAt);
    expect(diskRecruit().growthsBasis).toBeUndefined();

    meta.addSupply(1); // adopts the newer disk copy, then writes
    expect(meta.getNgPlus().barracks.find((r) => r.kind === 'recruit').growthsBasis).toBe('innate');
    expect(diskRecruit().growthsBasis).toBe('innate');
  });

  it('the older build carries the ledger through its own adopt of a newer copy', () => {
    // Failure: an older manager left open across this build's write drops the key it adopts.
    const meta = unlockedMeta();
    const older = new OlderBuildMeta(data.metaUpgrades, META_KEY); // opened before the ride
    const recruit = winWithRecruit(meta, 59);
    expect(meta.chooseNgPlusRide([{ ref: recruit.unitUid }])).toMatchObject({ ok: true });
    older.addValor(1);
    expect(diskRecruit().growthsBasis).toBeUndefined();
    const reopened = new MetaProgressionManager(data.metaUpgrades, META_KEY);
    expect(reopened.getNgPlus().barracks.find((r) => r.kind === 'recruit').growthsBasis).toBe(
      'innate',
    );
  });
});

describe('the ledger marks only what it was written beside', () => {
  const recruit = (id, growths, extra = {}) => ({
    id,
    kind: 'recruit',
    name: id,
    keptSkills: [],
    skillKinds: {},
    keptItems: [],
    rides: 1,
    rideLog: [],
    className: 'Fighter',
    growths,
    traits: [],
    ...extra,
  });

  it('a record whose growths no longer match its entry stays legacy', () => {
    // Failure: a record rewritten with effective growths under an id the ledger names is
    // read as innate, and the run's upgrades are added on top of upgrades already in it.
    const state = defaultNgPlusState();
    state.barracks.push(recruit('vet:a:1', { HP: 80, SPD: 50 }));
    state.barracks.push(recruit('vet:a:2', { HP: 70, SPD: 40 }));
    restoreInnateGrowths(state, {
      'vet:a:1': { HP: 70, SPD: 40 },
      'vet:a:2': { HP: 70, SPD: 40 },
      'vet:a:3': { HP: 70, SPD: 40 },
    });
    expect(state.barracks[0].growthsBasis).toBeUndefined();
    expect(state.barracks[1].growthsBasis).toBe('innate');
  });

  it('a record with a growth the entry lacks stays legacy', () => {
    const state = defaultNgPlusState();
    state.barracks.push(recruit('vet:a:1', { HP: 70, SPD: 40, LCK: 30 }));
    restoreInnateGrowths(state, { 'vet:a:1': { HP: 70, SPD: 40 } });
    expect(state.barracks[0].growthsBasis).toBeUndefined();
  });

  it('the ledger lists only marked records, so a released or legacy veteran leaves it', () => {
    const state = defaultNgPlusState();
    state.barracks.push(recruit('vet:a:1', { HP: 70 }, { growthsBasis: 'innate' }));
    state.barracks.push(recruit('vet:a:2', { HP: 60 }));
    expect(innateGrowthsLedgerOf(state)).toEqual({ 'vet:a:1': { HP: 70 } });
    state.barracks.shift();
    expect(innateGrowthsLedgerOf(state)).toEqual({});
  });
});

// A veteran's Pack (playtest 2026-10-21: "I'd love to not have to redo all my units' gear at the
// beginning of every run"): set once in the Barracks, every NG+ run sets the veteran out with
// that weapon held, those items in the convoy and those kept skills equipped; its kept accessory
// is worn. Real RunManager and MetaProgressionManager on the shipped data.
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
import { getMetaKey } from '../src/engine/SlotManager.js';
import { learnSkill } from '../src/engine/UnitManager.js';
import {
  NG_PLUS_COST,
  lordRecordId,
  normalizeNgPlusState,
  packOf,
  runStartOf,
  setPack,
} from '../src/engine/NgPlusState.js';
import { ngPlusRunEnd, startNgPlusRun } from '../src/engine/NgPlusRun.js';
import { packItemTap, packSkillTap, packView } from '../src/ui/ngPlusModel.js';
import { MAX_SKILLS } from '../src/utils/constants.js';

const data = loadGameData();
const META_KEY = getMetaKey(1);
const freshMeta = () => new MetaProgressionManager(data.metaUpgrades, META_KEY);

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

const item = (list, name, uid) => ({
  ...structuredClone(list.find((i) => i.name === name)),
  uid,
});
const weapon = (name, uid) => item(data.weapons, name, uid);
const accessory = (name, uid) => item(data.accessories, name, uid);

// Seven kept skills, more than a unit's five skill slots.
const KEPT_SKILLS = ['sol', 'luna', 'astra', 'vantage', 'adept', 'miracle', 'pavise'];

/** A bought NG+ whose Barracks holds one Fighter veteran (brought) and Edric's kit. */
function barracksMeta() {
  const meta = freshMeta();
  meta.milestones.add('beatLunatic');
  meta.addValor(NG_PLUS_COST.valor);
  meta.addSupply(NG_PLUS_COST.supply);
  expect(meta.unlockNgPlus()).toEqual({ ok: true });
  const rm = new RunManager(data);
  rm.startRun({ runSeed: 11, applyBlessingsAtStart: false, difficultyId: 'lunatic' });
  const fighter = rm._createExtraStartingUnit('Fighter');
  rm.roster.push(fighter);
  rm.ensureUnitUids();
  const vet = rm.roster.at(-1);
  learnSkill(vet, 'sol');
  vet.inventory.push(weapon('Steel Axe', 'itm_axe'));
  const edric = rm.roster.find((u) => u.name === 'Edric');
  learnSkill(edric, 'luna');
  rm.actIndex = rm.actSequence.length - 1;
  rm.status = 'victory';
  rm.settleEndRunRewards(meta, 'victory');
  expect(
    meta.chooseNgPlusRide([
      { ref: edric.unitUid, skillId: 'luna' },
      { ref: vet.unitUid, skillId: 'sol', itemUid: 'itm_axe' },
    ]),
  ).toMatchObject({ ok: true });
  const record = meta.getNgPlus().barracks.find((r) => r.kind === 'recruit');
  expect(meta.setNgPlusBring([record.id]).ok).toBe(true);
  return { meta, id: record.id, name: record.name };
}

/** The Barracks as a state with the veteran's kit grown over many rides (written directly). */
function grownState(meta, id) {
  const state = structuredClone(meta.getNgPlus());
  const record = state.barracks.find((r) => r.id === id);
  record.keptSkills = [...KEPT_SKILLS];
  record.skillKinds = Object.fromEntries(KEPT_SKILLS.map((s) => [s, 'skill']));
  record.keptItems = [
    weapon('Steel Axe', 'itm_axe'),
    weapon('Iron Axe', 'itm_iron_axe'),
    weapon('Hand Axe', 'itm_hand_axe'),
    weapon('Silver Axe', 'itm_silver_axe'),
    accessory('Power Ring', 'itm_ring'),
  ];
  return normalizeNgPlusState(state);
}

function startWith(state) {
  const rm = new RunManager(data);
  rm.startRun({
    runSeed: 21,
    applyBlessingsAtStart: false,
    difficultyId: 'lunatic',
    ngPlus: runStartOf(state),
  });
  return rm;
}

const uidsOf = (list) => (list || []).map((i) => i.uid);

describe('a veteran sets out as its Pack says', () => {
  it('Pack skills start equipped even past full slots; the rest wait on the bench', () => {
    // Failure: kept skills fill the slots in the order they were kept, so the two the player
    // wants land on the bench every run and have to be moved by hand.
    const { meta, id, name } = barracksMeta();
    const state = grownState(meta, id);
    expect(setPack(state, id, { equip: ['miracle', 'pavise'] })).toEqual({ ok: true });
    const unit = startWith(state).roster.find((u) => u.name === name);
    expect(unit.skills).toEqual(expect.arrayContaining(['miracle', 'pavise']));
    expect(unit.skills.length).toBeLessThanOrEqual(MAX_SKILLS);
    const known = [...unit.skills, ...(unit.benchedSkills || [])];
    expect(known.sort()).toEqual([...KEPT_SKILLS].sort());
    expect(unit.benchedUnseen || []).not.toEqual(expect.arrayContaining(['miracle']));

    // Without a Pack the same record keeps the old order: the last two wait on the bench.
    const plain = grownState(meta, id);
    const before = startWith(plain).roster.find((u) => u.name === name);
    expect(before.benchedSkills).toEqual(expect.arrayContaining(['miracle', 'pavise']));
  });

  it('a held weapon is equipped and convoy items start in the convoy, still kept', () => {
    // Failure: the unused axes crowd the bag every run, or a convoy item is lost from the
    // Barracks at the run's end because it was not in the veteran's bag.
    const { meta, id, name } = barracksMeta();
    const state = grownState(meta, id);
    expect(
      setPack(state, id, { wield: 'itm_silver_axe', convoy: ['itm_iron_axe', 'itm_hand_axe'] }),
    ).toEqual({ ok: true });
    const rm = startWith(state);
    const unit = rm.roster.find((u) => u.name === name);
    expect(unit.weapon?.uid).toBe('itm_silver_axe');
    expect(uidsOf(unit.inventory)).not.toContain('itm_iron_axe');
    expect(uidsOf(unit.inventory)).not.toContain('itm_hand_axe');
    expect(uidsOf(rm.convoy.weapons)).toEqual(
      expect.arrayContaining(['itm_iron_axe', 'itm_hand_axe']),
    );

    // A win: every kept item, the convoy's too, is still the veteran's.
    rm.status = 'victory';
    const refresh = ngPlusRunEnd(rm, { result: 'victory' }).refresh.find((r) => r.id === id);
    expect(uidsOf(refresh.keptItems).sort()).toEqual(
      ['itm_axe', 'itm_hand_axe', 'itm_iron_axe', 'itm_ring', 'itm_silver_axe'].sort(),
    );
  });

  it('a kept accessory is worn; the one the unit started with goes to the pool', () => {
    // Failure: the starting accessory stays on and the kept one sits in the pool every run.
    const { meta, id } = barracksMeta();
    const state = grownState(meta, id);
    const edricRecord = state.barracks.find((r) => r.id === lordRecordId('Edric'));
    edricRecord.keptItems = [accessory('Power Ring', 'itm_lord_ring')];
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 21, applyBlessingsAtStart: false, difficultyId: 'lunatic' });
    const edric = rm.roster.find((u) => u.name === 'Edric');
    const strBefore = edric.stats.STR;
    edric.accessory = accessory('Speed Ring', 'itm_started_ring');
    startNgPlusRun(rm, runStartOf(normalizeNgPlusState(state)));
    expect(edric.accessory?.uid).toBe('itm_lord_ring');
    expect(uidsOf(rm.accessories)).toContain('itm_started_ring');
    expect(edric.stats.STR).toBeGreaterThan(strBefore);
  });

  it('a full convoy keeps a convoy item in the bag, never drops it', () => {
    const { meta, id, name } = barracksMeta();
    const state = grownState(meta, id);
    setPack(state, id, { convoy: ['itm_iron_axe'] });
    const rm = new RunManager(data);
    rm.startRun({ runSeed: 21, applyBlessingsAtStart: false, difficultyId: 'lunatic' });
    rm.canAddToConvoy = () => false;
    startNgPlusRun(rm, runStartOf(state));
    const unit = rm.roster.find((u) => u.name === name);
    expect(uidsOf(unit.inventory)).toContain('itm_iron_axe');
  });
});

describe('the Pack is saved with the Barracks', () => {
  it('is kept across a reload and set through the meta save', () => {
    // Failure: the Pack is dropped by the record's whitelist, so it must be set every session.
    const { meta, id } = barracksMeta();
    expect(meta.setNgPlusPack(id, { wield: 'itm_axe' })).toMatchObject({ ok: true });
    expect(
      packOf(
        freshMeta()
          .getNgPlus()
          .barracks.find((r) => r.id === id),
      ),
    ).toEqual({
      wield: 'itm_axe',
      convoy: [],
      equip: [],
    });
  });

  it('drops ids the record no longer keeps, and refuses more skills than the slots', () => {
    const { meta, id } = barracksMeta();
    const state = grownState(meta, id);
    expect(setPack(state, id, { equip: KEPT_SKILLS.slice(0, 6) })).toEqual({
      ok: false,
      reason: 'pack_full',
    });
    expect(setPack(state, id, { equip: ['sol', 'not_kept'], convoy: ['itm_ring'] })).toEqual({
      ok: true,
    });
    const record = state.barracks.find((r) => r.id === id);
    // The accessory is always worn, never sent to the convoy.
    expect(packOf(record)).toEqual({ wield: null, convoy: [], equip: ['sol'] });
    record.keptItems = record.keptItems.filter((i) => i.uid !== 'itm_axe');
    record.pack = { wield: 'itm_axe', convoy: [], equip: ['sol'] };
    expect(packOf(normalizeNgPlusState(state).barracks.find((r) => r.id === id))).toEqual({
      wield: null,
      convoy: [],
      equip: ['sol'],
    });
  });
});

describe('the Barracks Pack view', () => {
  it('a weapon tap goes bag, held, convoy, bag; a skill tap toggles equipped', () => {
    const { meta, id } = barracksMeta();
    const state = grownState(meta, id);
    const record = () => state.barracks.find((r) => r.id === id);
    const place = () => packView(record(), data).items.find((i) => i.uid === 'itm_iron_axe');
    expect(place().label).toBe('Iron Axe · In the bag');
    for (const expected of ['Held', 'In the convoy', 'In the bag']) {
      expect(setPack(state, id, packItemTap(record(), 'itm_iron_axe')).ok).toBe(true);
      expect(place().label).toBe(`Iron Axe · ${expected}`);
    }
    expect(packView(record(), data).accessory).toBe('Worn: Power Ring');
    setPack(state, id, packSkillTap(record(), 'astra'));
    const view = packView(record(), data);
    expect(view.skills.find((s) => s.id === 'astra').equip).toBe(true);
    expect(view.equipLine).toBe('Starts equipped: 1/5 skills · 0/3 abilities');
  });
});

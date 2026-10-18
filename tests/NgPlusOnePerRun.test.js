// NG+ and one-per-run weapons (docs/specs/ng-plus.md §12, "Kept legends"): a kept item can be
// left home, a run holds one copy of each one-per-run weapon however many Barracks records keep
// it, and the NG+ screens say by name which kept legends ride. Real RunManager and
// MetaProgressionManager on the shipped data; each test names the realistic failure it catches.
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
import {
  NG_PLUS_COST,
  applyRunEnd,
  defaultNgPlusState,
  lordRecordId,
  normalizeNgPlusState,
  runStartOf,
  setKeptItemHome,
} from '../src/engine/NgPlusState.js';
import { isDuplicateLegendary } from '../src/engine/LegendaryOwnership.js';
import { barracksView, candidateDetail, ngPlusRunNote } from '../src/ui/ngPlusModel.js';

const data = loadGameData();
const META_KEY = getMetaKey(1);
const freshMeta = () => new MetaProgressionManager(data.metaUpgrades, META_KEY);

beforeEach(() => {
  for (const key of Object.keys(store)) delete store[key];
});

const weapon = (name, uid) => ({
  ...structuredClone(data.weapons.find((w) => w.name === name)),
  uid,
});

const GROWTHS = { HP: 70, STR: 50, MAG: 0, SKL: 40, SPD: 40, DEF: 30, RES: 10, LCK: 30 };

const lordRecord = (name, keptItems, extra = {}) => ({
  id: lordRecordId(name),
  kind: 'lord',
  name,
  keptSkills: [],
  skillKinds: {},
  keptItems,
  rides: 1,
  ...extra,
});

const vetRecord = (id, name, keptItems, extra = {}) => ({
  id,
  kind: 'recruit',
  name,
  keptSkills: [],
  skillKinds: {},
  keptItems,
  rides: 1,
  className: 'Mage',
  growths: { ...GROWTHS },
  traits: [],
  ...extra,
});

function startRun(state, seed = 3) {
  const rm = new RunManager(data);
  rm.startRun({
    runSeed: seed,
    applyBlessingsAtStart: false,
    difficultyId: 'lunatic',
    ngPlus: runStartOf(normalizeNgPlusState(state), { bringLimit: 6 }),
  });
  return rm;
}

/** Every copy of `name` the army holds: bags, belts and the convoy. */
function copiesHeld(rm, name) {
  const items = [
    ...rm.roster.flatMap((u) => [...(u.inventory || []), ...(u.consumables || [])]),
    ...(rm.convoy?.weapons || []),
  ];
  return items.filter((i) => i?.name?.startsWith(name));
}

const unlockedMeta = () => {
  const meta = freshMeta();
  meta.milestones.add('beatLunatic');
  meta.addValor(NG_PLUS_COST.valor);
  meta.addSupply(NG_PLUS_COST.supply);
  expect(meta.unlockNgPlus()).toEqual({ ok: true });
  return meta;
};

function winRun(rm, meta) {
  rm.actIndex = rm.actSequence.length - 1;
  rm.status = 'victory';
  return rm.settleEndRunRewards(meta, 'victory');
}

describe('a kept item left home', () => {
  it('stays out of the run and the run can find the weapon fresh', () => {
    // Failure: the toggle is saved but the item still rides (and blocks its drop).
    const state = defaultNgPlusState();
    state.barracks.push(
      lordRecord('Edric', [weapon('Breachbolt', 'itm_bb'), weapon('Steel Sword', 'itm_ss')], {
        homeUids: ['itm_bb'],
      }),
    );
    const rm = startRun(state);
    expect(copiesHeld(rm, 'Breachbolt')).toHaveLength(0);
    expect(rm.legendaryGrants || []).not.toContain('Breachbolt');
    expect(isDuplicateLegendary(rm, weapon('Breachbolt', 'itm_new'))).toBe(false);
    // The rest of the kit still rides.
    const edric = rm.roster.find((u) => u.name === 'Edric');
    expect(edric.inventory.some((i) => i.uid === 'itm_ss')).toBe(true);
    expect(rm.ngPlus.members[0].keptUids).toEqual(['itm_ss']);
  });

  it('is kept on the record untouched through a win, while one that rode and was sold is gone', () => {
    // Failure: the win's refresh reads every kept uid against the army, so an item left home
    // (never in the army) is wiped from the Barracks.
    const meta = unlockedMeta();
    const s = meta.ngPlus;
    s.barracks.push(
      lordRecord('Edric', [weapon('Breachbolt', 'itm_bb'), weapon('Steel Sword', 'itm_ss')], {
        homeUids: ['itm_bb'],
      }),
    );
    const rm = new RunManager(data);
    rm.startRun({
      runSeed: 21,
      applyBlessingsAtStart: false,
      difficultyId: 'lunatic',
      ngPlus: meta.ngPlusRunStart('lunatic'),
    });
    const edric = rm.roster.find((u) => u.name === 'Edric');
    edric.inventory = edric.inventory.filter((i) => i.uid !== 'itm_ss');
    if (edric.weapon?.uid === 'itm_ss') edric.weapon = null;
    winRun(rm, meta);
    const record = freshMeta()
      .getNgPlus()
      .barracks.find((r) => r.id === lordRecordId('Edric'));
    expect(record.keptItems.map((i) => i.uid)).toEqual(['itm_bb']);
    expect(record.keptItems[0].name).toBe('Breachbolt');
    expect(record.homeUids).toEqual(['itm_bb']);
  });

  it('the toggle is saved, refused for an item the record does not keep, and brought back', () => {
    // Failure: the choice is lost on reload, or names any uid.
    const meta = unlockedMeta();
    meta.ngPlus.barracks.push(lordRecord('Edric', [weapon('Breachbolt', 'itm_bb')]));
    expect(meta.setNgPlusItemHome(lordRecordId('Edric'), 'itm_bb', true)).toEqual({ ok: true });
    expect(freshMeta().getNgPlus().barracks[0].homeUids).toEqual(['itm_bb']);
    expect(meta.setNgPlusItemHome(lordRecordId('Edric'), 'itm_nope', true)).toMatchObject({
      ok: false,
    });
    expect(meta.setNgPlusItemHome('lord:Nobody', 'itm_bb', true)).toMatchObject({ ok: false });
    expect(meta.setNgPlusItemHome(lordRecordId('Edric'), 'itm_bb', false)).toEqual({ ok: true });
    expect(freshMeta().getNgPlus().barracks[0].homeUids).toBeUndefined();
  });

  it('a home mark for an item the record no longer keeps is dropped', () => {
    // Failure: a stale mark leaves home a later item that reuses nothing, or keeps junk forever.
    const state = normalizeNgPlusState({
      v: 1,
      barracks: [
        lordRecord('Edric', [weapon('Steel Sword', 'itm_ss')], {
          homeUids: ['itm_gone', 'itm_ss', 'itm_ss'],
        }),
      ],
    });
    expect(state.barracks[0].homeUids).toEqual(['itm_ss']);
    const s = defaultNgPlusState();
    s.barracks.push(lordRecord('Edric', [weapon('Steel Sword', 'itm_ss')]));
    expect(setKeptItemHome(s, lordRecordId('Edric'), 'itm_ss', true)).toEqual({ ok: true });
    applyRunEnd(s, {
      refresh: [{ id: lordRecordId('Edric'), keptUids: ['itm_ss'], keptItems: [] }],
    });
    // It rode (an older build's run ignores home marks), was lost, and the mark goes with it.
    expect(s.barracks[0].keptItems).toEqual([]);
    expect(s.barracks[0].homeUids).toBeUndefined();
  });

  it('a run end written without the riding list still replaces the kept items whole', () => {
    // Failure: a run started before this build (its refresh lists every kept item) settles
    // differently than it would have.
    const s = defaultNgPlusState();
    s.barracks.push(
      lordRecord('Edric', [weapon('Steel Sword', 'itm_ss'), weapon('Iron Axe', 'itm_ia')]),
    );
    applyRunEnd(s, {
      refresh: [{ id: lordRecordId('Edric'), keptItems: [weapon('Iron Axe', 'itm_ia')] }],
    });
    expect(s.barracks[0].keptItems.map((i) => i.uid)).toEqual(['itm_ia']);
  });
});

describe('one copy of a one-per-run weapon a run', () => {
  it('two records keeping the same legend bring one copy; the other waits at home, kept', () => {
    // Failure: a lord and a veteran each keep a Breachbolt and a run holds two.
    const meta = unlockedMeta();
    meta.ngPlus.barracks.push(
      lordRecord('Edric', [weapon('Breachbolt', 'itm_bb_lord')]),
      vetRecord('vet:x:1', 'Ilse', [
        weapon('Breachbolt', 'itm_bb_vet'),
        weapon('Fire', 'itm_fire'),
      ]),
    );
    meta.ngPlus.bring = ['vet:x:1'];
    const rm = new RunManager(data);
    rm.startRun({
      runSeed: 21,
      applyBlessingsAtStart: false,
      difficultyId: 'lunatic',
      ngPlus: meta.ngPlusRunStart('lunatic'),
    });
    const held = copiesHeld(rm, 'Breachbolt');
    expect(held.map((i) => i.uid)).toEqual(['itm_bb_lord']);
    const vet = rm.ngPlus.members.find((m) => m.id === 'vet:x:1');
    expect(vet.keptUids).toEqual(['itm_fire']);
    winRun(rm, meta);
    const record = freshMeta()
      .getNgPlus()
      .barracks.find((r) => r.id === 'vet:x:1');
    expect(record.keptItems.map((i) => i.uid).sort()).toEqual(['itm_bb_vet', 'itm_fire']);
  });

  it('a lord who joins after the run found the legend leaves his kept copy home', () => {
    // Failure: the third lord's kit hands the army a second copy of a weapon it already has.
    const state = defaultNgPlusState();
    state.barracks.push(lordRecord('Kira', [weapon('Breachbolt', 'itm_bb_kira')]));
    const rm = startRun(state);
    rm.roster[0].inventory.push(weapon('Breachbolt', 'itm_found'));
    const unit = rm._buildStartingLord(
      data.lords.find((l) => l.name === 'Kira'),
      { isCommander: false },
    );
    rm.resolveThirdLord(unit);
    expect(copiesHeld(rm, 'Breachbolt').map((i) => i.uid)).toEqual(['itm_found']);
    const kira = rm.ngPlus.members.find((m) => m.id === lordRecordId('Kira'));
    expect(kira.keptUids).toEqual([]);
  });
});

describe('the NG+ screens name the kept legends', () => {
  const metaWith = (records, bring = []) => {
    const meta = unlockedMeta();
    meta.ngPlus.barracks.push(...records);
    meta.ngPlus.bring = bring;
    return meta;
  };

  it('the difficulty screen names each riding legend and its keeper, never one left home', () => {
    // Failure: the player starts an NG+ run not knowing the kept Breachbolt keeps it off the
    // loot, or is told about one left home or a veteran not brought.
    const meta = metaWith(
      [
        lordRecord('Edric', [weapon('Breachbolt', 'itm_bb'), weapon('Ragnarok', 'itm_rg')], {
          homeUids: ['itm_rg'],
        }),
        vetRecord('vet:x:1', 'Ilse', [weapon('Starfall', 'itm_sf')]),
        vetRecord('vet:x:2', 'Odo', [weapon('Firstwind', 'itm_fw')]),
      ],
      ['vet:x:1'],
    );
    const note = ngPlusRunNote(meta);
    expect(note).toContain(
      "you won't find another copy this run: Breachbolt (Edric), Starfall (Ilse).",
    );
    expect(note).not.toContain('Ragnarok');
    expect(note).not.toContain('Firstwind');
    for (const key of Object.keys(store)) delete store[key];
    const plain = metaWith([lordRecord('Edric', [weapon('Steel Sword', 'itm_ss')])]);
    expect(ngPlusRunNote(plain)).not.toMatch(/another copy/);
  });

  it('the Barracks lists each kept item with its toggle and warns for a riding legend', () => {
    const state = normalizeNgPlusState({
      v: 1,
      barracks: [
        lordRecord('Edric', [weapon('Breachbolt', 'itm_bb'), weapon('Steel Sword', 'itm_ss')]),
      ],
    });
    let row = barracksView(state, data).records[0];
    expect(row.kit).toEqual([
      { uid: 'itm_bb', label: 'Breachbolt', home: false, onePerRun: true },
      { uid: 'itm_ss', label: 'Steel Sword', home: false, onePerRun: false },
    ]);
    expect(row.legendNote).toMatch(/^One per run: a run Breachbolt rides in offers no other copy/);
    setKeptItemHome(state, lordRecordId('Edric'), 'itm_bb', true);
    row = barracksView(state, data).records[0];
    expect(row.kit[0].home).toBe(true);
    expect(row.legendNote).toBe('');
  });

  it('"Who rides again?" explains a legend picked to keep', () => {
    const state = defaultNgPlusState();
    state.pendingRide = {
      runId: 'run-1',
      difficultyId: 'lunatic',
      endedAt: 1,
      picked: [],
      candidates: [
        {
          ref: 'u1',
          kind: 'lord',
          name: 'Edric',
          className: 'Lord',
          level: 10,
          tier: 'base',
          recordId: null,
          identity: null,
          items: [weapon('Breachbolt', 'itm_bb'), weapon('Steel Sword', 'itm_ss')],
          skills: [],
          skillKinds: {},
        },
      ],
    };
    const legend = candidateDetail(state, 'u1', { itemUid: 'itm_bb' }, data);
    expect(legend.itemNote).toBe(
      'Breachbolt is one per run: in a run it rides in, no other copy turns up. Leave it home from the Barracks to find it fresh.',
    );
    expect(candidateDetail(state, 'u1', { itemUid: 'itm_ss' }, data).itemNote).toBe('');
  });
});

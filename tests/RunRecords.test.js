import { beforeEach, describe, it, expect, vi } from 'vitest';
import { MAX_RECORD_FALLEN, fallenForRecord, mergeRunRecords } from '../src/engine/RunRecords.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import { getMetaKey } from '../src/engine/SlotManager.js';
import { loadGameData } from './testData.js';
import { mergeRunRecordsV1 } from './fixtures/runRecordsV1.js';
import {
  fellAtText,
  plainUnitLine,
  recordDifficulty,
  recordFacts,
  recordGear,
  recordListLabel,
  recordSkills,
  recordStatRows,
  recordTallyText,
} from '../src/ui/runRecordsContent.js';

const data = loadGameData();
const record = (id, endedAt = 1) => ({
  id,
  endedAt,
  difficulty: 'normal',
  roster: [{ name: 'Sera', className: 'Light Priestess', level: 12, isLord: true }],
});
let store;
beforeEach(() => {
  store = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
  });
});
describe('victory archive', () => {
  it('deduplicates cloud/local wins and bounds archive to newest 50', () => {
    const records = Array.from({ length: 60 }, (_, i) => record(String(i), i));
    const merged = mergeRunRecords(records, records, [null, {}]);
    expect(merged).toHaveLength(50);
    expect(merged[0].id).toBe('59');
    expect(merged.at(-1).id).toBe('10');
  });
  it('preserves victory metadata when an old record lacks a valid roster', () => {
    for (const roster of [undefined, null, {}, 'invalid']) {
      const merged = mergeRunRecords([{ ...record('old-win'), roster }]);
      expect(merged).toHaveLength(1);
      expect(merged[0]).toMatchObject({ id: 'old-win', endedAt: 1, roster: [] });
      expect(mergeRunRecords(JSON.parse(JSON.stringify(merged)))).toEqual(merged);
    }
  });
  it('persists wins and roster snapshots, excludes defeats and tolerates old saves', () => {
    const meta = new MetaProgressionManager([]);
    expect(meta.runRecords).toEqual([]);
    const win = record('run-1');
    meta.recordRunEnd({ result: 'victory', victoryRecord: win });
    win.roster[0].level = 99;
    meta.recordRunEnd({ result: 'defeat', victoryRecord: record('run-2') });
    const loaded = new MetaProgressionManager([]);
    expect(loaded.runRecords).toHaveLength(1);
    expect(loaded.runRecords[0].roster[0].level).toBe(12);
  });
});

// ── Schema v2 ──────────────────────────────────────────────────────────────

const LONG = 'X'.repeat(120);
const dirtyV2 = () => ({
  v: 2,
  id: 'v2',
  endedAt: 10,
  difficulty: 'dusk',
  roster: [
    {
      name: 'Ottoline',
      className: 'Sage',
      level: 14,
      isLord: false,
      tally: { kills: 14.9, bossKills: 2, crits: -3, healed: '120', battles: 0, refreshes: 4 },
      stats: [41.7, -2, 22, 1500, 12, 9, 11, 7],
      weapon: `  ${LONG}  `,
      items: ['Elfire', '', 7, null, 'Vulnerary', 'A', 'B', 'C', 'D', 'E', 'F'],
      accessory: 'Speed Ring',
      skills: ['charisma', 'Bad Id', 'charisma', 'vantage', 'a', 'b', 'c', 'd'],
      deeds: ['bossbane', 'x', 'y', 'z', 'w', 'v', 'u', 'BAD'],
      junk: { nested: true },
    },
  ],
  fallen: [
    { name: 'Kai', className: 'Hero', level: 7, fellAt: { act: 'act2', battle: 7.6 } },
    { name: 'Ann', className: 'Cleric', level: 3, fellAt: { act: '<b>', battle: 0 } },
    { name: 'Bo', className: 'Fighter', level: 2, fellAt: { act: 'act1', battle: -1 } },
    { name: 42 },
  ],
});

describe('victory records v2', () => {
  it('cleans and clamps every detail field (expected values written by hand)', () => {
    const [clean] = mergeRunRecords([dirtyV2()]);
    expect(clean.v).toBe(2);
    expect(clean.roster[0]).toEqual({
      name: 'Ottoline',
      className: 'Sage',
      level: 14,
      isLord: false,
      // Negative/zero counters drop; a numeric string counts; refreshes is not a tally key.
      tally: { kills: 14, bossKills: 2, healed: 120 },
      stats: [41, 0, 22, 999, 12, 9, 11, 7],
      weapon: 'X'.repeat(80),
      items: ['Elfire', 'Vulnerary', 'A', 'B', 'C', 'D', 'E'], // 7 = 4 more weapons + 3 supplies
      accessory: 'Speed Ring',
      skills: ['charisma', 'vantage', 'a', 'b', 'c'], // MAX_SKILLS, ids only, no repeats
      deeds: ['bossbane', 'x', 'y', 'z', 'w', 'v'],
    });
    expect(clean.fallen).toEqual([
      { name: 'Kai', className: 'Hero', level: 7, isLord: false, fellAt: { act: 'act2', battle: 7 } }, // prettier-ignore
      { name: 'Ann', className: 'Cleric', level: 3, isLord: false },
      { name: 'Bo', className: 'Fighter', level: 2, isLord: false, fellAt: { act: 'act1', battle: null } }, // prettier-ignore
    ]);
    // Clean is a fixed point.
    expect(mergeRunRecords(JSON.parse(JSON.stringify([clean])))).toEqual([clean]);
  });

  it('a stats array of the wrong length or with a non-number is dropped whole', () => {
    for (const stats of [[1, 2, 3], [1, 2, 3, 4, 5, 6, 7, '8'], 'HP 40', null]) {
      const raw = dirtyV2();
      raw.roster[0].stats = stats;
      expect('stats' in mergeRunRecords([raw])[0].roster[0]).toBe(false);
    }
  });

  it('a v1 record never gains v2 fields, so it still renders as plain rows', () => {
    const raw = dirtyV2();
    delete raw.v;
    const [clean] = mergeRunRecords([raw]);
    expect('v' in clean).toBe(false);
    expect('fallen' in clean).toBe(false);
    expect(Object.keys(clean.roster[0])).toEqual(['name', 'className', 'level', 'isLord']);
    // A future version reads as the v2 this client understands.
    expect(mergeRunRecords([{ ...dirtyV2(), v: 7 }])[0].v).toBe(2);
    expect(mergeRunRecords([{ ...dirtyV2(), v: '2' }])[0].v).toBeUndefined();
  });

  it('keeps at most 20 fallen in the order they fell', () => {
    const fallen = Array.from({ length: 25 }, (_, i) => ({
      name: `F${i}`,
      className: 'Fighter',
      level: 1,
    }));
    const [clean] = mergeRunRecords([{ ...dirtyV2(), fallen }]);
    expect(clean.fallen.map((u) => u.name)).toEqual(fallen.slice(0, 20).map((u) => u.name));
  });

  it('the writer keeps every fallen lord when more than 20 fell, in the order they fell', () => {
    const fallen = Array.from({ length: 24 }, (_, i) => ({ name: `F${i}`, isLord: i >= 22 }));
    fallen.push({ name: 'Caravan', isCaravan: true });
    const kept = fallenForRecord(fallen).map((u) => u.name);
    expect(kept).toHaveLength(MAX_RECORD_FALLEN);
    // 18 non-lords (F0..F17) make room for the two lords (F22, F23).
    expect(kept).toEqual([...Array.from({ length: 18 }, (_, i) => `F${i}`), 'F22', 'F23']);
  });
});

describe('victory records v2: one run from two sources', () => {
  const v2 = (over = {}) => ({ ...dirtyV2(), id: 'same', ...over });
  const stripped = (endedAt) => {
    // What an older client writes back: the v1 whitelist of the same run.
    const raw = v2({ endedAt });
    delete raw.v;
    return raw;
  };

  it('v2 beats an older client’s stripped copy whatever its end time and order', () => {
    for (const sources of [
      [[v2()], [stripped(999)]],
      [[stripped(999)], [v2()]],
    ]) {
      const [kept] = mergeRunRecords(...sources);
      expect(kept.v).toBe(2);
      expect(kept.endedAt).toBe(10);
      expect(kept.roster[0].stats).toEqual([41, 0, 22, 999, 12, 9, 11, 7]);
    }
  });

  it('the later end wins (legacy ids can collide); then the richer copy; then content', () => {
    const trimmed = v2(); // the same run, as a device that kept it trimmed holds it
    delete trimmed.roster[0].stats;
    for (const key of ['weapon', 'items', 'accessory', 'skills', 'deeds'])
      delete trimmed.roster[0][key];
    expect(mergeRunRecords([trimmed], [v2()])[0].roster[0].weapon).toBe('X'.repeat(80));
    expect(mergeRunRecords([v2()], [trimmed])[0].roster[0].weapon).toBe('X'.repeat(80));
    expect(mergeRunRecords([v2({ endedAt: 3 })], [v2({ endedAt: 4 })])[0].endedAt).toBe(4);
    const a = v2({ seed: 1 });
    const b = v2({ seed: 2 });
    expect(mergeRunRecords([a], [b])).toEqual(mergeRunRecords([b], [a]));
  });
});

describe('victory records v2 on a v1-era client', () => {
  it('an older client reads v2 records as v1, and its write-back never displaces them', () => {
    // Twelve wins: ten detailed, two trimmed, each with fallen.
    const v2 = mergeRunRecords(
      Array.from({ length: 12 }, (_, i) => ({ ...dirtyV2(), id: `w${i}`, endedAt: 100 + i })),
    );
    const old = mergeRunRecordsV1(JSON.parse(JSON.stringify(v2)));
    expect(old).toHaveLength(12);
    for (const rec of old) {
      // Exactly what v1 knew: no version, no fallen, survivors as identity rows.
      expect(Object.keys(rec)).toEqual(['id', 'endedAt', 'difficulty', 'seed', 'actsCleared', 'totalTurns', 'shadow', 'roster']); // prettier-ignore
      expect(rec.difficulty).toBe('dusk');
      expect(rec.roster).toEqual([{ name: 'Ottoline', className: 'Sage', level: 14, isLord: false }]); // prettier-ignore
      expect(plainUnitLine(rec.roster[0])).toBe('Ottoline · Sage · Lv 14');
    }
    // The older client saves and syncs its stripped copy; the next v2 merge keeps the detail.
    expect(mergeRunRecords(v2, old)).toEqual(v2);
    expect(mergeRunRecords(old, v2)).toEqual(v2);
  });
});

describe('victory records v2: size budget', () => {
  const v2Record = (i) => ({
    ...dirtyV2(),
    id: `run-${i}`,
    endedAt: 1000 + i,
  });

  it(`keeps detail on the newest 10; older ones trim to identity + tally`, () => {
    const merged = mergeRunRecords(Array.from({ length: 20 }, (_, i) => v2Record(i)));
    expect(merged.map((r) => r.endedAt)).toEqual(Array.from({ length: 20 }, (_, i) => 1019 - i));
    for (const [index, rec] of merged.entries()) {
      const unit = rec.roster[0];
      expect(rec.v).toBe(2);
      expect(unit.tally).toEqual({ kills: 14, bossKills: 2, healed: 120 });
      expect(rec.fallen).toHaveLength(3);
      if (index < 10) expect(unit.stats).toHaveLength(8);
      else expect(Object.keys(unit)).toEqual(['name', 'className', 'level', 'isLord', 'tally']);
    }
    // Deterministic and idempotent: a second pass (a reload, a sync) changes nothing.
    expect(mergeRunRecords(JSON.parse(JSON.stringify(merged)))).toEqual(merged);
    expect(mergeRunRecords(merged, [...merged].reverse())).toEqual(merged);
  });

  // Worst case the whitelist allows: 50 wins, 20 survivors and 20 fallen each, every
  // name at its 80-character clamp, every list full. A realistic full archive is the
  // same with the game's real longest names.
  function archive({ name, cls, item, epithet, survivors = 20, fallen = 20, carried = 7 }) {
    const unit = (i) => ({
      name: `${name}${i}`.slice(-80),
      className: cls,
      level: 20,
      isLord: i < 2,
      specialCharId: undefined,
      tier: 'promoted',
      portraitVariant: 'variant_falcon_knight_3',
      epithet,
      epithetForm: 'bane',
      tally: { kills: 999, bossKills: 12, crits: 120, healed: 4000, battles: 40 },
      stats: [80, 45, 45, 45, 45, 45, 45, 45],
      weapon: item,
      items: Array(carried).fill(item),
      accessory: item,
      skills: ['commanders_gambit', 'tactical_advantage', 'healing_circle', 'sol', 'luna'],
      deeds: ['held_the_line', 'would_not_fall', 'red_harvest', 'giantslayer', 'bossbane', 'veteran'], // prettier-ignore
      fellAt: { act: 'finalBoss', battle: 40 },
    });
    const records = Array.from({ length: 50 }, (_, r) => ({
      v: 2,
      id: `run_${r}_${'0'.repeat(30)}`,
      endedAt: 1_790_000_000_000 + r,
      difficulty: 'lunatic',
      noMetaMode: true,
      seed: 4_294_967_295,
      actsCleared: 5,
      totalTurns: 400,
      shadow: 100,
      roster: Array.from({ length: survivors }, (_, i) => unit(i)),
      fallen: Array.from({ length: fallen }, (_, i) => unit(i + 20)),
    }));
    return JSON.stringify(mergeRunRecords(records)).length;
  }

  it('measures the bytes of a full slot archive', () => {
    const worst = archive({
      name: 'N'.repeat(80),
      cls: 'C'.repeat(80),
      item: 'I'.repeat(80),
      epithet: 'E'.repeat(80),
    });
    const realistic = archive({
      name: 'Ottoline',
      cls: 'Light Priestess',
      item: "Vampire's Bloodshard +3",
      epithet: 'Bane of the Archmage',
    });
    const typical = archive({
      name: 'Ottoline',
      cls: 'Light Priestess',
      item: 'Steel Lance +1',
      epithet: 'the Keen Edge',
      survivors: 12,
      fallen: 3,
      carried: 3,
    });
    console.info(
      `[RunRecords] 50-win slot archive: worst ${worst} B, realistic max ${realistic} B, typical ${typical} B`,
    );
    // A slot's meta save holds all of it (×3 slots in localStorage, one cloud row each).
    // Budgets (v1's realistic ceiling was ~203 KB): a regression guard, not a target.
    expect(typical).toBeLessThan(260_000);
    expect(realistic).toBeLessThan(560_000);
    expect(worst).toBeLessThan(1_050_000);
  });
});

// ── The writer: a finished run's record ───────────────────────────────────────

describe('a won run writes a v2 record', () => {
  function wonRun() {
    const run = new RunManager(data);
    run.startRun({ runSeed: 21, applyBlessingsAtStart: false });
    const partner = run.roster[1];
    // A battle the partner does not survive: the fall is stamped with act and battle.
    const node = run.getAvailableNodes().find((n) => n.type === 'battle' || n.type === 'recruit');
    const survivors = run.roster.filter((u) => u !== partner).map((u) => structuredClone(u));
    expect(run.completeBattle(survivors, node.id, 0)).toBe(true);
    const lead = run.roster[0];
    const sword = { name: 'Steel Sword +2', type: 'Sword', uid: 'w-steel' };
    const spare = { name: 'Iron Sword', type: 'Sword', uid: 'w-iron' };
    lead.inventory = [spare, sword];
    lead.weapon = sword;
    lead.consumables = [{ name: 'Vulnerary', type: 'Consumable', uid: 'c-1' }];
    lead.accessory = { name: 'Speed Ring' };
    lead.skills = ['charisma', 'sol'];
    lead.stats = { HP: 42, STR: 19, MAG: 2, SKL: 17, SPD: 15, DEF: 12, RES: 6, LCK: 11, MOV: 5 };
    lead.deeds = {
      stats: { kills: 14, crits: 3, healed: 0, refreshes: 1, bossKills: 2, battles: 9 },
      earned: [
        { id: 'keen_edge', epithet: 'the Keen Edge', form: 'the', prestige: 2, seq: 1 },
        { id: 'bossbane', epithet: 'Bane of the Archmage', form: 'bane', prestige: 5, seq: 2 },
        { id: 'veteran', epithet: 'the Veteran', form: 'the', prestige: 1, seq: 3 },
      ],
      epithet: { id: 'bossbane', text: 'Bane of the Archmage', form: 'bane' },
    };
    run.actIndex = 3;
    return { run, partner };
  }

  it('snapshots stats, gear, skills, tallies, deeds and the fallen through the meta save', () => {
    const { run, partner } = wonRun();
    expect(run.fallenUnits[0].fellAt).toEqual({ act: 'act1', battle: 1 });
    const meta = new MetaProgressionManager(data.metaUpgrades, getMetaKey(1));
    run.settleEndRunRewards(meta, 'victory');
    // Read back the way the Records screen does: from the slot's saved meta.
    const saved = JSON.parse(localStorage.getItem(getMetaKey(1)));
    const rec = mergeRunRecords(saved.runRecords).find((r) => r.id === run.runRecordId);
    expect(rec.v).toBe(2);
    expect(rec.roster[0]).toMatchObject({
      name: 'Edric',
      epithet: 'Bane of the Archmage',
      epithetForm: 'bane',
      tally: { kills: 14, bossKills: 2, crits: 3, battles: 9 },
      stats: [42, 19, 2, 17, 15, 12, 6, 11],
      weapon: 'Steel Sword +2',
      items: ['Iron Sword', 'Vulnerary'],
      accessory: 'Speed Ring',
      skills: ['charisma', 'sol'],
      deeds: ['bossbane', 'veteran', 'keen_edge'], // the title, then newest
    });
    expect(rec.fallen).toEqual([
      expect.objectContaining({
        name: partner.name,
        className: partner.className,
        isLord: true,
        fellAt: { act: 'act1', battle: 1 },
      }),
    ]);
  });

  it('a revived unit leaves no fall behind', () => {
    const { run, partner } = wonRun();
    run.gold = 100_000;
    expect(run.reviveFallenUnit(partner.name, 0)).toBe(true);
    expect('fellAt' in run.roster.find((u) => u.name === partner.name)).toBe(false);
    const recordRunEnd = vi.fn();
    run._applySettledRewardsToMeta(
      {
        recordRunEnd,
        addValor() {},
        addSupply() {},
        incrementRunsCompleted() {},
        hasMilestone: () => false,
        recordMilestone() {},
      },
      { result: 'victory', valor: 0, supply: 0 },
    );
    const rec = mergeRunRecords([recordRunEnd.mock.calls[0][0].victoryRecord])[0];
    expect(rec.fallen).toEqual([]);
    expect(rec.roster.map((u) => u.name)).toContain(partner.name);
  });
});

// ── What the screen says ─────────────────────────────────────────────────────

describe('victory records content', () => {
  it('names the difficulty from difficulty.json with its colour', () => {
    expect(recordDifficulty(data, 'dusk')).toEqual({ id: 'dusk', label: 'Dusk', color: '#d8b95c' });
    expect(recordDifficulty(data, 'lunatic').label).toBe('Black Sun');
    expect(recordDifficulty({}, 'hard')).toEqual({ id: 'hard', label: 'Hard', color: null });
  });

  it('writes tallies, falls, stats, gear and skills', () => {
    expect(recordTallyText({ kills: 14, bossKills: 2, crits: 3 })).toBe('14 kills · 2 bosses · 3 crits'); // prettier-ignore
    expect(recordTallyText({ kills: 1, bossKills: 1, crits: 1, healed: 40, battles: 1 })).toBe(
      '1 kill · 1 boss · 1 crit · 40 HP healed · 1 battle',
    );
    expect(recordTallyText(undefined)).toBe('');
    expect(fellAtText({ act: 'act2', battle: 7 })).toBe('Fell in Act II · battle 7');
    expect(fellAtText({ act: 'finalBoss', battle: null })).toBe('Fell in Final Act');
    expect(fellAtText(undefined)).toBe('Fell on the march');
    expect(recordStatRows({ stats: [42, 19, 2, 17, 15, 12, 6, 11] }).map((r) => `${r.label} ${r.value}`)).toEqual(['HP 42', 'STR 19', 'MAG 2', 'SKL 17', 'SPD 15', 'DEF 12', 'RES 6', 'LCK 11']); // prettier-ignore
    expect(recordStatRows({})).toEqual([]);
    expect(recordGear({ weapon: 'Steel Sword', items: ['Vulnerary'], accessory: 'Speed Ring' })).toEqual([
      { name: 'Steel Sword', kind: 'weapon' },
      { name: 'Vulnerary', kind: 'item' },
      { name: 'Speed Ring', kind: 'accessory' },
    ]); // prettier-ignore
    expect(recordSkills({ skills: ['charisma', 'gone_skill'] }, data.skills).map((s) => s.name)).toEqual(['Charisma', 'Gone Skill']); // prettier-ignore
  });

  it('keeps the v1 row text and labels list rows for every reader', () => {
    expect(
      plainUnitLine({ name: 'Sera', className: 'Light Priestess', level: 15, isLord: true }),
    ).toBe('Sera · Light Priestess · Lv 15 · Lord');
    expect(
      plainUnitLine({ name: 'Edric', className: 'Great Lord', level: 9, epithet: 'Bane of the Archmage', epithetForm: 'bane' }), // prettier-ignore
    ).toBe('Edric, Bane of the Archmage · Great Lord · Lv 9');
    const [rec] = mergeRunRecords([{ ...dirtyV2(), totalTurns: 70, actsCleared: 4, noMetaMode: true }]); // prettier-ignore
    expect(recordListLabel(rec, data, 2)).toBe(
      `${new Date(10).toLocaleDateString()} · Dusk · No Meta Victory · 4 acts · 70 turns · 1 survivor · 3 fallen · Slot 2`,
    );
    expect(recordFacts({ ...rec, shadow: 58 }, data).map((f) => `${f.label}: ${f.value}`)).toEqual([
      'Acts cleared: 4',
      'Turns: 70',
      'Eclipse: Umbral · 58 shadow',
      'Seed: unknown',
    ]);
  });
});

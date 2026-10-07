// Marks are rolled once, at recruitment, by the common builder (UnitManager.createRecruitUnit)
// and reach it from every recruit source (docs/specs/phase3.md 3C). Ways this goes wrong:
//   - a source forgets to hand the builder the run seed, the catalog or the run's markChance
//     (the source then never rolls, or always rolls the base rate);
//   - the roll is keyed by a name that is not the unit's final name, so a reload or a rename
//     re-rolls it;
//   - the roll shares a stream with the caller (the recruit node's own seeded stream), so
//     marks on or off would shift traits, gear and forges rolled after it;
//   - a lord, the veteran or a prologue unit comes out marked ("recruits only" holds by
//     construction: those never go through createRecruitUnit, asserted per source);
//   - an old save with no `markId` loads marked, or a save drops the id it was given.
// Every source runs at chance 1 (all recruits marked), at chance 0 (none), and at a middle rate
// over many seeds against a 4-sigma binomial band.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { RunManager, serializeUnit } from '../src/engine/RunManager.js';
import { buildRecruitNodeUnit } from '../src/engine/RecruitNodeSystem.js';
import {
  generateBossRecruitCandidates,
  generateThirdLordCandidates,
} from '../src/engine/BossRecruitSystem.js';
import { generateMercenaryCandidates } from '../src/engine/ColosseumEngine.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { chooseEventOption } from '../src/engine/EventCommands.js';
import { arriveAs, baseData, runWithEvents, soloEvent } from './eventKit.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
// MetaProgressionManager reads and writes the profile through localStorage.
vi.stubGlobal('localStorage', {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {},
});
afterEach(() => vi.restoreAllMocks());

const band = (n, p) => 4 * Math.sqrt(n * p * (1 - p));
const markedCount = (units) => units.filter((u) => typeof u.markId === 'string').length;
// The unit minus its Mark, and minus item uids (a process-wide counter that differs per build).
const without = (unit) => {
  const copy = structuredClone(unit);
  delete copy.markId;
  const strip = (value) => {
    if (Array.isArray(value)) value.forEach(strip);
    else if (value && typeof value === 'object') {
      delete value.uid;
      Object.values(value).forEach(strip);
    }
  };
  strip(copy);
  return copy;
};
function seeded(seed) {
  let x = seed;
  return () => {
    x = (x * 16807) % 2147483647;
    return x / 2147483647;
  };
}

/** Run `fn` with Math.random replaced by a seeded stream (the unseeded rolls become repeatable). */
function withRandom(seed, fn) {
  const real = Math.random;
  Math.random = seeded(seed * 7 + 1);
  try {
    return fn();
  } finally {
    Math.random = real;
  }
}

// A run whose unseeded starting rolls (lords' growths, the Cadre's class) are repeatable, so two
// runs of one seed are the same run.
const newRun = (meta, seed = 17) =>
  withRandom(seed, () => {
    const run = new RunManager(data, meta);
    run.startRun({ runSeed: seed, applyBlessingsAtStart: false });
    return run;
  });

// ── recruit nodes ───────────────────────────────────────────────────────────

describe('recruit nodes', () => {
  const runs = new Map();
  const runFor = (seed) => {
    if (!runs.has(seed)) runs.set(seed, newRun({}, seed));
    return runs.get(seed);
  };
  // One run per seed, so a unit built with Marks on and off comes from the very same army.
  const build = (name, { meta, seed = 17, gameData = null, className = 'Archer' } = {}) => {
    const run = runFor(seed);
    const ctx = run.getRecruitBattleContext({ id: `node-${name}` });
    return buildRecruitNodeUnit({
      ...ctx,
      metaEffects: meta,
      nodeId: `node-${name}`,
      preview: { className, name },
      gameData: { ...(gameData || run.gameData), lords: [] },
    })?.unit;
  };

  it('every recruit bears a Mark at 1 and none at 0', () => {
    for (let i = 0; i < 40; i++) {
      expect(build(`R${i}`, { meta: { markChance: 1 } }).markId).toEqual(expect.any(String));
      expect(build(`R${i}`, { meta: { markChance: 0 } }).markId).toBeUndefined();
    }
  });

  it('rolls at the configured rate over many recruits', () => {
    const n = 800;
    for (const chance of [0.1, 0.25]) {
      const units = Array.from({ length: n }, (_, i) =>
        build(`R${i}`, { meta: { markChance: chance } }),
      );
      expect(Math.abs(markedCount(units) - n * chance), `at ${chance}`).toBeLessThan(
        band(n, chance),
      );
    }
  });

  it('rolls at the base 10% when the run has no markChance (an old save’s snapshot)', () => {
    const n = 800;
    const units = Array.from({ length: n }, (_, i) => build(`R${i}`, { meta: {} }));
    expect(Math.abs(markedCount(units) - n * 0.1)).toBeLessThan(band(n, 0.1));
  });

  it('is the same unit every time for the same run seed and name', () => {
    for (let i = 0; i < 25; i++) {
      const a = build(`R${i}`, { meta: { markChance: 0.5 } });
      const b = build(`R${i}`, { meta: { markChance: 0.5 } });
      expect(b.markId).toBe(a.markId);
    }
  });

  it('is the same unit with Marks on or off, apart from `markId`: its own stream is untouched', () => {
    let marked = 0;
    for (let i = 0; i < 60; i++) {
      const on = build(`R${i}`, { meta: { markChance: 1 }, seed: 100 + i });
      const off = build(`R${i}`, { meta: { markChance: 0 }, seed: 100 + i });
      const noCatalog = build(`R${i}`, {
        meta: { markChance: 1 },
        seed: 100 + i,
        gameData: { ...data, marks: undefined },
      });
      expect(on.markId).toEqual(expect.any(String));
      marked++;
      expect(off.markId).toBeUndefined();
      expect(noCatalog.markId).toBeUndefined();
      expect(without(on)).toEqual(without(off));
      expect(without(on)).toEqual(without(noCatalog));
    }
    expect(marked).toBe(60);
  });

  it('the Mark never draws from Math.random, so the battle’s stream is the same', () => {
    const roll = vi.spyOn(Math, 'random');
    build('Probe', { meta: { markChance: 1 } });
    const withMarks = roll.mock.calls.length;
    roll.mockClear();
    build('Probe', { meta: { markChance: 0 } });
    expect(roll.mock.calls.length).toBe(withMarks);
  });

  it('a lord the node rolls is never marked', () => {
    // The recruit node may roll a lord (RecruitNodeSystem); a lord is not a recruit.
    let lords = 0;
    for (let seed = 1; seed <= 400; seed++) {
      const run = newRun({ markChance: 1 }, seed);
      const ctx = run.getRecruitBattleContext({ id: `probe:${seed}` });
      const built = buildRecruitNodeUnit({
        ...ctx,
        nodeId: `probe:${seed}`,
        preview: { className: 'Archer', name: 'Probe' },
        gameData: run.gameData,
      });
      if (built?.isLord) {
        lords++;
        expect(built.unit.markId, `seed ${seed}`).toBeUndefined();
      }
    }
    expect(lords).toBeGreaterThan(3);
  });
});

// ── event joins ─────────────────────────────────────────────────────────────

describe('event joins', () => {
  const join = (seed, meta) => {
    const run = withRandom(seed, () =>
      runWithEvents([soloEvent([{ type: 'join', class: 'Archer' }])], { seed }),
    );
    run.metaEffects = meta;
    run.roster = run.roster.filter((u) => u.name !== 'Gaspar');
    const node = arriveAs(run, 'solo');
    const before = run.roster.length;
    expect(chooseEventOption(run, node.id, 'go').ok).toBe(true);
    return run.roster.slice(before)[0];
  };

  it('a unit that joins bears a Mark at 1 and none at 0, and keeps it in the roster', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(join(seed, { markChance: 1 }).markId).toEqual(expect.any(String));
      expect(join(seed, { markChance: 0 }).markId).toBeUndefined();
    }
  });

  it('rolls at the configured rate over many runs', () => {
    const n = 300;
    const units = Array.from({ length: n }, (_, i) => join(1000 + i, { markChance: 0.5 }));
    expect(Math.abs(markedCount(units) - n * 0.5)).toBeLessThan(band(n, 0.5));
  });

  it('is deterministic by run seed and name', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const a = join(seed, { markChance: 0.5 });
      const b = join(seed, { markChance: 0.5 });
      expect([b.name, b.markId]).toEqual([a.name, a.markId]);
    }
  });

  it('the unit is the same with Marks on or off, apart from `markId`', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const on = join(seed, { markChance: 1 });
      const off = join(seed, { markChance: 0 });
      expect(without(on)).toEqual(without(off));
    }
  });
});

// ── boss recruits ───────────────────────────────────────────────────────────

describe('boss recruits', () => {
  const roster = [{ name: 'Edric', isCommander: true, tier: 'base', level: 8 }];
  const offer = (runSeed, meta, { lords = false, random = runSeed } = {}) => {
    vi.spyOn(Math, 'random').mockImplementation(seeded(random + 1));
    return generateBossRecruitCandidates(
      'act1',
      roster,
      lords ? data : { ...data, lords: [] },
      meta,
      [],
      [],
      runSeed,
    );
  };

  it('every candidate bears a Mark at 1 and none at 0', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const on = offer(seed, { markChance: 1 });
      expect(on.length).toBe(3);
      for (const { unit } of on) expect(unit.markId, unit.name).toEqual(expect.any(String));
      for (const { unit } of offer(seed, { markChance: 0 })) expect(unit.markId).toBeUndefined();
    }
  });

  it('rolls at the configured rate over many offers', () => {
    const units = [];
    for (let seed = 1; seed <= 250; seed++)
      units.push(...offer(seed, { markChance: 0.25 }).map((c) => c.unit));
    expect(Math.abs(markedCount(units) - units.length * 0.25)).toBeLessThan(
      band(units.length, 0.25),
    );
  });

  it('is deterministic by run seed and name, whatever the draft’s own stream does', () => {
    // The draft's class and name draws use Math.random; the Mark must depend only on the seed
    // and the name. Two offers on different draft streams that happen to pick the same name
    // give that name the same Mark.
    const marksByName = new Map();
    let shared = 0;
    for (let random = 1; random <= 60; random++) {
      for (const { unit } of offer(5, { markChance: 0.5 }, { random })) {
        const seen = marksByName.get(unit.name);
        if (seen !== undefined) {
          shared++;
          expect(unit.markId ?? null, unit.name).toBe(seen);
        }
        marksByName.set(unit.name, unit.markId ?? null);
      }
    }
    expect(shared).toBeGreaterThan(10);
  });

  it('a lord candidate is never marked', () => {
    let lordCandidates = 0;
    for (let seed = 1; seed <= 200; seed++) {
      for (const candidate of offer(seed, { markChance: 1 }, { lords: true })) {
        if (!candidate.isLord) continue;
        lordCandidates++;
        expect(candidate.unit.markId, candidate.unit.name).toBeUndefined();
      }
    }
    expect(lordCandidates).toBeGreaterThan(3);
  });

  it('with no run seed handed in, nothing is rolled', () => {
    for (const { unit } of offer(null, { markChance: 1 }, { random: 3 }))
      expect(unit.markId).toBeUndefined();
  });
});

// ── colosseum mercenaries ───────────────────────────────────────────────────

describe('colosseum mercenaries', () => {
  // Growths roll from Math.random inside the builder, so a board is repeatable only under one.
  const board = (runSeed, meta, boardSeed = runSeed) =>
    withRandom(boardSeed, () =>
      generateMercenaryCandidates(
        'act2',
        8,
        data.recruits,
        data.classes,
        data.weapons,
        data.skills,
        'normal',
        data.colosseum,
        seeded(boardSeed + 1),
        data.traits,
        [],
        meta,
        { runSeed, marksData: data.marks },
      ),
    );

  it('every mercenary bears a Mark at 1 and none at 0', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const on = board(seed, { markChance: 1 });
      expect(on.length).toBeGreaterThan(0);
      for (const { unit } of on) expect(unit.markId, unit.name).toEqual(expect.any(String));
      for (const { unit } of board(seed, { markChance: 0 })) expect(unit.markId).toBeUndefined();
    }
  });

  it('rolls at the configured rate over many boards', () => {
    const units = [];
    for (let seed = 1; seed <= 250; seed++)
      units.push(...board(seed, { markChance: 0.25 }).map((c) => c.unit));
    expect(Math.abs(markedCount(units) - units.length * 0.25)).toBeLessThan(
      band(units.length, 0.25),
    );
  });

  it('the board is the same with Marks on or off, apart from `markId` (its rng is untouched)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const on = board(seed, { markChance: 1 });
      const off = board(seed, { markChance: 0 });
      expect(on.map((c) => without(c.unit))).toEqual(off.map((c) => without(c.unit)));
      expect(on.map((c) => c.hireCost)).toEqual(off.map((c) => c.hireCost));
    }
  });

  it('rolls nothing when the caller hands in no Mark context', () => {
    const plain = generateMercenaryCandidates(
      'act2',
      8,
      data.recruits,
      data.classes,
      data.weapons,
      data.skills,
      'normal',
      data.colosseum,
      seeded(3),
      data.traits,
      [],
      { markChance: 1 },
    );
    expect(plain.length).toBeGreaterThan(0);
    expect(markedCount(plain.map((c) => c.unit))).toBe(0);
  });
});

// ── the Vanguard Cadre ──────────────────────────────────────────────────────

describe('the Vanguard Cadre’s extra starter', () => {
  const cadre = (seed, chance) => {
    const run = newRun({ extraStartingUnitTier: 1, markChance: chance }, seed);
    return run.roster.find((u) => !u.isLord && u.specialCharId !== 'old_knight');
  };

  it('bears a Mark at 1 and none at 0', () => {
    for (let seed = 1; seed <= 15; seed++) {
      expect(cadre(seed, 1)?.markId, `seed ${seed}`).toEqual(expect.any(String));
      expect(cadre(seed, 0)?.markId).toBeUndefined();
    }
  });

  it('rolls at the configured rate over many runs, and the same run gives the same Mark', () => {
    const n = 300;
    const units = Array.from({ length: n }, (_, i) => cadre(2000 + i, 0.5));
    expect(units.every(Boolean)).toBe(true);
    expect(Math.abs(markedCount(units) - n * 0.5)).toBeLessThan(band(n, 0.5));
    expect(cadre(2003, 0.5).markId).toBe(units[3].markId);
  });

  it('keeps its Mark through serializeUnit', () => {
    const unit = cadre(11, 1);
    expect(serializeUnit(unit).markId).toBe(unit.markId);
  });
});

// ── who never bears one ─────────────────────────────────────────────────────

describe('lords, the veteran and the prologue never bear a Mark', () => {
  it('a standard run’s starting lords and its veteran, even at a rate of 1', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const run = newRun({ markChance: 1, extraStartingUnitTier: 1 }, seed);
      const lords = run.roster.filter((u) => u.isLord);
      const veteran = run.roster.find((u) => u.specialCharId === 'old_knight');
      expect(lords.length).toBeGreaterThanOrEqual(2);
      expect(veteran?.name).toBe('Gaspar');
      for (const unit of [...lords, veteran]) expect(unit.markId, unit.name).toBeUndefined();
      // and the same roster does hold a marked recruit, so the check above can fail
      expect(markedCount(run.roster)).toBe(1);
    }
  });

  it('the third lord (Power of Friendship) is never marked', () => {
    const roster = [
      { name: 'Edric', className: 'Lord', isLord: true, level: 8, faction: 'player' },
      { name: 'Sera', className: 'Light Sage', isLord: true, level: 7, faction: 'player' },
    ];
    const result = generateThirdLordCandidates(roster, data, { markChance: 1 }, [], 'pick_all');
    expect(result.candidates.length).toBeGreaterThan(0);
    for (const { unit } of result.candidates) expect(unit.markId, unit.name).toBeUndefined();
  });

  it('the prologue’s authored units, including Tamsin when she joins, carry none', () => {
    const run = new RunManager(data, { markChance: 1 });
    run.startPrologue(data, data.prologue);
    const joinNodes = Object.values(data.prologue.joins?.atNode || {}).length;
    expect(joinNodes).toBeGreaterThan(0);
    for (const node of run.nodeMap.nodes) run.arriveAtPrologueNode(node.id);
    expect(run.roster.length).toBeGreaterThan(1);
    for (const unit of run.roster) expect(unit.markId, unit.name).toBeUndefined();
  });
});

// ── Marked Blood and old saves ──────────────────────────────────────────────

describe('Marked Blood reaches the run, and an old save has none', () => {
  const upgrade = data.metaUpgrades.find((u) => u.id === 'marked_blood');

  it('the upgrade is two tiers of recruit_stats behind the first act: 250 / 400 for 1 in 6, 1 in 4', () => {
    expect(upgrade).toMatchObject({
      category: 'recruit_stats',
      maxLevel: 2,
      costs: [250, 400],
      requires: { milestones: ['beatAct1'] },
    });
    expect(upgrade.effects).toEqual([{ markChance: 0.1667 }, { markChance: 0.25 }]);
  });

  it('a profile with no upgrade rolls at one in ten, and each tier raises it', () => {
    const effectsAt = (level) => {
      const meta = new MetaProgressionManager(data.metaUpgrades);
      meta.purchasedUpgrades.marked_blood = level;
      return meta.getActiveEffects();
    };
    expect(effectsAt(0).markChance).toBe(0.1);
    expect(effectsAt(1).markChance).toBe(0.1667);
    expect(effectsAt(2).markChance).toBe(0.25);
  });

  it('the run snapshots the rate at its start and keeps it through a save', () => {
    const meta = new MetaProgressionManager(data.metaUpgrades);
    meta.purchasedUpgrades.marked_blood = 2;
    const run = new RunManager(data, meta.getActiveEffects());
    run.startRun({ runSeed: 3, applyBlessingsAtStart: false });
    expect(run.getEffectiveMetaEffects().markChance).toBe(0.25);
    const loaded = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
    expect(loaded.getEffectiveMetaEffects().markChance).toBe(0.25);
  });

  it('a unit saved without `markId` loads with none, and one with it keeps it', () => {
    const run = newRun({ markChance: 0 }, 9);
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    expect(saved.roster.every((u) => !('markId' in u))).toBe(true);
    const loaded = RunManager.fromJSON(saved, data);
    expect(loaded.roster.every((u) => u.markId === undefined)).toBe(true);

    saved.roster[0].markId = 'ember';
    saved.roster[1].markId = 'a_mark_from_the_future';
    const reloaded = RunManager.fromJSON(JSON.parse(JSON.stringify(saved)), data);
    expect(reloaded.roster[0].markId).toBe('ember');
    // The id is kept as saved but never read: an unknown one is simply no Mark.
    expect(reloaded.roster[1].markId).toBe('a_mark_from_the_future');
  });
});

describe('the data every source reads', () => {
  it('gameData carries the catalog wherever the test loader and the event kit do', () => {
    expect(data.marks).toHaveLength(5);
    expect(baseData.marks).toHaveLength(5);
  });
});

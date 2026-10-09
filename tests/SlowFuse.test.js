// Slow Fuse (docs/specs/blessings-v3.md §5.1): the starting lords take -1 to HP and the seven
// combat stats in Act 1 and +1 from Act 2 (never Move). The Act 1 dip is the card's price.
//
// Ways this can fail, a test each:
//   1. a stat is missed (Move included, a stat left out), or the dip is not taken at all;
//   2. the rise never lands, lands twice (a reload between acts, a repeated advanceAct), or the
//      dip is "taken back" twice so the lords end at +2 instead of +1;
//   3. a stat already at 0 goes negative, or the revert gives back more than the dip took;
//   4. recruits, a late-joining lord or any non-starting unit is touched;
//   5. a lord who fell during the dip comes back at -1, or a lord is short the rise;
//   6. current HP is left above the dipped maximum, or the rise is not healed into at Act 2;
//   7. a save made during Act 1 loses the tracker (no rise ever);
//   8. a malformed boon applies something, or a bad saved tracker crashes the load.
import { describe, expect, it, vi } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { createUnit } from '../src/engine/UnitManager.js';
import { sanitizeLordStatArcs } from '../src/engine/LordStatArc.js';
import { XP_STAT_NAMES } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const fuse = data.blessings.blessings.find((b) => b.id === 'slow_fuse');
const STATS = [...XP_STAT_NAMES];

function startRun(seed = 21) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId: 'dusk', applyBlessingsAtStart: false });
  return rm;
}
/** A run holding Slow Fuse, applied as the shrine applies it. */
function fuseRun(seed) {
  const rm = startRun(seed);
  rm.activeBlessings = [
    { id: 'slow_fuse', rolledCost: { label: 'The Act 1 dip', effects: [], kind: 'intrinsic' } },
  ];
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
  return rm;
}
const lordsOf = (rm) => rm.roster.filter((u) => u.isLord);
const snapshot = (units) => units.map((u) => ({ name: u.name, ...structuredClone(u.stats) }));
const reload = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);

/** Base stats of the run's lords before Slow Fuse (a run on the same seed without it). */
function baseStats(seed) {
  return snapshot(lordsOf(startRun(seed)));
}

describe('Slow Fuse', () => {
  it('ships as a tier II card whose boon is the arc and whose price is the dip', () => {
    expect(fuse.tier).toBe(2);
    expect(fuse.boons).toHaveLength(1);
    expect(fuse.boons[0].type).toBe('lord_stat_arc');
    expect(fuse.boons[0].params).toMatchObject({
      dipAct: 'act1',
      dip: -1,
      riseAct: 'act2',
      rise: 1,
    });
    expect([...fuse.boons[0].params.stats].sort()).toEqual([...STATS].sort());
    expect(fuse.boons[0].params.stats).not.toContain('MOV');
    expect(fuse.intrinsicPrice).toEqual({ label: 'The Act 1 dip', points: 2 });
  });

  it('Act 1: every starting lord is one lower in HP and the seven combat stats, Move unchanged', () => {
    const base = baseStats(21);
    const rm = fuseRun(21);
    const lords = lordsOf(rm);
    expect(lords.length).toBeGreaterThan(0);
    lords.forEach((lord, i) => {
      for (const stat of STATS) {
        const floor = stat === 'HP' ? 1 : 0;
        expect(lord.stats[stat], `${lord.name} ${stat}`).toBe(Math.max(floor, base[i][stat] - 1));
      }
      expect(lord.stats.MOV, `${lord.name} MOV`).toBe(base[i].MOV);
    });
  });

  it('Act 2: the lords end one above where they began, not two (the dip is given back once)', () => {
    const base = baseStats(21);
    const rm = fuseRun(21);
    rm.advanceAct();
    lordsOf(rm).forEach((lord, i) => {
      for (const stat of STATS)
        expect(lord.stats[stat], `${lord.name} ${stat}`).toBe(base[i][stat] + 1);
      expect(lord.stats.MOV).toBe(base[i].MOV);
    });
  });

  it('the rise lands once: Act 3 and a reload between acts add nothing', () => {
    const base = baseStats(21);
    const rm = fuseRun(21);
    rm.advanceAct();
    const afterTwo = snapshot(lordsOf(rm));
    const reloaded = reload(rm);
    reloaded.advanceAct();
    rm.advanceAct();
    expect(snapshot(lordsOf(rm))).toEqual(afterTwo);
    expect(snapshot(lordsOf(reloaded))).toEqual(afterTwo);
    afterTwo.forEach((lord, i) => expect(lord.STR).toBe(base[i].STR + 1));
  });

  it('a stat already at 0 never goes below 0, and the revert returns no more than the dip took', () => {
    const rm = startRun(21);
    const lord = lordsOf(rm)[0];
    lord.stats.LCK = 0;
    lord.stats.MAG = 0;
    lord.stats.HP = 1;
    lord.currentHP = 1;
    const base = snapshot([lord])[0];
    rm.activeBlessings = [{ id: 'slow_fuse', rolledCost: null }];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(lord.stats.LCK).toBe(0);
    expect(lord.stats.MAG).toBe(0);
    expect(lord.stats.HP).toBe(1);
    rm.advanceAct();
    // Nothing was taken, nothing is given back: just the rise.
    expect(lord.stats.LCK).toBe(1);
    expect(lord.stats.MAG).toBe(1);
    expect(lord.stats.HP).toBe(2);
    expect(lord.stats.STR).toBe(base.STR + 1);
  });

  it('recruits and late-joining lords are untouched, in Act 1 and after', () => {
    const rm = fuseRun(21);
    const fighter = data.classes.find((c) => c.name === 'Fighter');
    const make = (name, isLord) => {
      const unit = createUnit(fighter, 4, data.weapons, { name });
      unit.faction = 'player';
      unit.isLord = isLord;
      rm.grantRecruitBlessingConsumables(unit);
      rm.assignUnitUid(unit);
      rm.roster.push(unit);
      return { unit, before: structuredClone(unit.stats) };
    };
    const recruit = make('Kira', false);
    const thirdLord = make('Third', true);
    expect(recruit.unit.stats).toEqual(recruit.before);
    expect(thirdLord.unit.stats).toEqual(thirdLord.before);
    rm.advanceAct();
    expect(recruit.unit.stats).toEqual(recruit.before);
    expect(thirdLord.unit.stats).toEqual(thirdLord.before);
  });

  it('a lord who fell during the dip comes back at the same total as one who lived', () => {
    const base = baseStats(21);
    const rm = fuseRun(21);
    const lords = lordsOf(rm);
    // The last lord falls in Act 1 (serialized into the fallen list, as completeBattle does).
    const fallenIndex = lords.length - 1;
    const fallen = lords[fallenIndex];
    rm.roster = rm.roster.filter((u) => u !== fallen);
    rm.fallenUnits.push(fallen);
    rm.advanceAct();
    for (const stat of STATS) {
      expect(fallen.stats[stat], `fallen ${stat}`).toBe(base[fallenIndex][stat] + 1);
    }
  });

  it('current HP never exceeds the dipped maximum, and Act 2 starts the lords whole at the new one', () => {
    const rm = fuseRun(21);
    const lord = lordsOf(rm)[0];
    expect(lord.currentHP).toBeLessThanOrEqual(lord.stats.HP);
    const dippedMax = lord.stats.HP;
    lord.currentHP = Math.max(1, dippedMax - 4); // wounded at the act's end
    rm.advanceAct();
    expect(lord.stats.HP).toBe(dippedMax + 2);
    expect(lord.currentHP).toBe(lord.stats.HP);
  });

  it('a save made during Act 1 still raises the lords in Act 2', () => {
    const base = baseStats(21);
    const rm = fuseRun(21);
    const restored = reload(rm);
    expect(restored.blessingRuntimeModifiers.lordStatArcs).toHaveLength(1);
    lordsOf(restored).forEach((lord, i) => {
      expect(lord.stats.STR, 'dip survives the load').toBe(Math.max(0, base[i].STR - 1));
    });
    restored.advanceAct();
    lordsOf(restored).forEach((lord, i) => {
      expect(lord.stats.STR).toBe(base[i].STR + 1);
      expect(lord.stats.HP).toBe(base[i].HP + 1);
    });
  });

  it('taken in Act 2 or later (a mid-run grant) it is only the rise, with no dip', () => {
    const base = baseStats(21);
    const rm = startRun(21);
    rm.advanceAct();
    const afterAdvance = snapshot(lordsOf(rm));
    rm.activeBlessings = [{ id: 'slow_fuse', rolledCost: null }];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    lordsOf(rm).forEach((lord, i) => {
      expect(lord.stats.STR).toBe(afterAdvance[i].STR + 1);
      expect(lord.stats.STR).toBe(base[i].STR + 1);
    });
    rm.advanceAct();
    lordsOf(rm).forEach((lord, i) => expect(lord.stats.STR).toBe(base[i].STR + 1));
  });

  it('a dip whose end-of-act revert was missed is still given back at the next act entry', () => {
    // An older client advanced the act, or a dev start set actIndex directly: the end-of-act
    // revert never ran, so the dip would be permanent without the entry-time repair.
    const base = baseStats(21);
    const rm = fuseRun(21);
    const revert = vi.spyOn(rm, '_revertActScopedBlessingEffects').mockImplementation(() => {});
    rm.advanceAct(); // Act 2 entry, with the Act 1 revert skipped
    const tracker = rm.blessingRuntimeModifiers.lordStatArcs[0];
    expect(tracker.dipReverted).toBe(true);
    lordsOf(rm).forEach((lord, i) => {
      for (const stat of STATS)
        expect(lord.stats[stat], `act 2 ${lord.name} ${stat}`).toBe(base[i][stat] + 1);
    });
    // Act 3 (revert still skipped): net +1, neither a second give-back nor a second rise.
    rm.advanceAct();
    revert.mockRestore();
    lordsOf(rm).forEach((lord, i) => {
      for (const stat of STATS)
        expect(lord.stats[stat], `act 3 ${lord.name} ${stat}`).toBe(base[i][stat] + 1);
    });
  });

  it('the repair gives back only what the dip took, and only once, for a lord who fell', () => {
    const base = baseStats(21);
    const rm = fuseRun(21);
    const lords = lordsOf(rm);
    const fallen = lords[lords.length - 1];
    rm.roster = rm.roster.filter((u) => u !== fallen);
    rm.fallenUnits.push(fallen);
    vi.spyOn(rm, '_revertActScopedBlessingEffects').mockImplementation(() => {});
    rm.advanceAct();
    rm.advanceAct();
    for (const stat of STATS)
      expect(fallen.stats[stat], stat).toBe(base[lords.length - 1][stat] + 1);
    const reverts = rm.blessingHistory.filter(
      (r) => r.effectType === 'lord_stat_arc' && r.details?.revertedInAct,
    );
    expect(reverts).toHaveLength(1);
  });

  it('records what it did, and a malformed boon changes nothing', () => {
    const rm = fuseRun(21);
    const record = rm.blessingHistory.find(
      (r) => r.blessingId === 'slow_fuse' && r.effectType === 'lord_stat_arc',
    );
    expect(record.details).toMatchObject({ dipAct: 'act1', dip: -1, dipTaken: true });
    expect(record.details.skipped).toBeUndefined();

    const bad = startRun(21);
    const before = snapshot(lordsOf(bad));
    for (const params of [
      { stats: [], dipAct: 'act1', dip: -1, riseAct: 'act2', rise: 1 },
      { stats: ['STR'], dipAct: 'act9', dip: -1, riseAct: 'act2', rise: 1 },
      { stats: ['STR'], dipAct: 'act1', dip: 0, riseAct: 'act2', rise: 0 },
      { stats: ['NOPE'], dipAct: 'act1', dip: -1, riseAct: 'act2', rise: 1 },
    ])
      bad._applySingleRunStartBlessingEffect('slow_fuse', { type: 'lord_stat_arc', params });
    expect(snapshot(lordsOf(bad))).toEqual(before);
    expect(bad.blessingRuntimeModifiers.lordStatArcs).toEqual([]);
  });

  it('a load drops malformed saved trackers instead of crashing', () => {
    expect(sanitizeLordStatArcs(undefined)).toEqual([]);
    expect(
      sanitizeLordStatArcs([
        null,
        { blessingId: 'slow_fuse' },
        {
          blessingId: 'slow_fuse',
          stats: ['STR', 'NOPE'],
          dipAct: 'act1',
          dip: -1,
          riseAct: 'act2',
          rise: 1,
          unitUids: ['u1', 7],
          dipApplied: { u1: { STR: -1, NOPE: -1 }, u2: 'x' },
        },
      ]),
    ).toEqual([
      {
        blessingId: 'slow_fuse',
        stats: ['STR'],
        dipAct: 'act1',
        dip: -1,
        riseAct: 'act2',
        rise: 1,
        unitUids: ['u1'],
        dipTaken: false,
        dipApplied: { u1: { STR: -1 } },
        dipReverted: false,
        riseApplied: false,
      },
    ]);
    const rm = fuseRun(21);
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    saved.blessingRuntimeModifiers.lordStatArcs = 'garbage';
    expect(RunManager.fromJSON(saved, data).blessingRuntimeModifiers.lordStatArcs).toEqual([]);
  });
});

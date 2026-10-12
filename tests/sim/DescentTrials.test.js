// sim:descent's pairing (sim/lib/DescentTrials.js, sim/descent.js `report`): two arms of one
// trial are compared only when every condition matches, never on the seed alone.
//
// Each test names the realistic failure it catches. Expected values are worked by hand from the
// synthetic records, never by re-running the code under test.
import { describe, it, expect, vi } from 'vitest';
import { loadGameData } from '../testData.js';
import {
  CELL_DEFAULTS,
  indexCaptures,
  pairTrials,
  stonesKey,
  trialCell,
} from '../../sim/lib/DescentTrials.js';
import { actOutcome, battleOutcome, bossFightOf, report } from '../../sim/descent.js';

const data = loadGameData();
const STONES = { actBoss: 1, emperor: 1, lieutenant: 2, eliteCaptain: 0 };

/** One Act V battle: the finale, lost (a commander fall), won or stalled. */
const finale = (outcome, arm) => ({
  act: 'finalBoss',
  type: 'boss',
  boss: true,
  descentKey: arm === 'legacy' ? null : 'entity',
  turns: outcome === 'stall' ? 31 : 6,
  par: 10,
  commanderKOs: outcome === 'lost' ? 1 : 0,
  unitDeaths: 0,
  rewinds: 0,
  stalled: outcome === 'stall',
});

/** An Act V record as playActV writes it (the fields the report reads). */
const act5 = (arm, seed, meta, outcome, extra = {}) => ({
  kind: 'act5',
  arm,
  difficulty: 'hard',
  seed,
  meta,
  fork: 'keyed',
  agent: 'claiming',
  ruleset: 'r1',
  stones: STONES,
  result: 'victory',
  riteStart: arm === 'legacy' ? null : 5,
  riteFinal: arm === 'legacy' ? null : 5,
  path: [],
  battles: [finale(outcome, arm)],
  ...extra,
});

/** The paired-Δ cells of a report table, by title prefix. */
function deltaColumn(md, titlePrefix, column) {
  const lines = md.split('\n');
  const at = lines.findIndex((l) => l.startsWith(`### ${titlePrefix}`));
  const start = lines.findIndex((l, i) => i > at && l.startsWith('| '));
  const cols = lines[start].split('|').map((c) => c.trim());
  const rows = [];
  for (let i = start + 2; lines[i]?.startsWith('| '); i++)
    rows.push(lines[i].split('|').map((c) => c.trim())[cols.indexOf(column)]);
  return rows;
}

function quietReport(records) {
  const log = vi.spyOn(console, 'log').mockImplementation(() => {});
  try {
    return report(records, data);
  } finally {
    log.mockRestore();
  }
}

describe('sim:descent pairs records by the whole trial identity', () => {
  // The reviewer's case: Nightfall seed 200001 in two cohorts (half meta: both arms lost;
  // endgame meta: both arms won). Each arm is at 50% pooled and the Descent changes nothing.
  const reviewerCase = [
    act5('legacy', 200001, 'half', 'lost'),
    act5('descent', 200001, 'half', 'lost'),
    act5('legacy', 200001, 'endgame', 'won'),
    act5('descent', 200001, 'endgame', 'won'),
  ];

  it('two cohorts that share a seed are two cells, each with a paired Δ of 0', () => {
    // Failure: pairing on the seed alone lets the endgame run overwrite the half-meta one, so
    // the half-meta legacy loss is compared with an endgame win (+100) and the table says +50.
    const md = quietReport(reviewerCase);
    for (const title of ['Act V clear rate', 'Act V KO-free rate']) {
      const deltas = deltaColumn(md, title, 'Δ Descent (pts)');
      expect(deltas).toEqual(['0.0', '0.0']);
    }
    const cells = pairTrials(
      reviewerCase.filter((r) => r.kind === 'act5'),
      ['legacy', 'descent'],
    );
    expect(cells.map((c) => [c.cell.meta, c.complete.length])).toEqual([
      ['half', 1],
      ['endgame', 1],
    ]);
    for (const c of cells)
      expect(c.complete[0].byArm.legacy.meta).toBe(c.complete[0].byArm.descent.meta);
  });

  it('a duplicate trial identity throws, never overwrites', () => {
    // Failure: the same record file passed twice (or two runs of one cell) silently keeps the
    // later record, so counts look right while a run is lost.
    const twice = [...reviewerCase, act5('legacy', 200001, 'half', 'won')];
    expect(() => quietReport(twice)).toThrow(/duplicate trial identit/);
    expect(() => pairTrials(twice, ['legacy', 'descent'])).toThrow(/duplicate/);
    expect(() =>
      indexCaptures([
        { kind: 'capture', difficulty: 'hard', meta: 'half', seed: 1 },
        { kind: 'capture', difficulty: 'hard', meta: 'half', seed: 1 },
      ]),
    ).toThrow(/duplicate capture/);
    // The same seed under another preset is another trial, not a duplicate.
    expect(() =>
      indexCaptures([
        { kind: 'capture', difficulty: 'hard', meta: 'half', seed: 1 },
        { kind: 'capture', difficulty: 'hard', meta: 'endgame', seed: 1 },
      ]),
    ).not.toThrow();
  });

  it('a record with no partner is counted, and the paired numbers leave it out', () => {
    // Failure: a legacy run whose Descent arm errored is still averaged into the legacy rate
    // (the arms read different populations) or vanishes without a word.
    const records = [
      act5('legacy', 1, 'half', 'won'),
      act5('descent', 1, 'half', 'won'),
      act5('legacy', 2, 'half', 'lost'),
      act5('descent', 3, 'half', 'lost'),
    ];
    const [cell] = pairTrials(records, ['legacy', 'descent']);
    expect(cell.complete.map((t) => t.seed)).toEqual([1]);
    expect(cell.unpaired).toEqual({ legacy: 1, descent: 1 });
    const md = quietReport(records);
    expect(deltaColumn(md, 'Act V clear rate', 'legacy')).toEqual(['100% [21, 100]']);
    expect(deltaColumn(md, 'The cells', 'unpaired records')).toEqual(['legacy 1 · descent 1']);
  });

  it('a partner played under other conditions is another cell, never a pair', () => {
    // Failure: a legacy arm replayed at one stone count is paired with a Descent arm replayed at
    // another (or under another fork, agent or ruleset) as if they were one trial.
    const other = [
      act5('legacy', 1, 'half', 'won'),
      act5('descent', 1, 'half', 'won', { stones: { ...STONES, lieutenant: 1 } }),
      act5('legacy', 2, 'half', 'won'),
      act5('descent', 2, 'half', 'won', { fork: 'battle' }),
      act5('legacy', 3, 'half', 'won'),
      act5('descent', 3, 'half', 'won', { ruleset: 'r2' }),
      act5('legacy', 4, 'half', 'won'),
      act5('descent', 4, 'half', 'won', { agent: 'other' }),
    ];
    const cells = pairTrials(other, ['legacy', 'descent']);
    expect(cells.length).toBe(5);
    expect(cells.every((c) => !c.pairable)).toBe(true);
    expect(
      cells.reduce((n, c) => n + Object.values(c.unpaired).reduce((a, b) => a + b, 0), 0),
    ).toBe(8);
  });

  it('a record written before the identity fields reads with the documented defaults', () => {
    // Failure: old jsonl files (no fork, agent, ruleset or stones) fail to load, or every old
    // record lands in a cell of its own and nothing pairs.
    const old = (arm) => ({ kind: 'act5', arm, difficulty: 'hard', seed: 7, meta: 'half' });
    expect(trialCell(old('legacy'))).toEqual({
      difficulty: 'hard',
      meta: 'half',
      fork: 'keyed',
      agent: 'claiming',
      stones: 'unrecorded',
      ruleset: 'unrecorded',
    });
    expect(CELL_DEFAULTS.fork).toBe('keyed');
    const [cell] = pairTrials([old('legacy'), old('descent')], ['legacy', 'descent']);
    expect(cell.complete.length).toBe(1);
    // Key order in a stones table does not split a cell.
    expect(stonesKey({ lieutenant: 2, actBoss: 1 })).toBe(stonesKey({ actBoss: 1, lieutenant: 2 }));
  });
});

describe('sim:descent splits a lost run into a commander loss and a stall', () => {
  it('reads each run at its first lost battle: win, commander loss or stall', () => {
    // Failure: a stall is read as a win (KO-free), or a battle with a fall that also ran to the
    // cap is read as a stall rather than the run's end.
    expect(battleOutcome({ commanderKOs: 0, stalled: false })).toBe('win');
    expect(battleOutcome({ commanderKOs: 1, stalled: true })).toBe('commander');
    expect(battleOutcome({ commanderKOs: 0, stalled: true })).toBe('stall');
    const run = (battles, result = 'victory') => ({ battles, result });
    const won = { commanderKOs: 0, stalled: false };
    expect(actOutcome(run([won, won]))).toBe('win');
    expect(actOutcome(run([won, { commanderKOs: 0, stalled: true }, { commanderKOs: 2 }]))).toBe(
      'stall',
    );
    expect(actOutcome(run([{ commanderKOs: 1, stalled: false }, won]))).toBe('commander');
    expect(actOutcome(run([won], 'timeout'))).toBe('other');
  });

  it('the outcome table gives each arm its three shares, summing to the arm', () => {
    // Failure: the shares are read over different populations or a stall is folded into wins.
    const records = [
      act5('legacy', 1, 'half', 'won'),
      act5('descent', 1, 'half', 'stall'),
      act5('legacy', 2, 'half', 'stall'),
      act5('descent', 2, 'half', 'lost'),
      act5('legacy', 3, 'half', 'lost'),
      act5('descent', 3, 'half', 'lost'),
      act5('legacy', 4, 'half', 'stall'),
      act5('descent', 4, 'half', 'won'),
    ];
    const md = quietReport(records);
    const title = 'Act V outcome under permadeath';
    // legacy: 1 win, 1 loss, 2 stalls; descent: 1 win, 2 losses, 1 stall (of 4).
    expect(deltaColumn(md, title, 'win').map((s) => s.split(' ')[0])).toEqual(['25%', '25%']);
    expect(deltaColumn(md, title, 'commander loss').map((s) => s.split(' ')[0])).toEqual([
      '25%',
      '50%',
    ]);
    expect(deltaColumn(md, title, 'stall').map((s) => s.split(' ')[0])).toEqual(['50%', '25%']);
    // Paired per run (descent − legacy): win −100,0,0,+100 -> 0; loss 0,+100,0,0 -> +25;
    // stall +100,−100,0,−100 -> −25.
    expect(deltaColumn(md, title, 'Δ win (pts)')[1].split(' ')[0]).toBe('0.0');
    expect(deltaColumn(md, title, 'Δ commander loss (pts)')[1].split(' ')[0]).toBe('25.0');
    expect(deltaColumn(md, title, 'Δ stall (pts)')[1].split(' ')[0]).toBe('-25.0');
    // The KO-free table counts both stalled legacy runs as not lost: 75%, not the 25% won.
    expect(deltaColumn(md, 'Act V KO-free rate', 'legacy')[0].split(' ')[0]).toBe('75%');
  });

  it('names the boss each final-act fight seats from the data', () => {
    // Failure: the legacy finale is labelled as one boss on every rung.
    const legacyFinale = { act: 'finalBoss', boss: true, descentKey: null };
    expect(bossFightOf(legacyFinale, 'hard', data)).toBe('The Entity');
    expect(bossFightOf(legacyFinale, 'normal', data)).toBe('The Lieutenant');
    expect(bossFightOf({ descentKey: 'gate', boss: true }, 'hard', data)).toBe(
      'The Lieutenant (gate)',
    );
    expect(bossFightOf({ descentKey: 'vigil', boss: false }, 'hard', data)).toBeNull();
  });
});

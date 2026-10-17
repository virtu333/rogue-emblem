import { describe, expect, it } from 'vitest';
import {
  ACTIVE_GAP_CAP_MS,
  closeRunLedger,
  createRunLedger,
  gradeRecordField,
  gradeRunOf,
  recordLedgerBattle,
  runPlayTimeOf,
  sanitizeRunLedger,
} from '../src/engine/RunLedger.js';
import { GRADE_BARS, gradeLetter, gradeRun, formatPlayTime } from '../src/engine/RunGrade.js';
import { runCreditsModel, runMvp } from '../src/ui/runCreditsModel.js';
import { mergeRunRecords } from '../src/engine/RunRecords.js';

const T0 = 1_000_000;
const win = (ledger, over = {}) =>
  recordLedgerBattle(ledger, {
    turnCount: 5,
    turnPar: 6,
    gold: 100,
    survivors: 4,
    fallen: 0,
    now: T0 + 60_000,
    ...over,
  });

describe('RunLedger', () => {
  it('counts par battles, losses, gold and the worst battle', () => {
    let l = createRunLedger(T0);
    l = win(l);
    l = win(l, { turnCount: 9, survivors: 3, fallen: 1, gold: 50 });
    l = win(l, { turnPar: null });
    expect(l).toMatchObject({
      parBattles: 2,
      underPar: 1,
      losses: 1,
      battleGold: 250,
      worstSurvival: 0.75,
    });
  });

  it('caps an idle gap so days away do not count as play time', () => {
    const l = recordLedgerBattle(createRunLedger(T0), {
      turnCount: 3,
      turnPar: 3,
      survivors: 2,
      now: T0 + 3 * 24 * 3600 * 1000,
    });
    expect(l.activeMs).toBe(ACTIVE_GAP_CAP_MS);
    expect(closeRunLedger(l, l.lastAt + 5 * 60000).activeMs).toBe(ACTIVE_GAP_CAP_MS + 5 * 60000);
  });

  it('a run without a ledger stays ungraded and null', () => {
    expect(recordLedgerBattle(null, {})).toBeNull();
    expect(sanitizeRunLedger({ v: 2 })).toBeNull();
    expect(gradeRunOf({ runLedger: null, status: 'victory' }, 'victory')).toBeNull();
    expect(runPlayTimeOf({ runLedger: null })).toBeNull();
  });

  it('survives a save round trip and clamps junk', () => {
    const l = win(createRunLedger(T0));
    expect(sanitizeRunLedger(JSON.parse(JSON.stringify(l)))).toEqual(l);
    const bad = sanitizeRunLedger({ ...l, underPar: 99, worstSurvival: 7, losses: -3 });
    expect(bad.underPar).toBe(bad.parBattles);
    expect(bad.worstSurvival).toBe(1);
    expect(bad.losses).toBe(0);
  });
});

describe('gradeRun', () => {
  const perfect = { ...createRunLedger(T0), parBattles: 10, underPar: 10, battleGold: 1000 };
  it('a flawless no-meta run is an S with the bars summing to the score', () => {
    const g = gradeRun({
      result: 'victory',
      ledger: perfect,
      gold: 0,
      noMetaMode: true,
      burdens: [],
    });
    expect(g.score).toBe(30 + 25 + 20 + 10 + 15);
    expect(g.letter).toBe('S');
    expect(g.bars.reduce((n, b) => n + b.points, 0)).toBe(g.score);
    expect(g.bars.map((b) => b.key)).toEqual(GRADE_BARS.map((b) => b.key));
  });

  it('each loss costs survival, and unspent gold costs economy', () => {
    const g = gradeRun({
      result: 'victory',
      ledger: { ...perfect, losses: 2 },
      gold: 500,
      noMetaMode: false,
      burdens: [{}],
    });
    const by = Object.fromEntries(g.bars.map((b) => [b.key, b.points]));
    expect(by).toMatchObject({ survival: 15, economy: 5, restraint: 3 });
  });

  it('only a won, ledgered run gets a letter', () => {
    expect(gradeRun({ result: 'defeat', ledger: perfect })).toBeNull();
    expect(gradeRun({ result: 'victory', ledger: null })).toBeNull();
  });

  it('letter cutoffs', () => {
    expect([100, 90, 89, 75, 74, 55, 54, 35, 34, 0].map(gradeLetter)).toEqual([
      'S',
      'S',
      'A',
      'A',
      'B',
      'B',
      'C',
      'C',
      'D',
      'D',
    ]);
  });

  it('the victory record carries only the letter and score', () => {
    const rm = { runLedger: perfect, gold: 0, noMetaMode: true, burdens: [] };
    expect(gradeRecordField(rm, 'victory')).toEqual({ grade: { letter: 'S', score: 100 } });
    expect(gradeRecordField(rm, 'defeat')).toEqual({});
  });
});

describe('credits model', () => {
  const unit = (name, kills) => ({ name, className: 'Fighter', deeds: { stats: { kills } } });
  it('MVP is the unit with the most kills, fallen included', () => {
    expect(runMvp([unit('A', 3)], [unit('B', 9)])).toMatchObject({ name: 'B', kills: 9 });
    expect(runMvp([unit('A', 0)], [])).toBeNull();
  });

  it('rows show only what the run knows and a defeat carries no grade', () => {
    const rm = {
      runLedger: { ...perfect(), parBattles: 4, underPar: 3 },
      totalTurns: 40,
      roster: [unit('A', 5)],
      fallenUnits: [unit('B', 2)],
      laidToRest: [],
      runSeed: 42,
      getActiveBlessingIds: () => ['x'],
    };
    const m = runCreditsModel(rm, {
      result: 'defeat',
      grade: { letter: 'S' },
      now: T0 + 90 * 60000,
      gameData: { blessings: { blessings: [{ id: 'x', name: 'Keen Eye' }] } },
    });
    expect(m.grade).toBeNull();
    const rows = Object.fromEntries(m.details.map((d) => [d.key, d.value]));
    expect(rows).toMatchObject({
      time: formatPlayTime(ACTIVE_GAP_CAP_MS),
      turns: '40',
      par: '3 of 4 battles',
      fallen: 'B',
      blessings: 'Keen Eye',
      seed: '42',
    });
    expect(rows.mvp).toContain('A');
    expect(
      runCreditsModel({ roster: [], fallenUnits: [] }, { result: 'victory' }).details.find(
        (d) => d.key === 'time',
      ),
    ).toBeUndefined();
  });

  function perfect() {
    return createRunLedger(T0);
  }
});

describe('run records keep the grade', () => {
  it('keeps a valid grade and drops a forged one', () => {
    const rec = (grade) => ({ id: 'r1', endedAt: 1, difficulty: 'normal', roster: [], grade });
    const [ok] = mergeRunRecords([rec({ letter: 'A', score: 80 })]);
    expect(ok.grade).toEqual({ letter: 'A', score: 80 });
    const [bad] = mergeRunRecords([rec({ letter: 'Z', score: 9 })]);
    expect(bad.grade).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
  ACTIVE_GAP_CAP_MS,
  closeRunLedger,
  createRunLedger,
  gradeRecordField,
  gradeRunOf,
  buildTerminalSummary,
  recordLedgerBattle,
  runPlayTimeOf,
  sanitizeRunLedger,
  settleLedger,
  tallyGold,
  withTerminalSummary,
} from '../src/engine/RunLedger.js';
import { GRADE_BARS, gradeLetter, gradeRun, formatPlayTime } from '../src/engine/RunGrade.js';
import { runCreditsModel, runMvp } from '../src/ui/runCreditsModel.js';
import { mergeRunRecords } from '../src/engine/RunRecords.js';

const T0 = 1_000_000;
const win = (ledger, over = {}) =>
  recordLedgerBattle(ledger, {
    turnCount: 5,
    turnPar: 6,
    survivors: 4,
    fallen: 0,
    now: T0 + 60_000,
    ...over,
  });

describe('RunLedger', () => {
  it('counts par battles, losses and the worst battle', () => {
    let l = createRunLedger(T0);
    l = win(l);
    l = win(l, { turnCount: 9, survivors: 3, fallen: 1 });
    l = win(l, { turnPar: null });
    expect(l).toMatchObject({
      parBattles: 2,
      underPar: 1,
      losses: 1,
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

describe('Resolve counts the force that fought, not the bench', () => {
  const crowd = (n) => Array.from({ length: n }, (_, i) => ({ name: `U${i}` }));
  it('4 deployed, 16 benched, 3 deaths is 1 of 4, not 17 of 20', () => {
    const rm = { runLedger: createRunLedger(T0) };
    const handed = crowd(17); // 1 deployed survivor + 16 benched units come back together
    const ledger = settleLedger(
      rm,
      { turnCount: 5, turnPar: 6, deployedSurvivors: 1 },
      handed,
      crowd(3),
    );
    expect(ledger.worstSurvival).toBe(0.25);
    expect(
      gradeRun({ result: 'victory', ledger, gold: 0 }).bars.find((b) => b.key === 'resolve').points,
    ).toBe(5);
  });

  it('a caller that does not say which units fought keeps counting every unit handed over', () => {
    const rm = { runLedger: createRunLedger(T0) };
    const ledger = settleLedger(rm, { turnCount: 5, turnPar: 6 }, crowd(3), crowd(1));
    expect(ledger.worstSurvival).toBe(0.75);
  });
});

describe('Economy is the share of received gold that is not left unspent', () => {
  it('counts the start and every inflow, not battle gold alone', () => {
    let l = createRunLedger(T0, 500);
    l = tallyGold(l, 1500); // battle gold, an event, a sale: all gold received
    l = tallyGold(l, -1000); // a purchase
    expect(l).toMatchObject({ goldStart: 500, goldIn: 1500, goldOut: 1000 });
    const by = (gold) =>
      Object.fromEntries(
        gradeRun({ result: 'victory', ledger: l, gold }).bars.map((b) => [b.key, b.points]),
      );
    expect(by(0).economy).toBe(15);
    expect(by(1000).economy).toBe(8); // 15 x half, rounded: half of the 2,000 received is still in the purse
  });

  it('event income that nobody spends lowers Economy, income that is spent does not', () => {
    const base = tallyGold(createRunLedger(T0, 0), 1000);
    const economy = (ledger, gold) =>
      gradeRun({ result: 'victory', ledger, gold }).bars.find((b) => b.key === 'economy').points;
    const held = tallyGold(base, 1000); // a 1,000 event windfall left in the purse
    const spent = tallyGold(tallyGold(base, 1000), -1000);
    // Battle gold alone (1,000) would have scored this purse of 1,000 as 0; of 2,000 received it is half.
    expect(economy(held, 1000)).toBe(8);
    expect(economy(spent, 0)).toBe(15);
  });

  it('a null ledger stays null', () => {
    expect(tallyGold(null, 100)).toBeNull();
  });
});

describe('terminal summary (a lost run)', () => {
  const unit = (name, extra = {}) => ({
    name,
    unitUid: `u_${name}`,
    className: 'Fighter',
    level: 5,
    currentHP: 10,
    deeds: { stats: { kills: 2 } },
    ...extra,
  });
  it('takes the final army, who fell in the last battle, and what they did there', () => {
    const edric = unit('Edric');
    const gaspar = unit('Gaspar');
    const liveGaspar = { ...gaspar, _battleDeeds: { kills: 4 } };
    const summary = buildTerminalSummary({
      roster: [edric, gaspar],
      survivors: [liveGaspar],
      benched: [],
      fallenBattleRecords: [{ name: 'Edric', unitUid: 'u_Edric', battleDeeds: { kills: 1 } }],
      turnCount: 7,
    });
    expect(summary).toEqual({
      turns: 7,
      survivors: [{ name: 'Gaspar', className: 'Fighter', level: 5, kills: 6 }],
      fallen: [{ name: 'Edric', className: 'Fighter', level: 5, kills: 3 }],
    });
  });

  it('the benched stand with the army and never count as fallen', () => {
    const summary = buildTerminalSummary({
      roster: [unit('A'), unit('B')],
      survivors: [],
      benched: [unit('B')],
      turnCount: 3,
    });
    expect(summary.survivors.map((u) => u.name)).toEqual(['B']);
    expect(summary.fallen.map((u) => u.name)).toEqual(['A']);
  });

  it('survives sanitizing and is dropped from a win', () => {
    const terminal = { turns: 2, survivors: [{ name: 'A', kills: 1 }], fallen: [] };
    const ledger = withTerminalSummary(createRunLedger(T0), terminal);
    expect(sanitizeRunLedger(ledger).terminal.survivors[0]).toMatchObject({ name: 'A', kills: 1 });
    expect(withTerminalSummary(null, terminal)).toBeNull();
    expect(sanitizeRunLedger({ ...ledger, terminal: 'junk' }).terminal).toBeNull();
  });
});

describe('gradeRun', () => {
  const perfect = { ...createRunLedger(T0), parBattles: 10, underPar: 10, goldIn: 1000 };
  it('a flawless run is an S with the bars summing to the score, upgrades and burdens or not', () => {
    // No Meta is an achievement, not a bar: a run with Home Base upgrades and two burdens still
    // reaches 100.
    const g = gradeRun({
      result: 'victory',
      ledger: perfect,
      gold: 0,
      noMetaMode: false,
      burdens: [{}, {}],
    });
    expect(g.score).toBe(35 + 30 + 20 + 15);
    expect(g.bars.map((b) => b.max)).toEqual([35, 30, 20, 15]);
    expect(g.letter).toBe('S');
    expect(g.bars.reduce((n, b) => n + b.points, 0)).toBe(g.score);
    expect(g.bars.map((b) => b.key)).toEqual(GRADE_BARS.map((b) => b.key));
  });

  it('each loss costs survival, and unspent gold costs economy', () => {
    const g = gradeRun({
      result: 'victory',
      ledger: { ...perfect, losses: 2 },
      gold: 500,
    });
    const by = Object.fromEntries(g.bars.map((b) => [b.key, b.points]));
    expect(by).toEqual({ pace: 35, survival: 20, resolve: 20, economy: 8 });
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
    const rm = { runLedger: perfect, gold: 0, noMetaMode: false, burdens: [{}] };
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

  it('a laid-to-rest hero still takes the Most kills line', () => {
    const rm = {
      runLedger: perfect(),
      roster: [unit('Living', 3)],
      fallenUnits: [],
      laidToRest: [unit('Hero', 50)],
    };
    const rows = Object.fromEntries(
      runCreditsModel(rm, { result: 'victory' }).details.map((d) => [d.key, d.value]),
    );
    expect(rows.mvp).toContain('Hero');
    expect(rows.fallen).toContain('Hero');
  });

  it('a defeat reads the final board, not the army from before the last battle', () => {
    const terminal = {
      turns: 4,
      survivors: [{ name: 'Gaspar', className: 'Fighter', level: 5, kills: 2 }],
      fallen: [{ name: 'Edric', className: 'Lord', level: 5, kills: 6 }],
    };
    const rm = {
      runLedger: withTerminalSummary(perfect(), terminal),
      totalTurns: 0,
      roster: [unit('Edric', 0), unit('Gaspar', 0)], // the roster as the last battle began
      fallenUnits: [],
      laidToRest: [],
    };
    const rows = Object.fromEntries(
      runCreditsModel(rm, { result: 'defeat' }).details.map((d) => [d.key, d.value]),
    );
    expect(rows).toMatchObject({ turns: '4', army: '1', fallen: 'Edric' });
    expect(rows.mvp).toContain('Edric');
    expect(rows.mvp).toContain('6');
  });

  it('a defeat on a run without a ledger keeps the old reading', () => {
    const rm = { runLedger: null, totalTurns: 12, roster: [unit('A', 1)], fallenUnits: [] };
    const rows = Object.fromEntries(
      runCreditsModel(rm, { result: 'defeat' }).details.map((d) => [d.key, d.value]),
    );
    expect(rows).toMatchObject({ turns: '12', army: '1' });
  });
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

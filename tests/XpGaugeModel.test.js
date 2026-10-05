// What the battle's EXP gauge plays (src/ui/xpGaugeModel.js, docs/specs/exp-bars.md §2).
// Failure modes each block catches:
//   - a record built from the live unit (a later change rewrites what plays), or a
//     record queued at the level cap (a gauge or "+N" where nothing was gained);
//   - Fast, Instant or Reduce motion ignored (the table of §2.3);
//   - the fill drifting from the bar (wrong span, wrong level after a wrap, no beat);
//   - the end state wrong at the edges (exactly 100, the cap, two wraps);
//   - the gauge covering the rail or leaving the frame;
//   - gauges and cards out of order under a Mentor's Band (A, A's cards, B, B's cards).
// Every expected number is worked out by hand beside it.
import { describe, expect, it } from 'vitest';
import {
  XP_GAUGE_TIMING,
  progressSteps,
  xpGaugeFinal,
  xpGaugeFrame,
  xpGaugePlacement,
  xpGaugePlan,
  xpGaugeRecord,
  xpGaugeTiming,
  xpGaugeWraps,
} from '../src/ui/xpGaugeModel.js';
import { applyXpGain } from '../src/engine/BattleXp.js';
import { createRecruitUnit } from '../src/engine/UnitManager.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const fighter = data.classes.find((c) => c.name === 'Fighter');

function unitAt(level, xp, extra = {}) {
  const unit = createRecruitUnit({ name: 'Ilse', level }, fighter, data.weapons);
  unit.level = level;
  unit.xp = xp;
  unit.battleEntityId = 'u4';
  return Object.assign(unit, extra);
}

/** A real gain (applyXpGain) as the scene records it. */
function gain(level, xp, amount, extra = {}) {
  const unit = unitAt(level, xp, extra);
  const { before, after, result } = applyXpGain(unit, amount, { classes: data.classes });
  return { unit, record: xpGaugeRecord(unit, { before, after, levelUps: result.levelUps }) };
}

const normal = xpGaugeTiming({ speed: 'normal' });

describe('the gain record', () => {
  it('is plain values: a later change to the unit never changes what plays', () => {
    const { unit, record } = gain(7, 72, 12);
    expect(record).toEqual({
      unitId: 'u4',
      unitName: 'Ilse',
      before: { level: 7, extendedLevels: 0, xp: 72, capped: false },
      after: { level: 7, extendedLevels: 0, xp: 84, capped: false },
      gained: 12,
      segments: [{ from: 72, to: 84, level: 7, extendedLevels: 0, label: '7' }],
    });
    const copy = structuredClone(record);
    unit.xp = 0;
    unit.level = 1;
    unit.name = 'Renamed';
    expect(record).toEqual(copy);
  });

  it('is null at the level cap: no gauge, no "+N"', () => {
    // A base unit at 20 gains nothing (gainExperience's cap).
    expect(gain(20, 0, 40).record).toBeNull();
  });

  it('counts only the XP up to the wrap into the cap', () => {
    // Lv 19, 90 XP, +30: 10 reach Lv 20 (the cap); the 20 left over earn nothing.
    const { record } = gain(19, 90, 30);
    expect(record.gained).toBe(10);
    expect(record.segments).toEqual([
      { from: 90, to: 100, level: 19, extendedLevels: 0, label: '19', wraps: true, capped: true },
    ]);
    expect(xpGaugeWraps(record)).toBe(1);
  });
});

describe('timing (§2.3)', () => {
  it('Normal: 100 XP per 900 ms, a 300 ms wrap beat, a 350 ms hold', () => {
    expect(normal).toEqual({ animate: true, msPerXp: 9, wrapBeat: 300, easeTail: 150, hold: 350 });
  });
  it('Fast (and hold-to-fast-forward): every wait halved', () => {
    expect(xpGaugeTiming({ speed: 'fast' })).toEqual({
      animate: true,
      msPerXp: 4.5,
      wrapBeat: 150,
      easeTail: 75,
      hold: 175,
    });
  });
  it('Instant: no fill, the final state held 400 ms (even with Reduce motion)', () => {
    const instant = { animate: false, msPerXp: 0, wrapBeat: 0, easeTail: 0, hold: 400 };
    expect(xpGaugeTiming({ speed: 'instant' })).toEqual(instant);
    expect(xpGaugeTiming({ speed: 'instant', reducedMotion: true })).toEqual(instant);
  });
  it('Reduce motion: no fill or flash, the final state held 600 ms (300 at Fast)', () => {
    expect(xpGaugeTiming({ reducedMotion: true })).toMatchObject({ animate: false, hold: 600 });
    expect(xpGaugeTiming({ speed: 'fast', reducedMotion: true }).hold).toBe(300);
    expect(XP_GAUGE_TIMING.staticHold).toBe(600);
  });
});

describe('the fill', () => {
  it('a +12 gain: 108 ms at a constant rate, the last 36 ms slowing to a stop', () => {
    const { record } = gain(7, 72, 12);
    const plan = xpGaugePlan(record, normal);
    // 12 XP × 9 ms; the tail is min(150, 108 / 3) = 36 ms.
    expect(plan).toMatchObject({ fillMs: 108, holdMs: 350 });
    expect(plan.phases).toEqual([
      { kind: 'fill', index: 0, start: 0, ms: 108, from: 72, to: 84, easeTail: 36 },
    ]);
    // v = 12 / (108 − 18) = 2/15 XP per ms.
    expect(xpGaugeFrame(record, plan, 0)).toMatchObject({ held: 72, value: 72, done: false });
    // 36 ms × 2/15 = 4.8 → 76.
    expect(xpGaugeFrame(record, plan, 36).value).toBe(76);
    // 72 ms steady (9.6) + 18 ms of tail: 2.4 − (2/15)(18²)/72 = 1.8 → 11.4 → 83.
    expect(xpGaugeFrame(record, plan, 90).value).toBe(83);
    expect(xpGaugeFrame(record, plan, 108)).toMatchObject({ value: 84, held: 72, done: true });
  });

  it('a wrap: fills to 100, beats with LV↑ and the flash, empties, fills the rest', () => {
    // Lv 7, 72 XP, +43 → Lv 8, 15 XP.
    const { record } = gain(7, 72, 43);
    expect(record.gained).toBe(43);
    const plan = xpGaugePlan(record, normal);
    // 28 XP (252 ms), the beat (300 ms), then 15 XP (135 ms): 687 ms.
    expect(plan.fillMs).toBe(687);
    expect(plan.phases.map((p) => [p.kind, p.start, p.ms])).toEqual([
      ['fill', 0, 252],
      ['beat', 252, 300],
      ['fill', 552, 135],
    ]);
    // 100 ms into the first span: 72 + 28 × 100/252 = 83.1 → 83 (a constant rate).
    expect(xpGaugeFrame(record, plan, 100)).toMatchObject({ value: 83, label: '7', held: 72 });
    expect(xpGaugeFrame(record, plan, 300)).toMatchObject({
      value: 100,
      flash: true,
      lvUp: true,
      label: '7',
    });
    // After the beat the bar is empty at the new level: nothing held, nothing gained yet.
    expect(xpGaugeFrame(record, plan, 552)).toMatchObject({
      value: 0,
      held: 0,
      label: '8',
      flash: false,
      lvUp: false,
    });
    expect(xpGaugeFrame(record, plan, 687)).toEqual({
      index: 1,
      label: '8',
      held: 0,
      gainFrom: 0,
      value: 15,
      flash: false,
      lvUp: true,
      max: false,
      done: true,
    });
  });

  it('two wraps from one gain wrap twice', () => {
    // Lv 7, 90 XP, +120 → Lv 9, 10 XP.
    const { record } = gain(7, 90, 120);
    expect(record.segments.map((s) => [s.from, s.to, s.label, Boolean(s.wraps)])).toEqual([
      [90, 100, '7', true],
      [0, 100, '8', true],
      [0, 10, '9', false],
    ]);
    const plan = xpGaugePlan(record, normal);
    // 10 XP + beat + 100 XP + beat + 10 XP: 90 + 300 + 900 + 300 + 90.
    expect(plan.fillMs).toBe(1680);
    expect(plan.phases.filter((p) => p.kind === 'beat')).toHaveLength(2);
    expect(xpGaugeFinal(record)).toMatchObject({ value: 10, label: '9', lvUp: true });
  });
});

describe('the end state', () => {
  it('ending exactly at 100: the new level’s empty bar, LV↑', () => {
    // Lv 7, 72 XP, +28 → Lv 8, 0 XP.
    const { record } = gain(7, 72, 28);
    expect(xpGaugeFinal(record)).toMatchObject({ value: 0, held: 0, label: '8', lvUp: true });
  });
  it('reaching the cap: the full bar reads MAX after the LV↑ beat', () => {
    const { record } = gain(19, 90, 30);
    const plan = xpGaugePlan(record, normal);
    expect(xpGaugeFrame(record, plan, 95)).toMatchObject({ lvUp: true, max: true, value: 100 });
    expect(xpGaugeFinal(record)).toMatchObject({ value: 100, max: true, lvUp: true, done: true });
  });
  it('extended leveling past 20: the level reads 20+N', () => {
    const unit = unitAt(20, 95, { tier: 'promoted', className: 'Warrior' });
    const { before, after, result } = applyXpGain(unit, 10, {
      classes: data.classes,
      extendedLevelingEnabled: true,
    });
    const record = xpGaugeRecord(unit, { before, after, levelUps: result.levelUps });
    expect(record.segments.map((s) => s.label)).toEqual(['20', '20+1']);
    expect(xpGaugeFinal(record)).toMatchObject({ value: 5, label: '20+1', lvUp: true });
  });
});

describe('placement beside the gaining unit', () => {
  const frame = { height: 390 };
  it('just below its tile', () => {
    expect(xpGaugePlacement(frame, { top: 100, bottom: 132 }, 52)).toEqual({
      top: 138,
      side: 'below',
    });
  });
  it('just above when below would leave the frame (and cover the rail beyond it)', () => {
    // Below: 366 + 52 > 390 − 8. Above: 328 − 6 − 52 = 270.
    expect(xpGaugePlacement(frame, { top: 328, bottom: 360 }, 52)).toEqual({
      top: 270,
      side: 'above',
    });
  });
  it('clamped inside a frame too short for either side; centred with no tile', () => {
    // Below wants 68; the frame's last place for 52 px is 100 − 8 − 52 = 40.
    expect(xpGaugePlacement({ height: 100 }, { top: 30, bottom: 62 }, 52)).toEqual({
      top: 40,
      side: 'below',
    });
    expect(xpGaugePlacement(frame, null, 52)).toEqual({ top: 169, side: 'centre' });
  });
});

describe('presentation order', () => {
  const card = (unitId, unitName, level) => ({ unitId, unitName, levelUp: { newLevel: level } });
  const gauge = (unitId, unitName, wraps) => ({
    unitId,
    unitName,
    segments: [
      ...Array.from({ length: wraps }, () => ({ from: 0, to: 100, wraps: true })),
      { from: 0, to: 5 },
    ],
  });

  it("Mentor's Band: gauge A, A's cards, gauge B, B's cards", () => {
    const a = gauge('u1', 'Holder', 2);
    const b = gauge('u2', 'Trainee', 1);
    const cards = [card('u1', 'Holder', 8), card('u1', 'Holder', 9), card('u2', 'Trainee', 4)];
    expect(progressSteps([a, b], cards)).toEqual([
      { gauge: a, cards: [cards[0], cards[1]] },
      { gauge: b, cards: [cards[2]] },
    ]);
  });

  it('a gauge without a wrap claims no card; a card without a gauge keeps its turn', () => {
    const a = gauge('u1', 'Holder', 0);
    const stray = card('u9', 'Stray', 3);
    expect(progressSteps([a], [stray])).toEqual([
      { gauge: a, cards: [] },
      { gauge: null, cards: [stray] },
    ]);
    // Cards alone (no gauge recorded): presented as before, in order.
    const two = [card('u1', 'Holder', 8), card('u2', 'Trainee', 4)];
    expect(progressSteps([], two)).toEqual([
      { gauge: null, cards: [two[0]] },
      { gauge: null, cards: [two[1]] },
    ]);
  });

  it('legacy name-only records match by name', () => {
    const a = { unitName: 'Edric', segments: [{ from: 90, to: 100, wraps: true }] };
    const c = { unitName: 'Edric', levelUp: {} };
    expect(progressSteps([a], [c])).toEqual([{ gauge: a, cards: [c] }]);
  });
});

// xpGaugeModel — what the battle's EXP gauge plays, as plain values
// (docs/specs/exp-bars.md §2). Pure: no DOM, no Phaser, no RNG, never a unit.
// XpGaugeController draws only what these return.
//
//   xpGaugeRecord   the gain record queued on scene._pendingXpGauges (plain values)
//   xpGaugeTiming   fill rate, wrap beat and hold for the battle speed and motion
//   xpGaugePlan     the record as a timeline of phases (fill, wrap beat)
//   xpGaugeFrame    what the gauge shows `elapsed` ms into a plan
//   xpGaugeFinal    the end state (a skip, Instant, Reduce motion)
//   xpGaugePlacement  above or below the gaining unit's tile, inside the frame
//   progressSteps   the queued gauges and level-up cards in presentation order

import { XP_PER_LEVEL } from '../utils/constants.js';
import { speedDuration } from '../utils/combatTiming.js';
import { xpGainSegments, xpGained } from '../engine/XpProgress.js';
import { getDisplayLevel } from '../engine/UnitManager.js';

/** Normal-speed milestones (ms): the fill rate per 100 XP, the wrap beat, the holds. */
export const XP_GAUGE_TIMING = Object.freeze({
  fillPer100: 900,
  wrapBeat: 300,
  hold: 350,
  // The fill's last stretch slows to a stop over at most this long.
  easeTail: 150,
  // Instant: the final state, still long enough to read the number.
  instantHold: 400,
  // Reduce motion: the final state with the gained span marked.
  staticHold: 600,
});

const copy = (snapshot) => ({
  level: snapshot.level,
  extendedLevels: snapshot.extendedLevels,
  xp: snapshot.xp,
  capped: snapshot.capped,
});

/**
 * The gain record for one applied gain (applyXpGain's before/after/levelUps), or null
 * when nothing was gained (the level cap). Plain values only, so a later death or
 * promotion of the unit never changes what the gauge plays.
 * @returns {{ unitId?: string, unitName: string, before: object, after: object,
 *   gained: number, segments: object[] } | null}
 */
export function xpGaugeRecord(unit, { before, after, levelUps = [] } = {}) {
  if (!before || !after) return null;
  const segments = xpGainSegments(before, after, levelUps);
  const gained = xpGained(segments);
  if (!(gained > 0)) return null;
  return {
    ...(unit?.battleEntityId ? { unitId: unit.battleEntityId } : {}),
    unitName: unit?.name ?? null,
    before: copy(before),
    after: copy(after),
    gained,
    segments: segments.map((s) => ({ ...s })),
  };
}

/** Level-ups a record wraps through (one level-up card each). */
export function xpGaugeWraps(record) {
  return (record?.segments || []).filter((s) => s.wraps).length;
}

/**
 * Timing for one gauge. `speed` is the battle speed ('normal' | 'fast' | 'instant';
 * hold-to-fast-forward counts as fast). Fast halves every wait (the COMBAT_WAITS
 * labels xp_gauge_fill / xp_gauge_hold); Instant and Reduce motion show the final
 * state at once and hold it (400 ms; 600 ms, halved at Fast).
 * @returns {{ animate: boolean, msPerXp: number, wrapBeat: number, easeTail: number,
 *   hold: number }}
 */
export function xpGaugeTiming({ speed = 'normal', reducedMotion = false } = {}) {
  const t = XP_GAUGE_TIMING;
  if (speed === 'instant')
    return { animate: false, msPerXp: 0, wrapBeat: 0, easeTail: 0, hold: t.instantHold };
  const fill = (ms) => speedDuration(speed, 'xp_gauge_fill', ms);
  const hold = (ms) => speedDuration(speed, 'xp_gauge_hold', ms);
  if (reducedMotion)
    return { animate: false, msPerXp: 0, wrapBeat: 0, easeTail: 0, hold: hold(t.staticHold) };
  return {
    animate: true,
    msPerXp: fill(t.fillPer100) / XP_PER_LEVEL,
    wrapBeat: hold(t.wrapBeat),
    easeTail: fill(t.easeTail),
    hold: hold(t.hold),
  };
}

/**
 * The record as a timeline: one `fill` phase per segment and a `beat` after each wrap
 * (the bar full, the medallion reading LV↑). The last fill eases to a stop.
 * @returns {{ phases: object[], fillMs: number, holdMs: number }}
 */
export function xpGaugePlan(record, timing) {
  const segments = record?.segments || [];
  const phases = [];
  let at = 0;
  segments.forEach((segment, index) => {
    const span = Math.max(0, segment.to - segment.from);
    const ms = span * (timing?.msPerXp || 0);
    phases.push({ kind: 'fill', index, start: at, ms, from: segment.from, to: segment.to });
    at += ms;
    if (segment.wraps) {
      const beat = timing?.wrapBeat || 0;
      phases.push({ kind: 'beat', index, start: at, ms: beat });
      at += beat;
    }
  });
  const lastFill = [...phases].reverse().find((p) => p.kind === 'fill');
  if (lastFill) lastFill.easeTail = Math.min(timing?.easeTail || 0, lastFill.ms / 3);
  return { phases, fillMs: at, holdMs: timing?.hold || 0 };
}

/** XP filled `t` ms into a fill phase: constant rate, the tail slowing to a stop. */
function filledAt(phase, t) {
  const span = phase.to - phase.from;
  if (!(phase.ms > 0) || t >= phase.ms) return span;
  if (t <= 0) return 0;
  const tail = phase.easeTail || 0;
  if (!(tail > 0)) return (span * t) / phase.ms;
  // Velocity v until the tail, then falling linearly to 0: v (ms − tail/2) = span.
  const v = span / (phase.ms - tail / 2);
  const steady = phase.ms - tail;
  if (t <= steady) return v * t;
  const s = t - steady;
  return v * steady + v * s - (v * s * s) / (2 * tail);
}

function view(record, index, value, extra = {}) {
  const segments = record.segments;
  const segment = segments[index];
  const held = index === 0 ? segment.from : 0;
  return {
    index,
    label: segment.label,
    held,
    gainFrom: held,
    value,
    flash: false,
    lvUp: false,
    max: false,
    ...extra,
  };
}

/**
 * The end state: the last segment's bar (the held span only when the gain never
 * wrapped), the value the unit now holds, LV↑ when it wrapped, MAX at the cap.
 */
export function xpGaugeFinal(record) {
  const segments = record?.segments || [];
  if (!segments.length) return null;
  const last = segments[segments.length - 1];
  const wraps = xpGaugeWraps(record);
  const lvUp = wraps > 0;
  if (last.capped)
    return { ...view(record, segments.length - 1, XP_PER_LEVEL), lvUp, max: true, done: true };
  if (last.wraps) {
    // Ended exactly on a wrap: the new level's empty bar.
    return {
      index: segments.length - 1,
      label: record.after ? getDisplayLevel(record.after) : null,
      held: 0,
      gainFrom: 0,
      value: 0,
      flash: false,
      lvUp,
      max: false,
      wrappedEmpty: true,
      done: true,
    };
  }
  return { ...view(record, segments.length - 1, last.to), lvUp, done: true };
}

/** What the gauge shows `elapsed` ms into `plan` (the final state once the fill ends). */
export function xpGaugeFrame(record, plan, elapsed) {
  const phases = plan?.phases || [];
  if (!phases.length || elapsed >= plan.fillMs) return xpGaugeFinal(record);
  for (let i = 0; i < phases.length; i++) {
    const phase = phases[i];
    const end = phase.start + phase.ms;
    if (elapsed >= end && i < phases.length - 1) continue;
    const t = Math.max(0, elapsed - phase.start);
    if (phase.kind === 'beat') {
      const segment = record.segments[phase.index];
      return {
        ...view(record, phase.index, XP_PER_LEVEL),
        flash: true,
        lvUp: true,
        max: segment.capped === true,
        done: false,
      };
    }
    const value = Math.min(phase.to, Math.floor(phase.from + filledAt(phase, t) + 1e-9));
    return { ...view(record, phase.index, value), done: false };
  }
  return xpGaugeFinal(record);
}

/**
 * Where the gauge stands in its frame (CSS px from the frame's top): just below the
 * gaining unit's tile, or just above it when below would leave the frame (the rail
 * lies beyond the frame's edge); clamped inside the frame. No tile: centred.
 * @param {{ height: number }} frame
 * @param {{ top: number, bottom: number } | null} tile  the tile's edges, frame-relative
 * @returns {{ top: number, side: 'below' | 'above' | 'centre' }}
 */
export function xpGaugePlacement(frame, tile, height, { gap = 6, margin = 8 } = {}) {
  const frameH = Math.max(0, Number(frame?.height) || 0);
  const h = Math.max(0, Number(height) || 0);
  const lo = margin;
  const hi = Math.max(lo, frameH - margin - h);
  const clamp = (v) => Math.round(Math.min(hi, Math.max(lo, v)));
  if (!tile || !Number.isFinite(tile.top) || !Number.isFinite(tile.bottom))
    return { top: clamp((frameH - h) / 2), side: 'centre' };
  const below = tile.bottom + gap;
  if (below + h <= frameH - margin) return { top: clamp(below), side: 'below' };
  const above = tile.top - gap - h;
  if (above >= margin) return { top: clamp(above), side: 'above' };
  // Neither side has room (a very short frame): the side with more of it.
  const roomBelow = frameH - tile.bottom;
  return roomBelow >= tile.top
    ? { top: clamp(below), side: 'below' }
    : { top: clamp(above), side: 'above' };
}

const sameUnit = (a, b) =>
  a?.unitId && b?.unitId ? a.unitId === b.unitId : a?.unitName === b?.unitName;

/**
 * The queued gauges and level-up cards in presentation order: each gauge, then the
 * cards its gain wrapped into (the first ones queued for that unit). Cards no gauge
 * claims keep their order after them (queued without a gauge record).
 * @returns {{ gauge: object | null, cards: object[] }[]}
 */
export function progressSteps(gauges = [], cards = []) {
  const left = [...(cards || [])];
  const steps = [];
  for (const gauge of gauges || []) {
    const own = [];
    let want = xpGaugeWraps(gauge);
    for (let i = 0; i < left.length && want > 0; ) {
      if (sameUnit(left[i], gauge)) {
        own.push(left.splice(i, 1)[0]);
        want--;
      } else i++;
    }
    steps.push({ gauge, cards: own });
  }
  for (const card of left) steps.push({ gauge: null, cards: [card] });
  return steps;
}

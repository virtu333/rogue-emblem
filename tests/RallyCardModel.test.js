// The pure side of the Entity rally's cards: the timetable the music sets, what a card says, the edge
// of the map it docks to, and its distance from the board.
import { describe, expect, it } from 'vitest';
import {
  RALLY_EDGE_MARGIN,
  RALLY_MIN_STEP_MS,
  RALLY_SELECTED_WEIGHT,
  rallyCardEdge,
  rallyCardInsets,
  rallyCardModel,
  rallySchedule,
  rallyStepMs,
} from '../src/ui/rallyCardModel.js';

describe('rallySchedule', () => {
  it('puts the first card on the downbeat and one every two bars after it', () => {
    const plan = rallySchedule(4, { leadMs: 3000, barMs: 1765 });
    expect(plan.map((s) => s.atMs)).toEqual([3000, 6530, 10060, 13590]);
    expect(plan.map((s) => s.index)).toEqual([0, 1, 2, 3]);
  });

  it('holds each card until the next beat, and flags only the last', () => {
    const plan = rallySchedule(3, { leadMs: 0, barMs: 2000 });
    expect(plan.map((s) => s.holdMs)).toEqual([4000, 4000, 4000]);
    expect(plan.map((s) => s.last)).toEqual([false, false, true]);
    // a card's hold ends exactly where the next one begins
    expect(plan[0].atMs + plan[0].holdMs).toBe(plan[1].atMs);
  });

  it('never packs cards closer than a readable beat', () => {
    expect(rallyStepMs(100)).toBe(RALLY_MIN_STEP_MS);
    expect(rallySchedule(2, { barMs: 100 })[1].atMs).toBe(RALLY_MIN_STEP_MS);
  });

  it('falls back to the finale bar when none is given, and tolerates junk', () => {
    expect(rallyStepMs(undefined)).toBe(3530);
    expect(rallyStepMs('x')).toBe(3530);
    expect(rallySchedule(0)).toEqual([]);
    expect(rallySchedule(-3)).toEqual([]);
    expect(rallySchedule(1, { leadMs: -50 })[0].atMs).toBe(0);
    expect(rallySchedule(1, { leadMs: Number.NaN })[0].atMs).toBe(0);
  });
});

describe('rallyCardModel', () => {
  const entry = {
    unit: { name: 'Edric', className: 'Lord' },
    speaker: 'Edric',
    line: ' Everyone, with me. ',
  };

  it('names the speaker and class, trims the line and counts the cards', () => {
    expect(rallyCardModel(entry, { index: 1, total: 5 })).toEqual({
      name: 'Edric',
      className: 'Lord',
      line: 'Everyone, with me.',
      counter: '2 / 5',
      label: 'Edric, Lord: Everyone, with me.',
    });
  });

  it('shows no counter for a single card and survives a unit with no class', () => {
    const m = rallyCardModel({ unit: { name: 'Sera' }, speaker: 'Sera', line: 'A thread.' });
    expect(m.counter).toBe('');
    expect(m.className).toBe('');
    expect(m.label).toBe('Sera: A thread.');
  });
});

describe('rallyCardEdge', () => {
  const frame = { left: 0, top: 0, width: 400, height: 600 };
  const insets = { top: 10, bottom: 10 };
  const base = { frame, insets, cardHeight: 90 };

  it('docks at the bottom when nothing is in the way', () => {
    expect(rallyCardEdge({ ...base, ys: [300] })).toBe('bottom');
    expect(rallyCardEdge({})).toBe('bottom');
  });

  it('docks on the emptier edge, the bottom on a tie', () => {
    // army along the bottom, foes along the top: equal, so the bottom
    expect(rallyCardEdge({ ...base, ys: [50, 560] })).toBe('bottom');
    // two units under the bottom card, none under the top one
    expect(rallyCardEdge({ ...base, ys: [540, 570, 300] })).toBe('top');
    // a unit just above the bottom card's reach still counts as covered
    expect(rallyCardEdge({ ...base, ys: [600 - 10 - 90 - 10] })).toBe('top');
    expect(rallyCardEdge({ ...base, ys: [600 - 10 - 90 - 40] })).toBe('bottom');
  });

  it('weighs a selected unit (its menu opens beside it) as several units', () => {
    expect(RALLY_SELECTED_WEIGHT).toBeGreaterThan(1);
    // the selected unit in the bottom band, alone: the card goes to the top
    expect(rallyCardEdge({ ...base, ys: [540], selectedY: 540 })).toBe('top');
    // a selected unit in the top band keeps the card at the bottom
    expect(rallyCardEdge({ ...base, ys: [50], selectedY: 50 })).toBe('bottom');
  });

  it('keeps its edge until the other one is clearly emptier', () => {
    const ys = [60, 560, 570]; // top covers 1, bottom covers 2
    // one fewer is not enough to move off the bottom...
    expect(RALLY_EDGE_MARGIN).toBeGreaterThan(1);
    expect(rallyCardEdge({ ...base, ys, current: 'bottom' })).toBe('bottom');
    // ...and the same board does not pull a card off the top either
    expect(rallyCardEdge({ ...base, ys, current: 'top' })).toBe('top');
    // two fewer is: the bottom card leaves a crowd of three for an empty top
    expect(rallyCardEdge({ ...base, ys: [540, 560, 570], current: 'bottom' })).toBe('top');
    expect(rallyCardEdge({ ...base, ys: [40, 60, 70], current: 'top' })).toBe('bottom');
  });

  it('ignores a unit that is not on the map (NaN, off the frame)', () => {
    expect(rallyCardEdge({ ...base, ys: [Number.NaN, 5000, -5000] })).toBe('bottom');
  });
});

describe('rallyCardInsets', () => {
  const frame = { left: 0, top: 0, width: 640, height: 480 };

  it('sits on the board edge, not in the letterbox beside it', () => {
    // the 640x480 desktop: the board spans y 80..400 inside a 480 frame
    const map = { left: 96, top: 80, width: 448, height: 320 };
    expect(rallyCardInsets(frame, map, 8)).toEqual({ top: 88, bottom: 88 });
  });

  it('keeps to the visible part of a board that runs past the frame (a zoomed phone)', () => {
    const map = { left: 0, top: -400, width: 640, height: 1200 };
    expect(rallyCardInsets(frame, map, 8)).toEqual({ top: 8, bottom: 8 });
  });

  it('leaves the pad all round without a board, or with one outside the frame', () => {
    expect(rallyCardInsets(frame, null)).toEqual({ top: 8, bottom: 8 });
    expect(rallyCardInsets(null, null, 12)).toEqual({ top: 12, bottom: 12 });
    expect(rallyCardInsets(frame, { left: 0, top: 900, width: 10, height: 10 })).toEqual({
      top: 8,
      bottom: 8,
    });
  });
});

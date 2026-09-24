import { describe, it, expect } from 'vitest';
import {
  selectTitleVariant,
  readSlotMilestones,
  TITLE_VARIANTS,
} from '../src/art/keyart/titleVariant.js';
import { computeBackdropFrame, plateToView } from '../src/art/keyart/keyArtBackdrop.js';
import { PLATE_W, PLATE_H, HOLLOW_SUN_VARIANTS } from '../src/art/keyart/hollowSun.js';
import { buildTitleMenu, pickResumeSlot } from '../src/ui/titleMenuModel.js';

describe('title key art variant', () => {
  it('is dusk by default, rising after the first victory, ashfall once Hard is unlocked', () => {
    expect(selectTitleVariant([])).toBe('dusk');
    expect(selectTitleVariant(new Set(['reachedAct1']))).toBe('dusk');
    expect(selectTitleVariant(['beatAct1'])).toBe('rising');
    expect(selectTitleVariant(new Set(['reachedAct2']))).toBe('rising');
    expect(selectTitleVariant(['beatAct1', 'beatAct2', 'beatAct3', 'beatGame'])).toBe('ashfall');
    // Hard unlock wins even without the earlier milestones (e.g. a migrated slot).
    expect(selectTitleVariant((id) => id === 'beatGame')).toBe('ashfall');
    expect(selectTitleVariant(null)).toBe('dusk');
    expect(selectTitleVariant(undefined)).toBe('dusk');
  });

  it('only ever names variants the art module can draw', () => {
    for (const v of TITLE_VARIANTS) expect(HOLLOW_SUN_VARIANTS).toContain(v);
  });

  it('reads milestones from every save slot and ignores broken ones', () => {
    const store = new Map([
      ['emblem_rogue_slot_1_meta', JSON.stringify({ milestones: ['reachedAct1'] })],
      ['emblem_rogue_slot_2_meta', '{not json'],
      ['emblem_rogue_slot_3_meta', JSON.stringify({ milestones: ['beatAct1', 7, null] })],
    ]);
    const storage = { getItem: (k) => store.get(k) ?? null };
    expect([...readSlotMilestones(storage)].sort()).toEqual(['beatAct1', 'reachedAct1']);
    expect(selectTitleVariant(readSlotMilestones(storage))).toBe('rising');
    expect(readSlotMilestones({ getItem: () => null }).size).toBe(0);
    expect(
      readSlotMilestones({
        getItem: () => {
          throw new Error('denied');
        },
      }).size,
    ).toBe(0);
    expect(readSlotMilestones(undefined).size).toBe(0);
  });
});

describe('key art backdrop framing', () => {
  it('phone landscape shows the 2x plate crop at an exact integer device scale', () => {
    const f = computeBackdropFrame({ width: 844, height: 390, dpr: 3, maxCrop: 1.3 });
    expect(f).toMatchObject({ integer: true, scale: 6, cw: 422, ch: 195, sx: 1, sy: 20 });
    expect(f.cssW).toBe(844);
    expect(f.cssH).toBe(390);
  });

  it('small phones keep an integer scale by cropping a little more', () => {
    const f = computeBackdropFrame({ width: 667, height: 375, dpr: 2, maxCrop: 1.3 });
    expect(f.integer).toBe(true);
    expect(f.scale).toBe(4);
    expect(f.cw).toBe(334);
    expect(f.cssW).toBeGreaterThanOrEqual(667);
    expect(f.cssH).toBeGreaterThanOrEqual(375);
    // The composition's always-visible band (plate x 52..372) survives.
    expect(f.sx).toBeLessThanOrEqual(52);
    expect(f.sx + f.cw).toBeGreaterThanOrEqual(372);
    // With the desktop threshold the same box would fall back to an exact cover.
    const strict = computeBackdropFrame({ width: 667, height: 375, dpr: 2, maxCrop: 1.12 });
    expect(strict.integer).toBe(false);
    expect(strict.scale).toBeCloseTo(1334 / PLATE_W, 5);
  });

  it('the desktop 4:3 stage sees the full plate height (320x240 crop)', () => {
    for (const [w, h, dpr, k] of [
      [640, 480, 1, 2],
      [960, 720, 1, 3],
      [640, 480, 2, 4],
    ]) {
      const f = computeBackdropFrame({ width: w, height: h, dpr });
      expect(f).toMatchObject({ integer: true, scale: k, cw: 320, ch: 240, sx: 52, sy: 0 });
      expect(f.cssW).toBe(w);
    }
  });

  it('always covers the box and never samples outside the plate', () => {
    for (const w of [320, 375, 568, 640, 667, 740, 812, 844, 926, 1024, 1366, 2560])
      for (const h of [240, 320, 375, 390, 428, 480, 667, 768, 1024, 1440])
        for (const dpr of [1, 1.5, 2, 2.625, 3])
          for (const maxCrop of [1.12, 1.3]) {
            const f = computeBackdropFrame({ width: w, height: h, dpr, maxCrop });
            expect(f.cw * f.scale).toBeGreaterThanOrEqual(Math.round(w * dpr) - 1e-6);
            expect(f.ch * f.scale).toBeGreaterThanOrEqual(Math.round(h * dpr) - 1e-6);
            expect(f.sx).toBeGreaterThanOrEqual(0);
            expect(f.sy).toBeGreaterThanOrEqual(0);
            expect(f.sx + f.cw).toBeLessThanOrEqual(PLATE_W);
            expect(f.sy + f.ch).toBeLessThanOrEqual(PLATE_H);
            if (f.integer) expect(Number.isInteger(f.scale)).toBe(true);
          }
  });

  it('degenerate boxes still yield a drawable frame', () => {
    const f = computeBackdropFrame({ width: 0, height: 0, dpr: 0 });
    expect(f.cw).toBeGreaterThanOrEqual(1);
    expect(f.ch).toBeGreaterThanOrEqual(1);
    expect(Number.isFinite(f.scale)).toBe(true);
  });

  it('maps plate anchors into the view for DOM layout', () => {
    const f = computeBackdropFrame({ width: 844, height: 390, dpr: 2, maxCrop: 1.3 });
    expect(plateToView(f, 292, 68, 2)).toEqual({ x: (292 - f.sx) * 2, y: (68 - f.sy) * 2 });
  });

  it('portrait anchors can bring the Hollow Sun into a narrow crop', () => {
    const f = computeBackdropFrame({ width: 375, height: 667, dpr: 1, anchorX: 0.72 });
    expect(f.sx).toBeLessThanOrEqual(292);
    expect(f.sx + f.cw).toBeGreaterThanOrEqual(292);
  });
});

describe('title menu model', () => {
  const ids = (items) => items.map((i) => i.id);

  it('fresh profile: tutorial is promoted with "Start here" and How to Play is new', () => {
    const items = buildTitleMenu({ hasSlots: false, tutorialDone: false });
    expect(ids(items)).toEqual([
      'tutorial',
      'newGame',
      'howToPlay',
      'compendium',
      'moreInfo',
      'records',
    ]);
    expect(items[0]).toMatchObject({ label: 'Tutorial', sub: 'Start here', primary: true });
    expect(items[0].badge).toBeUndefined();
    expect(items.find((i) => i.id === 'newGame').label).toBe('New Game');
    expect(items.find((i) => i.id === 'howToPlay').badge).toBe('New');
  });

  it('tutorial done but no slots: the first run starts from "Start First Run"', () => {
    const items = buildTitleMenu({ hasSlots: false, tutorialDone: true, seenHowToPlay: true });
    expect(ids(items)).toEqual([
      'newGame',
      'tutorial',
      'howToPlay',
      'compendium',
      'moreInfo',
      'records',
    ]);
    expect(items[0]).toMatchObject({ label: 'Start First Run', primary: true });
    expect(items.some((i) => i.badge)).toBe(false);
  });

  it('returning player with one active run: Resume leads, Save Slots follows New Game', () => {
    const resumeSlot = pickResumeSlot([
      { slot: 1, hasActiveRun: true, actReached: 3 },
      { slot: 2, hasActiveRun: false },
      null,
    ]);
    const items = buildTitleMenu({ hasSlots: true, tutorialDone: false, resumeSlot });
    expect(ids(items)).toEqual([
      'resume',
      'newGame',
      'saveSlots',
      'tutorial',
      'howToPlay',
      'compendium',
      'moreInfo',
      'records',
    ]);
    expect(items[0]).toMatchObject({ label: 'Resume · Act 3', primary: true });
    expect(items.filter((i) => i.primary)).toHaveLength(1);
    expect(items.find((i) => i.id === 'tutorial')).toMatchObject({ badge: 'New' });
    expect(items.find((i) => i.id === 'tutorial').sub).toBeUndefined();
    // Gamepad contract: More Info second-to-last, Records last.
    expect(items.at(-2).id).toBe('moreInfo');
    expect(items.at(-1).id).toBe('records');
  });

  it('groups run actions and references for the two clusters', () => {
    const items = buildTitleMenu({ hasSlots: true, tutorialDone: true, seenHowToPlay: true });
    expect(items.filter((i) => i.group === 'run').map((i) => i.id)).toEqual([
      'newGame',
      'saveSlots',
      'tutorial',
    ]);
    expect(items.filter((i) => i.group === 'reference')).toHaveLength(4);
  });

  it('only a single uncorrupted active run earns the Resume shortcut', () => {
    expect(pickResumeSlot([])).toBeNull();
    expect(
      pickResumeSlot([
        { slot: 1, hasActiveRun: true },
        { slot: 2, hasActiveRun: true },
      ]),
    ).toBeNull();
    expect(pickResumeSlot([{ slot: 1, hasActiveRun: true, runCorrupt: true }])).toBeNull();
    expect(
      pickResumeSlot([
        { slot: 1, hasActiveRun: true, runCorrupt: true },
        { slot: 3, hasActiveRun: true },
      ]),
    ).toMatchObject({ slot: 3 });
  });
});

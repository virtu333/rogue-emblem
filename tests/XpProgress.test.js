// XpProgress: the spans an EXP bar fills for one gain (docs/specs/exp-bars.md §2.5).
// Every expected value is worked by hand from XP_PER_LEVEL = 100 and the level cap 20;
// none is computed by the code under test. The applyXpGain cases give the unit fixed
// growths (HP 100, the rest 0) so the gain itself is deterministic.
import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: { Scene: class {} } }));
import { isXpCapped, xpGainSegments, xpGained, xpSnapshot } from '../src/engine/XpProgress.js';
import { applyXpGain, combatXpAwards, scaledXp } from '../src/engine/BattleXp.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const growths = { HP: 100, STR: 0, MAG: 0, SKL: 0, SPD: 0, DEF: 0, RES: 0, LCK: 0 };
const unitAt = (level, xp, extra = {}) => ({
  name: 'Bar',
  className: 'Fighter',
  tier: 'base',
  faction: 'player',
  level,
  xp,
  growths: { ...growths },
  stats: { HP: 20, STR: 5, MAG: 0, SKL: 5, SPD: 5, DEF: 5, RES: 0, LCK: 0 },
  currentHP: 20,
  skills: [],
  col: 0,
  row: 0,
  ...extra,
});
const snap = (level, xp, { extendedLevels = 0, capped = false } = {}) => ({
  level,
  extendedLevels,
  xp,
  capped,
});
const seg = (from, to, level, label = String(level), extra = {}) => ({
  from,
  to,
  level,
  extendedLevels: extra.extendedLevels || 0,
  label,
  ...(extra.wraps ? { wraps: true } : {}),
  ...(extra.capped ? { capped: true } : {}),
});
const up = (newLevel) => ({ newLevel, gains: {} });
const extUp = (extendedLevel) => ({ isExtended: true, newLevel: 20, extendedLevel, gains: {} });

describe('xpSnapshot / isXpCapped', () => {
  it('reads level, bonus levels and XP as plain numbers', () => {
    expect(xpSnapshot(unitAt(7, 45))).toEqual({
      level: 7,
      extendedLevels: 0,
      xp: 45,
      capped: false,
    });
    expect(
      xpSnapshot(unitAt(20, 3, { tier: 'promoted', extendedLevels: 2 }), {
        extendedLevelingEnabled: true,
      }),
    ).toEqual({ level: 20, extendedLevels: 2, xp: 3, capped: false });
  });

  it('is capped at 20 unless extended leveling carries a promoted unit on', () => {
    expect(isXpCapped(unitAt(19, 99))).toBe(false);
    expect(isXpCapped(unitAt(20, 0))).toBe(true);
    expect(isXpCapped(unitAt(20, 0), { extendedLevelingEnabled: true })).toBe(true); // base
    expect(isXpCapped(unitAt(20, 0, { tier: 'promoted' }))).toBe(true);
    expect(isXpCapped(unitAt(20, 0, { tier: 'promoted' }), { extendedLevelingEnabled: true })).toBe(
      false,
    );
  });
});

describe('xpGainSegments', () => {
  it('a plain gain fills one span', () => {
    const s = xpGainSegments(snap(7, 45), snap(7, 57), []);
    expect(s).toEqual([seg(45, 57, 7)]);
    expect(xpGained(s)).toBe(12);
  });

  it('a gain ending exactly at 100 wraps once and fills nothing after', () => {
    const s = xpGainSegments(snap(5, 70), snap(6, 0), [up(6)]);
    expect(s).toEqual([seg(70, 100, 5, '5', { wraps: true })]);
    expect(xpGained(s)).toBe(30);
  });

  it('one wrap: the rest of the level, then the new level from 0', () => {
    // 72 + 43 = 115: 28 to the level, 15 into Lv 8.
    const s = xpGainSegments(snap(7, 72), snap(8, 15), [up(8)]);
    expect(s).toEqual([seg(72, 100, 7, '7', { wraps: true }), seg(0, 15, 8)]);
    expect(xpGained(s)).toBe(43);
  });

  it('two wraps: a whole level in the middle', () => {
    // 80 + 130 = 210: 20 to Lv 6, 100 to Lv 7, 10 into Lv 7.
    const s = xpGainSegments(snap(5, 80), snap(7, 10), [up(6), up(7)]);
    expect(s).toEqual([
      seg(80, 100, 5, '5', { wraps: true }),
      seg(0, 100, 6, '6', { wraps: true }),
      seg(0, 10, 7),
    ]);
    expect(xpGained(s)).toBe(130);
  });

  it('reaching the cap ends on the wrap into it; what is left at the cap is not filled', () => {
    // 90 + 30 at Lv 19: 10 reach Lv 20, the other 20 stay on the unit and never count.
    const s = xpGainSegments(snap(19, 90), snap(20, 20, { capped: true }), [up(20)]);
    expect(s).toEqual([seg(90, 100, 19, '19', { wraps: true, capped: true })]);
    expect(xpGained(s)).toBe(10);
    // The clamp: 90 + 320 = 410 → Lv 20 with 310 → 100 more spent → min(210, 99) = 99.
    const clamp = xpGainSegments(snap(19, 90), snap(20, 99, { capped: true }), [up(20)]);
    expect(clamp).toEqual([seg(90, 100, 19, '19', { wraps: true, capped: true })]);
    expect(xpGained(clamp)).toBe(10);
  });

  it('already capped: nothing gained, no segments', () => {
    expect(
      xpGainSegments(snap(20, 20, { capped: true }), snap(20, 20, { capped: true }), []),
    ).toEqual([]);
  });

  it('extended leveling past 20 labels each bonus level 20+N', () => {
    // Promoted Lv 19 at 60, +250: 40 to Lv 20, 100 to 20+1, 100 to 20+2, 10 into 20+2.
    const s = xpGainSegments(snap(19, 60), snap(20, 10, { extendedLevels: 2 }), [
      up(20),
      extUp(1),
      extUp(2),
    ]);
    expect(s).toEqual([
      seg(60, 100, 19, '19', { wraps: true }),
      seg(0, 100, 20, '20', { wraps: true }),
      seg(0, 100, 20, '20+1', { wraps: true, extendedLevels: 1 }),
      seg(0, 10, 20, '20+2', { extendedLevels: 2 }),
    ]);
    expect(xpGained(s)).toBe(250);
  });
});

describe('applyXpGain records the gain for the bars', () => {
  it('plain gain: before, after and gained', () => {
    const u = unitAt(7, 45);
    const { before, after, gained } = applyXpGain(u, 12, { classes: data.classes });
    expect(before).toEqual({ level: 7, extendedLevels: 0, xp: 45, capped: false });
    expect(after).toEqual({ level: 7, extendedLevels: 0, xp: 57, capped: false });
    expect(gained).toBe(12);
  });

  it('two wraps: gained is the whole award', () => {
    const u = unitAt(5, 80);
    const { before, after, gained } = applyXpGain(u, 130, { classes: data.classes });
    expect([before.level, before.xp, after.level, after.xp, gained]).toEqual([5, 80, 7, 10, 130]);
  });

  it('reaching the cap: gained stops at the wrap into it', () => {
    const u = unitAt(19, 90);
    const { after, gained } = applyXpGain(u, 30, { classes: data.classes });
    expect(after).toEqual({ level: 20, extendedLevels: 0, xp: 20, capped: true });
    expect(gained).toBe(10);
  });

  it('at the cap: gained 0, before equals after', () => {
    const u = unitAt(20, 20);
    const { before, after, gained } = applyXpGain(u, 50, { classes: data.classes });
    expect(gained).toBe(0);
    expect(after).toEqual(before);
    expect(before.capped).toBe(true);
  });

  it('extended leveling: a promoted unit at 20 gains in full and the snapshot counts 20+N', () => {
    const u = unitAt(20, 50, { tier: 'promoted', className: 'Warrior' });
    const out = applyXpGain(u, 170, { classes: data.classes, extendedLevelingEnabled: true });
    expect(out.after).toEqual({ level: 20, extendedLevels: 2, xp: 20, capped: false });
    expect(out.gained).toBe(170);
    expect(
      xpGainSegments(out.before, out.after, out.result.levelUps).map((s) => [
        s.label,
        s.from,
        s.to,
      ]),
    ).toEqual([
      ['20', 50, 100],
      ['20+1', 0, 100],
      ['20+2', 0, 20],
    ]);
  });

  it("a Mentor's Band share is the recipient's own gain, recorded on the recipient", () => {
    // Holder Lv 10 kills a Lv 5 foe. Ally Lv 3 beside it: its own formula is
    // 25 + (5 − 3) × 5 + 15 = 50, shared at 0.5 = 25; scaledXp(25) at 1× = 25.
    // The ally holds 90: 10 to Lv 4, 15 into it.
    const holder = unitAt(10, 0, {
      name: 'Holder',
      accessory: { name: "Mentor's Band", combatEffects: { xpShare: 0.5 } },
    });
    const ally = unitAt(3, 90, { name: 'Ally', col: 1 });
    const foe = { name: 'Foe', level: 5, tier: 'base', faction: 'enemy', currentHP: 0 };
    const awards = combatXpAwards({
      unit: holder,
      opponent: foe,
      opponentDied: true,
      allies: [holder, ally],
    });
    const share = awards.find((a) => a.unit === ally);
    expect(share).toMatchObject({ baseXp: 25, share: true });
    const out = applyXpGain(ally, scaledXp(share.baseXp), { classes: data.classes });
    expect(out.before).toEqual({ level: 3, extendedLevels: 0, xp: 90, capped: false });
    expect(out.after).toEqual({ level: 4, extendedLevels: 0, xp: 15, capped: false });
    expect(out.gained).toBe(25);
    expect(xpGainSegments(out.before, out.after, out.result.levelUps)).toEqual([
      seg(90, 100, 3, '3', { wraps: true }),
      seg(0, 15, 4),
    ]);
    // The holder's own record is untouched by the share.
    expect(holder.xp).toBe(0);
  });
});

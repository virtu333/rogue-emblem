// The one look of every floating combat number (ui/combatNumberStyle.js): each kind's text,
// colour and size, the crit's pop, the "No damage" spark, and reduced motion's still fade.
import { describe, expect, it } from 'vitest';
import {
  COMBAT_NUMBER_KINDS,
  MISS_TEXT,
  NO_DAMAGE_TEXT,
  REDUCED_FADE_MS,
  REDUCED_HOLD_MS,
  combatNumberStyle,
  resolveCombatNumberKind,
  sparkSegments,
} from '../src/ui/combatNumberStyle.js';
import { UI_PALETTE } from '../src/utils/uiStyles.js';

const look = (kind, value, reducedMotion = false) =>
  combatNumberStyle(kind, value, { reducedMotion });

describe('what each kind of number says and how it looks', () => {
  it('a strike is its damage in the plain text colour, 13px', () => {
    const n = look('strike', 7);
    expect([n.kind, n.text, n.color, n.fontSize]).toEqual(['strike', '7', UI_PALETTE.text, 13]);
    expect(n.style).toMatchObject({ fontSize: '13px', color: UI_PALETTE.text, fontStyle: 'bold' });
  });

  it('a crit keeps its "!", takes the accent colour and is larger than a strike, with a pop', () => {
    const crit = look('crit', 21);
    const strike = look('strike', 21);
    expect([crit.kind, crit.text, crit.color]).toEqual(['crit', '21!', UI_PALETTE.accentText]);
    expect(crit.fontSize).toBeGreaterThanOrEqual(17);
    expect(crit.fontSize).toBeLessThanOrEqual(18);
    expect(crit.fontSize).toBeGreaterThan(strike.fontSize);
    expect(crit.motion.mode).toBe('pop');
    expect(crit.motion.pop).toMatchObject({
      from: expect.any(Number),
      duration: expect.any(Number),
    });
    expect(crit.motion.pop.from).toBeLessThan(1);
    expect(crit.motion.pop.duration).toBeLessThanOrEqual(250);
  });

  it('a strike for 0 is "No damage": smaller, muted, with a spark', () => {
    const n = look('strike', 0);
    expect([n.kind, n.text, n.color]).toEqual(['noDamage', NO_DAMAGE_TEXT, UI_PALETTE.muted]);
    expect(n.text).toBe('No damage');
    expect(n.fontSize).toBeLessThan(look('strike', 5).fontSize);
    expect(n.spark).not.toBeNull();
    expect(n.spark.segments.length).toBeGreaterThanOrEqual(2);
  });

  it('a crit that dealt 0 reads as no damage too, never "0!"', () => {
    const n = look('crit', 0);
    expect([n.kind, n.text]).toEqual(['noDamage', 'No damage']);
    expect(n.motion.pop).toBeNull();
  });

  it('only a blow that did nothing has a spark', () => {
    for (const kind of COMBAT_NUMBER_KINDS.filter((k) => k !== 'noDamage')) {
      const n = look(kind, 4);
      expect(n.spark, kind).toBeNull();
    }
    expect(look('ballista', 0).spark).not.toBeNull();
    expect(look('deathburst', 0).kind).toBe('noDamage');
  });

  it('a heal is green and prefixed "+"', () => {
    const n = look('heal', 9);
    expect([n.text, n.color]).toEqual(['+9', UI_PALETTE.good]);
    expect(n.motion.mode).toBe('rise');
    expect(n.motion.rise).toBeGreaterThan(0);
    // A heal of 0 is not "No damage".
    expect(look('heal', 0).kind).toBe('heal');
  });

  it("a drain's give-back is the heal's green and prefix, a size smaller", () => {
    const n = look('drain', 3);
    expect([n.text, n.color]).toEqual(['+3', UI_PALETTE.good]);
    expect(n.fontSize).toBeLessThan(look('heal', 3).fontSize);
  });

  it('a poison tick is purple, a lava burn and an acid tick have their own colours', () => {
    const poison = look('poison', 4);
    const lava = look('lava', 5);
    const acid = look('acid', 2);
    expect([poison.text, lava.text, acid.text]).toEqual(['Poison -4', 'Lava -5', 'Acid -2']);
    expect(poison.color).toBe(UI_PALETTE.threatStatus);
    expect(lava.color).toBe(UI_PALETTE.terrainBurn);
    expect(acid.color).toBe(UI_PALETTE.terrainAcid);
    // Three hazards, three colours, none of them the strike's, the heal's or a crit's.
    const hazards = [poison.color, lava.color, acid.color];
    expect(new Set(hazards).size).toBe(3);
    for (const taken of [UI_PALETTE.text, UI_PALETTE.good, UI_PALETTE.accentText, UI_PALETTE.muted])
      expect(hazards).not.toContain(taken);
  });

  it('a miss is MISS in the muted colour', () => {
    const n = look('miss');
    expect([n.text, n.color]).toEqual([MISS_TEXT, UI_PALETTE.muted]);
    expect(n.text).toBe('MISS');
  });

  it('Thorns, the ballista, a Deathburst and the Entity splash keep their words and colours', () => {
    expect(look('thorns', 3)).toMatchObject({ text: '−3 Thorns', color: UI_PALETTE.bad });
    expect(look('ballista', 11)).toMatchObject({ text: '11', color: UI_PALETTE.warn });
    expect(look('deathburst', 6)).toMatchObject({ text: '6', color: UI_PALETTE.warn });
    expect(look('splash', 8)).toMatchObject({ text: 'Splash -8', color: UI_PALETTE.rarityEpic });
  });

  it('every number has an ink edge, a legible size and a depth over the units', () => {
    for (const kind of COMBAT_NUMBER_KINDS) {
      const n = look(kind, 5);
      expect(n.fontSize, kind).toBeGreaterThanOrEqual(10);
      expect(n.style.stroke, kind).toBe(UI_PALETTE.void);
      expect(n.style.strokeThickness, kind).toBeGreaterThanOrEqual(2);
      expect(n.depth, kind).toBeGreaterThanOrEqual(300);
      expect(n.color, kind).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('amounts are cleaned, kinds are resolved', () => {
  it('a damage that is missing, negative or not a number reads as 0 damage', () => {
    for (const bad of [undefined, null, NaN, -4, 'x', 0.2])
      expect(resolveCombatNumberKind('strike', bad), String(bad)).toBe('noDamage');
    expect(resolveCombatNumberKind('strike', 1)).toBe('strike');
    expect(look('strike', 6.6).text).toBe('7');
  });

  it('an unknown kind falls back to a plain strike', () => {
    expect(look('mystery', 3)).toMatchObject({ kind: 'strike', text: '3' });
  });

  it('the spark star is deterministic and made of short rays', () => {
    const rays = sparkSegments();
    expect(sparkSegments()).toEqual(rays);
    for (const [x1, y1, x2, y2] of rays) {
      const inner = Math.hypot(x1, y1);
      const outer = Math.hypot(x2, y2);
      expect(outer).toBeGreaterThan(inner);
      expect(outer).toBeLessThanOrEqual(10);
    }
  });
});

describe('motion profiles', () => {
  it('normal motion: strikes and heals rise while fading, nothing waits to start', () => {
    for (const kind of COMBAT_NUMBER_KINDS) {
      const { motion } = look(kind, 4);
      expect(motion.rise, kind).toBeGreaterThan(0);
      expect(motion.delay, kind).toBe(0);
      expect(motion.duration, kind).toBeGreaterThanOrEqual(450);
      expect(motion.mode, kind).toBe(kind === 'crit' ? 'pop' : 'rise');
    }
  });

  it('reduced motion: no rise and no pop for any kind, a short hold then a fade', () => {
    for (const kind of COMBAT_NUMBER_KINDS) {
      for (const value of [0, 5]) {
        const n = look(kind, value, true);
        expect(n.motion, `${kind} ${value}`).toEqual({
          mode: 'fade',
          rise: 0,
          duration: REDUCED_FADE_MS,
          delay: REDUCED_HOLD_MS,
          pop: null,
        });
      }
    }
    expect(REDUCED_HOLD_MS + REDUCED_FADE_MS).toBeLessThanOrEqual(700);
  });

  it('reduced motion keeps the number legible: same text, colour and size as normal', () => {
    for (const kind of COMBAT_NUMBER_KINDS) {
      const a = look(kind, 6);
      const b = look(kind, 6, true);
      expect([b.text, b.color, b.fontSize]).toEqual([a.text, a.color, a.fontSize]);
    }
  });

  it('the spark holds still under reduced motion (no growth), then fades with the number', () => {
    const normal = look('strike', 0).spark;
    const reduced = look('strike', 0, true).spark;
    expect(normal.grow).toBe(true);
    expect(normal.delay).toBe(0);
    expect(reduced.grow).toBe(false);
    expect([reduced.delay, reduced.duration]).toEqual([REDUCED_HOLD_MS, REDUCED_FADE_MS]);
  });
});

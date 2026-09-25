import { describe, it, expect } from 'vitest';
import {
  planStrike,
  planDeath,
  travelMs,
  arcHeight,
  facing,
  fxSeed,
  fxRandom,
  STRIKE_TIMING,
  WAIT_LABELS,
} from '../src/art/combatFx/strikePlan.js';
import { DEATH_STYLES } from '../src/art/combatFx/fxFamilies.js';
import { waitDuration } from '../src/utils/combatTiming.js';
import FX_TABLE from '../src/art/combatFx/fxAnims.json';

const ARROW = { kind: 'arc', slow: false };
const BOLT = { kind: 'bolt', slow: false };
const S = (speed, extra = {}) => ({ speed, reduced: false, quality: 'high', ...extra });
const ids = (plan) => plan.steps.map((s) => s.id);
const waits = (plan) => plan.steps.filter((s) => s.wait);

describe('strike choreography plan', () => {
  it('orders a melee hit: lunge, contact, hit-stop, react, hold, recover', () => {
    const plan = planStrike({ distance: 1 }, S('normal'));
    expect(ids(plan)).toEqual(['lunge', 'contact', 'hitStop', 'react', 'hold', 'recover']);
    expect(plan.steps.find((s) => s.id === 'hitStop').ms).toBe(STRIKE_TIMING.hitStop.normal);
    expect(plan.flags).toMatchObject({ motion: true, hitStop: true, dust: true, vignette: false });
  });

  it('holds hit-stop at 50-70 ms normally and 100-140 ms on crits', () => {
    const hs = (strike) => planStrike(strike, S('normal')).steps.find((s) => s.id === 'hitStop').ms;
    expect(hs({})).toBeGreaterThanOrEqual(50);
    expect(hs({})).toBeLessThanOrEqual(70);
    expect(hs({ crit: true })).toBeGreaterThanOrEqual(100);
    expect(hs({ crit: true })).toBeLessThanOrEqual(140);
    const crit = planStrike({ crit: true }, S('normal'));
    expect(crit.flags.vignette).toBe(true);
  });

  it('flies ranged strikes and settles the archer during the hold', () => {
    const plan = planStrike({ distance: 2, projectile: ARROW }, S('normal'));
    expect(ids(plan)).toEqual([
      'lunge',
      'travel',
      'contact',
      'hitStop',
      'react',
      'hold',
      'recover',
    ]);
    expect(plan.steps.find((s) => s.id === 'recover').wait).toBe(false);
    expect(plan.flags.projectile).toBe(true);
    expect(travelMs(3, 'arc')).toBeGreaterThan(travelMs(2, 'arc'));
    expect(travelMs(10, 'bolt')).toBeLessThan(travelMs(10, 'arc'));
    expect(arcHeight(3)).toBeGreaterThan(arcHeight(2));
  });

  it('keeps Normal within ~15% of the legacy strike (hit-stop included)', () => {
    const cases = [
      {},
      { crit: true },
      { miss: true },
      { followUp: true },
      { crit: true, followUp: true },
      { windUp: true },
      { windUp: true, crit: true },
      { distance: 2, projectile: ARROW },
      { distance: 3, projectile: ARROW },
      { distance: 2, projectile: ARROW, crit: true },
      { distance: 2, projectile: ARROW, miss: true },
      { distance: 10, projectile: BOLT },
      { distance: 2, projectile: { kind: 'line', slow: true } },
      { signature: true },
      { signature: true, windUp: true },
      { signature: true, windUp: true, crit: true },
      { signature: true, crit: true },
      { distance: 2, projectile: ARROW, signature: true, windUp: true },
      { distance: 5, projectile: BOLT, crit: true },
      { distance: 3, projectile: { kind: 'stream', slow: false } },
      { distance: 2, projectile: { kind: 'motes', slow: false } },
    ];
    for (const strike of cases) {
      const plan = planStrike(strike, S('normal'));
      expect(plan.totalMs / plan.legacyMs, JSON.stringify(strike)).toBeLessThanOrEqual(1.15);
    }
  });

  it('halves every wait at Fast and adds no waits at Instant', () => {
    for (const strike of [{}, { crit: true }, { miss: true }, { distance: 2, projectile: ARROW }]) {
      const normal = planStrike(strike, S('normal'));
      const fast = planStrike(strike, S('fast'));
      expect(fast.totalMs).toBeCloseTo(normal.totalMs / 2, 5);
      const instant = planStrike(strike, S('instant'));
      // Exactly the legacy waits (1 ms each); no travel, no hit-stop.
      expect(instant.totalMs).toBe(instant.legacyMs);
      expect(ids(instant)).not.toContain('travel');
      expect(ids(instant)).not.toContain('hitStop');
      expect(instant.flags).toMatchObject({ projectile: false, hitStop: false, motion: false });
    }
  });

  it('reduced motion: no displacement, static frames, only the legacy hold', () => {
    for (const strike of [{}, { crit: true }, { miss: true }, { distance: 2, projectile: ARROW }]) {
      const plan = planStrike(strike, S('normal', { reduced: true }));
      expect(plan.mode).toBe('reduced');
      expect(waits(plan).map((s) => s.id)).toEqual([strike.miss ? 'missHold' : 'hold']);
      expect(plan.totalMs).toBe(plan.legacyMs);
      expect(plan.flags).toMatchObject({
        motion: false,
        projectile: false,
        ghosts: false,
        dust: false,
        vignette: false,
        animatedOverlays: false,
      });
    }
  });

  it('low quality keeps the ranged draw but drops the flight (no travel wait)', () => {
    const plan = planStrike({ distance: 2, projectile: ARROW }, S('normal', { quality: 'low' }));
    expect(ids(plan)).not.toContain('travel');
    expect(plan.flags).toMatchObject({ ranged: true, projectile: false, lungePx: 3 });
    expect(plan.steps.find((s) => s.id === 'recover').wait).toBe(false);
    expect(plan.totalMs).toBeLessThan(
      planStrike({ distance: 2, projectile: ARROW }, S('normal')).totalMs,
    );
  });

  it('low quality keeps motion but drops overlays, motes and dust', () => {
    const plan = planStrike({ crit: true }, S('normal', { quality: 'low' }));
    expect(plan.flags).toMatchObject({ motion: true, overlays: false, motes: false, dust: false });
    expect(plan.flags.vignette).toBe(false);
  });

  it('labels every wait so the scene scales it like other combat waits', () => {
    const scene = { registry: { get: () => ({ getBattleSpeed: () => 'fast' }) } };
    for (const strike of [{}, { miss: true }, { distance: 2, projectile: ARROW }]) {
      for (const step of waits(planStrike(strike, S('normal')))) {
        expect(Object.values(WAIT_LABELS)).toContain(step.label);
        expect(waitDuration(scene, step.label, step.baseMs)).toBe(step.baseMs / 2);
      }
    }
  });

  it('turns directional art only in exact quarter turns or mirrors', () => {
    expect(facing(10, 0)).toEqual({ rotation: 0, flipX: false });
    expect(facing(-10, 0)).toEqual({ rotation: 0, flipX: true });
    expect(facing(0, 10).rotation).toBeCloseTo(Math.PI / 2);
    expect(facing(0, -10).rotation).toBeCloseTo(-Math.PI / 2);
    expect(facing(10, 10)).toEqual({ rotation: 0, flipX: false });
  });

  it('plans deaths within the particle budget at every setting', () => {
    for (const style of Object.values(DEATH_STYLES)) {
      const full = planDeath(style, S('normal'));
      expect(full.motes).toBeLessThanOrEqual(60);
      expect(planDeath(style, S('fast')).ms).toBe(full.ms / 2);
      expect(planDeath(style, S('instant'))).toMatchObject({ ms: 1, motes: 0 });
      expect(planDeath(style, S('normal', { reduced: true })).motes).toBe(0);
      expect(planDeath(style, S('normal', { quality: 'low' })).motes).toBe(0);
    }
  });

  it('seeds presentation from stable inputs, never Math.random', () => {
    const original = Math.random;
    let calls = 0;
    Math.random = () => {
      calls++;
      return 0.5;
    };
    try {
      expect(fxSeed('u1', 'u2', 3, 0)).toBe(fxSeed('u1', 'u2', 3, 0));
      expect(fxSeed('u1', 'u2', 3, 0)).not.toBe(fxSeed('u1', 'u2', 3, 1));
      const a = fxRandom(42);
      const b = fxRandom(42);
      for (let i = 0; i < 5; i++) expect(a()).toBe(b());
      planStrike({ crit: true, distance: 2, projectile: ARROW }, S('normal'));
    } finally {
      Math.random = original;
    }
    expect(calls).toBe(0);
  });

  it('impact animations fit their strike window at Normal', () => {
    for (const [key, anim] of Object.entries(FX_TABLE.anims)) {
      if (anim.role !== 'impact') continue;
      const after = anim.durations.slice(1).reduce((a, b) => a + b, 0);
      // Frames after the held impact frame finish within hold + recover (+ one
      // lingering frame, which completes on its own after the strike ends).
      expect(after, key).toBeLessThanOrEqual(
        STRIKE_TIMING.hold.normal + STRIKE_TIMING.recover.melee + 150,
      );
    }
  });
});

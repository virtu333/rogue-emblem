// The walk cycle's rules (src/ui/walkCycleModel.js, pure): the step cadence, the hop
// and glide heights, which moves are drawn as a walk, and the landing puff's ground.
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  WALK_STEP_MS,
  WALK_MIN_STEP_MS,
  WALK_GRACE_MS,
  WALK_STALE_MS,
  WALK_MAX_DT_MS,
  WALK_PROFILES,
  PUFF_STYLES,
  walkProfile,
  walkAllowed,
  stepCadenceMs,
  advanceWalkPhase,
  walkFrameName,
  stepLift,
  glideLift,
  isStriding,
  isStale,
  walkPose,
  puffAllowed,
  puffFamilyFor,
  puffMotes,
} from '../src/ui/walkCycleModel.js';
import { IDLE_FRAMES } from '../src/ui/TracedSprites.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { loadGameData } from './testData.js';

const data = loadGameData();

afterEach(() => vi.restoreAllMocks());

describe('step cadence', () => {
  it('is one idle frame per ~100 ms at a Normal step, against the map idle loop at 260 ms', () => {
    expect(stepCadenceMs(WALK_STEP_MS, WALK_PROFILES.Infantry)).toBe(100);
    for (const profile of Object.values(WALK_PROFILES))
      expect(stepCadenceMs(WALK_STEP_MS, profile)).toBeGreaterThanOrEqual(90);
    for (const profile of Object.values(WALK_PROFILES))
      expect(stepCadenceMs(WALK_STEP_MS, profile)).toBeLessThanOrEqual(110);
  });

  it('scales with the step time: Fast (half-length steps) cycles twice as quickly', () => {
    const normal = stepCadenceMs(80, WALK_PROFILES.Infantry);
    expect(stepCadenceMs(40, WALK_PROFILES.Infantry)).toBe(normal / 2);
    expect(stepCadenceMs(60, WALK_PROFILES.Infantry)).toBe(75); // an ice slide step
  });

  it('is bounded so a very short or long step never gives a flicker or a freeze', () => {
    expect(stepCadenceMs(1, WALK_PROFILES.Infantry)).toBe(30);
    expect(stepCadenceMs(100000, WALK_PROFILES.Infantry)).toBe(160);
  });

  it('a mount steps quicker and heavy armour slower than a foot soldier', () => {
    expect(WALK_PROFILES.Cavalry.cadenceMs).toBeLessThan(WALK_PROFILES.Infantry.cadenceMs);
    expect(WALK_PROFILES.Armored.cadenceMs).toBeGreaterThan(WALK_PROFILES.Infantry.cadenceMs);
  });

  it('advances the phase by time over cadence, capped per update, and wraps over the frames', () => {
    expect(advanceWalkPhase(0, 100, 100)).toBe(1);
    expect(advanceWalkPhase(2, 50, 100)).toBe(2.5);
    expect(advanceWalkPhase(1, 0, 100)).toBe(1);
    expect(advanceWalkPhase(1, -5, 100)).toBe(1);
    expect(advanceWalkPhase(1, 10_000, 100)).toBeCloseTo(1 + WALK_MAX_DT_MS / 100, 6);
    expect(advanceWalkPhase(1, 10, 0)).toBe(1);
    const names = IDLE_FRAMES;
    expect(walkFrameName(0, names)).toBe(names[0]);
    expect(walkFrameName(1.9, names)).toBe(names[1]);
    expect(walkFrameName(names.length, names)).toBe(names[0]);
    expect(walkFrameName(names.length + 2.2, names)).toBe(names[2]);
    expect(walkFrameName(-1, names)).toBe(names[names.length - 1]);
    expect(walkFrameName(0, [])).toBeNull();
    expect(walkFrameName(NaN, names)).toBe(names[0]);
  });
});

describe('which moves are drawn as a walk', () => {
  it('not under reduced motion, not at Instant (a 1 ms step), and not on a non-finite step', () => {
    expect(walkAllowed({ reduced: false, stepMs: 80 })).toBe(true);
    expect(walkAllowed({ reduced: false, stepMs: 40 })).toBe(true); // Fast
    expect(walkAllowed({ reduced: true, stepMs: 80 })).toBe(false);
    expect(walkAllowed({ reduced: false, stepMs: 1 })).toBe(false); // an Instant enemy step
    // A player's tile tween keeps 80 ms at Instant: the speed itself turns the walk off.
    expect(walkAllowed({ reduced: false, stepMs: 80, speed: 'instant' })).toBe(false);
    expect(walkAllowed({ reduced: false, stepMs: 80, speed: 'fast' })).toBe(true);
    expect(walkAllowed({ reduced: false, stepMs: WALK_MIN_STEP_MS - 1 })).toBe(false);
    expect(walkAllowed({ reduced: false, stepMs: NaN })).toBe(false);
    expect(walkAllowed({ reduced: false, stepMs: undefined })).toBe(true); // the Normal default
  });

  it('every move type has a gait: fliers glide, the rest step; unknown types walk as infantry', () => {
    expect(walkProfile('Flying').gait).toBe('glide');
    for (const type of ['Infantry', 'Armored', 'Cavalry'])
      expect(walkProfile(type).gait).toBe('step');
    expect(walkProfile('Zeppelin')).toBe(WALK_PROFILES.Infantry);
    expect(walkProfile(undefined)).toBe(WALK_PROFILES.Infantry);
    // every move type the terrain table prices has one
    for (const type of Object.keys(data.terrain[0].moveCost))
      expect(WALK_PROFILES[type]).toBeTruthy();
  });
});

describe('the hop and the glide', () => {
  it('a hop is an arch over one tile: flat at both ends, 1 to 2 px at the peak, whole pixels', () => {
    const bob = WALK_PROFILES.Infantry.bobPx;
    expect(stepLift(0, bob)).toBe(0);
    expect(stepLift(1, bob)).toBe(0);
    const peak = stepLift(0.5, bob);
    expect(peak).toBeGreaterThanOrEqual(1);
    expect(peak).toBeLessThanOrEqual(2);
    for (let i = 0; i <= 40; i++) {
      const lift = stepLift(i / 40, bob);
      expect(Number.isInteger(lift)).toBe(true);
      expect(lift).toBeGreaterThanOrEqual(0);
      expect(lift).toBeLessThanOrEqual(2);
      // symmetric: the same on the way down
      expect(stepLift(1 - i / 40, bob)).toBe(lift);
    }
  });

  it('every stepping gait stays within a pixel or two, and out-of-range progress is clamped', () => {
    for (const profile of Object.values(WALK_PROFILES)) {
      expect(profile.bobPx).toBeGreaterThan(0);
      expect(profile.bobPx).toBeLessThanOrEqual(2);
    }
    expect(stepLift(-3, 1.5)).toBe(0);
    expect(stepLift(7, 1.5)).toBe(0);
    expect(stepLift(NaN, 1.5)).toBe(0);
    expect(stepLift(0.5, 0)).toBe(0);
  });

  it('a glide is a slow swell about the flight line, never more than the profile allows', () => {
    const { bobPx, periodMs } = WALK_PROFILES.Flying;
    expect(glideLift(0, bobPx, periodMs)).toBe(0);
    const lifts = Array.from({ length: 80 }, (_, i) => glideLift(i * 13, bobPx, periodMs));
    expect(Math.max(...lifts)).toBe(bobPx);
    expect(Math.min(...lifts)).toBe(-bobPx);
    // slow: it changes sign at most a few times across the flight of a long move
    const flips = lifts
      .slice(1)
      .filter((v, i) => v !== 0 && lifts[i] !== 0 && v !== lifts[i]).length;
    expect(flips).toBeLessThanOrEqual(4);
    expect(glideLift(100, 0, periodMs)).toBe(0);
    expect(glideLift(100, 1, 0)).toBe(0);
    expect(glideLift(NaN, 1, 500)).toBe(0);
  });

  it('a flier takes the glide, never the hop', () => {
    const base = { now: 0, startMs: 0, stepStart: 0, stepMs: 80 };
    const steps = [0, 20, 40, 60, 80].map(
      (now) => walkPose({ ...base, now, profile: WALK_PROFILES.Infantry }).lift,
    );
    expect(Math.max(...steps)).toBeGreaterThanOrEqual(1);
    const fliers = [0, 20, 40, 60, 80].map(
      (now) => walkPose({ ...base, now, profile: WALK_PROFILES.Flying }).lift,
    );
    // over one 80 ms tile a 520 ms swell has barely begun: never the hop's arch
    expect(fliers).not.toEqual(steps);
    expect(fliers.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(walkPose({ ...base, now: 40, profile: WALK_PROFILES.Flying }).cycling).toBe(true);
  });
});

describe('walk pose', () => {
  const profile = WALK_PROFILES.Infantry;
  const at = (now, extra = {}) =>
    walkPose({ profile, now, startMs: 0, stepStart: 0, stepMs: 80, ...extra });

  it('a slide is a glide: no hop and no frame cycle, whatever the moment', () => {
    for (const now of [0, 20, 40, 60])
      expect(at(now, { slide: true })).toEqual({ cycling: false, lift: 0 });
  });

  it('a unit past its step is standing, not marching on the spot', () => {
    expect(isStriding(80 + WALK_GRACE_MS, 0, 80)).toBe(true);
    expect(isStriding(80 + WALK_GRACE_MS + 1, 0, 80)).toBe(false);
    expect(at(500)).toEqual({ cycling: false, lift: 0 });
    expect(at(40).cycling).toBe(true);
    expect(at(40).lift).toBeGreaterThan(0);
  });

  it('a walk with no step for WALK_STALE_MS is over', () => {
    expect(isStale(WALK_STALE_MS, 0)).toBe(false);
    expect(isStale(WALK_STALE_MS + 1, 0)).toBe(true);
  });
});

describe('the landing puff', () => {
  const base = { reduced: false, quality: 'high', speed: 'normal', gait: 'step', seen: true };

  it('is drawn for a stepping unit on a tile the player sees', () => {
    expect(puffAllowed(base)).toBe(true);
    expect(puffAllowed({ ...base, quality: 'medium' })).toBe(true);
  });

  it('is never drawn under reduced motion, on low effects, at Instant, for a flier or unseen', () => {
    expect(puffAllowed({ ...base, reduced: true })).toBe(false);
    expect(puffAllowed({ ...base, quality: 'low' })).toBe(false);
    expect(puffAllowed({ ...base, speed: 'instant' })).toBe(false);
    expect(puffAllowed({ ...base, gait: 'glide' })).toBe(false);
    expect(puffAllowed({ ...base, seen: false })).toBe(false);
    expect(puffAllowed({ ...base, seen: undefined })).toBe(false);
  });

  const family = (terrain, biome) => puffFamilyFor(terrain, biome);

  it('is the ground the unit stands on: dust, leaves, splash, mire, snow, sand', () => {
    expect(family('Plain')).toBe('dust');
    expect(family('Village')).toBe('dust');
    expect(family('Bridge')).toBe('dust');
    expect(family('Forest')).toBe('leaves');
    expect(family('Water')).toBe('splash');
    for (const mire of ['Swamp', 'Bog', 'Acidic Swamp', 'Acidic Bog'])
      expect(family(mire)).toBe('mire');
    expect(family('Ice')).toBe('snow');
    expect(family('Sand')).toBe('sand');
    for (const stone of ['Floor', 'Fort', 'Throne', 'Mountain'])
      expect(family(stone)).toBe('stone');
    expect(family('Lava Crack')).toBe('sparks');
  });

  it('follows the biome where the terrain has no ground of its own', () => {
    expect(family('Plain', 'tundra')).toBe('snow');
    expect(family('Forest', 'tundra')).toBe('snow'); // snow, not leaf litter
    expect(family('Plain', 'volcano')).toBe('ash');
    expect(family('Plain', 'castle')).toBe('stone');
    expect(family('Water', 'tundra')).toBe('splash'); // the terrain's own ground first
    expect(family(undefined, null)).toBe('dust');
    expect(family('Nowhere', 'nowhere')).toBe('dust');
  });

  it('every terrain in the data has a puff family with a style', () => {
    for (const t of data.terrain)
      for (const biome of [null, 'tundra', 'volcano', 'castle', 'swamp', 'void'])
        expect(PUFF_STYLES[puffFamilyFor(t.name, biome)], `${t.name}/${biome}`).toBeTruthy();
  });

  it('puff styles are small and tinted from the art palette', () => {
    for (const [name, style] of Object.entries(PUFF_STYLES)) {
      expect(style.count, name).toBeGreaterThanOrEqual(3);
      expect(style.count, name).toBeLessThanOrEqual(6);
      expect(style.colors.length, name).toBeGreaterThanOrEqual(2);
      for (const c of style.colors)
        expect(Number.isInteger(c) && c >= 0 && c <= 0xffffff).toBe(true);
      expect(style.lifeMs, name).toBeLessThanOrEqual(600);
      expect(style.size, name).toBeLessThanOrEqual(1); // the two smallest mote frames
    }
    // colour tells them apart: nothing shares a ramp
    const ramps = Object.values(PUFF_STYLES).map((s) => s.colors.join());
    expect(new Set(ramps).size).toBe(ramps.length);
  });

  it('motes are seeded: the same generator gives the same puff, a different one another', () => {
    const a = puffMotes('dust', 100, 200, createSeededRng(7));
    const b = puffMotes('dust', 100, 200, createSeededRng(7));
    const c = puffMotes('dust', 100, 200, createSeededRng(8));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    expect(a).toHaveLength(PUFF_STYLES.dust.count);
  });

  it('never reads Math.random', () => {
    vi.spyOn(Math, 'random').mockImplementation(() => {
      throw new Error('Math.random is the battle stream');
    });
    for (const name of Object.keys(PUFF_STYLES))
      expect(() => puffMotes(name, 0, 0, createSeededRng(3))).not.toThrow();
  });

  it('a puff stays small, around the feet, and fades out', () => {
    for (const [name, style] of Object.entries(PUFF_STYLES)) {
      const motes = puffMotes(name, 100, 200, createSeededRng(11));
      for (const m of motes) {
        expect(Math.abs(m.x - 100), name).toBeLessThanOrEqual(4);
        expect(Math.abs(m.dx), name).toBeLessThanOrEqual(style.spread);
        expect(Math.abs(m.dy), name).toBeLessThanOrEqual(Math.max(style.rise * 1.4, style.spread));
        expect(m.lifeMs, name).toBeGreaterThan(0);
        expect(m.alpha[1], name).toBe(0);
        expect(m.colors, name).toBe(style.colors);
      }
    }
  });

  it('a fan spreads to both sides of the feet; a ring surrounds them; leaves fall', () => {
    const fan = puffMotes('dust', 0, 0, createSeededRng(5));
    expect(fan.some((m) => m.dx < 0)).toBe(true);
    expect(fan.some((m) => m.dx > 0)).toBe(true);
    expect(fan.every((m) => m.dy < 0)).toBe(true); // lifts, then fades
    const ring = puffMotes('splash', 0, 0, createSeededRng(5));
    expect(ring.some((m) => m.dx < 0)).toBe(true);
    expect(ring.some((m) => m.dx > 0)).toBe(true);
    expect(ring.some((m) => m.dy < 0)).toBe(true); // a flat ellipse: out on both axes
    expect(ring.some((m) => m.dy > 0)).toBe(true);
    const leaves = puffMotes('leaves', 0, 0, createSeededRng(5));
    expect(leaves.every((m) => m.dy > 0)).toBe(true); // litter settles
    expect(leaves.every((m) => m.sway > 0)).toBe(true);
    expect(puffMotes('sparks', 0, 0, createSeededRng(5))[0].blend).toBe('add');
  });

  it("battle speed scales a puff's life", () => {
    const normal = puffMotes('dust', 0, 0, createSeededRng(9), 1);
    const fast = puffMotes('dust', 0, 0, createSeededRng(9), 0.5);
    normal.forEach((m, i) => expect(fast[i].lifeMs).toBeCloseTo(m.lifeMs / 2, -1));
    for (const m of puffMotes('dust', 0, 0, createSeededRng(9), 0)) expect(m.lifeMs).toBe(1);
  });

  it('an unknown family draws as dust', () => {
    expect(puffMotes('???', 0, 0, createSeededRng(1))).toHaveLength(PUFF_STYLES.dust.count);
  });
});

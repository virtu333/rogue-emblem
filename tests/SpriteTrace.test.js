import { describe, it, expect } from 'vitest';
import { Raster } from '../tools/art/sprite-trace/lib/raster.mjs';
import {
  recoverGrid,
  edgeProfile,
  estimatePitch,
  autocorr,
  pitchFromAutocorr,
} from '../tools/art/sprite-trace/lib/grid.mjs';
import { splitFigures } from '../tools/art/sprite-trace/lib/figures.mjs';
import { traceNative } from '../tools/art/sprite-trace/lib/trace.mjs';
import { render } from '../tools/art/sprite-trace/lib/render.mjs';
import { paletteFor, unlightGrade } from '../tools/art/sprite-trace/lib/treat.mjs';
import { BIBLE_RAMPS, rampFromSamples } from '../tools/art/sprite-trace/lib/ramps.mjs';
import { SLOT, WEAPON_SLOTS } from '../tools/art/sprite-trace/lib/slots.mjs';
import { KINDS, footRow, textureSize, fitScale } from '../tools/art/sprite-trace/lib/place.mjs';
import { idleFrames, attackFrames, weaponOf } from '../tools/art/sprite-trace/lib/motion.mjs';
import { packAtlas } from '../tools/art/sprite-trace/lib/atlas.mjs';
import { rollIdentity, hashString } from '../tools/art/sprite-trace/lib/identity.mjs';
import { pixelPerfect, removeSpecks } from '../tools/art/sprite-trace/lib/cleanup.mjs';
import { IndexedSprite } from '../tools/art/sprite-trace/lib/indexed.mjs';

// --- synthetic fixtures ---------------------------------------------------------

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Blocky native pixel art: coloured rectangles on transparency, 1 px dark outline. */
function nativeArt(w, h, seed = 1) {
  const r = new Raster(w, h);
  const rand = rng(seed);
  const palette = [
    [60, 90, 150],
    [200, 150, 110],
    [120, 70, 40],
    [220, 220, 230],
    [160, 40, 50],
    [230, 190, 70],
  ];
  r.fillRect(2, 1, w - 4, h - 2, [30, 30, 40, 255]);
  r.fillRect(3, 2, w - 6, h - 4, palette[0]);
  for (let k = 0; k < 14; k++) {
    const x = 3 + Math.floor(rand() * (w - 8)),
      y = 2 + Math.floor(rand() * (h - 6));
    const c = palette[Math.floor(rand() * palette.length)];
    r.fillRect(x, y, 1 + Math.floor(rand() * 4), 1 + Math.floor(rand() * 4), c);
  }
  // pixel-level shading clusters, as drawn sprites have
  for (let y = 2; y < h - 2; y++)
    for (let x = 3; x < w - 3; x++)
      if (rand() < 0.3) {
        const c = r.get(x, y);
        r.set(x, y, [c[0] * 0.75, c[1] * 0.75, c[2] * 0.75, 255].map(Math.round));
      }
  return r;
}

/**
 * Fake pixel art: each native pixel drawn as a block of `px` x `py` screen pixels
 * (non-integer pitch, so blocks alternate in size) with blended edges, the way image
 * models draw "pixel art".
 */
function fakePixels(native, px, py, { blend = 0.18 } = {}) {
  const W = Math.round(native.w * px),
    H = Math.round(native.h * py);
  const out = new Raster(W, H);
  for (let Y = 0; Y < H; Y++)
    for (let X = 0; X < W; X++) {
      const sx = (X + 0.5) / px,
        sy = (Y + 0.5) / py;
      const ix = Math.min(native.w - 1, Math.floor(sx)),
        iy = Math.min(native.h - 1, Math.floor(sy));
      let c = native.get(ix, iy);
      const fx = sx - ix,
        fy = sy - iy;
      // soften block edges toward the neighbour (resampling blur)
      const nx = fx < blend ? ix - 1 : fx > 1 - blend ? ix + 1 : ix;
      const ny = fy < blend ? iy - 1 : fy > 1 - blend ? iy + 1 : iy;
      if ((nx !== ix || ny !== iy) && native.inside(nx, ny)) {
        const d = native.get(nx, ny);
        c = c.map((v, k) => Math.round(v * 0.55 + d[k] * 0.45));
      }
      out.set(X, Y, c);
    }
  return out;
}

function matchRatio(a, b, tol = 6) {
  if (a.w !== b.w || a.h !== b.h) return 0;
  let same = 0;
  for (let i = 0; i < a.w * a.h; i++) {
    const o = i * 4;
    const ta = a.d[o + 3] > 0,
      tb = b.d[o + 3] > 0;
    if (!ta && !tb) same++;
    else if (ta && tb) {
      const d = Math.max(...[0, 1, 2].map((k) => Math.abs(a.d[o + k] - b.d[o + k])));
      if (d <= tol) same++;
    }
  }
  return same / (a.w * a.h);
}

// --- grid recovery ----------------------------------------------------------------

describe('grid recovery', () => {
  it('recovers native pixels from square fake pixels with a non-integer pitch', () => {
    const native = nativeArt(24, 30, 3);
    const fake = fakePixels(native, 6.4, 6.4);
    const res = recoverGrid(fake);
    expect(res.mode).toBe('grid');
    expect(res.pitch.x).toBeGreaterThan(6.1);
    expect(res.pitch.x).toBeLessThan(6.7);
    const b = res.native.alphaBounds(0);
    const got = res.native.crop(b.x, b.y, b.width, b.height);
    const want = native.crop(2, 1, native.w - 4, native.h - 2);
    expect([got.w, got.h]).toEqual([want.w, want.h]);
    // structure exact; colours: blended block edges may shift a shade on a few pixels
    expect(matchRatio(got, want, 40)).toBeGreaterThan(0.97);
    expect(matchRatio(got, want, 6)).toBeGreaterThan(0.85);
  });

  it('keeps separate pitches when a sheet was resized anisotropically', () => {
    const native = nativeArt(20, 26, 7);
    const fake = fakePixels(native, 7.0, 5.4);
    const res = recoverGrid(fake);
    expect(res.pitch.x).toBeGreaterThan(6.6);
    expect(res.pitch.y).toBeLessThan(5.8);
    const b = res.native.alphaBounds(0);
    expect([b.width, b.height]).toEqual([native.w - 4, native.h - 2]);
  });

  it('estimates the pitch of a periodic edge profile and rejects a smooth one', () => {
    const periodic = Float64Array.from({ length: 300 }, (_, i) => (i % 7 === 0 ? 100 : 3));
    expect(estimatePitch(periodic).pitch).toBeCloseTo(7, 0);
    expect(estimatePitch(periodic).confidence).toBeGreaterThan(0.5);
    const smooth = Float64Array.from({ length: 300 }, (_, i) => 50 + 40 * Math.sin(i / 23));
    expect(pitchFromAutocorr(autocorr(smooth, 30)).confidence).toBeLessThan(0.25);
  });

  it('falls back to a quality downscale for continuous-tone illustrations', () => {
    const img = new Raster(160, 200);
    for (let y = 0; y < 200; y++)
      for (let x = 0; x < 160; x++)
        img.set(x, y, [
          Math.round(128 + 100 * Math.sin(x / 17 + y / 29)),
          Math.round(128 + 90 * Math.cos(y / 13)),
          Math.round(128 + 80 * Math.sin((x + y) / 31)),
          255,
        ]);
    expect(recoverGrid(img).mode).toBe('downscale');
  });

  it('edge profiles are deterministic and sized to the box', () => {
    const fake = fakePixels(nativeArt(12, 12, 5), 5, 5);
    const a = edgeProfile(fake, 'x');
    const b = edgeProfile(fake, 'x');
    expect(a.E.length).toBe(fake.w + 1);
    expect(Array.from(a.E)).toEqual(Array.from(b.E));
  });

  it('splits a sheet into figures along transparent gutters', () => {
    const sheet = new Raster(120, 40);
    sheet.fillRect(5, 5, 20, 30, [200, 0, 0, 255]);
    sheet.fillRect(50, 2, 18, 35, [0, 200, 0, 255]);
    sheet.fillRect(26, 20, 2, 2, [0, 0, 200, 255]); // a sword tip poking into the gutter
    sheet.fillRect(95, 8, 20, 28, [0, 0, 200, 255]);
    const figs = splitFigures(sheet, 3);
    expect(figs).toHaveLength(3);
    expect(figs[0]).toEqual({ x: 5, y: 5, width: 23, height: 30 });
    expect(figs[1].x).toBe(50);
    expect(figs[2].x).toBe(95);
  });
});

// --- tracing, palette and placement ------------------------------------------------

/** A small figure with known materials: hair cap, face, blue tunic, boots, a blade. */
function figureNative() {
  const r = new Raster(40, 64);
  const ink = [14, 12, 20, 255];
  r.fillRect(13, 2, 14, 60, ink); // silhouette outline block
  r.fillRect(14, 3, 12, 6, [110, 62, 40, 255]); // hair
  r.fillRect(15, 9, 10, 7, [226, 178, 136, 255]); // face
  r.set(21, 11, [20, 18, 26, 255]); // eye
  r.set(21, 12, [20, 18, 26, 255]);
  r.fillRect(14, 17, 12, 24, [58, 91, 164, 255]); // blue tunic
  r.fillRect(16, 25, 8, 3, [90, 128, 196, 255]); // tunic highlight
  r.fillRect(14, 42, 12, 19, [48, 44, 60, 255]); // trousers
  r.fillRect(14, 55, 12, 6, [120, 72, 44, 255]); // boots
  for (let k = 0; k < 16; k++) r.fillRect(26 + (k >> 1), 30 + k, 2, 1, [226, 230, 238, 255]); // blade
  return r;
}

describe('trace', () => {
  const recipe = { kind: 'infantry', main: 'blue', hair: 'brown', head: [0, 0, 1, 0.26] };

  it('is deterministic', () => {
    const a = traceNative(figureNative(), recipe);
    const b = traceNative(figureNative(), recipe);
    expect(Array.from(a.sprite.slot)).toEqual(Array.from(b.sprite.slot));
    expect(Array.from(a.sprite.shade)).toEqual(Array.from(b.sprite.shade));
    const ra = render(a.sprite, paletteFor(a, { faction: 'player' }));
    const rb = render(b.sprite, paletteFor(b, { faction: 'player' }));
    expect(Buffer.from(ra.d).equals(Buffer.from(rb.d))).toBe(true);
  });

  it('keeps the foot baseline, the texture size and the per-kind bounds', () => {
    for (const density of [1, 1.5, 2]) {
      const t = traceNative(figureNative(), recipe, { density });
      const img = render(t.sprite, { ramps: t.ramps });
      expect(img.w).toBe(textureSize(density));
      const b = img.alphaBounds(0);
      expect(b.y + b.height).toBe(footRow(density)); // lowest opaque row = footRow - 1
      expect(b.height).toBeLessThanOrEqual(Math.round(KINDS.infantry.maxH * density) + 1);
      expect(b.width).toBeLessThanOrEqual(Math.round(KINDS.infantry.maxW * density));
      // the body (not the weapon) is centred on the tile
      const body = t.sprite.bounds((s) => s !== SLOT.metal && s !== SLOT.wood);
      expect(Math.abs(body.x + body.width / 2 - img.w / 2)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the reviewed proportions when a sheet had non-square pixels', () => {
    const base = figureNative();
    const tall = base.resizeNearest(base.w, Math.round(base.h * 1.5)); // rows 1.5x too many
    const ta = traceNative(base, recipe),
      tb = traceNative(tall, recipe, { aspect: 1 / 1.5 });
    const a = render(ta.sprite, { ramps: ta.ramps }).alphaBounds(0);
    const b = render(tb.sprite, { ramps: tb.ramps }).alphaBounds(0);
    expect(Math.abs(a.width - b.width)).toBeLessThanOrEqual(2);
    expect(Math.abs(a.height - b.height)).toBeLessThanOrEqual(2);
  });

  it('fits the body height, not the weapon, to the kind', () => {
    // a tall lance must not shrink its wielder
    expect(fitScale(60, 40, 75, 'infantry', 1.5)).toBeCloseTo(49 / 60, 5);
    // ...unless the whole figure would leave the texture above the baseline
    expect(fitScale(60, 40, 90, 'infantry', 1.5)).toBeCloseTo(64 / 90, 5);
    // very wide figures respect the kind's max width
    expect(fitScale(60, 200, 60, 'infantry', 1.5)).toBeCloseTo(55 / 200, 5);
  });

  it('segments the materials the treatments need', () => {
    const t = traceNative(figureNative(), recipe);
    const slots = new Set(t.sprite.slot);
    for (const s of [SLOT.hair, SLOT.skin, SLOT.main, SLOT.metal, SLOT.eye])
      expect(slots.has(s)).toBe(true);
  });

  it('faction and identity are ramp swaps of the same drawing', () => {
    const t = traceNative(figureNative(), recipe);
    const player = paletteFor(t, { faction: 'player' });
    const enemy = paletteFor(t, { faction: 'enemy' });
    const npc = paletteFor(t, { faction: 'npc' });
    expect(player.ramps[SLOT.main]).toEqual(BIBLE_RAMPS.steelCloth);
    expect(enemy.ramps[SLOT.main]).toEqual(BIBLE_RAMPS.lacquer);
    expect(npc.ramps[SLOT.main]).toEqual(BIBLE_RAMPS.verdigris);
    expect(paletteFor(t, { faction: 'player', keepMain: true }).ramps[SLOT.main]).toEqual(
      t.ramps[SLOT.main],
    );
    const recruit = paletteFor(t, {
      faction: 'player',
      identity: { hair: 'hairSilver', skin: 'skinDeep' },
    });
    expect(recruit.ramps[SLOT.hair]).toEqual(BIBLE_RAMPS.hairSilver);
    expect(recruit.ramps[SLOT.skin]).toEqual(BIBLE_RAMPS.skinDeep);
    // same silhouette in every state
    const a = render(t.sprite, player).alphaBounds(0);
    const b = render(t.sprite, enemy).alphaBounds(0);
    expect(a).toEqual(b);
    // every faction-cloth pixel of the player render is a steel ramp colour
    const img = render(t.sprite, player);
    const steel = new Set(BIBLE_RAMPS.steelCloth.map((c) => c.join(',')));
    for (let i = 0; i < t.sprite.w * t.sprite.h; i++)
      if (t.sprite.slot[i] === SLOT.main)
        expect(steel.has(Array.from(img.d.slice(i * 4, i * 4 + 3)).join(','))).toBe(true);
  });

  it('corruption drains colour toward unlight violet', () => {
    const g = unlightGrade();
    const [r, , b] = g([204, 64, 56], SLOT.main, 3);
    expect(b).toBeGreaterThan(r * 0.35); // blue climbs relative to red
    expect(r).toBeLessThan(204);
  });

  it('builds five-step ramps ordered dark to light', () => {
    const labs = [
      [20, 5, -20],
      [22, 5, -20],
      [45, 4, -25],
      [60, 2, -28],
      [80, 0, -10],
    ];
    const ramp = rampFromSamples(labs);
    expect(ramp).toHaveLength(5);
    const lum = ramp.map(([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b);
    for (let k = 1; k < 5; k++) expect(lum[k]).toBeGreaterThan(lum[k - 1]);
  });
});

describe('cleanup', () => {
  it('pixel-perfect removes the inner corner of a stair-step line', () => {
    const sp = new IndexedSprite(8, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) sp.set(x, y, SLOT.main, 2);
    // an L-stepped diagonal line: (1,1)(2,1)(2,2)(3,2)(3,3)(4,3)
    for (const [x, y] of [
      [1, 1],
      [2, 1],
      [2, 2],
      [3, 2],
      [3, 3],
      [4, 3],
      [4, 4],
    ])
      sp.set(x, y, SLOT.ink, 0);
    expect(pixelPerfect(sp)).toBeGreaterThan(0);
    // still one 8-connected line from (1,1) to (4,4)
    expect(sp.at(1, 1)).toBe(SLOT.ink);
    expect(sp.at(4, 4)).toBe(SLOT.ink);
  });

  it('absorbs specks but keeps eyes and weapon lines', () => {
    const sp = new IndexedSprite(7, 7);
    for (let y = 0; y < 7; y++) for (let x = 0; x < 7; x++) sp.set(x, y, SLOT.main, 2);
    sp.set(1, 1, SLOT.trim, 3);
    sp.set(5, 5, SLOT.eye, 0);
    sp.set(3, 3, SLOT.metal, 4);
    removeSpecks(sp, 2);
    expect(sp.at(1, 1)).toBe(SLOT.main);
    expect(sp.at(5, 5)).toBe(SLOT.eye);
    expect(sp.at(3, 3)).toBe(SLOT.metal);
  });
});

describe('motion', () => {
  it('idle and attack frames never move the feet', () => {
    const t = traceNative(figureNative(), { kind: 'infantry', main: 'blue', hair: 'brown' });
    const feet = (sp) => {
      const out = [];
      const b = sp.bounds();
      for (let x = 0; x < sp.w; x++) out.push(sp.at(x, b.y + b.height - 1));
      return out.join(',');
    };
    const base = feet(t.sprite);
    for (const f of [...idleFrames(t.sprite), ...attackFrames(t.sprite)])
      expect(feet(f)).toBe(base);
    // the breath frame differs from rest; the strike leans forward (right)
    const [f0, f1] = idleFrames(t.sprite);
    expect(Array.from(f1.slot)).not.toEqual(Array.from(f0.slot));
    const [, strike] = attackFrames(t.sprite);
    expect(strike.bounds().x + strike.bounds().width).toBeGreaterThan(
      f0.bounds().x + f0.bounds().width,
    );
  });

  // a standing figure facing right: torso, head, two legs, a fist at the right hip holding
  // a vertical weapon (steel blade, or a shaft with a steel head for the lance)
  const armed = (weapon) => {
    const sp = new IndexedSprite(96, 96);
    const fill = (x0, y0, x1, y1, slot, shade = 2) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) sp.set(x, y, slot, shade);
    };
    fill(44, 20, 51, 29, SLOT.skin); // head
    fill(42, 18, 52, 21, SLOT.hair);
    fill(40, 30, 55, 50, SLOT.main); // torso
    fill(41, 51, 45, 65, SLOT.sub); // legs
    fill(50, 51, 54, 65, SLOT.sub);
    fill(56, 40, 57, 42, SLOT.skin); // fist
    if (weapon === 'lance') {
      fill(58, 12, 58, 16, SLOT.metal, 4);
      fill(58, 17, 58, 60, SLOT.wood, 2);
    } else fill(58, 14, 59, 44, SLOT.metal, 3);
    return sp;
  };
  const weaponPixels = (sp) => {
    let n = 0;
    for (let i = 0; i < sp.w * sp.h; i++) if (WEAPON_SLOTS.has(sp.slot[i])) n++;
    return n;
  };
  const feetRow = (sp) => {
    const out = [];
    for (let x = 0; x < sp.w; x++) out.push(sp.at(x, 65));
    return out.join(',');
  };

  it('weapons are posed about the hand: blade raised then swept forward, lance thrust', () => {
    const sword = armed('sword');
    const w = weaponOf(sword);
    expect(w).not.toBe(null);
    // the grip is by the fist, the tip is the far (upper) end
    expect(Math.abs(w.grip[1] - 41)).toBeLessThanOrEqual(4);
    expect(w.tip[1]).toBeLessThan(20);
    const [windup, strike] = attackFrames(sword, { weapon: 'sword' });
    for (const f of [windup, strike]) {
      expect(feetRow(f)).toBe(feetRow(sword));
      // the blade is redrawn, not lost
      expect(weaponPixels(f)).toBeGreaterThanOrEqual(weaponPixels(sword) * 0.7);
    }
    const reach = (f) => {
      let x1 = -1;
      for (let i = 0; i < f.w * f.h; i++)
        if (WEAPON_SLOTS.has(f.slot[i])) x1 = Math.max(x1, i % f.w);
      return x1;
    };
    // the strike carries the blade out in front, well past its resting column
    expect(reach(strike)).toBeGreaterThan(reach(sword) + 10);
    // the windup leans back: the blade does not reach further forward than at rest
    expect(reach(windup)).toBeLessThanOrEqual(reach(sword) + 1);

    const lance = armed('lance');
    const [, thrust] = attackFrames(lance, { weapon: 'lance' });
    expect(feetRow(thrust)).toBe(feetRow(lance));
    expect(reach(thrust)).toBeGreaterThan(reach(lance) + 15);
  });

  it('a lance held behind a shield thrusts clear of it and stays in the hand', () => {
    // a knight: shield in front (right), lance upright at the far side, fist on the shaft
    const sp = new IndexedSprite(96, 96);
    const fill = (x0, y0, x1, y1, slot, shade = 2) => {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) sp.set(x, y, slot, shade);
    };
    fill(44, 20, 51, 29, SLOT.skin);
    fill(42, 18, 52, 21, SLOT.hair);
    fill(40, 30, 55, 50, SLOT.main);
    fill(41, 51, 45, 65, SLOT.sub);
    fill(50, 51, 54, 65, SLOT.sub);
    fill(56, 32, 63, 56, SLOT.armor); // shield
    fill(36, 36, 37, 38, SLOT.skin); // fist
    fill(38, 10, 38, 14, SLOT.metal, 4);
    fill(38, 15, 38, 46, SLOT.wood, 2);
    const w = weaponOf(sp, undefined, { type: 'lance' });
    expect(w.tip[1]).toBeLessThan(16);
    const [windup, thrust] = attackFrames(sp, { weapon: 'lance' });
    let head = -1;
    for (let i = 0; i < thrust.w * thrust.h; i++)
      if (thrust.slot[i] === SLOT.metal) head = Math.max(head, i % thrust.w);
    // the head clears the shield's front edge
    expect(head).toBeGreaterThan(63 + 2);
    // and the shaft still runs through the fist: weapon material beside it on its row
    const gy = Math.round(w.grip[1]);
    let inHand = false;
    for (let y = gy - 1; y <= gy + 2; y++)
      for (let x = 36; x <= 41; x++) if (WEAPON_SLOTS.has(thrust.at(x, y))) inHand = true;
    expect(inHand).toBe(true);
    // the legs stay planted in both key poses
    for (const f of [windup, thrust]) expect(feetRow(f)).toBe(feetRow(sp));
  });

  it('a blade does not run on into a limb or a boot in line with it', () => {
    const sp = armed('sword');
    // a boot in line with the blade's axis, beyond a gap below the fist
    for (let y = 52; y <= 64; y++) sp.set(58, y, SLOT.leather, 2);
    const w = weaponOf(sp);
    expect(w.pts.every(([, y]) => y < 50)).toBe(true);
  });

  it('posing is deterministic and never leaves specks floating', () => {
    const sp = armed('sword');
    const a = attackFrames(sp, { weapon: 'axe' });
    const b = attackFrames(sp, { weapon: 'axe' });
    expect(Array.from(a[1].slot)).toEqual(Array.from(b[1].slot));
    for (const f of [...a, ...idleFrames(sp)]) {
      // every filled pixel belongs to a component larger than three pixels
      const seen = new Uint8Array(f.w * f.h);
      for (let i = 0; i < f.w * f.h; i++) {
        if (!f.slot[i] || seen[i]) continue;
        const comp = [i];
        seen[i] = 1;
        for (let k = 0; k < comp.length; k++) {
          const x = comp[k] % f.w,
            y = (comp[k] / f.w) | 0;
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const j = (y + dy) * f.w + x + dx;
              if (f.inside(x + dx, y + dy) && f.slot[j] && !seen[j]) {
                seen[j] = 1;
                comp.push(j);
              }
            }
        }
        expect(comp.length).toBeGreaterThan(3);
      }
    }
  });
});

describe('identity and atlas', () => {
  it('rolls a stable identity per seed with no faction hues', () => {
    const a = rollIdentity(hashString('20260924:recruit:0'));
    expect(rollIdentity(hashString('20260924:recruit:0'))).toEqual(a);
    const seen = new Set();
    for (let i = 0; i < 40; i++) {
      const id = rollIdentity(hashString(`seed:${i}`));
      expect(['steelCloth', 'lacquer', 'verdigris']).not.toContain(id.band);
      seen.add(`${id.hair}/${id.skin}/${id.design}`);
    }
    expect(seen.size).toBeGreaterThan(10);
  });

  it('packs trimmed strips into 2048 px pages with a trim-aware manifest', () => {
    // a 10x20 figure standing on the foot row (65) of a 96 px frame, at a per-sprite spot
    const frame = (i) => {
      const r = new Raster(96, 96);
      r.fillRect(40 + (i % 7), 46, 10, 20, [200, 100, 50, 255]);
      return r;
    };
    const baked = Array.from({ length: 400 }, (_, i) => ({
      key: `k${i}`,
      kind: 'infantry',
      frames: Array.from({ length: 4 }, () => frame(i)),
    }));
    const { pages, manifest } = packAtlas(baked, { density: 1.5 });
    expect(manifest.version).toBe(2);
    expect(manifest.cell).toBe(96);
    expect(manifest.footRow).toBe(66);
    expect(manifest.pages).toHaveLength(pages.length);
    for (const p of pages) {
      expect(p.w).toBeLessThanOrEqual(2048);
      expect(p.h).toBeLessThanOrEqual(2048);
    }
    const spots = new Set();
    for (const [k, s] of Object.entries(manifest.sprites)) {
      const i = +k.slice(1);
      // trimmed to the figure, logical frame and offset kept
      expect([s.w, s.h, s.size, s.ox, s.oy]).toEqual([10, 20, 96, 40 + (i % 7), 46]);
      expect(s.oy + s.h).toBe(manifest.footRow);
      // pixels are really there, with a transparent gutter between frames
      const page = pages[s.page];
      for (let f = 0; f < 4; f++) {
        expect(page.get(s.x + f * s.step, s.y)[3]).toBe(255);
        expect(page.get(s.x + f * s.step + s.w, s.y)[3]).toBe(0);
      }
      spots.add(`${s.page}:${s.x},${s.y}`);
    }
    expect(spots.size).toBe(400);
    // a small page size spills into more pages, every sprite still placed once
    const small = packAtlas(baked, { density: 1.5, maxSide: 256 });
    expect(small.pages.length).toBeGreaterThan(1);
    expect(Object.keys(small.manifest.sprites)).toHaveLength(400);
    for (const s of Object.values(small.manifest.sprites))
      expect(s.x + 3 * s.step + s.w).toBeLessThanOrEqual(small.pages[s.page].w);
    // deterministic
    expect(JSON.stringify(packAtlas(baked, { density: 1.5 }).manifest)).toBe(
      JSON.stringify(manifest),
    );
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import { existsSync, readdirSync } from 'fs';
import sharp from 'sharp';
import {
  q4,
  snap12,
  is12bit,
  rgbToOklab,
  oklabToRgb,
  labDist,
  chroma,
  hue,
  hueDiff,
} from '../tools/art/pc98/lib/color.mjs';
import { choosePalette, families } from '../tools/art/pc98/lib/palette.mjs';
import { assignDithered, canMix, quantizeMix, MATERIAL } from '../tools/art/pc98/lib/dither.mjs';
import { renderFigure, bake, INK } from '../tools/art/pc98/lib/pipeline.mjs';
import { encodeIndexedPng } from '../tools/art/pc98/lib/png.mjs';
import { renderPlate, plateColours, plateLevel, FACTIONS } from '../tools/art/pc98/lib/plate.mjs';
import { segmentBackground } from '../tools/art/pc98/lib/segment.mjs';
import { toLab } from '../tools/art/pc98/lib/raster.mjs';
import {
  SIZES,
  tierFor,
  thumbCrop,
  smoothFor,
  defaultFaction,
} from '../tools/art/pc98/lib/config.mjs';
import {
  PC98_MANIFEST,
  PC98_SIZES,
  pickPortraitSize,
  portraitArtMode,
  setPortraitArtMode,
  portraitIdFromKey,
  portraitCandidates,
  portraitIdForUnit,
  portraitFaction,
  legacyPortraitUrl,
  rebuiltPortraitUrl,
  legacyKeyAliasesRebuilt,
  portraitCanvasFrame,
  pc98AtlasData,
  pc98PortraitElement,
  pc98FigureUrl,
} from '../src/ui/portraitArt.js';
import rebuiltManifest from '../src/ui/RebuiltPortraitManifest.json';
import framing from '../src/ui/ceremonyPortraitFraming.json';
import { bustPixelScale, portraitPixelScale } from '../src/ui/ceremonyDom.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

/** Synthetic bust: gradient body, a small teal scarf, a skin face with eyes. */
function synthetic(size = 48) {
  const rgba = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside =
        (x - size / 2) ** 2 / (size * 0.42) ** 2 + (y - size * 0.7) ** 2 / (size * 0.55) ** 2 < 1;
      if (!inside) continue;
      const t = y / size;
      let c = [90 + 80 * t, 70 + 50 * t, 60 + 30 * t]; // brown-grey gradient
      if (y > size * 0.62 && y < size * 0.7) c = [40, 120, 120]; // teal scarf
      if ((x - size / 2) ** 2 + (y - size * 0.4) ** 2 < (size * 0.14) ** 2) c = [240, 190, 150];
      if (y === Math.round(size * 0.38) && Math.abs(x - size / 2) === 3) c = [40, 150, 60]; // eyes
      rgba.set([...c.map(Math.round), 255], i);
    }
  return rgba;
}

describe('PC-98 colour: 12-bit', () => {
  it('snaps channels to multiples of 17', () => {
    expect([0, 8, 9, 100, 255].map(q4)).toEqual([0, 0, 17, 102, 255]);
    for (const rgb of [
      [12, 200, 77],
      [255, 254, 1],
      [30, 12, 44],
    ])
      expect(is12bit(snap12(rgb))).toBe(true);
  });

  it('does not push pale skin toward yellow', () => {
    const pale = [249, 229, 197];
    const snapped = snap12(pale);
    expect(chroma(rgbToOklab(...snapped))).toBeLessThanOrEqual(chroma(rgbToOklab(...pale)) + 0.004);
  });

  it('round-trips OKLab', () => {
    const rgb = [120, 45, 200];
    const back = oklabToRgb(...rgbToOklab(...rgb));
    back.forEach((v, i) => expect(v).toBeCloseTo(rgb[i], 3));
  });
});

describe('PC-98 palette', () => {
  const size = 48;
  const img = toLab(synthetic(size), size, size);
  const samples = [];
  const weights = [];
  for (let i = 0; i < size * size; i++)
    if (img.mask[i]) {
      samples.push(img.L[i], img.A[i], img.B[i]);
      weights.push(1);
    }
  const S = Float32Array.from(samples);
  const W = Float32Array.from(weights);

  it('stays within budget, 12-bit, deterministic', () => {
    const a = choosePalette(S, W, { k: 6, seed: 3 });
    const b = choosePalette(S, W, { k: 6, seed: 3 });
    expect(a.length).toBeLessThanOrEqual(6);
    expect(a.every((p) => is12bit(p.rgb))).toBe(true);
    expect(a.map((p) => p.rgb)).toEqual(b.map((p) => p.rgb));
  });

  it('keeps a small identity hue (the teal scarf) even with few colours', () => {
    const pal = choosePalette(S, W, { k: 4, seed: 3 });
    const teal = rgbToOklab(40, 120, 120);
    expect(pal.some((p) => chroma(p.lab) > 0.04 && hueDiff(hue(p.lab), hue(teal)) < 30)).toBe(true);
  });

  it('forces keep colours', () => {
    const pal = choosePalette(S, W, { k: 5, seed: 1, keep: [[200, 30, 30]] });
    expect(pal.some((p) => p.rgb.join() === snap12([200, 30, 30]).join())).toBe(true);
  });

  it('groups neutrals together and chains hues', () => {
    const f = families([
      rgbToOklab(128, 128, 128),
      rgbToOklab(200, 200, 200),
      rgbToOklab(200, 40, 40),
    ]);
    expect(f[0]).toBe(f[1]);
    expect(f[2]).not.toBe(f[0]);
  });
});

describe('PC-98 dither', () => {
  it('only mixes near colours of compatible hue', () => {
    const red = rgbToOklab(180, 40, 40);
    const darkRed = rgbToOklab(140, 30, 35);
    const green = rgbToOklab(40, 160, 40);
    expect(canMix(red, darkRed, 0.13)).toBe(true);
    expect(canMix(red, green, 0.13)).toBe(false);
  });

  it('quantizes to PC-98 pattern levels (skin sparse, flat none)', () => {
    expect(quantizeMix(0.05, MATERIAL.CLOTH)).toBe(0);
    expect(quantizeMix(0.25, MATERIAL.CLOTH)).toBe(0.25);
    expect(quantizeMix(0.45, MATERIAL.CLOTH)).toBe(0.5);
    expect(quantizeMix(0.25, MATERIAL.SKIN)).toBe(0);
    expect(quantizeMix(0.45, MATERIAL.FLAT)).toBe(0);
  });

  function gradient(from, to, w = 32, h = 8) {
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const t = x / (w - 1);
        rgba.set([...from.map((v, k) => v + (to[k] - v) * t), 255], (y * w + x) * 4);
      }
    return toLab(rgba, w, h);
  }

  it('dithers a gradient between near colours into a checker, never across hues', () => {
    const near = gradient([120, 40, 40], [160, 60, 50]);
    const pal = [
      [120, 40, 40],
      [160, 60, 50],
    ].map((rgb) => ({ rgb, lab: rgbToOklab(...rgb) }));
    const out = assignDithered(near, pal, null, { nearDist: 0.13 });
    expect(out.dithered.some(Boolean)).toBe(true);
    const far = gradient([200, 40, 40], [40, 60, 200]);
    const pal2 = [
      [200, 40, 40],
      [40, 60, 200],
    ].map((rgb) => ({ rgb, lab: rgbToOklab(...rgb) }));
    const out2 = assignDithered(far, pal2, null, { nearDist: 0.13 });
    expect(out2.dithered.some(Boolean)).toBe(false);
  });

  it('checker at 50%: neighbours alternate', () => {
    const w = 8;
    const rgba = new Uint8Array(w * w * 4);
    const mid = [140, 50, 45];
    for (let i = 0; i < w * w; i++) rgba.set([...mid, 255], i * 4);
    const pal = [
      [120, 40, 40],
      [160, 60, 50],
    ].map((rgb) => ({ rgb, lab: rgbToOklab(...rgb) }));
    const { index } = assignDithered(toLab(rgba, w, w), pal, null, { nearDist: 0.2 });
    for (let y = 1; y < w - 1; y++)
      for (let x = 1; x < w - 1; x++) expect(index[y * w + x]).not.toBe(index[y * w + x + 1]);
  });
});

describe('PC-98 render', () => {
  const size = 48;
  const face = { cx: 24, cy: 20, rx: 8, ry: 10 };

  it('is deterministic and within the colour budget', () => {
    const a = renderFigure(synthetic(size), size, { colours: 9, face, seed: 7, cel: null });
    const b = renderFigure(synthetic(size), size, { colours: 9, face, seed: 7, cel: null });
    expect(Buffer.from(a.indices).equals(Buffer.from(b.indices))).toBe(true);
    expect(a.palette).toEqual(b.palette);
    expect(a.colours).toBeLessThanOrEqual(10); // 9 + ink
    expect(a.palette.slice(1).every(is12bit)).toBe(true);
    expect(a.indices.some((v) => v === 0)).toBe(true); // transparent backdrop
  });

  it('outlines the silhouette in ink', () => {
    const fig = renderFigure(synthetic(size), size, { colours: 9, face, seed: 7, cel: null });
    const inkIndex = fig.palette.findIndex((c, i) => i > 0 && c.join() === INK.join());
    expect(inkIndex).toBeGreaterThan(0);
    // The first opaque pixel of the middle row is ink.
    const row = size / 2;
    const first = [...Array(size).keys()].find((x) => fig.indices[row * size + x] !== 0);
    expect(fig.indices[row * size + first]).toBe(inkIndex);
  });

  it('small sizes reuse the master palette', () => {
    const master = renderFigure(synthetic(96), 96, { colours: 12, seed: 7, cel: null });
    const small = renderFigure(synthetic(32), 32, {
      colours: 8,
      palette: master.figurePalette,
      seed: 7,
      cel: null,
      dither: 'none',
    });
    const masterSet = new Set([INK, ...master.figurePalette].map((c) => c.join()));
    expect(small.palette.slice(1).every((c) => masterSet.has(c.join()))).toBe(true);
    expect(small.colours).toBeLessThanOrEqual(9);
  });

  it('bakes over a plate into one opaque image of <= 16 colours at the master tier', () => {
    const fig = renderFigure(synthetic(size), size, { colours: 13, face, seed: 1, cel: null });
    const baked = bake(fig, renderPlate(size), plateColours('blood'));
    expect(baked.palette.length).toBeLessThanOrEqual(16);
    expect(Math.max(...baked.indices)).toBeLessThan(baked.palette.length);
  });

  it('encodes a palette PNG that decodes to the same pixels', async () => {
    const fig = renderFigure(synthetic(size), size, { colours: 9, face, seed: 7, cel: null });
    const png = encodeIndexedPng(size, size, fig.indices, fig.palette, fig.alpha);
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.width).toBe(size);
    for (let i = 0; i < size * size; i += 37) {
      const v = fig.indices[i];
      expect(data[i * 4 + 3]).toBe(v === 0 ? 0 : 255);
      if (v) expect([data[i * 4], data[i * 4 + 1], data[i * 4 + 2]]).toEqual(fig.palette[v]);
    }
  });
});

describe('PC-98 plates, segmentation, config', () => {
  it('plates use two 12-bit tones and darken toward the top', () => {
    for (const f of FACTIONS) {
      const t = plateColours(f);
      expect(is12bit(t.top) && is12bit(t.bottom)).toBe(true);
    }
    expect(plateLevel(0, 96)).toBe(0);
    expect(plateLevel(95, 96)).toBe(1);
    const plate = renderPlate(32);
    expect(new Set(plate).size).toBe(2);
  });

  it('removes a flat backdrop but keeps a figure touching the frame bottom', () => {
    const w = 32;
    const rgba = new Uint8Array(w * w * 4);
    for (let i = 0; i < w * w; i++) {
      const x = i % w;
      const y = Math.floor(i / w);
      const fig = Math.abs(x - 16) < 8 && y > 10;
      rgba.set(fig ? [180, 60, 60, 255] : [26, 26, 46, 255], i * 4);
    }
    const { mask } = segmentBackground(rgba, w, w);
    expect(mask[0]).toBe(0);
    expect(mask[(w - 1) * w + 16]).toBe(1);
    expect(mask[5 * w + 16]).toBe(0);
  });

  it('chooses sizes for real display boxes and crops thumbnails to the face', () => {
    expect(SIZES).toEqual([192, 96, 64, 48, 40, 32]);
    expect(tierFor(192).colours).toBeGreaterThan(tierFor(32).colours);
    expect(tierFor(32).dither).toBe('none');
    const c = thumbCrop(32, { eye: 0.36, cx: 0.5 });
    expect(c.side).toBeLessThan(1);
    expect(c.left).toBeGreaterThanOrEqual(0);
    expect(c.left + c.side).toBeLessThanOrEqual(1);
    expect(thumbCrop(96, { eye: 0.36, cx: 0.5 }).side).toBe(1);
    expect(smoothFor(192, 88)).toBeGreaterThan(0);
    expect(smoothFor(32, 128)).toBe(0);
    expect(defaultFaction('lord_edric')).toBe('ember');
    expect(defaultFaction('enemy_zombie')).toBe('unlight');
    expect(defaultFaction('generic_mage')).toBe('steel');
  });
});

describe('PC-98 portrait runtime', () => {
  afterEach(() => setPortraitArtMode(null));

  it('covers every legacy and rebuilt portrait, with all sizes on disk', () => {
    const legacy = readdirSync('assets/portraits')
      .filter((f) => f.endsWith('.png'))
      .map((f) => f.slice(0, -4));
    const ids = Object.keys(PC98_MANIFEST.portraits);
    for (const id of [...legacy, ...Object.keys(rebuiltManifest)]) expect(ids).toContain(id);
    for (const id of Object.keys(rebuiltManifest))
      expect(PC98_MANIFEST.portraits[id].source).toBe('rebuilt');
    for (const id of ids) {
      for (const size of PC98_SIZES)
        expect(existsSync(`public/assets/portraits/pc98/${size}/${id}.png`)).toBe(true);
      expect(existsSync(`public/assets/portraits/pc98/baked/${id}.png`)).toBe(true);
      expect(framing[id]).toBeTruthy();
    }
  });

  it('picks the largest variant that is never shrunk', () => {
    expect(pickPortraitSize(192)).toBe(192);
    expect(pickPortraitSize(190)).toBe(192);
    expect(pickPortraitSize(96)).toBe(96);
    expect(pickPortraitSize(88)).toBe(64);
    expect(pickPortraitSize(48)).toBe(48);
    expect(pickPortraitSize(30)).toBe(32);
    expect(pickPortraitSize(12)).toBe(32);
    expect(pickPortraitSize(400)).toBe(192);
  });

  it('escape hatch ?portraitArt=classic works in dev builds only', () => {
    expect(portraitArtMode('?portraitArt=classic', true)).toBe('classic');
    expect(portraitArtMode('?portraitArt=classic', false)).toBe('pc98');
    expect(portraitArtMode('', true)).toBe('pc98');
    expect(legacyPortraitUrl('enemy_mage', 'classic')).toBe('assets/portraits/enemy_mage.png');
    expect(legacyPortraitUrl('enemy_mage', 'pc98')).toBe(
      'assets/portraits/pc98/baked/enemy_mage.png',
    );
    expect(rebuiltPortraitUrl('lord_edric', 'classic')).toMatch(/rebuilt\/lord_edric\.png$/);
    expect(rebuiltPortraitUrl('lord_edric', 'pc98')).toMatch(/pc98\/baked\/lord_edric\.png$/);
    expect(legacyKeyAliasesRebuilt('lord_edric', 'pc98')).toBe(true);
    expect(legacyKeyAliasesRebuilt('lord_edric', 'classic')).toBe(false);
    expect(legacyKeyAliasesRebuilt('enemy_mage', 'pc98')).toBe(false);
  });

  it('maps texture keys to ids, rebuilt art first', () => {
    expect(portraitIdFromKey('rebuilt-portrait-lord_sera')).toBe('lord_sera');
    expect(portraitIdFromKey('portrait_enemy_mage')).toBe('enemy_mage');
    expect(portraitIdFromKey('portrait_nobody')).toBeNull();
    expect(portraitIdFromKey(null)).toBeNull();
  });

  it('resolves units like the texture chain did, with fallbacks', () => {
    const edric = {
      name: 'Edric',
      isLord: true,
      tier: 'promoted',
      className: 'Lord',
      faction: 'player',
    };
    expect(portraitCandidates(edric, gameData)[0]).toBe('lord_edric_promoted');
    expect(portraitIdForUnit({ ...edric, tier: 'base' }, gameData)).toBe('lord_edric');
    const boss = { name: 'Iron Captain', isBoss: true, className: 'Knight', faction: 'enemy' };
    expect(portraitIdForUnit(boss, gameData)).toBe('boss_iron_captain');
    const mage = { name: 'Grunt', className: 'Mage', faction: 'enemy' };
    expect(portraitIdForUnit(mage, gameData)).toBe('enemy_mage');
    const fighter = { name: 'Recruit', className: 'Fighter', faction: 'player' };
    expect(portraitIdForUnit(fighter, gameData)).toBe('generic_fighter');
    // A promoted class without its own portrait falls back to its base class.
    const promoted = gameData.classes.find(
      (c) =>
        c.promotesFrom &&
        !PC98_MANIFEST.portraits[`generic_${c.name.toLowerCase().replace(/ /g, '_')}`],
    );
    if (promoted) {
      const id = portraitIdForUnit(
        { name: 'X', className: promoted.name, faction: 'player' },
        gameData,
      );
      expect(id).toBe(`generic_${promoted.promotesFrom.toLowerCase().replace(/ /g, '_')}`);
    }
    expect(
      portraitIdForUnit({ name: 'X', className: 'Nope', faction: 'player' }, gameData),
    ).toBeNull();
  });

  it('plates follow the side the unit stands on', () => {
    expect(portraitFaction({ faction: 'enemy' }, 'enemy_mage')).toBe('blood');
    expect(portraitFaction({ faction: 'enemy' }, 'enemy_zombie')).toBe('unlight');
    expect(portraitFaction({ faction: 'npc' }, 'generic_cleric')).toBe('verdigris');
    expect(portraitFaction({ faction: 'player', isLord: true }, 'lord_sera')).toBe('ember');
    expect(portraitFaction({ faction: 'player' }, 'boss_warchief')).toBe('steel');
    expect(portraitFaction(null, 'boss_the_entity')).toBe('unlight');
  });

  it('canvas draws the atlas frame when loaded, else the texture', () => {
    const textures = new Set(['portrait_enemy_mage', 'pc98-portraits-40']);
    const scene = {
      textures: {
        exists: (k) => textures.has(k),
        get: () => ({ has: (frame) => frame === 'enemy_mage' }),
      },
    };
    expect(portraitCanvasFrame(scene, 'portrait_enemy_mage', 40)).toEqual({
      key: 'pc98-portraits-40',
      frame: 'enemy_mage',
    });
    setPortraitArtMode('classic');
    expect(portraitCanvasFrame(scene, 'portrait_enemy_mage', 40)).toEqual({
      key: 'portrait_enemy_mage',
    });
    expect(portraitCanvasFrame(scene, 'portrait_missing', 40)).toBeNull();
  });

  it('atlas data addresses every portrait inside the sheet', () => {
    const data = pc98AtlasData(48);
    const ids = Object.keys(PC98_MANIFEST.portraits);
    expect(Object.keys(data.frames)).toHaveLength(ids.length);
    for (const f of Object.values(data.frames)) {
      expect(f.frame.x + 48).toBeLessThanOrEqual(data.meta.size.w);
      expect(f.frame.y + 48).toBeLessThanOrEqual(data.meta.size.h);
    }
  });

  it('builds a pixelated DOM figure over its faction plate', () => {
    const make = (tag) => {
      const node = {
        tagName: tag.toUpperCase(),
        children: [],
        dataset: {},
        props: {},
        classList: {
          set: new Set(),
          add(...c) {
            c.forEach((v) => this.set.add(v));
          },
        },
        style: { setProperty: (k, v) => (node.props[k] = v) },
        append: (...c) => node.children.push(...c),
      };
      return node;
    };
    const original = globalThis.document;
    globalThis.document = { createElement: make };
    try {
      const img = pc98PortraitElement({
        id: 'lord_sera',
        size: 96,
        faction: 'ember',
        className: 'x',
      });
      expect(img.src).toBe(pc98FigureUrl('lord_sera', 96));
      expect(img.className).toBe('x pc98-portrait');
      expect(img.props['--pc98-plate']).toMatch(/plates\/ember-96\.png/);
      const pic = pc98PortraitElement({
        id: 'lord_sera',
        size: 40,
        media: [['(min-width: 1px)', 64]],
      });
      expect(pic.tagName).toBe('PICTURE');
      expect(pic.children[0].srcset).toMatch(/\/64\/lord_sera\.png$/);
    } finally {
      globalThis.document = original;
    }
  });

  it('ceremony pixel scales stay integer and the bust fits its column', () => {
    expect(portraitPixelScale({ width: 640, height: 480 })).toBe(1);
    expect(portraitPixelScale({ width: 1280, height: 960 })).toBe(2);
    expect(bustPixelScale({ width: 1280, height: 960 })).toBe(2);
    expect(bustPixelScale({ width: 960, height: 720 })).toBe(1); // 384 > 36% of 960
    expect(bustPixelScale({ width: 520, height: 390 })).toBe(1);
  });

  it('keeps OKLab helpers honest', () => {
    expect(labDist([0, 0, 0], [0, 0.03, 0.04])).toBeCloseTo(0.05, 6);
  });
});

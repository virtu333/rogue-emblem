// Mobile texture budget for portrait variety (docs/mobile-memory-budget.md
// rules: art ships at the size it is drawn, nothing above 3x its display
// size, no raw/backup/unused files under assets/).
//
// More faces must not raise texture memory: the boot atlases and baked 192
// textures hold the class defaults only (as before variety); variant faces
// ship as display-sized figures that the DOM decodes on demand and the
// canvas loads lazily into a capped set of small textures.
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import manifest from '../src/ui/Pc98PortraitManifest.json';
import table from '../src/data/portraitVariants.json';
import { VARIANT_TEXTURE_CAP } from '../src/ui/portraitTextures.js';

const ROOT = path.resolve(__dirname, '..');
const PC98 = path.join(ROOT, 'assets/portraits/pc98');
const ids = Object.keys(manifest.portraits);
const defaults = ids.filter((id) => !manifest.portraits[id].variant);
const variants = ids.filter((id) => manifest.portraits[id].variant);
// Before portrait variety: 94 defaults in 4 atlases + 94 baked 192 textures.
const DEFAULTS_BEFORE_VARIETY = 94;

describe('portrait variety texture budget', () => {
  it('ships many more faces than defaults', () => {
    expect(defaults.length).toBe(DEFAULTS_BEFORE_VARIETY);
    expect(variants.length).toBeGreaterThan(200);
  });

  it('keeps the boot textures (atlases + baked 192) exactly the size they were', async () => {
    const baked = fs.readdirSync(path.join(PC98, 'baked'));
    expect(baked.sort()).toEqual(defaults.map((id) => `${id}.png`).sort());
    const cols = manifest.atlas.columns;
    const rows = Math.ceil(DEFAULTS_BEFORE_VARIETY / cols);
    let bootBytes = 0;
    for (const size of manifest.atlas.sizes) {
      const meta = await sharp(path.join(PC98, 'atlas', `${size}.png`)).metadata();
      expect([meta.width, meta.height]).toEqual([cols * size, rows * size]);
      bootBytes += meta.width * meta.height * 4;
    }
    bootBytes += baked.length * 192 * 192 * 4;
    // 3.6 MB of atlases + 13.9 MB of baked 192s, unchanged by variety.
    expect(bootBytes / 1e6).toBeLessThan(17.6);
  });

  it('renders every figure at its display size (never above 3x what is shown)', async () => {
    for (const size of manifest.sizes) {
      const files = fs.readdirSync(path.join(PC98, String(size)));
      expect(files.sort(), `size ${size}`).toEqual(ids.map((id) => `${id}.png`).sort());
      for (const file of files.filter((_, i) => i % 7 === 0)) {
        const meta = await sharp(path.join(PC98, String(size), file)).metadata();
        expect([meta.width, meta.height], file).toEqual([size, size]);
        // 4-bit or 8-bit palette PNGs: the dither survives compression.
        expect(meta.paletteBitDepth || meta.bitsPerSample, file).toBeLessThanOrEqual(8);
      }
    }
  });

  it('caps the lazy canvas faces at a fraction of a megabyte', () => {
    // 96 faces x 64 px x 4 bytes at the largest canvas atlas size.
    expect((VARIANT_TEXTURE_CAP * 64 * 64 * 4) / 1e6).toBeLessThan(1.6);
  });

  it('keeps the shipped set small and every source outside assets/', () => {
    let bytes = 0;
    const walk = (d) => {
      for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        if (fs.statSync(p).isDirectory()) walk(p);
        else bytes += fs.statSync(p).size;
      }
    };
    walk(PC98);
    expect(bytes / 1e6).toBeLessThan(6); // 5.4 MB with ~240 variant faces
    expect(fs.existsSync(path.join(PC98, 'manifest.json'))).toBe(false); // provenance is not shipped
    const provenance = JSON.parse(
      fs.readFileSync(path.join(ROOT, 'tools/art/pc98/provenance.json'), 'utf8'),
    );
    const generated = Object.entries(provenance.portraits).filter(
      ([, p]) => p.kind === 'generated',
    );
    expect(generated.length).toBeGreaterThan(200);
    for (const [id, p] of generated) {
      expect(p.source, id).toMatch(/^docs\/art\/portrait-variant-sources\//);
      expect(fs.existsSync(path.join(ROOT, p.source)), id).toBe(true);
    }
  });

  it('every face the runtime can pick exists at every size', () => {
    const picked = [
      ...Object.values(table.identities).flatMap((p) => Object.values(p.renders)),
      ...Object.values(table.enemy).flat(),
    ];
    for (const id of picked)
      for (const size of manifest.sizes) {
        expect(fs.existsSync(path.join(PC98, String(size), `${id}.png`)), `${id}@${size}`).toBe(
          true,
        );
        expect(
          fs.existsSync(path.join(ROOT, 'public/assets/portraits/pc98', String(size), `${id}.png`)),
          `public ${id}@${size}`,
        ).toBe(true);
      }
  });

  it('ships no raw generations or backups with the portraits', () => {
    const bad = [];
    const walk = (d) => {
      for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/(_raw|[-_.]bak|backup|\.orig|~)(\.|$)|\.gen\.json$|\.jpe?g$/i.test(name))
          bad.push(p);
      }
    };
    walk(path.join(ROOT, 'assets/portraits'));
    expect(bad).toEqual([]);
  });
});

// Mobile texture budget for the rebuilt art. Battle sprites ship pre-rendered
// (tools/bakeRebuiltSprites.mjs) and portraits are capped at 512px
// (tools/shrinkRebuiltPortraits.mjs): at 1254px the two sets decoded to ~410 MB.

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import manifest from '../src/ui/RebuiltSpriteManifest.json';
import tracedManifest from '../src/ui/TracedSpriteManifest.json';
import pc98Manifest from '../src/ui/Pc98PortraitManifest.json';
import { spritePlacement } from '../src/ui/rebuiltSpritePlacement.js';

const ROOT = path.resolve(__dirname, '..');
const baked = Object.entries(manifest).filter(([, entry]) => !entry.texture);

describe('baked rebuilt sprites', () => {
  it.each(baked)('%s ships as its final tile texture', async (_key, entry) => {
    const file = path.join(ROOT, 'assets/sprites/rebuilt', entry.file);
    expect(fs.existsSync(file)).toBe(true);
    const { width, height } = await sharp(file).metadata();
    const size = spritePlacement(entry.bounds, entry.kind).canvas;
    expect([width, height]).toEqual([size, size]);
    expect(fs.existsSync(path.join(ROOT, 'docs/art/rebuilt-sprite-sources', entry.file))).toBe(
      true,
    );
  });

  it('keeps the full-size sources out of the shipped assets', () => {
    const shipped = fs.readdirSync(path.join(ROOT, 'assets/sprites/rebuilt'));
    const oversized = shipped.filter(
      (name) => fs.statSync(path.join(ROOT, 'assets/sprites/rebuilt', name)).size > 64 * 1024,
    );
    expect(oversized).toEqual([]);
  });
});

describe('rebuilt portraits', () => {
  const dir = path.join(ROOT, 'assets/portraits/rebuilt');
  it.each(fs.readdirSync(dir).filter((name) => name.endsWith('.png')))(
    '%s stays within 512px',
    async (name) => {
      const { width, height } = await sharp(path.join(dir, name)).metadata();
      expect(Math.max(width, height)).toBeLessThanOrEqual(512);
    },
  );
});

// --- traced battlefield sprites (the default art since 2026-09-24) and PC-98 portraits ----
const JUNK = /(_raw|[-_.]bak|backup|\.orig|~)(\.|$)/i;

describe('traced sprite atlas', () => {
  const dir = path.join(ROOT, 'assets/sprites/traced');

  it('ships only the manifest pages, each within a 2048 px texture', async () => {
    const files = fs.readdirSync(dir).sort();
    expect(files).toEqual([...tracedManifest.pages].sort());
    for (const file of files) {
      const { width, height } = await sharp(path.join(dir, file)).metadata();
      expect(Math.max(width, height)).toBeLessThanOrEqual(2048);
    }
  });

  it('decodes to a small budget for the whole roster (no per-sprite canvases)', async () => {
    let bytes = 0;
    for (const file of tracedManifest.pages) {
      const { width, height } = await sharp(path.join(dir, file)).metadata();
      bytes += width * height * 4;
    }
    // every class, faction, lord and boss x six frames: ~25 MB (the rebuilt sources were ~216)
    expect(bytes / 1e6).toBeLessThan(40);
  });

  it('no sprite ships above 3x its display size', () => {
    for (const [key, s] of Object.entries(tracedManifest.sprites)) {
      // 64 world px on the map (the Entity 128), `density` art px per world px
      const display = s.size / tracedManifest.density;
      expect(display, key).toBeLessThanOrEqual(128);
      expect(s.w, key).toBeLessThanOrEqual(display * 3);
      expect(s.h, key).toBeLessThanOrEqual(display * 3);
    }
  });

  it('is traced from references kept out of the shipped assets', async () => {
    const { ROSTER } = await import('../tools/art/sprite-trace/roster.mjs');
    const shipped = Object.values(ROSTER.sources)
      .map((e) => e.src)
      .filter((src) => src.startsWith('assets/'));
    expect(shipped).toEqual([]);
  });
});

describe('PC-98 portraits', () => {
  const dir = path.join(ROOT, 'assets/portraits/pc98');

  it.each(pc98Manifest.sizes.map((size) => [size]))(
    'every %i px figure is rendered at its display size',
    async (size) => {
      const files = fs.readdirSync(path.join(dir, String(size)));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        const { width, height } = await sharp(path.join(dir, String(size), file)).metadata();
        expect([width, height], file).toEqual([size, size]);
      }
    },
  );

  it('the whole set stays a few MB, rendered from sources kept out of assets/', () => {
    let bytes = 0;
    const walk = (d) => {
      for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        if (fs.statSync(p).isDirectory()) walk(p);
        else bytes += fs.statSync(p).size;
      }
    };
    walk(dir);
    expect(bytes / 1e6).toBeLessThan(6);
    const provenance = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
    const rebuilt = Object.values(provenance.portraits).filter((p) => p.kind === 'rebuilt');
    expect(rebuilt.length).toBeGreaterThan(0);
    for (const p of rebuilt) {
      expect(p.source).toMatch(/^docs\/art\/rebuilt-portrait-sources\//);
      expect(fs.existsSync(path.join(ROOT, p.source))).toBe(true);
    }
  });
});

describe('no raw or backup files in the art the game ships', () => {
  // everything under assets/ is copied to public/assets/ and into the app bundle; raw
  // generations, backups and retired sets live under docs/art/
  it.each(['assets/sprites', 'assets/portraits', 'assets/terrain'])('%s', (rel) => {
    const bad = [];
    const walk = (d) => {
      for (const name of fs.readdirSync(d)) {
        const p = path.join(d, name);
        if (fs.statSync(p).isDirectory()) {
          if (/^(backup|backups|raw|old)$/i.test(name)) bad.push(path.relative(ROOT, p));
          else walk(p);
        } else if (JUNK.test(name)) bad.push(path.relative(ROOT, p));
      }
    };
    walk(path.join(ROOT, rel));
    expect(bad).toEqual([]);
  });

  it('ships no retired sprite set', () => {
    expect(fs.readdirSync(path.join(ROOT, 'assets')).filter((d) => /^sprites-v\d/.test(d))).toEqual(
      [],
    );
  });
});

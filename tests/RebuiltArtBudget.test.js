// Mobile texture budget for the rebuilt art. Battle sprites ship pre-rendered
// (tools/bakeRebuiltSprites.mjs) and portraits are capped at 512px
// (tools/shrinkRebuiltPortraits.mjs): at 1254px the two sets decoded to ~410 MB.

import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import manifest from '../src/ui/RebuiltSpriteManifest.json';
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

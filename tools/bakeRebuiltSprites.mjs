#!/usr/bin/env node
/**
 * bakeRebuiltSprites.mjs -- pre-render the rebuilt battle sprites.
 *
 * The rebuilt sources are ~1250px renders, but each one is only ever drawn into
 * a 64x64 (128x128 for entities) tile-centred texture. Decoding all of them at
 * boot cost ~226 MB of texture memory on mobile. This bakes that exact texture
 * offline, with the same nearest-neighbour sampling as the runtime canvas draw
 * (drawImage with imageSmoothingEnabled = false), so the game loads a few KB
 * per sprite instead.
 *
 * Sources:  docs/art/rebuilt-sprite-sources/<file>   (not shipped)
 * Output:   assets/sprites/rebuilt/<file>            (run `npm run sync-assets` after)
 *
 * Manifest entries with `texture` reuse an already-small class texture and stay
 * on the runtime path (RebuiltSprites.prepareRebuiltSprites).
 *
 * Usage: node tools/bakeRebuiltSprites.mjs [--check]
 *   --check  exit non-zero if any baked output is missing or out of date.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { spritePlacement } from '../src/ui/rebuiltSpritePlacement.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'src/ui/RebuiltSpriteManifest.json');
const SOURCE_DIR = path.join(ROOT, 'docs/art/rebuilt-sprite-sources');
const OUT_DIR = path.join(ROOT, 'assets/sprites/rebuilt');
const check = process.argv.includes('--check');

/**
 * Source coordinate for destination pixel `d` along one axis, following the
 * browser's unsmoothed drawImage (Skia): the device-space pixel centre goes
 * through a float32 inverse matrix, then steps in 16.16 fixed point. Matches
 * Chrome's runtime render on 33 of 36 sprites and within 7 pixels overall
 * (Safari samples slightly differently anyway).
 */
function sourceIndex(start, size, destSize, destOffset, d) {
  const f32 = Math.fround;
  const scale = f32(size / destSize);
  const translate = f32(start - f32(destOffset * scale));
  const first = f32(f32((destOffset + 0.5) * scale) + translate);
  return (Math.trunc(first * 65536) + d * Math.trunc(scale * 65536)) >> 16;
}

/** Resample `bounds` of the source into its transparent tile-centred texture. */
export function bakeSprite(source, bounds, kind) {
  const placement = spritePlacement(bounds, kind);
  const size = placement.canvas;
  const out = Buffer.alloc(size * size * 4);
  for (let dy = 0; dy < placement.height; dy++) {
    const sy = sourceIndex(bounds.y, bounds.height, placement.height, placement.y, dy);
    for (let dx = 0; dx < placement.width; dx++) {
      const sx = sourceIndex(bounds.x, bounds.width, placement.width, placement.x, dx);
      const from = (sy * source.width + sx) * 4;
      const to = ((placement.y + dy) * size + placement.x + dx) * 4;
      source.data.copy(out, to, from, from + 4);
    }
  }
  return { data: out, width: size, height: size };
}

async function main() {
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  let stale = 0;
  let written = 0;
  for (const [key, entry] of Object.entries(manifest)) {
    if (entry.texture) continue;
    const sourcePath = path.join(SOURCE_DIR, entry.file);
    if (!fs.existsSync(sourcePath)) throw new Error(`missing source for ${key}: ${sourcePath}`);
    const { data, info } = await sharp(sourcePath)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const baked = bakeSprite({ data, width: info.width }, entry.bounds, entry.kind);
    const png = await sharp(baked.data, {
      raw: { width: baked.width, height: baked.height, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const outPath = path.join(OUT_DIR, entry.file);
    if (check) {
      const current = fs.existsSync(outPath)
        ? await sharp(outPath).ensureAlpha().raw().toBuffer()
        : null;
      if (!current || !current.equals(baked.data)) {
        stale++;
        console.error(`[bake] ${key}: ${current ? 'out of date' : 'missing'}`);
      }
      continue;
    }
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(outPath, png);
    written++;
  }
  if (check) {
    if (stale) {
      console.error(`[bake] ${stale} baked sprite(s) stale; run node tools/bakeRebuiltSprites.mjs`);
      process.exit(1);
    }
    console.log('[bake] rebuilt sprites are up to date.');
  } else console.log(`[bake] wrote ${written} sprites to ${path.relative(ROOT, OUT_DIR)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

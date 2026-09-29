#!/usr/bin/env node
// Reproduce Gaspar's shipped assets with the existing sprite and PC-98 renderers.
import { mkdirSync, readFileSync } from 'node:fs';
import sharp from 'sharp';
import { bakeSprite } from './bakeRebuiltSprites.mjs';
import { readRgba, resample, crop, writePng } from './art/pc98/lib/io.mjs';
import { renderFigure } from './art/pc98/lib/pipeline.mjs';
import { SIZES, tierFor, smoothFor, thumbCrop, faceEllipse, framingInCrop } from './art/pc98/lib/config.mjs';
import { estimateGrid } from './art/pc98/lib/grid.mjs';
import { hashString } from './art/pc98/lib/raster.mjs';

const id = 'special_old_knight';
const source = `docs/art/rebuilt-portrait-sources/${id}.png`;
const src = await readRgba(source);
const framing = JSON.parse(readFileSync('src/ui/ceremonyPortraitFraming.json', 'utf8'))[id];
const native = estimateGrid(src.rgba, src.w, src.h).native;
let master = null;
for (const size of SIZES) {
  const region = thumbCrop(size, framing);
  const px = (value) => Math.round(value * src.w);
  const cropped = region.side < 1 ? crop(src, [px(region.left), px(region.top), src.w - px(region.left) - px(region.side), src.h - px(region.top) - px(region.side)]) : src;
  const rgba = await resample(cropped, size, { sharpen: size <= 64 ? 0.6 : 0 });
  const tier = tierFor(size);
  const figure = renderFigure(rgba, size, {
    ...tier,
    palette: master?.figurePalette || null,
    keepPalette: master?.keepPalette || [],
    smooth: smoothFor(size, native * region.side),
    face: faceEllipse(framingInCrop(framing, region), size),
    seed: hashString(id),
    line: { ...tier.line, silhouetteLine: true },
  });
  master ||= figure;
  mkdirSync(`assets/portraits/pc98/${size}`, { recursive: true });
  await writePng(`assets/portraits/pc98/${size}/${id}.png`, figure);
}
mkdirSync('assets/portraits/rebuilt', { recursive: true });
await sharp(source).resize(512, 512).png().toFile(`assets/portraits/rebuilt/${id}.png`);
const sprites = JSON.parse(readFileSync('src/ui/RebuiltSpriteManifest.json', 'utf8'));
const entry = sprites[id];
const { data, info } = await sharp(`docs/art/rebuilt-sprite-sources/${entry.file}`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const sprite = bakeSprite({ data, width: info.width }, entry.bounds, entry.kind);
mkdirSync('assets/sprites/rebuilt', { recursive: true });
await sharp(sprite.data, { raw: { width: sprite.width, height: sprite.height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(`assets/sprites/rebuilt/${entry.file}`);
console.log('Baked Gaspar portrait sizes and mounted sprite. Run npm run sync-assets.');

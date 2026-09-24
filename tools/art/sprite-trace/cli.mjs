#!/usr/bin/env node
// sprite-trace — reference -> map-sprite tracer (see docs/art-direction/sprites-v2/README.md).
//
//   node tools/art/sprite-trace/cli.mjs recover <png> [--figure i] [--out native.png] [--zoom 1]
//   node tools/art/sprite-trace/cli.mjs trace <png> [--figure i] [--recipe '{json}'] [--density 1.5] [--out sprite.png]
//   node tools/art/sprite-trace/cli.mjs lineup <out.png> [--keys a,b] [--zoom 3] [--density 1.5]
//   node tools/art/sprite-trace/cli.mjs bake [--density 1.5] [--atlas assets/sprites/traced/traced-atlas.png]
//                                             [--manifest src/ui/TracedSpriteManifest.json]
//
// Deterministic: the same references and roster always produce identical bytes.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readRaster, writePng, textRaster } from './lib/io.mjs';
import { splitFigures } from './lib/figures.mjs';
import { recoverFigure, traceNative } from './lib/trace.mjs';
import { render } from './lib/render.mjs';
import { Raster, hstack, vstack } from './lib/raster.mjs';
import { bakeFrames, recruitEntries } from './lib/pipeline.mjs';
import { packAtlas } from './lib/atlas.mjs';
import { BAKE } from './roster.mjs';

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const positional = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')));

async function figureCrop(file) {
  const r = await readRaster(file);
  const fig = flag('figure');
  const box = fig != null ? splitFigures(r, +flag('figures', 3))[+fig] : r.alphaBounds(64);
  return r.crop(box.x, box.y, box.width, box.height);
}

const bg = (im, c = [92, 104, 84, 255]) => new Raster(im.w, im.h).fillRect(0, 0, im.w, im.h, c).draw(im, 0, 0);

if (cmd === 'recover') {
  const res = recoverFigure(await figureCrop(positional[0]));
  console.log(
    JSON.stringify({
      pitch: res.pitch,
      confidence: +res.confidence.toFixed(3),
      mode: res.mode,
      native: [res.native.w, res.native.h],
      purity: res.purity && +res.purity.toFixed(2),
    }),
  );
  if (flag('out')) await writePng(res.native.scale(+flag('zoom', 1)), flag('out'));
} else if (cmd === 'trace') {
  const { native } = recoverFigure(await figureCrop(positional[0]));
  const recipe = JSON.parse(flag('recipe', '{}'));
  const t = traceNative(native, recipe, { density: +flag('density', 1.5) });
  const img = render(t.sprite, { ramps: t.ramps, eye: t.eye });
  console.log(JSON.stringify(t.sprite.meta));
  if (flag('out')) await writePng(img.scale(+flag('zoom', 1)), flag('out'));
} else if (cmd === 'lineup') {
  const Z = +flag('zoom', 3);
  const density = +flag('density', 1.5);
  const keys = flag('keys');
  const entries = keys ? BAKE.filter((e) => keys.split(',').includes(e.key)) : BAKE;
  const tiles = [];
  for (const e of entries) {
    const { still } = await bakeFrames(e, { density });
    const label = await textRaster(e.key, { size: 10, bg: '#18181c', width: still.w * Z });
    tiles.push(vstack([bg(still).scale(Z), label]));
  }
  const rows = [];
  for (let i = 0; i < tiles.length; i += 8) rows.push(hstack(tiles.slice(i, i + 8), 4, [24, 24, 28, 255]));
  await writePng(vstack(rows, 4, [24, 24, 28, 255]), positional[0]);
} else if (cmd === 'bake') {
  const density = +flag('density', 1.5);
  const atlasPath = flag('atlas', 'assets/sprites/traced/traced-atlas.png');
  const manifestPath = flag('manifest', 'src/ui/TracedSpriteManifest.json');
  const entries = [...BAKE];
  for (const r of recruitEntries()) entries.push(r.base, r.promoted);
  const baked = [];
  for (const e of entries) {
    const f = await bakeFrames(e, { density });
    baked.push({ key: e.key, kind: f.sprite.meta.kind, frames: [...f.idle, ...f.attack] });
  }
  const { atlas, manifest } = packAtlas(baked, { density });
  mkdirSync(dirname(atlasPath), { recursive: true });
  await writePng(atlas, atlasPath);
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`baked ${baked.length} sprites (${atlas.w}x${atlas.h}) -> ${atlasPath}, ${manifestPath}`);
} else {
  console.log(
    'usage: cli.mjs recover|trace|lineup|bake ... (see the header of tools/art/sprite-trace/cli.mjs)',
  );
  process.exit(cmd ? 1 : 0);
}

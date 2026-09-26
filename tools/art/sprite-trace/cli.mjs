#!/usr/bin/env node
// sprite-trace — reference -> map-sprite tracer (docs/art-direction/sprites-v2 and sprites-v3).
//
//   node tools/art/sprite-trace/cli.mjs recover <png> [--figure i] [--out native.png] [--zoom 1]
//   node tools/art/sprite-trace/cli.mjs trace <png> [--figure i] [--recipe '{json}'] [--density 1.5] [--out sprite.png]
//   node tools/art/sprite-trace/cli.mjs lineup <out.png> [--keys a,b] [--zoom 3] [--density 1.5]
//   node tools/art/sprite-trace/cli.mjs bake [--density 1.5] [--dir assets/sprites/traced]
//                                             [--manifest src/ui/TracedSpriteManifest.json]
//     writes <dir>/traced-atlas-<page>.png (trimmed idle0..3, windup, strike of every sprite) and
//     the manifest, mirrored into public/<dir> (what the game serves).
//
// Deterministic: the same references and roster always produce identical bytes.
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { readRaster, writePng, textRaster } from './lib/io.mjs';
import { splitFigures } from './lib/figures.mjs';
import { recoverFigure, traceNative } from './lib/trace.mjs';
import { render } from './lib/render.mjs';
import { Raster, hstack, vstack } from './lib/raster.mjs';
import { bakeFrames, allEntries } from './lib/pipeline.mjs';
import { packAtlas } from './lib/atlas.mjs';
import { swapAccumulator, addSwapPair, finishSwap } from './lib/npcswap.mjs';

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = (name, def = null) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const positional = args.filter(
  (a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--')),
);

async function figureCrop(file) {
  const r = await readRaster(file);
  const fig = flag('figure');
  const box = fig != null ? splitFigures(r, +flag('figures', 3))[+fig] : r.alphaBounds(64);
  return r.crop(box.x, box.y, box.width, box.height);
}

const bg = (im, c = [92, 104, 84, 255]) =>
  new Raster(im.w, im.h).fillRect(0, 0, im.w, im.h, c).draw(im, 0, 0);

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
  const BAKE = allEntries();
  const entries = keys ? BAKE.filter((e) => keys.split(',').includes(e.key)) : BAKE;
  const tiles = [];
  for (const e of entries) {
    const { still } = await bakeFrames(e, { density });
    let img = still;
    if (args.includes('--tight')) {
      // crop to the sprite (full height kept so feet stay aligned)
      const b = still.alphaBounds(0);
      img = still.crop(b.x - 2, 0, b.width + 4, still.h);
      const top = Math.max(0, Math.min(...[still.alphaBounds(0).y]) - 2);
      img = img.crop(0, top, img.w, img.h - top);
    }
    const label = await textRaster(e.key, {
      size: 10,
      bg: '#18181c',
      width: Math.max(img.w * Z, 60),
    });
    tiles.push(vstack([bg(img).scale(Z), label]));
  }
  const rows = [];
  const per = +flag('per', 8);
  for (let i = 0; i < tiles.length; i += per)
    rows.push(hstack(tiles.slice(i, i + per), 4, [24, 24, 28, 255]));
  await writePng(vstack(rows, 4, [24, 24, 28, 255]), positional[0]);
} else if (cmd === 'bake') {
  const density = +flag('density', 1.5);
  const dir = flag('dir', 'assets/sprites/traced');
  const manifestPath = flag('manifest', 'src/ui/TracedSpriteManifest.json');
  const entries = allEntries();
  const baked = [];
  // NPC people are derived at runtime from the player frames (lib/npcswap.mjs): learn the
  // colour swap from both renders of every person sprite
  const swap = swapAccumulator();
  for (const e of entries) {
    const f = await bakeFrames(e, { density });
    const frames = [...f.idle, ...f.attack];
    baked.push({ key: e.key, kind: f.sprite.meta.kind, frames, person: e.person });
    if (e.person && e.faction === 'player') {
      const n = await bakeFrames({ ...e, key: `npc_${e.key}`, faction: 'npc' }, { density });
      [...n.idle, ...n.attack].forEach((frame, i) => addSwapPair(swap, frames[i], frame));
    }
  }
  const { table: npcSwap, wrong, pixels } = finishSwap(swap);
  const { pages, manifest } = packAtlas(baked, { density, npcSwap });
  console.log(
    `npc swap: ${npcSwap.length} colours, ${wrong} of ${pixels} person pixels differ from a baked NPC ` +
      `(${((100 * wrong) / Math.max(1, pixels)).toFixed(3)} %)`,
  );
  // the source folder and its public/ mirror (what the dev server and the build serve)
  for (const out of [dir, `public/${dir.replace(/^public\//, '')}`]) {
    mkdirSync(out, { recursive: true });
    // stale pages (and the v1 single atlas) go, so the folder always matches the manifest
    for (const f of readdirSync(out))
      if (/^traced-atlas(-\d+)?\.png$/.test(f) && !manifest.pages.includes(f))
        rmSync(`${out}/${f}`);
    for (const [i, page] of pages.entries()) await writePng(page, `${out}/${manifest.pages[i]}`);
  }
  const prettier = await import('prettier');
  const options = (await prettier.resolveConfig(manifestPath)) || {};
  writeFileSync(
    manifestPath,
    await prettier.format(JSON.stringify(manifest), { ...options, parser: 'json' }),
  );
  const px = pages.reduce((a, p) => a + p.w * p.h, 0);
  console.log(
    `baked ${baked.length} sprites into ${pages.length} page(s) ${pages.map((p) => `${p.w}x${p.h}`).join(', ')} ` +
      `(${((px * 4) / 1048576).toFixed(1)} MB decoded) -> ${dir}, ${manifestPath}`,
  );
} else {
  console.log(
    'usage: cli.mjs recover|trace|lineup|bake ... (see the header of tools/art/sprite-trace/cli.mjs)',
  );
  process.exit(cmd ? 1 : 0);
}

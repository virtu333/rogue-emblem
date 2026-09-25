#!/usr/bin/env node
// Combat FX generator — every combat effect as coherent pixel art in the Ink & Ember
// palette, baked into ONE small atlas. Deterministic (seeded per effect key, no
// network, no Math.random): running it twice produces byte-identical files.
//
//   node tools/art/combat-fx/generate.mjs           write the atlas + tables
//   node tools/art/combat-fx/generate.mjs --check   exit 1 if the committed files are stale
//
// Outputs
//   assets/sprites/fx/fx_atlas.png    palette-indexed PNG (all layers, trimmed, deduped)
//   assets/sprites/fx/fx_atlas.json   Phaser JSON-hash atlas (frames `<key>/<i>`,
//                                     ink layers `<key>~ink/<i>`)
//   src/art/combatFx/fxAnims.json     runtime table: frame counts, hand-tuned per-frame
//                                     durations (ms at Normal speed), anchors, layers
//   public/assets/sprites/fx/*        the served copies of the atlas (kept identical)
//
// Effect families live in lib/families/*; the palette in src/art/combatFx/fxPalette.js.
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { buildAtlas } from './lib/atlas.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = {
  png: join(ROOT, 'assets/sprites/fx/fx_atlas.png'),
  json: join(ROOT, 'assets/sprites/fx/fx_atlas.json'),
  anims: join(ROOT, 'src/art/combatFx/fxAnims.json'),
};

const check = process.argv.includes('--check');
const built = await buildAtlas();
const files = [
  [OUT.png, built.files.png],
  [OUT.json, Buffer.from(built.files.json)],
  [OUT.anims, Buffer.from(built.files.anims)],
  // public/ is committed (tools/syncAssets.js copies assets/ there on build): keep the
  // served copy identical so the dev server never shows a stale atlas.
  [join(ROOT, 'public/assets/sprites/fx/fx_atlas.png'), built.files.png],
  [join(ROOT, 'public/assets/sprites/fx/fx_atlas.json'), Buffer.from(built.files.json)],
];
if (check) {
  const stale = files.filter(([path, buf]) => !existsSync(path) || !readFileSync(path).equals(buf));
  if (stale.length) {
    console.error(`combat-fx: stale ${stale.map(([p]) => p.replace(ROOT + '/', '')).join(', ')}`);
    process.exit(1);
  }
  console.log('combat-fx: up to date');
} else {
  for (const [path, buf] of files) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, buf);
  }
  const s = built.stats;
  console.log(
    `combat-fx: ${Object.keys(built.anims).length} effects, ${s.frames} layer frames ` +
      `(${s.uniqueRects} unique) -> ${s.width}x${s.height} atlas, ` +
      `${(s.decodedBytes / 1024).toFixed(0)} KiB decoded, ${(s.pngBytes / 1024).toFixed(1)} KiB PNG, ${s.colors} colours`,
  );
}

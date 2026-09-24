// Compose capture-game.mjs output into per-map comparison sheets:
//   node tools/art/sprite-trace/dev/compose-ingame.mjs IN_DIR OUT_DIR
// For each map and viewport: DPR 3 rows (rebuilt | traced | traced + device backing) and
// DPR 1 rows (rebuilt | traced), labelled. Lossless WebP.
import { readdirSync, mkdirSync } from 'node:fs';
import { readRaster, writeWebp, textRaster } from '../lib/io.mjs';
import { vstack, hstack } from '../lib/raster.mjs';

const [inDir, outDir] = process.argv.slice(2);
mkdirSync(outDir, { recursive: true });
const files = readdirSync(inDir).filter((f) => f.endsWith('.webp'));
const groups = new Map();
for (const f of files) {
  const m = f.match(/^(.+)_(\d+x\d+)_dpr(\d)_(.+)\.webp$/);
  if (!m) continue;
  const [, map, vp, dpr, variant] = m;
  const k = `${map}_${vp}`;
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push({ f, dpr: +dpr, variant });
}
const ORDER = ['rebuilt', 'traced', 'traced-device'];
const NAMES = {
  rebuilt: 'current rebuilt sprites',
  traced: 'traced sprites (D=1.5), current 480-px canvas',
  'traced-device': 'traced sprites, canvas backing = device pixels (?renderScale=device)',
};
for (const [k, list] of groups) {
  const blocks = [];
  for (const dpr of [3, 1]) {
    const rows = list
      .filter((e) => e.dpr === dpr)
      .sort((a, b) => ORDER.indexOf(a.variant) - ORDER.indexOf(b.variant));
    if (!rows.length) continue;
    const imgs = [];
    for (const e of rows) {
      const img = await readRaster(`${inDir}/${e.f}`);
      const label = await textRaster(`DPR ${dpr} · ${NAMES[e.variant] || e.variant}`, {
        size: 12,
        bg: '#16131e',
        width: img.w,
      });
      imgs.push(vstack([label, img]));
    }
    blocks.push(
      dpr === 3 ? vstack(imgs, 6, [20, 20, 24, 255]) : hstack(imgs, 6, [20, 20, 24, 255]),
    );
  }
  await writeWebp(vstack(blocks, 10, [20, 20, 24, 255]), `${outDir}/${k}.webp`);
  console.log(k);
}

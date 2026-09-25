#!/usr/bin/env node
// Item icon atlases ("Forged in code", docs/art-direction/items/README.md).
//
// Renders every icon in tools/art/icons/lib/catalog.mjs natively at 16, 32 and 48 px,
// packs each size into one palette PNG atlas (16 columns, catalog order) and writes the
// runtime manifest src/ui/itemIconManifest.json (ids -> atlas cell, socket, rim; atlas
// sizes and hashes; the approved painted heroes). Deterministic: same data, same bytes.
//
//   node tools/art/icons/build.mjs          write assets/ + public/assets/ + manifest
//   node tools/art/icons/build.mjs --check  exit 1 if anything on disk is stale
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { renderIcon } from './lib/pixelIcon.mjs';
import { MATERIALS } from './lib/palette.mjs';
import { iconEntries, loadData, SOCKETS, RIMS } from './lib/catalog.mjs';
import { encodeIndexed } from './lib/png.mjs';
import prettier from 'prettier';

export const SIZES = [16, 32, 48];
export const COLUMNS = 16;
export const ATLAS_DIRS = ['assets/ui/items', 'public/assets/ui/items'];
export const MANIFEST = 'src/ui/itemIconManifest.json';
const HERO_SELECTIONS = 'tools/art/icons/hero/selections.json';

const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

/** Pure: render every atlas (RGBA) and the manifest object. */
export function buildAtlases(data = loadData()) {
  const entries = iconEntries(data);
  const seen = new Set();
  for (const e of entries) {
    if (seen.has(e.id)) throw new Error(`duplicate icon id ${e.id}`);
    seen.add(e.id);
    if (!SOCKETS.includes(e.socket)) throw new Error(`${e.id}: unknown socket ${e.socket}`);
    if (!RIMS.includes(e.rim)) throw new Error(`${e.id}: unknown rim ${e.rim}`);
  }
  const rows = Math.ceil(entries.length / COLUMNS);
  const atlases = {};
  for (const size of SIZES) {
    const w = COLUMNS * size;
    const h = rows * size;
    const rgba = new Uint8Array(w * h * 4);
    entries.forEach((e, i) => {
      const icon = renderIcon(e.spec, size, MATERIALS);
      const ox = (i % COLUMNS) * size;
      const oy = Math.floor(i / COLUMNS) * size;
      for (let y = 0; y < size; y++)
        rgba.set(icon.rgba.subarray(y * size * 4, (y + 1) * size * 4), ((oy + y) * w + ox) * 4);
    });
    atlases[size] = { w, h, rgba };
  }
  return { entries, atlases, rows };
}

function readHeroes() {
  if (!fs.existsSync(HERO_SELECTIONS)) return {};
  const sel = JSON.parse(fs.readFileSync(HERO_SELECTIONS, 'utf8'));
  const out = {};
  for (const [id, pick] of Object.entries(sel.items || {})) {
    if (!pick?.approved) continue;
    const file = `hero/${id}.png`;
    const abs = path.join(ATLAS_DIRS[0], file);
    if (!fs.existsSync(abs)) throw new Error(`approved hero ${id} has no ${abs}`);
    out[id] = sha(fs.readFileSync(abs)).slice(0, 8);
  }
  return out;
}

export function buildManifest({ entries, atlases }, pngs, heroes) {
  const icons = {};
  entries.forEach((e, i) => {
    icons[e.id] = [i, SOCKETS.indexOf(e.socket), RIMS.indexOf(e.rim)];
  });
  const atlasInfo = {};
  for (const size of SIZES)
    atlasInfo[size] = {
      file: `atlas-${size}.png`,
      w: atlases[size].w,
      h: atlases[size].h,
      bytes: pngs[size].length,
      hash: sha(pngs[size]).slice(0, 8),
      rgba: sha(atlases[size].rgba),
    };
  return {
    version: 1,
    generator: 'tools/art/icons/build.mjs',
    columns: COLUMNS,
    sizes: SIZES,
    sockets: SOCKETS,
    rims: RIMS,
    atlases: atlasInfo,
    heroSize: 96,
    heroes,
    icons,
  };
}

async function main() {
  const check = process.argv.includes('--check');
  const t0 = Date.now();
  const built = buildAtlases();
  const pngs = {};
  for (const size of SIZES) {
    const a = built.atlases[size];
    pngs[size] = encodeIndexed(a.rgba, a.w, a.h);
  }
  const manifest = buildManifest(built, pngs, readHeroes());
  // Written in the repo's prettier style so format:check stays green.
  const json = await prettier.format(JSON.stringify(manifest), {
    ...(await prettier.resolveConfig(MANIFEST)),
    parser: 'json',
  });
  const stale = [];
  const write = (file, buf) => {
    const same = fs.existsSync(file) && fs.readFileSync(file).equals(Buffer.from(buf));
    if (same) return;
    if (check) stale.push(file);
    else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, buf);
    }
  };
  for (const dir of ATLAS_DIRS)
    for (const size of SIZES) write(path.join(dir, `atlas-${size}.png`), pngs[size]);
  write(MANIFEST, json);
  if (check && stale.length) {
    console.error(
      `stale item icon outputs (run node tools/art/icons/build.mjs):\n  ${stale.join('\n  ')}`,
    );
    process.exit(1);
  }
  console.log(
    `${built.entries.length} icons, ${SIZES.map((s) => `${s}px ${built.atlases[s].w}x${built.atlases[s].h} ${pngs[s].length} B`).join(' · ')}, ${Object.keys(manifest.heroes).length} heroes (${((Date.now() - t0) / 1000).toFixed(1)}s)${check ? ' — up to date' : ''}`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) await main();

#!/usr/bin/env node
/**
 * generate.mjs -- render the hand-authored candidate unit sprites plus review sheets.
 *
 * Outputs (default docs/art/sprite-candidates/):
 *   sprites/<faction>_<key>.png        64x64, drop-in for the rebuilt sprite slot
 *   sprites/<faction>_<key>_idle.png   128x64 two-frame idle strip
 *   manifest.json                      RebuiltSpriteManifest-style entries (scale 1 bounds)
 *   review-terrain.png                 every sprite over every weathered terrain, in-game treatment
 *   review-readability.png             grayscale / silhouette / moved / deuteranopia checks
 *   review-lineup.png                  roster line-up at 1x and 3x
 *   review-palettes.png                standard vs grim palette, on meadow and swamp (2x)
 *   review-vs-current.png              current rebuilt art (top) vs candidates (bottom), 3x
 *   sprites-grim/                      the same sprites with the muted `grim` grade
 *
 * Usage: node tools/sprite-kit/generate.mjs [--out <dir>]
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { SPRITES, BOX, buildSprite } from './classes.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const argOut = process.argv.indexOf('--out');
const OUT = path.resolve(
  argOut > 0 ? process.argv[argOut + 1] : path.join(ROOT, 'docs/art/sprite-candidates'),
);
const FACTION_RAMP = { player: 'azure', enemy: 'crimson' };
// `grim` mutes everything but the faction cloth: a darker world read that keeps the side marker loud.
const PALETTES = {
  standard: null,
  grim: { sat: 0.6, val: 0.84, keep: ['faction', 'glow', 'eye'] },
};
const RING = { player: [0x33, 0x66, 0xcc], enemy: [0xcc, 0x33, 0x33] };

// ---- tiny RGBA image helpers ---------------------------------------------

class Img {
  constructor(w, h, fill = [0, 0, 0, 0]) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) this.d.set(fill, i * 4);
  }
  static from(w, h, data) {
    const img = new Img(w, h);
    img.d.set(data);
    return img;
  }
  // Alpha-over composite of `src` at (x, y).
  draw(src, x, y, alphaMul = 1) {
    for (let sy = 0; sy < src.h; sy++)
      for (let sx = 0; sx < src.w; sx++) {
        const dx = x + sx;
        const dy = y + sy;
        if (dx < 0 || dy < 0 || dx >= this.w || dy >= this.h) continue;
        const si = (sy * src.w + sx) * 4;
        const a = (src.d[si + 3] / 255) * alphaMul;
        if (!a) continue;
        const di = (dy * this.w + dx) * 4;
        for (let k = 0; k < 3; k++) this.d[di + k] = src.d[si + k] * a + this.d[di + k] * (1 - a);
        this.d[di + 3] = Math.max(this.d[di + 3], a * 255);
      }
    return this;
  }
  map(fn) {
    const out = Img.from(this.w, this.h, this.d);
    for (let i = 0; i < this.w * this.h; i++) {
      const px = fn([...out.d.subarray(i * 4, i * 4 + 4)]);
      out.d.set(px, i * 4);
    }
    return out;
  }
  fillRect(x, y, w, h, c) {
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++)
        if (xx >= 0 && yy >= 0 && xx < this.w && yy < this.h) this.d.set(c, (yy * this.w + xx) * 4);
  }
  scale(n) {
    const out = new Img(this.w * n, this.h * n);
    for (let y = 0; y < out.h; y++)
      for (let x = 0; x < out.w; x++) {
        const si = (Math.floor(y / n) * this.w + Math.floor(x / n)) * 4;
        out.d.set(this.d.subarray(si, si + 4), (y * out.w + x) * 4);
      }
    return out;
  }
  png(file) {
    return sharp(Buffer.from(this.d.buffer), {
      raw: { width: this.w, height: this.h, channels: 4 },
    })
      .png({ compressionLevel: 9 })
      .toFile(file);
  }
}

// Mirrors BattleContrast.contrastSpriteKey: a 1px dark halo behind the sprite.
function withContrastHalo(sprite) {
  const out = new Img(sprite.w, sprite.h);
  const halo = sprite.map(([, , , a]) => (a ? [24, 34, 35, 209] : [0, 0, 0, 0]));
  for (const [dx, dy] of [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
  ])
    out.draw(halo, dx, dy);
  return out.draw(sprite, 0, 0);
}

// Mirrors BattleScene's faction ring: 24x12 ellipse, 2px stroke, 70% alpha, 6px below tile centre.
function ring(img, cx, cy, rgb) {
  for (let y = -7; y <= 7; y++)
    for (let x = -13; x <= 13; x++) {
      const r = (x / 12) ** 2 + (y / 6) ** 2;
      const inner = (x / 10) ** 2 + (y / 4) ** 2;
      if (r <= 1 && inner > 1) {
        const i = ((cy + y) * img.w + cx + x) * 4;
        for (let k = 0; k < 3; k++) img.d[i + k] = rgb[k] * 0.7 + img.d[i + k] * 0.3;
      }
    }
}

const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const gray = ([r, g, b, a]) => {
  const l = luma([r, g, b]);
  return [l, l, l, a];
};
// Machado et al. 2009 deuteranopia (severity 1.0).
const deutan = ([r, g, b, a]) => [
  0.367 * r + 0.861 * g - 0.228 * b,
  0.28 * r + 0.673 * g + 0.047 * b,
  -0.012 * r + 0.043 * g + 0.969 * b,
  a,
];
// BattleScene greys out units that have acted; approximate with desaturate + dim.
const moved = ([r, g, b, a]) => {
  const l = luma([r, g, b]) * 0.75;
  return [l, l, l * 1.05, a];
};

// ---- terrain --------------------------------------------------------------

async function loadCell(file, cols, rows, index) {
  const meta = await sharp(file).metadata();
  const w = Math.floor(meta.width / cols);
  const h = Math.floor(meta.height / rows);
  const { data } = await sharp(file)
    .extract({ left: (index % cols) * w, top: Math.floor(index / cols) * h, width: w, height: h })
    .resize(32, 32, { kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return Img.from(32, 32, data);
}

async function loadTerrains() {
  const dir = path.join(ROOT, 'public/assets/terrain/weathered');
  const meadow = path.join(dir, 'meadow-weathered.png');
  const hazards = path.join(dir, 'hazards-weathered.png');
  const plain = await loadCell(meadow, 4, 4, 0);
  const cell = async (file, c, r, i) => {
    const t = await loadCell(file, c, r, i);
    // Feature tiles (trees, peaks) sit on grass in-game.
    return Img.from(32, 32, plain.d).draw(t, 0, 0);
  };
  return [
    ['Plain', plain],
    ['Forest', await cell(meadow, 4, 4, 2)],
    ['Mountain', await cell(meadow, 4, 4, 3)],
    ['Water', await cell(meadow, 4, 4, 4)],
    ['Swamp', await cell(hazards, 3, 2, 2)],
    ['Bog', await cell(hazards, 3, 2, 3)],
    ['Lava', await cell(hazards, 3, 2, 1)],
    ['Ice', await cell(hazards, 3, 2, 0)],
  ];
}

// A 64x64 in-game cell: centre tile (16..47) plus its neighbours, faction ring, haloed sprite.
function scene(tile, spriteImg, faction, fx = (p) => p) {
  const img = new Img(64, 64, [0, 0, 0, 255]);
  for (let ty = -16; ty < 64; ty += 32)
    for (let tx = -16; tx < 64; tx += 32) img.draw(tile, tx, ty);
  ring(img, 32, 38, RING[faction]);
  img.draw(withContrastHalo(spriteImg.map(fx)), 0, 0);
  return img;
}

// ---- main -----------------------------------------------------------------

async function main() {
  await fs.mkdir(path.join(OUT, 'sprites'), { recursive: true });
  const terrains = await loadTerrains();
  let entries = [];
  const manifest = {};
  const problems = [];

  for (const [palette, grade] of Object.entries(PALETTES)) {
    const dir = palette === 'standard' ? 'sprites' : `sprites-${palette}`;
    await fs.mkdir(path.join(OUT, dir), { recursive: true });
    for (const def of SPRITES) {
      const base = buildSprite(def.cls, 0);
      const bob = buildSprite(def.cls, 1);
      for (const faction of def.factions) {
        const alias = { faction: def.teal ? 'teal' : FACTION_RAMP[faction] };
        const frame0 = Img.from(64, 64, base.render(alias, grade));
        const frame1 = Img.from(64, 64, bob.render(alias, grade));
        const name = `${faction}_${def.key}`;
        await frame0.png(path.join(OUT, dir, `${name}.png`));
        await new Img(128, 64)
          .draw(frame0, 0, 0)
          .draw(frame1, 64, 0)
          .png(path.join(OUT, dir, `${name}_idle.png`));
        entries.push({ name, faction, palette, img: frame0, kind: def.kind });
        if (palette !== 'standard') continue;
        manifest[name] = {
          file: `${name}.png`,
          kind: def.kind,
          bounds: BOX[def.kind],
          source: 'tools/sprite-kit',
        };

        // Guard the layout contract: art outside the placement box would be cropped in-game.
        const bx = BOX[def.kind];
        const outside = [];
        for (const frame of [frame0, frame1])
          for (let y = 0; y < 64; y++)
            for (let x = 0; x < 64; x++)
              if (
                frame.d[(y * 64 + x) * 4 + 3] &&
                (x < bx.x || y < bx.y || x >= bx.x + bx.width || y >= bx.y + bx.height)
              )
                outside.push(`${x},${y}`);
        if (outside.length)
          problems.push(
            `${name}: ${outside.length} px outside the ${def.kind} box (${outside.slice(0, 6).join(' ')})`,
          );
      }
    }
  }
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  }
  await fs.writeFile(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

  const all = entries;
  entries = all.filter((e) => e.palette === 'standard');
  const S = 3;
  const label = 0; // sheets are unlabeled; README lists row/column order

  // Terrain sheet: rows = sprites, columns = terrains.
  const terrainSheet = new Img(64 * terrains.length, 64 * entries.length, [16, 14, 20, 255]);
  entries.forEach((e, r) =>
    terrains.forEach(([, tile], c) =>
      terrainSheet.draw(scene(tile, e.img, e.faction), c * 64, r * 64 + label),
    ),
  );
  await terrainSheet.scale(S).png(path.join(OUT, 'review-terrain.png'));

  // Readability sheet: colour on plain, grayscale on plain and bog, silhouette, moved state, deuteranopia.
  const plain = terrains[0][1];
  const bog = terrains[5][1];
  const silhouette = ([, , , a]) => [16, 14, 20, a];
  const checks = [
    (e) => scene(plain, e.img, e.faction),
    (e) => scene(plain, e.img, e.faction).map(gray),
    (e) => scene(bog, e.img, e.faction).map(gray),
    (e) => scene(new Img(32, 32, [196, 190, 170, 255]), e.img, e.faction, silhouette),
    (e) => scene(plain, e.img, e.faction, moved),
    (e) => scene(plain, e.img, e.faction).map(deutan),
  ];
  const readSheet = new Img(64 * checks.length, 64 * entries.length, [16, 14, 20, 255]);
  entries.forEach((e, r) => checks.forEach((fn, c) => readSheet.draw(fn(e), c * 64, r * 64)));
  await readSheet.scale(S).png(path.join(OUT, 'review-readability.png'));

  // Line-ups: player row over enemy row, enemies aligned under their class.
  const lineupStrip = (palette, tile) => {
    const pool = all.filter((e) => e.palette === palette);
    const players = pool.filter((e) => e.faction === 'player');
    const enemies = players.map((p) =>
      pool.find((e) => e.faction === 'enemy' && e.name.slice(6) === p.name.slice(7)),
    );
    const strip = new Img(players.length * 48 + 16, 2 * 56 + 8, [0, 0, 0, 255]);
    for (let ty = 0; ty < strip.h; ty += 32)
      for (let tx = 0; tx < strip.w; tx += 32) strip.draw(tile, tx, ty);
    [players, enemies].forEach((row, r) =>
      row.forEach((e, c) => {
        if (!e) return;
        const x = c * 48;
        const y = r * 56 - 4;
        ring(strip, x + 32, y + 38, RING[e.faction]);
        strip.draw(withContrastHalo(e.img), x, y);
      }),
    );
    return strip;
  };
  const std = lineupStrip('standard', plain);
  const lineup = new Img(std.w * 3, std.h * 4 + 8, [16, 14, 20, 255]);
  lineup.draw(std, 0, 0).draw(std.scale(3), 0, std.h + 8);
  await lineup.png(path.join(OUT, 'review-lineup.png'));

  // Palette comparison at 2x: standard vs grim, on meadow and on swamp.
  const swamp = terrains[4][1];
  const strips = [
    lineupStrip('standard', plain),
    lineupStrip('grim', plain),
    lineupStrip('standard', swamp),
    lineupStrip('grim', swamp),
  ];
  const cmp = new Img(std.w * 2, strips.length * (std.h * 2 + 6), [16, 14, 20, 255]);
  strips.forEach((st, i) => cmp.draw(st.scale(2), 0, i * (std.h * 2 + 6)));
  await cmp.png(path.join(OUT, 'review-palettes.png'));

  // Current rebuilt art (as RebuiltSprites.prepareRebuiltSprites places it) above the candidates.
  const rebuiltManifest = JSON.parse(
    await fs.readFile(path.join(ROOT, 'src/ui/RebuiltSpriteManifest.json'), 'utf8'),
  );
  const pairs = [
    ['lord_edric', 'player_lord_edric'],
    ['enemy_myrmidon', 'enemy_myrmidon'],
    ['enemy_knight', 'enemy_knight'],
    ['enemy_fighter', 'enemy_fighter'],
    ['enemy_archer', 'enemy_archer'],
    ['enemy_mage', 'enemy_mage'],
    ['enemy_cavalier', 'enemy_cavalier'],
  ];
  const cmpRow = new Img(pairs.length * 64, 128, [0, 0, 0, 255]);
  for (let ty = 0; ty < 128; ty += 32)
    for (let tx = 0; tx < cmpRow.w; tx += 32) cmpRow.draw(plain, tx, ty);
  for (const [i, [oldKey, newKey]] of pairs.entries()) {
    const entry = rebuiltManifest[oldKey];
    const box = entry.bounds;
    const [mw, mh] = entry.kind === 'mounted' ? [46, 40] : [38, 34];
    const k = Math.min(mw / box.width, mh / box.height);
    const w = Math.max(1, Math.round(box.width * k));
    const h = Math.max(1, Math.round(box.height * k));
    const { data } = await sharp(path.join(ROOT, 'assets/sprites/rebuilt', entry.file))
      .extract({ left: box.x, top: box.y, width: box.width, height: box.height })
      .resize(w, h, { kernel: 'nearest' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const old = new Img(64, 64).draw(Img.from(w, h, data), Math.round((64 - w) / 2), 44 - h);
    const faction = newKey.startsWith('enemy') ? 'enemy' : 'player';
    const cand = entries.find((e) => e.name === newKey);
    ring(cmpRow, i * 64 + 32, 38, RING[faction]);
    cmpRow.draw(withContrastHalo(old), i * 64, 0);
    ring(cmpRow, i * 64 + 32, 102, RING[faction]);
    cmpRow.draw(withContrastHalo(cand.img), i * 64, 64);
  }
  await cmpRow.scale(3).png(path.join(OUT, 'review-vs-current.png'));

  console.log(`Wrote ${entries.length} sprites + review sheets to ${path.relative(ROOT, OUT)}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

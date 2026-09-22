#!/usr/bin/env node
/**
 * generate-variants.mjs -- render the grid-authored style directions side by side.
 *
 * Outputs (default docs/art/sprite-candidates/variants/):
 *   <direction>/<faction>_<key>.png   64x64 sprites, same placement contract as generate.mjs
 *   review-directions.png             one row pair per direction, on meadow, 3x
 *   review-directions-1x.png          same at true size (what the player sees)
 *   review-directions-labeled.png     the 3x line-up with direction names and notes
 *   review-directions-closeup.png     6x close-up, one row per direction (player/enemy pairs)
 *   review-directions-checks.png      per sprite: bog, grayscale on bog, silhouette, deuteranopia
 *
 * Usage: node tools/sprite-kit/generate-variants.mjs [--only classic] [--zoom <file>]
 *   (npm run sprites:variants)
 */
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { composeGrid, DEFAULT_ALIAS } from './grid.mjs';
import { BOX } from './classes.mjs';
import classic from './variants/classic.mjs';
import ashen from './variants/ashen.mjs';
import twilight from './variants/twilight.mjs';

const DIRECTIONS = { classic, ashen, twilight };
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const arg = (name) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : null;
};
const OUT = path.join(ROOT, 'docs/art/sprite-candidates/variants');
const FACTION_RAMP = { player: 'azure', enemy: 'crimson' };
const RING = { player: [0x33, 0x66, 0xcc], enemy: [0xcc, 0x33, 0x33] };

const toPng = (data, w, h, file) =>
  sharp(Buffer.from(data.buffer ?? data), { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(file);

async function tile(file, cols, rows, index) {
  const meta = await sharp(file).metadata();
  const w = Math.floor(meta.width / cols);
  const h = Math.floor(meta.height / rows);
  const { data } = await sharp(file)
    .extract({ left: (index % cols) * w, top: Math.floor(index / cols) * h, width: w, height: h })
    .resize(32, 32, { kernel: 'nearest' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return new Uint8ClampedArray(data);
}

class Canvas {
  constructor(w, h, fill = [16, 14, 20, 255]) {
    this.w = w;
    this.h = h;
    this.d = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) this.d.set(fill, i * 4);
  }
  blit(src, sw, sh, x, y, fx = null) {
    for (let sy = 0; sy < sh; sy++)
      for (let sx = 0; sx < sw; sx++) {
        const si = (sy * sw + sx) * 4;
        let px = [src[si], src[si + 1], src[si + 2], src[si + 3]];
        if (!px[3]) continue;
        if (fx) px = fx(px);
        const dx = x + sx;
        const dy = y + sy;
        if (dx < 0 || dy < 0 || dx >= this.w || dy >= this.h) continue;
        const a = px[3] / 255;
        const di = (dy * this.w + dx) * 4;
        for (let k = 0; k < 3; k++) this.d[di + k] = px[k] * a + this.d[di + k] * (1 - a);
        this.d[di + 3] = 255;
      }
  }
  tileFill(t, x0, y0, w, h) {
    for (let y = y0 - 16; y < y0 + h; y += 32)
      for (let x = x0 - 16; x < x0 + w; x += 32) {
        for (let ty = 0; ty < 32; ty++)
          for (let tx = 0; tx < 32; tx++) {
            const dx = x + tx;
            const dy = y + ty;
            if (dx < x0 || dy < y0 || dx >= x0 + w || dy >= y0 + h) continue;
            const si = (ty * 32 + tx) * 4;
            this.d.set(t.subarray(si, si + 4), (dy * this.w + dx) * 4);
          }
      }
  }
  ring(cx, cy, rgb) {
    for (let y = -7; y <= 7; y++)
      for (let x = -13; x <= 13; x++) {
        const r = (x / 12) ** 2 + (y / 6) ** 2;
        const inner = (x / 10) ** 2 + (y / 4) ** 2;
        if (r <= 1 && inner > 1) {
          const i = ((cy + y) * this.w + cx + x) * 4;
          for (let k = 0; k < 3; k++) this.d[i + k] = rgb[k] * 0.7 + this.d[i + k] * 0.3;
        }
      }
  }
  // In-game unit: faction ring + 1px contrast halo (BattleContrast) + sprite.
  unit(sprite, x, y, faction, fx = null) {
    this.ring(x + 32, y + 38, RING[faction]);
    const halo = sprite.map((v, i) => (i % 4 === 3 ? (v ? 209 : 0) : [24, 34, 35][i % 4]));
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ])
      this.blit(halo, 64, 64, x + dx, y + dy);
    this.blit(sprite, 64, 64, x, y, fx);
  }
  scaled(n) {
    const out = new Canvas(this.w * n, this.h * n);
    for (let y = 0; y < out.h; y++)
      for (let x = 0; x < out.w; x++) {
        const si = (Math.floor(y / n) * this.w + Math.floor(x / n)) * 4;
        out.d.set(this.d.subarray(si, si + 4), (y * out.w + x) * 4);
      }
    return out;
  }
  save(file) {
    return toPng(this.d, this.w, this.h, file);
  }
}

const luma = ([r, g, b]) => 0.299 * r + 0.587 * g + 0.114 * b;
const gray = (p) => {
  const l = luma(p);
  return [l, l, l, p[3]];
};
const deutan = ([r, g, b, a]) => [
  0.367 * r + 0.861 * g - 0.228 * b,
  0.28 * r + 0.673 * g + 0.047 * b,
  -0.012 * r + 0.043 * g + 0.969 * b,
  a,
];
const silhouette = ([, , , a]) => [16, 14, 20, a];

function renderSubject(dir, subject, faction) {
  const stamps = typeof subject.stamps === 'function' ? subject.stamps(faction) : subject.stamps;
  const sprite = composeGrid(stamps, originFor(subject));
  const alias = {
    ...DEFAULT_ALIAS,
    ...(dir.alias ?? {}),
    faction: FACTION_RAMP[faction],
    ...(subject.alias ?? {}),
  };
  return sprite.render(alias, dir.grade ?? null, dir.rim ?? null);
}

function originFor(subject) {
  const box = BOX[subject.kind ?? 'infantry'];
  return [box.x, box.y];
}

async function main() {
  const only = arg('--only');
  const zoom = arg('--zoom') ?? path.join(OUT, 'review-directions-closeup.png');
  const dirs = Object.entries(DIRECTIONS).filter(([k]) => !only || k === only);
  const weathered = path.join(ROOT, 'public/assets/terrain/weathered');
  const plain = await tile(path.join(weathered, 'meadow-weathered.png'), 4, 4, 0);
  const bog = await tile(path.join(weathered, 'hazards-weathered.png'), 3, 2, 3);

  const rows = [];
  for (const [name, dir] of dirs) {
    await fs.mkdir(path.join(OUT, name), { recursive: true });
    const renders = [];
    for (const subject of dir.subjects)
      for (const faction of subject.factions ?? ['player', 'enemy']) {
        const data = renderSubject(dir, subject, faction);
        await toPng(data, 64, 64, path.join(OUT, name, `${faction}_${subject.key}.png`));
        renders.push({ key: subject.key, faction, data });
      }
    rows.push({ name, dir, renders });
  }

  // Line-up: per direction, player row then enemy row, enemies under their class.
  const cols = Math.max(...rows.map((r) => r.dir.subjects.length));
  const cellW = 44;
  const lineup = new Canvas(cols * cellW + 20, rows.length * 116);
  rows.forEach((r, i) => {
    lineup.tileFill(plain, 0, i * 116, lineup.w, 112);
    r.dir.subjects.forEach((subject, c) =>
      ['player', 'enemy'].forEach((faction, fr) => {
        const hit = r.renders.find((x) => x.key === subject.key && x.faction === faction);
        if (hit) lineup.unit(hit.data, c * cellW - 10, i * 116 + fr * 52 - 6, faction);
      }),
    );
  });
  await lineup.save(path.join(OUT, 'review-directions-1x.png'));
  await lineup.scaled(3).save(path.join(OUT, 'review-directions.png'));

  // Labelled version: a caption column beside each direction band (3x art, 1x inset).
  const big = lineup.scaled(3);
  const labelW = 300;
  const bandH = 116 * 3;
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  const wrap = (t, n) =>
    t.split(' ').reduce((lines, w) => {
      const last = lines[lines.length - 1];
      if (last && (last + ' ' + w).length <= n) lines[lines.length - 1] = last + ' ' + w;
      else lines.push(w);
      return lines;
    }, []);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${labelW}" height="${big.h}">
    <rect width="100%" height="100%" fill="#16141c"/>
    ${rows
      .map((r, i) => {
        const y = i * bandH + 44;
        const note = wrap(r.dir.note, 30)
          .map(
            (l, j) =>
              `<text x="20" y="${y + 40 + j * 22}" font-size="16" fill="#b8b2a8" font-family="DejaVu Sans, sans-serif">${esc(l)}</text>`,
          )
          .join('');
        return `<text x="20" y="${y}" font-size="24" font-weight="bold" fill="#efe8da" font-family="DejaVu Sans, sans-serif">${esc(r.dir.label)}</text>${note}
          <text x="20" y="${y + 250}" font-size="13" fill="#8a847a" font-family="DejaVu Sans, sans-serif">top: player · bottom: enemy</text>`;
      })
      .join('')}
  </svg>`;
  await sharp({
    create: { width: labelW + big.w, height: big.h, channels: 4, background: '#16141c' },
  })
    .composite([
      { input: Buffer.from(svg), left: 0, top: 0 },
      {
        input: Buffer.from(big.d.buffer),
        raw: { width: big.w, height: big.h, channels: 4 },
        left: labelW,
        top: 0,
      },
    ])
    .png()
    .toFile(path.join(OUT, 'review-directions-labeled.png'));

  // Checks: bog colour, bog grayscale, silhouette, deuteranopia on meadow.
  const all = rows.flatMap((r) => r.renders);
  const checks = new Canvas(4 * 64, all.length * 64);
  all.forEach((u, i) => {
    const y = i * 64;
    checks.tileFill(bog, 0, y, 64, 64);
    checks.unit(u.data, 0, y, u.faction);
    checks.tileFill(bog, 64, y, 64, 64);
    checks.unit(u.data, 64, y, u.faction);
    for (let py = y; py < y + 64; py++)
      for (let px = 64; px < 128; px++) {
        const k = (py * checks.w + px) * 4;
        checks.d.set(gray([...checks.d.subarray(k, k + 4)]), k);
      }
    checks.tileFill(
      new Uint8ClampedArray(32 * 32 * 4).map((_, j) => [196, 190, 170, 255][j % 4]),
      128,
      y,
      64,
      64,
    );
    checks.blit(u.data, 64, 64, 128, y, silhouette);
    checks.tileFill(plain, 192, y, 64, 64);
    checks.unit(u.data, 192, y, u.faction);
    for (let py = y; py < y + 64; py++)
      for (let px = 192; px < 256; px++) {
        const k = (py * checks.w + px) * 4;
        checks.d.set(deutan([...checks.d.subarray(k, k + 4)]), k);
      }
  });
  await checks.scaled(3).save(path.join(OUT, 'review-directions-checks.png'));

  if (zoom) {
    // Tight crop around the art boxes so detail survives downscaled previews.
    const [cx, cy, cw, ch] = [8, 2, 48, 44];
    const per = 7;
    const z = new Canvas(
      Math.min(all.length, per) * cw,
      Math.ceil(all.length / per) * ch,
      [120, 125, 90, 255],
    );
    all.forEach((u, i) => {
      const crop = new Uint8ClampedArray(cw * ch * 4);
      for (let y = 0; y < ch; y++)
        crop.set(
          u.data.subarray(((cy + y) * 64 + cx) * 4, ((cy + y) * 64 + cx + cw) * 4),
          y * cw * 4,
        );
      z.blit(crop, cw, ch, (i % per) * cw, Math.floor(i / per) * ch);
    });
    await z.scaled(6).save(zoom);
  }
  console.log(`Rendered ${all.length} sprites across ${rows.length} directions`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

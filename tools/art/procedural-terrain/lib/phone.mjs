// Phone-scale preview: crop 16x10 cells, resample to exactly 34px per cell,
// and stage real unit sprites + the game's faction rings / HP bars (and
// optionally the movement / danger overlays) on top so readability can be
// judged the way a player sees it.
//
// Geometry mirrors BattleScene.addUnitGraphic + BattlefieldLab on mobile:
//   ring    : ellipse 24x12 world px (tile = 32), centre 6px below tile centre,
//             2px stroke at 0.7 alpha, #3366cc player / #cc3333 enemy
//   sprite  : 48px texture, scaled so height = 1.15 tiles, centred on the tile
//   hp bar  : (tile-6) x 3 px, centred at tile centre + (tile/2 - 4)
//   move    : Grid.showMovementRange  (TILE-1)^2 rect, #3366cc @ 0.4
//   danger  : DangerZoneOverlay       (TILE-1)^2 rect, #e8a44a @ 0.18/0.3/0.42
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import {
  crop,
  resampleArea,
  strokeEllipse,
  blit,
  readRgba,
  fillRect,
  fillRectAlpha,
} from './image.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
export const PHONE_CELL = 34;
export const PHONE_COLS = 16;
export const PHONE_ROWS = 10;

const PLAYER_SPRITES = [
  'lordedric',
  'sera',
  'cavalier',
  'archer',
  'knight',
  'cleric',
  'mage',
  'myrmidon',
];

const spriteCache = new Map();
export async function loadSprite(path, size) {
  const k = `${path}@${size}`;
  if (spriteCache.has(k)) return spriteCache.get(k);
  const { data, w, h } = await readRgba(path);
  // Premultiply before area-averaging so transparent edges do not go dark.
  const pre = Buffer.from(data);
  for (let i = 0; i < w * h; i++) {
    const a = pre[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) pre[i * 4 + c] = Math.round(pre[i * 4 + c] * a);
  }
  const W = Math.round((w * size) / h),
    H = size;
  const scaled = resampleArea(pre, w, h, W, H);
  for (let i = 0; i < W * H; i++) {
    const a = scaled[i * 4 + 3] / 255;
    if (a > 0)
      for (let c = 0; c < 3; c++)
        scaled[i * 4 + c] = Math.min(255, Math.round(scaled[i * 4 + c] / a));
  }
  const out = { data: scaled, w: W, h: H };
  spriteCache.set(k, out);
  return out;
}

function enemySpritePath(className) {
  const key = (className || 'fighter').toLowerCase().replace(/ /g, '_');
  const p = join(ROOT, 'assets/sprites/enemies', `${key}.png`);
  return existsSync(p) ? p : join(ROOT, 'assets/sprites/enemies/fighter.png');
}

export function playerSpritePath(k) {
  return join(
    ROOT,
    'assets/sprites/characters',
    `${PLAYER_SPRITES[k % PLAYER_SPRITES.length]}.png`,
  );
}

/** Pick the units staged in the phone crop from the generated spawns. */
export function stageUnits(map, c0, r0) {
  const inCrop = (u) =>
    u.col >= c0 && u.col < c0 + PHONE_COLS && u.row >= r0 && u.row < r0 + PHONE_ROWS;
  const players = map.playerSpawns
    .filter(inCrop)
    .slice(0, 4)
    .map((u, k) => ({ ...u, faction: 'player', sprite: playerSpritePath(k) }));
  const enemies = map.enemySpawns
    .filter(inCrop)
    .slice(0, 5)
    .map((u) => ({ ...u, faction: 'enemy', sprite: enemySpritePath(u.className) }));
  return [...players, ...enemies];
}

export function clampCrop(cols, rows, [c0, r0]) {
  return [
    Math.max(0, Math.min(cols - PHONE_COLS, c0)),
    Math.max(0, Math.min(rows - PHONE_ROWS, r0)),
  ];
}

/** Crop + exact area resample of a 48px/cell full-map render to 34px/cell. */
export function phoneGround(rgba48, cols, rows, cropAt, { cellPx = 48 } = {}) {
  const [c0, r0] = clampCrop(cols, rows, cropAt);
  const cw = Math.min(PHONE_COLS, cols),
    ch = Math.min(PHONE_ROWS, rows);
  const cut = crop(
    rgba48,
    cols * cellPx,
    rows * cellPx,
    c0 * cellPx,
    r0 * cellPx,
    cw * cellPx,
    ch * cellPx,
  );
  const W = cw * PHONE_CELL,
    H = ch * PHONE_CELL;
  return { data: resampleArea(cut, cw * cellPx, ch * cellPx, W, H), w: W, h: H, origin: [c0, r0] };
}

/** Manhattan reach (ignores terrain costs; for overlay review only). */
export function diamond(col, row, reach, cols, rows) {
  const out = [];
  for (let r = row - reach; r <= row + reach; r++)
    for (let c = col - reach; c <= col + reach; c++)
      if (
        c >= 0 &&
        r >= 0 &&
        c < cols &&
        r < rows &&
        Math.abs(c - col) + Math.abs(r - row) <= reach
      )
        out.push({ col: c, row: r });
  return out;
}

/** Game-style overlays: movement (blue) and stacked danger (amber). */
export function drawOverlays(img, [c0, r0], { move = [], danger = [] } = {}) {
  const T = PHONE_CELL,
    k = T / 32;
  const inset = (T - (32 - 1) * k) / 2;
  const count = new Map();
  for (const { col, row } of danger)
    count.set(`${col},${row}`, (count.get(`${col},${row}`) || 0) + 1);
  for (const [key, n] of count) {
    const [col, row] = key.split(',').map(Number);
    const a = n >= 3 ? 0.42 : n === 2 ? 0.3 : 0.18;
    fillRectAlpha(
      img.data,
      img.w,
      img.h,
      (col - c0) * T + inset,
      (row - r0) * T + inset,
      31 * k,
      31 * k,
      [0xe8, 0xa4, 0x4a],
      a,
    );
  }
  for (const { col, row } of move)
    fillRectAlpha(
      img.data,
      img.w,
      img.h,
      (col - c0) * T + inset,
      (row - r0) * T + inset,
      31 * k,
      31 * k,
      [0x33, 0x66, 0xcc],
      0.4,
    );
}

/**
 * Stage rings, sprites and HP bars on a phone image in place.
 * Returns an alpha mask (Float32Array, w*h) of the sprite pixels, for metrics.
 */
export async function drawUnits(img, [c0, r0], units, { rings = true, bars = true } = {}) {
  const { w: W, h: H } = img;
  const T = PHONE_CELL,
    k = T / 32;
  const mask = new Float32Array(W * H);
  const ordered = [...units].sort((a, b) => a.row - b.row);
  if (rings)
    for (const u of ordered) {
      const cx = (u.col - c0 + 0.5) * T,
        cy = (u.row - r0 + 0.5) * T;
      const rgb = u.faction === 'player' ? [0x33, 0x66, 0xcc] : [0xcc, 0x33, 0x33];
      strokeEllipse(img.data, W, H, cx, cy + 6 * k, 12 * k, 6 * k, 2 * k, rgb, 0.7);
    }
  for (const u of ordered) {
    const cx = (u.col - c0 + 0.5) * T,
      cy = (u.row - r0 + 0.5) * T;
    const spr = await loadSprite(u.sprite, Math.round(1.15 * T));
    const x = Math.round(cx - spr.w / 2),
      y = Math.round(cy - spr.h / 2);
    blit(img.data, W, H, spr.data, spr.w, spr.h, x, y);
    for (let j = 0; j < spr.h; j++)
      for (let i = 0; i < spr.w; i++) {
        const X = x + i,
          Y = y + j;
        if (X < 0 || Y < 0 || X >= W || Y >= H) continue;
        mask[Y * W + X] = Math.max(mask[Y * W + X], spr.data[(j * spr.w + i) * 4 + 3] / 255);
      }
    if (!bars) continue;
    const bw = Math.round(26 * k),
      bh = Math.max(2, Math.round(3 * k));
    const bx = Math.round(cx - bw / 2),
      by = Math.round(cy + 12 * k - bh / 2);
    const col = u.faction === 'player' ? [0x33, 0x66, 0xcc] : [0xcc, 0x33, 0x33];
    fillRect(
      img.data,
      W,
      H,
      bx,
      by,
      bw,
      bh,
      col.map((v) => Math.round(v * 0.3)),
    );
    fillRect(
      img.data,
      W,
      H,
      bx,
      by,
      Math.round(bw * 0.8),
      bh,
      u.faction === 'enemy' ? [0xcc, 0x44, 0x44] : [0x44, 0xcc, 0x44],
    );
  }
  return mask;
}

/** Full phone view: ground + optional overlays + units. */
export async function phoneView(rgba48, cols, rows, cropAt, units, opts = {}) {
  const img = phoneGround(rgba48, cols, rows, cropAt, opts);
  if (opts.overlays) drawOverlays(img, img.origin, opts.overlays);
  const mask = await drawUnits(img, img.origin, units, opts);
  return { ...img, mask };
}

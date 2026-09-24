// Phone-scale preview: crop 16x10 cells, resample to exactly 34px per cell,
// and stage real unit sprites + the game's faction rings / HP bars on top so
// readability can be judged the way a player sees it.
//
// Geometry mirrors BattleScene.addUnitGraphic + BattlefieldLab on mobile:
//   ring   : ellipse 24x12 world px (tile = 32), centre 6px below tile centre,
//            2px stroke at 0.7 alpha, #3366cc player / #cc3333 enemy
//   sprite : 48px texture, scaled so height = 1.15 tiles, centred on the tile
//   hp bar : (tile-6) x 3 px, centred at tile centre + (tile/2 - 4)
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';
import { crop, resampleArea, strokeEllipse, blit, readRgba, fillRect } from './image.mjs';

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
async function loadSprite(path, size) {
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

/** Pick the units staged in the phone crop from the generated spawns. */
export function stageUnits(map, c0, r0) {
  const inCrop = (u) =>
    u.col >= c0 && u.col < c0 + PHONE_COLS && u.row >= r0 && u.row < r0 + PHONE_ROWS;
  const players = map.playerSpawns
    .filter(inCrop)
    .slice(0, 4)
    .map((u, k) => ({
      ...u,
      faction: 'player',
      sprite: join(
        ROOT,
        'assets/sprites/characters',
        `${PLAYER_SPRITES[k % PLAYER_SPRITES.length]}.png`,
      ),
    }));
  const enemies = map.enemySpawns
    .filter(inCrop)
    .slice(0, 5)
    .map((u) => ({ ...u, faction: 'enemy', sprite: enemySpritePath(u.className) }));
  return [...players, ...enemies];
}

/**
 * @param rgba48  full-map render at 48px per cell
 * @param mode    'area' (default) or 'nearest'
 */
export async function phoneView(rgba48, cols, rows, [c0, r0], units, { mode = 'area' } = {}) {
  c0 = Math.max(0, Math.min(cols - PHONE_COLS, c0));
  r0 = Math.max(0, Math.min(rows - PHONE_ROWS, r0));
  const cw = Math.min(PHONE_COLS, cols),
    ch = Math.min(PHONE_ROWS, rows);
  const cut = crop(rgba48, cols * 48, rows * 48, c0 * 48, r0 * 48, cw * 48, ch * 48);
  const W = cw * PHONE_CELL,
    H = ch * PHONE_CELL;
  let img;
  if (mode === 'nearest') {
    const { resampleNearest } = await import('./image.mjs');
    img = resampleNearest(cut, cw * 48, ch * 48, W, H);
  } else img = resampleArea(cut, cw * 48, ch * 48, W, H);
  const T = PHONE_CELL,
    k = T / 32;
  const ordered = [...units].sort((a, b) => a.row - b.row);
  for (const u of ordered) {
    const cx = (u.col - c0 + 0.5) * T,
      cy = (u.row - r0 + 0.5) * T;
    const rgb = u.faction === 'player' ? [0x33, 0x66, 0xcc] : [0xcc, 0x33, 0x33];
    strokeEllipse(img, W, H, cx, cy + 6 * k, 12 * k, 6 * k, 2 * k, rgb, 0.7);
  }
  for (const u of ordered) {
    const cx = (u.col - c0 + 0.5) * T,
      cy = (u.row - r0 + 0.5) * T;
    const spr = await loadSprite(u.sprite, Math.round(1.15 * T));
    blit(img, W, H, spr.data, spr.w, spr.h, Math.round(cx - spr.w / 2), Math.round(cy - spr.h / 2));
    const bw = Math.round(26 * k),
      bh = Math.max(2, Math.round(3 * k));
    const bx = Math.round(cx - bw / 2),
      by = Math.round(cy + 12 * k - bh / 2);
    const col = u.faction === 'player' ? [0x33, 0x66, 0xcc] : [0xcc, 0x33, 0x33];
    fillRect(
      img,
      W,
      H,
      bx,
      by,
      bw,
      bh,
      col.map((v) => Math.round(v * 0.3)),
    );
    fillRect(
      img,
      W,
      H,
      bx,
      by,
      Math.round(bw * 0.8),
      bh,
      u.faction === 'enemy' ? [0xcc, 0x44, 0x44] : [0x44, 0xcc, 0x44],
    );
  }
  return { data: img, w: W, h: H, origin: [c0, r0] };
}

// Load the game's current rebuilt sprites exactly as RebuiltSprites.prepareRebuiltSprites
// builds their 64x64 textures (crop to manifest bounds, nearest-neighbour fit into
// spritePlacement's box, feet on y=44). Read-only use of game assets.
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Img } from './image.mjs';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'src/ui/RebuiltSpriteManifest.json'), 'utf8'));

// Mirrors src/ui/RebuiltSprites.js spritePlacement().
export function spritePlacement(bounds, kind = 'infantry') {
  const canvas = kind === 'entity' ? 128 : 64;
  const maxWidth = kind === 'entity' ? 94 : kind === 'flyer' ? 40 : kind === 'mounted' ? 46 : 38;
  const maxHeight =
    kind === 'entity'
      ? 90
      : kind === 'mage'
        ? 30
        : kind === 'heavy'
          ? 36
          : kind === 'mounted'
            ? 40
            : 34;
  const scale = Math.min(maxWidth / bounds.width, maxHeight / bounds.height);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const footY = kind === 'entity' ? 106 : 44;
  return { canvas, x: Math.round((canvas - width) / 2), y: footY - height, width, height };
}

export async function loadRebuilt(key) {
  const e = manifest[key];
  if (!e) throw new Error(`no rebuilt sprite ${key}`);
  const file = e.file
    ? join(ROOT, 'assets/sprites/rebuilt', e.file)
    : join(ROOT, 'assets/sprites', e.source);
  const src = await Img.read(file);
  const b = e.bounds;
  const p = spritePlacement(b, e.kind);
  const tex = new Img(p.canvas, p.canvas);
  tex.draw(src.crop(b.x, b.y, b.width, b.height).resizeNearest(p.width, p.height), p.x, p.y);
  return tex;
}

export const REBUILT_KEYS = Object.keys(manifest);

// Legacy 48px class sprite as BattleScene shows it with the battlefield lab on:
// 48px texture, scaled so its height is 1.15 tiles (36.8 world px), centred on
// the tile. Returned as an equivalent 64px world-px texture.
export async function loadLegacy(file) {
  const src = await Img.read(file);
  const s = 36.8 / src.h;
  const w = Math.round(src.w * s),
    h = Math.round(src.h * s);
  const tex = new Img(64, 64);
  tex.draw(src.resizeNearest(w, h), Math.round(32 - w / 2), Math.round(32 - h / 2));
  return tex;
}

// What the game draws today for a unit of this class/faction (phone, lab on).
export async function loadCurrent(cls, faction) {
  if (cls.startsWith('lord_')) return { tex: await loadRebuilt(cls), source: `rebuilt ${cls}` };
  if (faction !== 'player' && manifest[`enemy_${cls}`])
    return { tex: await loadRebuilt(`enemy_${cls}`), source: `rebuilt enemy_${cls}` };
  if (faction === 'player' && manifest[cls])
    return { tex: await loadRebuilt(cls), source: `rebuilt-slot ${cls}` };
  const dir = faction === 'player' ? 'characters' : 'enemies';
  return {
    tex: await loadLegacy(join(ROOT, 'assets/sprites', dir, `${cls}.png`)),
    source: `legacy ${dir}/${cls}`,
  };
}

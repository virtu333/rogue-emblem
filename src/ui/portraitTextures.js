// Lazy canvas textures for portrait variants (docs/mobile-memory-budget.md).
//
// The boot atlases hold one default face per class; the extra faces never
// load up front. When the canvas needs a variant (the desktop battle
// forecast, headless fallbacks) its figure and faction plate are fetched at
// the display size and composited into a size x size canvas texture
// (`pc98v-<size>-<id>`, 40 px = 6.4 KB), exactly like an atlas frame. The
// textures are capped (least recently used go first) and a battle releases
// its enemies' faces when the scene shuts down, so more faces never grow
// texture memory. DOM portraits are plain <img> figures the browser decodes
// and frees on its own.
import {
  isVariantPortrait,
  pc98FigureUrl,
  pc98PlateUrl,
  portraitIdForUnit,
  setVariantTextureLoader,
  usePc98,
  variantTextureKey,
  PC98_MANIFEST,
} from './portraitArt.js';

export const VARIANT_TEXTURE_CAP = 96;
const PREFIX = 'pc98v-';
const pending = new Map(); // texture key -> Promise<boolean>
const lastUse = new Map(); // texture key -> use counter (LRU)
let tick = 0;

function loadImage(url) {
  return new Promise((resolve, reject) => {
    if (typeof Image === 'undefined') return reject(new Error('no Image'));
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`portrait failed: ${url}`));
    img.src = url;
  });
}

/** Variant texture keys currently in a texture manager. */
export function variantTextureKeys(textures) {
  return (textures?.getTextureKeys?.() || []).filter((k) => k.startsWith(PREFIX));
}

/** Parse `pc98v-<size>-<id>`. */
export function parseVariantTextureKey(key) {
  const m = /^pc98v-(\d+)-(.+)$/.exec(String(key));
  return m ? { size: Number(m[1]), id: m[2] } : null;
}

function evict(textures, keep) {
  const keys = variantTextureKeys(textures);
  if (keys.length <= VARIANT_TEXTURE_CAP) return;
  keys
    .filter((k) => k !== keep)
    .sort((a, b) => (lastUse.get(a) || 0) - (lastUse.get(b) || 0))
    .slice(0, keys.length - VARIANT_TEXTURE_CAP)
    .forEach((k) => {
      textures.remove(k);
      lastUse.delete(k);
    });
}

/**
 * Load one variant face into the texture manager (idempotent; concurrent
 * requests share one load). Resolves true when the texture exists.
 */
export function loadVariantTexture(scene, id, size) {
  const textures = scene?.textures;
  if (!textures || !isVariantPortrait(id)) return Promise.resolve(false);
  const key = variantTextureKey(id, size);
  lastUse.set(key, ++tick);
  if (textures.exists(key)) return Promise.resolve(true);
  if (pending.has(key)) return pending.get(key);
  const faction = PC98_MANIFEST.portraits[id]?.faction || 'steel';
  const job = Promise.all([
    loadImage(pc98PlateUrl(faction, size)),
    loadImage(pc98FigureUrl(id, size)),
  ])
    .then(([plate, figure]) => {
      if (textures.exists(key)) return true;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(plate, 0, 0);
      ctx.drawImage(figure, 0, 0);
      textures.addCanvas(key, canvas);
      evict(textures, key);
      return true;
    })
    .catch(() => false)
    .finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

/** Warm the canvas faces of units at the given sizes (variants only). */
export function warmUnitPortraits(scene, units, sizes = [40]) {
  if (!usePc98()) return Promise.resolve([]);
  const jobs = [];
  for (const unit of units || []) {
    const id = portraitIdForUnit(unit, scene?.gameData || {});
    if (!isVariantPortrait(id)) continue;
    for (const size of sizes) jobs.push(loadVariantTexture(scene, id, size));
  }
  return Promise.all(jobs);
}

/** Remove variant textures whose face is not in `keepIds`. */
export function releaseVariantTextures(textures, keepIds = new Set()) {
  let removed = 0;
  for (const key of variantTextureKeys(textures)) {
    const parsed = parseVariantTextureKey(key);
    if (parsed && keepIds.has(parsed.id)) continue;
    textures.remove(key);
    lastUse.delete(key);
    removed++;
  }
  return removed;
}

setVariantTextureLoader((scene, id, size) => {
  loadVariantTexture(scene, id, size);
});

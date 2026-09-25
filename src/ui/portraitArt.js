// PC-98 portrait art: the one place that knows which portrait file a unit
// shows and at what size (docs/art-direction/build/portraits-pc98/README.md).
//
// Every portrait id (legacy `portrait_<id>` names and rebuilt ids) has a
// PC-98 render from tools/art/pc98/build.mjs; rebuilt references win when
// both exist. Sizes follow real display sizes so the dither is drawn at an
// integer (1:1 CSS) scale: 192 master (boss bust, cut-in at 2x), 96 dialogue,
// 64/48/40/32 thumbnails rendered from source, not downscaled from the master.
// DOM portraits are a transparent figure over a faction plate (CSS
// background), so one figure serves player, ally and enemy contexts.
// Dev-only escape hatch: ?portraitArt=classic restores the old files.
//
// Portrait variety (src/engine/PortraitVariants.js): generic units wear one of
// several faces for their class, chosen once and stored on the unit;
// `portraitIdForUnit` is the one resolver every surface uses. Variant figures
// are not in the boot atlases: the canvas loads them lazily
// (src/ui/portraitTextures.js).
import manifest from './Pc98PortraitManifest.json';
import rebuiltManifest from './RebuiltPortraitManifest.json';
import { variantPortraitId } from '../engine/PortraitVariants.js';

export const PC98_MANIFEST = manifest;
export const PC98_SIZES = Object.freeze([...manifest.sizes].sort((a, b) => b - a));
export const PC98_MASTER = manifest.masterSize;
export const PC98_ATLAS_SIZES = Object.freeze([...manifest.atlas.sizes]);

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/ /g, '_');

let modeOverride = null;

function devBuild() {
  try {
    return Boolean(import.meta.env?.DEV);
  } catch {
    return false;
  }
}

/**
 * 'pc98' (default) or 'classic'. The query flag is honoured in dev builds
 * only, so production always ships the approved style.
 */
export function portraitArtMode(search = globalThis.location?.search, dev = devBuild()) {
  if (modeOverride) return modeOverride;
  if (dev && search) {
    try {
      if (new URLSearchParams(search).get('portraitArt') === 'classic') return 'classic';
    } catch {
      /* malformed query: default */
    }
  }
  return 'pc98';
}

/** Test/tooling hook: force a mode (null restores the default). */
export function setPortraitArtMode(mode) {
  modeOverride = mode === 'pc98' || mode === 'classic' ? mode : null;
}

export function usePc98() {
  return portraitArtMode() === 'pc98';
}

export function hasPc98(id) {
  return Boolean(id && manifest.portraits[id]);
}

/** A lazily loaded variant face (not in the atlases, no baked texture). */
export function isVariantPortrait(id) {
  return Boolean(id && manifest.portraits[id]?.variant);
}

/** The class default a variant stands in for (`generic_fighter__fighter_d` -> `generic_fighter`). */
export function variantDefaultId(id) {
  const base = String(id || '').split('__')[0];
  return base !== id && hasPc98(base) && !isVariantPortrait(base) ? base : null;
}

/** Portrait id from a texture key (`portrait_<id>` / `rebuilt-portrait-<id>`). */
export function portraitIdFromKey(key) {
  if (!key) return null;
  const id = String(key)
    .replace(/^rebuilt-portrait-/, '')
    .replace(/^portrait_/, '');
  return hasPc98(id) ? id : null;
}

/**
 * Ordered portrait ids for a unit, mirroring the texture resolution the game
 * has always used: approved rebuilt art (boss, promoted lord, lord, player
 * generic), then legacy art (named lord; enemy class, enemy base class;
 * generic class, generic base class).
 */
export function portraitCandidates(unit, gameData = {}) {
  if (!unit) return [];
  const name = normalize(unit.name);
  const out = [];
  const rebuilt = (id) => rebuiltManifest[id] && out.push(id);
  if (unit.isBoss) rebuilt(`boss_${name}`);
  if (unit.isLord || rebuiltManifest[`lord_${name}`]) {
    if (unit.tier === 'promoted') rebuilt(`lord_${name}_promoted`);
    rebuilt(`lord_${name}`);
  }
  const named = gameData.lords?.some((lord) => lord.name === unit.name);
  // Portrait variety: a generic unit's own face comes first.
  if (!named && !unit.isLord && !rebuiltManifest[`lord_${name}`]) {
    const variant = variantPortraitId(unit);
    if (variant && hasPc98(variant)) out.push(variant);
  }
  if (unit.faction !== 'enemy') rebuilt(`generic_${normalize(unit.className)}`);
  if (named) {
    out.push(`lord_${String(unit.name).toLowerCase()}`);
    return out;
  }
  const cls = normalize(unit.className);
  const base = gameData.classes?.find((entry) => entry.name === unit.className)?.promotesFrom;
  const baseNorm = typeof base === 'string' ? normalize(base) : null;
  if (unit.faction === 'enemy') {
    out.push(`enemy_${cls}`);
    if (baseNorm) out.push(`enemy_${baseNorm}`);
  }
  out.push(`generic_${cls}`);
  if (baseNorm) out.push(`generic_${baseNorm}`);
  return out;
}

/** The PC-98 portrait id a unit shows, or null. */
export function portraitIdForUnit(unit, gameData = {}) {
  return portraitCandidates(unit, gameData).find(hasPc98) || null;
}

const CORRUPTED = new Set(['boss_the_entity', 'enemy_entity']);

/**
 * Backdrop faction for a portrait in context: the unit's side wins (a
 * recruited boss stands on the player's plate, an NPC ally on verdigris);
 * without a unit the portrait's own default applies.
 */
export function portraitFaction(unit, id) {
  if (CORRUPTED.has(id)) return 'unlight';
  if (unit?.faction === 'enemy')
    return manifest.portraits[id]?.faction === 'unlight' ? 'unlight' : 'blood';
  if (unit?.faction === 'npc') return 'verdigris';
  if (unit && (unit.isLord || String(id).startsWith('lord_'))) return 'ember';
  if (unit) return 'steel';
  return manifest.portraits[id]?.faction || 'steel';
}

/**
 * The variant for a square displayed at `cssPx` CSS pixels: the largest size
 * that fits (6% tolerance), so a dithered image is drawn at 1:1 or enlarged,
 * never shrunk (shrinking drops pixels on 1x screens and breaks the checker
 * into moire). Falls back to the smallest size.
 */
export function pickPortraitSize(cssPx, sizes = PC98_SIZES) {
  const sorted = [...sizes].sort((a, b) => b - a);
  const px = Number(cssPx);
  if (!Number.isFinite(px) || px <= 0) return sorted[sorted.length - 1];
  return sorted.find((s) => s <= px * 1.06) ?? sorted[sorted.length - 1];
}

function base() {
  try {
    return import.meta.env?.BASE_URL ?? '/';
  } catch {
    return '/';
  }
}

export function pc98FigureUrl(id, size = PC98_MASTER) {
  return `${base()}assets/portraits/pc98/${size}/${id}.png`;
}

export function pc98BakedUrl(id) {
  return `${base()}assets/portraits/pc98/baked/${id}.png`;
}

export function pc98PlateUrl(faction, size) {
  const f = manifest.factions.includes(faction) ? faction : 'steel';
  return `${base()}assets/portraits/pc98/plates/${f}-${size}.png`;
}

export function pc98AtlasUrl(size) {
  return `${base()}assets/portraits/pc98/atlas/${size}.png`;
}

export const pc98AtlasKey = (size) => `pc98-portraits-${size}`;

/** Canvas texture key of a lazily loaded variant face at an atlas size. */
export const variantTextureKey = (id, size) => `pc98v-${size}-${id}`;

// Set by portraitTextures.js (kept out of this module so the resolver stays
// free of loading code and import cycles).
let variantTextureLoader = null;
export function setVariantTextureLoader(loader) {
  variantTextureLoader = typeof loader === 'function' ? loader : null;
}

/** Phaser atlas data (JSON hash) for a canvas atlas: frames named by id. */
export function pc98AtlasData(size) {
  const cols = manifest.atlas.columns;
  // Variants are not in the atlases (they have no frame).
  const ids = Object.keys(manifest.portraits).filter((id) =>
    Number.isInteger(manifest.portraits[id].frame),
  );
  const rows = Math.ceil(ids.length / cols);
  const frames = {};
  for (const id of ids) {
    const i = manifest.portraits[id].frame;
    frames[id] = {
      frame: { x: (i % cols) * size, y: Math.floor(i / cols) * size, w: size, h: size },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: size, h: size },
      sourceSize: { w: size, h: size },
    };
  }
  return { frames, meta: { size: { w: cols * size, h: rows * size }, scale: '1' } };
}

/** Texture URL for a legacy `portrait_<name>` key in the current mode. */
export function legacyPortraitUrl(name, mode = portraitArtMode()) {
  // Relative, like every other BootScene asset path.
  if (mode === 'pc98' && hasPc98(name)) return `assets/portraits/pc98/baked/${name}.png`;
  return `assets/portraits/${name}.png`;
}

/** Texture URL for a rebuilt `rebuilt-portrait-<id>` key in the current mode. */
export function rebuiltPortraitUrl(id, mode = portraitArtMode()) {
  if (mode === 'pc98' && hasPc98(id)) return pc98BakedUrl(id);
  const file = rebuiltManifest[id]?.file;
  return file ? `${base()}assets/portraits/rebuilt/${file}` : null;
}

/**
 * In pc98 mode a legacy key whose id also has rebuilt art shows the same
 * render as the rebuilt key, so it is aliased instead of downloaded twice.
 */
export function legacyKeyAliasesRebuilt(name, mode = portraitArtMode()) {
  return mode === 'pc98' && Boolean(rebuiltManifest[name]) && hasPc98(name);
}

/**
 * Canvas (Phaser) portrait at a display size: the atlas frame rendered for
 * that size when available, else the full texture (classic art).
 * @returns {{key:string, frame?:string}|null}
 */
export function portraitCanvasFrame(scene, key, displayPx) {
  if (!key) return null;
  if (usePc98()) {
    let id = portraitIdFromKey(key);
    const size = pickPortraitSize(displayPx, PC98_ATLAS_SIZES);
    if (isVariantPortrait(id)) {
      // Lazy variant texture; until it lands, the class default stands in.
      const own = variantTextureKey(id, size);
      if (scene?.textures?.exists?.(own)) return { key: own };
      variantTextureLoader?.(scene, id, size);
      id = variantDefaultId(id);
    }
    const atlas = pc98AtlasKey(size);
    if (id && scene?.textures?.exists?.(atlas) && scene.textures.get(atlas).has?.(id))
      return { key: atlas, frame: id };
  }
  return scene?.textures?.exists?.(key) ? { key } : null;
}

/**
 * A DOM portrait: transparent PC-98 figure over its faction plate, drawn
 * pixelated. `sizes` maps extra media queries to sizes (a <picture>), for
 * boxes whose CSS size changes at a breakpoint.
 * @param {{id:string, size:number, faction?:string, className?:string, alt?:string,
 *   plate?:boolean, media?:Array<[string, number]>}} options
 * @returns {HTMLImageElement|HTMLPictureElement}
 */
export function pc98PortraitElement({
  id,
  size,
  faction = portraitFaction(null, id),
  className = '',
  alt = '',
  plate = true,
  media = [],
}) {
  const img = document.createElement('img');
  img.className = `${className} pc98-portrait`.trim();
  img.src = pc98FigureUrl(id, size);
  img.alt = alt;
  img.decoding = 'async';
  img.draggable = false;
  img.dataset.portraitId = id;
  img.dataset.portraitSize = String(size);
  if (plate) {
    img.classList.add('has-plate');
    img.style.setProperty('--pc98-plate', `url("${pc98PlateUrl(faction, size)}")`);
  }
  if (!media.length) return img;
  const picture = document.createElement('picture');
  picture.className = 'pc98-picture';
  img.classList.add('has-media');
  media.forEach(([query, altSize], index) => {
    const source = document.createElement('source');
    source.media = query;
    source.srcset = pc98FigureUrl(id, altSize);
    picture.append(source);
    if (plate)
      img.style.setProperty(
        `--pc98-plate-${index + 1}`,
        `url("${pc98PlateUrl(faction, altSize)}")`,
      );
  });
  picture.append(img);
  return picture;
}

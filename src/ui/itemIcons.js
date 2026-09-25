// Item art at runtime (docs/art-direction/items/README.md).
//
// Every item, scroll, stone, blessing and upgrade has a procedural pixel icon ("Forged in
// code") in one atlas per native size (16/32/48, tools/art/icons/build.mjs). An icon sits
// in a socket whose shape is its category and whose rim is its tier or rarity (the
// plaques of the reliquary). Large item panels show a painted PC-98 hero when one was
// approved, and the pixel icon at 2x otherwise.
//
// The atlases are CSS backgrounds on elements, so the browser downloads and decodes an
// atlas only when an icon of that size is on screen (48 is never touched by list rows).
// Integer scales only: a 64 px icon is the 32 atlas at 2x, 96 px the 48 atlas at 2x.
import manifest from './itemIconManifest.json';
import { resolveItemIconId, baseItemName } from './itemIconIds.js';

export const ITEM_ICON_MANIFEST = manifest;
export const ITEM_ICON_SIZES = Object.freeze([16, 32, 48, 64, 96]);

const has = (id) => Object.prototype.hasOwnProperty.call(manifest.icons, id);

function base() {
  try {
    return import.meta.env?.BASE_URL ?? './';
  } catch {
    return './';
  }
}

function absolute(url) {
  try {
    return new URL(url, globalThis.document?.baseURI || globalThis.location?.href).href;
  } catch {
    return url;
  }
}

export function itemAtlasUrl(size) {
  const info = manifest.atlases[size];
  return absolute(`${base()}assets/ui/items/${info.file}?v=${info.hash}`);
}

export function itemHeroUrl(id) {
  const v = manifest.heroes[id];
  return v ? absolute(`${base()}assets/ui/items/hero/${id}.png?v=${v}`) : null;
}

/** Icon id for an item, reward choice, blessing or upgrade (always resolves). */
export function itemIconId(subject, kind) {
  return resolveItemIconId(subject, has, kind);
}

export function hasItemIcon(id) {
  return has(id);
}

/** { id, cell, socket, rim } for an id (unknown ids fall back to generic-supply). */
export function itemIconMeta(id) {
  const entry = manifest.icons[id] || manifest.icons['generic-supply'];
  return {
    id: has(id) ? id : 'generic-supply',
    cell: entry[0],
    socket: manifest.sockets[entry[1]],
    rim: manifest.rims[entry[2]],
  };
}

/** Native atlas + integer scale for a CSS size (largest native size that divides it). */
export function pickAtlas(cssSize) {
  const px = Math.max(16, Math.round(Number(cssSize) || 32));
  const natives = [...manifest.sizes].sort((a, b) => b - a);
  const exact = natives.find((s) => px % s === 0);
  const native = exact ?? natives.find((s) => s <= px) ?? natives[natives.length - 1];
  return { native, scale: Math.max(1, Math.floor(px / native)) };
}

/** Background style for one atlas cell at a CSS size. Pure (tests read it). */
export function atlasStyle(id, cssSize) {
  const { cell } = itemIconMeta(id);
  const { native, scale } = pickAtlas(cssSize);
  const info = manifest.atlases[native];
  const cols = manifest.columns;
  const x = (cell % cols) * native * scale;
  const y = Math.floor(cell / cols) * native * scale;
  const size = native * scale;
  return {
    native,
    scale,
    size,
    backgroundSize: `${info.w * scale}px ${info.h * scale}px`,
    backgroundPosition: `-${x}px -${y}px`,
  };
}

/** The plaque behind an icon: rim (tier colour) and sunken well, both clipped to the socket shape. */
function socketElement() {
  const s = document.createElement('span');
  s.className = 'ia-socket';
  return s;
}

function glyphElement(id, size) {
  const st = atlasStyle(id, size);
  const glyph = document.createElement('span');
  glyph.className = 'ia-glyph';
  glyph.dataset.atlas = String(st.native);
  glyph.style.width = `${st.size}px`;
  glyph.style.height = `${st.size}px`;
  glyph.style.backgroundImage = `url("${itemAtlasUrl(st.native)}")`;
  glyph.style.backgroundSize = st.backgroundSize;
  glyph.style.backgroundPosition = st.backgroundPosition;
  return glyph;
}

/**
 * A socketed item icon.
 * @param {object|string} subject item / reward choice / blessing / upgrade / name
 * @param {{size?:number, socket?:boolean, kind?:string, className?:string,
 *   label?:string, marks?:boolean}} [options] size = the icon's CSS px (16/32/48/64/96);
 *   socket=false draws the bare icon; marks adds forge level and imbue pips.
 * @returns {HTMLSpanElement}
 */
export function itemIcon(subject, options = {}) {
  const { size = 32, socket = true, kind, className = '', label = '', marks = true } = options;
  const id = itemIconId(subject, kind);
  const meta = itemIconMeta(id);
  const el = document.createElement('span');
  el.className = `ia-icon ${className}`.trim();
  el.dataset.iconId = meta.id;
  el.dataset.socket = meta.socket;
  el.dataset.rim = meta.rim;
  el.dataset.size = String(size);
  if (!socket) el.classList.add('is-bare');
  el.style.setProperty('--ia-size', `${size}px`);
  if (label) {
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', label);
  } else el.setAttribute('aria-hidden', 'true');
  if (socket) el.append(socketElement());
  el.append(glyphElement(meta.id, size));
  const item = typeof subject === 'object' ? subject?.item || subject : null;
  if (marks && item) {
    const forge = Number(item._forgeLevel) || 0;
    if (forge > 0 && size >= 32) {
      const f = document.createElement('span');
      f.className = 'ia-forge';
      f.textContent = `+${forge}`;
      el.append(f);
    }
    if (typeof item._imbueId === 'string' && item._imbueId) {
      const pip = document.createElement('span');
      pip.className = 'ia-imbue';
      pip.dataset.imbue = item._imbueId;
      el.append(pip);
    }
  }
  return el;
}

/**
 * The large item picture for a detail panel: the approved PC-98 painting when there is
 * one, else the pixel icon at 2x. Both sit on the same hero socket.
 * @param {object|string} subject
 * @param {{size?:number, kind?:string, className?:string}} [options] size: 96 (default) or 64
 */
export function itemHero(subject, options = {}) {
  const { size = 96, kind, className = '' } = options;
  const id = itemIconId(subject, kind);
  const meta = itemIconMeta(id);
  const frame = document.createElement('span');
  frame.className = `ia-hero ${className}`.trim();
  frame.dataset.iconId = meta.id;
  frame.dataset.socket = meta.socket;
  frame.dataset.rim = meta.rim;
  frame.style.setProperty('--ia-size', `${size}px`);
  frame.setAttribute('aria-hidden', 'true');
  frame.append(socketElement());
  // Paintings are dithered at 96 px: shown at 1x or 2x, never shrunk.
  const hero = size % manifest.heroSize === 0 ? itemHeroUrl(meta.id) : null;
  if (hero) {
    const img = document.createElement('img');
    img.className = 'ia-hero-art';
    img.src = hero;
    img.alt = '';
    img.width = size;
    img.height = size;
    img.decoding = 'async';
    // Inside a closed disclosure the painting is never fetched until it is opened.
    img.loading = 'lazy';
    img.draggable = false;
    frame.dataset.art = 'painted';
    frame.append(img);
  } else {
    frame.dataset.art = 'pixel';
    frame.append(glyphElement(meta.id, size));
  }
  return frame;
}

/** The label a surface can print beside an icon ("Iron Sword" for "Vampiric Iron Sword +2"). */
export function itemBaseName(item) {
  return baseItemName(item);
}

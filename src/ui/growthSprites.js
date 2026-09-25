// growthSprites — the map sprite a unit shows, as an image the DOM can draw.
//
// Uses the battlefield's own texture lookup (battleUnitSpriteKey: traced →
// rebuilt → class sprite), so promotions show exactly the sprite the unit
// will wear on the map. The first frame (traced strips: idle0) is cut to a
// canvas once per texture/frame and cached as a data URL. Presentation
// only: never mutates the unit, never touches the RNG. Returns null when
// the texture is missing so callers can drop the sprite cleanly.
import { battleUnitSpriteKey } from './BattleUnitVisuals.js';

const cache = new Map();

function firstFrameName(texture) {
  if (texture?.has?.('idle0')) return 'idle0';
  const names = texture?.getFrameNames?.() || [];
  return names.length ? names[0] : '__BASE';
}

/** A unit-shaped copy with another class (the promoted sprite preview). */
export function projectedSpriteUnit(unit, className, tier = 'promoted') {
  return {
    name: unit?.name,
    className,
    tier,
    faction: unit?.faction === 'enemy' ? 'enemy' : unit?.faction === 'npc' ? 'npc' : 'player',
    isLord: unit?.isLord,
    isBoss: unit?.isBoss,
    affixes: [],
  };
}

/** { src, key, width, height } for the unit's map sprite, or null. */
export function unitSpriteImage(scene, unit) {
  if (typeof document === 'undefined' || !scene?.textures || !unit?.className) return null;
  let key;
  try {
    key = battleUnitSpriteKey(scene, unit);
  } catch {
    return null;
  }
  if (!key || !scene.textures.exists?.(key)) return null;
  const texture = scene.textures.get(key);
  const frameName = firstFrameName(texture);
  const id = `${key}:${frameName}`;
  if (cache.has(id)) return cache.get(id);
  let out = null;
  try {
    const frame = texture.get(frameName);
    const source = frame?.source?.image || texture.getSourceImage?.();
    const w = frame?.cutWidth || source?.width;
    const h = frame?.cutHeight || source?.height;
    if (source && w > 0 && h > 0) {
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(source, frame?.cutX || 0, frame?.cutY || 0, w, h, 0, 0, w, h);
      out = { src: canvas.toDataURL('image/png'), key, width: w, height: h };
    }
  } catch {
    out = null;
  }
  if (cache.size > 64) cache.delete(cache.keys().next().value);
  cache.set(id, out);
  return out;
}

/** <img> for a sprite image (pixelated, decorative), or null. */
export function spriteElement(image, className = '') {
  if (!image?.src || typeof document === 'undefined') return null;
  const img = document.createElement('img');
  img.className = `gr-sprite ${className}`.trim();
  img.src = image.src;
  img.alt = '';
  img.draggable = false;
  img.decoding = 'async';
  img.dataset.spriteKey = image.key;
  img.style.setProperty('--gr-sprite-w', String(image.width));
  img.style.setProperty('--gr-sprite-h', String(image.height));
  img.setAttribute('aria-hidden', 'true');
  return img;
}

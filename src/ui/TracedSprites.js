// TracedSprites — the battlefield's unit sprites (default art; dev ?spriteArt=rebuilt
// shows the previous rebuilt set, ?spriteArt=classic the classic one).
//
// Baked by tools/art/sprite-trace (`node tools/art/sprite-trace/cli.mjs bake`, see
// docs/art-direction/sprites-v3): every class the battlefield can show (one sprite per
// portrait person of the class, enemy, corrupted enemy, NPC), the seven lords (base and
// promoted) and the named bosses, each as six frames — idle0..idle3 (the map idle loop) and the attack key
// poses windup / strike (per weapon type) — at `density` art px per world px. The frames
// are trimmed and packed into a few atlas pages; each sprite registers as its own
// texture `traced-<key>` whose frames (idle0..idle3) point into the shared page, so the
// whole roster costs one decoded page (no per-sprite canvas) while every tile-centre,
// HP-bar, ring, acted-tint, history and rewind path keeps using a plain texture key.
// Frames carry their trim, so a sprite is still a square texture (96 px at D = 1.5,
// the Entity 192) shown at 64x64 (128x128) world px with the feet on the rebuilt
// baseline. A unit with no traced sprite falls back to the next-best traced key, then to
// the classic class sprite (BattleUnitVisuals).
import manifest from './TracedSpriteManifest.json';
import { battlefieldTracedSpritesEnabled } from './battlefieldArtFlags.js';
import { displayedPerson, portraitPeopleForClass } from '../engine/PortraitVariants.js';

export const TRACED_PREFIX = 'traced-';
const PAGE_PREFIX = 'traced-page-';
const IDLE_MS = 260;
/** Idle loop frames; `windup` and `strike` are the attack key poses (combat choreography). */
export const IDLE_FRAMES = manifest.frames.filter((f) => f.startsWith('idle'));
export const ATTACK_FRAMES = ['windup', 'strike'];

export function tracedSpritesEnabled(search) {
  return battlefieldTracedSpritesEnabled(search);
}

export const classKey = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/ /g, '_');

/** Key of a person's sprite in a class (`<class>-<person>`, e.g. `fighter-fighter_d`). */
export const personSpriteKey = (cls, person) => `${classKey(cls)}-${person}`;

/**
 * A generic player-side unit's sprite: the person its portrait shows
 * (PortraitVariants.displayedPerson: the stored person, the preview fallback, or the
 * reclass counterpart), in its class. Falls back to the class's own sprite (enemy-only
 * creatures a reclass seal can reach), then to any baked person of the class.
 */
function playerClassKey(unit, cls, has) {
  const person = displayedPerson(unit);
  if (person && has(`${cls}-${person}`)) return `${cls}-${person}`;
  if (has(cls)) return cls;
  for (const p of portraitPeopleForClass(unit.className))
    if (has(`${cls}-${p}`)) return `${cls}-${p}`;
  return null;
}

/**
 * An NPC's person sprite in verdigris: `npc_<class>-<person>`, derived at runtime from the
 * person's player sprite by the manifest's colour swap (npcTexture), so a recruit keeps
 * the same figure when it joins. Not baked (the atlas would grow by a third).
 */
export const isDerivedNpcKey = (key, sprites = manifest.sprites) =>
  typeof key === 'string' &&
  key.startsWith('npc_') &&
  !Object.prototype.hasOwnProperty.call(sprites, key) &&
  Object.prototype.hasOwnProperty.call(sprites, key.slice(4));

/**
 * Pure: which baked sprite a unit uses, or null. Named bosses use their own art; enemies
 * with affixes read as corrupted; lords use their own sprite per tier; every other
 * player-side unit (recruits, NPCs) wears the sprite of the person its portrait shows,
 * NPCs in verdigris. Every step falls back to the closest traced sprite the manifest has
 * before giving up.
 */
export function tracedKeyFor(
  unit,
  sprites = manifest.sprites,
  { npcSwap = manifest.npcSwap } = {},
) {
  if (!unit) return null;
  const cls = classKey(unit.className);
  const has = (k) => Object.prototype.hasOwnProperty.call(sprites, k);
  if (unit.faction === 'enemy') {
    if (unit.isBoss) {
      const boss = `boss_${classKey(unit.name)}`;
      if (has(boss)) return boss;
    }
    if (unit.affixes?.length && has(`enemy_${cls}-corrupt`)) return `enemy_${cls}-corrupt`;
    return has(`enemy_${cls}`) ? `enemy_${cls}` : null;
  }
  if (unit.faction === 'npc') {
    const person = displayedPerson(unit);
    const own = person && `npc_${cls}-${person}`;
    if (own && (has(own) || (npcSwap?.length && has(own.slice(4))))) return own;
    if (has(`npc_${cls}`)) return `npc_${cls}`;
    return playerClassKey(unit, cls, has);
  }
  if (unit.isLord) {
    const base = `lord_${classKey(unit.name)}`;
    if (unit.tier === 'promoted' && has(`${base}_promoted`)) return `${base}_promoted`;
    if (has(base)) return base;
  }
  return playerClassKey(unit, cls, has);
}

export function preloadTracedSprites(scene) {
  if (!tracedSpritesEnabled()) return;
  manifest.pages.forEach((file, i) => {
    if (!scene.textures.exists(PAGE_PREFIX + i))
      scene.load.image(PAGE_PREFIX + i, `${import.meta.env.BASE_URL}assets/sprites/traced/${file}`);
  });
}

/**
 * Destroy a sprite texture without destroying the page it borrows (Texture#destroy
 * would destroy every source, i.e. the shared page's GL texture).
 */
function releaseSharedSource() {
  this.source = [];
  Object.getPrototypeOf(this).destroy.call(this);
}

/**
 * Register `traced-<key>` textures with named, trimmed frames on the loaded pages. No
 * pixels are copied: each texture's only source is its page's TextureSource.
 */
export function prepareTracedSprites(scene) {
  if (!tracedSpritesEnabled()) return 0;
  let made = 0;
  for (const [key, e] of Object.entries(manifest.sprites)) {
    const target = TRACED_PREFIX + key;
    const pageKey = PAGE_PREFIX + e.page;
    if (scene.textures.exists(target) || !scene.textures.exists(pageKey)) continue;
    const source = scene.textures.get(pageKey).source[0];
    const texture = scene.textures.create(target, [], e.size, e.size);
    if (!texture) continue;
    texture.source.push(source);
    texture.destroy = releaseSharedSource;
    // `__BASE` (what getSourceImage() and frame-less lookups resolve) is the rest pose;
    // the first named frame then becomes the texture's default frame, as for any atlas
    ['__BASE', ...manifest.frames].forEach((name, i) => {
      const col = Math.max(0, i - 1);
      const frame = texture.add(name, 0, e.x + col * e.step, e.y, e.w, e.h);
      frame?.setTrim(e.size, e.size, e.ox, e.oy, e.w, e.h);
    });
    made++;
  }
  return made;
}

export function tracedSpriteKey(scene, unit) {
  if (!tracedSpritesEnabled()) return null;
  const key = tracedKeyFor(unit);
  if (!key) return null;
  if (isDerivedNpcKey(key)) {
    if (npcTexture(scene, key)) return TRACED_PREFIX + key;
    // no canvas (headless) or no page yet: the class's baked NPC, else the person as is
    const cls = classKey(unit.className);
    for (const k of [`npc_${cls}`, key.slice(4)])
      if (scene.textures.exists(TRACED_PREFIX + k)) return TRACED_PREFIX + k;
    return null;
  }
  const texture = TRACED_PREFIX + key;
  return scene.textures.exists(texture) ? texture : null;
}

/**
 * A recorded texture key (battle history, rewind) that may name a runtime NPC person:
 * create it if needed so a replay after a reload shows the same figure. True when the
 * texture exists afterwards.
 */
export function ensureTracedTexture(scene, textureKey) {
  if (!textureKey || !scene?.textures) return false;
  if (scene.textures.exists(textureKey)) return true;
  const key = textureKey.startsWith(TRACED_PREFIX) ? textureKey.slice(TRACED_PREFIX.length) : null;
  return Boolean(key && tracedSpritesEnabled() && isDerivedNpcKey(key) && npcTexture(scene, key));
}

/**
 * The texture a saved sprite key should draw with now. Rewind history saved
 * before sprites followed the portrait person names the old seeded
 * identities (`traced-fighter-2`), which no longer exist: those draw as a
 * person of the same class instead of a blank placeholder. Returns null when
 * nothing fits (the caller draws its placeholder).
 */
export function resolveSavedSpriteKey(scene, textureKey, sprites = manifest.sprites) {
  if (!textureKey || !scene?.textures) return null;
  if (ensureTracedTexture(scene, textureKey)) return textureKey;
  const legacy = /^traced-([a-z_]+)-\d+$/.exec(textureKey);
  if (!legacy) return null;
  const person = Object.keys(sprites).find((k) => k.startsWith(`${legacy[1]}-`));
  const key = person && TRACED_PREFIX + person;
  return key && scene.textures.exists(key) ? key : null;
}

const hex6 = (rgb) => (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];

/** The manifest's player -> NPC colour swap as a Map of packed RGB. */
let swapMap = null;
export function npcSwapMap(table = manifest.npcSwap) {
  if (table === manifest.npcSwap && swapMap) return swapMap;
  const map = new Map((table || []).map(([from, to]) => [parseInt(from, 16), parseInt(to, 16)]));
  if (table === manifest.npcSwap) swapMap = map;
  return map;
}

/** Recolour RGBA pixels in place through a swap map (opaque pixels only). Pure. */
export function swapPixels(data, map) {
  let changed = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const to = map.get(hex6([data[i], data[i + 1], data[i + 2]]));
    if (to === undefined) continue;
    data[i] = to >> 16;
    data[i + 1] = (to >> 8) & 255;
    data[i + 2] = to & 255;
    changed++;
  }
  return changed;
}

/**
 * Create (once) the verdigris texture of a derived NPC key from its player sprite's
 * frames on the atlas page: one small canvas per NPC person shown (a battle has a few).
 * Returns false when it cannot (no DOM canvas, the page is not loaded).
 */
export function npcTexture(scene, key) {
  const target = TRACED_PREFIX + key;
  if (scene?.textures?.exists?.(target)) return true;
  const e = manifest.sprites[key.slice(4)];
  if (!e || typeof document === 'undefined') return false;
  const page = scene.textures.exists(PAGE_PREFIX + e.page)
    ? scene.textures.get(PAGE_PREFIX + e.page).getSourceImage?.()
    : null;
  if (!page) return false;
  try {
    const n = manifest.frames.length;
    const canvas = document.createElement('canvas');
    canvas.width = (n - 1) * e.step + e.w;
    canvas.height = e.h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    ctx.drawImage(page, e.x, e.y, canvas.width, e.h, 0, 0, canvas.width, e.h);
    const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
    swapPixels(pixels.data, npcSwapMap());
    ctx.putImageData(pixels, 0, 0);
    const texture = scene.textures.create(target, canvas, canvas.width, canvas.height);
    if (!texture) return false;
    ['__BASE', ...manifest.frames].forEach((name, i) => {
      const col = Math.max(0, i - 1);
      texture
        .add(name, 0, col * e.step, 0, e.w, e.h)
        ?.setTrim(e.size, e.size, e.ox, e.oy, e.w, e.h);
    });
    return true;
  } catch {
    return false; // presentation only: the fallback sprite is used
  }
}

/** Idle frame for a time (ms); pure so the cadence is testable. Units are phase-offset by column. */
export function idleFrameAt(time, phase = 0) {
  return IDLE_FRAMES[Math.floor(time / IDLE_MS + phase) % IDLE_FRAMES.length];
}

/**
 * Slow map-tempo idle for every traced unit graphic in a battle scene. Reduced motion
 * (the scene's own setting) holds the rest frame. Returns a stop function.
 */
export function startTracedIdle(scene) {
  if (!tracedSpritesEnabled() || !scene?.time?.addEvent) return () => {};
  const event = scene.time.addEvent({
    delay: IDLE_MS,
    loop: true,
    callback: () => {
      const still = scene._reduceMotion?.();
      const units = [
        ...(scene.playerUnits || []),
        ...(scene.enemyUnits || []),
        ...(scene.npcUnits || []),
      ];
      for (const u of units) {
        const g = u?.graphic;
        if (!g?.texture?.key?.startsWith(TRACED_PREFIX) || !g.setFrame) continue;
        // a unit mid-attack is left alone: an attack frame is showing, or the combat
        // choreography holds a pose on it (CombatFxController.setPose sets `_fxPose` for
        // the whole strike, including the beat before it paints the pose frame)
        if (g._fxPose || ATTACK_FRAMES.includes(g.frame?.name) || g.data?.get?.('tracedPose'))
          continue;
        const frame = still ? IDLE_FRAMES[0] : idleFrameAt(scene.time.now, (u.col || 0) % 4);
        if (g.frame?.name !== frame) g.setFrame(frame, false, false);
      }
    },
  });
  const stop = () => event.remove(false);
  scene.events?.once?.('shutdown', stop);
  return stop;
}

export const TRACED_MANIFEST = manifest;

// TracedSprites — the battlefield's unit sprites (default art; dev ?spriteArt=rebuilt
// shows the previous rebuilt set, ?spriteArt=classic the classic one).
//
// Baked by tools/art/sprite-trace (`node tools/art/sprite-trace/cli.mjs bake`, see
// docs/art-direction/sprites-v3): every class the battlefield can show (seeded player
// identities, enemy, corrupted enemy, NPC), the seven lords (base and promoted) and the
// named bosses, each as six frames — idle0..idle3 (the map idle loop) and the attack key
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

export const TRACED_PREFIX = 'traced-';
const PAGE_PREFIX = 'traced-page-';
const IDLE_MS = 260;
/** Idle loop frames; `windup` and `strike` are the attack key poses (combat choreography). */
export const IDLE_FRAMES = manifest.frames.filter((f) => f.startsWith('idle'));
export const ATTACK_FRAMES = ['windup', 'strike'];

export function tracedSpritesEnabled(search) {
  return battlefieldTracedSpritesEnabled(search);
}

/** Stable 32-bit FNV-1a hash (identity pick for recruits; never touches the battle RNG). */
export function hashName(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

export const classKey = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/ /g, '_');

/** Number of seeded identities baked for a generic class (`<class>-<i>` keys). */
function identityCount(cls, has) {
  let count = 0;
  while (has(`${cls}-${count}`)) count++;
  return count;
}

/** A generic player unit's sprite: one of the class's seeded people, picked by name. */
function playerClassKey(cls, name, has) {
  const count = identityCount(cls, has);
  if (count) return `${cls}-${hashName(String(name || '')) % count}`;
  return has(cls) ? cls : null;
}

/**
 * Pure: which baked sprite a unit uses, or null. Named bosses use their own art; enemies
 * with affixes read as corrupted; NPCs take the verdigris treatment; lords use their own
 * sprite per tier; generic player units pick one of the six seeded identities of their
 * class by name (every class bakes the same six people, so a unit keeps its look through
 * either promotion branch or a reclass). Every step falls back to the closest traced
 * sprite the manifest has before giving up.
 */
export function tracedKeyFor(unit, sprites = manifest.sprites) {
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
    if (has(`npc_${cls}`)) return `npc_${cls}`;
    return playerClassKey(cls, unit.name, has);
  }
  if (unit.isLord) {
    const base = `lord_${classKey(unit.name)}`;
    if (unit.tier === 'promoted' && has(`${base}_promoted`)) return `${base}_promoted`;
    if (has(base)) return base;
  }
  return playerClassKey(cls, unit.name, has);
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
  const texture = key && TRACED_PREFIX + key;
  return texture && scene.textures.exists(texture) ? texture : null;
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

// TracedSprites — dev-only review of the traced map sprites (?spriteArt=traced).
//
// The atlas and manifest are baked by tools/art/sprite-trace (cli.mjs bake): each
// sprite is a strip of six square frames (idle 0..3, attack windup, strike) at
// `density` art px per world px, drawn so the feet sit on the same baseline as the
// rebuilt 64 px textures. Textures register as `traced-<key>` with named frames and
// are displayed at 64x64 world px, so every tile-centre, HP-bar, ring, acted-tint and
// rewind path is unchanged. Units without a traced sprite fall back to rebuilt art.
import manifest from './TracedSpriteManifest.json';
import { battlefieldTracedSpritesEnabled } from './battlefieldArtFlags.js';

export const TRACED_PREFIX = 'traced-';
const ATLAS_KEY = 'traced-source-atlas';
const IDLE_MS = 260;

export function tracedSpritesEnabled(search) {
  return battlefieldTracedSpritesEnabled(search);
}

/** Stable 32-bit FNV-1a hash (identity pick for recruits; never touches the battle RNG). */
export function hashName(s) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h >>> 0;
}

const classKey = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/ /g, '_');

/**
 * Pure: which baked sprite a unit uses, or null. Enemies with affixes read as
 * corrupted; NPCs take the verdigris treatment; generic player units pick one of
 * the seeded identities of their class by name (stable across promotion, since the
 * name persists and each class line bakes the same identities).
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
    if (unit.affixes?.length && has(`enemy_${cls}~corrupt`)) return `enemy_${cls}~corrupt`;
    return has(`enemy_${cls}`) ? `enemy_${cls}` : null;
  }
  if (unit.faction === 'npc') return has(`npc_${cls}`) ? `npc_${cls}` : null;
  if (unit.isLord) {
    const lord = `lord_${classKey(unit.name)}${unit.tier === 'promoted' ? '_promoted' : ''}`;
    return has(lord) ? lord : null;
  }
  let count = 0;
  while (has(`${cls}#${count}`)) count++;
  if (count) return `${cls}#${hashName(String(unit.name || '')) % count}`;
  return has(cls) ? cls : null;
}

export function preloadTracedSprites(scene) {
  if (!tracedSpritesEnabled()) return;
  if (!scene.textures.exists(ATLAS_KEY))
    scene.load.image(
      ATLAS_KEY,
      `${import.meta.env.BASE_URL}assets/sprites/traced/traced-atlas.png`,
    );
}

/** Cut the atlas into one texture per sprite with named frames (first frame = idle0). */
export function prepareTracedSprites(scene) {
  if (!tracedSpritesEnabled() || !scene.textures.exists(ATLAS_KEY)) return;
  const source = scene.textures.get(ATLAS_KEY).getSourceImage();
  const { cell, frames } = manifest;
  for (const [key, entry] of Object.entries(manifest.sprites)) {
    const target = TRACED_PREFIX + key;
    if (scene.textures.exists(target)) continue;
    const canvas = document.createElement('canvas');
    canvas.width = cell * frames.length;
    canvas.height = cell;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(source, entry.x, entry.y, canvas.width, cell, 0, 0, canvas.width, cell);
    const texture = scene.textures.addCanvas(target, canvas);
    frames.forEach((name, i) => texture.add(name, 0, i * cell, 0, cell, cell));
  }
}

export function tracedSpriteKey(scene, unit) {
  if (!tracedSpritesEnabled()) return null;
  const key = tracedKeyFor(unit);
  const texture = key && TRACED_PREFIX + key;
  return texture && scene.textures.exists(texture) ? texture : null;
}

/** Idle frame for a time (ms); pure so the cadence is testable. Units are phase-offset by column. */
export function idleFrameAt(time, phase = 0) {
  return manifest.frames[Math.floor(time / IDLE_MS + phase) % 4];
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
        const frame = still ? manifest.frames[0] : idleFrameAt(scene.time.now, (u.col || 0) % 4);
        if (g.frame?.name !== frame) g.setFrame(frame, false, false);
      }
    },
  });
  const stop = () => event.remove(false);
  scene.events?.once?.('shutdown', stop);
  return stop;
}

export const TRACED_MANIFEST = manifest;

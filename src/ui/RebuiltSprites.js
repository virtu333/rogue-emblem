import { battlefieldLabEnabled } from './BattlefieldLab.js';
import manifest from './RebuiltSpriteManifest.json';
import { spritePlacement } from './rebuiltSpritePlacement.js';

export { spritePlacement };

export function rebuiltSpritesEnabled() {
  const query = new URLSearchParams(globalThis.location?.search || '');
  return battlefieldLabEnabled() && !(import.meta.env.DEV && query.get('spriteArt') === 'classic');
}

// Most entries are pre-rendered to their final 64/128px texture by
// tools/bakeRebuiltSprites.mjs; the ~1250px sources never ship.
export function preloadRebuiltSprites(scene) {
  if (!rebuiltSpritesEnabled()) return;
  for (const [key, entry] of Object.entries(manifest)) {
    if (entry.texture) continue; // Built at runtime from an already-loaded class texture.
    if (!scene.textures.exists(`rebuilt-${key}`))
      scene.load.image(
        `rebuilt-${key}`,
        `${import.meta.env.BASE_URL}assets/sprites/rebuilt/${entry.file}`,
      );
  }
}

// Source pixels stay untouched. Render into a tile-centred texture so every movement,
// rewind and HP-bar path continues using the existing tile-centre coordinates.
export function prepareRebuiltSprites(scene) {
  if (!rebuiltSpritesEnabled()) return;
  for (const [key, entry] of Object.entries(manifest)) {
    if (!entry.texture) continue;
    const target = `rebuilt-${key}`;
    if (scene.textures.exists(target) || !scene.textures.exists(entry.texture)) continue;
    const source = scene.textures.get(entry.texture).getSourceImage();
    const box = entry.bounds;
    const placement = spritePlacement(box, entry.kind);
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = placement.canvas;
    const context = canvas.getContext('2d');
    context.imageSmoothingEnabled = false;
    context.drawImage(
      source,
      box.x,
      box.y,
      box.width,
      box.height,
      placement.x,
      placement.y,
      placement.width,
      placement.height,
    );
    scene.textures.addCanvas(target, canvas);
  }
}

export function rebuiltSpriteKey(scene, unit) {
  if (!rebuiltSpritesEnabled()) return null;
  let key;
  if (unit.faction === 'enemy') {
    const bossKey = `boss_${unit.name?.toLowerCase().replace(/ /g, '_')}`;
    if (unit.isBoss && manifest[bossKey]) key = bossKey;
    else key = `enemy_${unit.className.toLowerCase().replace(/ /g, '_')}`;
  } else if (unit.isLord) {
    key = `lord_${unit.name.toLowerCase()}${unit.tier === 'promoted' ? '_promoted' : ''}`;
  } else {
    key = unit.className?.toLowerCase().replace(/ /g, '_');
  }

  const texture = `rebuilt-${key}`;
  return key && scene.textures.exists(texture) ? texture : null;
}

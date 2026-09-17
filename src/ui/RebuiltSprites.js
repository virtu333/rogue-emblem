import manifest from './RebuiltSpriteManifest.json';

export function rebuiltSpritesEnabled() {
  const query = new URLSearchParams(globalThis.location?.search || '');
  return (
    import.meta.env.DEV && query.get('battleLab') === '1' && query.get('spriteArt') !== 'classic'
  );
}

// Source pixels stay untouched. Render into a tile-centred texture so every movement,
// rewind and HP-bar path continues using the existing tile-centre coordinates.
export function spritePlacement(bounds, kind = 'infantry') {
  const canvas = kind === 'entity' ? 128 : 64;
  const maxWidth = kind === 'entity' ? 94 : kind === 'mounted' ? 46 : 38;
  const maxHeight = kind === 'entity' ? 90 : kind === 'mounted' ? 40 : 34;
  const scale = Math.min(maxWidth / bounds.width, maxHeight / bounds.height);
  const width = Math.max(1, Math.round(bounds.width * scale));
  const height = Math.max(1, Math.round(bounds.height * scale));
  const footY = kind === 'entity' ? 106 : 44;
  return { canvas, x: Math.round((canvas - width) / 2), y: footY - height, width, height };
}

export function preloadRebuiltSprites(scene) {
  if (!rebuiltSpritesEnabled()) return;
  for (const [key, entry] of Object.entries(manifest)) {
    if (!scene.textures.exists(`rebuilt-source-${key}`))
      scene.load.image(
        `rebuilt-source-${key}`,
        `${import.meta.env.BASE_URL}assets/sprites/rebuilt/${entry.file}`,
      );
  }
}

export function prepareRebuiltSprites(scene) {
  if (!rebuiltSpritesEnabled()) return;
  for (const [key, entry] of Object.entries(manifest)) {
    const target = `rebuilt-${key}`;
    if (scene.textures.exists(target) || !scene.textures.exists(`rebuilt-source-${key}`)) continue;
    const source = scene.textures.get(`rebuilt-source-${key}`).getSourceImage();
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
  }

  const texture = `rebuilt-${key}`;
  return key && scene.textures.exists(texture) ? texture : null;
}

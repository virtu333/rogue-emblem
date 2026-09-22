import { TILE_SIZE, TERRAIN_COLORS } from '../utils/constants.js';

const normalizeTerrainName = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/ /g, '_');

// Shared visual construction only: no Grid or entity registration.
export function createBattleTerrain(scene, label, x, y, biome = null) {
  const baseName = normalizeTerrainName(label);

  // Ballista: render floor underneath + ballista sprite overlay
  if (baseName === 'ballista') {
    const floorKey = biome === 'castle' ? 'terrain_floor' : 'terrain_plain';
    const groundKey = scene.textures.exists(floorKey) ? floorKey : null;
    const container = scene.add.container(x, y);
    if (groundKey) {
      const ground = scene.add.image(0, 0, groundKey);
      ground.setDisplaySize(TILE_SIZE, TILE_SIZE);
      container.add(ground);
    } else {
      const rect = scene.add.rectangle(0, 0, TILE_SIZE - 1, TILE_SIZE - 1, 0x909090);
      container.add(rect);
    }
    if (scene.textures.exists('terrain_ballista')) {
      const overlay = scene.add.image(0, 0, 'terrain_ballista');
      overlay.setDisplaySize(TILE_SIZE, TILE_SIZE);
      container.add(overlay);
    }
    return container;
  }

  const biomeKey = biome ? `terrain_${baseName}_${biome}` : null;
  const baseKey = `terrain_${baseName}`;
  const textureKey = biomeKey && scene.textures.exists(biomeKey) ? biomeKey : baseKey;
  if (scene.textures.exists(textureKey)) {
    const img = scene.add.image(x, y, textureKey);
    img.setDisplaySize(TILE_SIZE, TILE_SIZE);
    return img;
  }
  const color = TERRAIN_COLORS[label] || 0x808080;
  return scene.add.rectangle(x, y, TILE_SIZE - 1, TILE_SIZE - 1, color);
}

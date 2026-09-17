import manifest from './RebuiltPortraitManifest.json';
import { rebuiltSpritesEnabled } from './RebuiltSprites.js';

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/ /g, '_');

export function preloadRebuiltPortraits(scene) {
  if (!rebuiltSpritesEnabled()) return;
  for (const [id, entry] of Object.entries(manifest)) {
    const key = `rebuilt-portrait-${id}`;
    if (!scene.textures.exists(key))
      scene.load.image(key, `${import.meta.env.BASE_URL}assets/portraits/rebuilt/${entry.file}`);
  }
}

export function rebuiltPortraitKey(scene, unit) {
  if (!rebuiltSpritesEnabled() || !unit) return null;
  const name = normalize(unit.name);
  const candidates = [];
  if (unit.isBoss) candidates.push(`boss_${name}`);
  if (unit.isLord || manifest[`lord_${name}`]) {
    if (unit.tier === 'promoted') candidates.push(`lord_${name}_promoted`);
    candidates.push(`lord_${name}`);
  }
  if (unit.faction !== 'enemy') candidates.push(`generic_${normalize(unit.className)}`);
  for (const id of candidates) {
    const key = `rebuilt-portrait-${id}`;
    if (manifest[id] && scene.textures.exists(key)) return key;
  }
  return null;
}

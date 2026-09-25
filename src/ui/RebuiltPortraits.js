import manifest from './RebuiltPortraitManifest.json';
import { legacyKeyAliasesRebuilt, portraitArtMode, rebuiltPortraitUrl } from './portraitArt.js';

const normalize = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/ /g, '_');

// PC-98 mode loads the 192px PC-98 render under the same keys (canvas and
// texture-backed DOM paths keep working); classic loads the 1254px sources.
export function preloadRebuiltPortraits(scene) {
  const mode = portraitArtMode();
  for (const id of Object.keys(manifest)) {
    const key = `rebuilt-portrait-${id}`;
    if (scene.textures.exists(key)) continue;
    scene.load.image(key, rebuiltPortraitUrl(id, mode));
    // The legacy key for the same character shows the same render.
    if (legacyKeyAliasesRebuilt(id, mode))
      scene.load.once(`filecomplete-image-${key}`, () => aliasLegacyPortrait(scene, id));
  }
}

/** Register `portrait_<id>` as an alias of the loaded `rebuilt-portrait-<id>`. */
export function aliasLegacyPortrait(scene, id) {
  const legacy = `portrait_${id}`;
  const key = `rebuilt-portrait-${id}`;
  if (scene.textures.exists(legacy) || !scene.textures.exists(key)) return;
  const source = scene.textures.get(key).getSourceImage?.();
  if (source) scene.textures.addImage(legacy, source);
}

export function rebuiltPortraitKey(scene, unit) {
  if (!unit) return null;
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

// Story keys remain stable in data; presentation resolves approved art at runtime.
export function dialoguePortraitKey(scene, name, legacyKey) {
  if (!legacyKey) return null;
  const roster = scene.runManager?.roster || [];
  const units = [...roster, ...(scene.playerUnits || []), ...(scene.enemyUnits || [])];
  const unit = units.find((unit) => normalize(unit.name) === normalize(name));
  const rebuilt = unit && rebuiltPortraitKey(scene, unit);
  if (rebuilt) return rebuilt;
  const id = String(legacyKey).replace(/^portrait_/, '');
  const candidates = [id, `boss_${normalize(name)}`, `lord_${normalize(name)}`];
  for (const candidate of candidates) {
    const key = `rebuilt-portrait-${candidate}`;
    if (manifest[candidate] && scene.textures?.exists?.(key)) return key;
  }
  return legacyKey;
}

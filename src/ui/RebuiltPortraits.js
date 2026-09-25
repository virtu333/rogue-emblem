import manifest from './RebuiltPortraitManifest.json';
import {
  legacyKeyAliasesRebuilt,
  portraitArtMode,
  portraitIdForUnit,
  rebuiltPortraitUrl,
  usePc98,
} from './portraitArt.js';
// Registers the lazy variant texture loader used by portraitCanvasFrame.
import './portraitTextures.js';

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

/**
 * The portrait texture key for a unit (canvas and texture-backed paths; DOM
 * paths map it back to a portrait id). PC-98 art: the key of the portrait id
 * from the one resolver (`portraitIdForUnit`, variant faces included); a
 * variant has no preloaded texture, and portraitCanvasFrame loads it lazily.
 * Classic art keeps the historical texture chain: rebuilt, named lord, enemy
 * class, enemy base class, generic class, generic base class.
 */
export function unitPortraitKey(scene, unit, gameData = scene?.gameData || {}) {
  if (!unit) return null;
  if (usePc98()) {
    const id = portraitIdForUnit(unit, gameData);
    if (id) {
      const rebuiltKey = `rebuilt-portrait-${id}`;
      return manifest[id] && scene?.textures?.exists?.(rebuiltKey) ? rebuiltKey : `portrait_${id}`;
    }
  }
  const rebuilt = rebuiltPortraitKey(scene, unit);
  if (rebuilt) return rebuilt;
  if (gameData.lords?.some((l) => l.name === unit.name))
    return `portrait_lord_${String(unit.name).toLowerCase()}`;
  const exists = (key) => Boolean(scene?.textures?.exists?.(key));
  const classNorm = normalize(unit.className);
  const base = gameData.classes?.find((c) => c.name === unit.className)?.promotesFrom;
  const baseNorm = typeof base === 'string' ? normalize(base) : null;
  const keys = [];
  if (unit.faction === 'enemy')
    keys.push(`portrait_enemy_${classNorm}`, baseNorm && `portrait_enemy_${baseNorm}`);
  keys.push(`portrait_generic_${classNorm}`, baseNorm && `portrait_generic_${baseNorm}`);
  return keys.find((key) => key && exists(key)) || null;
}

// Story keys remain stable in data; presentation resolves approved art at runtime.
export function dialoguePortraitKey(scene, name, legacyKey) {
  if (!legacyKey) return null;
  const roster = scene.runManager?.roster || [];
  const units = [...roster, ...(scene.playerUnits || []), ...(scene.enemyUnits || [])];
  const unit = units.find((unit) => normalize(unit.name) === normalize(name));
  // A unit on the field or in the army speaks with its own face.
  if (unit && usePc98()) return unitPortraitKey(scene, unit) || legacyKey;
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

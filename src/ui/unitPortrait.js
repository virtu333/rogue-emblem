import { rebuiltPortraitKey } from './RebuiltPortraits.js';
import { textureImageSource } from './textureImageSource.js';
export function unitPortrait(scene, gameData, unit, className, portraitKey) {
  const normalize = (name) => name.toLowerCase().replace(/ /g, '_');
  const named = gameData.lords?.some((lord) => lord.name === unit.name);
  const base = gameData.classes?.find((entry) => entry.name === unit.className)?.promotesFrom;
  const prefix = unit.faction === 'enemy' ? 'portrait_enemy_' : 'portrait_generic_';
  const fallbackCandidates = named
    ? [`portrait_lord_${normalize(unit.name)}`]
    : [
        portraitKey?.(unit),
        prefix + normalize(unit.className),
        ...(typeof base === 'string' ? [prefix + normalize(base)] : []),
      ];
  const candidates = [rebuiltPortraitKey(scene, unit), ...fallbackCandidates];
  let source = '';
  for (const key of candidates.filter(Boolean)) {
    if (scene.textures.exists(key)) {
      source = textureImageSource(scene.textures.get(key));
    } else {
      const deferred = scene.registry.get('deferredAssets') || [];
      const asset = deferred.find((entry) => entry.key === key && entry.group === 'portraits');
      if (asset) source = `${import.meta.env.BASE_URL}${asset.src}`;
    }
    if (source) break;
  }
  if (!source) return null;
  const image = document.createElement('img');
  image.className = className;
  image.src = source;
  image.alt = '';
  image.addEventListener('error', () => image.remove(), { once: true });
  return image;
}

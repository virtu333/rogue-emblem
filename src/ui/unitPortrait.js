import { rebuiltPortraitKey } from './RebuiltPortraits.js';
import { textureImageSource } from './textureImageSource.js';
import {
  pc98PortraitElement,
  pickPortraitSize,
  portraitFaction,
  portraitIdForUnit,
  usePc98,
} from './portraitArt.js';

// PC-98 variant per portrait class, matching its CSS box (mobileRoster.css):
// roster list faces 32px; the roster summary 40px, 64px on large desktops.
export const ROSTER_DESKTOP_QUERY = '(min-width: 1000px) and (min-height: 600px)';
const PC98_SLOTS = Object.freeze({
  'mr-unit-face': { size: 32 },
  'mr-portrait': { size: 40, media: [[ROSTER_DESKTOP_QUERY, 64]] },
});

function removeOnError(node) {
  const img = node.tagName === 'PICTURE' ? node.querySelector('img') : node;
  img?.addEventListener('error', () => node.remove(), { once: true });
  return node;
}

export function unitPortrait(scene, gameData, unit, className, portraitKey) {
  if (usePc98()) {
    const id = portraitIdForUnit(unit, gameData);
    if (!id) return null;
    const slot = PC98_SLOTS[className] || { size: pickPortraitSize(48) };
    return removeOnError(
      pc98PortraitElement({ id, faction: portraitFaction(unit, id), className, ...slot }),
    );
  }
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

import { rebuiltSpriteKey } from './RebuiltSprites.js';

const LORD_SPRITE_KEYS = {
  Edric: { base: 'lordedric', promoted: 'greatlordedric' },
};

export function battleUnitSpriteKey(scene, unit) {
  if (unit.isCaravan && scene.textures.exists('merchant_caravan')) return 'merchant_caravan';
  const rebuilt = rebuiltSpriteKey(scene, unit);
  if (rebuilt) return rebuilt;
  const classKey = unit.className.toLowerCase().replace(/ /g, '_');
  if (unit.faction === 'enemy') {
    const defaultEnemySpriteKey = `enemy_${classKey}`;
    if (unit.isBoss && unit.name === 'The Emperor' && scene.textures?.exists?.('enemy_emperor')) {
      return 'enemy_emperor';
    }
    return defaultEnemySpriteKey;
  }
  // Lords with tier-specific sprites use the lookup table; others fall
  // through to the single name-keyed sprite, then the class sprite.
  if (unit.isLord) {
    const tierKeys = LORD_SPRITE_KEYS[unit.name];
    const tierKey = unit.tier === 'promoted' ? tierKeys?.promoted : tierKeys?.base;
    if (tierKey && scene.textures.exists(tierKey)) return tierKey;
    const lordKey = unit.name.toLowerCase();
    if (scene.textures.exists(lordKey)) return lordKey;
  }
  // NPCs use player sprites (same as non-lord player units)
  return classKey;
}

// EnemyAreaArts — which enemies carry an area weapon art (docs/specs/aoe-weapon-arts.md
// §7, owner decision 2026-10-01). The rule is data, `enemies.json` `eliteAreaArts`:
// only on an elite battle (seize or escape) in its `acts` (Act III on) at its
// `minDifficulty` or above (Nightfall), `count` [min, max] of the enemies get the art of
// their weapon type (`byWeaponType`: Sweeping Cleave for axes and swords, Skewer for
// lances and bows). The validator holds every listed art to one the AI can swing, and
// never a knockback.
//
// Two steps, both pure. At generation (MapGenerator, under the battle seed) the art is
// written on the spawn; it draws random numbers only when the battle qualifies, so every
// other battle generates exactly as before. At unit creation (BattleScene and the
// harness) the spawn's art is bound to the weapon that can carry it. From there the art
// is an ordinary bound art: the AI picks it through EnemyArtScoring, pays its HP cost
// and spends its per-map uses.

import { isDifficultyAtLeast } from './DifficultyEngine.js';
import { parseWeaponProficiencies } from './UnitManager.js';
import { getWeaponArtBindings, isWeaponArtCompatibleWithWeapon } from './WeaponArtSystem.js';

/** A weapon holds at most three arts (WeaponArtSystem's slot limit). */
const MAX_BOUND_ARTS = 3;

/**
 * Does this battle hand out enemy area arts? An elite battle, in one of the config's
 * acts, at its minimum difficulty or above. No config, no arts.
 * @param {{ isElite?: boolean, act?: string, difficultyId?: string }} battle
 * @param {object|null} config enemies.json `eliteAreaArts`
 */
export function enemyAreaArtsAllowed(battle = {}, config = null) {
  if (!config || battle?.isElite !== true) return false;
  const acts = Array.isArray(config.acts) ? config.acts : [];
  return (
    acts.includes(String(battle.act)) &&
    isDifficultyAtLeast(battle.difficultyId, config.minDifficulty)
  );
}

/**
 * The area art a spawn's class would carry, or null: by the class's first non-staff
 * weapon proficiency, the type its weapon is drawn from (UnitManager.getWeaponByTier).
 */
export function enemyAreaArtForClass(classData, config = null) {
  const profs = parseWeaponProficiencies(classData?.weaponProficiencies);
  const primary = profs.find((p) => p.type !== 'Staff') || null;
  return (primary && config?.byWeaponType?.[primary.type]) || null;
}

/** Bosses, the Entity, siege crews and recruit guardians keep their own kit. */
function eligibleSpawn(spawn) {
  return Boolean(
    spawn &&
    !spawn.isBoss &&
    !spawn.isEntity &&
    !spawn.siegeWeapon &&
    !spawn.isRecruitGuardian &&
    !spawn.areaArt,
  );
}

/**
 * Writes `areaArt` on `count` eligible spawns of a qualifying battle (the count drawn
 * evenly from [min, max], then each spawn drawn from those left). Returns a new array
 * (spawns it changes are copied); any other battle gets its spawns back untouched and
 * draws nothing from `random`.
 * @param {object[]} spawns
 * @param {{ isElite?: boolean, act?: string, difficultyId?: string, classes?: object[],
 *   config?: object|null, random?: () => number }} options
 */
export function assignEnemyAreaArts(spawns, options = {}) {
  const config = options.config || null;
  if (!Array.isArray(spawns) || !enemyAreaArtsAllowed(options, config)) return spawns;
  const classes = Array.isArray(options.classes) ? options.classes : [];
  const candidates = [];
  spawns.forEach((spawn, index) => {
    if (!eligibleSpawn(spawn)) return;
    const cls = classes.find((c) => c?.name === spawn.className);
    const artId = enemyAreaArtForClass(cls, config);
    if (artId) candidates.push({ index, artId });
  });
  if (candidates.length === 0) return spawns;
  const random = typeof options.random === 'function' ? options.random : Math.random;
  const [min, max] = config.count;
  const want = Math.min(candidates.length, min + Math.floor(random() * (max - min + 1)));
  const out = [...spawns];
  for (let n = 0; n < want; n++) {
    const pick = Math.min(candidates.length - 1, Math.floor(random() * candidates.length));
    const { index, artId } = candidates.splice(pick, 1)[0];
    out[index] = { ...out[index], areaArt: artId };
  }
  return out;
}

/**
 * Binds a spawn's area art to the enemy's weapon: the equipped one when it can carry
 * the art, else the first carried weapon that can. Returns the weapon, or null (no
 * art, an unknown art, or no weapon of its types).
 */
export function bindEnemyAreaArt(enemy, artId, artCatalog = []) {
  if (!enemy || typeof artId !== 'string' || !artId) return null;
  const art = (Array.isArray(artCatalog) ? artCatalog : []).find((a) => a?.id === artId);
  if (!art) return null;
  const carried = [enemy.weapon, ...(Array.isArray(enemy.inventory) ? enemy.inventory : [])];
  const weapon = carried.find((w) => w && isWeaponArtCompatibleWithWeapon(art, w)) || null;
  if (!weapon) return null;
  const bindings = getWeaponArtBindings(weapon);
  if (!bindings.some((b) => b.id === artId)) {
    if (bindings.length >= MAX_BOUND_ARTS) return null;
    bindings.push({ id: artId, source: 'innate' });
    weapon.weaponArtIds = bindings.map((b) => b.id);
    weapon.weaponArtSources = bindings.map((b) => b.source);
    weapon.weaponArtId = weapon.weaponArtIds[0];
    weapon.weaponArtSource = weapon.weaponArtSources[0];
  }
  return weapon;
}

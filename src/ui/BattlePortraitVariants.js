// Battle side of portrait variety: every unit placed on the map (spawned,
// recruited, reinforced or restored from a checkpoint) gets its face once,
// before anything can show it. Called from BattleScene.addUnitGraphic right
// after the unit's battle entity id is registered.
//
// - Player-side units (a recruit NPC spawned for this battle, a legacy unit)
//   get a person that the roster, the fallen and the other units on the field
//   do not already wear.
// - Enemies get one of their class's enemy faces from a stable hash of
//   (run seed, node, battle entity id): the same spawn always wears the same
//   face, including after a refresh, and nothing reads Math.random (the
//   battle RNG).
// The canvas forecast's 40 px face is warmed here; the scene's enemy faces
// are released when it shuts down (lazy textures, see portraitTextures.js).
import { assignPortraitVariant } from '../engine/PortraitVariants.js';
import { portraitIdForUnit } from './portraitArt.js';
import { releaseVariantTextures, warmUnitPortraits } from './portraitTextures.js';

const bound = new WeakSet();

export function battleSpawnKey(scene, unit) {
  const seed = Number(scene?.runManager?.runSeed);
  return `${Number.isFinite(seed) ? seed >>> 0 : 0}|${scene?.nodeId ?? ''}|${unit?.battleEntityId ?? unit?.name ?? ''}`;
}

export function placeBattlePortrait(scene, unit) {
  if (!unit) return null;
  try {
    const rm = scene?.runManager;
    const value =
      unit.faction === 'enemy'
        ? assignPortraitVariant(unit, { spawnKey: battleSpawnKey(scene, unit) })
        : assignPortraitVariant(unit, {
            roster: rm?.roster || [],
            fallen: rm?.fallenUnits || [],
            others: [...(scene?.playerUnits || []), ...(scene?.npcUnits || [])],
            seed: rm?.runSeed,
          });
    warmUnitPortraits(scene, [unit], [40]);
    bindRelease(scene);
    return value;
  } catch {
    return null; // portraits are presentation; never block a spawn
  }
}

function bindRelease(scene) {
  if (!scene?.events?.once || bound.has(scene)) return;
  bound.add(scene);
  scene.events.once('shutdown', () => {
    bound.delete(scene);
    const keep = new Set(
      (scene.runManager?.roster || []).map((u) => portraitIdForUnit(u, scene.gameData || {})),
    );
    if (scene.textures) releaseVariantTextures(scene.textures, keep);
  });
}

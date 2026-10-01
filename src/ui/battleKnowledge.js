import { createPlayerKnowledge } from '../engine/PlayerKnowledge.js';

/**
 * The board as the player knows it (PlayerKnowledge.js): their own units, what the
 * fog shows and the recruit's beacon (it shows through the fog). Every pre-commit
 * preview reads this view: BattleScene's ranges and Danger, the attack flow's area
 * preview.
 */
export function playerKnowledgeOf(scene) {
  return createPlayerKnowledge({
    grid: scene.grid,
    units: [...(scene.playerUnits || []), ...(scene.enemyUnits || []), ...(scene.npcUnits || [])],
    revealed: [scene._recruitBeacon?.npc],
  });
}

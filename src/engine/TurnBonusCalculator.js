// TurnBonusCalculator.js — Pure functions for turn-based rating and bonus gold.
// No Phaser deps.

/**
 * Calculate the par (target turn count) for a battle map.
 * @param {object} mapParams - { cols, rows, enemyCount, objective, mapLayout, terrainData }
 *   mapLayout: 2D array of terrain indices, terrainData: array from terrain.json
 * @param {object} config - turnBonus.json data
 * @returns {number|null} integer par, or null if objective has no basePar entry
 */
export function calculatePar(mapParams, config) {
  const { cols, rows, enemyCount, objective, mapLayout, terrainData } = mapParams;

  const basePar = config.objectiveBasePar[objective];
  if (basePar == null) return null;

  const adjustment = config.objectiveAdjustments[objective] || 0;
  const area = cols * rows;
  const areaPenalty = area * config.areaPenaltyPerTile;
  const enemyPenalty = enemyCount * config.enemyWeight;

  // Count difficult terrain tiles
  const difficultSet = new Set(config.difficultTerrainTypes);
  let difficultCount = 0;
  if (mapLayout && terrainData) {
    for (let r = 0; r < mapLayout.length; r++) {
      for (let c = 0; c < mapLayout[r].length; c++) {
        const idx = mapLayout[r][c];
        const terrain = terrainData[idx];
        if (terrain && difficultSet.has(terrain.name)) {
          difficultCount++;
        }
      }
    }
  }
  const difficultRatio = area > 0 ? difficultCount / area : 0;
  const terrainPenalty = difficultRatio * config.terrainMultiplier;

  return Math.ceil(basePar + enemyPenalty + areaPenalty + terrainPenalty + adjustment);
}

/**
 * Get the rating and bonus multiplier for a given turn count vs par.
 * @param {number} turnsTaken
 * @param {number} par
 * @param {object} config - turnBonus.json data
 * @returns {{ rating: string, bonusMultiplier: number }}
 */
export function getRating(turnsTaken, par, config) {
  const turnsOver = turnsTaken - par;
  for (const bracket of config.brackets) {
    if (turnsOver <= bracket.threshold) {
      return { rating: bracket.rating, bonusMultiplier: bracket.bonusMultiplier };
    }
  }
  // Fallback to last bracket (C)
  const last = config.brackets[config.brackets.length - 1];
  return { rating: last.rating, bonusMultiplier: last.bonusMultiplier };
}

/**
 * Calculate bonus gold for a battle based on rating and act.
 * @param {{ rating: string, bonusMultiplier: number }} rating - from getRating()
 * @param {string} actId - "act1", "act2", "act3", "act4", or "finalBoss"
 * @param {object} config - turnBonus.json data
 * @returns {number} bonus gold (floored)
 */
export function calculateBonusGold(rating, actId, config) {
  const baseGold = config.baseBonusGold[actId] || 0;
  return Math.floor(baseGold * rating.bonusMultiplier);
}

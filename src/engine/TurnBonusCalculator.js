// TurnBonusCalculator.js — Pure functions for turn-based rating and bonus gold.
// No Phaser deps.
import { GOLD_PAR_BONUS_MULTIPLIER } from '../utils/constants.js';

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

function normalizeMultiplier(value, fallback = 1) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, value));
}

function normalizeNonNegativeInt(value, fallback = 0) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.trunc(value));
}

function getLatePressureConfig(config) {
  return config?.latePressure || null;
}

/**
 * Resolve late-turn pressure multipliers from turn/par and config.
 * Penalties begin only when turnsOverPar > startOverPar.
 * @param {number} turnsTaken
 * @param {number|null} par
 * @param {object} config - turnBonus.json data
 * @returns {{
 *   active: boolean,
 *   hasPar: boolean,
 *   turnsOverPar: number,
 *   step: number,
 *   startOverPar: number,
 *   stepTurns: number,
 *   xpMultiplier: number,
 *   goldMultiplier: number,
 * }}
 */
export function getLatePressureState(turnsTaken, par, config) {
  const pressure = getLatePressureConfig(config);
  const hasPar = Number.isFinite(par);
  const safeTurn = normalizeNonNegativeInt(Number(turnsTaken), 0);
  const safePar = hasPar ? normalizeNonNegativeInt(Number(par), 0) : 0;
  const turnsOverPar = hasPar ? Math.max(0, safeTurn - safePar) : 0;

  const startOverPar = normalizeNonNegativeInt(Number(pressure?.startOverPar), 5);
  const stepTurns = Math.max(1, normalizeNonNegativeInt(Number(pressure?.stepTurns), 2));
  const xpTable = Array.isArray(pressure?.xpMultipliers) && pressure.xpMultipliers.length > 0
    ? pressure.xpMultipliers
    : [1];
  const goldTable = Array.isArray(pressure?.goldMultipliers) && pressure.goldMultipliers.length > 0
    ? pressure.goldMultipliers
    : [1];

  const active = hasPar && turnsOverPar > startOverPar;
  const step = active
    ? Math.max(1, Math.ceil((turnsOverPar - startOverPar) / stepTurns))
    : 0;
  const xpIdx = Math.min(step, xpTable.length - 1);
  const goldIdx = Math.min(step, goldTable.length - 1);

  return {
    active,
    hasPar,
    turnsOverPar,
    step,
    startOverPar,
    stepTurns,
    xpMultiplier: normalizeMultiplier(Number(xpTable[xpIdx]), 1),
    goldMultiplier: normalizeMultiplier(Number(goldTable[goldIdx]), 1),
  };
}

/**
 * Resolve the turn when boss timed enrage activates.
 * Uses min(bossEnrageTurn, par + bossEnrageOverPar) when par is available.
 * @param {number|null} par
 * @param {object} config - turnBonus.json data
 * @returns {number|null}
 */
export function getBossEnrageTurn(par, config) {
  const pressure = getLatePressureConfig(config);
  const absoluteTurn = Number.isFinite(pressure?.bossEnrageTurn)
    ? Math.max(1, Math.trunc(pressure.bossEnrageTurn))
    : null;
  const overPar = Number.isFinite(pressure?.bossEnrageOverPar)
    ? Math.max(0, Math.trunc(pressure.bossEnrageOverPar))
    : null;

  let threshold = absoluteTurn;
  if (Number.isFinite(par) && Number.isFinite(overPar)) {
    const parThreshold = Math.max(1, Math.trunc(par) + overPar);
    threshold = Number.isFinite(threshold) ? Math.min(threshold, parThreshold) : parThreshold;
  }
  return Number.isFinite(threshold) ? threshold : null;
}

/**
 * True when timed boss enrage should be active for the current turn.
 * @param {number} turnsTaken
 * @param {number|null} par
 * @param {object} config - turnBonus.json data
 * @returns {boolean}
 */
export function isBossEnrageActive(turnsTaken, par, config) {
  const threshold = getBossEnrageTurn(par, config);
  if (!Number.isFinite(threshold)) return false;
  const safeTurn = normalizeNonNegativeInt(Number(turnsTaken), 0);
  return safeTurn >= threshold;
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
  return Math.floor(baseGold * rating.bonusMultiplier * GOLD_PAR_BONUS_MULTIPLIER);
}

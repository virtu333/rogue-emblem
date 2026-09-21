import { BATTLE_UNIT_GROUPS } from './BattleEntityIdentity.js';

export const BATTLE_STATE_VERSION = 2;
export const MAX_BATTLE_STATE_BYTES = 2 * 1024 * 1024;

export function serializedBytes(value) {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength;
}

const record = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const items = (v) =>
  Array.isArray(v) && v.length <= 512 && v.every((i) => record(i) && typeof i.name === 'string');
const nonnegative = (v) => Number.isFinite(v) && v >= 0;

// This validator is for canonical historical states, not the legacy suspend
// compatibility envelope (which deliberately still contains Vision anchors).
export function validateBattleState(state) {
  try {
    if (!state || state.version !== BATTLE_STATE_VERSION) return false;
    if (!['player', 'enemy'].includes(state.phase)) return false;
    if (!Number.isInteger(state.turnNumber) || state.turnNumber < 1) return false;
    if (!Number.isInteger(state.rngSeed) || state.rngSeed < 0 || state.rngSeed > 0xffffffff)
      return false;
    for (const key of ['timeline', 'visionSnapshot', 'pendingVisionSnapshot', 'battleInProgress']) {
      if (key in state) return false;
    }
    if (!Number.isSafeInteger(state.nextEntityId) || state.nextEntityId < 1) return false;
    if (!Array.isArray(state.mapLayout) || !state.mapLayout.length || state.mapLayout.length > 128)
      return false;
    const width = state.mapLayout[0]?.length;
    if (
      !width ||
      width > 128 ||
      state.mapLayout.some(
        (row) =>
          !Array.isArray(row) ||
          row.length !== width ||
          row.some((tile) => !Number.isInteger(tile) || tile < 0 || tile > 255),
      )
    )
      return false;
    const ids = new Set();
    for (const group of BATTLE_UNIT_GROUPS) {
      if (!Array.isArray(state[group]) || state[group].length > 512) return false;
      for (const unit of state[group]) {
        if (
          !unit ||
          typeof unit.battleEntityId !== 'string' ||
          !/^u[1-9]\d*$/.test(unit.battleEntityId)
        )
          return false;
        if (ids.has(unit.battleEntityId)) return false;
        ids.add(unit.battleEntityId);
        if (
          !record(unit.stats) ||
          !['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK', 'MOV'].every((key) =>
            nonnegative(unit.stats[key]),
          ) ||
          !nonnegative(unit.currentHP)
        )
          return false;
        if (!Number.isInteger(unit.col) || !Number.isInteger(unit.row)) return false;
        if (
          ['playerUnits', 'enemyUnits', 'npcUnits'].includes(group) &&
          (unit.col < 0 || unit.row < 0 || unit.col >= width || unit.row >= state.mapLayout.length)
        )
          return false;
        if (!items(unit.inventory) || !items(unit.consumables)) return false;
        if (
          !Number.isInteger(unit.equippedInventoryIndex) ||
          unit.equippedInventoryIndex < -1 ||
          unit.equippedInventoryIndex >= unit.inventory.length
        )
          return false;
        if (unit.weapon !== null && unit.weapon !== undefined && !record(unit.weapon)) return false;
        if (unit.inventory.length > 64 || unit.consumables.length > 64) return false;
      }
    }
    if (state.runBattleState !== null) {
      const domain = state.runBattleState;
      if (
        !record(domain) ||
        !nonnegative(domain.gold) ||
        !items(domain.accessories) ||
        !items(domain.convoy?.weapons) ||
        !items(domain.convoy?.consumables)
      )
        return false;
    }
    return serializedBytes(state) <= MAX_BATTLE_STATE_BYTES;
  } catch (_) {
    return false;
  }
}

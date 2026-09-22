import { isBattleRngState } from './BattleRng.js';
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
const integer = (v, minimum = 0) => Number.isSafeInteger(v) && v >= minimum;
const text = (v) => typeof v === 'string' && v.length <= 8192;
const entityId = (v) => typeof v === 'string' && /^u[1-9]\d*$/.test(v);
const list = (v, check, limit = 512) => Array.isArray(v) && v.length <= limit && v.every(check);
const stats = (v) =>
  record(v) &&
  ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK', 'MOV'].every((key) =>
    nonnegative(v[key]),
  );
const optional = (object, key, check) => object[key] === undefined || check(object[key]);

// Validate values actually consumed by reconstruction, not just the enclosing
// arrays. A malformed optional history must fail before a charge is committed.
function validRestoreFields(state, width, height) {
  const tile = (v) =>
    record(v) && integer(v.col) && v.col < width && integer(v.row) && v.row < height;
  const tileKey = (key) => {
    if (typeof key !== 'string' || !/^\d+,\d+$/.test(key)) return false;
    const [col, row] = key.split(',').map(Number);
    return tile({ col, row });
  };
  if (
    state.fog != null &&
    (!record(state.fog) ||
      !list(state.fog.visible, tileKey, width * height) ||
      !list(state.fog.everSeen, tileKey, width * height))
  )
    return false;
  if (
    !optional(state, 'ballistas', (value) =>
      list(
        value,
        (b) => tile(b) && ['player', 'enemy'].includes(b.owner) && typeof b.captured === 'boolean',
      ),
    )
  )
    return false;
  if (
    !optional(state, 'temporaryTerrains', (value) =>
      list(
        value,
        (entry) => {
          if (
            !tile(entry) ||
            entry.key !== `${entry.col},${entry.row}` ||
            !integer(entry.originalIndex) ||
            entry.originalIndex > 255 ||
            !integer(entry.temporaryIndex) ||
            entry.temporaryIndex > 255 ||
            !integer(entry.remainingTurns, 1)
          )
            return false;
          const ref = entry.sourceRef;
          return (
            ref === null ||
            (record(ref) &&
              ['playerUnits', 'enemyUnits', 'npcUnits'].includes(ref.group) &&
              integer(ref.index) &&
              ref.index < state[ref.group].length)
          );
        },
        width * height,
      ),
    )
  )
    return false;
  if (
    !optional(state, 'zombieTombstones', (value) =>
      list(value, (tomb) => {
        const saved = tomb?.snapshot;
        return (
          tile(tomb) &&
          integer(tomb.turnsRemaining, 1) &&
          record(saved) &&
          text(saved.className) &&
          integer(saved.level, 1) &&
          stats(saved.stats) &&
          list(saved.skills, text) &&
          (saved.weapon == null || (record(saved.weapon) && text(saved.weapon.name))) &&
          optional(saved, 'inventory', items) &&
          optional(saved, 'proficiencies', (v) =>
            list(v, (p) => record(p) && text(p.type) && text(p.rank)),
          ) &&
          optional(saved, 'moveType', text) &&
          optional(saved, 'mov', nonnegative)
        );
      }),
    )
  )
    return false;
  if (state.antiTurtleState !== undefined) {
    const pressure = state.antiTurtleState;
    if (!record(pressure)) return false;
    for (const key of ['noProgressTurns', 'bestEnemyCount', 'bestEscapedCount'])
      if (!optional(pressure, key, integer)) return false;
    for (const key of ['aggressiveMode', 'turnEnrageActive'])
      if (!optional(pressure, key, (v) => typeof v === 'boolean')) return false;
    // A non-applicable objective has Infinity in live state and null after JSON.
    for (const key of ['bestLordThroneDistance', 'bestLordEscapeDistance'])
      if (!optional(pressure, key, (v) => v === null || v === Infinity || nonnegative(v)))
        return false;
  }
  if (state.pendingActionCompletion != null) {
    const pending = state.pendingActionCompletion;
    if (
      !record(pending) ||
      !['combat', 'finish'].includes(pending.kind) ||
      !text(pending.unitName) ||
      !pending.unitName.trim() ||
      !optional(pending, 'unitId', entityId) ||
      !optional(pending, 'skipCanto', (v) => typeof v === 'boolean') ||
      !optional(pending, 'gambitTriggered', (v) => typeof v === 'boolean')
    )
      return false;
  }
  if (
    state.villageState != null &&
    (!tile(state.villageState) ||
      !['intact', 'visited', 'razed'].includes(state.villageState.status) ||
      !optional(state.villageState, 'rewardItemUid', text))
  )
    return false;
  if (!optional(state, 'appliedHybridOverrideTurns', (v) => list(v, (turn) => integer(turn, 1))))
    return false;
  for (const key of ['playerDeathsThisBattle', 'goldEarned', 'checkpointIndex'])
    if (!optional(state, key, integer)) return false;
  for (const key of ['latePressureWarningShown', 'caravanExited'])
    if (!optional(state, key, (v) => typeof v === 'boolean')) return false;
  if (state.decisionRngState != null && !isBattleRngState(state.decisionRngState)) return false;
  if (state.commanderEntityId != null && !entityId(state.commanderEntityId)) return false;
  return true;
}

// This validator is for canonical historical states, not the legacy suspend
// compatibility envelope (which deliberately still contains Vision anchors).
export function validateBattleState(state) {
  try {
    if (!state || state.version !== BATTLE_STATE_VERSION) return false;
    if (state.rewindPolicy === 'fixed-v1' && !isBattleRngState(state.rngState)) return false;
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
        if (
          !optional(unit, '_conditions', (value) =>
            list(
              value,
              (condition) =>
                record(condition) &&
                text(condition.id) &&
                integer(condition.turnsRemaining) &&
                optional(condition, 'recoveryChance', (v) => nonnegative(v) && v <= 1),
            ),
          )
        )
          return false;
        if (unit.inventory.length > 64 || unit.consumables.length > 64) return false;
      }
    }
    if (!validRestoreFields(state, width, state.mapLayout.length)) return false;
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

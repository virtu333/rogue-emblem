// ZombieRemains — what a fallen Zombie or Revenant leaves behind (pure: no Phaser,
// no RNG, no scene).
//
// A Zombie or Revenant felled by anything but Light (and not a boss, and not one that
// already rose once) leaves remains on the tile where it fell: a record
// `{ col, row, turnsRemaining, seen, snapshot }`. Remains are tile records, never a
// unit: they block nothing, cannot be attacked, and do not count as an enemy.
//
//   - Each enemy phase, after the enemy's turn-start effects and before the AI moves,
//     every record ticks once (`tickRemains`). A record at 0 rises: on its own tile if
//     that is open and passable for it, else on the first open passable neighbour
//     (left, right, up, down), else the record is dropped (no room to rise).
//   - `turnsRemaining` is always the number of enemy-phase starts still to come
//     before it rises, whenever the kill happened: a kill in the player phase ticks
//     at the coming enemy phase; a kill in an enemy phase (a counter) has already
//     missed that phase's tick, so it gets one enemy phase more. The marker shows the
//     number as it is.
//   - A Rout is not won while any record remains.
//   - Smash (a unit's action) destroys every record on one tile in reach of a usable
//     weapon, or under the unit itself (it can stand on the bones and stamp them
//     out). It always succeeds: no roll, no counter, no RNG, no XP.
//
// `seen`: whether the player has seen the remains (the kill or the tile, since). Only
// seen records are drawn and inspected; only seen records on a visible tile can be
// smashed (engine/PlayerKnowledge's rule: previews read what the player knows).
// Records saved before the flag existed read as seen (they almost always came from a
// kill the player made themselves).

import { ZOMBIE_CLASSES } from '../utils/constants.js';
import { getAttackRange, getAttackWeapons } from './AttackOptions.js';

/** Enemy phases between the fall and the rise. */
export const REMAINS_RISE_PHASES = 3;

const tileKey = (col, row) => `${col},${row}`;

/** Does this unit, felled by `killer` (null: poison, lava, a death burst…), leave remains? */
export function leavesRemains(unit, killer = null) {
  if (!unit || !ZOMBIE_CLASSES.has(unit.className)) return false;
  if (unit._revived || unit.isBoss) return false;
  return killer?.weapon?.type !== 'Light';
}

/** The record left on `tile` by a fallen `unit`. `seen`: the player saw it fall. */
export function createRemains(unit, tile, { seen = false } = {}) {
  return {
    col: tile.col,
    row: tile.row,
    turnsRemaining: REMAINS_RISE_PHASES,
    seen: Boolean(seen),
    snapshot: {
      className: unit.className,
      level: unit.level,
      weapon: structuredClone(unit.weapon ?? null),
      inventory: structuredClone(unit.inventory || []),
      skills: [...(unit.skills || [])],
      stats: { ...unit.stats },
      moveType: unit.moveType,
      proficiencies: structuredClone(unit.proficiencies || []),
      tier: unit.tier || 'base',
      mov: unit.mov,
    },
  };
}

/** Legacy records (no `seen`) count as seen. */
export function isRemainsSeen(record) {
  return Boolean(record) && record.seen !== false;
}

/** Known to the player: seen before, or on a tile they see now. */
export function isRemainsKnown(record, isVisible = () => true) {
  if (!record) return false;
  return isRemainsSeen(record) || Boolean(isVisible(record.col, record.row));
}

/**
 * Mark records on visible tiles as seen. Returns the same array when nothing
 * changed, else a new array (changed records are copies).
 */
export function noteRemainsSeen(list, isVisible = () => true) {
  if (!Array.isArray(list) || list.length === 0) return list || [];
  let changed = false;
  const next = list.map((record) => {
    if (isRemainsSeen(record) || !isVisible(record.col, record.row)) return record;
    changed = true;
    return { ...record, seen: true };
  });
  return changed ? next : list;
}

/**
 * One enemy-phase tick. Returns `{ kept, rising }`: records still waiting (their
 * count lowered by one) and records that rise now, in list order. Never mutates.
 */
export function tickRemains(list) {
  const kept = [];
  const rising = [];
  for (const record of list || []) {
    const next = { ...record, turnsRemaining: (Number(record.turnsRemaining) || 0) - 1 };
    if (next.turnsRemaining > 0) kept.push(next);
    else rising.push(next);
  }
  return { kept, rising };
}

const NEIGHBOURS = [
  { dc: -1, dr: 0 },
  { dc: 1, dr: 0 },
  { dc: 0, dr: -1 },
  { dc: 0, dr: 1 },
];

/**
 * Where a rising record stands up: its own tile when open and passable for its
 * move type, else the first open passable neighbour, else null (no room: dropped).
 * @param {object} record
 * @param {{ cols: number, rows: number, isOccupied: (col, row) => boolean,
 *   moveCostAt: (col, row, moveType) => (number|string|null|undefined) }} world
 */
export function riseTile(record, { cols, rows, isOccupied, moveCostAt }) {
  const moveType = record?.snapshot?.moveType || 'Infantry';
  const passable = (col, row) => {
    const cost = moveCostAt(col, row, moveType);
    return cost !== '--' && cost != null;
  };
  const open = (col, row) =>
    col >= 0 && col < cols && row >= 0 && row < rows && !isOccupied(col, row);
  if (open(record.col, record.row) && passable(record.col, record.row))
    return { col: record.col, row: record.row };
  for (const { dc, dr } of NEIGHBOURS) {
    const col = record.col + dc;
    const row = record.row + dr;
    if (open(col, row) && passable(col, row)) return { col, row };
  }
  return null;
}

/** The unit a record rises as: half HP (at least 1), its weapon only, no affixes, no XP. */
export function buildRisenUnit(record, tile) {
  const snap = record.snapshot;
  return {
    name: snap.className,
    className: snap.className,
    tier: snap.tier || 'base',
    level: snap.level,
    xp: 0,
    isLord: false,
    personalGrowths: null,
    growths: {},
    proficiencies: structuredClone(snap.proficiencies || []),
    skills: [...(snap.skills || [])],
    col: tile.col,
    row: tile.row,
    mov: snap.mov || snap.stats.MOV || 4,
    moveType: snap.moveType || 'Infantry',
    stats: { ...snap.stats },
    currentHP: Math.max(1, Math.floor(snap.stats.HP / 2)),
    faction: 'enemy',
    weapon: snap.weapon ? structuredClone(snap.weapon) : null,
    inventory: snap.weapon ? [structuredClone(snap.weapon)] : [],
    consumables: [],
    affixes: [],
    accessory: null,
    weaponRank: snap.proficiencies?.[0]?.rank || 'Prof',
    hasMoved: false,
    hasActed: false,
    _revived: true,
    _noXP: true,
    isBoss: false,
    graphic: null,
    label: null,
    hpBar: null,
  };
}

/**
 * Records `unit` can Smash from where it stands: known, on a tile the player sees
 * now, and either under the unit itself or on an empty tile within the range of a
 * weapon it could attack with (proficiency, silence and uses as for Attack). A unit
 * with no such weapon (a staff alone, a silenced tome) cannot Smash at all.
 * One entry per tile (the record that would rise first).
 * @param {{ skillsData?: object[], isVisible?: (col, row) => boolean,
 *   isOccupied?: (col, row) => boolean }} [world]
 */
export function remainsInReach(unit, list, world = {}) {
  const { skillsData = null, isVisible = () => true, isOccupied = () => false } = world;
  if (!unit || !Array.isArray(list) || list.length === 0) return [];
  const ranges = getAttackWeapons(unit).map((weapon) =>
    getAttackRange(unit, weapon, { skillsData }),
  );
  if (!ranges.length) return [];
  const byTile = new Map();
  for (const record of list) {
    if (!isRemainsKnown(record, isVisible) || !isVisible(record.col, record.row)) continue;
    const distance = Math.abs(record.col - unit.col) + Math.abs(record.row - unit.row);
    if (distance > 0) {
      if (isOccupied(record.col, record.row)) continue;
      if (!ranges.some(({ min, max }) => distance >= min && distance <= max)) continue;
    }
    const key = tileKey(record.col, record.row);
    const held = byTile.get(key);
    if (!held || record.turnsRemaining < held.turnsRemaining) byTile.set(key, record);
  }
  return [...byTile.values()];
}

/**
 * Smash the remains on `tile`: removes every record there (two zombies that fell on
 * one tile are one pile, and a pile left under the smasher would be hidden by its
 * sprite and unreachable by anyone else). Returns `{ list, smashed }`; `smashed` is
 * the removed records in list order, or null (and `list` the input) when nothing
 * lies there.
 */
export function smashRemains(list, tile) {
  const all = list || [];
  const onTile = (record) => record.col === tile?.col && record.row === tile?.row;
  const smashed = all.filter(onTile);
  if (smashed.length === 0) return { list: all, smashed: null };
  return { list: all.filter((record) => !onTile(record)), smashed };
}

/** Known records grouped by tile: [{ col, row, turnsRemaining (soonest), count }]. */
export function knownRemainsTiles(list, isVisible = () => true) {
  const byTile = new Map();
  for (const record of list || []) {
    if (!isRemainsKnown(record, isVisible)) continue;
    const key = tileKey(record.col, record.row);
    const held = byTile.get(key);
    if (!held)
      byTile.set(key, {
        col: record.col,
        row: record.row,
        turnsRemaining: record.turnsRemaining,
        count: 1,
      });
    else {
      held.count += 1;
      held.turnsRemaining = Math.min(held.turnsRemaining, record.turnsRemaining);
    }
  }
  return [...byTile.values()];
}

/** "rises in 2 enemy phases" / "rises in 1 enemy phase". */
export function riseText(turnsRemaining) {
  const n = Math.max(1, Math.trunc(Number(turnsRemaining) || 1));
  return `rises in ${n} enemy ${n === 1 ? 'phase' : 'phases'}`;
}

/**
 * The tile-inspect line for known remains at (col, row), or null:
 * "Zombie remains · rises in 2 enemy phases" ("2 Zombie remains · first rises…").
 */
export function remainsInfoLine(list, col, row, isVisible = () => true) {
  const here = knownRemainsTiles(list, isVisible).find((t) => t.col === col && t.row === row);
  if (!here) return null;
  const records = (list || []).filter(
    (r) => r.col === col && r.row === row && isRemainsKnown(r, isVisible),
  );
  const names = new Set(records.map((r) => r.snapshot?.className).filter(Boolean));
  const kind = names.size === 1 ? [...names][0] : 'Undead';
  return here.count > 1
    ? `${here.count} ${kind} remains · first ${riseText(here.turnsRemaining)}`
    : `${kind} remains · ${riseText(here.turnsRemaining)}`;
}

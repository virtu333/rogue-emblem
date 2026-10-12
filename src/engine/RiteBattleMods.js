// RiteBattleMods.js - what the Rite's tier does to a finale's map (docs/specs/act-v-descent.md
// §4, §9.5), written into the battle config when it is generated so the locked config holds it:
// a resume, a Vision rewind and the route preview's scout all read the same map. Pure: no
// Phaser, no Math.random (nothing here draws; the map's own draws are all taken before this
// step, so a battle with a tier and one without are the same map but for the mods).
//
// `params.riteMods` (Rite.riteModsFor, from RunManager.getBattleParams: keys only when the tier
// does something) -> MapGenerator calls applyRiteBattleMods last, on both paths (a set piece's
// and a template's):
//   lieutenant  escortDrop N     the N highest-level non-boss foes leave the map (ties: the
//                                earlier spawn), never an objective target; a hold pack one
//                                stood in shrinks to its survivors (`holdPackSize`), so the
//                                drop never reads as a fall that wakes it;
//               revivalStones N  read by SeatedBoss.resolveSeatedBoss when the seat is drawn
//                                (never on the Entity), not here;
//               waveHollowed N   one scripted wave of N Hollowed on turn `waveTurn` (4);
//   entity      splashDelta N    `entitySplashCount` = ENTITY_SPLASH_COUNT + N, clamped 0..4
//                                (EntitySystem.entitySplashCountFor reads it), and only on a map
//                                that seats the Entity;
//               waveHollowed N   one scripted wave of N Hollowed beside each template wave, on
//                                that wave's turn and at its edges.
// Nothing else is ever written (Rite.sanitizeRiteMods whitelists by boss again here): the
// Entity's HP, stones, hinge, hum and rally are never touched.
//
// A Rite wave is a `reinforcements.scriptedWaves` entry (fixed tiles, chosen now) built as the
// Hunted wave picks its edge (HuntedWave.withHuntedWave: the map's own spawn edges, else the rout
// ladder's front, else the enemy's side) but allowed on a boss map. Tiles: the edges' open
// arrival tiles, nearest each edge's middle first, taken in turn across the edges; when the
// edges hold too few (the Glass is walled on three sides) the open tiles nearest the boss make
// up the rest. Each entry is par-neutral (a price, not a puzzle), pays the called Hollowed's
// share (`xpMultiplier` 0.5) and its Hollowed take the battle's level range's middle plus the
// Rite's level bonus (`waveLevelBonus`, the Vigil's rule), never past the base class cap.

import {
  BASE_CLASS_LEVEL_CAP,
  ENTITY_SPLASH_COUNT,
  ENTITY_SPLASH_COUNT_MAX,
} from '../utils/constants.js';
import { RITE_WAVE_TURN, sanitizeRiteMods } from './Rite.js';
import { HOLLOWED_CLASS } from './Necromancy.js';
import { SUMMONED_XP_MULTIPLIER } from './ConjuredUnits.js';
import {
  REINFORCEMENT_EDGES,
  collectEdgeSpawnCandidates,
  isArrivalTileOpen,
} from './ReinforcementScheduler.js';
import { enemySideEdge } from './HuntedWave.js';
import { getFootprint } from './EntitySystem.js';
import { HOLD_AI_MODE } from './HoldActivation.js';

const key = (col, row) => `${col},${row}`;
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The mods a config records (`battleConfig.riteMods`): band, boss and what it did. */
function recordOf(mods, applied) {
  return { band: mods.band || null, target: mods.target, ...applied };
}

/**
 * Apply the Rite's mods to a generated map's parts. Mutates `reinforcementConfig` (as
 * finishReinforcements does) and returns what the config gains.
 * @param {object} p
 * @param {object} p.params battle params (`riteMods`)
 * @param {object[]} p.enemySpawns the dressed spawns (not changed)
 * @param {{ reinforcements?: object }} p.reinforcementConfig
 * @param {number[][]} p.mapLayout
 * @param {number} p.cols, p.rows
 * @param {object[]} p.playerSpawns
 * @param {object[]} p.terrain
 * @param {object[]} [p.classes]
 * @param {number[]} p.levelRange the battle's adjusted level range
 * @param {string[]} [p.objectiveTargets] authored ids a defeat objective names (never dropped)
 * @returns {{ enemySpawns: object[], extra: object }} the spawns to keep and the config's new keys
 *   (`entitySplashCount`, `riteMods`)
 */
export function applyRiteBattleMods({
  params,
  enemySpawns,
  reinforcementConfig,
  mapLayout,
  cols,
  rows,
  playerSpawns = [],
  terrain,
  classes = [],
  levelRange = [1, 1],
  objectiveTargets = [],
}) {
  const raw = params?.riteMods;
  if (!isObject(raw)) return { enemySpawns, extra: {} };
  const target = raw.target;
  const mods = sanitizeRiteMods(raw, target);
  if (Object.keys(mods).length === 0) return { enemySpawns, extra: {} };
  const entity = (enemySpawns || []).find((s) => s?.isEntity === true) || null;
  const boss = (enemySpawns || []).find((s) => s?.isBoss === true) || null;
  const applied = {};
  let spawns = enemySpawns;
  const extra = {};

  if (target === 'lieutenant' && mods.escortDrop && !entity) {
    const dropped = escortToDrop(enemySpawns, mods.escortDrop, objectiveTargets);
    spawns = withoutDropped(enemySpawns, dropped);
    applied.escortDropped = dropped.size;
  }
  if (target === 'lieutenant' && mods.revivalStones && !entity) {
    // Seated with the boss (SeatedBoss.resolveSeatedBoss); recorded here for the preview.
    applied.revivalStones = mods.revivalStones;
  }
  if (target === 'entity' && mods.splashDelta && entity) {
    extra.entitySplashCount = Math.max(
      0,
      Math.min(ENTITY_SPLASH_COUNT_MAX, ENTITY_SPLASH_COUNT + mods.splashDelta),
    );
    applied.splashDelta = mods.splashDelta;
  }
  const waveClass = (classes || []).some((c) => c?.name === HOLLOWED_CLASS);
  if (mods.waveHollowed && waveClass && (target === 'lieutenant' ? !entity : entity)) {
    const map = { mapLayout, cols, rows, terrain, playerSpawns, enemySpawns: spawns, boss };
    const level = waveLevel(levelRange, raw.waveLevelBonus);
    const base = isObject(reinforcementConfig.reinforcements)
      ? reinforcementConfig.reinforcements
      : {};
    const plans =
      target === 'lieutenant'
        ? [{ turn: mods.waveTurn || RITE_WAVE_TURN, edges: riteWaveEdges(base, map) }]
        : (Array.isArray(base.waves) ? base.waves : [])
            .filter((wave) => Number.isInteger(wave?.turn) && wave.turn > 0)
            .map((wave) => ({ turn: wave.turn, edges: templateWaveEdges(base, wave, map) }));
    const waves = plans
      .map((plan) => riteWave({ ...plan, count: mods.waveHollowed, level, map }))
      .filter(Boolean);
    if (waves.length) {
      reinforcementConfig.reinforcements = {
        ...base,
        scriptedWaves: [...(Array.isArray(base.scriptedWaves) ? base.scriptedWaves : []), ...waves],
      };
      applied.waves = waves.map((w) => ({ turn: w.turn, count: w.spawns.length }));
    }
  }
  if (Object.keys(applied).length) extra.riteMods = recordOf(raw, applied);
  return { enemySpawns: spawns, extra };
}

/** The `count` highest-level non-boss spawns (ties: the earlier), never an objective target. */
function escortToDrop(enemySpawns, count, objectiveTargets) {
  const targets = new Set(objectiveTargets || []);
  const escort = (enemySpawns || [])
    .map((spawn, index) => ({ spawn, index }))
    .filter(
      ({ spawn }) =>
        spawn && spawn.isBoss !== true && !(spawn.authoredId && targets.has(spawn.authoredId)),
    )
    .sort(
      (a, b) => (Number(b.spawn.level) || 0) - (Number(a.spawn.level) || 0) || a.index - b.index,
    );
  return new Set(escort.slice(0, count).map((e) => e.spawn));
}

/**
 * The spawns left once `dropped` leave. A hold pack wakes when it has fewer living holders than
 * its size at spawn (HoldActivation.wakeHolders, `holdPackSize`), so a pack a dropped guard stood
 * in is sized to its survivors (new objects: the input is not changed): the guard never stood on
 * the map, and its packmates hold as a smaller pack (a lone survivor as a pack of one) until a
 * wake rule of their own. Every other spawn is kept as it was.
 */
function withoutDropped(enemySpawns, dropped) {
  const packOf = (spawn) => (Number.isInteger(spawn.holdPack) ? spawn.holdPack : 0);
  const isHolder = (spawn) => spawn?.aiMode === HOLD_AI_MODE;
  const kept = enemySpawns.filter((spawn) => !dropped.has(spawn));
  const shrunk = new Set([...dropped].filter(isHolder).map(packOf));
  if (shrunk.size === 0) return kept;
  const size = new Map();
  for (const spawn of kept)
    if (isHolder(spawn) && shrunk.has(packOf(spawn)))
      size.set(packOf(spawn), (size.get(packOf(spawn)) || 0) + 1);
  return kept.map((spawn) =>
    isHolder(spawn) && shrunk.has(packOf(spawn)) && Number.isInteger(spawn.holdPackSize)
      ? { ...spawn, holdPackSize: size.get(packOf(spawn)) }
      : spawn,
  );
}

/** A wave Hollowed's level: the range's middle (rounded down) plus the Rite's bonus. */
function waveLevel(levelRange, bonus) {
  const lo = Math.max(1, Math.trunc(Number(levelRange?.[0]) || 1));
  const hi = Math.max(lo, Math.trunc(Number(levelRange?.[1]) || lo));
  const extra = Math.max(0, Math.trunc(Number(bonus) || 0));
  return Math.min(BASE_CLASS_LEVEL_CAP, Math.floor((lo + hi) / 2) + extra);
}

/** The Lieutenant's wave edge: withHuntedWave's rule (own edges, ladder front, enemy side). */
function riteWaveEdges(reinforcements, map) {
  const own = Array.isArray(reinforcements.spawnEdges)
    ? reinforcements.spawnEdges.filter((edge) => REINFORCEMENT_EDGES.includes(edge))
    : [];
  if (own.length) return [...new Set(own)];
  if (REINFORCEMENT_EDGES.includes(reinforcements.ladder?.front))
    return [reinforcements.ladder.front];
  return [enemySideEdge(map)];
}

/** A template wave's edges: its own, else the map's spawn edges, else the enemy side. */
function templateWaveEdges(reinforcements, wave, map) {
  const own = Array.isArray(wave.edges)
    ? wave.edges.filter((edge) => REINFORCEMENT_EDGES.includes(edge))
    : [];
  return own.length ? [...new Set(own)] : riteWaveEdges(reinforcements, map);
}

/** Every tile a unit stands on at the start (an Entity fills its 3x3). */
function startTiles(map) {
  const tiles = new Set();
  for (const unit of [...(map.playerSpawns || []), ...(map.enemySpawns || [])]) {
    if (!unit || !Number.isFinite(unit.col) || !Number.isFinite(unit.row)) continue;
    for (const t of getFootprint(unit)) tiles.add(key(t.col, t.row));
  }
  return tiles;
}

/**
 * One Rite wave's scripted entry, or null when the map has nowhere to put a Hollowed. The tiles
 * are fixed now: the edges' open arrival tiles (nearest each edge's middle first, one edge after
 * the other in turn), then the open tiles nearest the boss.
 */
function riteWave({ turn, edges, count, level, map }) {
  const taken = startTiles(map);
  const midCol = (map.cols - 1) / 2;
  const midRow = (map.rows - 1) / 2;
  const byEdge = edges.map((edge) =>
    collectEdgeSpawnCandidates({
      edge,
      mapLayout: map.mapLayout,
      terrain: map.terrain,
      occupied: taken,
      moveType: 'Infantry',
    }).sort(
      (a, b) =>
        Math.abs(a.col - midCol) +
          Math.abs(a.row - midRow) -
          (Math.abs(b.col - midCol) + Math.abs(b.row - midRow)) ||
        a.row - b.row ||
        a.col - b.col,
    ),
  );
  const tiles = [];
  const chosen = new Set();
  for (let i = 0; tiles.length < count && byEdge.some((list) => i < list.length); i++) {
    for (const list of byEdge) {
      const tile = list[i];
      if (!tile || chosen.has(key(tile.col, tile.row)) || tiles.length >= count) continue;
      chosen.add(key(tile.col, tile.row));
      tiles.push(tile);
    }
  }
  if (tiles.length < count && map.boss) {
    const near = [];
    for (let row = 0; row < map.rows; row++)
      for (let col = 0; col < map.cols; col++) {
        const k = key(col, row);
        if (taken.has(k) || chosen.has(k)) continue;
        if (!isArrivalTileOpen(map.terrain, map.mapLayout, col, row, 'Infantry')) continue;
        near.push({ col, row, d: Math.abs(col - map.boss.col) + Math.abs(row - map.boss.row) });
      }
    near.sort((a, b) => a.d - b.d || a.row - b.row || a.col - b.col);
    for (const t of near.slice(0, count - tiles.length)) tiles.push({ col: t.col, row: t.row });
  }
  if (tiles.length === 0) return null;
  return {
    turn,
    rite: true,
    parNeutral: true,
    xpMultiplier: SUMMONED_XP_MULTIPLIER,
    spawns: tiles.map((t) => ({ col: t.col, row: t.row, className: HOLLOWED_CLASS, level })),
  };
}

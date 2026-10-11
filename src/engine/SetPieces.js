// SetPieces.js - event set pieces (docs/specs/event-set-pieces.md): authored, scaled, seeded
// battle maps that an event's `battle` effect names (`setPiece`), so the fight looks like the
// story that started it. Pure: no Phaser, and no Math.random of its own: every draw comes from
// the `random` it is handed (MapGenerator passes the battle seed's stream, inside
// generateSeededBattle).
//
// data/setPieces.json
//   setPieces[]   { id, title, lore, objective, biome?, fog?, deploy: { max }, parBonus?,
//                   variants[] }
//   variant       { id, mirror?, map (AuthoredMap grammar), playerSpawns[], enemies[], waves? }
//   enemy slot    { col, row, classes, level?, captain?: { name }, aiMode?, hold?, weapon?,
//                   minRung?, minAct? }
//   wave          { turn, spawns[]: { col, row, classes, level?, aiMode?, minRung?, minAct? } }
//
// `classes` is a list of class names, or a table keyed by act whose entry holds from its act up
// ({ act1: [...], act3: [...] }: Act II reads act1's list). A set piece honours each rung's
// `enemyClassEarliestAct` (Dragons, Necromancers), never First Light's blanket ban on the
// gated pools: the set piece is the story, and its text names what is there.
//
// Draw order (spec §3.2): the variant (only with two or more), the mirror (only when allowed),
// then two draws per enemy slot and per wave spawn in order (class, level), taken even for a
// slot a rung or act leaves out, so a harder rung adds foes and never moves the others.
//
// Levels: a slot takes `lo + floor(r * (hi - lo + 1)) + level` on the battle's adjusted range
// (MapGenerator's filler rule); a captain takes `captainLevelFor` (the elite captain's rule) +
// `level`. Never below 1.

import { parseAuthoredMap } from './AuthoredMap.js';
import { DIFFICULTY_IDS, ENEMY_ACT_GATE_ORDER, isDifficultyAtLeast } from './DifficultyEngine.js';
import { RECRUIT_PROMOTION_BASE_LEVEL, isActAtOrAfter } from '../utils/constants.js';
import { REINFORCEMENT_CONTRACT_VERSION } from './MapTemplateEngine.js';
import { HOLD_AI_MODE } from './HoldDisturbance.js';

/** A set piece's config carries `templateId: 'setpiece:<id>'` (never a mapTemplates id). */
export const SET_PIECE_TEMPLATE_PREFIX = 'setpiece:';
/** Objectives a set piece may name (Phase A: rout). */
export const SET_PIECE_OBJECTIVES = Object.freeze(['rout']);
/** Authored map bounds, in tiles. */
export const SET_PIECE_MAP_BOUNDS = Object.freeze({
  minCols: 6,
  minRows: 6,
  maxCols: 16,
  maxRows: 12,
});
/** Text limits: the place line on the battle card. */
export const SET_PIECE_TEXT_LIMITS = Object.freeze({ title: 30, lore: 140 });
/** Move types a player spawn must suit (fliers stand anywhere). */
const PLAYER_SPAWN_MOVE_TYPES = ['Infantry', 'Armored', 'Cavalry'];
const ACT_IDS = ['act1', 'act2', 'act3', 'act4'];
const SLOT_KEYS = new Set([
  'col',
  'row',
  'classes',
  'level',
  'captain',
  'aiMode',
  'hold',
  'wake',
  'weapon',
  'minRung',
  'minAct',
]);
const WAVE_SPAWN_KEYS = new Set(['col', 'row', 'classes', 'level', 'aiMode', 'minRung', 'minAct']);

// Elite captains (and set-piece captains) sit above the act's range by this many levels.
const CAPTAIN_LEVEL_OFFSET = { act1: 0 };
const CAPTAIN_DEFAULT_OFFSET = 2;

/** A hold pack's latest authored wake turn. */
const MAX_WAKE_TURN = 12;

const isInt = (v) => Number.isInteger(v);
const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const tileKey = (t) => `${t.col},${t.row}`;

/** Every set piece in the data (an empty list when there is none). */
export function setPieceList(data) {
  return Array.isArray(data?.setPieces) ? data.setPieces : [];
}

/** The set piece with this id, or null. */
export function findSetPiece(data, id) {
  if (typeof id !== 'string' || !id) return null;
  return setPieceList(data).find((p) => p?.id === id) || null;
}

/** The set piece id a battle config was built from, or null for any other map. */
export function setPieceIdOfConfig(config) {
  const id = config?.templateId;
  return typeof id === 'string' && id.startsWith(SET_PIECE_TEMPLATE_PREFIX)
    ? id.slice(SET_PIECE_TEMPLATE_PREFIX.length)
    : null;
}

/** The deploy screen's cap a set piece sets (its `deploy.max`), or null. */
export function setPieceDeployCap(setPiece) {
  const max = setPiece?.deploy?.max;
  return isInt(max) && max > 0 ? max : null;
}

/**
 * The class list a slot draws from in an act: the list itself, or an act table's entry for the
 * latest act at or before this one. Null when the table has nothing yet.
 */
export function classesForAct(classes, act) {
  if (Array.isArray(classes)) return classes;
  if (!isObject(classes)) return null;
  const order = ENEMY_ACT_GATE_ORDER;
  const at = order.indexOf(act);
  for (let i = at; i >= 0; i--) {
    const list = classes[order[i]];
    if (Array.isArray(list)) return list;
  }
  return null;
}

/** Whether a slot (or wave spawn) is fought at this rung and act. */
export function slotInPlay(slot, { act = 'act1', difficultyId = 'normal' } = {}) {
  if (slot?.minRung && !isDifficultyAtLeast(difficultyId, slot.minRung)) return false;
  if (slot?.minAct && !isActAtOrAfter(act, slot.minAct)) return false;
  return true;
}

/**
 * A captain's level: the top of the battle's range plus the act's captain offset, less the
 * promotion base level for a promoted class (MapGenerator's elite captain rule). Never below 1.
 */
export function captainLevelFor(act, top, promoted = false) {
  const offset = CAPTAIN_LEVEL_OFFSET[act] ?? CAPTAIN_DEFAULT_OFFSET;
  const base = Math.max(1, Math.trunc(Number(top) || 1));
  return Math.max(1, base + offset - (promoted ? RECRUIT_PROMOTION_BASE_LEVEL : 0));
}

function pickFrom(list, roll) {
  if (!Array.isArray(list) || list.length === 0) return null;
  return list[Math.min(list.length - 1, Math.floor(roll * list.length))];
}

/**
 * One slot (or wave spawn) resolved: class, level and tile. Takes its two draws first, then
 * returns null when the rung or act leaves it out.
 */
function resolveSlot(slot, ctx) {
  const classRoll = ctx.random();
  const levelRoll = ctx.random();
  if (!slotInPlay(slot, ctx)) return null;
  const className = pickFrom(classesForAct(slot.classes, ctx.act), classRoll);
  if (!className) return null;
  const [lo, hi] = ctx.levelRange;
  const offset = isInt(slot.level) ? slot.level : 0;
  const promoted = ctx.classes.find((c) => c?.name === className)?.tier === 'promoted';
  const rolled = slot.captain
    ? captainLevelFor(ctx.act, hi, promoted)
    : lo + Math.floor(levelRoll * (hi - lo + 1));
  return {
    className,
    level: Math.max(1, rolled + offset),
    ...ctx.place(slot),
  };
}

/** The AI a spawn takes when the slot names none (MapGenerator's filler defaults). */
function defaultAiMode(className) {
  if (className === 'Cleric') return 'heal';
  if (className === 'Necromancer' || className === 'Circle Adept') return 'guard';
  return undefined;
}

/**
 * Build a set piece's map and units for one battle. Every draw is `random`'s.
 * @param {object} options
 * @param {object} options.setPiece      a data/setPieces.json entry
 * @param {string} options.act
 * @param {string} options.difficultyId
 * @param {[number, number]} options.levelRange  the battle's adjusted range
 * @param {number} options.deployCount   units the player deploys
 * @param {object[]} options.classes     classes.json
 * @param {object[]} options.terrain     terrain.json
 * @param {() => number} options.random
 * @returns {{ variantId: string, mirrored: boolean, mapLayout: number[][], cols: number,
 *   rows: number, playerSpawns: object[], formationSpares: object[], enemySpawns: object[],
 *   reinforcements: object|null }}
 */
export function buildSetPieceBattle({
  setPiece,
  act = 'act1',
  difficultyId = 'normal',
  levelRange = [1, 1],
  deployCount = 1,
  classes = [],
  terrain = [],
  random = Math.random,
}) {
  const variants = Array.isArray(setPiece?.variants) ? setPiece.variants : [];
  if (variants.length === 0) throw new Error(`Set piece "${setPiece?.id}" has no variants`);
  const variant =
    variants.length > 1
      ? variants[Math.min(variants.length - 1, Math.floor(random() * variants.length))]
      : variants[0];
  const mirrored = variant.mirror === true ? random() < 0.5 : false;
  const parsed = parseAuthoredMap(variant.map, terrain);
  if (!parsed.mapLayout) {
    throw new Error(
      `Set piece "${setPiece.id}" variant "${variant.id}": ${parsed.errors.join('; ')}`,
    );
  }
  const { cols, rows } = parsed;
  const mapLayout = mirrored
    ? parsed.mapLayout.map((line) => [...line].reverse())
    : parsed.mapLayout;
  const place = (t) => ({ col: mirrored ? cols - 1 - t.col : t.col, row: t.row });
  const lo = Math.max(1, Math.trunc(Number(levelRange?.[0]) || 1));
  const hi = Math.max(lo, Math.trunc(Number(levelRange?.[1]) || lo));
  const ctx = { act, difficultyId, levelRange: [lo, hi], classes, place, random };

  const spawnTiles = (variant.playerSpawns || []).map(place);
  const count = Math.max(1, Math.min(spawnTiles.length, Math.trunc(Number(deployCount) || 1)));
  const playerSpawns = spawnTiles.slice(0, count);
  const formationSpares = spawnTiles.slice(count);

  const enemySpawns = [];
  for (const slot of variant.enemies || []) {
    const resolved = resolveSlot(slot, ctx);
    if (!resolved) continue;
    const spawn = { ...resolved, isBoss: Boolean(slot.captain) };
    if (slot.captain && typeof slot.captain.name === 'string') spawn.name = slot.captain.name;
    if (typeof slot.weapon === 'string') spawn.weapon = slot.weapon;
    if (isInt(slot.hold)) {
      spawn.aiMode = HOLD_AI_MODE;
      spawn.holdPack = slot.hold;
      if (isInt(slot.wake)) spawn.holdWakeTurn = slot.wake;
    } else {
      const aiMode = typeof slot.aiMode === 'string' ? slot.aiMode : defaultAiMode(spawn.className);
      if (aiMode) spawn.aiMode = aiMode;
    }
    enemySpawns.push(spawn);
  }
  // A hold pack wakes when one of its own falls: it needs its size among the slots in play.
  const packSize = new Map();
  for (const s of enemySpawns)
    if (s.aiMode === HOLD_AI_MODE) packSize.set(s.holdPack, (packSize.get(s.holdPack) || 0) + 1);
  for (const s of enemySpawns)
    if (s.aiMode === HOLD_AI_MODE) s.holdPackSize = packSize.get(s.holdPack);

  const scriptedWaves = [];
  for (const wave of variant.waves || []) {
    const spawns = [];
    for (const raw of wave.spawns || []) {
      const resolved = resolveSlot(raw, ctx);
      if (!resolved) continue;
      const aiMode =
        typeof raw.aiMode === 'string' ? raw.aiMode : defaultAiMode(resolved.className);
      spawns.push(aiMode ? { ...resolved, aiMode } : resolved);
    }
    if (spawns.length > 0) scriptedWaves.push({ turn: wave.turn, spawns });
  }
  const reinforcements =
    scriptedWaves.length > 0
      ? {
          reinforcementContractVersion: REINFORCEMENT_CONTRACT_VERSION,
          reinforcements: { waves: [], scriptedWaves },
        }
      : null;

  return {
    variantId: variant.id,
    mirrored,
    mapLayout,
    cols,
    rows,
    playerSpawns,
    formationSpares,
    enemySpawns,
    reinforcements,
  };
}

// --- Validation (npm run validate:data) --------------------------------------------------

function moveCost(terrain, index, moveType) {
  const cost = terrain?.[index]?.moveCost?.[moveType];
  if (cost === undefined || cost === null || cost === '--') return Infinity;
  const n = Number(cost);
  return Number.isFinite(n) && n > 0 ? n : Infinity;
}

function standable(terrain, mapLayout, tile, moveType) {
  const index = mapLayout?.[tile.row]?.[tile.col];
  return index !== undefined && moveCost(terrain, index, moveType) !== Infinity;
}

/** Tiles reachable for a move type from a start (units never block: they move). */
function reachableFrom(terrain, mapLayout, start, moveType) {
  const rows = mapLayout.length;
  const cols = mapLayout[0]?.length || 0;
  const seen = new Set([tileKey(start)]);
  const queue = [start];
  while (queue.length) {
    const { col, row } = queue.shift();
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const next = { col: col + dc, row: row + dr };
      if (next.col < 0 || next.row < 0 || next.col >= cols || next.row >= rows) continue;
      if (seen.has(tileKey(next))) continue;
      if (!standable(terrain, mapLayout, next, moveType)) continue;
      seen.add(tileKey(next));
      queue.push(next);
    }
  }
  return seen;
}

/** Every `battle` effect in an event that names a set piece, with where it sits. */
export function setPieceRefs(eventsConfig) {
  const refs = [];
  const events = Array.isArray(eventsConfig?.events) ? eventsConfig.events : [];
  const walk = (node, where, event) => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${where}[${i}]`, event));
      return;
    }
    if (!isObject(node)) return;
    if (node.type === 'battle' && node.setPiece !== undefined)
      refs.push({ event, setPiece: node.setPiece, where });
    for (const [key, value] of Object.entries(node)) walk(value, `${where}.${key}`, event);
  };
  for (const event of events) walk(event, `events.${event?.id}`, event);
  return refs;
}

/**
 * Validate data/setPieces.json against the game data (and the events that name set pieces).
 * @param {object} config  data/setPieces.json
 * @param {{ terrain, classes, weapons, difficulty, events }} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateSetPiecesConfig(config, data = {}) {
  const errors = [];
  const err = (where, message) => errors.push(`setPieces.json:${where}: ${message}`);
  if (!isObject(config) || !Array.isArray(config.setPieces))
    return { valid: false, errors: ['setPieces.json: `setPieces` must be an array'] };
  const terrain = data.terrain || [];
  const classes = data.classes || [];
  const classByName = new Map(classes.map((c) => [c?.name, c]));
  const weaponNames = new Set((data.weapons || []).map((w) => w?.name));
  const earliestByRung = Object.fromEntries(
    DIFFICULTY_IDS.map((id) => [id, data.difficulty?.modes?.[id]?.enemyClassEarliestAct || {}]),
  );
  const ids = new Set();

  const checkClasses = (where, classesField) => {
    const lists = Array.isArray(classesField)
      ? [classesField]
      : isObject(classesField)
        ? Object.entries(classesField).map(([act, list]) => {
            if (!ACT_IDS.includes(act)) err(where, `classes: unknown act "${act}"`);
            return list;
          })
        : null;
    if (!lists || lists.length === 0) {
      err(where, 'classes must be a list of class names or a table keyed by act');
      return;
    }
    for (const list of lists) {
      if (!Array.isArray(list) || list.length === 0) {
        err(where, 'every class list must be a non-empty array');
        continue;
      }
      for (const name of list) if (!classByName.has(name)) err(where, `unknown class "${name}"`);
    }
  };

  const checkGates = (where, slot) => {
    if (slot.minRung !== undefined && !DIFFICULTY_IDS.includes(slot.minRung))
      err(where, `minRung "${slot.minRung}" is not a rung`);
    if (slot.minAct !== undefined && !ACT_IDS.includes(slot.minAct))
      err(where, `minAct "${slot.minAct}" is not an act`);
    if (slot.level !== undefined && !(isInt(slot.level) && Math.abs(slot.level) <= 10))
      err(where, 'level must be a whole number from -10 to 10');
    if (slot.aiMode !== undefined && typeof slot.aiMode !== 'string')
      err(where, 'aiMode must be a string');
  };

  /** Tiles a class list's move types can all stand on. */
  const moveTypesOf = (classesField) => {
    const lists = Array.isArray(classesField)
      ? [classesField]
      : isObject(classesField)
        ? Object.values(classesField)
        : [];
    const types = new Set();
    for (const list of lists)
      for (const name of Array.isArray(list) ? list : [])
        types.add(classByName.get(name)?.moveType || 'Infantry');
    return [...types];
  };

  for (const [pi, piece] of config.setPieces.entries()) {
    const pw = `setPieces[${pi}]`;
    if (!isObject(piece)) {
      err(pw, 'must be an object');
      continue;
    }
    if (typeof piece.id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(piece.id))
      err(pw, 'id must be lower_snake_case');
    else if (ids.has(piece.id)) err(pw, `duplicate id "${piece.id}"`);
    else ids.add(piece.id);
    for (const key of ['title', 'lore']) {
      const text = piece[key];
      if (typeof text !== 'string' || !text.trim()) err(pw, `${key} is required`);
      else if (text.length > SET_PIECE_TEXT_LIMITS[key])
        err(pw, `${key} is over ${SET_PIECE_TEXT_LIMITS[key]} characters`);
      else if (/["\n]/.test(text)) err(pw, `${key} must be one line with no double quotes`);
    }
    if (!SET_PIECE_OBJECTIVES.includes(piece.objective))
      err(pw, `objective must be one of ${SET_PIECE_OBJECTIVES.join(', ')}`);
    if (piece.fog !== undefined && typeof piece.fog !== 'boolean')
      err(pw, 'fog must be true or false (omit it to keep the event roll)');
    if (piece.biome !== undefined && piece.biome !== null && typeof piece.biome !== 'string')
      err(pw, 'biome must be a template biome or null');
    if (piece.parBonus !== undefined && !(isInt(piece.parBonus) && piece.parBonus >= 0))
      err(pw, 'parBonus must be a whole number >= 0');
    const cap = setPieceDeployCap(piece);
    if (!cap || cap > 8) err(pw, 'deploy.max must be a whole number from 1 to 8');
    const variants = Array.isArray(piece.variants) ? piece.variants : [];
    if (variants.length === 0 || variants.length > 3) err(pw, 'needs 1 to 3 variants');
    const variantIds = new Set();

    for (const [vi, variant] of variants.entries()) {
      const vw = `${pw}.variants[${vi}]`;
      if (typeof variant?.id !== 'string' || !variant.id) err(vw, 'id is required');
      else if (variantIds.has(variant.id)) err(vw, `duplicate variant id "${variant.id}"`);
      else variantIds.add(variant.id);
      if (variant.mirror !== undefined && typeof variant.mirror !== 'boolean')
        err(vw, 'mirror must be true or false');
      const parsed = parseAuthoredMap(variant?.map, terrain);
      if (!parsed.mapLayout) {
        for (const e of parsed.errors) err(vw, e);
        continue;
      }
      const { mapLayout, cols, rows } = parsed;
      const b = SET_PIECE_MAP_BOUNDS;
      if (cols < b.minCols || rows < b.minRows || cols > b.maxCols || rows > b.maxRows)
        err(
          vw,
          `map is ${cols}x${rows}; it must be ${b.minCols}x${b.minRows} to ${b.maxCols}x${b.maxRows}`,
        );
      const inBounds = (t) =>
        isInt(t?.col) && isInt(t?.row) && t.col >= 0 && t.row >= 0 && t.col < cols && t.row < rows;
      const taken = new Map();
      const claim = (where, t) => {
        if (!inBounds(t)) {
          err(where, `tile (${t?.col},${t?.row}) is out of bounds`);
          return false;
        }
        const key = tileKey(t);
        if (taken.has(key)) {
          err(where, `tile (${key}) is also ${taken.get(key)}`);
          return false;
        }
        taken.set(key, where);
        return true;
      };

      const spawns = Array.isArray(variant.playerSpawns) ? variant.playerSpawns : [];
      if (cap && spawns.length < cap)
        err(vw, `has ${spawns.length} player spawns; deploy.max needs ${cap}`);
      for (const [si, tile] of spawns.entries()) {
        const sw = `${vw}.playerSpawns[${si}]`;
        if (!claim(sw, tile)) continue;
        for (const moveType of PLAYER_SPAWN_MOVE_TYPES)
          if (!standable(terrain, mapLayout, tile, moveType))
            err(sw, `a ${moveType} unit cannot stand on (${tileKey(tile)})`);
      }
      const start = spawns.find(inBounds);
      const reach = start ? reachableFrom(terrain, mapLayout, start, 'Infantry') : new Set();
      const reachable = (t) =>
        reach.has(tileKey(t)) ||
        [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ].some(([dc, dr]) => reach.has(`${t.col + dc},${t.row + dr}`));
      for (const tile of spawns)
        if (inBounds(tile) && !reach.has(tileKey(tile)))
          err(vw, `player spawn (${tileKey(tile)}) is cut off from the first spawn`);

      const enemies = Array.isArray(variant.enemies) ? variant.enemies : [];
      if (enemies.length === 0) err(vw, 'needs at least one enemy slot');
      let captains = 0;
      const packWake = new Map();
      for (const [ei, slot] of enemies.entries()) {
        const ew = `${vw}.enemies[${ei}]`;
        if (!isObject(slot)) {
          err(ew, 'must be an object');
          continue;
        }
        for (const key of Object.keys(slot))
          if (!SLOT_KEYS.has(key)) err(ew, `unknown key "${key}"`);
        checkClasses(ew, slot.classes);
        checkGates(ew, slot);
        if (slot.captain !== undefined) {
          captains++;
          if (
            !isObject(slot.captain) ||
            typeof slot.captain.name !== 'string' ||
            !slot.captain.name.trim()
          )
            err(ew, 'captain must be { name }');
          else if (slot.captain.name.length > 24) err(ew, 'captain.name is over 24 characters');
          if (slot.minRung !== undefined || slot.minAct !== undefined)
            err(ew, 'a captain is always in play (no minRung or minAct)');
          if (slot.hold !== undefined) err(ew, 'a captain never holds in a pack');
        }
        if (slot.hold !== undefined && !(isInt(slot.hold) && slot.hold >= 0))
          err(ew, 'hold must be a pack number >= 0');
        if (slot.wake !== undefined) {
          if (slot.hold === undefined) err(ew, 'wake needs a hold pack');
          else if (!(isInt(slot.wake) && slot.wake >= 2 && slot.wake <= MAX_WAKE_TURN))
            err(ew, `wake must be a turn from 2 to ${MAX_WAKE_TURN}`);
        }
        if (isInt(slot.hold)) {
          const turns = packWake.get(slot.hold) || new Set();
          turns.add(isInt(slot.wake) ? slot.wake : null);
          packWake.set(slot.hold, turns);
        }
        if (slot.hold !== undefined && slot.aiMode !== undefined)
          err(ew, 'hold and aiMode are exclusive (a holder holds)');
        if (slot.weapon !== undefined && !weaponNames.has(slot.weapon))
          err(ew, `unknown weapon "${slot.weapon}"`);
        if (!claim(ew, slot)) continue;
        for (const moveType of moveTypesOf(slot.classes))
          if (!standable(terrain, mapLayout, slot, moveType))
            err(ew, `a ${moveType} unit cannot stand on (${tileKey(slot)})`);
        if (!reachable(slot))
          err(ew, `(${tileKey(slot)}) cannot be reached from the player spawns`);
      }
      if (captains > 1) err(vw, 'has more than one captain');
      // A pack wakes as one: every member names the same wake turn, or none does.
      for (const [pack, turns] of packWake)
        if (turns.size > 1) err(vw, `hold pack ${pack} must share one wake turn`);

      const waves = variant.waves === undefined ? [] : variant.waves;
      if (!Array.isArray(waves)) err(vw, 'waves must be a list');
      for (const [wi, wave] of (Array.isArray(waves) ? waves : []).entries()) {
        const ww = `${vw}.waves[${wi}]`;
        if (!isObject(wave) || !isInt(wave.turn) || wave.turn < 1 || wave.turn > 20)
          err(ww, 'turn must be a whole number from 1 to 20');
        const list = Array.isArray(wave?.spawns) ? wave.spawns : [];
        if (list.length === 0) err(ww, 'needs at least one spawn');
        const waveTiles = new Set();
        for (const [si, spawn] of list.entries()) {
          const sw = `${ww}.spawns[${si}]`;
          if (!isObject(spawn)) {
            err(sw, 'must be an object');
            continue;
          }
          for (const key of Object.keys(spawn))
            if (!WAVE_SPAWN_KEYS.has(key)) err(sw, `unknown key "${key}"`);
          checkClasses(sw, spawn.classes);
          checkGates(sw, spawn);
          if (!inBounds(spawn)) {
            err(sw, `tile (${spawn.col},${spawn.row}) is out of bounds`);
            continue;
          }
          if (waveTiles.has(tileKey(spawn)))
            err(sw, `tile (${tileKey(spawn)}) is used twice in this wave`);
          waveTiles.add(tileKey(spawn));
          if (spawns.some((t) => tileKey(t) === tileKey(spawn)))
            err(sw, `tile (${tileKey(spawn)}) is a player spawn`);
          for (const moveType of moveTypesOf(spawn.classes))
            if (!standable(terrain, mapLayout, spawn, moveType))
              err(sw, `a ${moveType} unit cannot stand on (${tileKey(spawn)})`);
          if (!reachable(spawn))
            err(sw, `(${tileKey(spawn)}) cannot be reached from the player spawns`);
        }
      }
    }
  }

  // The events that name set pieces: a real id, and at every act and rung the event reaches,
  // each variant fields at least one foe and every slot in play keeps the rung's class gates.
  for (const ref of setPieceRefs(data.events)) {
    const where = `events: ${ref.where}`;
    const piece = findSetPiece(config, ref.setPiece);
    if (!piece) {
      err(where, `unknown set piece "${ref.setPiece}"`);
      continue;
    }
    const acts = Array.isArray(ref.event?.acts) && ref.event.acts.length ? ref.event.acts : ACT_IDS;
    for (const variant of piece.variants || []) {
      const all = [
        ...(variant.enemies || []).map((slot) => ({ slot, wave: false })),
        ...(variant.waves || []).flatMap((w) =>
          (w.spawns || []).map((slot) => ({ slot, wave: true })),
        ),
      ];
      for (const act of acts)
        for (const rung of DIFFICULTY_IDS) {
          const inPlay = all.filter(({ slot }) => slotInPlay(slot, { act, difficultyId: rung }));
          if (!inPlay.some(({ wave }) => !wave))
            err(where, `${piece.id}/${variant.id} fields no foe in ${act} on ${rung}`);
          for (const { slot } of inPlay) {
            const list = classesForAct(slot.classes, act);
            if (!list) {
              err(where, `${piece.id}/${variant.id}: a slot has no classes in ${act}`);
              continue;
            }
            for (const name of list) {
              const earliest = earliestByRung[rung]?.[name];
              if (earliest && !isActAtOrAfter(act, earliest))
                err(
                  where,
                  `${piece.id}/${variant.id}: ${name} in ${act} breaks ${rung}'s gate (${earliest})`,
                );
            }
          }
        }
    }
  }

  return { valid: errors.length === 0, errors };
}

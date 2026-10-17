// SetPieces.js - event set pieces (docs/specs/event-set-pieces.md): authored, scaled, seeded
// battle maps that an event's `battle` effect names (`setPiece`), so the fight looks like the
// story that started it. Pure: no Phaser, and no Math.random of its own: every draw comes from
// the `random` it is handed (MapGenerator passes the battle seed's stream, inside
// generateSeededBattle).
//
// data/setPieces.json
//   setPieces[]   { id, title, lore, objective, objectives?, acts?, biome?, fog?, deploy: { max },
//                   parBonus?, variants[] }
//   variant       { id, mirror?, map (AuthoredMap grammar), playerSpawns[], enemies[], waves?,
//                   vigil? }
//   enemy slot    { col, row, classes, level?, captain?: { name }, aiMode?, hold?, weapon?,
//                   minRung?, minAct?, id?, name?, target? }
//   boss slot     { col, row, boss: true, aiMode?, weapon? }
//   wave          { turn, spawns[]: { col, row, classes, level?, aiMode?, minRung?, minAct? } }
//   vigil         { sigils: [{ id, col, row, target, waking? }], circles: [{ id, col, row, voice }],
//                   maxCalled?, maxPerCircle? }
//
// Set pieces v2 (docs/specs/act-v-descent.md §9.2), for battle, elite and boss nodes as well as
// events:
// - `objective` is the legacy string (`rout` | `seize`); `objectives` is the large-maps model
//   (engine/BattleObjectives.js; its `defeat` kind), written into the config as is, with
//   `objective` its family (`rout`). Its target refs are slot `id`s or '@boss'.
// - `acts` (optional) lists the acts the set piece is fought in; a set piece fought only in
//   `finalBoss` may be up to 16x14. Without it, the events that name it say where it is fought.
// - A `boss: true` slot seats the battle's boss (SeatedBoss.resolveSeatedBoss, handed in as
//   `seatBoss`): at most one, always in play, its class, name, level and stones the seat's. It
//   keeps its two slot draws, and the class draw is the seat's one draw. It is fought only on a
//   node that seats a boss (no event names it: EventValidation), and never seats the Entity
//   (validateSetPieceAt: where the Entity is a candidate the node must pin `bossName`).
// - `id` gives a slot's unit an `authoredId` (what refs name); `name` names a unit that is not
//   a boss; `target: true` marks a unit a `defeat` objective counts (it needs an id and a name,
//   is always in play and never holds); `aiMode: 'post'` strikes from its tile and never walks
//   (SiegeArtillery.POST_AI_MODE).
// - A seize set piece has exactly one Throne, the boss slot on it, and no captain.
// - `vigil` (the Vigil's sigils and summoning circles, placed with the mirror) is written into
//   the config for the Vigil mechanic (engine/Vigil.js): a sigil's `waking: true` (at most one)
//   is the Waking's, whose word counts double; `maxCalled` / `maxPerCircle` cap the Hollowed
//   its circles call (Vigil.js holds the defaults). MapGenerator adds the battle's `levelRange`.
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

import { parseAuthoredMap, throneTiles } from './AuthoredMap.js';
import { DIFFICULTY_IDS, ENEMY_ACT_GATE_ORDER, isDifficultyAtLeast } from './DifficultyEngine.js';
import { ZOMBIE_CLASSES, isActAtOrAfter } from '../utils/constants.js';
import { REINFORCEMENT_CONTRACT_VERSION } from './MapTemplateEngine.js';
import { HOLD_AI_MODE } from './HoldDisturbance.js';
import { BOSS_REF, legacyObjectiveKind, objectivesShapeErrors } from './BattleObjectives.js';
import { captainLevelFor } from './CaptainLevel.js';
import { possibleSeats } from './SeatedBoss.js';

/** A set piece's config carries `templateId: 'setpiece:<id>'` (never a mapTemplates id). */
export const SET_PIECE_TEMPLATE_PREFIX = 'setpiece:';
/** Legacy objectives a set piece may name (`objectives` adds the model's kinds beside it). */
export const SET_PIECE_OBJECTIVES = Object.freeze(['rout', 'seize']);
/** Authored map bounds, in tiles. */
export const SET_PIECE_MAP_BOUNDS = Object.freeze({
  minCols: 6,
  minRows: 6,
  maxCols: 16,
  maxRows: 12,
});
/** A set piece fought only in `finalBoss` may be deeper (the Glass replaces a 16x14 arena). */
export const SET_PIECE_FINAL_MAP_BOUNDS = Object.freeze({ ...SET_PIECE_MAP_BOUNDS, maxRows: 14 });
/** Text limits: the place line on the battle card. */
export const SET_PIECE_TEXT_LIMITS = Object.freeze({ title: 30, lore: 140 });
/** A named unit's name (a captain's, a slot's `name`). */
const UNIT_NAME_MAX = 24;
/** Move types a player spawn must suit (fliers stand anywhere). */
const PLAYER_SPAWN_MOVE_TYPES = ['Infantry', 'Armored', 'Cavalry'];
/** Acts a set piece may be fought in (and its class tables and `minAct` gates may name). */
export const SET_PIECE_ACTS = ENEMY_ACT_GATE_ORDER;
const ACT_IDS = SET_PIECE_ACTS;
/** The acts an event reaches when it names none (EventSystem's default). */
const EVENT_ACT_IDS = ['act1', 'act2', 'act3', 'act4'];
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
  'id',
  'name',
  'target',
  'boss',
]);
/** What a boss slot may say: its tile, orders and weapon. The seat decides the rest. */
const BOSS_SLOT_KEYS = new Set(['col', 'row', 'boss', 'aiMode', 'weapon']);
/** Slot, sigil and circle ids. */
const AUTHORED_ID = /^[a-z][a-z0-9_]{0,23}$/;
const WAVE_SPAWN_KEYS = new Set(['col', 'row', 'classes', 'level', 'aiMode', 'minRung', 'minAct']);

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

/** Whether any variant of a set piece has a `boss: true` slot (it seats the battle's boss). */
export function hasBossSlot(piece) {
  return (Array.isArray(piece?.variants) ? piece.variants : []).some(
    (variant) => Array.isArray(variant?.enemies) && variant.enemies.some((s) => s?.boss === true),
  );
}

/** The set piece id a battle config was built from, or null for any other map. */
export function setPieceIdOfConfig(config) {
  const id = config?.templateId;
  return typeof id === 'string' && id.startsWith(SET_PIECE_TEMPLATE_PREFIX)
    ? id.slice(SET_PIECE_TEMPLATE_PREFIX.length)
    : null;
}

/** The map bounds a set piece's variants must keep (deeper when it is fought only in Act V). */
export function setPieceMapBounds(setPiece) {
  const acts = setPiece?.acts;
  return Array.isArray(acts) && acts.length > 0 && acts.every((act) => act === 'finalBoss')
    ? SET_PIECE_FINAL_MAP_BOUNDS
    : SET_PIECE_MAP_BOUNDS;
}

/**
 * The largest army a run can field: an act's deploy max (8 from Act IV) plus every deploy bonus
 * at once (Tactical Advantage +1, Scout Blessing +1, The Levy +2). A set piece may seat that many.
 */
export const SET_PIECE_MAX_DEPLOY = 12;

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

export { captainLevelFor };

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
  // The boss seat: its class draw is the seat's one draw (SeatedBoss.resolveSeatedBoss).
  if (slot.boss === true) {
    const seated = typeof ctx.seatBoss === 'function' ? ctx.seatBoss(classRoll) : null;
    return seated ? { ...seated, ...ctx.place(slot) } : null;
  }
  if (!slotInPlay(slot, ctx)) return null;
  const className = pickFrom(classesForAct(slot.classes, ctx.act), classRoll);
  if (!className) return null;
  const [lo, hi] = ctx.levelRange;
  const offset = isInt(slot.level) ? slot.level : 0;
  const rolled = slot.captain
    ? captainLevelFor(ctx.act, hi)
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
 * @param {(roll: number) => object|null} [options.seatBoss]  the boss slot's spawn fields
 *   ({ className, level, name, isBoss, revivalStones? }) from the seat's one draw; without it a
 *   boss slot seats nobody
 * @returns {{ variantId: string, mirrored: boolean, mapLayout: number[][], cols: number,
 *   rows: number, playerSpawns: object[], formationSpares: object[], enemySpawns: object[],
 *   reinforcements: object|null, thronePos: object|null, objectives: object|null,
 *   vigil: object|null }}
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
  seatBoss = null,
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
  const ctx = { act, difficultyId, levelRange: [lo, hi], classes, place, random, seatBoss };

  const spawnTiles = (variant.playerSpawns || []).map(place);
  const count = Math.max(1, Math.min(spawnTiles.length, Math.trunc(Number(deployCount) || 1)));
  const playerSpawns = spawnTiles.slice(0, count);
  const formationSpares = spawnTiles.slice(count);

  const enemySpawns = [];
  for (const slot of variant.enemies || []) {
    const resolved = resolveSlot(slot, ctx);
    if (!resolved) continue;
    const spawn = { ...resolved, isBoss: Boolean(slot.captain) || slot.boss === true };
    // A big body's tile is its top-left: mirrored, its far column becomes its first.
    const fp = classes.find((c) => c?.name === spawn.className)?.footprint;
    if (mirrored && fp?.width > 1) spawn.col -= fp.width - 1;
    if (slot.captain && typeof slot.captain.name === 'string') spawn.name = slot.captain.name;
    else if (typeof slot.name === 'string' && slot.name && slot.boss !== true)
      spawn.name = slot.name;
    if (typeof slot.id === 'string' && slot.id) spawn.authoredId = slot.id;
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

  // A seize set piece's throne: its one Throne tile, mirrored with the map.
  const thronePos = setPiece.objective === 'seize' ? throneTiles(mapLayout)[0] || null : null;
  const objectives = isObject(setPiece.objectives) ? structuredClone(setPiece.objectives) : null;
  const vigil = isObject(variant.vigil)
    ? {
        sigils: (variant.vigil.sigils || []).map((s) => ({
          id: s.id,
          target: s.target,
          ...place(s),
          ...(s.waking === true ? { waking: true } : {}),
        })),
        circles: (variant.vigil.circles || []).map((c) => ({
          id: c.id,
          voice: c.voice,
          ...place(c),
        })),
        ...(isInt(variant.vigil.maxCalled) ? { maxCalled: variant.vigil.maxCalled } : {}),
        ...(isInt(variant.vigil.maxPerCircle) ? { maxPerCircle: variant.vigil.maxPerCircle } : {}),
        ...(variant.vigil.wards === true ? { wards: true } : {}),
        ...(variant.vigil.choir === true ? { choir: true } : {}),
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
    thronePos,
    objectives,
    vigil,
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
 * What breaks a set piece at one act and rung, as messages (none: it can be fought there). The
 * events that name a set piece and a set piece's own `acts` run it, and a route that names set
 * pieces (the Descent's validator) calls it per (set piece, act, rung): the act is one the set
 * piece allows, each variant fields at least one foe, every slot in play has classes in that act
 * and none breaks the rung's class gate (`enemyClassEarliestAct`), and a boss slot has a boss to
 * seat (enemies.json `bosses.<act>`, when `data.enemies` is given).
 *
 * A boss slot never seats the Entity: a single tile holds none of its 3x3 form, gear or finale.
 * `seat` is the fighting node's say in who sits (SeatedBoss.possibleSeats reads it as battle
 * params): `bossName` pins a boss, `isElite` / `isBoss` the node's kind (unset: either kind). Any
 * definition the seat could hold at this act and rung that is the Entity is refused, so a node
 * that fights the piece where the Entity is a candidate (finalBoss on Nightfall and Black Sun)
 * must pin another boss by name. An event never pins (`{}`, the default). `null` is the set
 * piece's own `acts` check: no node fights it there, and the node that names it is checked with
 * its own seat.
 * @param {object} piece  a data/setPieces.json entry
 * @param {string} act
 * @param {string} rung   a difficulty id
 * @param {{ difficulty?: object, enemies?: object, classes?: object[] }} data
 * @param {{ bossName?: string, isElite?: boolean, isBoss?: boolean }|null} [seat]
 * @returns {string[]}
 */
export function validateSetPieceAt(piece, act, rung, data = {}, seat = {}) {
  const errors = [];
  const id = piece?.id;
  if (Array.isArray(piece?.acts) && piece.acts.length > 0 && !piece.acts.includes(act))
    errors.push(`${id} is not fought in ${act} (its acts: ${piece.acts.join(', ')})`);
  const earliestByClass = data.difficulty?.modes?.[rung]?.enemyClassEarliestAct || {};
  for (const variant of Array.isArray(piece?.variants) ? piece.variants : []) {
    const all = [
      ...(variant.enemies || []).map((slot) => ({ slot, wave: false })),
      ...(variant.waves || []).flatMap((w) =>
        (w.spawns || []).map((slot) => ({ slot, wave: true })),
      ),
    ];
    const inPlay = all.filter(({ slot }) => slotInPlay(slot, { act, difficultyId: rung }));
    if (!inPlay.some(({ wave }) => !wave))
      errors.push(`${id}/${variant.id} fields no foe in ${act} on ${rung}`);
    for (const { slot } of inPlay) {
      if (slot?.boss === true) {
        if (data.enemies && !(data.enemies.bosses?.[act]?.length > 0))
          errors.push(`${id}/${variant.id}: its boss slot has no boss to seat in ${act}`);
        else if (data.enemies && seat !== null && seatCouldBeEntity(act, rung, data, seat))
          errors.push(
            `${id}/${variant.id}: its boss slot could seat the Entity in ${act} on ${rung}; ` +
              'a node that fights it there must name another boss (bossName)',
          );
        continue;
      }
      const list = classesForAct(slot?.classes, act);
      if (!list) {
        errors.push(`${id}/${variant.id}: a slot has no classes in ${act}`);
        continue;
      }
      for (const name of list) {
        const earliest = earliestByClass[name];
        if (earliest && !isActAtOrAfter(act, earliest))
          errors.push(`${id}/${variant.id}: ${name} in ${act} breaks ${rung}'s gate (${earliest})`);
      }
    }
  }
  return errors;
}

/** Whether a boss seat at this act and rung could hold the Entity (see validateSetPieceAt). */
function seatCouldBeEntity(act, rung, data, seat) {
  const kinds = typeof seat.isElite === 'boolean' ? [seat.isElite] : [false, true];
  return kinds.some((isElite) =>
    possibleSeats(
      { act, difficultyId: rung, bossName: seat.bossName, isElite, isBoss: seat.isBoss === true },
      { enemies: data.enemies, classes: data.classes || [] },
    ).some((boss) => boss?.isEntity === true),
  );
}

/**
 * Validate data/setPieces.json against the game data (and the events that name set pieces).
 * Every set piece is checked whether or not anything names it; one that declares `acts` is also
 * checked at each of its acts and every rung (validateSetPieceAt), as an event's set piece is at
 * the acts the event reaches.
 * @param {object} config  data/setPieces.json
 * @param {{ terrain, classes, weapons, difficulty, events, enemies? }} data
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

  /** Every class name a slot's classes field can roll. */
  const classNamesOf = (classesField) => {
    const lists = Array.isArray(classesField)
      ? [classesField]
      : isObject(classesField)
        ? Object.values(classesField)
        : [];
    return lists.flatMap((list) => (Array.isArray(list) ? list : []));
  };
  /** Tiles a class list's move types can all stand on. */
  // A slot whose classes fill more than one tile (classes.json `footprint`: the Iron Guardian):
  // every class it may draw must share the one body, or the tiles it claims would depend on the
  // draw. Returns { width, height } (1x1 for plain classes), or null after reporting a mix.
  const bodyOf = (where, classesField) => {
    const sizes = new Set();
    for (const name of classNamesOf(classesField)) {
      const fp = classByName.get(name)?.footprint;
      sizes.add(fp ? `${fp.width}x${fp.height}` : '1x1');
    }
    if (sizes.size > 1) {
      err(where, 'its classes must share one body size');
      return null;
    }
    const [w, h] = (sizes.values().next().value || '1x1').split('x').map(Number);
    return { width: w, height: h };
  };
  const bodyTiles = (slot, body) => {
    const tiles = [];
    for (let dr = 0; dr < body.height; dr++)
      for (let dc = 0; dc < body.width; dc++)
        tiles.push({ col: slot.col + dc, row: slot.row + dr });
    return tiles;
  };

  const moveTypesOf = (classesField) => {
    const types = new Set();
    for (const name of classNamesOf(classesField))
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
    // The objectives model (BattleObjectives.js): its shape, and the legacy string its family.
    const objectives = piece.objectives === undefined ? null : piece.objectives;
    const defeatRefs = new Set();
    if (objectives !== null) {
      const shape = objectivesShapeErrors(objectives);
      for (const message of shape) err(pw, message);
      if (shape.length === 0) {
        const legacy = legacyObjectiveKind(objectives);
        if (piece.objective !== legacy)
          err(pw, `objective must be "${legacy}", the family of its objectives' first kind`);
        for (const objective of objectives.primary)
          if (objective.kind === 'defeat') for (const ref of objective.targets) defeatRefs.add(ref);
      }
    }
    if (piece.acts !== undefined) {
      if (!Array.isArray(piece.acts) || piece.acts.length === 0)
        err(pw, 'acts must be a non-empty list of act ids');
      else {
        for (const act of piece.acts)
          if (!ACT_IDS.includes(act)) err(pw, `acts: "${act}" is not an act`);
        if (new Set(piece.acts).size !== piece.acts.length) err(pw, 'acts names an act twice');
      }
    }
    if (piece.fog !== undefined && typeof piece.fog !== 'boolean')
      err(pw, 'fog must be true or false (omit it to keep the event roll)');
    if (piece.biome !== undefined && piece.biome !== null && typeof piece.biome !== 'string')
      err(pw, 'biome must be a template biome or null');
    if (piece.parBonus !== undefined && !(isInt(piece.parBonus) && piece.parBonus >= 0))
      err(pw, 'parBonus must be a whole number >= 0');
    const cap = setPieceDeployCap(piece);
    if (!cap || cap > SET_PIECE_MAX_DEPLOY)
      err(pw, `deploy.max must be a whole number from 1 to ${SET_PIECE_MAX_DEPLOY}`);
    const variants = Array.isArray(piece.variants) ? piece.variants : [];
    if (variants.length === 0 || variants.length > 3) err(pw, 'needs 1 to 3 variants');
    const variantIds = new Set();
    const bounds = setPieceMapBounds(piece);

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
      const b = bounds;
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
      const bossSlots = [];
      const slotIds = new Map();
      const targetSlots = new Map();
      const packWake = new Map();
      for (const [ei, slot] of enemies.entries()) {
        const ew = `${vw}.enemies[${ei}]`;
        if (!isObject(slot)) {
          err(ew, 'must be an object');
          continue;
        }
        if (slot.boss !== undefined && slot.boss !== true) err(ew, 'boss must be true or absent');
        // A boss slot names its tile, orders and weapon; the seat (SeatedBoss.js) is the rest.
        if (slot.boss === true) {
          bossSlots.push(slot);
          for (const key of Object.keys(slot))
            if (!BOSS_SLOT_KEYS.has(key))
              err(ew, `a boss slot takes no "${key}" (the seat decides)`);
          if (slot.aiMode !== undefined && typeof slot.aiMode !== 'string')
            err(ew, 'aiMode must be a string');
          if (slot.weapon !== undefined && !weaponNames.has(slot.weapon))
            err(ew, `unknown weapon "${slot.weapon}"`);
          if (!claim(ew, slot)) continue;
          // The seat may be any boss: every walking move type must stand there.
          for (const moveType of PLAYER_SPAWN_MOVE_TYPES)
            if (!standable(terrain, mapLayout, slot, moveType))
              err(ew, `a ${moveType} boss cannot stand on (${tileKey(slot)})`);
          if (!reachable(slot))
            err(ew, `(${tileKey(slot)}) cannot be reached from the player spawns`);
          continue;
        }
        for (const key of Object.keys(slot))
          if (!SLOT_KEYS.has(key)) err(ew, `unknown key "${key}"`);
        checkClasses(ew, slot.classes);
        checkGates(ew, slot);
        if (slot.id !== undefined) {
          if (typeof slot.id !== 'string' || !AUTHORED_ID.test(slot.id))
            err(ew, 'id must be lower_snake_case, at most 24 characters');
          else if (slotIds.has(slot.id)) err(ew, `id "${slot.id}" is used twice`);
          else slotIds.set(slot.id, slot);
        }
        if (slot.name !== undefined) {
          if (typeof slot.name !== 'string' || !slot.name.trim()) err(ew, 'name must be a string');
          else if (slot.name.length > UNIT_NAME_MAX)
            err(ew, `name is over ${UNIT_NAME_MAX} characters`);
          if (slot.captain !== undefined) err(ew, 'a captain is named by captain.name');
        }
        if (slot.target !== undefined) {
          if (slot.target !== true) err(ew, 'target must be true or absent');
          else {
            if (typeof slot.id !== 'string')
              err(ew, 'a target needs an id (the ref that names it)');
            else targetSlots.set(slot.id, slot);
            if (typeof slot.name !== 'string') err(ew, 'a target needs a name');
            if (slot.minRung !== undefined || slot.minAct !== undefined)
              err(ew, 'a target is always in play (no minRung or minAct)');
            if (slot.hold !== undefined) err(ew, 'a target never holds in a pack');
            if (slot.captain !== undefined)
              err(ew, `a captain is not a target (name it with "${BOSS_REF}")`);
            // A fallen Zombie rises as a nameless one: a target must stay down when it falls.
            for (const name of classNamesOf(slot.classes))
              if (ZOMBIE_CLASSES.has(name)) err(ew, `a target cannot be a ${name} (it would rise)`);
          }
        }
        if (slot.captain !== undefined) {
          captains++;
          if (
            !isObject(slot.captain) ||
            typeof slot.captain.name !== 'string' ||
            !slot.captain.name.trim()
          )
            err(ew, 'captain must be { name }');
          else if (slot.captain.name.length > UNIT_NAME_MAX)
            err(ew, `captain.name is over ${UNIT_NAME_MAX} characters`);
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
        const body = bodyOf(ew, slot.classes);
        if (!body) continue;
        const big = body.width > 1 || body.height > 1;
        if (
          big &&
          (slot.hold !== undefined || slot.minRung !== undefined || slot.minAct !== undefined)
        )
          err(ew, 'a big body is always in play and never holds in a pack');
        // Every tile of its body is claimed and must take it; one of them must be reachable.
        const tiles = bodyTiles(slot, body);
        if (!tiles.every((t) => claim(ew, t))) continue;
        for (const t of tiles)
          for (const moveType of moveTypesOf(slot.classes))
            if (!standable(terrain, mapLayout, t, moveType))
              err(ew, `a ${moveType} unit cannot stand on (${tileKey(t)})`);
        if (!tiles.some(reachable))
          err(ew, `(${tileKey(slot)}) cannot be reached from the player spawns`);
      }
      if (captains > 1) err(vw, 'has more than one captain');
      if (bossSlots.length > 1) err(vw, 'has more than one boss slot');
      if (bossSlots.length > 0 && captains > 0)
        err(vw, 'has a boss slot and a captain (one boss per map)');
      // A pack wakes as one: every member names the same wake turn, or none does.
      for (const [pack, turns] of packWake)
        if (turns.size > 1) err(vw, `hold pack ${pack} must share one wake turn`);

      // Seize: one Throne, the seated boss on it, no captain (the boss holds the seat).
      if (piece.objective === 'seize') {
        const thrones = throneTiles(mapLayout);
        if (thrones.length !== 1)
          err(vw, `a seize map needs exactly one Throne (has ${thrones.length})`);
        if (bossSlots.length !== 1) err(vw, 'a seize map needs a boss slot');
        else if (thrones.length === 1 && tileKey(bossSlots[0]) !== tileKey(thrones[0]))
          err(vw, `the boss slot must stand on the Throne (${tileKey(thrones[0])})`);
        if (captains > 0) err(vw, 'a seize map has no captain (its boss slot holds the throne)');
      }
      // Defeat targets: every ref resolves in this variant, and every target counts somewhere.
      for (const ref of defeatRefs) {
        if (ref === BOSS_REF) {
          if (bossSlots.length === 0 && captains === 0)
            err(vw, `"${BOSS_REF}" is a target but no boss slot or captain stands here`);
        } else if (!targetSlots.has(ref))
          err(vw, `target "${ref}" names no slot with that id and target: true`);
      }
      for (const id of targetSlots.keys())
        if (!defeatRefs.has(id)) err(vw, `target "${id}" counts for no defeat objective`);

      checkVigil(vw, variant.vigil, {
        err,
        inBounds,
        reach,
        terrain,
        mapLayout,
        targetSlots,
        unitTiles: new Set(taken.keys()),
      });

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
          const waveBody = bodyOf(sw, spawn.classes);
          if (waveBody && (waveBody.width > 1 || waveBody.height > 1))
            err(sw, 'a wave never brings a big body (it is placed with the map)');
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

    // A set piece that says where it is fought: every act it names, on every rung. No node
    // fights it here, so its boss seat is left to the node that names it (seat null).
    if (Array.isArray(piece.acts))
      for (const act of piece.acts.filter((a) => ACT_IDS.includes(a)))
        for (const rung of DIFFICULTY_IDS)
          for (const message of validateSetPieceAt(piece, act, rung, data, null)) err(pw, message);
  }

  // The events that name set pieces: a real id, and at every act and rung the event reaches,
  // each variant fields at least one foe and every slot in play keeps the rung's class gates
  // (an event never pins a boss; EventValidation refuses an event naming a boss slot at all).
  for (const ref of setPieceRefs(data.events)) {
    const where = `events: ${ref.where}`;
    const piece = findSetPiece(config, ref.setPiece);
    if (!piece) {
      err(where, `unknown set piece "${ref.setPiece}"`);
      continue;
    }
    const eventActs =
      Array.isArray(ref.event?.acts) && ref.event.acts.length ? ref.event.acts : EVENT_ACT_IDS;
    for (const act of eventActs)
      for (const rung of DIFFICULTY_IDS)
        for (const message of validateSetPieceAt(piece, act, rung, data)) err(where, message);
  }

  return { valid: errors.length === 0, errors };
}

/** The keys a variant's `vigil` may carry. */
const VIGIL_KEYS = Object.freeze([
  'sigils',
  'circles',
  'maxCalled',
  'maxPerCircle',
  'wards',
  'choir',
]);

/**
 * A variant's Vigil (docs/specs/act-v-descent.md §3.1): each sigil stands under its target (a
 * `target: true` slot), each circle names a target as its voice and is a free, Infantry-standable
 * tile the army can reach (a unit may stand on it to block it). Ids are unique.
 */
function checkVigil(
  vw,
  vigil,
  { err, inBounds, reach, terrain, mapLayout, targetSlots, unitTiles },
) {
  if (vigil === undefined) return;
  const at = `${vw}.vigil`;
  if (!isObject(vigil)) {
    err(at, 'must be { sigils, circles }');
    return;
  }
  for (const key of Object.keys(vigil))
    if (!VIGIL_KEYS.includes(key)) err(at, `unknown key "${key}"`);
  // The caps (Vigil.js reads them; a missing one takes its default there).
  for (const key of ['maxCalled', 'maxPerCircle'])
    if (vigil[key] !== undefined && !(isInt(vigil[key]) && vigil[key] >= 1 && vigil[key] <= 32))
      err(at, `${key} must be a whole number from 1 to 32`);
  // The shields (Vigil.js): a Voice warded by its circles, the Waking by the choir.
  for (const key of ['wards', 'choir'])
    if (vigil[key] !== undefined && typeof vigil[key] !== 'boolean')
      err(at, `${key} must be true or false`);
  const ids = new Set();
  const tiles = new Set();
  const claimId = (where, id) => {
    if (typeof id !== 'string' || !AUTHORED_ID.test(id))
      err(where, 'id must be lower_snake_case, at most 24 characters');
    else if (ids.has(id)) err(where, `id "${id}" is used twice`);
    else ids.add(id);
  };
  const sigils = vigil.sigils === undefined ? [] : vigil.sigils;
  const circles = vigil.circles === undefined ? [] : vigil.circles;
  if (!Array.isArray(sigils)) err(at, 'sigils must be a list');
  if (!Array.isArray(circles)) err(at, 'circles must be a list');
  for (const [i, sigil] of (Array.isArray(sigils) ? sigils : []).entries()) {
    const sw = `${at}.sigils[${i}]`;
    if (!isObject(sigil)) {
      err(sw, 'must be an object');
      continue;
    }
    claimId(sw, sigil.id);
    if (sigil.waking !== undefined && typeof sigil.waking !== 'boolean')
      err(sw, 'waking must be true or false');
    if (!inBounds(sigil)) {
      err(sw, `tile (${sigil.col},${sigil.row}) is out of bounds`);
      continue;
    }
    if (tiles.has(tileKey(sigil)))
      err(sw, `tile (${tileKey(sigil)}) holds another sigil or circle`);
    tiles.add(tileKey(sigil));
    const target = targetSlots.get(sigil.target);
    if (!target) err(sw, `target "${sigil.target}" names no slot with that id and target: true`);
    else if (tileKey(target) !== tileKey(sigil))
      err(sw, `its target "${sigil.target}" must stand on it (${tileKey(sigil)})`);
  }
  if (Array.isArray(sigils) && sigils.filter((sigil) => sigil?.waking === true).length > 1)
    err(at, 'at most one sigil is the Waking (waking: true)');
  for (const [i, circle] of (Array.isArray(circles) ? circles : []).entries()) {
    const cw = `${at}.circles[${i}]`;
    if (!isObject(circle)) {
      err(cw, 'must be an object');
      continue;
    }
    claimId(cw, circle.id);
    if (!targetSlots.has(circle.voice))
      err(cw, `voice "${circle.voice}" names no slot with that id and target: true`);
    if (!inBounds(circle)) {
      err(cw, `tile (${circle.col},${circle.row}) is out of bounds`);
      continue;
    }
    const key = tileKey(circle);
    if (tiles.has(key)) err(cw, `tile (${key}) holds another sigil or circle`);
    tiles.add(key);
    if (unitTiles.has(key)) err(cw, `tile (${key}) is a spawn: a circle starts empty`);
    if (!standable(terrain, mapLayout, circle, 'Infantry'))
      err(cw, `an Infantry unit cannot stand on (${key})`);
    else if (!reach.has(key)) err(cw, `(${key}) cannot be reached from the player spawns`);
  }
  // A warded Voice with no circle could never be hurt; a choir needs its Waking.
  if (vigil.wards === true && Array.isArray(sigils) && Array.isArray(circles))
    for (const sigil of sigils)
      if (isObject(sigil) && !circles.some((c) => isObject(c) && c.voice === sigil.target))
        err(at, `wards: the Voice "${sigil.target}" has no circle to break`);
  if (vigil.choir === true && Array.isArray(sigils) && !sigils.some((s) => s?.waking === true))
    err(at, 'choir needs a Waking sigil (waking: true)');
}

// Descent.js - Act V, the Descent (docs/specs/act-v-descent.md §2, §9.1, §9.3): the final act's
// authored route, one per rung group, from data/descent.json. Pure: no Phaser, no Math.random,
// no node-map stream. Modelled on Prologue.buildPrologueNodeMap.
//
// data/descent.json
//   { version: 1, enabled, routeByRung: { <rung>: <route id> }, routes: { <id>: Route }, rite }
//   Route  { finale: 'lieutenant' | 'entity', levelOffset: [lo, hi], rows: [{ nodes: [Slot] }] }
//   Slot   NodeSpec | { oneOf: [NodeSpec, ...], weights?: [n, ...], edges?: [key, ...] }
//   NodeSpec { key, type: battle | event | ruins | boss, setPiece? | templateId?, objective?,
//              elite?, eventPool?, boss?, bossRole?: gate | finale, riteTarget?, fallable?,
//              title?, preview?, bossLine?, edges? }
//   rite   the Rite's numbers (§4): engine/Rite.js reads and validates them.
//
// The route the run takes: `routeByRung[difficultyId]`, only while `enabled` and only in the
// final act of a standard run (RunManager._buildActNodeMap; anything else builds today's map).
//
// The map (the shape generateNodeMap returns, plus `descent: { v, routeId, finale }`):
// - node ids `finalBoss_<row>_<col>` (ids key the battle stream, the Eclipse's thresholds and the
//   locked maps); columns: one node -> 2, two -> 1 and 3, three -> 1, 2 and 3;
// - edges: every node to every node of the next row when either row has one node (they converge
//   or diverge from one point, as the generator's lanes do), otherwise the slot's own `edges`
//   (next-row keys), within one lane and never crossing (NodeMapGenerator.edgeCrosses);
// - a node's battle seed is keyedBattleRandom(runSeed, 'descent-node:<id>'), and a `oneOf` slot
//   picks its node on keyedBattleRandom(runSeed, 'descent-row:<route>:<row>:<slot>'): the same
//   run seed always builds the same route, and no other stream moves;
// - a battle or boss node that names a set piece goes through convertNodeToSetPieceBattle with
//   that seed and fixed fog (the set piece's, else none): nothing is drawn; a boss node on a
//   template (the Entity's eldritch_sanctum) keeps no levelRange, so its escorts take the act's
//   pool range exactly as today's final boss does;
// - battles' levelRange is the act before the Descent's late-row range (ACT_LEVEL_SCALING
//   `default`: First Light's Act III, everyone else's Act IV) plus the route's `levelOffset`;
// - every node is stamped `authored: 'descent'` and `descentKey`, and carries its `title`,
//   `preview` and (a boss) `bossLine`; boss nodes carry `battleParams.bossName` and `bossRole`.
//
// A boss node with `bossRole: 'gate'` (the Lieutenant on Nightfall and Black Sun) is a boss fight
// that does not end the act: its id is never the map's `bossNodeId`, so every reader that keys
// on that id (isActComplete, the act boss's Vision, the Eclipse's relief, the earned pick) passes
// it by; what it does instead is §9.3's table (isGateBossNode and its callers).
//
// The Eclipse never takes an authored node unless its spec says `fallable: true` (only the
// Mortuary Column): EclipseSystem.nodeFallExemption. Pilgrim's Road, a start gift's fall and the
// Cartographer's route edits skip authored nodes.

import { NODE_TYPES } from '../utils/constants.js';
import { keyedBattleRandom } from './BattleRng.js';
import { DIFFICULTY_IDS } from './DifficultyEngine.js';
import { actLevelScaling, convertNodeToSetPieceBattle, edgeCrosses } from './NodeMapGenerator.js';
import { findSetPiece, validateSetPieceAt, validateSetPiecesConfig } from './SetPieces.js';
import { BOSS_REF } from './BattleObjectives.js';
import { riteTargetOfBoss, validateRiteConfig } from './Rite.js';
import { isDescentEnabled } from './DescentSwitch.js';

/** The act the Descent is (ids are save data: the act stays `finalBoss`). */
export const DESCENT_ACT_ID = 'finalBoss';
/** data/descent.json's version. */
export const DESCENT_CONFIG_VERSION = 1;
/** `nodeMap.descent.v`: the shape of a built Descent map. */
export const DESCENT_MAP_VERSION = 1;
/** Every Descent node's `authored` stamp. */
export const DESCENT_AUTHORED = 'descent';
/** Where a route ends. */
export const DESCENT_FINALES = Object.freeze(['lieutenant', 'entity']);
/** A boss node's role: a gate opens the way on, the finale ends the run. */
export const BOSS_ROLES = Object.freeze(['gate', 'finale']);
/** The node types a route may name. */
export const DESCENT_NODE_TYPES = Object.freeze([
  NODE_TYPES.BATTLE,
  NODE_TYPES.EVENT,
  NODE_TYPES.RUINS,
  NODE_TYPES.BOSS,
]);
/** The objectives a node may fight its set piece for: its own seize, or a defeat of its boss. */
export const DESCENT_SET_PIECE_OBJECTIVES = Object.freeze(['seize', 'defeat']);
/** A node's text limits (the loom card). */
export const DESCENT_TEXT_LIMITS = Object.freeze({ title: 30, preview: 160, bossLine: 90 });
/** The most nodes a row may hold. */
const MAX_ROW_NODES = 3;
/** Columns by how many nodes the row holds (the generator's five lanes, centred). */
const COLUMNS_BY_COUNT = Object.freeze({ 1: [2], 2: [1, 3], 3: [1, 2, 3] });
/** The objectives model a `defeat` node fights: every living boss (BattleObjectives.js). */
export const DEFEAT_BOSS_OBJECTIVES = Object.freeze({
  version: 1,
  primary: Object.freeze([Object.freeze({ id: 'boss', kind: 'defeat', targets: [BOSS_REF] })]),
});

const NODE_SPEC_KEYS = new Set([
  'key',
  'type',
  'setPiece',
  'templateId',
  'objective',
  'elite',
  'eventPool',
  'boss',
  'bossRole',
  'riteTarget',
  'fallable',
  'title',
  'preview',
  'bossLine',
  'edges',
]);
/** Keys only one node type may carry. */
const KEYS_BY_TYPE = Object.freeze({
  setPiece: [NODE_TYPES.BATTLE, NODE_TYPES.BOSS],
  templateId: [NODE_TYPES.BATTLE, NODE_TYPES.BOSS],
  objective: [NODE_TYPES.BATTLE, NODE_TYPES.BOSS],
  elite: [NODE_TYPES.BATTLE],
  fallable: [NODE_TYPES.BATTLE],
  eventPool: [NODE_TYPES.EVENT],
  boss: [NODE_TYPES.BOSS],
  bossRole: [NODE_TYPES.BOSS],
  bossLine: [NODE_TYPES.BOSS],
});
const SLOT_KEYS = new Set(['oneOf', 'weights', 'edges']);
const ID = /^[a-z][a-z0-9_]{0,31}$/;

const isObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);

// ── Which route ─────────────────────────────────────────────────────────

/**
 * The route a run on this rung takes, or null: the config is switched on (`enabled: true`, read
 * through DescentSwitch.isDescentEnabled, the flag's one reader) and names a route for the rung
 * that it holds.
 */
export function descentRouteIdFor(config, difficultyId) {
  if (!isObject(config) || !isDescentEnabled({ descent: config })) return null;
  const id = config.routeByRung?.[difficultyId];
  return typeof id === 'string' && isObject(config.routes?.[id]) ? id : null;
}

/** True when a built route map is the Descent's (an old save's 2-node Act V is not). */
export function isDescentMap(nodeMap) {
  return isObject(nodeMap?.descent) && nodeMap.descent.v === DESCENT_MAP_VERSION;
}

/** True for a node the Descent's route placed (its passes and the Eclipse leave it alone). */
export function isAuthoredNode(node) {
  return node?.authored === DESCENT_AUTHORED;
}

// ── Boss roles ──────────────────────────────────────────────────────────

/** True when battle params name a gate boss (a boss fight that does not end the act). */
export function isGateBossParams(params) {
  return params?.bossRole === 'gate';
}

/**
 * True when `node` is this run's gate boss: a boss node, `bossRole: 'gate'`, never the map's
 * `bossNodeId` (the act's own end).
 */
export function isGateBossNode(run, node) {
  return (
    node?.type === NODE_TYPES.BOSS &&
    isGateBossParams(node.battleParams) &&
    node.id !== run?.nodeMap?.bossNodeId
  );
}

/**
 * True when a boss node is the run's last fight (the final-boss art): its `bossRole` says so on
 * a Descent map; a node without a role (today's maps, an old save) is the finale when the act is.
 */
export function isFinaleBossNode(node, actId) {
  if (node?.type !== NODE_TYPES.BOSS) return false;
  const role = node.battleParams?.bossRole;
  if (typeof role === 'string') return role === 'finale';
  return actId === DESCENT_ACT_ID;
}

// ── Loot ────────────────────────────────────────────────────────────────

/**
 * The act whose loot tables a battle's random reward draws from (§2.3 rule 3): in the Descent,
 * the act before it (Act IV, First Light's Act III), since `lootTables.finalBoss` pays gold only;
 * everywhere else, and on an old save's 2-node Act V, the current act.
 */
export function lootActFor(run) {
  const act = run?.currentAct;
  if (act !== DESCENT_ACT_ID || !isDescentMap(run?.nodeMap)) return act;
  return actBefore(run.actSequence) || 'act4';
}

function actBefore(actSequence) {
  const acts = Array.isArray(actSequence) ? actSequence : [];
  const at = acts.indexOf(DESCENT_ACT_ID);
  return at > 0 ? acts[at - 1] : null;
}

// ── The map ─────────────────────────────────────────────────────────────

/** A Descent node's fixed battle seed: from the run seed and its id, never Math.random. */
export function descentNodeBattleSeed(runSeed, nodeId) {
  const draw = keyedBattleRandom(Math.trunc(Number(runSeed) || 0) >>> 0, `descent-node:${nodeId}`);
  return Math.trunc(draw() * 0x100000000) >>> 0;
}

/**
 * A route's battle level range: the act before the Descent's late-row range plus the route's
 * `levelOffset`, never below 1. Null when that act has no range (the pool's then applies).
 */
export function descentLevelRange(route, actSequence) {
  const base = actLevelScaling(actBefore(actSequence) || 'act4')?.default;
  if (!Array.isArray(base)) return null;
  const [lo, hi] = Array.isArray(route?.levelOffset) ? route.levelOffset : [0, 0];
  const low = Math.max(1, base[0] + (Math.trunc(Number(lo)) || 0));
  return [low, Math.max(low, base[1] + (Math.trunc(Number(hi)) || 0))];
}

/** The NodeSpecs a slot can be (one, or its `oneOf`). */
function slotSpecs(slot) {
  return Array.isArray(slot?.oneOf) ? slot.oneOf : [slot];
}

/** The node a slot holds for this run: itself, or its `oneOf` pick on its own keyed stream. */
export function pickSlotSpec(slot, { runSeed, routeId, row, index }) {
  if (!Array.isArray(slot?.oneOf)) return slot;
  const options = slot.oneOf;
  const weights = options.map((_, i) => {
    const w = Number(slot.weights?.[i]);
    return Number.isFinite(w) && w > 0 ? w : Array.isArray(slot.weights) ? 0 : 1;
  });
  const total = weights.reduce((sum, w) => sum + w, 0);
  const rand = keyedBattleRandom(
    Math.trunc(Number(runSeed) || 0) >>> 0,
    `descent-row:${routeId}:${row}:${index}`,
  );
  let target = rand() * total;
  for (let i = 0; i < options.length; i++) {
    target -= weights[i];
    if (target < 0 && weights[i] > 0) return options[i];
  }
  return options[weights.findLastIndex((w) => w > 0)] || options[0];
}

/** The next-row keys a slot's edges name (on the slot, or on its plain NodeSpec). */
function slotEdges(slot) {
  return Array.isArray(slot?.edges) ? slot.edges : [];
}

/** Which slot of a row a key names (any of a `oneOf` slot's keys names it). */
function slotIndexOfKey(row, key) {
  return (row?.nodes || []).findIndex((slot) => slotSpecs(slot).some((spec) => spec?.key === key));
}

/** The battle params a node's objective adds over its set piece's (a defeat of its boss). */
function objectiveParams(spec) {
  if (spec.objective !== 'defeat') return {};
  return { objective: 'rout', objectives: structuredClone(DEFEAT_BOSS_OBJECTIVES) };
}

/** The route card's line naming a boss node's boss: the spec's, else "<name> · <class>". */
function bossLineFor(spec, bosses) {
  if (typeof spec.bossLine === 'string' && spec.bossLine.trim()) return spec.bossLine;
  const def = (bosses || []).find((b) => b?.name === spec.boss);
  return def ? [def.name, def.className].filter(Boolean).join(' · ') : spec.boss || null;
}

/**
 * Build a route's node map (the generateNodeMap shape). The config is assumed valid
 * (validateDescentConfig; `npm run validate:data`); a missing set piece or route throws.
 * @param {object} config data/descent.json
 * @param {{ runSeed: number, difficultyId: string, actSequence: string[], gameData: object,
 *   routeId?: string }} options `routeId` overrides the rung's (tests)
 * @returns {{ actId: string, nodes: object[], startNodeId: string, bossNodeId: string,
 *   descent: { v: number, routeId: string, finale: string } }}
 */
export function buildDescentNodeMap(config, options = {}) {
  const { runSeed = 0, difficultyId = 'normal', actSequence = [], gameData = {} } = options;
  const routeId = options.routeId || config?.routeByRung?.[difficultyId];
  const route = config?.routes?.[routeId];
  if (!isObject(route) || !Array.isArray(route.rows) || route.rows.length < 2)
    throw new Error(`Descent route "${routeId}" is not authored`);
  const levelRange = descentLevelRange(route, actSequence);
  const bosses = gameData?.enemies?.bosses?.[DESCENT_ACT_ID] || [];
  const nodes = [];
  const rowNodes = route.rows.map((row, r) => {
    const slots = Array.isArray(row?.nodes) ? row.nodes : [];
    const cols = COLUMNS_BY_COUNT[slots.length];
    if (!cols) throw new Error(`Descent route "${routeId}" row ${r} holds ${slots.length} nodes`);
    return slots.map((slot, i) => {
      const spec = pickSlotSpec(slot, { runSeed, routeId, row: r, index: i });
      const node = buildNode(spec, {
        id: `${DESCENT_ACT_ID}_${r}_${cols[i]}`,
        row: r,
        col: cols[i],
        runSeed,
        levelRange,
        bosses,
        gameData,
      });
      nodes.push(node);
      return node;
    });
  });
  for (let r = 0; r < rowNodes.length - 1; r++) {
    const upper = rowNodes[r];
    const lower = rowNodes[r + 1];
    if (upper.length === 1 || lower.length === 1) {
      for (const from of upper) for (const to of lower) from.edges.push(to.id);
      continue;
    }
    route.rows[r].nodes.forEach((slot, i) => {
      for (const key of slotEdges(slot)) {
        const target = lower[slotIndexOfKey(route.rows[r + 1], key)];
        if (target && !upper[i].edges.includes(target.id)) upper[i].edges.push(target.id);
      }
    });
  }
  const last = rowNodes[rowNodes.length - 1][0];
  return {
    actId: DESCENT_ACT_ID,
    nodes,
    startNodeId: rowNodes[0][0].id,
    bossNodeId: last.id,
    descent: {
      v: DESCENT_MAP_VERSION,
      routeId,
      finale: route.finale,
    },
  };
}

function buildNode(spec, { id, row, col, runSeed, levelRange, bosses, gameData }) {
  const node = {
    id,
    row,
    col,
    type: spec.type,
    edges: [],
    battleParams: null,
    completed: false,
    authored: DESCENT_AUTHORED,
    descentKey: spec.key,
  };
  const battleSeed = descentNodeBattleSeed(runSeed, id);
  const combat = spec.type === NODE_TYPES.BATTLE || spec.type === NODE_TYPES.BOSS;
  const bossParams =
    spec.type === NODE_TYPES.BOSS ? { bossName: spec.boss, bossRole: spec.bossRole } : {};
  if (combat && spec.setPiece) {
    const piece = findSetPiece(gameData?.setPieces, spec.setPiece);
    if (!piece) throw new Error(`Descent node "${spec.key}" names unknown set piece`);
    convertNodeToSetPieceBattle(node, DESCENT_ACT_ID, piece, {
      battleSeed,
      // A set piece's own fog wins; one that forces none is fought without (no roll).
      fog: false,
      extraParams: {
        ...(levelRange ? { levelRange: [...levelRange] } : {}),
        ...(spec.elite === true ? { isElite: true } : {}),
        ...objectiveParams(spec),
        ...bossParams,
      },
    });
  } else if (combat) {
    const objective = spec.objective || (spec.type === NODE_TYPES.BOSS ? 'seize' : 'rout');
    node.templateId = spec.templateId;
    node.battleParams = {
      act: DESCENT_ACT_ID,
      objective,
      row,
      battleSeed,
      templateId: spec.templateId,
      // A boss node on a template keeps the pool's range for its escorts (today's finale).
      ...(spec.type === NODE_TYPES.BATTLE && levelRange ? { levelRange: [...levelRange] } : {}),
      ...(spec.elite === true ? { isElite: true } : {}),
      ...bossParams,
    };
  }
  if (spec.type === NODE_TYPES.EVENT) node.eventPool = spec.eventPool;
  if (spec.fallable === true) node.fallable = true;
  if (spec.riteTarget === true) node.riteTarget = true;
  if (typeof spec.title === 'string' && spec.title.trim()) node.title = spec.title;
  if (typeof spec.preview === 'string' && spec.preview.trim()) node.preview = spec.preview;
  if (spec.type === NODE_TYPES.BOSS) {
    const line = bossLineFor(spec, bosses);
    if (line) node.bossLine = line;
  }
  return node;
}

// ── Validation ──────────────────────────────────────────────────────────

/** Which finale a boss definition is (`DESCENT_FINALES`), or null: the Rite's own reading. */
const finaleKindOf = riteTargetOfBoss;

/**
 * Validate data/descent.json against the game data (`npm run validate:data`; tests plant one
 * bad entry of each kind). Refuses:
 * - shape: version, `enabled`, a route id per rung that names a route, a route's finale and
 *   `levelOffset`, rows of 1 to 3 slots, a slot's keys and its `oneOf` (2+ nodes, weights);
 * - every rung whose act list reaches the Descent without a route, and a route whose finale is
 *   not the boss that rung's `difficultyFilter` picks (the legacy pick and the endings read it);
 * - row 0 or the last row holding more than one node, a last node that is not the route's finale
 *   boss, a finale anywhere else, a gate in the last row;
 * - a node's keys, unique keys, its type's fields (a battle or boss names one set piece or
 *   template, an event its `eventPool`, a boss its `boss` and `bossRole`), text over its limits,
 *   `fallable` off a battle or on the first row;
 * - edges: present where a single-node row joins (it fans out), missing or unknown where two
 *   multi-node rows meet, more than one lane apart, crossing; a node unreachable from the start
 *   or that cannot reach the finale;
 * - references: a set piece unknown, not fought in the Descent or broken at a rung the route
 *   serves (SetPieces.validateSetPieceAt), or unable to serve the node's objective; a template
 *   unknown, not for the Descent or for another objective; a boss not in `bosses.finalBoss`;
 * - event pools: a pool with too few events every run can meet there (no requirement, a
 *   positive weight, the Descent among its acts) to fill every event node of that pool on one
 *   path, unless one of them is not once per run;
 * - the `rite` block (Rite.validateRiteConfig).
 * @param {object} config
 * @param {{ difficulty?, enemies?, setPieces?, mapTemplates?, events?, eclipse?, terrain?,
 *   classes?, weapons? }} data
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateDescentConfig(config, data = {}) {
  const errors = [];
  const err = (where, message) => errors.push(`descent.json:${where}: ${message}`);
  if (!isObject(config)) return { valid: false, errors: ['descent.json: must be an object'] };
  if (config.version !== DESCENT_CONFIG_VERSION)
    err('version', `must be ${DESCENT_CONFIG_VERSION}`);
  if (typeof config.enabled !== 'boolean') err('enabled', 'must be true or false');
  const routes = isObject(config.routes) ? config.routes : null;
  if (!routes || Object.keys(routes).length === 0) err('routes', 'must name at least one route');
  const byRung = isObject(config.routeByRung) ? config.routeByRung : null;
  if (!byRung) err('routeByRung', 'must map rungs to routes');
  for (const [rung, id] of Object.entries(byRung || {})) {
    if (!DIFFICULTY_IDS.includes(rung)) err(`routeByRung.${rung}`, 'is not a rung');
    if (!routes?.[id]) err(`routeByRung.${rung}`, `names no route "${id}"`);
  }

  const bosses = data.enemies?.bosses?.[DESCENT_ACT_ID] || [];
  const modes = data.difficulty?.modes || {};
  // The boss a rung's own finale pick seats (enemies.json difficultyFilter), by rung.
  const finaleBossFor = (rung) => {
    const picks = bosses.filter((b) => !b.difficultyFilter || b.difficultyFilter.includes(rung));
    return picks.length === 1 ? picks[0] : null;
  };

  for (const rung of DIFFICULTY_IDS) {
    const acts = modes[rung]?.actsIncluded;
    if (!Array.isArray(acts) || !acts.includes(DESCENT_ACT_ID)) continue;
    const id = byRung?.[rung];
    if (!id) {
      err(`routeByRung.${rung}`, `${rung} reaches the Descent and needs a route`);
      continue;
    }
    const route = routes?.[id];
    const pick = finaleBossFor(rung);
    if (route && data.enemies && finaleKindOf(pick) !== route.finale)
      err(
        `routes.${id}.finale`,
        `"${route.finale}" is not ${rung}'s finale pick (${pick?.name || 'none'})`,
      );
  }

  for (const [routeId, route] of Object.entries(routes || {})) {
    const rw = `routes.${routeId}`;
    if (!ID.test(routeId)) err(rw, 'id must be lower_snake_case');
    if (!isObject(route)) {
      err(rw, 'must be an object');
      continue;
    }
    for (const key of Object.keys(route))
      if (!['finale', 'levelOffset', 'rows'].includes(key)) err(rw, `unknown key "${key}"`);
    if (!DESCENT_FINALES.includes(route.finale))
      err(rw, `finale must be one of ${DESCENT_FINALES.join(', ')}`);
    const offset = route.levelOffset;
    if (
      !Array.isArray(offset) ||
      offset.length !== 2 ||
      !offset.every((n) => isInt(n) && Math.abs(n) <= 10) ||
      offset[0] > offset[1]
    )
      err(rw, 'levelOffset must be [lo, hi]: whole numbers from -10 to 10, lo <= hi');
    const servedRungs = Object.entries(byRung || {})
      .filter(([, id]) => id === routeId)
      .map(([rung]) => rung)
      .filter((rung) => DIFFICULTY_IDS.includes(rung));
    validateRoute(rw, route, { err, data, bosses, servedRungs, routeId });
  }

  // The Rite's numbers (engine/Rite.js): its `underPar` keys name a battle node of some route.
  const battleKeys = new Set(
    Object.values(routes || {}).flatMap((route) =>
      (Array.isArray(route?.rows) ? route.rows : []).flatMap((row) =>
        (Array.isArray(row?.nodes) ? row.nodes : [])
          .flatMap(slotSpecs)
          .filter((spec) => isObject(spec) && spec.type === NODE_TYPES.BATTLE)
          .map((spec) => spec.key),
      ),
    ),
  );
  validateRiteConfig(config.rite, { err, eclipse: data.eclipse, battleKeys });
  return { valid: errors.length === 0, errors };
}

function validateRoute(rw, route, { err, data, bosses, servedRungs }) {
  const rows = Array.isArray(route.rows) ? route.rows : null;
  if (!rows || rows.length < 2) {
    err(rw, 'rows must list at least two rows');
    return;
  }
  const keys = new Set();
  const pools = new Map(); // pool -> event-node slot positions, for the path count below
  rows.forEach((row, r) => {
    const ow = `${rw}.rows[${r}]`;
    const slots = Array.isArray(row?.nodes) ? row.nodes : null;
    if (!isObject(row) || !slots || slots.length < 1 || slots.length > MAX_ROW_NODES) {
      err(ow, `nodes must list 1 to ${MAX_ROW_NODES} nodes`);
      return;
    }
    for (const key of Object.keys(row)) if (key !== 'nodes') err(ow, `unknown key "${key}"`);
    const edgeRow = r === 0 || r === rows.length - 1;
    if (edgeRow && slots.length !== 1)
      err(ow, `the ${r === 0 ? 'first' : 'last'} row holds exactly one node`);
    slots.forEach((slot, i) => {
      const sw = `${ow}.nodes[${i}]`;
      if (!isObject(slot)) {
        err(sw, 'must be an object');
        return;
      }
      if (slot.oneOf !== undefined) {
        for (const key of Object.keys(slot))
          if (!SLOT_KEYS.has(key)) err(sw, `unknown key "${key}"`);
        if (!Array.isArray(slot.oneOf) || slot.oneOf.length < 2)
          err(sw, 'oneOf must list at least two nodes');
        if (edgeRow) err(sw, `the ${r === 0 ? 'first' : 'last'} row's node is fixed (no oneOf)`);
        if (
          slot.weights !== undefined &&
          (!Array.isArray(slot.weights) ||
            slot.weights.length !== (slot.oneOf || []).length ||
            !slot.weights.every((w) => Number.isFinite(w) && w >= 0) ||
            !slot.weights.some((w) => w > 0))
        )
          err(sw, 'weights must give each oneOf node a number >= 0, one of them > 0');
        for (const [j, spec] of (Array.isArray(slot.oneOf) ? slot.oneOf : []).entries()) {
          if (isObject(spec) && spec.edges !== undefined)
            err(`${sw}.oneOf[${j}]`, 'a oneOf node takes no edges (the slot names them)');
        }
      }
      for (const [j, spec] of slotSpecs(slot).entries()) {
        const nw = Array.isArray(slot.oneOf) ? `${sw}.oneOf[${j}]` : sw;
        validateNodeSpec(nw, spec, {
          err,
          data,
          bosses,
          servedRungs,
          keys,
          first: r === 0,
          last: r === rows.length - 1,
          finale: route.finale,
        });
        if (spec?.type === NODE_TYPES.EVENT && typeof spec.eventPool === 'string') {
          if (!pools.has(spec.eventPool)) pools.set(spec.eventPool, new Set());
          pools.get(spec.eventPool).add(`${r}:${i}`);
        }
      }
    });
  });
  validateEdges(rw, rows, err);
  validatePools(rw, rows, pools, { err, events: data.events });
}

function validateNodeSpec(nw, spec, ctx) {
  const { err, data, bosses, servedRungs, keys, first, last, finale } = ctx;
  if (!isObject(spec)) {
    err(nw, 'a node must be an object');
    return;
  }
  for (const key of Object.keys(spec))
    if (!NODE_SPEC_KEYS.has(key)) err(nw, `unknown key "${key}"`);
  if (typeof spec.key !== 'string' || !ID.test(spec.key)) err(nw, 'key must be lower_snake_case');
  else if (keys.has(spec.key)) err(nw, `key "${spec.key}" is used twice in the route`);
  else keys.add(spec.key);
  const type = spec.type;
  if (!DESCENT_NODE_TYPES.includes(type)) {
    err(nw, `type must be one of ${DESCENT_NODE_TYPES.join(', ')}`);
    return;
  }
  for (const [key, types] of Object.entries(KEYS_BY_TYPE))
    if (spec[key] !== undefined && !types.includes(type)) err(nw, `a ${type} node takes no ${key}`);
  for (const [key, limit] of Object.entries(DESCENT_TEXT_LIMITS)) {
    const text = spec[key];
    if (text === undefined) continue;
    if (typeof text !== 'string' || !text.trim()) err(nw, `${key} must be a string`);
    else if (text.length > limit) err(nw, `${key} is over ${limit} characters`);
    else if (/[\n]/.test(text)) err(nw, `${key} must be one line`);
  }
  for (const key of ['elite', 'fallable', 'riteTarget'])
    if (spec[key] !== undefined && typeof spec[key] !== 'boolean')
      err(nw, `${key} must be true or false`);
  if (spec.fallable === true && first) err(nw, 'the first node can never fall (it is the start)');

  if (type === NODE_TYPES.EVENT) {
    if (typeof spec.eventPool !== 'string' || !ID.test(spec.eventPool))
      err(nw, 'an event node names its eventPool');
  }
  if (type === NODE_TYPES.BOSS) {
    if (!BOSS_ROLES.includes(spec.bossRole))
      err(nw, `bossRole must be one of ${BOSS_ROLES.join(', ')}`);
    const def = bosses.find((b) => b?.name === spec.boss);
    if (typeof spec.boss !== 'string' || (data.enemies && !def))
      err(nw, `boss "${spec.boss}" is not in enemies.json bosses.${DESCENT_ACT_ID}`);
    if (last && spec.bossRole !== 'finale')
      err(nw, 'the last node is the finale (bossRole: finale)');
    if (!last && spec.bossRole === 'finale') err(nw, 'only the last node is the finale');
    if (last && def && data.enemies) {
      if (finaleKindOf(def) !== finale)
        err(nw, `the finale boss "${def.name}" is not the route's "${finale}"`);
    }
  } else if (last) err(nw, 'the last node is the finale boss');

  if (type === NODE_TYPES.BATTLE || type === NODE_TYPES.BOSS) {
    const hasPiece = spec.setPiece !== undefined;
    const hasTemplate = spec.templateId !== undefined;
    if (hasPiece === hasTemplate) err(nw, 'a battle names one setPiece or one templateId');
    else if (hasPiece) validateSetPieceNode(nw, spec, { err, data, servedRungs });
    else validateTemplateNode(nw, spec, { err, data });
  }
}

function validateSetPieceNode(nw, spec, { err, data, servedRungs }) {
  const piece = findSetPiece(data.setPieces, spec.setPiece);
  if (!piece) {
    if (data.setPieces) err(nw, `unknown set piece "${spec.setPiece}"`);
    return;
  }
  // The node's seat, as its battle params will carry it: a boss node names its boss (the gate's
  // Lieutenant, the finale), so a boss slot there never seats the Entity unnamed.
  const seat = {
    ...(spec.type === NODE_TYPES.BOSS && typeof spec.boss === 'string'
      ? { bossName: spec.boss }
      : {}),
    ...(spec.type === NODE_TYPES.BOSS ? { isBoss: true } : {}),
    ...(spec.elite === true ? { isElite: true } : {}),
  };
  for (const rung of servedRungs)
    for (const message of validateSetPieceAt(piece, DESCENT_ACT_ID, rung, data, seat))
      err(nw, message);
  if (spec.objective === undefined) return;
  if (!DESCENT_SET_PIECE_OBJECTIVES.includes(spec.objective)) {
    err(nw, `objective must be one of ${DESCENT_SET_PIECE_OBJECTIVES.join(', ')}`);
    return;
  }
  if (spec.objective === 'seize') {
    if (piece.objective !== 'seize' || piece.objectives !== undefined)
      err(nw, `set piece "${piece.id}" is not a seize map`);
    return;
  }
  // A defeat of the boss: the set piece read with that model in place of its own must still be
  // a whole set piece (its boss slot on every variant, the '@boss' ref resolving).
  if (spec.type !== NODE_TYPES.BOSS) err(nw, 'only a boss node is fought as a defeat of its boss');
  const derived = {
    ...structuredClone(piece),
    objective: 'rout',
    objectives: structuredClone(DEFEAT_BOSS_OBJECTIVES),
  };
  const { errors } = validateSetPiecesConfig({ setPieces: [derived] }, { ...data, events: null });
  for (const message of errors) err(nw, `as a defeat of its boss: ${message}`);
}

function validateTemplateNode(nw, spec, { err, data }) {
  const objective = spec.objective || (spec.type === NODE_TYPES.BOSS ? 'seize' : 'rout');
  if (!['rout', 'seize', 'escape'].includes(objective))
    err(nw, 'a template node fights rout, seize or escape');
  if (!data.mapTemplates) return;
  const template = (data.mapTemplates[objective] || []).find((t) => t?.id === spec.templateId);
  if (!template) {
    err(nw, `template "${spec.templateId}" is not a ${objective} template`);
    return;
  }
  if (Array.isArray(template.acts) && !template.acts.includes(DESCENT_ACT_ID))
    err(nw, `template "${spec.templateId}" is not fought in ${DESCENT_ACT_ID}`);
  if (template.bossOnly === true && spec.type !== NODE_TYPES.BOSS)
    err(nw, `template "${spec.templateId}" is for boss nodes only`);
}

/** Edges (see the header) and reachability, both ways. */
function validateEdges(rw, rows, err) {
  const slotsOf = (r) => (Array.isArray(rows[r]?.nodes) ? rows[r].nodes : []);
  const adjacency = rows.map(() => []);
  for (let r = 0; r < rows.length; r++) {
    const upper = slotsOf(r);
    const lower = slotsOf(r + 1);
    const ucols = COLUMNS_BY_COUNT[upper.length] || [];
    const lcols = COLUMNS_BY_COUNT[lower.length] || [];
    adjacency[r] = upper.map(() => new Set());
    if (r === rows.length - 1) {
      upper.forEach((slot, i) => {
        if (slot?.edges !== undefined)
          err(`${rw}.rows[${r}].nodes[${i}]`, 'the last row has no edges');
      });
      continue;
    }
    if (upper.length === 1 || lower.length === 1) {
      upper.forEach((slot, i) => {
        if (slot?.edges !== undefined)
          err(
            `${rw}.rows[${r}].nodes[${i}]`,
            'edges join two multi-node rows only (a single node fans out)',
          );
        lower.forEach((_, j) => adjacency[r][i].add(j));
      });
      continue;
    }
    const pairs = [];
    upper.forEach((slot, i) => {
      const sw = `${rw}.rows[${r}].nodes[${i}]`;
      const edges = slot?.edges;
      if (!Array.isArray(edges) || edges.length === 0) {
        err(sw, 'needs edges: the next row holds more than one node');
        return;
      }
      for (const key of edges) {
        const j = slotIndexOfKey(rows[r + 1], key);
        if (j < 0) {
          err(sw, `edge "${key}" names no node of the next row`);
          continue;
        }
        if (Math.abs(ucols[i] - lcols[j]) > 1) err(sw, `edge "${key}" is more than one lane away`);
        if (edgeCrosses(pairs, ucols[i], lcols[j])) err(sw, `edge "${key}" crosses another edge`);
        pairs.push([ucols[i], lcols[j]]);
        adjacency[r][i].add(j);
      }
    });
  }
  // Reachability: from the start forward, and from the finale back.
  let reach = new Set([0]);
  for (let r = 0; r < rows.length - 1; r++) {
    const next = new Set();
    for (const i of reach) for (const j of adjacency[r][i] || []) next.add(j);
    slotsOf(r + 1).forEach((_, j) => {
      if (!next.has(j)) err(`${rw}.rows[${r + 1}].nodes[${j}]`, 'cannot be reached from the start');
    });
    reach = next;
  }
  let back = new Set([0]);
  for (let r = rows.length - 2; r >= 0; r--) {
    const prev = new Set();
    slotsOf(r).forEach((_, i) => {
      if ([...(adjacency[r][i] || [])].some((j) => back.has(j))) prev.add(i);
      else err(`${rw}.rows[${r}].nodes[${i}]`, 'cannot reach the finale');
    });
    back = prev;
  }
}

/**
 * Each named pool can fill every event node of its pool on any one path through the route:
 * events every run can meet there (no `requires`, a positive weight, the pool, the Descent among
 * its acts), as many as that path holds, or one that is not once per run.
 */
function validatePools(rw, rows, pools, { err, events }) {
  if (!events) return;
  const list = Array.isArray(events.events) ? events.events : [];
  for (const [pool, positions] of pools) {
    // The most nodes of this pool on one path: rows are walked one node each, so the count is
    // the number of rows holding one (any path can pick it where a row offers it).
    const rowsWith = new Set([...positions].map((p) => p.split(':')[0]));
    const needed = rowsWith.size;
    const open = list.filter(
      (e) =>
        e?.pool === pool &&
        e.fallback !== true &&
        Number(e.weight) > 0 &&
        e.requires === undefined &&
        Array.isArray(e.acts) &&
        e.acts.includes(DESCENT_ACT_ID),
    );
    if (open.some((e) => e.oncePerRun === false) || open.length >= needed) continue;
    err(
      rw,
      `event pool "${pool}" has ${open.length} event(s) every run can meet; a path can hold ${needed} (or make one not once per run)`,
    );
  }
}

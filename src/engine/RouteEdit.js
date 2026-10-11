// RouteEdit.js — the Cartographer's `routeEdit` effect (docs/specs/event-nodes-phase2.md §2A):
// a small, rule-keeping change to the act's route map from the event node you stand on.
//
//   addRoad  { op: 'addRoad' }                a new edge from the CURRENT node to a node in the
//                                             next row it is not yet joined to, seeded among the
//                                             candidates that keep the map's rules
//   redraw   { op: 'redraw', toType }         one node in the next two rows, reachable from here,
//                                             becomes `toType` (shop | church | battle)
//
// "Keeps the map's rules" means the generator's own: lanes within ±1 and no crossing edge
// (NodeMapGenerator.edgeCrosses / rowsAreUnconstrained, the same checks connectRows uses), and
// the service-streak repair's pacing (no more than two non-combat nodes in a row on a path,
// none beside one of its own type). A redrawn battle is built by the generator's own builders
// (NodeMapGenerator.rebuildNodeAs) under a seeded Math.random, so a refresh, a reload or a
// replay builds the same battle; the node keeps its id, so Eclipse thresholds (keyed on the
// node id and lane) do not move.
//
// A node is NEVER redrawn when it is the start, the boss, the Ruins, completed, the current
// node, encounter-locked, already fallen to the Eclipse, a recruit, the arena, an event, an
// ambush village, the Old Sanctum, or holds a saved battle config. (addRoad touches only the current node's
// edge list.)
//
// Plan, then apply (EventEffects): `planRouteEdit` is pure and returns what would change
// (or { empty: true } when nothing qualifies: the outcome's `fallback` plays);
// `applyRouteEdit` performs it. `checkNodeMapValidity` is the map's invariant checker; the
// tests run it after every edit over many seeds.
//
// Pure: no Phaser, no DOM, no unseeded randomness.

import { NODE_TYPES } from '../utils/constants.js';
import { nodeFallExemption, withEclipseSeed } from './EclipseSystem.js';
import {
  edgeCrosses,
  rebuildNodeAs,
  rowsAreUnconstrained,
  villageMinRowFor,
} from './NodeMapGenerator.js';

export const REDRAW_TYPES = Object.freeze([NODE_TYPES.SHOP, NODE_TYPES.CHURCH, NODE_TYPES.BATTLE]);
/** The types a redraw may replace (a recruit, the arena and an event hold promises). */
export const REDRAWABLE_TYPES = Object.freeze([
  NODE_TYPES.BATTLE,
  NODE_TYPES.SHOP,
  NODE_TYPES.CHURCH,
]);
/** The generator's non-combat types (its service-streak pass). */
const SERVICE_TYPES = new Set([
  NODE_TYPES.SHOP,
  NODE_TYPES.CHURCH,
  NODE_TYPES.COLOSSEUM,
  NODE_TYPES.EVENT,
]);
const MAX_SERVICE_STREAK = 2;

// ── The graph ───────────────────────────────────────────────────────────

const nodesOf = (nodeMap) => (Array.isArray(nodeMap?.nodes) ? nodeMap.nodes : []);

function indexOf(nodeMap) {
  const byId = new Map();
  for (const node of nodesOf(nodeMap)) byId.set(node.id, node);
  return byId;
}

function parentsMap(nodeMap) {
  const parents = new Map(nodesOf(nodeMap).map((node) => [node.id, []]));
  for (const node of nodesOf(nodeMap))
    for (const id of node.edges || []) parents.get(id)?.push(node.id);
  return parents;
}

/** Rows in the act's map (the highest row + 1). */
export function mapRowCount(nodeMap) {
  const rows = nodesOf(nodeMap).map((node) => Number(node.row) || 0);
  return rows.length ? Math.max(...rows) + 1 : 0;
}

const isService = (node) => SERVICE_TYPES.has(node?.type);

/** Service nodes in a row on the longest path that ENDS at `node` (0 for a combat node). */
function streakInto(node, byId, parents, memo = new Map()) {
  if (memo.has(node.id)) return memo.get(node.id);
  let best = 0;
  if (isService(node))
    best =
      1 +
      Math.max(
        0,
        ...(parents.get(node.id) || []).map((id) => streakInto(byId.get(id), byId, parents, memo)),
      );
  memo.set(node.id, best);
  return best;
}

/** Service nodes in a row on the longest path that STARTS at `node`. */
function streakFrom(node, byId, memo = new Map()) {
  if (memo.has(node.id)) return memo.get(node.id);
  let best = 0;
  if (isService(node))
    best =
      1 +
      Math.max(
        0,
        ...(node.edges || []).map((id) =>
          byId.has(id) ? streakFrom(byId.get(id), byId, memo) : 0,
        ),
      );
  memo.set(node.id, best);
  return best;
}

/** Paths that carry more than two non-combat nodes in a row (the generator's pacing rule). */
export function serviceStreakProblems(nodeMap) {
  const byId = indexOf(nodeMap);
  const parents = parentsMap(nodeMap);
  const memo = new Map();
  const problems = [];
  for (const node of nodesOf(nodeMap))
    if (streakInto(node, byId, parents, memo) > MAX_SERVICE_STREAK)
      problems.push(`${node.id}: more than ${MAX_SERVICE_STREAK} non-combat nodes in a row`);
  return problems;
}

/**
 * The route map's invariants. Returns a list of problems (empty = valid):
 *   - ids are unique; every node has a row and a column; one start (row 0) and one boss
 *     (last row);
 *   - an edge points at a real node in the NEXT row, once;
 *   - lanes within ±1 and no two edges cross, except between rows where either side is a
 *     single node (the generator relaxes the lane rule there: nothing can cross);
 *   - every node but the start has a way in, every node but the boss a way out;
 *   - every node is reachable from the start and the boss from every node.
 */
export function checkNodeMapValidity(nodeMap) {
  const problems = [];
  const nodes = nodesOf(nodeMap);
  if (nodes.length === 0) return ['the map has no nodes'];
  const byId = new Map();
  for (const node of nodes) {
    if (byId.has(node.id)) problems.push(`${node.id}: duplicate id`);
    byId.set(node.id, node);
    if (!Number.isInteger(node.row) || !Number.isInteger(node.col))
      problems.push(`${node.id}: needs an integer row and column`);
  }
  const rows = mapRowCount(nodeMap);
  const start = byId.get(nodeMap.startNodeId);
  const boss = byId.get(nodeMap.bossNodeId);
  if (!start || start.row !== 0) problems.push('the start node is missing or not in row 0');
  if (!boss || boss.row !== rows - 1)
    problems.push('the boss node is missing or not in the last row');

  const byRow = new Map();
  for (const node of nodes) {
    if (!byRow.has(node.row)) byRow.set(node.row, []);
    byRow.get(node.row).push(node);
  }
  for (const node of nodes) {
    const seen = new Set();
    for (const id of node.edges || []) {
      const target = byId.get(id);
      if (!target) {
        problems.push(`${node.id}: edge to unknown node ${id}`);
        continue;
      }
      if (seen.has(id)) problems.push(`${node.id}: duplicate edge to ${id}`);
      seen.add(id);
      if (target.row !== node.row + 1) problems.push(`${node.id}: edge to ${id} skips a row`);
    }
  }
  for (let row = 0; row < rows - 1; row++) {
    const current = byRow.get(row) || [];
    const next = byRow.get(row + 1) || [];
    if (rowsAreUnconstrained(current, next)) continue;
    const pairs = [];
    for (const node of current)
      for (const id of node.edges || []) {
        const target = byId.get(id);
        if (!target || target.row !== row + 1) continue;
        pairs.push([node.col, target.col, node.id, id]);
        if (Math.abs(node.col - target.col) > 1)
          problems.push(`${node.id}: edge to ${id} is more than one lane away`);
      }
    for (let i = 0; i < pairs.length; i++)
      for (let j = i + 1; j < pairs.length; j++)
        if (edgeCrosses([pairs[i]], pairs[j][0], pairs[j][1]))
          problems.push(`${pairs[i][2]}->${pairs[i][3]} crosses ${pairs[j][2]}->${pairs[j][3]}`);
  }

  const parents = parentsMap(nodeMap);
  for (const node of nodes) {
    if (node.id !== nodeMap.startNodeId && (parents.get(node.id) || []).length === 0)
      problems.push(`${node.id}: no way in`);
    if (node.id !== nodeMap.bossNodeId && (node.edges || []).length === 0)
      problems.push(`${node.id}: no way out`);
  }
  const reach = (from, step) => {
    const seen = new Set([from]);
    const queue = [from];
    while (queue.length) {
      const id = queue.shift();
      for (const next of step(id))
        if (byId.has(next) && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
    }
    return seen;
  };
  if (start) {
    const fromStart = reach(start.id, (id) => byId.get(id).edges || []);
    for (const node of nodes)
      if (!fromStart.has(node.id)) problems.push(`${node.id}: not reachable from the start`);
  }
  if (boss) {
    const toBoss = reach(boss.id, (id) => parents.get(id) || []);
    for (const node of nodes)
      if (!toBoss.has(node.id)) problems.push(`${node.id}: cannot reach the boss`);
  }
  return problems;
}

// ── Candidates ──────────────────────────────────────────────────────────

/**
 * The next-row nodes a new road from `fromId` could reach: not yet joined, not completed,
 * within ±1 lane (unless a single-node row), crossing no existing edge, and keeping the
 * non-combat pacing (a service node on either end of the new link needs the chain it makes
 * to stay within two, and never the same type side by side).
 * @returns {string[]} node ids, map order
 */
export function roadCandidates(nodeMap, fromId) {
  const byId = indexOf(nodeMap);
  const from = byId.get(fromId);
  if (!from) return [];
  const rowNodes = (row) => nodesOf(nodeMap).filter((node) => node.row === row);
  const current = rowNodes(from.row);
  const next = rowNodes(from.row + 1);
  const unconstrained = rowsAreUnconstrained(current, next);
  const pairs = [];
  for (const node of current)
    for (const id of node.edges || []) {
      const target = byId.get(id);
      if (target) pairs.push([node.col, target.col]);
    }
  const parents = parentsMap(nodeMap);
  const into = streakInto(from, byId, parents);
  return next
    .filter((target) => {
      if ((from.edges || []).includes(target.id) || target.completed) return false;
      if (!unconstrained) {
        if (Math.abs(from.col - target.col) > 1) return false;
        if (edgeCrosses(pairs, from.col, target.col)) return false;
      }
      if (isService(from) && isService(target) && from.type === target.type) return false;
      return into + streakFrom(target, byId) <= MAX_SERVICE_STREAK;
    })
    .map((node) => node.id);
}

/** True when `node` may be redrawn (the rules in the header). */
export function isRedrawable(run, node) {
  if (!node || !REDRAWABLE_TYPES.includes(node.type)) return false;
  if (node.isAmbush || node.eventBattle) return false;
  // The Old Sanctum (engine/SanctumPass.js) holds the act's earned blessing: never redrawn.
  if (node.sanctum === true) return false;
  if (run?.battleConfigsByNodeId?.[node.id]) return false;
  return (
    nodeFallExemption(node, {
      nodeMap: run.nodeMap,
      currentNodeId: run.currentNodeId,
      activeNodeId: run.battleInProgress?.nodeId || null,
    }) === null
  );
}

/**
 * The nodes a redraw to `toType` could take: redrawable, in the next two rows and reachable
 * from `fromId`, of another type, and keeping the pacing when the new type is non-combat.
 * @returns {string[]} node ids, map order
 */
export function redrawCandidates(run, fromId, toType) {
  const nodeMap = run?.nodeMap;
  const byId = indexOf(nodeMap);
  const from = byId.get(fromId);
  if (!from || !REDRAW_TYPES.includes(toType)) return [];
  const children = (from.edges || []).map((id) => byId.get(id)).filter(Boolean);
  const reachable = new Set(children.map((node) => node.id));
  for (const child of children)
    for (const id of child.edges || []) if (byId.has(id)) reachable.add(id);
  const parents = parentsMap(nodeMap);
  const memoInto = new Map();
  const memoFrom = new Map();
  return nodesOf(nodeMap)
    .filter((node) => {
      if (!reachable.has(node.id) || node.type === toType || !isRedrawable(run, node)) return false;
      if (!SERVICE_TYPES.has(toType)) return true;
      const ins = parents.get(node.id) || [];
      const outs = node.edges || [];
      if ([...ins, ...outs].some((id) => byId.get(id)?.type === toType)) return false;
      const into = Math.max(
        0,
        ...ins.map((id) => streakInto(byId.get(id), byId, parents, memoInto)),
      );
      const out = Math.max(
        0,
        ...outs.map((id) => (byId.has(id) ? streakFrom(byId.get(id), byId, memoFrom) : 0)),
      );
      return into + 1 + out <= MAX_SERVICE_STREAK;
    })
    .map((node) => node.id);
}

// ── Plan and apply ──────────────────────────────────────────────────────

/**
 * Plan a routeEdit effect from the node the event stands on (pure).
 * @param {object} run
 * @param {{ op: string, toType?: string }} effect
 * @param {string} fromId - the event node (the current node)
 * @param {() => number} rng - a seeded stream (one draw)
 * @returns {{ step: object } | { empty: true } | { error: string }}
 */
export function planRouteEdit(run, effect, fromId, rng) {
  if (!run?.nodeMap) return { error: 'There is no map here.' };
  if (effect?.op === 'addRoad') {
    const candidates = roadCandidates(run.nodeMap, fromId);
    if (candidates.length === 0) return { empty: true };
    return { step: { type: 'routeEdit', op: 'addRoad', from: fromId, to: pick(candidates, rng) } };
  }
  if (effect?.op === 'redraw') {
    if (!REDRAW_TYPES.includes(effect.toType))
      return { error: `Cannot redraw to "${effect.toType}".` };
    const candidates = redrawCandidates(run, fromId, effect.toType);
    if (candidates.length === 0) return { empty: true };
    const node = pick(candidates, rng);
    return {
      step: {
        type: 'routeEdit',
        op: 'redraw',
        node,
        fromType: run.nodeMap.nodes.find((n) => n.id === node).type,
        toType: effect.toType,
      },
    };
  }
  return { error: `Unknown route edit "${effect?.op}".` };
}

const pick = (list, rng) => list[Math.floor(rng() * list.length) % list.length];

/**
 * Perform a planned route edit. `seedKey` seeds every draw the battle builders make.
 * @returns {object} the result record
 */
export function applyRouteEdit(run, step, seedKey) {
  const byId = indexOf(run.nodeMap);
  if (step.op === 'addRoad') {
    const from = byId.get(step.from);
    const to = byId.get(step.to);
    if (!from || !to) throw new Error('The road no longer leads anywhere.');
    if (!from.edges.includes(to.id)) from.edges.push(to.id);
    return {
      kind: 'route',
      op: 'addRoad',
      from: from.id,
      to: to.id,
      row: to.row,
      col: to.col,
      type: to.type,
    };
  }
  const node = byId.get(step.node);
  if (!node) throw new Error('The node is gone.');
  // An earlier step of the same outcome (a shadow gain that let the dark take it) may have
  // put the node out of reach since the plan: leave it as it is.
  if (!isRedrawable(run, node) || node.type === step.toType)
    return { kind: 'note', of: 'routeEdit', text: 'The road stays as it was.' };
  const actId = run.nodeMap.actId || run.currentAct;
  withEclipseSeed(seedKey, () =>
    rebuildNodeAs(node, step.toType, actId, mapRowCount(run.nodeMap), run.gameData?.mapTemplates, {
      caravanChanceBonus: run.metaEffects?.caravanChanceBonus || 0,
      villageMinRow: villageMinRowFor(run.difficultyModifiers?.villageMinRow, actId),
      fogChanceBonus: run.getDifficultyModifier?.('fogChanceBonus', 0) || 0,
      halfFogChance: run.difficultyId === 'normal',
    }),
  );
  return {
    kind: 'route',
    op: 'redraw',
    node: node.id,
    row: node.row,
    col: node.col,
    fromType: step.fromType,
    type: node.type,
  };
}

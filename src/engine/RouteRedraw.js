// RouteRedraw.js — "Redraw road", a Valor sink that buys choice, not power
// (/mnt/project-files/reviews/valor-sinks.md §1; docs/specs/route-redraw.md).
//
// On the route map the player may pay Valor to throw away every node ahead of the party in this
// act and draw them again. The node the party stands on, every row behind it and the act's boss
// stay exactly as they were; the rows between are the generator's own (NodeMapGenerator
// generateNodeMap: lanes, pacing, recruit and arena rules, villages, fog), drawn whole on a
// stream of their own and spliced in from the row after the party's. A redraw is refused rather
// than bent: the seam must keep the map's rules (RouteEdit.checkNodeMapValidity and the
// service-streak pacing, judged against the map as it was), else the next attempt's stream is
// drawn, and after `REDRAW_ATTEMPTS` nothing changes and nothing is charged.
//
// What a redraw never buys:
//   - more recruits or arenas: the road ahead never holds more recruit or Colosseum nodes than it
//     did (counted by what the generator made them, so a node the Eclipse took still counts);
//     a surplus becomes a battle, the latest rows first;
//   - a way round the dark: the Eclipse falls on the new road at the act's shadow as on any map
//     (the caller runs RunManager.applyEclipseNow after the splice);
//   - a second Pilgrim's Road shop or Old Sanctum: those passes restamp only what the old road
//     ahead held (the caller).
//
// Price and cap: `ROUTE_REDRAW_PRICES` Valor, rising with each redraw in the run, at most
// `ROUTE_REDRAW_MAX` (5) a run (Dave, 2026-10-21). The count is the run's (`run.routeRedraws`,
// saved, inert to an older client); the Valor is the slot's meta (the scene pays it).
//
// Pure: no Phaser, no DOM, no unseeded randomness (every draw is under `redrawSeedKey`).

import { NODE_TYPES } from '../utils/constants.js';
import { isAuthoredNode, isDescentMap } from './Descent.js';
import { createSeededRng } from './BlessingEngine.js';
import { eclipseHash, withEclipseSeed } from './EclipseSystem.js';
import {
  connectRows,
  generateNodeMap,
  nodeMapOptionsForRun,
  rebuildNodeAs,
  villageMinRowFor,
} from './NodeMapGenerator.js';
import { checkNodeMapValidity, mapRowCount, serviceStreakProblems } from './RouteEdit.js';
import { sanctumCandidates } from './SanctumPass.js';
import { isPrologueRun } from './ScriptedBattle.js';

/** Valor for the 1st..5th redraw of a run. */
export const ROUTE_REDRAW_PRICES = Object.freeze([300, 400, 500, 650, 800]);
/** Redraws a run may make. */
export const ROUTE_REDRAW_MAX = ROUTE_REDRAW_PRICES.length;
/** Streams tried for one redraw before it is refused (each a whole fresh map). */
export const REDRAW_ATTEMPTS = 24;

/** The run's tables keyed by node id: a thrown-away node's entries go with it. */
const NODE_KEYED_STATE = Object.freeze([
  'battleConfigsByNodeId',
  'shopStateByNodeId',
  'ruinsChoiceByNodeId',
  'ruinsRevivedByNodeId',
  'churchRevivesByNodeId',
  'churchVowByNodeId',
  'churchTitheByNodeId',
  'eventStateByNodeId',
]);

/** Node types a redraw may never add to the road ahead (it may lose them). */
const CAPPED_TYPES = Object.freeze([NODE_TYPES.RECRUIT, NODE_TYPES.COLOSSEUM]);

/** A saved redraw count: a whole number from 0 to the cap (a save from before it: 0). */
export function sanitizeRouteRedraws(raw) {
  const n = Math.trunc(Number(raw));
  return Number.isFinite(n) ? Math.max(0, Math.min(ROUTE_REDRAW_MAX, n)) : 0;
}

/** Redraws spent this run. */
export function routeRedrawsUsed(run) {
  return sanitizeRouteRedraws(run?.routeRedraws);
}

/** Redraws left this run. */
export function routeRedrawsLeft(run) {
  return ROUTE_REDRAW_MAX - routeRedrawsUsed(run);
}

/** Valor the next redraw costs, or null when none are left. */
export function routeRedrawPrice(run) {
  const used = routeRedrawsUsed(run);
  return used < ROUTE_REDRAW_MAX ? ROUTE_REDRAW_PRICES[used] : null;
}

/**
 * The row the party holds: the current node's, or the start row before the act's first step
 * (the start node is then kept: row 0 is pinned to one node). Everything after it is ahead.
 */
export function keptRowOf(run) {
  const current = (run?.nodeMap?.nodes || []).find((n) => n.id === run?.currentNodeId);
  return current ? current.row : 0;
}

/** True when the route map offers the button at all (never the prologue, a no-upgrade run or the Descent). */
export function routeRedrawOffered(run) {
  if (!run?.nodeMap || !Array.isArray(run.nodeMap.nodes)) return false;
  if (isPrologueRun(run) || run.noMetaMode === true) return false;
  if (isDescentMap(run.nodeMap) || run.nodeMap.nodes.some(isAuthoredNode)) return false;
  return true;
}

/**
 * Why a redraw cannot be made now, or '' when it can (Valor is the caller's check):
 *   'not_offered' the prologue, a no-upgrade run, the Descent, no map
 *   'spent'       five redraws this run
 *   'busy'        a battle in progress, the act's boss done
 *   'held'        the party cannot leave its node yet (not done, spoils or a reward owed)
 *   'no_road'     no row is left between the party and the boss
 */
export function routeRedrawBlock(run) {
  if (!routeRedrawOffered(run)) return 'not_offered';
  if (routeRedrawsUsed(run) >= ROUTE_REDRAW_MAX) return 'spent';
  if (run.battleInProgress || run.isActComplete?.()) return 'busy';
  const keptRow = keptRowOf(run);
  const rows = mapRowCount(run.nodeMap);
  if (keptRow + 1 > rows - 2) return 'no_road';
  const available = run.getAvailableNodes?.() || [];
  const free = run.currentNodeId
    ? available.length > 0 && available.every((n) => n.row === keptRow + 1)
    : available.length === 1 && available[0].id === run.nodeMap.startNodeId;
  return free ? '' : 'held';
}

/** The player's words for a block (the button's line and the confirmation's). */
export function routeRedrawBlockText(reason, { price = null, valor = null } = {}) {
  switch (reason) {
    case 'spent':
      return 'No redraws left this run.';
    case 'busy':
      return 'The road is set for now.';
    case 'held':
      return 'Finish here before redrawing the road.';
    case 'no_road':
      return 'Only the boss lies ahead.';
    case 'short':
      return `Need ${Number(price || 0).toLocaleString('en-US')} Valor (you have ${Number(
        valor || 0,
      ).toLocaleString('en-US')}).`;
    case 'save_failed':
      return 'Could not save. Nothing was spent.';
    case 'no_draw':
      return 'No other road could be drawn. Nothing was spent.';
    default:
      return '';
  }
}

/** The stream key of a redraw's attempt: the run, the act, which redraw and which attempt. */
export function redrawSeedKey(run, n, attempt) {
  return `route-redraw:${Number(run?.runSeed) >>> 0}:${run?.nodeMap?.actId || run?.currentAct}:${n}:${attempt}`;
}

/** What the generator made a node (a node the Eclipse took keeps its first type). */
const originType = (node) => node?.eclipse?.fromType || node?.type;

/** Rows strictly between the kept row and the boss: the road a redraw replaces. */
function isAhead(node, keptRow, rows) {
  return node.row > keptRow && node.row < rows - 1;
}

/**
 * Splice a freshly generated map's road onto the old one (no draws but connectRows', which the
 * caller seeds). Returns the new node list: copies of the old rows up to `keptRow` (their edges
 * to the old road replaced) and of the old boss, and the fresh map's nodes between. Null when
 * the fresh map does not fit (another act's shape).
 */
export function spliceRoad(oldMap, freshMap, keptRow) {
  const rows = mapRowCount(oldMap);
  if (mapRowCount(freshMap) !== rows || freshMap.bossNodeId !== oldMap.bossNodeId) return null;
  const kept = oldMap.nodes.filter((n) => n.row <= keptRow).map((n) => structuredClone(n));
  const boss = oldMap.nodes.find((n) => n.id === oldMap.bossNodeId);
  if (!boss) return null;
  const road = freshMap.nodes.filter((n) => isAhead(n, keptRow, rows));
  const seam = kept.filter((n) => n.row === keptRow);
  for (const node of seam) node.edges = [];
  connectRows(
    seam,
    road.filter((n) => n.row === keptRow + 1),
  );
  return [...kept, ...road, structuredClone(boss)];
}

/**
 * Hold the road ahead to the old road's recruit and Colosseum counts: each surplus node, the
 * latest rows first, is rebuilt as a battle by `rebuildAsBattle(node)` (the caller seeds it).
 */
export function capRoadPromises(oldMap, nodes, keptRow, rebuildAsBattle) {
  const rows = mapRowCount(oldMap);
  for (const type of CAPPED_TYPES) {
    const allowed = oldMap.nodes.filter(
      (n) => isAhead(n, keptRow, rows) && originType(n) === type,
    ).length;
    const found = nodes
      .filter((n) => isAhead(n, keptRow, rows) && n.type === type)
      .sort((a, b) => b.row - a.row || b.col - a.col);
    for (const node of found.slice(0, Math.max(0, found.length - allowed))) rebuildAsBattle(node);
  }
}

/**
 * The problems a spliced map has that the old map did not (empty = the splice keeps every rule
 * the map kept): RouteEdit's invariants and the generator's pacing.
 */
export function newRoadProblems(oldMap, nodes) {
  const before = new Set([...checkNodeMapValidity(oldMap), ...serviceStreakProblems(oldMap)]);
  const map = { ...oldMap, nodes };
  return [...checkNodeMapValidity(map), ...serviceStreakProblems(map)].filter(
    (problem) => !before.has(problem),
  );
}

/** Ids of the old road (the nodes a redraw throws away). */
export function roadAheadIds(oldMap, keptRow) {
  const rows = mapRowCount(oldMap);
  return oldMap.nodes.filter((n) => isAhead(n, keptRow, rows)).map((n) => n.id);
}

/**
 * The Old Sanctum on the old road ahead moves to the new road: one of the churches ahead
 * (SanctumPass's candidates, by id), picked on its own key. The map's `sanctumRolled` stays set,
 * so the act's own pass never stamps another. Returns the stamped id, or null (no sanctum was
 * ahead, or no church is).
 */
export function restampSanctum(run, oldMap, nodes, keptRow, n) {
  const rows = mapRowCount(oldMap);
  if (!oldMap.nodes.some((node) => isAhead(node, keptRow, rows) && node.sanctum === true))
    return null;
  const candidates = sanctumCandidates({ nodes }).filter((node) => isAhead(node, keptRow, rows));
  if (candidates.length === 0) return null;
  const rng = createSeededRng(
    eclipseHash(`sanctum-redraw:${Number(run?.runSeed) >>> 0}:${oldMap.actId}:${n}`),
  );
  const pick = candidates[Math.min(candidates.length - 1, Math.floor(rng() * candidates.length))];
  pick.sanctum = true;
  return pick.id;
}

/**
 * Redraw the road ahead, in place: every node between the party's row
 * and the boss is drawn again, then Pilgrim's Road's shop and the Old Sanctum the old road held
 * ahead are restamped on it, its recruits get their previews and the dark falls on it at the
 * act's shadow (those falls are the road as drawn: no fall ceremony). The count goes up; the
 * Valor is the caller's (RouteRedrawController pays after and calls `undo` if it cannot).
 * @returns {{ ok: true, n: number, price: number, undo: () => void } |
 *   { ok: false, reason: string }}
 */
export function redrawRoute(run) {
  const block = routeRedrawBlock(run);
  if (block) return { ok: false, reason: block };
  const n = routeRedrawsUsed(run);
  const price = routeRedrawPrice(run);
  const keptRow = keptRowOf(run);
  const oldMap = run.nodeMap;
  const actId = oldMap.actId || run.currentAct;
  const rows = mapRowCount(oldMap);
  const options = nodeMapOptionsForRun(run);
  const rebuildOptions = {
    caravanChanceBonus: options.caravanChanceBonus,
    villageMinRow: villageMinRowFor(options.villageMinRow, actId),
    fogChanceBonus: options.fogChanceBonus,
    halfFogChance: options.halfFogChance,
  };
  const templates = run.gameData?.mapTemplates;
  let nodes = null;
  for (let attempt = 0; attempt < REDRAW_ATTEMPTS && !nodes; attempt++) {
    nodes = withEclipseSeed(redrawSeedKey(run, n, attempt), () => {
      const fresh = generateNodeMap(actId, run.currentActConfig, templates, options);
      const spliced = spliceRoad(oldMap, fresh, keptRow);
      if (!spliced) return null;
      capRoadPromises(oldMap, spliced, keptRow, (node) =>
        rebuildNodeAs(node, NODE_TYPES.BATTLE, actId, rows, templates, rebuildOptions),
      );
      return newRoadProblems(oldMap, spliced).length === 0 ? spliced : null;
    });
  }
  if (!nodes) return { ok: false, reason: 'no_draw' };

  const thrown = new Set(roadAheadIds(oldMap, keptRow));
  const before = {
    nodes: oldMap.nodes,
    routeRedraws: run.routeRedraws,
    ...Object.fromEntries(NODE_KEYED_STATE.map((key) => [key, run[key]])),
  };
  restampSanctum(run, oldMap, nodes, keptRow, n);
  oldMap.nodes = nodes;
  // Nothing the old road ahead held may be read by a new node under the same id.
  for (const key of NODE_KEYED_STATE) {
    const table = run[key];
    if (!table || typeof table !== 'object') continue;
    run[key] = Object.fromEntries(Object.entries(table).filter(([id]) => !thrown.has(id)));
  }
  run._stampExtraShops({ fromRow: keptRow + 1, currentNodeId: run.currentNodeId });
  run.ensureRecruitPreviews();
  run.markEclipseSeen(run.applyEclipseNow().map((node) => node.id));
  run.routeRedraws = n + 1;
  const undo = () => {
    oldMap.nodes = before.nodes;
    run.routeRedraws = before.routeRedraws;
    for (const key of NODE_KEYED_STATE) run[key] = before[key];
  };
  return { ok: true, n: n + 1, price, undo };
}

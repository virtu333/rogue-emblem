// EclipseSystem.js — the Eclipse: a visible run clock (docs/specs/eclipse.md).
//
// Every turn spent in battle darkens the Hollow Sun. Shadow (0..cap) is committed only
// at a battle's victory (RunManager.completeBattle), so Vision rewind, suspend/resume
// and "Continue from Map" never see a half-applied clock. Two numbers move together:
//   - `shadow`, the run's global meter (0..cap): phases, enemy levels, affixes;
//   - `actShadow`, the pressure gathered in this act (reset at act start, NOT capped
//     by the global meter): it makes nodes on the map fall. They are transformed into
//     eclipsed battles (never deleted), so edges and boss reachability never change.
// Keeping them apart means a run whose sun is already Hollow still loses land when it
// plays slowly (review R2: an act starting at 97 used to gather at most 3).
//
// Pure: no Phaser, no DOM. Nothing here reads the caller's Math.random; node
// conversions run under their own seeded stream and restore the caller's generator.
// All numbers live in data/eclipse.json. With no config the Eclipse is inert.

import { createSeededRng } from './BlessingEngine.js';
import { convertNodeToRoutBattle } from './NodeMapGenerator.js';

// 2: `actShadow` (act pressure) is its own field. Version-1 saves derive it on load.
export const ECLIPSE_STATE_VERSION = 2;

// Node types (NODE_TYPES values) that can fall, and what they become.
const FALLABLE_TYPES = new Set(['battle', 'shop', 'church', 'recruit', 'colosseum']);
const DEFAULT_CAP = 100;
// Act pressure is uncapped by the global meter; this only bounds corrupt saves.
const ACT_SHADOW_LIMIT = 9999;

/** 32-bit FNV-1a: stable per-string hash for thresholds and seeded streams. */
export function eclipseHash(input) {
  let h = 2166136261 >>> 0;
  const s = String(input);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function int(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function capOf(config) {
  const cap = int(config?.cap, DEFAULT_CAP);
  return cap > 0 ? cap : DEFAULT_CAP;
}

function clampShadow(value, config) {
  return Math.max(0, Math.min(capOf(config), int(value, 0)));
}

function clampActShadow(value) {
  return Math.max(0, Math.min(ACT_SHADOW_LIMIT, int(value, 0)));
}

/** A fresh run's Eclipse state. */
export function createEclipseState({ enabled = true } = {}) {
  return {
    version: ECLIPSE_STATE_VERSION,
    shadow: 0,
    // Global shadow when this act began (kept for older readers of the save).
    actStartShadow: 0,
    actShadow: 0,
    enabled: enabled !== false,
    kindledNodeIds: [],
  };
}

/**
 * Guarded load of a saved Eclipse state. Legacy saves (no state) start their clock
 * now: enabled, shadow 0. Values are clamped; unknown fields are dropped. A version-1
 * save has no `actShadow`: it is derived as `shadow - actStartShadow` (what the act
 * had gathered under the old rule), so falls and countdowns carry on unchanged.
 */
export function normalizeEclipseState(raw, config = null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return createEclipseState();
  const shadow = clampShadow(raw.shadow, config);
  const actStart = clampShadow(raw.actStartShadow, config);
  const savedAct = Number(raw.actShadow);
  const actShadow = Number.isFinite(savedAct)
    ? clampActShadow(savedAct)
    : Math.max(0, shadow - actStart);
  const kindled = Array.isArray(raw.kindledNodeIds)
    ? [...new Set(raw.kindledNodeIds.filter((id) => typeof id === 'string' && id))]
    : [];
  return {
    version: ECLIPSE_STATE_VERSION,
    shadow,
    actStartShadow: actStart,
    actShadow,
    enabled: raw.enabled !== false,
    kindledNodeIds: kindled,
  };
}

/** True when the Eclipse runs for this state and config (config present, enabled). */
export function isEclipseActive(state, config) {
  return Boolean(config && typeof config === 'object' && state && state.enabled !== false);
}

// ── Gain ─────────────────────────────────────────────────────────────────

/**
 * Shadow a battle adds at victory. Also the HUD projection for the current turn.
 *   gain = min(max(0, turns - max(1, par - grace)), maxGainPerBattle) * difficultyGain
 * A battle without a par adds `noParGain`; tutorial battles and an unknown turn count
 * add nothing.
 * @param {{ turnsTaken:number, par:number|null, difficultyId?:string, tutorialMode?:boolean }} input
 * @param {object} config - data/eclipse.json
 */
export function computeShadowGain(
  { turnsTaken, par = null, difficultyId = 'normal', tutorialMode = false } = {},
  config,
) {
  if (!config || tutorialMode) return 0;
  const turns = Number(turnsTaken);
  if (!Number.isFinite(turns) || turns <= 0) return 0;
  let gain;
  if (Number.isFinite(par)) {
    const grace = Math.max(0, int(config.graceUnderPar, 0));
    const free = Math.max(1, Math.trunc(par) - grace);
    gain = Math.max(0, Math.trunc(turns) - free);
  } else {
    gain = Math.max(0, int(config.noParGain, 0));
  }
  const maxGain = int(config.maxGainPerBattle, Infinity);
  if (Number.isFinite(maxGain)) gain = Math.min(gain, Math.max(0, maxGain));
  const mult = Number(config.difficultyGain?.[difficultyId]);
  return Math.max(0, Math.round(gain * (Number.isFinite(mult) ? mult : 1)));
}

/** Turns left before the projection first rises above zero (0 = already rising). */
export function turnsBeforeShadow({ turnsTaken, par }, config) {
  if (!config || !Number.isFinite(par)) return 0;
  const grace = Math.max(0, int(config.graceUnderPar, 0));
  const free = Math.max(1, Math.trunc(par) - grace);
  return Math.max(0, free - Math.max(0, Math.trunc(Number(turnsTaken) || 0)));
}

// ── Phases ───────────────────────────────────────────────────────────────

function sortedPhases(config) {
  const list = Array.isArray(config?.phases) ? config.phases : [];
  return list
    .filter((p) => p && typeof p.id === 'string')
    .map((p) => ({ id: p.id, name: String(p.name || p.id), min: int(p.min, 0) }))
    .sort((a, b) => a.min - b.min);
}

/**
 * The run phase for a shadow value.
 * @returns {{ id:string, name:string, index:number, min:number, nextMin:number|null }}
 */
export function eclipsePhase(shadow, config) {
  const phases = sortedPhases(config);
  if (!phases.length) return { id: 'pale', name: 'Pale', index: 0, min: 0, nextMin: null };
  const value = Math.max(0, int(shadow, 0));
  let index = 0;
  for (let i = 0; i < phases.length; i++) if (value >= phases[i].min) index = i;
  const phase = phases[index];
  return {
    id: phase.id,
    name: phase.name,
    index,
    min: phase.min,
    nextMin: phases[index + 1]?.min ?? null,
  };
}

function phaseIndexOf(id, config) {
  return sortedPhases(config).findIndex((p) => p.id === id);
}

/**
 * Act shadow (act pressure): the shadow this act has gathered since its map was
 * generated, net of in-act relief. Not limited by the global cap. A state without the
 * field (a version-1 object that skipped normalization) falls back to the old rule.
 */
export function actShadowOf(state) {
  if (!state) return 0;
  const act = Number(state.actShadow);
  if (Number.isFinite(act)) return clampActShadow(act);
  return Math.max(0, int(state.shadow, 0) - int(state.actStartShadow, 0));
}

/**
 * What a victory commit does to both numbers (pure). The gain raises the act pressure
 * in full and the global meter up to the cap; relief (an act boss's flare) is applied
 * after the cap to both, floored at 0.
 * @returns {{ state:object, before:number, after:number, meterGain:number,
 *   actBefore:number, actAfter:number }}
 */
export function commitShadow(state, { gain = 0, relief = 0 } = {}, config = null) {
  const g = Math.max(0, int(gain, 0));
  const r = Math.max(0, int(relief, 0));
  const cap = capOf(config);
  const before = clampShadow(state?.shadow, config);
  const raised = Math.min(cap, before + g);
  const after = Math.max(0, raised - r);
  const actBefore = actShadowOf(state);
  const actAfter = clampActShadow(actBefore + g - r);
  return {
    state: { ...state, shadow: after, actShadow: actAfter },
    before,
    after,
    meterGain: raised - before,
    actBefore,
    actAfter,
  };
}

/**
 * Shadow a victory would add to the global meter for a projected gain (the rest of the
 * gain still darkens the land). 0..gain.
 */
export function projectedMeterGain(state, gain, config = null) {
  const g = Math.max(0, int(gain, 0));
  const before = clampShadow(state?.shadow, config);
  return Math.min(capOf(config), before + g) - before;
}

/** A new act: fresh land. Act pressure restarts at 0; the global meter carries on. */
export function beginActShadow(state) {
  return { ...state, actStartShadow: int(state?.shadow, 0), actShadow: 0 };
}

// ── The map ──────────────────────────────────────────────────────────────

/** outer (lanes 0,4), inner (1,3), center (2) for a five-lane loom. */
export function laneKind(col, lanes = 5) {
  const center = Math.floor(lanes / 2);
  const d = Math.abs(int(col, center) - center);
  if (d === 0) return 'center';
  if (d === 1) return 'inner';
  return 'outer';
}

/**
 * Deterministic fall threshold of a node, in act-shadow units. Computed, never stored.
 *   laneBase[lane] + round(rowBias * (1 - row/(rows-1))) + hash(eclipse:seed:id) % (jitter+1)
 */
export function nodeFallThreshold(node, { runSeed, rows, config }) {
  if (!node || !config) return Infinity;
  const base = int(config.laneBase?.[laneKind(node.col)], 0);
  const span = Math.max(1, int(rows, 1) - 1);
  const rowTerm = Math.round(
    Number(config.rowBias || 0) * (1 - Math.min(1, Math.max(0, int(node.row, 0) / span))),
  );
  const jitterSpan = Math.max(0, int(config.jitter, 0)) + 1;
  const jitter = eclipseHash(`eclipse:${runSeed}:${node.id}`) % jitterSpan;
  return base + rowTerm + jitter;
}

/** True once the dark has taken the node. */
export function isNodeEclipsed(node) {
  return Boolean(node?.eclipse && typeof node.eclipse === 'object');
}

function mapRows(nodeMap) {
  const nodes = Array.isArray(nodeMap?.nodes) ? nodeMap.nodes : [];
  return nodes.length ? Math.max(...nodes.map((n) => int(n.row, 0))) + 1 : 0;
}

/**
 * Why a node can never fall right now (null when it can).
 * start / boss / ruins / completed / current / locked / eclipsed / type
 */
export function nodeFallExemption(node, { nodeMap, currentNodeId = null, activeNodeId = null }) {
  if (!node) return 'missing';
  if (isNodeEclipsed(node)) return 'eclipsed';
  if (node.id === nodeMap?.startNodeId) return 'start';
  if (node.id === nodeMap?.bossNodeId || node.type === 'boss') return 'boss';
  if (node.type === 'ruins') return 'ruins';
  if (node.completed) return 'completed';
  if (node.id === currentNodeId || node.id === activeNodeId) return 'current';
  if (node.encounterLocked) return 'locked';
  if (!FALLABLE_TYPES.has(node.type)) return 'type';
  return null;
}

/** Label/noun for a fallen node's original type (data/eclipse.json `falls`). */
export function fallCopy(fromType, config) {
  const entry = config?.falls?.[fromType] || config?.falls?.battle || null;
  return {
    label: String(entry?.label || 'Eclipsed battle'),
    noun: String(entry?.noun || 'land'),
  };
}

// The loss a toast names first: a lost service stings more than a battlefield.
const FALL_WEIGHT = { shop: 5, church: 4, recruit: 3, colosseum: 2, battle: 1 };

/** The player-facing line for a set of falls: "The dark takes the village." */
export function fallToastText(nodes, config) {
  const list = (Array.isArray(nodes) ? nodes : []).filter(isNodeEclipsed);
  if (!list.length) return '';
  const first = list.reduce((best, n) =>
    (FALL_WEIGHT[n.eclipse.fromType] || 0) > (FALL_WEIGHT[best.eclipse.fromType] || 0) ? n : best,
  );
  const { noun } = fallCopy(first.eclipse.fromType, config);
  if (list.length === 1) return `The dark takes the ${noun}.`;
  return `The dark takes the ${noun} and ${list.length - 1} more.`;
}

/**
 * Run `fn` with Math.random replaced by a seeded stream, restoring the caller's
 * generator afterwards (the RunManager._withNodeMapSeed install/restore pattern).
 */
export function withEclipseSeed(key, fn) {
  const prev = Math.random;
  Math.random = createSeededRng(eclipseHash(key));
  try {
    return fn();
  } finally {
    Math.random = prev;
  }
}

/**
 * Transform one node into its eclipsed form (in place). A battle keeps its encounter
 * and becomes elite; a service/recruit/arena node becomes a fresh rout battle rolled
 * under `eclipse-node:${runSeed}:${nodeId}`.
 */
export function eclipseNode(node, ctx) {
  const {
    runSeed,
    config,
    actId,
    mapTemplates = null,
    fogChanceBonus = 0,
    halfFogChance = false,
    shadow = 0,
  } = ctx;
  const fromType = node.type;
  const { label } = fallCopy(fromType, config);
  if (fromType === 'battle' && node.battleParams) {
    node.battleParams = { ...node.battleParams, isEclipsed: true, isElite: true };
  } else {
    withEclipseSeed(`eclipse-node:${runSeed}:${node.id}`, () =>
      convertNodeToRoutBattle(node, actId, mapTemplates, {
        fogChanceBonus,
        halfFogChance,
        extraParams: { isEclipsed: true, isElite: true },
      }),
    );
    node.type = 'battle';
    delete node.isAmbush;
    delete node.ambushCleared;
  }
  node.eclipse = {
    fellAtShadow: Math.max(0, int(shadow, 0)),
    fromType,
    label,
    seen: false,
  };
  return node;
}

/**
 * Let the dark take every node whose threshold the act shadow has reached. Idempotent:
 * eclipsed nodes are exempt, so a second call with the same state changes nothing.
 * @returns {Array<object>} the nodes that fell in this call (in map order)
 */
export function applyEclipse({
  state,
  config,
  nodeMap,
  runSeed,
  currentNodeId = null,
  activeNodeId = null,
  mapTemplates = null,
  fogChanceBonus = 0,
  halfFogChance = false,
}) {
  if (!isEclipseActive(state, config) || !Array.isArray(nodeMap?.nodes)) return [];
  const act = actShadowOf(state);
  if (act <= 0) return [];
  const rows = mapRows(nodeMap);
  const actId = nodeMap.actId || nodeMap.nodes[0]?.battleParams?.act || 'act1';
  const fallen = [];
  for (const node of nodeMap.nodes) {
    if (nodeFallExemption(node, { nodeMap, currentNodeId, activeNodeId })) continue;
    if (act < nodeFallThreshold(node, { runSeed, rows, config })) continue;
    eclipseNode(node, {
      runSeed,
      config,
      actId,
      mapTemplates,
      fogChanceBonus,
      halfFogChance,
      shadow: state.shadow,
    });
    fallen.push(node);
  }
  return fallen;
}

// ── Battle modifiers ─────────────────────────────────────────────────────

/**
 * What the Eclipse adds to a battle's params: the phase's enemy level bonus, the
 * eclipsed node's bonus, and affix overrides for AffixEngine.
 * @returns {{ enemyLevelBonus:number, phaseId:string, phaseIndex:number, affix:object|null }}
 */
export function eclipseBattleMods({ state, config, difficultyId = 'normal', isEclipsed = false }) {
  if (!isEclipseActive(state, config)) {
    return { enemyLevelBonus: 0, phaseId: null, phaseIndex: 0, affix: null };
  }
  const phase = eclipsePhase(state.shadow, config);
  const levels = Array.isArray(config.phaseEnemyLevelBonus) ? config.phaseEnemyLevelBonus : [];
  let enemyLevelBonus = int(levels[Math.min(phase.index, levels.length - 1)], 0);
  if (isEclipsed) enemyLevelBonus += int(config.eclipsedEnemyLevelBonus, 0);
  const rules = config.phaseAffix || {};
  const hardFrom = phaseIndexOf(rules.hardGatingFromPhase, config);
  const extraFrom = phaseIndexOf(rules.extraMaxAffixFromPhase, config);
  const affix = {
    gatingDifficultyId:
      difficultyId === 'normal' && hardFrom >= 0 && phase.index >= hardFrom ? 'hard' : null,
    extraMaxAffixes:
      extraFrom >= 0 && phase.index >= extraFrom ? Math.max(0, int(rules.extraMaxAffixes, 0)) : 0,
    guaranteedCount: isEclipsed ? Math.max(0, int(config.eclipsedAffixCount, 0)) : 0,
    guaranteedTier: Math.max(1, int(config.eclipsedAffixTier, 1)),
  };
  const hasAffixMod =
    affix.gatingDifficultyId || affix.extraMaxAffixes > 0 || affix.guaranteedCount > 0;
  return {
    enemyLevelBonus,
    phaseId: phase.id,
    phaseIndex: phase.index,
    affix: hasAffixMod ? affix : null,
  };
}

// ── Kindle (church service) ──────────────────────────────────────────────

/** Gold price of Kindle in an act (null when the act has no price). */
export function kindlePrice(actId, config) {
  const price = Number(config?.kindlePrice?.[actId]);
  return Number.isFinite(price) && price >= 0 ? Math.trunc(price) : null;
}

/** Why Kindle can't be bought here ('' when it can). */
export function kindleBlock({ state, config, nodeId, actId, gold }) {
  if (!isEclipseActive(state, config)) return 'The sun cannot be kindled here.';
  const price = kindlePrice(actId, config);
  if (price == null) return 'The sun cannot be kindled here.';
  if (typeof nodeId !== 'string' || !nodeId) return 'The sun cannot be kindled here.';
  if ((state.kindledNodeIds || []).includes(nodeId)) return 'Already kindled at this chapel.';
  if (int(state.shadow, 0) <= 0) return 'The sun is already clear.';
  if (!(Number(gold) >= price)) return 'Not enough gold.';
  return '';
}

/**
 * Pure outcome of a Kindle: the new state and the gold it costs. Callers apply it.
 * @returns {{ ok:boolean, reason?:string, price?:number, removed?:number, state?:object }}
 */
export function kindleResult({ state, config, nodeId, actId, gold }) {
  const reason = kindleBlock({ state, config, nodeId, actId, gold });
  if (reason) return { ok: false, reason };
  const price = kindlePrice(actId, config);
  const amount = Math.max(0, int(config.kindleAmount, 0));
  const before = int(state.shadow, 0);
  const after = Math.max(0, before - amount);
  // Kindle lowers both: the global meter and this act's pressure (nodes fall later).
  const actBefore = actShadowOf(state);
  const actAfter = Math.max(0, actBefore - amount);
  return {
    ok: true,
    price,
    removed: before - after,
    actRemoved: actBefore - actAfter,
    state: {
      ...state,
      shadow: after,
      actShadow: actAfter,
      kindledNodeIds: [...(state.kindledNodeIds || []), nodeId],
    },
  };
}

// ── View model (presentation) ────────────────────────────────────────────

/**
 * Everything the Loom needs to draw the Eclipse for the current act: the run phase,
 * each node's fall status, and how far the next fall is. Pure; reads only.
 * @param {object} opts { state, config, nodeMap, runSeed, currentNodeId, activeNodeId,
 *   reachableIds? (Set of ids the party can still reach; limits `nextFall`) }
 */
export function buildEclipseView({
  state,
  config,
  nodeMap,
  runSeed,
  currentNodeId = null,
  activeNodeId = null,
  reachableIds = null,
}) {
  if (!isEclipseActive(state, config)) return null;
  const shadow = clampShadow(state.shadow, config);
  const act = actShadowOf(state);
  const phase = eclipsePhase(shadow, config);
  const warn = Math.max(0, int(config.fallWarning, 0));
  const nodes = new Map();
  const rows = mapRows(nodeMap);
  let nextFall = null;
  let nextFallAny = null;
  const lanes = [0, 0, 0, 0, 0];
  const laneTotals = [0, 0, 0, 0, 0];
  for (const node of nodeMap?.nodes || []) {
    const lane = Math.max(0, Math.min(4, int(node.col, 2)));
    if (isNodeEclipsed(node)) {
      nodes.set(node.id, {
        eclipsed: true,
        label: node.eclipse.label || fallCopy(node.eclipse.fromType, config).label,
        fromType: node.eclipse.fromType || null,
        seen: node.eclipse.seen === true,
        remaining: null,
        near: false,
      });
      if (!node.completed) {
        lanes[lane] += 1;
        laneTotals[lane] += 1;
      }
      continue;
    }
    if (!node.completed && node.type !== 'boss') laneTotals[lane] += 1;
    const exempt = nodeFallExemption(node, { nodeMap, currentNodeId, activeNodeId });
    if (exempt && exempt !== 'current' && exempt !== 'locked') {
      nodes.set(node.id, { eclipsed: false, remaining: null, near: false });
      continue;
    }
    const threshold = nodeFallThreshold(node, { runSeed, rows, config });
    const remaining = Math.max(1, threshold - act);
    const guarded = Boolean(exempt);
    nodes.set(node.id, {
      eclipsed: false,
      remaining,
      threshold,
      guarded,
      near: !guarded && remaining <= warn,
    });
    if (guarded) continue;
    if (nextFallAny == null || remaining < nextFallAny) nextFallAny = remaining;
    if (!reachableIds || reachableIds.has(node.id)) {
      if (nextFall == null || remaining < nextFall) nextFall = remaining;
    }
  }
  return {
    shadow,
    cap: capOf(config),
    // The global meter is full, yet the act keeps gathering (the land still darkens).
    atCap: shadow >= capOf(config),
    actShadow: act,
    phase,
    nodes,
    nextFall: nextFall ?? null,
    nextFallAnywhere: nextFallAny ?? null,
    laneDarkness: lanes.map((n, i) => (laneTotals[i] ? n / laneTotals[i] : 0)),
    unseen: (nodeMap?.nodes || []).filter((n) => isNodeEclipsed(n) && n.eclipse.seen !== true),
  };
}

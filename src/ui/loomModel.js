// loomModel.js — pure model for the route map ("the Loom", docs/art-direction/board/loom).
//
// The route graph is drawn as Sera's loom: generator lanes are warp threads, the walked
// route is a gold rope, reachable choices glow, futures fade, abandoned roads fray.
// Everything here is presentation logic over the existing node-map data; it never
// changes which nodes are available (RunManager.getAvailableNodes stays the authority).
// No DOM, no Phaser: unit-tested in tests/LoomModel.test.js.

export const LOOM_LANES = 5;

// Horizontal metrics (CSS px). Row spacing follows the medal size so threads between
// neighbouring medals stay readable (README: dx >= medal + 26, capped at 96).
export const LOOM_PAD = Object.freeze({ left: 40, right: 50, top: 42, bottom: 30 });
export const LOOM_DX_GAP = 26;
export const LOOM_DX_MAX = 96;
// Lane spacing never exceeds this multiple of the medal (tall desktop looms stay woven).
export const LOOM_DY_PER_MEDAL = 2.2;
// Looms narrower than this switch to the compact medal (README: container query).
export const LOOM_NARROW_WIDTH = 560;
export const LOOM_MEDAL = 40;
export const LOOM_MEDAL_NARROW = 36;
// Tall, wide looms (desktop) get a slightly larger medal.
export const LOOM_MEDAL_ROOMY = 44;
// Futures dissolve this many rows past the party's row.
export const LOOM_DISSOLVE_ROWS = 2.6;

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

/** Roman numeral for a 1-based count (row numerals, act numbers). */
export function toRoman(n) {
  const i = Math.floor(Number(n));
  return ROMAN[i - 1] || String(i);
}

/** Medal diameter for a loom of the given visible size. */
export function loomMedalSize(width, height = 0) {
  if (width > 0 && width <= LOOM_NARROW_WIDTH) return LOOM_MEDAL_NARROW;
  if (width >= 680 && height >= 520) return LOOM_MEDAL_ROOMY;
  return LOOM_MEDAL;
}

/**
 * Classify every node and thread of an act graph.
 *
 * @param {object} opts
 * @param {Array<{id,row,col,type,edges,completed?}>} opts.nodes
 * @param {string} opts.startNodeId
 * @param {Iterable<string>} [opts.availableIds]  nodes the party may enter now
 * @param {string|null} [opts.currentId]  where the party stands (last completed node,
 *   or the node being fought in the read-only in-battle view)
 * @param {Iterable<string>} [opts.completedIds]  defaults to nodes flagged `completed`
 */
export function buildLoomModel({
  nodes = [],
  startNodeId = null,
  availableIds = [],
  currentId = null,
  completedIds = null,
} = {}) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const completed = new Set(
    completedIds ? [...completedIds] : nodes.filter((n) => n.completed).map((n) => n.id),
  );
  const available = new Set([...availableIds].filter((id) => byId.has(id)));
  const current = byId.has(currentId) ? currentId : null;
  const rows = nodes.length ? Math.max(...nodes.map((n) => n.row)) + 1 : 0;
  const startId = byId.has(startNodeId)
    ? startNodeId
    : (nodes.find((n) => n.row === 0)?.id ?? null);
  const bossId =
    nodes.find((n) => n.type === 'boss' && n.row === rows - 1)?.id ??
    nodes.find((n) => n.type === 'boss')?.id ??
    null;

  // Steps from the party: 1 = a choice within reach, 2 = the knot after it, ...
  const steps = new Map();
  let frontier = [...available];
  for (let d = 1; frontier.length; d++) {
    const next = [];
    for (const id of frontier) {
      if (steps.has(id)) continue;
      steps.set(id, d);
      for (const e of byId.get(id)?.edges || []) if (byId.has(e)) next.push(e);
    }
    frontier = next;
  }

  // The walked route: every completed knot plus the node the party stands on.
  const walked = new Set(completed);
  if (current) walked.add(current);
  const frontierRow = current ? byId.get(current).row : -1;

  function nodeState(id) {
    const n = byId.get(id);
    if (!n) return 'cut';
    if (id === current) return 'current';
    if (completed.has(id)) return 'done';
    if (available.has(id)) return 'live';
    if (steps.has(id)) return 'future';
    return 'cut';
  }

  function edgeKind(aId, bId) {
    if (walked.has(aId) && walked.has(bId)) return 'woven';
    if (aId === current && available.has(bId)) return 'live';
    if ((available.has(aId) || steps.has(aId)) && steps.has(bId)) return 'future';
    return 'cut';
  }

  const edges = [];
  for (const a of nodes)
    for (const bId of a.edges || []) {
      if (!byId.has(bId)) continue;
      edges.push({ from: a.id, to: bId, kind: edgeKind(a.id, bId) });
    }

  // The run's thread enters from the loom's left beam into the act's first knot.
  const leadKind = !startId
    ? 'cut'
    : walked.has(startId)
      ? 'woven'
      : available.has(startId)
        ? 'live'
        : 'future';

  /** Every node with a forward route to `targetId` (inclusive). */
  function canReach(targetId) {
    const reach = new Set(byId.has(targetId) ? [targetId] : []);
    let grew = reach.size > 0;
    while (grew) {
      grew = false;
      for (const n of nodes)
        if (!reach.has(n.id) && (n.edges || []).some((e) => reach.has(e))) {
          reach.add(n.id);
          grew = true;
        }
    }
    return reach;
  }

  /**
   * Sera's vision: the threads of every route from the party to a future node.
   * Returns [] for anything that is not a (reachable) future.
   */
  function visionEdges(targetId) {
    if (nodeState(targetId) !== 'future') return [];
    const reach = canReach(targetId);
    return edges.filter(
      (e) =>
        reach.has(e.to) &&
        (e.kind === 'live' ||
          (e.kind === 'future' && (available.has(e.from) || steps.has(e.from)))),
    );
  }

  /** 1 near the party; futures fade to a floor two-and-a-bit rows out. */
  function rowFade(row) {
    const d = row - (frontierRow + LOOM_DISSOLVE_ROWS);
    return d <= 0 ? 1 : Math.max(0.28, 1 - d * 0.24);
  }

  /** Opacity for a node button. Kept at or below 0.68 so futures read as quiet. */
  function nodeOpacity(id) {
    const n = byId.get(id);
    const state = nodeState(id);
    if (!n || (state !== 'future' && state !== 'cut')) return 1;
    const fade = n.type === 'boss' ? 1 : rowFade(n.row);
    return state === 'cut'
      ? Math.max(0.42, Math.min(0.6, fade * 0.6))
      : Math.max(0.5, Math.min(0.68, fade * 0.68));
  }

  return {
    byId,
    rows,
    startId,
    bossId,
    current,
    completed,
    available,
    steps,
    frontierRow,
    edges,
    leadKind,
    nodeState,
    edgeKind,
    canReach,
    visionEdges,
    rowFade,
    nodeOpacity,
    dissolveRow: frontierRow + LOOM_DISSOLVE_ROWS,
  };
}

/**
 * Loom geometry for a visible area of `width` x `height` CSS px.
 * Rows run left to right; the five generator lanes are horizontal warp threads.
 */
export function layoutLoom({ rows, width, height, medal = LOOM_MEDAL, lanes = LOOM_LANES }) {
  const W = Math.max(0, width || 0);
  const H = Math.max(0, height || 0);
  const span = Math.max(1, rows - 1);
  const { left, right, top, bottom } = LOOM_PAD;
  const minDx = medal + LOOM_DX_GAP;
  const dx = Math.min(LOOM_DX_MAX, Math.max(minDx, (W - left - right) / span));
  const content = left + right + dx * span;
  const innerW = Math.max(W, Math.ceil(content));
  const padL = left + (innerW > content ? (innerW - content) / 2 : 0);
  const laneGaps = Math.max(1, lanes - 1);
  const dy = Math.max(0, Math.min(medal * LOOM_DY_PER_MEDAL, (H - top - bottom) / laneGaps));
  const block = top + bottom + dy * laneGaps;
  const offY = H > block ? Math.floor((H - block) / 2) : 0;
  const padT = top + offY;
  return {
    width: W,
    height: H,
    innerW,
    medal,
    dx,
    dy,
    padL,
    padT,
    // The heddle ruler (row numerals) rides just above the top lane.
    numeralY: padT - 27,
    tickY: padT - 22,
    x: (row) => padL + row * dx,
    y: (col) => padT + col * dy,
  };
}

/** Horizontal scroll that anchors a fresh loom on the choices (two rows of lead-in). */
export function loomAnchorScroll(layout, model) {
  const rows = [...model.available].map((id) => model.byId.get(id)?.row ?? 0);
  if (!rows.length) return 0;
  const x = layout.x(Math.min(...rows));
  return Math.max(0, Math.min(layout.innerW - layout.width, Math.round(x - layout.dx * 1.4)));
}

/** Deterministic index for per-node flavour so copy never flickers between renders. */
export function stableIndex(key, length) {
  if (!length) return -1;
  let h = 0x811c9dc5;
  for (const c of String(key)) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h ^= h >>> 13;
  h = Math.imul(h, 0x5bd1e995);
  return ((h ^ (h >>> 15)) >>> 0) % length;
}

const KIND = {
  battle: 'BATTLE',
  church: 'CHURCH',
  boss: 'BOSS',
  shop: 'VILLAGE',
  ruins: 'RUINS',
  recruit: 'RECRUIT',
  colosseum: 'COLOSSEUM',
};
const OBJECTIVE = {
  rout: ['ROUT', 'Defeat all enemies on the map.'],
  seize: ['SEIZE', 'Take the throne once its guard falls.'],
  escape: ['ESCAPE', 'Get every lord to an escape square. Pursuers never stop.'],
};
const BATTLE_TYPES = new Set(['battle', 'boss', 'recruit']);
const SERVICE = {
  shop: 'Buy, sell and forge equipment.',
  church: 'Heal, revive allies and promote units.',
  ruins: 'Supplies and services among the ruins.',
  colosseum: 'Arena and mercenary board.',
  recruit: 'Battle with a potential ally.',
};

/** Short pixel label shown under a reachable medal. */
export function loomShortLabel(node) {
  const elite = BATTLE_TYPES.has(node?.type) && node?.battleParams?.isElite;
  return elite ? 'ELITE' : KIND[node?.type] || String(node?.type || '').toUpperCase();
}

function templateLookup(mapTemplates, id) {
  if (!id || !mapTemplates) return null;
  for (const list of Object.values(mapTemplates))
    if (Array.isArray(list)) {
      const t = list.find((entry) => entry?.id === id);
      if (t) return t;
    }
  return null;
}

function flavorPool(node, dialogue, actId) {
  const nf = dialogue?.nodeFlavor || {};
  const pick = (pool) => (pool ? pool[actId] || pool.act3 || null : null);
  if (node.type === 'shop') return dialogue?.shopFlavor?.[actId] || null;
  if (node.type === 'boss') return pick(nf.boss);
  if (node.type === 'recruit') return pick(nf.recruit);
  if (node.type === 'battle') return pick(node.battleParams?.isElite ? nf.elite : nf.battle);
  // Church, ruins and colosseum have no flavour pool yet.
  return null;
}

/**
 * The inspect card for one node: kind, place, tags, copy and the thread line.
 * All inputs are existing data; nothing is rolled or revealed beyond what the battle
 * will actually use (fog honours the first-battle rule, levels include the difficulty
 * offset the map generator applies).
 */
export function describeLoomNode(
  node,
  {
    state,
    steps = null,
    actId = 'act1',
    mapTemplates = null,
    dialogue = null,
    enemyLevelBonus = 0,
    firstBattle = false,
    eliteLoot = null,
    shopOpen = false,
    activeLabel = null,
  } = {},
) {
  if (!node) return null;
  // Only real encounters reveal battle details. A service node may carry hidden
  // battleParams (a village that turns out to be an ambush) and must stay a village.
  const params = BATTLE_TYPES.has(node.type) ? node.battleParams || null : null;
  const elite = !!params?.isElite;
  const objectiveId = params?.objective || (node.type === 'boss' ? 'seize' : null);
  const objective = objectiveId ? OBJECTIVE[objectiveId] || [objectiveId.toUpperCase(), ''] : null;
  const template = params
    ? templateLookup(mapTemplates, node.templateId || params.templateId)
    : null;
  const place = node.type === 'recruit' ? 'A potential ally' : template?.name || null;

  const tags = [];
  if (Array.isArray(params?.levelRange) && params.levelRange.length === 2) {
    const bonus = Number.isFinite(enemyLevelBonus) ? enemyLevelBonus : 0;
    const [lo, hi] = params.levelRange.map((v) => Math.max(1, v + bonus));
    tags.push({ text: lo === hi ? `Foes Lv ${lo}` : `Foes Lv ${lo}–${hi}`, tone: 'plain' });
  }
  if (params && node.fogEnabled && !firstBattle) tags.push({ text: 'Fog', tone: 'info' });
  if (params?.hasVillage) tags.push({ text: 'Village', tone: 'good' });
  if (params?.hasCaravan) tags.push({ text: 'Caravan', tone: 'good' });
  if (elite && eliteLoot?.choices && eliteLoot?.picks)
    tags.push({ text: `Loot: pick ${eliteLoot.picks} of ${eliteLoot.choices}`, tone: 'bad' });
  if (params && node.encounterLocked) tags.push({ text: 'Encounter locked', tone: 'plain' });

  const text = SERVICE[node.type] || objective?.[1] || '';
  const pool = state === 'cut' ? null : flavorPool(node, dialogue, actId);
  const flavor =
    Array.isArray(pool) && pool.length ? pool[stableIndex(node.id, pool.length)] : null;

  let stateLine;
  if (shopOpen) stateLine = { tone: 'done', text: 'Shop still open · Stock and prices retained' };
  else if (state === 'current')
    stateLine = { tone: 'done', text: activeLabel || 'The party rests here' };
  else if (state === 'done') stateLine = { tone: 'done', text: 'Woven · already walked' };
  else if (state === 'live') stateLine = { tone: 'live', text: 'Within reach · the next knot' };
  else if (state === 'future')
    stateLine = {
      tone: 'future',
      text: steps > 1 ? `Possible future · ${steps} steps` : 'Possible future',
    };
  else stateLine = { tone: 'cut', text: 'A frayed thread · out of reach' };

  return {
    kind: elite ? 'ELITE' : KIND[node.type] || String(node.type || '').toUpperCase(),
    elite,
    objective: objective && node.type !== 'recruit' ? objective[0] : null,
    place,
    lore: template?.lore || null,
    tags,
    text,
    flavor,
    stateLine,
  };
}

/** Act header: Cinzel title ("Act I · Border Marches") and the pixel subline. */
export function loomHeader({
  actIndex = 0,
  actName = '',
  region = '',
  rows = 0,
  frontierRow = -1,
}) {
  const rowNow = rows ? Math.min(rows, Math.max(1, frontierRow + 2)) : 0;
  const sub = [actName, rows ? `Row ${rowNow} of ${rows}` : null].filter(Boolean).join(' · ');
  return {
    act: `Act ${toRoman(actIndex + 1)}`,
    title: region || actName || 'Campaign',
    sub: sub.toUpperCase(),
  };
}

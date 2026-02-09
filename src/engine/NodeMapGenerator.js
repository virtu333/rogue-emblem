// NodeMapGenerator.js — Pure function: generates branching node map graph per act
// No Phaser deps. Follows MapGenerator.js pattern.
// Uses a fixed column-lane system (like Slay the Spire) to prevent edge crossings.

import { NODE_TYPES, FOG_CHANCE_BY_ACT } from '../utils/constants.js';

// Number of fixed column lanes for the node map grid
const NUM_COLUMNS = 5;
const CENTER_COL = Math.floor(NUM_COLUMNS / 2); // 2

// Per-row enemy level scaling: act → row → [minLevel, maxLevel]
// Acts without an entry use the pool default levelRange from enemies.json
const ACT_LEVEL_SCALING = {
  act1: { 0: [1, 1], 1: [1, 2], default: [2, 3] },
};

/**
 * Generate a branching node map for one act.
 * Nodes are placed on a fixed column grid (0 to NUM_COLUMNS-1).
 * Edges only connect to same or adjacent columns (±1), preventing visual crossings.
 * @param {string} actId - e.g. 'act1', 'act2', 'act3', 'finalBoss'
 * @param {{ name: string, rows: number }} actConfig
 * @returns {{ actId, nodes: Array, startNodeId, bossNodeId }}
 */
export function generateNodeMap(actId, actConfig) {
  const { rows } = actConfig;

  // Special case: finalBoss is a single boss node
  if (rows === 1) {
    const node = {
      id: `${actId}_0_0`,
      row: 0,
      col: 0,
      type: NODE_TYPES.BOSS,
      edges: [],
      battleParams: { act: actId, objective: 'seize' },
      completed: false,
    };
    return {
      actId,
      nodes: [node],
      startNodeId: node.id,
      bossNodeId: node.id,
    };
  }

  // Step 1: Assign column lanes to each row
  const rowCols = [];
  for (let r = 0; r < rows; r++) {
    if (r === 0 || r === rows - 1) {
      rowCols.push([CENTER_COL]);
    } else {
      const count = 2 + Math.floor(Math.random() * 3); // 2, 3, or 4
      const prevCols = rowCols[r - 1];
      rowCols.push(pickColumnsWithCoverage(count, prevCols));
    }
  }

  // Backward pass: ensure penultimate row can reach the boss at CENTER_COL
  if (rows > 2) {
    const penultimate = rowCols[rows - 2];
    if (!penultimate.some(c => Math.abs(c - CENTER_COL) <= 1)) {
      // Add a column reachable from the row before AND within ±1 of boss
      const rowBefore = rowCols[rows - 3]; // exists because rows > 2 means rows >= 3
      const candidates = [CENTER_COL - 1, CENTER_COL, CENTER_COL + 1]
        .filter(c => c >= 0 && c < NUM_COLUMNS && !penultimate.includes(c)
          && rowBefore.some(pc => Math.abs(pc - c) <= 1));
      if (candidates.length > 0) {
        penultimate.push(candidates[Math.floor(Math.random() * candidates.length)]);
        penultimate.sort((a, b) => a - b);
      }
    }
  }

  // Step 2: Create nodes from column assignments
  const nodes = [];
  const rowNodes = [];
  for (let r = 0; r < rows; r++) {
    const rowList = [];
    for (const c of rowCols[r]) {
      const type = pickNodeType(r, rows);
      const node = {
        id: `${actId}_${r}_${c}`,
        row: r,
        col: c,
        type,
        edges: [],
        battleParams: buildBattleParams(actId, type, r),
        completed: false,
      };
      if (type === NODE_TYPES.BATTLE && Math.random() < (FOG_CHANCE_BY_ACT[actId] || 0)) {
        node.fogEnabled = true;
      }
      nodes.push(node);
      rowList.push(node);
    }
    rowNodes.push(rowList);
  }

  // Step 3: Generate edges between adjacent rows (±1 column constraint)
  for (let r = 0; r < rows - 1; r++) {
    connectRows(rowNodes[r], rowNodes[r + 1]);
  }

  // Post-process: guarantee 1-2 RECRUIT nodes per act (middle rows only)
  const convertibleTypes = [NODE_TYPES.BATTLE, NODE_TYPES.SHOP];
  const middleNodes = nodes.filter(n =>
    n.row > 1 && n.row < rows - 1 && convertibleTypes.includes(n.type)
  );
  const recruitCount = nodes.filter(n => n.type === NODE_TYPES.RECRUIT).length;
  if (recruitCount === 0 && middleNodes.length > 0) {
    const battleFirst = middleNodes.filter(n => n.type === NODE_TYPES.BATTLE);
    const candidates = battleFirst.length > 0 ? battleFirst : middleNodes;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    pick.type = NODE_TYPES.RECRUIT;
    pick.battleParams = buildBattleParams(actId, NODE_TYPES.RECRUIT, pick.row);
  }
  const currentRecruits = nodes.filter(n => n.type === NODE_TYPES.RECRUIT).length;
  if (currentRecruits === 1 && Math.random() < 0.5) {
    const remaining = nodes.filter(n =>
      n.row > 1 && n.row < rows - 1 && convertibleTypes.includes(n.type)
    );
    if (remaining.length > 0) {
      const pick = remaining[Math.floor(Math.random() * remaining.length)];
      pick.type = NODE_TYPES.RECRUIT;
      pick.battleParams = buildBattleParams(actId, NODE_TYPES.RECRUIT, pick.row);
    }
  }

  const startNodeId = rowNodes[0][0].id;
  const bossNodeId = rowNodes[rows - 1][0].id;

  return { actId, nodes, startNodeId, bossNodeId };
}

/**
 * Pick columns for a row, ensuring ±1 coverage of the previous row's columns.
 * All selected columns are guaranteed reachable (within ±1 of some prevCol).
 * Always includes at least one center-band column (1, 2, or 3) for boss reachability.
 * @param {number} desiredCount - target number of columns (2-4)
 * @param {number[]} prevCols - columns from the previous row
 * @returns {number[]} sorted array of column indices
 */
function pickColumnsWithCoverage(desiredCount, prevCols) {
  // Determine which columns are reachable from the previous row
  const reachable = new Set();
  for (const pc of prevCols) {
    for (let d = -1; d <= 1; d++) {
      const c = pc + d;
      if (c >= 0 && c < NUM_COLUMNS) reachable.add(c);
    }
  }

  const cols = new Set();

  // Guarantee a center-band column that is also reachable (for boss connectivity)
  const reachableCenter = [1, 2, 3].filter(c => reachable.has(c));
  if (reachableCenter.length > 0) {
    cols.add(reachableCenter[Math.floor(Math.random() * reachableCenter.length)]);
  }

  // Ensure every prevCol has a ±1 neighbor in this row
  for (const pc of prevCols) {
    if ([...cols].some(c => Math.abs(c - pc) <= 1)) continue;
    const neighbors = [pc - 1, pc, pc + 1].filter(c => c >= 0 && c < NUM_COLUMNS);
    cols.add(neighbors[Math.floor(Math.random() * neighbors.length)]);
  }

  // Fill up to desiredCount from reachable columns only
  const reachableArr = [...reachable];
  while (cols.size < desiredCount) {
    const available = reachableArr.filter(c => !cols.has(c));
    if (available.length === 0) break;
    cols.add(available[Math.floor(Math.random() * available.length)]);
  }

  return [...cols].sort((a, b) => a - b);
}

/**
 * Pick node type based on row position.
 * Row 0 = battle (opening fight), last row = boss, row 1 = battle (no rest yet).
 * Middle rows: 55% battle, 20% rest, 25% shop.
 */
function pickNodeType(row, totalRows) {
  if (row === 0) return NODE_TYPES.BATTLE;
  if (row === totalRows - 1) return NODE_TYPES.BOSS;
  if (row === 1) return NODE_TYPES.BATTLE; // no rest or shop in row 1
  const roll = Math.random();
  if (roll < 0.55) return NODE_TYPES.BATTLE;
  if (roll < 0.75) return NODE_TYPES.REST;
  return NODE_TYPES.SHOP;
}

/**
 * Build battleParams for a node based on type.
 * @param {string} actId
 * @param {string} type - NODE_TYPES value
 * @param {number} [row] - row index for per-node level scaling
 */
function buildBattleParams(actId, type, row) {
  if (type === NODE_TYPES.BOSS) {
    return { act: actId, objective: 'seize', row };
  }
  if (type === NODE_TYPES.REST || type === NODE_TYPES.SHOP) {
    return null;
  }

  let params;
  if (type === NODE_TYPES.RECRUIT) {
    params = { act: actId, objective: 'rout', isRecruitBattle: true };
  } else {
    const canSeize = row !== undefined && row >= 2;
    const objective = canSeize && Math.random() < 0.4 ? 'seize' : 'rout';
    params = { act: actId, objective };
  }

  if (row !== undefined) params.row = row;

  const scaling = ACT_LEVEL_SCALING[actId];
  if (scaling && row !== undefined) {
    params.levelRange = scaling[row] || scaling.default;
  }

  return params;
}

/**
 * Connect nodes in adjacent rows with edges.
 * Uses column distance ±1 constraint + crossing check to prevent visual crossings.
 * Exception: when either row has a single node, all edges converge/diverge from
 * one point, so crossings are structurally impossible — column constraint is relaxed.
 * Guarantees: every node has >=1 outgoing edge, every next-row node has >=1 incoming edge.
 */
function connectRows(currentRow, nextRow) {
  // Edges to/from a single node converge/diverge — can never cross
  const skipConstraints = currentRow.length === 1 || nextRow.length === 1;

  // Track all edges as [sourceCol, targetCol] pairs for crossing detection
  const edgePairs = [];

  function wouldCross(sourceCol, targetCol) {
    if (skipConstraints) return false;
    for (const [sCol, tCol] of edgePairs) {
      if ((sCol < sourceCol && tCol > targetCol) ||
          (sCol > sourceCol && tCol < targetCol)) {
        return true;
      }
    }
    return false;
  }

  function isValidTarget(sourceCol, targetCol) {
    if (skipConstraints) return true;
    return Math.abs(sourceCol - targetCol) <= 1;
  }

  function addEdge(sourceNode, targetNode) {
    if (!sourceNode.edges.includes(targetNode.id)) {
      sourceNode.edges.push(targetNode.id);
      edgePairs.push([sourceNode.col, targetNode.col]);
    }
  }

  // Step 1: Each current-row node connects to at least 1 valid non-crossing next-row node
  for (const node of currentRow) {
    const candidates = nextRow.filter(n =>
      isValidTarget(node.col, n.col) && !wouldCross(node.col, n.col)
    );
    if (candidates.length > 0) {
      // Prefer same column, then closest
      candidates.sort((a, b) => Math.abs(a.col - node.col) - Math.abs(b.col - node.col));
      addEdge(node, candidates[0]);
    }
  }

  // Step 2: Ensure every next-row node has at least 1 incoming edge (non-crossing)
  for (const nextNode of nextRow) {
    const hasIncoming = currentRow.some(n => n.edges.includes(nextNode.id));
    if (!hasIncoming) {
      const candidates = currentRow.filter(n =>
        isValidTarget(n.col, nextNode.col) && !wouldCross(n.col, nextNode.col)
      );
      if (candidates.length > 0) {
        candidates.sort((a, b) => Math.abs(a.col - nextNode.col) - Math.abs(b.col - nextNode.col));
        addEdge(candidates[0], nextNode);
      }
    }
  }

  // Step 3: Add extra edges for branching (up to 2 per node, non-crossing)
  for (const node of currentRow) {
    if (node.edges.length < 2 && Math.random() < 0.5) {
      const candidates = nextRow.filter(n =>
        isValidTarget(node.col, n.col) &&
        !node.edges.includes(n.id) &&
        !wouldCross(node.col, n.col)
      );
      if (candidates.length > 0) {
        const pick = candidates[Math.floor(Math.random() * candidates.length)];
        addEdge(node, pick);
      }
    }
  }
}

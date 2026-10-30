// SurvivorsField.js — the field of Darkest Before Dawn (the survivors mode; docs/specs/
// survivors-mode.md): a seeded grid of terrain names, read for movement by move type, and the
// flow fields that walk the foes around ponds and peaks toward the lord. Pure: no Phaser, no
// Math.random. Terrain costs come from data/terrain.json, so a forest slows and a pond blocks
// exactly the move types it does on the battle map.

export const CELL = 32;

/** The move cost of a terrain for a move type: a number, or null where it cannot go. */
export function moveCostOf(terrainRow, moveType) {
  const raw = terrainRow?.moveCost?.[moveType];
  const cost = Number(raw);
  return Number.isFinite(cost) && cost > 0 ? cost : null;
}

/**
 * Paint the field: plain ground with seeded blobs of the config's terrains, a clear ring in
 * the middle where the lord starts. Blobs grow by a random walk over neighbours, so a pond or
 * a stand of trees is one connected shape. Returns `names[row][col]`.
 */
export function generateFieldNames(fieldConfig, rng) {
  const cols = fieldConfig.cols;
  const rows = fieldConfig.rows;
  const names = Array.from({ length: rows }, () => Array(cols).fill('Plain'));
  const cx = (cols - 1) / 2;
  const cy = (rows - 1) / 2;
  const clear = fieldConfig.clearRadius ?? 6;
  const inClear = (c, r) => (c - cx) ** 2 + (r - cy) ** 2 <= clear * clear;
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  for (const blob of fieldConfig.blobs || []) {
    for (let i = 0; i < blob.count; i++) {
      const size = blob.minCells + Math.floor(rng() * (blob.maxCells - blob.minCells + 1));
      let c = 1 + Math.floor(rng() * (cols - 2));
      let r = 1 + Math.floor(rng() * (rows - 2));
      const cells = [[c, r]];
      for (let n = 0; n < size * 3 && cells.length < size; n++) {
        const [bc, br] = cells[Math.floor(rng() * cells.length)];
        const [dc, dr] = dirs[Math.floor(rng() * 4)];
        c = bc + dc;
        r = br + dr;
        if (c < 1 || r < 1 || c >= cols - 1 || r >= rows - 1) continue;
        if (!cells.some(([x, y]) => x === c && y === r)) cells.push([c, r]);
      }
      for (const [x, y] of cells) if (!inClear(x, y)) names[y][x] = blob.terrain;
    }
  }
  return names;
}

/**
 * The field as the rules read it. `costs[moveType]` is a Float32Array of move costs (0 where
 * the move type cannot stand), indexed `row * cols + col`.
 */
export function createField(fieldConfig, terrainData, rng) {
  const names = generateFieldNames(fieldConfig, rng);
  const cols = fieldConfig.cols;
  const rows = fieldConfig.rows;
  const byName = new Map((terrainData || []).map((t) => [t.name, t]));
  const costs = {};
  for (const moveType of ['Infantry', 'Armored', 'Cavalry', 'Flying']) {
    const grid = new Float32Array(cols * rows);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++)
        grid[r * cols + c] = moveCostOf(byName.get(names[r][c]), moveType) || 0;
    costs[moveType] = grid;
  }
  const avoid = new Float32Array(cols * rows);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      avoid[r * cols + c] = Number(byName.get(names[r][c])?.avoidBonus) || 0;
  return {
    cols,
    rows,
    width: cols * CELL,
    height: rows * CELL,
    names,
    costs,
    avoid,
    biome: fieldConfig.biome || 'grassland',
    flow: {},
  };
}

export function cellOf(field, x, y) {
  const c = Math.floor(x / CELL);
  const r = Math.floor(y / CELL);
  if (c < 0 || r < 0 || c >= field.cols || r >= field.rows) return -1;
  return r * field.cols + c;
}

/** The move cost under a point for a move type (0: cannot stand there, or off the field). */
export function costAt(field, moveType, x, y) {
  const i = cellOf(field, x, y);
  if (i < 0) return 0;
  return (field.costs[moveType] || field.costs.Infantry)[i];
}

/** Terrain avoid (percent) under a point: a forest's 20 is a 20% chance a blow misses. */
export function avoidAt(field, x, y) {
  const i = cellOf(field, x, y);
  return i < 0 ? 0 : field.avoid[i];
}

/** Speed multiplier for a move cost: 1 on plain, slower per extra point of cost. */
export function slowFactor(cost, slowPerCost) {
  if (!(cost > 0)) return 0;
  return 1 / (1 + (cost - 1) * slowPerCost);
}

/**
 * Breadth-first distances (in cells) from a cell over the cells a move type can stand on;
 * -1 where it cannot reach. Diagonal steps are allowed when both of their sides are open, so
 * a foe never cuts a corner through a pond.
 */
export function buildFlowField(field, moveType, targetIndex) {
  const n = field.cols * field.rows;
  const dist = new Int32Array(n).fill(-1);
  const cost = field.costs[moveType] || field.costs.Infantry;
  if (targetIndex < 0 || targetIndex >= n) return dist;
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  dist[targetIndex] = 0;
  queue[tail++] = targetIndex;
  const cols = field.cols;
  while (head < tail) {
    const i = queue[head++];
    const c = i % cols;
    const r = (i - c) / cols;
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        if (!dc && !dr) continue;
        const nc = c + dc;
        const nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= cols || nr >= field.rows) continue;
        const j = nr * cols + nc;
        if (dist[j] >= 0 || !(cost[j] > 0)) continue;
        if (dc && dr && !(cost[r * cols + nc] > 0 && cost[nr * cols + c] > 0)) continue;
        dist[j] = dist[i] + 1;
        queue[tail++] = j;
      }
    }
  }
  return dist;
}

/**
 * The cell centre a foe at (x, y) should walk toward on a flow field, or null when it should
 * walk straight at its target (it stands next to the target's cell, or the field cannot help).
 */
export function flowStep(field, dist, x, y) {
  const i = cellOf(field, x, y);
  if (i < 0 || dist[i] < 0 || dist[i] <= 1) return null;
  const cols = field.cols;
  const c = i % cols;
  const r = (i - c) / cols;
  let best = -1;
  let bestDist = dist[i];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (!dc && !dr) continue;
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= field.rows) continue;
      const j = nr * cols + nc;
      if (dist[j] < 0 || dist[j] >= bestDist) continue;
      if (dc && dr && (dist[r * cols + nc] < 0 || dist[nr * cols + c] < 0)) continue;
      best = j;
      bestDist = dist[j];
    }
  }
  if (best < 0) return null;
  const bc = best % cols;
  return { x: (bc + 0.5) * CELL, y: ((best - bc) / cols + 0.5) * CELL };
}

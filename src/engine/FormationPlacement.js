// Formation: before turn 1 the player chooses which deployed unit stands on which
// spawn tile. Pure rules (no Phaser): which battles use it, how many spare tiles a
// battle offers, where those spares go, which tiles a unit may stand on, and the
// assignment operations the placement screen performs.
//
// Map generation is untouched: the generator still makes one spawn per deployed
// unit, and the spares are picked afterwards from the same spawn zone on their own
// seeded stream, so maps, sims and locked encounters are identical with or without
// formation.

/** Formation opens once a battle fields this many units (two lords + a first recruit). */
export const FORMATION_MIN_UNITS = 3;

// Terrain a spare tile never uses: it hurts on turn 1 or belongs to another rule.
const SPARE_EXCLUDED_TERRAIN = new Set([
  'Lava Crack',
  'Acidic Swamp',
  'Acidic Bog',
  'Throne',
  'Ballista',
  'Village',
  'Wall',
]);
// A spare never starts within this many steps of an enemy.
const SPARE_ENEMY_BUFFER = 2;
// A tile is "boxed in" for a move type when it reaches less than this share of what
// the best formation tile reaches for that move type.
const BOXED_IN_SHARE = 0.5;

export const tileKey = (t) => `${t.col},${t.row}`;

/** Whether this battle opens the placement step. */
export function formationActive({
  deployCount = 0,
  tutorialMode = false,
  resuming = false,
  disabled = false,
} = {}) {
  return !tutorialMode && !resuming && !disabled && deployCount >= FORMATION_MIN_UNITS;
}

/** Extra tiles beyond one per unit: at least 2, and more as the army grows. */
export function formationCushion(deployCount) {
  const n = Math.max(0, Math.trunc(Number(deployCount) || 0));
  return Math.max(2, Math.ceil(n / 2));
}

/** The player-spawn rectangle, rounded the way MapGenerator.placeSpawns rounds it. */
export function playerSpawnBounds(template, cols, rows) {
  const zone = template?.zones?.find((z) => z.role === 'playerSpawn');
  if (!zone?.rect) return { startCol: 0, endCol: Math.min(3, cols), startRow: 0, endRow: rows };
  const [x1, y1, x2, y2] = zone.rect;
  return {
    startCol: Math.floor(x1 * cols),
    endCol: Math.min(Math.ceil(x2 * cols), cols),
    startRow: Math.floor(y1 * rows),
    endRow: Math.min(Math.ceil(y2 * rows), rows),
  };
}

function terrainAt(ctx, col, row) {
  const idx = ctx.mapLayout?.[row]?.[col];
  return idx == null ? null : ctx.terrainData?.[idx] || null;
}

/** Whether a move type can enter the tile at all (moveCost is a number, not '--'). */
export function canEnter(ctx, col, row, moveType = 'Infantry') {
  const terrain = terrainAt(ctx, col, row);
  const cost = Number(terrain?.moveCost?.[moveType]);
  return Number.isFinite(cost) && cost > 0;
}

/** Tiles a move type can walk to from `start`, ignoring units (terrain only). */
export function reachFrom(ctx, start, moveType = 'Infantry') {
  const seen = new Set();
  if (!start || !canEnter(ctx, start.col, start.row, moveType)) return seen;
  const queue = [start];
  seen.add(tileKey(start));
  while (queue.length) {
    const { col, row } = queue.shift();
    for (const [dc, dr] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || r < 0 || c >= ctx.cols || r >= ctx.rows) continue;
      const key = `${c},${r}`;
      if (seen.has(key) || !canEnter(ctx, c, r, moveType)) continue;
      seen.add(key);
      queue.push({ col: c, row: r });
    }
  }
  return seen;
}

function shuffled(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Spare spawn tiles for a formation. Candidates sit in the player-spawn zone (or,
 * if the zone is full, within two steps of an existing spawn), are walkable for
 * foot units, are reachable on foot from the first spawn, avoid hazards, features
 * and anything already placed, and keep clear of enemies. Spares first cover any
 * move type the army needs more standable tiles for; the rest are drawn at random.
 *
 * @param {object} o
 * @param {Array<{col,row}>} o.spawns     the generated player spawns
 * @param {Array<{col,row}>} o.blocked    every other occupied or reserved tile
 * @param {Array<{col,row}>} o.enemies    enemy positions (kept at a distance)
 * @param {string[]} o.moveTypes          the deployed units' move types
 * @param {() => number} o.rng            seeded [0,1) stream
 */
export function pickFormationSpares({
  mapLayout,
  cols,
  rows,
  terrainData,
  spawns = [],
  bounds = null,
  blocked = [],
  enemies = [],
  moveTypes = [],
  count = 0,
  rng = Math.random,
}) {
  const ctx = { mapLayout, cols, rows, terrainData };
  if (count <= 0 || !spawns.length) return [];
  const taken = new Set([...spawns, ...blocked].filter(Boolean).map(tileKey));
  const reach = reachFrom(ctx, spawns[0], 'Infantry');
  const nearEnemy = (c, r) =>
    enemies.some((e) => Math.abs(e.col - c) + Math.abs(e.row - r) <= SPARE_ENEMY_BUFFER);
  const usable = (c, r) =>
    c >= 0 &&
    r >= 0 &&
    c < cols &&
    r < rows &&
    !taken.has(`${c},${r}`) &&
    canEnter(ctx, c, r, 'Infantry') &&
    !SPARE_EXCLUDED_TERRAIN.has(terrainAt(ctx, c, r)?.name) &&
    reach.has(`${c},${r}`) &&
    !nearEnemy(c, r);

  const zone = bounds || playerSpawnBounds(null, cols, rows);
  let candidates = [];
  for (let r = zone.startRow; r < zone.endRow; r++)
    for (let c = zone.startCol; c < zone.endCol; c++)
      if (usable(c, r)) candidates.push({ col: c, row: r });
  if (candidates.length < count) {
    // A crowded zone: widen to the ring around the existing spawns.
    const seen = new Set(candidates.map(tileKey));
    for (const s of spawns)
      for (let dr = -2; dr <= 2; dr++)
        for (let dc = -2; dc <= 2; dc++) {
          const c = s.col + dc;
          const r = s.row + dr;
          if (seen.has(`${c},${r}`) || !usable(c, r)) continue;
          seen.add(`${c},${r}`);
          candidates.push({ col: c, row: r });
        }
  }
  candidates = shuffled(candidates, rng);

  const picked = [];
  // Cover move types first: each type should have at least as many standable
  // formation tiles as units of that type.
  const need = {};
  for (const mt of moveTypes) need[mt] = (need[mt] || 0) + 1;
  for (const [moveType, units] of Object.entries(need)) {
    let have = spawns.filter((s) => canEnter(ctx, s.col, s.row, moveType)).length;
    for (const tile of candidates) {
      if (have >= units || picked.length >= count) break;
      if (picked.includes(tile) || !canEnter(ctx, tile.col, tile.row, moveType)) continue;
      picked.push(tile);
      have++;
    }
  }
  for (const tile of candidates) {
    if (picked.length >= count) break;
    if (!picked.includes(tile)) picked.push(tile);
  }
  return picked.map(({ col, row }) => ({ col, row }));
}

/**
 * Per move type, how far each formation tile reaches; used to flag a tile that a
 * unit could stand on but would be boxed in (e.g. horses in a ring of mountains).
 */
export function createStandingRules(ctx, tiles) {
  const cache = new Map();
  const reachSizes = (moveType) => {
    if (!cache.has(moveType)) {
      const sizes = tiles.map((t) => reachFrom(ctx, t, moveType).size);
      cache.set(moveType, { sizes, best: Math.max(0, ...sizes) });
    }
    return cache.get(moveType);
  };
  /** '' when `moveType` may start on tile `i`, else a short reason. */
  const issue = (moveType, i) => {
    const t = tiles[i];
    if (!t) return 'Not a formation tile.';
    const terrain = terrainAt(ctx, t.col, t.row);
    if (!canEnter(ctx, t.col, t.row, moveType))
      return `${moveType} units can't stand on ${terrain?.name || 'this tile'}.`;
    const { sizes, best } = reachSizes(moveType);
    if (best > 0 && sizes[i] < best * BOXED_IN_SHARE)
      return `${moveType} units would be boxed in here.`;
    return '';
  };
  return { issue };
}

// --- Assignment ------------------------------------------------------------
// A formation is { tiles: [{col,row}], at: [tileIndex|null per unit] }.

export function createFormation(unitCount, tiles) {
  return { tiles: tiles.map(({ col, row }) => ({ col, row })), at: Array(unitCount).fill(null) };
}

export function unitOnTile(formation, tileIndex) {
  return formation.at.indexOf(tileIndex);
}

/**
 * Put unit `u` on tile `t`. A unit already there swaps into `u`'s old tile, but
 * only if `allowed(occupant, tile)` lets it stand there; otherwise (or if `u` was
 * not yet placed) it leaves the field and waits to be placed again.
 */
export function placeUnit(formation, u, t, allowed = () => true) {
  const at = [...formation.at];
  const occupant = at.indexOf(t);
  if (occupant !== -1 && occupant !== u) {
    const vacated = at[u];
    at[occupant] = vacated !== null && allowed(occupant, vacated) ? vacated : null;
  }
  at[u] = t;
  return { ...formation, at };
}

export function clearTile(formation, t) {
  const at = formation.at.map((tile) => (tile === t ? null : tile));
  return { ...formation, at };
}

export function clearAll(formation) {
  return { ...formation, at: formation.at.map(() => null) };
}

export function placedCount(formation) {
  return formation.at.filter((t) => t !== null).length;
}

export function isComplete(formation) {
  return formation.at.every((t) => t !== null);
}

/**
 * Fill every unplaced unit, keeping the player's placements: a unit already on a
 * tile never moves and its tile is never offered. `allowed(u, t)` says whether
 * unit u may stand on tile t.
 *
 * `seeds[u]` is a tile unplaced unit u would like (Auto-place passes its default
 * tile). A seed is a preference, never a lock: the fill places as many units as
 * any assignment could, and among those assignments keeps the most units on their
 * seed tiles, so a seed gives way only when a fuller formation needs its tile.
 * Remaining ties favour fewer units moved along a path, then earlier tiles in
 * `tileOrder` and earlier units in `unitOrder`.
 *
 * Bipartite matching by augmenting paths (Kuhn), started from the seeds and
 * always taking the cheapest path, where moving a unit off its seed costs 1 and
 * onto it gains 1 (successive shortest paths). Each path places one more unit;
 * the fill stops when no path is left, which by Berge's theorem means no
 * assignment places more. Starting from the seeds is the cheapest start for its
 * size, and cheapest paths keep it cheapest, so the result also keeps the most seeds.
 */
export function autoFill(
  formation,
  allowed,
  { unitOrder = null, tileOrder = null, seeds = null } = {},
) {
  const at = [...formation.at];
  const tileCount = formation.tiles.length;
  const fixed = new Set(at.filter((t) => t !== null));
  const tiles = (tileOrder || [...Array(tileCount).keys()]).filter((t) => !fixed.has(t));
  const tileRank = new Map(tiles.map((t, i) => [t, i]));
  const units = (unitOrder || [...at.keys()]).filter((u) => at[u] === null);
  const options = new Map(units.map((u) => [u, tiles.filter((t) => allowed(u, t))]));
  const seedOf = (u) => {
    const t = seeds?.[u];
    return Number.isInteger(t) && tileRank.has(t) ? t : null;
  };
  // Cost of putting u on t: a unit landing on its seed tile gains 1.
  const cost = (u, t) => (seedOf(u) === t ? -1 : 0);
  const owner = new Map(); // tile -> unit placed by this fill
  const tileOf = new Map(); // unit -> tile
  const put = (u, t) => {
    owner.set(t, u);
    tileOf.set(u, t);
  };
  // Start with every unit on its seed where it may stand (first come for a shared seed).
  for (const u of units) {
    const t = seedOf(u);
    if (t !== null && !owner.has(t) && options.get(u).includes(t)) put(u, t);
  }

  // Lexicographic path labels: cheapest first, then fewest units moved.
  const better = (a, b) => !b || a.cost < b.cost || (a.cost === b.cost && a.hops < b.hops);
  for (;;) {
    // Bellman-Ford from every unplaced unit over alternating paths: a unit steps
    // onto a tile it may use; an occupied tile hands its unit on to find another.
    // No path ever has a negative cycle (see above), so labels settle.
    const reached = new Map(); // tile -> { cost, hops, unit }
    const unitLabel = new Map();
    let frontier = new Set();
    for (const u of units) {
      if (tileOf.has(u)) continue;
      unitLabel.set(u, { cost: 0, hops: 0 });
      frontier.add(u);
    }
    for (let pass = 0; frontier.size && pass <= units.length + tiles.length; pass++) {
      const next = new Set();
      for (const u of units) {
        if (!frontier.has(u)) continue;
        const from = unitLabel.get(u);
        for (const t of options.get(u)) {
          if (tileOf.get(u) === t) continue;
          const label = { cost: from.cost + cost(u, t), hops: from.hops + 1, unit: u };
          if (!better(label, reached.get(t))) continue;
          reached.set(t, label);
          const v = owner.get(t);
          if (v === undefined) continue;
          const moved = { cost: label.cost - cost(v, t), hops: label.hops };
          if (better(moved, unitLabel.get(v))) {
            unitLabel.set(v, moved);
            next.add(v);
          }
        }
      }
      frontier = next;
    }
    let target = null;
    for (const t of tiles) {
      const label = reached.get(t);
      if (!label || owner.has(t)) continue;
      const best = target === null ? null : reached.get(target);
      if (!best || label.cost < best.cost || (label.cost === best.cost && label.hops < best.hops))
        target = t;
    }
    if (target === null) break;
    // Walk the path back: each unit moves onto the tile it reached, freeing its old one.
    for (let t = target; t !== undefined; ) {
      const u = reached.get(t).unit;
      const previous = tileOf.get(u);
      put(u, t);
      t = previous;
    }
  }
  for (const [u, t] of tileOf) at[u] = t;
  return { ...formation, at };
}

/** A seeded [0,1) stream for one battle's spare tiles (FNV-1a hash → mulberry32). */
export function formationRng(seedText) {
  let h = 2166136261 >>> 0;
  for (const ch of String(seedText)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  let s = h;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

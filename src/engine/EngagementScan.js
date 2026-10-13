// EngagementScan.js — how a freshly generated map opens (docs/specs/map-variety.md, "Formations
// and the opening"). Pure, no Phaser, no RNG.
//
// The questions a map's first two phases answer, asked of the spawns alone:
//   - which foes the army can strike on its first player phase (`exposed`), and from where;
//   - how many other foes can answer a unit that struck one, on the first enemy phase, from the
//     tile that suits the striker best (`support`). A foe the army can strike and nobody can
//     answer is a free pick: the snipe-without-punishment the formations are there to remove;
//   - how soon each foe reaches the army (`contactTurn`), so a map's fights can be timed;
//   - whether a start tile is boxed in: nowhere it can walk is out of every foe's first reach.
//
// A model, not the battle: units block only where noted, weapons are read from the class's
// proficiencies (bows 2, tomes and light 1-2, the rest 1; a staff-only class never strikes),
// and the army's reach is a stand-in for an act's roster (PLAYER_REACH_BY_ACT), so the measure is
// the same for every seed. The AI rules it follows are AIController's and HoldActivation's: a
// charging foe strikes anything it can reach; a holder wakes when a unit stands in its Danger
// zone (the tiles it can strike) or a packmate is hurt, and acts that phase; a guard only stirs
// for a unit within GUARD_TRIGGER of its post; a seize boss moves at most one tile off its throne.

const STEPS = [
  [0, -1],
  [0, 1],
  [-1, 0],
  [1, 0],
];

/** A tile's index on a map `cols` wide: the keys every set and map here uses. */
export const tileIndex = (col, row, cols) => row * cols + col;
export const manhattan = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

/** AIController's guard: it acts only while a unit stands within this many tiles of its post. */
export const GUARD_TRIGGER = 3;

/**
 * The army's first-phase reach by act, a stand-in for the roster a run fields then: its foot
 * (bows and tomes strike from 2), its riders and its fliers. Base classes move 4 (riders 5);
 * promoted ones 5 (riders 6), from Act III on.
 */
export const PLAYER_REACH_BY_ACT = Object.freeze({
  act1: [
    { moveType: 'Infantry', mov: 4, range: [1, 2] },
    { moveType: 'Cavalry', mov: 5, range: [1, 1] },
  ],
  act2: [
    { moveType: 'Infantry', mov: 4, range: [1, 2] },
    { moveType: 'Cavalry', mov: 5, range: [1, 1] },
    { moveType: 'Flying', mov: 4, range: [1, 1] },
  ],
  act3: [
    { moveType: 'Infantry', mov: 5, range: [1, 2] },
    { moveType: 'Cavalry', mov: 6, range: [1, 1] },
    { moveType: 'Flying', mov: 5, range: [1, 1] },
  ],
  act4: [
    { moveType: 'Infantry', mov: 5, range: [1, 2] },
    { moveType: 'Cavalry', mov: 6, range: [1, 1] },
    { moveType: 'Flying', mov: 5, range: [1, 1] },
  ],
});

export function playerReachFor(act) {
  return PLAYER_REACH_BY_ACT[act] || PLAYER_REACH_BY_ACT.act4;
}

/** A tile's move cost for a move type (terrain.json `moveCost`), Infinity where it cannot go. */
export function terrainMoveCost(terrainData, terrainIndex, moveType) {
  const raw = terrainData?.[terrainIndex]?.moveCost?.[moveType];
  const cost = Number.parseInt(raw, 10);
  return Number.isFinite(cost) && cost > 0 ? cost : Infinity;
}

/**
 * The cheapest cost to reach each tile from any source (Dijkstra over a bucket queue: costs are
 * small whole numbers), up to `maxCost` (Infinity for the whole map). `blocked` (a Set of tile
 * indices) is never entered; a source on one still starts there.
 * @returns {Map<number, number>} tile index -> cost
 */
export function reachCosts({
  mapLayout,
  terrainData,
  sources,
  moveType,
  maxCost = Infinity,
  blocked,
}) {
  const rows = mapLayout.length;
  const cols = mapLayout[0]?.length || 0;
  const best = new Map();
  const buckets = [];
  const push = (idx, cost) => (buckets[cost] ||= []).push(idx);
  for (const s of sources || []) {
    if (!(s.col >= 0 && s.col < cols && s.row >= 0 && s.row < rows)) continue;
    const idx = tileIndex(s.col, s.row, cols);
    if (best.has(idx)) continue;
    best.set(idx, 0);
    push(idx, 0);
  }
  const costs = new Map();
  const stepCost = (t) => {
    if (!costs.has(t)) costs.set(t, terrainMoveCost(terrainData, t, moveType));
    return costs.get(t);
  };
  for (let c = 0; c < buckets.length; c++) {
    const bucket = buckets[c];
    if (!bucket) continue;
    for (let n = 0; n < bucket.length; n++) {
      const idx = bucket[n];
      if (c > best.get(idx)) continue;
      const col = idx % cols;
      const row = (idx - col) / cols;
      for (const [dc, dr] of STEPS) {
        const nc = col + dc;
        const nr = row + dr;
        if (nc < 0 || nc >= cols || nr < 0 || nr >= rows) continue;
        const next = tileIndex(nc, nr, cols);
        if (blocked?.has(next)) continue;
        const cost = c + stepCost(mapLayout[nr][nc]);
        if (cost > maxCost || cost >= (best.get(next) ?? Infinity)) continue;
        best.set(next, cost);
        push(next, cost);
      }
    }
  }
  return best;
}

/** Every tile index within [min, max] tiles (Manhattan) of any tile index in `from`. */
export function tilesInRange(from, [min, max], cols, rows) {
  const out = new Set();
  for (const idx of from) {
    const c = idx % cols;
    const r = (idx - c) / cols;
    for (let dr = -max; dr <= max; dr++) {
      const row = r + dr;
      if (row < 0 || row >= rows) continue;
      const span = max - Math.abs(dr);
      for (let dc = -span; dc <= span; dc++) {
        if (Math.abs(dc) + Math.abs(dr) < min) continue;
        const col = c + dc;
        if (col >= 0 && col < cols) out.add(tileIndex(col, row, cols));
      }
    }
  }
  return out;
}

const STRIKE_RANGE_BY_PROF = Object.freeze({
  Bows: [2, 2],
  Tomes: [1, 2],
  Light: [1, 2],
  Breath: [1, 1],
  Swords: [1, 1],
  Lances: [1, 1],
  Axes: [1, 1],
});

const profileMemo = new WeakMap();

/** A class's move type, MOV (a promoted class: its base class's plus the promotion's) and reach. */
export function classStrikeProfile(className, classes) {
  if (classes && typeof classes === 'object') {
    if (!profileMemo.has(classes)) profileMemo.set(classes, new Map());
    const memo = profileMemo.get(classes);
    if (!memo.has(className)) memo.set(className, readStrikeProfile(className, classes));
    return memo.get(className);
  }
  return readStrikeProfile(className, classes);
}

function readStrikeProfile(className, classes) {
  const cd = (classes || []).find((c) => c.name === className);
  if (!cd) return { moveType: 'Infantry', mov: 4, range: [1, 1] };
  let mov = Number(cd.baseStats?.MOV);
  if (!Number.isFinite(mov) && cd.promotesFrom) {
    const base = classes.find((c) => c.name === cd.promotesFrom);
    mov = Number(base?.baseStats?.MOV || 4) + Number(cd.promotionBonuses?.MOV || 0);
  }
  if (!Number.isFinite(mov)) mov = 4;
  let range = null;
  for (const part of String(cd.weaponProficiencies || '').split(',')) {
    const r = STRIKE_RANGE_BY_PROF[part.trim().split(' ')[0]];
    if (!r) continue;
    range = range ? [Math.min(range[0], r[0]), Math.max(range[1], r[1])] : [...r];
  }
  return { moveType: cd.moveType || 'Infantry', mov, range };
}

/** Whether a class strikes from behind a line (bows, tomes, light) or heals (a staff only). */
export function isBackLineClass(className, classes) {
  const { range } = classStrikeProfile(className, classes);
  return !range || range[1] >= 2;
}

/**
 * The tiles a foe can strike on the first enemy phase if it acts (its Danger zone, units not
 * counted) as tile indices, and its profile. A boss on a seize map keeps within one tile of its
 * throne; a post holder does not move. A foe that cannot strike (a healer) has an empty zone.
 */
export function enemyFirstReach(spawn, { mapLayout, terrainData, classes, thronePos, objective }) {
  const rows = mapLayout.length;
  const cols = mapLayout[0]?.length || 0;
  const profile = classStrikeProfile(spawn.className, classes);
  if (!profile.range || spawn.aiMode === 'heal') return { strike: new Set(), profile };
  let stand;
  if (spawn.aiMode === 'post') {
    stand = [tileIndex(spawn.col, spawn.row, cols)];
  } else {
    const move = reachCosts({
      mapLayout,
      terrainData,
      sources: [spawn],
      moveType: profile.moveType,
      maxCost: profile.mov,
    });
    stand = [...move.keys()];
    if (spawn.isBoss && objective === 'seize' && thronePos) {
      stand = stand.filter((idx) => {
        const c = idx % cols;
        return manhattan({ col: c, row: (idx - c) / cols }, thronePos) <= 1;
      });
    }
  }
  return { strike: tilesInRange(stand, profile.range, cols, rows), profile };
}

/**
 * Whether foe `s` (its first reach, enemyFirstReach) answers, on the first enemy phase, a unit
 * standing at `tile` (`at` its index): the tile is in its reach, and a guard is near enough its
 * post to stir. A holder wakes for a unit in its Danger zone, and so for one that hurt a packmate
 * from there too.
 */
export function answers(s, reach, tile, at) {
  if (!reach.strike.has(at)) return false;
  if (s.aiMode === 'guard') return manhattan(s, tile) <= GUARD_TRIGGER;
  return true;
}

/**
 * The reaches of one map's foes, worked out only when asked and kept in `cache` (a Map) by tile,
 * class and orders, so scans of one map share the work. `answers(spawn, tile, at)` is the free
 * function's, but skips the reach of a foe too far away to matter (no step costs under 1).
 */
export function reachBook(ctx, cache = new Map()) {
  const profiles = new Map();
  const profileOf = (className) => {
    if (!profiles.has(className))
      profiles.set(className, classStrikeProfile(className, ctx.classes));
    return profiles.get(className);
  };
  const reach = (s) => {
    const k = `${s.col},${s.row},${s.className},${s.aiMode || ''},${s.isBoss ? 1 : 0}`;
    if (!cache.has(k)) cache.set(k, enemyFirstReach(s, ctx));
    return cache.get(k);
  };
  return {
    reach,
    answers(s, tile, at) {
      const p = profileOf(s.className);
      if (!p.range || s.aiMode === 'heal') return false;
      const d = manhattan(s, tile);
      if (d > p.mov + p.range[1]) return false;
      if (s.aiMode === 'guard' && d > GUARD_TRIGGER) return false;
      return answers(s, reach(s), tile, at);
    },
  };
}

/**
 * Read a map's opening. `spawns` are the enemy spawns (col, row, className, aiMode, isBoss),
 * `playerSpawns` the army's start tiles. `timing: false` skips the contact turns and the boxed
 * starts (null), which cost the most; `cache` is reachBook's.
 * @returns {{ foes: { index, exposed, support, contactTurn }[], boxedStarts: number|null }}
 *   `support` is the fewest foes that can answer a striker, over every tile it can strike that
 *   foe from on its first phase (null when the foe cannot be struck then).
 */
export function scanOpening({
  mapLayout,
  terrainData,
  classes,
  spawns,
  playerSpawns,
  act,
  thronePos = null,
  objective = 'rout',
  timing = true,
  cache,
}) {
  const rows = mapLayout.length;
  const cols = mapLayout[0]?.length || 0;
  const ctx = { mapLayout, terrainData, classes, thronePos, objective };
  const enemyTiles = new Set(spawns.map((s) => tileIndex(s.col, s.row, cols)));
  const book = reachBook(ctx, cache);
  const strikerTiles = playerStrikerTiles({
    mapLayout,
    terrainData,
    playerSpawns,
    act,
    enemyTiles,
  });
  const foes = spawns.map((s, index) => {
    const from = attackTilesAgainst(s, strikerTiles, cols, rows);
    const exposed = from.length > 0;
    let support = null;
    if (exposed) {
      support = Infinity;
      for (const tile of from) {
        const at = tileIndex(tile.col, tile.row, cols);
        let n = 0;
        for (let j = 0; j < spawns.length; j++)
          if (j !== index && book.answers(spawns[j], tile, at)) n++;
        if (n < support) support = n;
      }
    }
    return {
      index,
      exposed,
      support,
      contactTurn: timing ? contactTurn(s, book.reach(s), ctx, playerSpawns) : null,
    };
  });
  return {
    foes,
    boxedStarts: timing
      ? countBoxedStarts({ ...ctx, playerSpawns, act, reaches: spawns.map(book.reach), spawns })
      : null,
  };
}

/**
 * The tiles the army can strike from on its first phase: each tile a unit of the act's roster
 * can stand on (foes, `enemyTiles` indices, block), with the ranges it strikes from there.
 * @returns {Map<number, [number, number]>} tile index -> the widest range any unit strikes from it
 */
export function playerStrikerTiles({ mapLayout, terrainData, playerSpawns, act, enemyTiles }) {
  const out = new Map();
  for (const p of playerReachFor(act)) {
    const reach = reachCosts({
      mapLayout,
      terrainData,
      sources: playerSpawns,
      moveType: p.moveType,
      maxCost: p.mov,
      blocked: enemyTiles,
    });
    for (const idx of reach.keys()) {
      const was = out.get(idx);
      out.set(idx, was ? [Math.min(was[0], p.range[0]), Math.max(was[1], p.range[1])] : p.range);
    }
  }
  return out;
}

/** The tiles a striker could hit `foe` (or a foe standing at that tile) from (playerStrikerTiles). */
export function attackTilesAgainst(foe, strikerTiles, cols, rows) {
  const out = [];
  for (let dr = -2; dr <= 2; dr++) {
    for (let dc = -2; dc <= 2; dc++) {
      const d = Math.abs(dc) + Math.abs(dr);
      if (d < 1 || d > 2) continue;
      const col = foe.col + dc;
      const row = foe.row + dr;
      if (col < 0 || col >= cols || row < 0 || row >= rows) continue;
      const range = strikerTiles.get(tileIndex(col, row, cols));
      if (range && d >= range[0] && d <= range[1]) out.push({ col, row });
    }
  }
  return out;
}

/** The first turn a foe could strike a start tile, walking at its MOV (Infinity if never). */
function contactTurn(s, reach, ctx, playerSpawns) {
  const { profile } = reach;
  if (!profile.range) return Infinity;
  const cols = ctx.mapLayout[0]?.length || 0;
  const costs = reachCosts({
    mapLayout: ctx.mapLayout,
    terrainData: ctx.terrainData,
    sources: [s],
    moveType: profile.moveType,
  });
  let best = Infinity;
  for (const [idx, cost] of costs) {
    if (cost >= best) continue;
    const c = idx % cols;
    const tile = { col: c, row: (idx - c) / cols };
    if (
      playerSpawns.some((p) => {
        const d = manhattan(tile, p);
        return d >= profile.range[0] && d <= profile.range[1];
      })
    )
      best = cost;
  }
  if (!Number.isFinite(best)) return Infinity;
  return Math.max(1, Math.ceil(best / Math.max(1, profile.mov)));
}

/** Start tiles from which the army's foot cannot walk anywhere out of every charging foe's reach. */
function countBoxedStarts({ mapLayout, terrainData, playerSpawns, act, reaches, spawns }) {
  const cols = mapLayout[0]?.length || 0;
  const foot = playerReachFor(act)[0];
  const danger = new Set();
  spawns.forEach((s, i) => {
    if (s.aiMode === 'guard' || s.aiMode === 'hold') return; // stirs only when approached
    for (const idx of reaches[i].strike) danger.add(idx);
  });
  const enemyTiles = new Set(spawns.map((s) => tileIndex(s.col, s.row, cols)));
  let boxed = 0;
  for (const p of playerSpawns) {
    const reach = reachCosts({
      mapLayout,
      terrainData,
      sources: [p],
      moveType: foot.moveType,
      maxCost: foot.mov,
      blocked: enemyTiles,
    });
    if ([...reach.keys()].every((idx) => danger.has(idx))) boxed++;
  }
  return boxed;
}

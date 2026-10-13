// EnemyFormations.js — a template group's foes placed as one formation (docs/specs/map-variety.md,
// "Formations and the opening"). Pure, no Phaser; every draw is the `random` passed in.
//
// A group that names a `formation` stands together, its front toward the army, instead of each
// foe taking its own tile anywhere in the zone. Three shapes, recognisable from across the map
// but never the same twice (each anchor and each tile is a pick among the best few):
//   - `strongpoint`: a knot around the best cover in the zone (a fort, a wood), the strongest foe
//     (a captain) at its heart, the line-fighters on the side facing the army and the bows,
//     tomes and staves behind them; a zone that holds the throne rings the throne instead;
//   - `screen`: a line across the army's way at the front of the zone, two tiles between
//     neighbours so each covers the next, the back line one step behind the gaps;
//   - `pincer`: two knots at the far ends of the zone, the group dealt between them, so whoever
//     walks between them is struck from both sides (a group under four is one strongpoint).
// Every foe stands within FORMATION_REACH of a groupmate placed before it while the zone has
// room, so none is left out alone; one the formation cannot fit takes the free tile of the zone
// nearest its anchor.

import {
  attackTilesAgainst,
  playerStrikerTiles,
  reachBook,
  scanOpening,
  tileIndex,
} from './EngagementScan.js';

export const FORMATIONS = Object.freeze(['strongpoint', 'screen', 'pincer']);
/** A foe the army can strike on its first phase is answered by at least this many others. */
export const MIN_OPENING_SUPPORT = 2;
/** A formation member stands within this many tiles (Manhattan) of one placed before it. */
export const FORMATION_REACH = 2;
/** Each pick is among this many best tiles, weighted 3:2:1 by rank, those within PICK_MARGIN of
 * the best. */
const PICK_AMONG = 3;
const PICK_MARGIN = 2;
const RANK_WEIGHTS = [3, 2, 1];
const SCREEN_SPACING = 2;
const PINCER_MIN = 4;

const key = (t) => `${t.col},${t.row}`;
/** Whether list `a` sorts before list `b`, element by element. */
const lexLess = (a, b) => {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k];
  return false;
};
const manhattan = (a, b) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);

/**
 * One pick among the best `PICK_AMONG` of `scored` ({ tile, score }) within PICK_MARGIN of the
 * best, rank-weighted, one draw.
 * Ties fall to the earlier row, then column, so the order never depends on the input's.
 */
function pickBest(scored, random) {
  if (!scored.length) return null;
  if (scored.some((e) => !Number.isFinite(e.score)))
    throw new Error('formation score is not a number');
  const sorted = [...scored].sort(
    (a, b) => b.score - a.score || a.tile.row - b.tile.row || a.tile.col - b.tile.col,
  );
  // Only near-equals are a choice: a tile far worse than the best is never drawn.
  const top = sorted.slice(0, PICK_AMONG).filter((e) => e.score >= sorted[0].score - PICK_MARGIN);
  const weights = top.map((_, i) => RANK_WEIGHTS[i]);
  const total = weights.reduce((s, w) => s + w, 0);
  let roll = random() * total;
  for (let i = 0; i < top.length; i++) {
    roll -= weights[i];
    if (roll < 0) return top[i].tile;
  }
  return top[top.length - 1].tile;
}

/**
 * The frame a formation is laid out in: `f` how far a tile stands toward the army, `s` how far
 * across its way. `facing` is the direction from the zone toward the army.
 */
function frameOf(tiles, facing) {
  const len = Math.hypot(facing.dc, facing.dr) || 1;
  const fx = facing.dc / len;
  const fy = facing.dr / len;
  const cx = tiles.reduce((s, t) => s + t.col, 0) / Math.max(1, tiles.length);
  const cy = tiles.reduce((s, t) => s + t.row, 0) / Math.max(1, tiles.length);
  return {
    f: (t) => (t.col - cx) * fx + (t.row - cy) * fy,
    s: (t) => -(t.col - cx) * fy + (t.row - cy) * fx,
  };
}

/**
 * Place a group's members.
 * @param {object} args
 * @param {'strongpoint'|'screen'|'pincer'} args.formation
 * @param {{ back: boolean, core?: boolean }[]} args.members in slot order; `back` for bows, tomes
 *   and staves, `core` for the one foe that takes the heart (a captain)
 * @param {{col:number,row:number}[]} args.tiles the zone's free tiles
 * @param {(tile, memberIndex) => number} args.standScore how well a member likes a tile, 0 where
 *   it cannot stand (MapGenerator's terrain score)
 * @param {(tile) => number} args.cover how much shelter a tile and its neighbours give
 * @param {{dc:number, dr:number}} args.facing from the zone toward the army
 * @param {() => number} args.random
 * @param {{col:number,row:number}|null} [args.heart] what a strongpoint gathers around (a seize
 *   map's throne in its zone): its anchor is drawn from the tiles nearest it
 * @returns {({col:number,row:number}|null)[]} a tile per member (null: none could stand)
 */
export function placeFormation({
  formation,
  members,
  tiles,
  standScore,
  cover,
  facing,
  random,
  heart = null,
}) {
  const free = new Map(tiles.map((t) => [key(t), t]));
  const out = members.map(() => null);
  const frame = frameOf(tiles, facing);
  const take = (i, tile) => {
    out[i] = tile;
    free.delete(key(tile));
  };
  const order = memberOrder(members);
  if (formation === 'pincer' && members.length >= PINCER_MIN) {
    const wings = [[], []];
    // Deal front and back between the wings in turn, so each wing has both; the core leads wing 0.
    order.forEach((i, n) => wings[n % 2].push(i));
    const sides = [(t) => frame.s(t) <= 0, (t) => frame.s(t) > 0];
    wings.forEach((wing, w) => {
      knot({
        ids: wing,
        allow: sides[w],
        anchorBias: (t) => Math.abs(frame.s(t)) * 1.5,
        members,
        free,
        standScore,
        cover,
        frame,
        random,
        take,
      });
    });
  } else if (formation === 'screen') {
    line({ ids: order, members, free, standScore, frame, random, take });
  } else {
    knot({
      ids: order,
      allow: () => true,
      // Around a heart (a throne) the knot rings it: the anchor beside it, no side favoured.
      anchorBias: heart ? (t) => -10 * manhattan(t, heart) : () => 0,
      lean: heart ? 0 : 1,
      members,
      free,
      standScore,
      cover,
      frame,
      random,
      take,
    });
  }
  // Anyone the shape could not fit: the free tile nearest the group, no draw.
  const placed = out.filter(Boolean);
  members.forEach((_, i) => {
    if (out[i]) return;
    const near = placed.length ? placed : tiles;
    let best = null;
    let bestD = Infinity;
    for (const t of free.values()) {
      if (!(standScore(t, i) > 0)) continue;
      const d = Math.min(...near.map((p) => manhattan(p, t)));
      if (
        d < bestD ||
        (d === bestD && (t.row < best.row || (t.row === best.row && t.col < best.col)))
      ) {
        best = t;
        bestD = d;
      }
    }
    if (best) {
      take(i, best);
      placed.push(best);
    }
  });
  return out;
}

/** The order members are placed in: the core first, then the front line, then the back. */
function memberOrder(members) {
  const idx = members.map((_, i) => i);
  const core = idx.filter((i) => members[i].core);
  const front = idx.filter((i) => !members[i].core && !members[i].back);
  const back = idx.filter((i) => !members[i].core && members[i].back);
  return [...core, ...front, ...back];
}

/** A strongpoint (or a pincer's wing): an anchor on cover, the rest close around it. */
function knot({
  ids,
  allow,
  anchorBias,
  lean: leanSign = 1,
  members,
  free,
  standScore,
  cover,
  frame,
  random,
  take,
}) {
  if (!ids.length) return;
  const lead = ids[0];
  const anchor = pickBest(
    [...free.values()]
      .filter((t) => allow(t) && standScore(t, lead) > 0)
      .map((t) => ({ tile: t, score: cover(t) + standScore(t, lead) + anchorBias(t) })),
    random,
  );
  if (!anchor) return;
  take(lead, anchor);
  const placed = [anchor];
  const fa = frame.f(anchor);
  for (const i of ids.slice(1)) {
    const lean = (members[i].back ? -1 : 1) * leanSign;
    const scored = [];
    for (const t of free.values()) {
      const d = manhattan(t, anchor);
      if (d > FORMATION_REACH + 1 || !allow(t)) continue;
      if (!placed.some((p) => manhattan(p, t) <= FORMATION_REACH)) continue;
      if (!(standScore(t, i) > 0)) continue;
      scored.push({
        tile: t,
        score: standScore(t, i) + lean * (frame.f(t) - fa) * 2 - d,
      });
    }
    const tile = pickBest(scored, random);
    if (!tile) continue;
    take(i, tile);
    placed.push(tile);
  }
}

/** A screen: the front line across the army's way, the back line behind its gaps. */
function line({ ids, members, free, standScore, frame, random, take }) {
  const front = ids.filter((i) => !members[i].back);
  const back = ids.filter((i) => members[i].back);
  // A screen with no line-fighters is held by its first members anyway.
  if (!front.length) front.push(...back.splice(0, Math.ceil(back.length / 2)));
  const lead = front[0];
  const tiles = [...free.values()];
  const fs = tiles.map((t) => frame.f(t));
  const fMax = Math.max(...fs);
  const fMin = Math.min(...fs);
  // The line stands in the front part of the zone, nearest the army.
  const frontEdge = fMax - Math.max(1, (fMax - fMin) * 0.4);
  const anchor = pickBest(
    tiles
      .filter((t) => frame.f(t) >= frontEdge && standScore(t, lead) > 0)
      .map((t) => ({ tile: t, score: standScore(t, lead) - Math.abs(frame.s(t)) })),
    random,
  );
  if (!anchor) return;
  take(lead, anchor);
  const fa = frame.f(anchor);
  const sa = frame.s(anchor);
  const placed = [anchor];
  const slot = (i, depth, offsets) => {
    for (const off of offsets) {
      const scored = [];
      for (const t of free.values()) {
        const ds = Math.abs(frame.s(t) - (sa + off));
        const df = Math.abs(frame.f(t) - (fa - depth));
        if (ds > 1 || df > 1) continue;
        // The back line stands behind the front, never in it.
        if (depth > 0 && frame.f(t) > fa - depth / 2) continue;
        if (!placed.some((p) => manhattan(p, t) <= FORMATION_REACH)) continue;
        if (!(standScore(t, i) > 0)) continue;
        scored.push({ tile: t, score: standScore(t, i) - ds * 4 - df * 1.5 });
      }
      const tile = pickBest(scored, random);
      if (tile) {
        take(i, tile);
        placed.push(tile);
        return offsets.filter((o) => o !== off);
      }
    }
    return offsets;
  };
  let offsets = [];
  for (let k = 1; k <= 6; k++) offsets.push(k * SCREEN_SPACING, -k * SCREEN_SPACING);
  for (const i of front.slice(1)) offsets = slot(i, 0, offsets);
  let gaps = [];
  for (let k = 0; k <= 6; k++) gaps.push(k * SCREEN_SPACING + 1, -(k * SCREEN_SPACING + 1));
  for (const i of back) gaps = slot(i, 1, gaps);
}

/**
 * The opening's cover (docs/specs/map-variety.md): one at a time, each foe the army can strike on
 * its first phase that fewer than `minSupport` other foes could answer moves to the free tile of
 * its zone nearest the rest of its group where it either cannot be struck yet or is answered,
 * the nearer its old tile on a tie. A foe with no such tile stays. No draw. Mutates the spawns.
 * @param {object} args
 * @param {object[]} args.spawns the enemy spawns
 * @param {(index:number) => {col:number,row:number}[]|null} args.tilesFor the tiles a spawn may
 *   move to (its group's zone; null for a spawn that never moves: a boss, an ungrouped foe)
 * @param {(tile, index:number) => number} args.standScore 0 where the spawn cannot stand
 * @param {object} args.scan scanOpening's inputs but the spawns: mapLayout, terrainData, classes,
 *   playerSpawns, act, thronePos, objective
 * @returns {number} how many foes moved
 */
export function coverOpening({
  spawns,
  tilesFor,
  standScore,
  scan,
  minSupport = MIN_OPENING_SUPPORT,
}) {
  const { mapLayout, terrainData, classes, playerSpawns, act } = scan;
  const cols = mapLayout[0]?.length || 0;
  const rows = mapLayout.length;
  const ctx = {
    mapLayout,
    terrainData,
    classes,
    thronePos: scan.thronePos || null,
    objective: scan.objective || 'rout',
  };
  const cache = new Map();
  const book = reachBook(ctx, cache);
  const at = (t) => tileIndex(t.col, t.row, cols);
  const stuck = new Set();
  let moved = 0;
  for (let round = 0; round < spawns.length * 2; round++) {
    const { foes } = scanOpening({ ...scan, spawns, timing: false, cache });
    const bad = foes
      .filter(
        (f) =>
          f.exposed && f.support < minSupport && !stuck.has(f.index) && tilesFor(f.index) !== null,
      )
      .sort((a, b) => a.support - b.support || a.index - b.index)[0];
    if (!bad) break;
    const i = bad.index;
    const foe = spawns[i];
    const others = spawns.filter((_, j) => j !== i);
    const taken = new Set(spawns.map(at));
    const striker = playerStrikerTiles({
      mapLayout,
      terrainData,
      playerSpawns,
      act,
      enemyTiles: new Set(others.map(at)),
    });
    const mates = others.filter((s) => s.templateGroup && s.templateGroup === foe.templateGroup);
    const centre = mates.length ? mates : others;
    let best = null;
    let bestRank = null;
    for (const t of tilesFor(i) || []) {
      if (taken.has(at(t)) || !(standScore(t, i) > 0)) continue;
      const from = attackTilesAgainst(t, striker, cols, rows);
      let support = Infinity;
      for (const p of from) {
        const pi = at(p);
        let n = 0;
        for (const o of others) if (book.answers(o, p, pi)) n++;
        if (n < support) support = n;
      }
      if (from.length && support < minSupport) continue;
      const toGroup = centre.length ? Math.min(...centre.map((s) => manhattan(s, t))) : 0;
      const rank = [toGroup, manhattan(foe, t), t.row, t.col];
      if (!bestRank || lexLess(rank, bestRank)) {
        best = t;
        bestRank = rank;
      }
    }
    if (!best) {
      stuck.add(i);
      continue;
    }
    foe.col = best.col;
    foe.row = best.row;
    moved++;
  }
  return moved;
}

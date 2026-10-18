// IronGuardian — the rules of the Iron Guardian (classes.json: a 2x2 boss-tier keeper that never
// moves; docs/specs/large-units.md). Pure: no Phaser, no scene, never `Math.random`. Like
// EntityKit.js, the one implementation behind BattleScene (ui/HammerfallController.js) and the
// headless harness, so the two cannot drift.
//
// IRON PLATES. A unit with `plates` ({ count, defPerPlate, strPerPlate }, stamped from its class
// at creation) sheds one plate for each equal share of its max HP it has lost: with 4 plates, one
// at 75% HP, two at 50%, three at 25% (the last never: a plate always holds while it stands).
// Each shed plate takes `defPerPlate` off its DEF and adds `strPerPlate` to its blows. Read from
// HP alone (`platesOf`), so a checkpoint, a rewind or a resume needs nothing saved for it, and the
// forecast, the scene and the harness read the same mods (SkillSystem.getSkillCombatMods).
//
// HAMMERFALL. A unit with `hammerfall` ({ might }) marks the tiles its hammer falls on next, and
// the marks stand through the player's phase. At the start of the next enemy phase (after the
// Vigil's step and the Entity's limbs) every player or NPC unit with a body tile on a mark takes
// the slam (`slamDamage`: its STR, plates counted, plus `might`, less the victim's DEF; through
// UnitHealth, so Miracle, a Revival Stone and the Unbroken Banner hold as for any blow); then the
// next marks are planned. The two patterns alternate, the first `front`:
//   front  a strip as wide as its body and HAMMERFALL_FRONT_DEPTH deep, on the side facing the
//          nearest unit of the army (its first on a tie); none standing: below it
//   shock  every tile within HAMMERFALL_SHOCK_RADIUS of its body
// Only tiles a walker could stand on are marked (a wall takes no slam). Nothing is drawn from any
// random stream: the marks follow from the board, so a replayed phase marks the same tiles.
//
// The battle's state rides the suspend checkpoint and the Vision snapshot
// (BattleSnapshotState.captureBattleWorldState, as `hammerfallState`):
//   { marks: [{ col, row }], pattern: 'front' | 'shock' | null, next: 'front' | 'shock',
//     slams, lastProcessedTurn }
// A locked config holding a Hammerfall unit carries `hammerfall: { v: 1 }` (MapGenerator), the
// run-format guard's `hammerfall` capability: an older client has no rule (and no class) for it.

import { combatDistance, getFootprint } from './EntitySystem.js';
import { damageUnitDetailed } from './UnitHealth.js';

export const GUARDIAN_CLASS = 'Iron Guardian';
export const HAMMERFALL_PATTERNS = Object.freeze(['front', 'shock']);
/** How many tiles deep the front strip reaches from the body's edge. */
export const HAMMERFALL_FRONT_DEPTH = 3;
/** How far from the body the shockwave reaches. */
export const HAMMERFALL_SHOCK_RADIUS = 2;
/** The most marks a state keeps (more than either pattern can make). */
const MARKS_KEPT = 64;

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const count = (v) => Math.max(0, Math.trunc(Number(v) || 0));
const tileKey = (t) => `${t.col},${t.row}`;

// --- Iron Plates -----------------------------------------------------------------------------

/** A unit's plates config, made whole, or null when it wears none. */
export function platesConfigOf(unit) {
  const raw = unit?.plates;
  if (!isRecord(raw)) return null;
  const total = count(raw.count);
  if (total < 2) return null;
  return { count: total, defPerPlate: count(raw.defPerPlate), strPerPlate: count(raw.strPerPlate) };
}

/**
 * The plates a unit has shed and what they cost it: `{ count, shed, left, defDelta, strDelta }`,
 * or null when it wears none. Shed = floor(share of max HP lost x count), never all of them.
 */
export function platesOf(unit) {
  const cfg = platesConfigOf(unit);
  if (!cfg) return null;
  const max = Number(unit?.stats?.HP) || 0;
  const hp = Math.max(0, Math.min(max, Number(unit?.currentHP) || 0));
  const lost = max > 0 ? (max - hp) / max : 0;
  const shed = Math.max(0, Math.min(cfg.count - 1, Math.floor(lost * cfg.count + 1e-9)));
  return {
    count: cfg.count,
    shed,
    left: cfg.count - shed,
    defDelta: -shed * cfg.defPerPlate,
    strDelta: shed * cfg.strPerPlate,
  };
}

/** The combat mods the shed plates give (SkillSystem.getSkillCombatMods adds them). */
export function plateCombatMods(unit) {
  const plates = platesOf(unit);
  if (!plates || plates.shed === 0) return null;
  return { defBonus: plates.defDelta, atkBonus: plates.strDelta };
}

/** The one line the unit cards show for a plated unit, or ''. */
export function platesLine(unit) {
  const plates = platesOf(unit);
  if (!plates) return '';
  if (plates.shed === 0) return `Iron Plates: ${plates.left} of ${plates.count}`;
  return (
    `Iron Plates: ${plates.left} of ${plates.count} · DEF ${plates.defDelta}, ` +
    `Might +${plates.strDelta}`
  );
}

// --- Hammerfall ------------------------------------------------------------------------------

/** True for a living unit whose class swings Hammerfall. */
export function isHammerfallUnit(unit) {
  return isRecord(unit?.hammerfall) && Number(unit?.currentHP) > 0 && !unit?._removing;
}

/** The first living Hammerfall unit among `units`, or null. */
export function livingHammerfallUnit(units) {
  return (units || []).find(isHammerfallUnit) || null;
}

/** A fresh battle's state: nothing marked, the front strip first. */
export function createHammerfallState() {
  return { marks: [], pattern: null, next: 'front', slams: 0, lastProcessedTurn: 0 };
}

const patternOr = (v, fallback) => (HAMMERFALL_PATTERNS.includes(v) ? v : fallback);

/** A saved state, made whole. */
export function sanitizeHammerfallState(raw) {
  if (!isRecord(raw)) return createHammerfallState();
  const marks = (Array.isArray(raw.marks) ? raw.marks : [])
    .filter((t) => isRecord(t) && Number.isInteger(t.col) && Number.isInteger(t.row))
    .slice(0, MARKS_KEPT)
    .map((t) => ({ col: t.col, row: t.row }));
  return {
    marks,
    pattern: marks.length > 0 ? patternOr(raw.pattern, null) : null,
    next: patternOr(raw.next, 'front'),
    slams: count(raw.slams),
    lastProcessedTurn: count(raw.lastProcessedTurn),
  };
}

/** True when a locked config holds a Hammerfall unit (MapGenerator writes the flag). */
export function hammerfallOf(config) {
  return isRecord(config?.hammerfall) && config.hammerfall.v === 1;
}

/** The state a battle on `config` starts with: null unless a Hammerfall unit is in it. */
export function initialHammerfallState(config) {
  return hammerfallOf(config) ? createHammerfallState() : null;
}

/** The config field for a map whose spawns hold a Hammerfall class, else {}. */
export function hammerfallConfigFor(enemySpawns, classes) {
  const swings = new Set((classes || []).filter((c) => isRecord(c?.hammerfall)).map((c) => c.name));
  const any = (enemySpawns || []).some((s) => swings.has(s?.className));
  return any ? { hammerfall: { v: 1 } } : {};
}

/** The side of the body that faces `target`: { dc, dr } (the longer axis, rows on a tie). */
export function facingToward(body, target) {
  if (!target) return { dc: 0, dr: 1 };
  const fp = getFootprint(body);
  const cs = fp.map((t) => t.col);
  const rs = fp.map((t) => t.row);
  const minC = Math.min(...cs);
  const maxC = Math.max(...cs);
  const minR = Math.min(...rs);
  const maxR = Math.max(...rs);
  const tc = target.col;
  const tr = target.row;
  const dx = tc < minC ? tc - minC : tc > maxC ? tc - maxC : 0;
  const dy = tr < minR ? tr - minR : tr > maxR ? tr - maxR : 0;
  if (dx === 0 && dy === 0) return { dc: 0, dr: 1 };
  if (Math.abs(dx) > Math.abs(dy)) return { dc: Math.sign(dx), dr: 0 };
  return { dc: 0, dr: Math.sign(dy) };
}

/** The nearest living army unit to `body` (player first, then NPC, roster order on a tie). */
export function nearestArmyUnit(body, units) {
  let best = null;
  let bestDist = Infinity;
  for (const unit of units || []) {
    if (!(unit?.currentHP > 0) || unit._removing) continue;
    const dist = combatDistance(body, unit);
    if (dist < bestDist) {
      best = unit;
      bestDist = dist;
    }
  }
  return best;
}

/**
 * The tiles a `pattern` slam from `body` covers, in a fixed order (rows, then columns): on the
 * board, off the body, and standable (`standable(col, row)`, default every tile).
 */
export function hammerfallTiles(body, pattern, { cols, rows, toward = null, standable } = {}) {
  const fp = getFootprint(body);
  const own = new Set(fp.map(tileKey));
  const ok = (col, row) =>
    col >= 0 &&
    row >= 0 &&
    col < cols &&
    row < rows &&
    !own.has(`${col},${row}`) &&
    (standable ? standable(col, row) : true);
  const out = [];
  if (pattern === 'shock') {
    const cs = fp.map((t) => t.col);
    const rs = fp.map((t) => t.row);
    const r = HAMMERFALL_SHOCK_RADIUS;
    for (let row = Math.min(...rs) - r; row <= Math.max(...rs) + r; row++)
      for (let col = Math.min(...cs) - r; col <= Math.max(...cs) + r; col++) {
        if (!ok(col, row)) continue;
        if (combatDistance(body, { col, row }) <= r) out.push({ col, row });
      }
    return out;
  }
  // front: the body's edge facing the target, swept HAMMERFALL_FRONT_DEPTH deep.
  const { dc, dr } = facingToward(body, toward);
  const edge = fp.filter((t) => !own.has(`${t.col + dc},${t.row + dr}`));
  const seen = new Set();
  for (let depth = 1; depth <= HAMMERFALL_FRONT_DEPTH; depth++)
    for (const t of edge) {
      const tile = { col: t.col + dc * depth, row: t.row + dr * depth };
      const key = tileKey(tile);
      if (seen.has(key) || !ok(tile.col, tile.row)) continue;
      seen.add(key);
      out.push(tile);
    }
  return out.sort((a, b) => a.row - b.row || a.col - b.col);
}

/** A walker could stand on a board tile (a wall takes no mark): the grid's own terrain read. */
export function standableAt(grid, col, row) {
  const cost = grid?.getTerrainAt?.(col, row)?.moveCost?.Infantry;
  return cost != null && cost !== '--' && cost !== Infinity;
}

/** The slam's damage to `victim`: STR (plates counted) + might, less DEF; never below 0. */
export function slamDamage(guardian, victim) {
  const might = count(guardian?.hammerfall?.might);
  const str = (Number(guardian?.stats?.STR) || 0) + (platesOf(guardian)?.strDelta || 0);
  const def = Number(victim?.stats?.DEF) || 0;
  return Math.max(0, str + might - def);
}

/** The living army units with a body tile on `marks`, in roster order (players, then NPCs). */
export function unitsOnMarks(marks, units) {
  const marked = new Set((marks || []).map(tileKey));
  if (marked.size === 0) return [];
  return (units || []).filter(
    (u) => u?.currentHP > 0 && !u._removing && getFootprint(u).some((t) => marked.has(tileKey(t))),
  );
}

/**
 * One enemy-phase start of Hammerfall, as a generator (the Entity's splash's shape): the marks
 * standing since the last phase fall, each victim struck through UnitHealth and yielded after its
 * HP changes (so the scene presents it and removes a fallen one before the next); then the next
 * marks are planned facing the nearest unit still standing. Mutates nothing it is handed but the
 * victims' HP; returns `{ state, slam: { pattern, tiles, hits }, skipped }`, and the caller keeps
 * the state. A turn already processed, or no Guardian standing, does nothing (its marks fade).
 */
export function* hammerfallPhase({
  state,
  enemyUnits = [],
  army = [],
  cols,
  rows,
  standable,
  turn,
  battleBlessings = null,
}) {
  const before = sanitizeHammerfallState(state);
  const phase = Math.max(1, Math.trunc(Number(turn) || 1));
  if (phase <= before.lastProcessedTurn) return { state: before, slam: null, skipped: true };
  const next = structuredClone(before);
  next.lastProcessedTurn = phase;
  const guardian = livingHammerfallUnit(enemyUnits);
  if (!guardian) {
    next.marks = [];
    next.pattern = null;
    return { state: next, slam: null, skipped: false };
  }
  let slam = null;
  if (before.marks.length > 0) {
    const hits = [];
    for (const victim of unitsOnMarks(before.marks, army)) {
      const damage = slamDamage(guardian, victim);
      const { lost, stoneBroken, bannerHeld } = damageUnitDetailed(victim, damage, {
        blessings: battleBlessings,
      });
      const hit = {
        kind: 'hammerfall',
        guardian,
        victim,
        damage,
        lost,
        stoneBroken: Boolean(stoneBroken),
        bannerHeld: Boolean(bannerHeld),
        fell: victim.currentHP <= 0,
      };
      hits.push(hit);
      yield hit;
    }
    slam = { pattern: before.pattern, tiles: before.marks.map((t) => ({ ...t })), hits };
    next.slams += 1;
  }
  if (!isHammerfallUnit(guardian)) {
    next.marks = [];
    next.pattern = null;
    return { state: next, slam, skipped: false };
  }
  const pattern = next.next;
  next.marks = hammerfallTiles(guardian, pattern, {
    cols,
    rows,
    standable,
    toward: nearestArmyUnit(guardian, army),
  }).slice(0, MARKS_KEPT);
  next.pattern = pattern;
  next.next = pattern === 'front' ? 'shock' : 'front';
  return { state: next, slam, skipped: false };
}

/**
 * Drive the phase without presentation (the harness): a fallen victim is removed through
 * `remove(victim, { killer })` before the next, as the scene does. Returns the step's record.
 */
export function runHammerfallPhaseSync(world, { remove } = {}) {
  const steps = hammerfallPhase(world);
  for (;;) {
    const { value, done } = steps.next();
    if (done) return value;
    if (value.victim.currentHP <= 0) remove?.(value.victim, { killer: value.guardian });
  }
}

/** The tiles marked now, as a Set of "col,row" keys (previews, Threat Sight). */
export function markedTileKeys(state) {
  return new Set((state?.marks || []).map(tileKey));
}

/** What the unit cards say of a Hammerfall unit's next blow, or ''. */
export function hammerfallLine(unit, state) {
  if (!isRecord(unit?.hammerfall)) return '';
  const marked = state?.marks?.length > 0 ? state.pattern : null;
  if (marked === 'front') return 'Hammerfall: falls in front next (marked)';
  if (marked === 'shock') return 'Hammerfall: falls all around next (marked)';
  return 'Hammerfall: marks where it falls each turn';
}

/**
 * Every line the unit cards show for an Iron Guardian (plates, then the hammer's next blow), or
 * []. `state` is the battle's Hammerfall state (none outside a battle: the general line).
 */
export function guardianCardLines(unit, state = null) {
  return [platesLine(unit), hammerfallLine(unit, state)].filter(Boolean);
}

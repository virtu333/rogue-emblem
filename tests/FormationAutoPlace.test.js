import { describe, expect, it, vi } from 'vitest';
vi.mock('phaser', () => ({ default: {} }));
import { FormationController } from '../src/ui/FormationController.js';
import { autoFill, createFormation, isComplete } from '../src/engine/FormationPlacement.js';

// Auto-place starts each benched unit on its default tile (the one the battle gave
// it), but only as a preference: when those defaults block a full formation, the
// fill must move them. Ways it can go wrong, each caught below:
//   - a default tile is treated as fixed, so a unit that could have been placed
//     stays on the bench (the reported bug);
//   - defaults are dropped when nothing conflicts, so units jump around for no reason;
//   - a conflict moves more units off their defaults than it has to;
//   - a tile the player chose by hand is taken over, or its unit is moved.

const row = (n) => Array.from({ length: n }, (_, i) => ({ col: i, row: 0 }));

/**
 * A controller at the placement step, without a scene. `legal(u, t)` is where unit
 * u may stand; `defaults[u]` is the tile index the battle gave unit u.
 */
function controller({ units, tiles, defaults, legal }) {
  const c = Object.create(FormationController.prototype);
  c.ready = true;
  c.units = Array.from({ length: units }, (_, u) => ({ name: `U${u}`, moveType: 'Infantry' }));
  c.tiles = tiles;
  c.defaultTiles = defaults.map((t) => tiles[t]);
  c.leniency = c.units.map(() => 'strict');
  c.formation = createFormation(units, tiles);
  c.issue = (u, t) => (legal(u, t) ? '' : 'Not here.');
  c.syncField = () => {};
  return c;
}

/**
 * Independent oracle: try every assignment of the benched units to free tiles and
 * return the most units any assignment places and, among those, the most units it
 * leaves on their default tiles.
 */
function bestPossible({ tiles, defaults, legal, fixedAt }) {
  const taken = new Set(fixedAt.filter((t) => t !== null));
  const benched = fixedAt.map((t, u) => (t === null ? u : -1)).filter((u) => u !== -1);
  let best = { placed: -1, kept: -1 };
  const walk = (i, used, placed, kept) => {
    if (i === benched.length) {
      if (placed > best.placed || (placed === best.placed && kept > best.kept))
        best = { placed, kept };
      return;
    }
    const u = benched[i];
    walk(i + 1, used, placed, kept); // u stays on the bench
    for (let t = 0; t < tiles.length; t++) {
      if (taken.has(t) || used.has(t) || !legal(u, t)) continue;
      used.add(t);
      walk(i + 1, used, placed + 1, kept + (defaults[u] === t ? 1 : 0));
      used.delete(t);
    }
  };
  walk(0, new Set(), 0, 0);
  return best;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A small random placement problem: legality, distinct default tiles, some hand placements. */
function randomCase(rng) {
  const units = 2 + Math.floor(rng() * 4); // 2..5
  const tileCount = units + Math.floor(rng() * 3); // one per unit plus 0..2 spares
  const tiles = row(tileCount);
  const allowed = Array.from({ length: units }, () =>
    Array.from({ length: tileCount }, () => rng() < 0.55),
  );
  const legal = (u, t) => allowed[u][t];
  // Defaults are distinct tiles, like the generator's spawns; some may be illegal.
  const order = [...Array(tileCount).keys()];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const defaults = order.slice(0, units);
  // The player may already have placed a unit or two (only on tiles they may use).
  const manual = [];
  for (let u = 0; u < units; u++) {
    if (rng() >= 0.2) continue;
    const t = Math.floor(rng() * tileCount);
    if (legal(u, t) && !manual.some((m) => m.t === t)) manual.push({ u, t });
  }
  return { units, tiles, allowed, legal, defaults, manual };
}

const keptDefaults = (at, defaults) => at.filter((t, u) => t !== null && t === defaults[u]).length;
const placed = (at) => at.filter((t) => t !== null).length;

describe('Auto-place: default tiles are a preference, not a lock', () => {
  it("fills the owner's case: a cavalier whose only tile is another unit's default", () => {
    // Units 0 and 1 may stand anywhere; the cavalier (2) only on tile 0, so its own
    // default (tile 2) is out and unit 0 must give up tile 0.
    const legal = (u, t) => (u === 2 ? t === 0 : true);
    const c = controller({ units: 3, tiles: row(3), defaults: [0, 1, 2], legal });
    c.autoPlace();
    expect(c.complete()).toBe(true);
    expect(c.formation.at).toEqual([2, 1, 0]);
    // Unit 1 is not part of the conflict and keeps its default tile.
    expect(c.formation.at[1]).toBe(1);
  });

  it('keeps every default tile when nothing conflicts', () => {
    // Five units on five spawns plus two spares; every unit may stand anywhere.
    const defaults = [4, 0, 3, 1, 2];
    const c = controller({ units: 5, tiles: row(7), defaults, legal: () => true });
    c.autoPlace();
    expect(c.formation.at).toEqual(defaults);
  });

  it('keeps every default tile and fills the rest when only defaultless units need tiles', () => {
    // Unit 3's default is a tile it cannot use; spares 4 and 5 are free for it.
    const legal = (u, t) => !(u === 3 && t === 3);
    const c = controller({ units: 4, tiles: row(6), defaults: [0, 1, 2, 3], legal });
    c.autoPlace();
    expect(c.formation.at.slice(0, 3)).toEqual([0, 1, 2]);
    expect([4, 5]).toContain(c.formation.at[3]);
  });

  it('moves as few units off their defaults as the conflict needs', () => {
    // Unit 3's default (tile 3) is out; it may stand on tile 0 or tile 1.
    // Freeing tile 1 moves only unit 1 (to spare 4); freeing tile 0 would move
    // unit 0 to tile 2 and unit 2 on to spare 4. Best: one unit moves, not two.
    const allowed = { 0: [0, 2], 1: [1, 4], 2: [2, 4], 3: [0, 1] };
    const legal = (u, t) => allowed[u].includes(t);
    const c = controller({ units: 4, tiles: row(5), defaults: [0, 1, 2, 3], legal });
    c.autoPlace();
    expect(c.formation.at).toEqual([0, 4, 2, 1]);
  });

  it('never moves a unit the player placed, even when moving it would fill the formation', () => {
    // Unit 1 may only stand on tile 0; the player has put unit 0 there by hand.
    const legal = (u, t) => (u === 1 ? t === 0 : true);
    const c = controller({ units: 2, tiles: row(2), defaults: [1, 0], legal });
    expect(c.assign(0, 0)).toBe(true);
    c.autoPlace();
    expect(c.formation.at).toEqual([0, null]);
    expect(c.complete()).toBe(false);
  });

  it("a hand placement on another unit's default tile stays; that unit takes another tile", () => {
    const c = controller({ units: 3, tiles: row(4), defaults: [0, 1, 2], legal: () => true });
    expect(c.assign(1, 0)).toBe(true); // unit 1 onto unit 0's default
    c.autoPlace();
    expect(c.formation.at[1]).toBe(0);
    expect(c.formation.at[2]).toBe(2); // untouched default
    expect([1, 3]).toContain(c.formation.at[0]);
    expect(c.complete()).toBe(true);
  });

  it('random small cases: fills as many units as any assignment, keeps the most defaults', () => {
    const rng = seeded(20260927);
    let fullFromEmpty = 0;
    for (let i = 0; i < 400; i++) {
      const k = randomCase(rng);
      const c = controller(k);
      for (const { u, t } of k.manual) c.assign(u, t);
      const fixedAt = [...c.formation.at];
      c.autoPlace();
      const at = c.formation.at;
      const label = JSON.stringify({ allowed: k.allowed, defaults: k.defaults, fixedAt, at });
      // Hand placements never move.
      fixedAt.forEach((t, u) => {
        if (t !== null) expect(at[u], label).toBe(t);
      });
      // Every placement is legal and no tile holds two units.
      at.forEach((t, u) => {
        if (t !== null) expect(k.legal(u, t), label).toBe(true);
      });
      expect(new Set(at.filter((t) => t !== null)).size, label).toBe(placed(at));
      // As many units as any assignment, then as many defaults kept as possible.
      const best = bestPossible({ ...k, fixedAt });
      expect(placed(at), label).toBe(placed(fixedAt) + best.placed);
      const keptByHand = fixedAt.filter((t, u) => t !== null && t === k.defaults[u]).length;
      expect(keptDefaults(at, k.defaults), label).toBe(keptByHand + best.kept);
      // Whenever a fill from an empty formation (no defaults) places everyone,
      // Auto-place does too.
      if (!k.manual.length && isComplete(autoFill(createFormation(k.units, k.tiles), k.legal))) {
        fullFromEmpty++;
        expect(isComplete(c.formation), label).toBe(true);
      }
    }
    // The sample must exercise the full-fill case often enough to mean something.
    expect(fullFromEmpty).toBeGreaterThan(50);
  });
});

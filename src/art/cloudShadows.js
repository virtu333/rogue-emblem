// cloudShadows — pure plan for cloud shadows drifting over a daylit battlefield (no Phaser).
//
// A few large soft shadows cross an outdoor map by day, slowly, the way a cloud's shadow
// crosses a field: they give the flat board depth and a sense of sky. Each cloud is a
// cluster of soft puffs. Positions are a pure function of elapsed time (they wrap around
// the map with a margin), so nothing is stored or stepped, a paused tab never bursts, and
// Reduce motion simply holds time at 0.
//
// Every random value comes from the battle's own seeded generator (cloudSeed), never
// Math.random (during a battle Math.random IS the battle RNG). Presentation only.

import { createSeededRng } from '../engine/SeededRng.js';

// Which daylit moods have a sky with clouds that cast shadows. Iron Rain is overcast (no
// sun, no shadows); nights, indoors, snow, the volcano's ash and the Deep have none.
const CLOUDED_GRADES = Object.freeze(['act1', 'act3']);
const CLOUDED_BIOMES = Object.freeze(['grassland', 'swamp']);
const CLOUDED_LIGHTING = Object.freeze(['day', 'dawn', 'dusk']);

export const CLOUD_SHADOW_SPEC = Object.freeze({
  // One cloud per this many tiles of the wind's loop (the map's width plus a margin each
  // side), at least 3: a small map still sees one or two crossing at any time.
  tilesPerCloud: 6,
  // Cloud size in tiles (the cluster's span) and its puffs.
  span: Object.freeze([4.5, 8]),
  puffs: Object.freeze([3, 5]),
  // Shadow strength (alpha of the ink) and colour: a cool violet shade, never black.
  alpha: Object.freeze([0.24, 0.32]),
  color: '#1c1838',
  // Drift in tiles per second: slow, mostly along +x with a little +y.
  drift: Object.freeze([0.12, 0.2]),
  slope: Object.freeze([0.15, 0.35]),
  // Reduced mode keeps the clouds but lighter.
  reducedAlpha: 0.7,
});

/** Whether a battle's mood casts cloud shadows (pure). */
export function cloudShadowsFor({ gradeKey, biome, lighting, isScripted = false } = {}) {
  // A low sun (dawn, dusk) still throws cloud shadows; the dawn and dusk grades share
  // their act's sky.
  if (isScripted || !CLOUDED_LIGHTING.includes(lighting)) return false;
  const act = String(gradeKey || '').replace(/_(dawn|dusk)$/, '');
  return CLOUDED_GRADES.includes(act) && CLOUDED_BIOMES.includes(biome);
}

/** A stable presentation seed for a battle's clouds (pure; reads no RNG). */
export function cloudSeed(battleSeed) {
  let h = (Number(battleSeed) >>> 0) ^ 0x636c6f75; // 'clou'
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

const lerp = (range, t) => range[0] + (range[1] - range[0]) * t;

/**
 * Lay out a battle's clouds (pure). Units are tiles; the map is cols x rows.
 * @returns {{ clouds: { x, y, vx, vy, alpha, puffs: { dx, dy, r }[] }[], cols, rows, margin }}
 */
export function planCloudShadows({ cols, rows, seed = 0, spec = CLOUD_SHADOW_SPEC } = {}) {
  const rng = createSeededRng(seed >>> 0);
  // A cloud is gone once its centre is half its span past the edge.
  const margin = Math.ceil(spec.span[1] / 2) + 1;
  const count = Math.max(3, Math.round((cols + margin * 2) / spec.tilesPerCloud));
  const speed = lerp(spec.drift, rng());
  const slope = lerp(spec.slope, rng());
  const clouds = [];
  for (let i = 0; i < count; i++) {
    const span = lerp(spec.span, rng());
    const puffCount = Math.round(lerp(spec.puffs, rng()));
    const puffs = [];
    for (let p = 0; p < puffCount; p++) {
      puffs.push({
        dx: (rng() - 0.5) * span,
        dy: (rng() - 0.5) * span * 0.55,
        r: span * lerp([0.28, 0.42], rng()),
      });
    }
    // All clouds ride one wind, a little faster or slower each.
    const own = speed * lerp([0.85, 1.15], rng());
    clouds.push({
      // Spread over the whole loop (map plus margins) so they never bunch.
      x: ((i + rng() * 0.6) / count) * (cols + margin * 2) - margin,
      y: rng() * rows,
      vx: own,
      vy: own * slope,
      alpha: lerp(spec.alpha, rng()),
      puffs,
    });
  }
  return { clouds, cols, rows, margin };
}

function wrap(v, lo, span) {
  return ((((v - lo) % span) + span) % span) + lo;
}

/**
 * Where each cloud's centre is after `seconds` (pure): drifted and wrapped around the map
 * with the plan's margin, so a cloud leaves one edge and comes back in at the other.
 * @returns {{ x, y }[]} tile coordinates
 */
export function cloudPositionsAt(plan, seconds = 0) {
  const t = Number.isFinite(seconds) ? seconds : 0;
  const { cols, rows, margin } = plan;
  return plan.clouds.map((c) => ({
    x: wrap(c.x + c.vx * t, -margin, cols + margin * 2),
    y: wrap(c.y + c.vy * t, -margin, rows + margin * 2),
  }));
}

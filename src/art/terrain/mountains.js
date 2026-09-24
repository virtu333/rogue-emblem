// Mountain cells: one to three faceted peaks drawn inside the cell.
//
// Each peak is a silhouette with crag-jagged slopes, split by a ridge line
// into a lit west face and a shaded east face (key light low from the
// upper-left). Spur creases run down both faces and strata ticks break the
// lit face, so the rock reads as carved facets instead of the study's
// voxel columns (which streaked vertically). Neighbouring mountain cells sit
// on a shared scree ground, so ranges still read as ranges.
import { R } from './palette.js';
import { rand2, valueNoise, worley } from './noise.js';
import { Sprite } from './sprite.js';
import { ART_CELL as CELL } from './state.js';

export const MOUNTAIN_OVERHANG = { side: 1, top: 2 };

function peakLayout(S, c, r) {
  const h = (k) => rand2(c, r, S.seed + 300 + k);
  const roll = h(0);
  const flip = h(9) < 0.5;
  let peaks;
  // Massifs fill the cell: feet reach the cell sides, summits the top edge.
  if (roll < 0.35) {
    peaks = [{ ax: 11 + h(1) * 2, ay: 0.5 + h(2), lx: -0.5, rx: 23.5, by: 23 }];
  } else if (roll < 0.8) {
    peaks = [
      { ax: 7 + h(1) * 1.5, ay: 0.5 + h(2), lx: -0.5, rx: 15.5, by: 17 },
      { ax: 15.5 + h(3) * 1.5, ay: 5 + h(4) * 2, lx: 4, rx: 24, by: 23 },
    ];
  } else {
    peaks = [
      { ax: 16.5 + h(1), ay: 0.5 + h(2), lx: 9, rx: 24, by: 14 },
      { ax: 6 + h(3) * 1.5, ay: 3.5 + h(4) * 1.5, lx: -0.5, rx: 13.5, by: 19 },
      { ax: 14 + h(5) * 1.5, ay: 8.5 + h(6) * 1.5, lx: 4.5, rx: 23.5, by: 23 },
    ];
  }
  if (flip)
    for (const p of peaks) {
      const { ax, lx, rx } = p;
      p.ax = CELL - 1 - ax;
      p.lx = CELL - 1 - rx;
      p.rx = CELL - 1 - lx;
    }
  return peaks;
}

function paintPeak(S, s, c, r, p, k) {
  const ox = c * CELL,
    oy = r * CELL;
  const st = S.style.rock;
  const ramp = st.ramp; // 8 tones dark -> light
  const cap = st.cap?.ramp;
  const seed = S.seed + 330 + k * 17 + c * 7 + r * 13;
  const ay = Math.round(p.ay),
    by = p.by;
  const span = Math.max(1, by - ay);
  // spur creases: [start t on the ridge, horizontal drift per row]
  const spurs = [];
  const nSpur = 2 + Math.floor(rand2(c + k, r, seed) * 2);
  for (let q = 0; q < nSpur; q++)
    spurs.push({
      y0: ay + Math.round(span * (0.22 + 0.5 * rand2(q, k, seed + 1))),
      side: q % 2 ? 1 : -1,
      slope: 0.7 + rand2(q, k, seed + 2) * 0.5,
      len: Math.round(span * (0.25 + rand2(q, k, seed + 3) * 0.2)),
    });
  for (let y = ay; y <= by; y++) {
    const t = (y - ay) / span;
    const f = Math.pow(t, 0.72); // bulky shoulders, not a tent
    const jag = Math.min(1, t * 3);
    const jl = (valueNoise(y, 3, 2.3, seed + 4) - 0.5) * 3.2 * jag;
    const jr = (valueNoise(y, 7, 2.3, seed + 5) - 0.5) * 3 * jag;
    // the foot rounds off so the base is not a flat grid line
    const foot = t > 0.86 ? (t - 0.86) * 9 : 0;
    const xl = Math.round(p.ax - (p.ax - p.lx) * f + jl + foot);
    const xr = Math.round(p.ax + (p.rx - p.ax) * f + jr - foot);
    const xm = p.ax + (p.rx - p.ax) * 0.2 * t + (valueNoise(y, 11, 3, seed + 6) - 0.5) * 1.2;
    const capLine = ay + 3.5 + (valueNoise(y, 13, 3, seed + 7) - 0.5) * 2;
    for (let x = xl; x <= xr; x++) {
      const lit = x + 0.5 < xm;
      // Rock facets: Voronoi plates, each a flat plane with its own tilt,
      // lit on the west face and shaded on the east face. A dark crease
      // runs along the lower / right edge of every plate.
      const wx = ox + x,
        wy = oy + y;
      const w = worley(wx, wy * 1.25, 5.5, seed + 20);
      const facet = w.id,
        seam = w.d2 - w.d1;
      const tilt = (facet % 1000) / 1000;
      let tone;
      if (lit) {
        tone = tilt > 0.62 ? 5 : tilt < 0.18 ? 3 : 4;
        if (xm - (x + 0.5) < 1.6 && t < 0.6) tone = 5;
      } else {
        tone = tilt > 0.75 ? 3 : tilt < 0.2 ? 1 : 2;
      }
      if (seam < 0.9 && worley(wx + 1, (wy + 1) * 1.25, 5.5, seed + 20).id !== facet)
        tone = Math.max(0, tone - (lit ? 2 : 1));
      if (t > 0.8) tone = Math.max(0, tone - 1); // occlusion near the ground
      // spur creases: a dark notch with a lit lip above-left of it
      for (const sp of spurs) {
        if (y < sp.y0 || y > sp.y0 + sp.len) continue;
        const along = y - sp.y0;
        const cx = xm + sp.side * (along * sp.slope + 1);
        if (Math.abs(x + 0.5 - cx) < 0.6) tone = lit ? 3 : 1;
        else if (Math.abs(x + 0.5 - (cx - 1)) < 0.6 && lit) tone = Math.max(tone, 5);
      }
      // strata ticks on the lit face
      if (lit && t > 0.3 && t < 0.8 && (y + Math.round(x / 3)) % 5 === 0) {
        if (valueNoise(x, y, 3, seed + 8) > 0.62) tone = Math.max(1, tone - 1);
      }
      let col = ramp[Math.max(0, Math.min(ramp.length - 1, tone))];
      if (cap && y < capLine + (lit ? 0.6 : -0.6) && t < 0.55) {
        col = lit ? cap[(x + 0.5 > xm - 1.6 ? 5 : 4) - (tone < 4 ? 1 : 0)] : cap[tone <= 1 ? 1 : 2];
      } else if (st.ember && !lit && t > 0.45 && valueNoise(x, y, 2, seed + 9) > 0.83) {
        col = R('ember', 2);
      }
      s.set(ox + x, oy + y, col);
    }
  }
}

/** The peaks of one mountain cell as a single sprite. */
export function mountainSprite(S, c, r) {
  const peaks = peakLayout(S, c, r);
  const st = S.style.rock;
  const ox = c * CELL,
    oy = r * CELL;
  const composite = new Sprite(c, r, 'mountain', oy + CELL - 1, { a: 0.45, b: 0.22 });
  peaks.forEach((p, k) => {
    const s = new Sprite(c, r, 'mountain', oy + p.by);
    paintPeak(S, s, c, r, p, k);
    // selective outline: dark on bottom/right, warm rim on the top/left edge
    s.outline({ dark: st.outline, rim: true });
    if (k > 0) {
      // occlusion line where this nearer peak overlaps the one behind
      const edge = [];
      s.forEach((x, y) => {
        if (!s.has(x, y - 1) && composite.has(x, y - 1)) edge.push(x, y - 1);
        if (!s.has(x - 1, y) && composite.has(x - 1, y)) edge.push(x - 1, y);
      });
      for (let q = 0; q < edge.length; q += 2) composite.set(edge[q], edge[q + 1], st.outline);
    }
    composite.drawOver(s);
  });
  composite.clipTo(
    ox - MOUNTAIN_OVERHANG.side,
    oy - MOUNTAIN_OVERHANG.top,
    ox + CELL + MOUNTAIN_OVERHANG.side,
    oy + CELL,
  );
  return composite;
}

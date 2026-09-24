// Cleanup passes a pixel artist would do after a reduction. All operate on an
// IndexedSprite in place and are deterministic (raster order, snapshot reads).
import { IndexedSprite } from './indexed.mjs';
import { SLOT, WEAPON_SLOTS } from './slots.mjs';
import { nearestStep } from './ramps.mjs';

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const N8 = [...N4, [1, 1], [-1, -1], [1, -1], [-1, 1]];

/** Reduction output (slot + mean Lab) -> IndexedSprite with per-slot ramp steps. */
export function quantize(red, rampLabs) {
  const sp = new IndexedSprite(red.w, red.h);
  for (let i = 0; i < red.w * red.h; i++) {
    const s = red.slot[i];
    if (!s) continue;
    sp.slot[i] = s;
    if (s === SLOT.ink) {
      sp.shade[i] = 0;
      continue;
    }
    const ramp = rampLabs[s];
    const lab = [red.lab[i * 3], red.lab[i * 3 + 1], red.lab[i * 3 + 2]];
    let k = ramp ? nearestStep(ramp, lab) : 2;
    if (red.dark[i] >= 0.5) k = 0;
    else if (red.dark[i] >= 0.25) k = Math.min(k, 1);
    sp.shade[i] = k;
  }
  return sp;
}

const protectedSlot = (s) => s === SLOT.eye || s === SLOT.glow;

/**
 * Single pixels whose slot differs from all four neighbours take the majority slot
 * of their 8-neighbourhood (and that neighbour's shade). Eyes, glow and thin weapon
 * lines are kept; gold thread is kept when it touches other gold diagonally.
 */
export function removeOrphans(sp) {
  const snap = sp.clone();
  let changed = 0;
  for (let y = 0; y < sp.h; y++)
    for (let x = 0; x < sp.w; x++) {
      const s = snap.at(x, y);
      if (!s || protectedSlot(s)) continue;
      if (N4.some(([dx, dy]) => snap.at(x + dx, y + dy) === s)) continue;
      if (
        (s === SLOT.trim || WEAPON_SLOTS.has(s) || s === SLOT.ink) &&
        N8.some(([dx, dy]) => snap.at(x + dx, y + dy) === s)
      )
        continue;
      const count = new Map();
      for (const [dx, dy] of N8) {
        const t = snap.at(x + dx, y + dy);
        if (t) count.set(t, (count.get(t) || 0) + (dx && dy ? 1 : 2));
      }
      if (!count.size) continue;
      const [top] = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
      const n =
        N4.map(([dx, dy]) => [x + dx, y + dy]).find(([X, Y]) => snap.at(X, Y) === top) ||
        N8.map(([dx, dy]) => [x + dx, y + dy]).find(([X, Y]) => snap.at(X, Y) === top);
      sp.set(x, y, top, snap.shadeAt(n[0], n[1]));
      changed++;
    }
  return changed;
}

/** Transparent pixels enclosed on all four sides become the majority neighbour. */
export function fillPinholes(sp) {
  const snap = sp.clone();
  for (let y = 0; y < sp.h; y++)
    for (let x = 0; x < sp.w; x++) {
      if (snap.at(x, y)) continue;
      const ns = N4.map(([dx, dy]) => [x + dx, y + dy]).filter(([X, Y]) => snap.at(X, Y));
      if (ns.length < 4) continue;
      const [X, Y] = ns[0];
      sp.set(x, y, snap.at(X, Y), snap.shadeAt(X, Y));
    }
}

/** Silhouette spurs: a body pixel with at most one opaque 4-neighbour is removed (weapons exempt). */
export function removeSpurs(sp) {
  const snap = sp.clone();
  for (let y = 0; y < sp.h; y++)
    for (let x = 0; x < sp.w; x++) {
      const s = snap.at(x, y);
      if (!s || WEAPON_SLOTS.has(s) || protectedSlot(s)) continue;
      const k = N4.filter(([dx, dy]) => snap.at(x + dx, y + dy)).length;
      const k8 = N8.filter(([dx, dy]) => snap.at(x + dx, y + dy)).length;
      if (k === 0 || (k === 1 && k8 <= 2)) sp.set(x, y, SLOT.empty, 0);
    }
}

/**
 * Shade noise: a pixel whose shade differs from every same-slot 4-neighbour (with at
 * least three such neighbours) takes their most common shade. Specular highlights on
 * metal/trim (top step) and eyes are allowed to stay single.
 */
export function calmShades(sp, passes = 1) {
  for (let pass = 0; pass < passes; pass++) {
    const snap = sp.clone();
    for (let y = 0; y < sp.h; y++)
      for (let x = 0; x < sp.w; x++) {
        const s = snap.at(x, y);
        if (!s || s === SLOT.ink || protectedSlot(s)) continue;
        const sh = snap.shadeAt(x, y);
        if ((s === SLOT.metal || s === SLOT.armor || s === SLOT.trim) && sh >= 4) continue;
        const nb = N4.filter(([dx, dy]) => snap.at(x + dx, y + dy) === s).map(([dx, dy]) =>
          snap.shadeAt(x + dx, y + dy),
        );
        if (nb.length < 3 || nb.includes(sh)) continue;
        const count = {};
        for (const v of nb) count[v] = (count[v] || 0) + 1;
        const top = +Object.entries(count).sort(
          (a, b) => b[1] - a[1] || Math.abs(a[0] - sh) - Math.abs(b[0] - sh),
        )[0][0];
        sp.shade[y * sp.w + x] = top;
      }
  }
}

/**
 * Pixel-perfect line work: in 1-px lines of `slot`, the inner pixel of an L-shaped
 * step ("double") is replaced by the surrounding fill, keeping 8-connectivity.
 */
export function pixelPerfect(sp, slot = SLOT.ink) {
  const snap = sp.clone();
  const is = (x, y) => snap.at(x, y) === slot;
  let changed = 0;
  for (let y = 0; y < sp.h; y++)
    for (let x = 0; x < sp.w; x++) {
      if (!is(x, y)) continue;
      const n4 = N4.filter(([dx, dy]) => is(x + dx, y + dy));
      if (n4.length !== 2) continue;
      const [[ax, ay], [bx, by]] = n4;
      if (ax === -bx && ay === -by) continue; // straight run
      // L corner: the two arms continue diagonally through each other's neighbours
      const diag = is(x + ax + bx, y + ay + by);
      if (diag) continue; // a filled 2x2 block, not a line corner
      const aCont = N8.filter(([dx, dy]) => is(x + ax + dx, y + ay + dy)).length;
      const bCont = N8.filter(([dx, dy]) => is(x + bx + dx, y + by + dy)).length;
      if (aCont < 2 || bCont < 2) continue; // an endpoint, not a staircase corner
      // replace by the most common non-line neighbour
      const count = new Map();
      for (const [dx, dy] of N8) {
        const t = snap.at(x + dx, y + dy);
        if (t && t !== slot) count.set(t, (count.get(t) || 0) + 1);
      }
      if (!count.size) continue;
      const [top] = [...count.entries()].sort((p, q) => q[1] - p[1] || p[0] - q[0])[0];
      const nb = N8.map(([dx, dy]) => [x + dx, y + dy]).find(([X, Y]) => snap.at(X, Y) === top);
      sp.set(x, y, top, snap.shadeAt(nb[0], nb[1]));
      changed++;
    }
  return changed;
}

/**
 * Consistent upper-left key light on the silhouette: fill pixels whose top or left
 * neighbour is outside step up one shade (lit rim), those whose bottom or right
 * neighbour is outside step down one (core shadow). Skin, eyes and line work keep
 * their authored values; applied to cloth, leather, armour and mounts.
 */
export function keyLight(sp, { rim = 1, core = 1 } = {}) {
  const snap = sp.clone();
  const lit = new Set([
    SLOT.main,
    SLOT.sub,
    SLOT.leather,
    SLOT.armor,
    SLOT.linen,
    SLOT.mount,
    SLOT.accent,
    SLOT.hair,
  ]);
  for (let y = 0; y < sp.h; y++)
    for (let x = 0; x < sp.w; x++) {
      const s = snap.at(x, y);
      if (!lit.has(s)) continue;
      const i = y * sp.w + x;
      const up = !snap.at(x, y - 1),
        left = !snap.at(x - 1, y),
        down = !snap.at(x, y + 1),
        right = !snap.at(x + 1, y);
      let v = snap.shade[i];
      if ((up || left) && !(down || right)) v = Math.min(4, v + rim);
      else if ((down || right) && !(up || left)) v = Math.max(0, v - core);
      sp.shade[i] = v;
    }
}

/** Make sure a face has eyes: mark target pixels for the given native eye centroids. */
export function ensureEyes(sp, points) {
  for (const [x, y, tall] of points) {
    const X = Math.floor(x),
      Y = Math.floor(y);
    if (!sp.at(X, Y)) continue;
    const near = N8.some(([dx, dy]) => sp.at(X + dx, Y + dy) === SLOT.eye);
    if (sp.at(X, Y) !== SLOT.eye && !near) sp.set(X, Y, SLOT.eye, 0);
    // anime-style eyes read as a 1x2 dark stroke at this size
    if (
      tall &&
      sp.at(X, Y) === SLOT.eye &&
      sp.at(X, Y + 1) === SLOT.skin &&
      sp.at(X, Y - 1) !== SLOT.eye
    )
      sp.set(X, Y + 1, SLOT.eye, 0);
  }
}

/**
 * Specks: 4-connected components of at most `maxSize` pixels of a slot, surrounded by
 * other material, are absorbed by their most common neighbour (confetti left by
 * straps, seams and trims too small for the map size). Eyes, weapon lines, glow and
 * line work are kept; so are specks that continue diagonally into a same-slot line.
 */
export function removeSpecks(sp, maxSize = 2) {
  const seen = new Uint8Array(sp.w * sp.h);
  let changed = 0;
  for (let i = 0; i < sp.w * sp.h; i++) {
    const s = sp.slot[i];
    if (!s || seen[i] || protectedSlot(s) || WEAPON_SLOTS.has(s) || s === SLOT.ink) continue;
    const comp = [i];
    seen[i] = 1;
    for (let k = 0; k < comp.length && comp.length <= maxSize; k++) {
      const x = comp[k] % sp.w,
        y = (comp[k] / sp.w) | 0;
      for (const [dx, dy] of N4) {
        const X = x + dx,
          Y = y + dy;
        if (!sp.inside(X, Y)) continue;
        const j = Y * sp.w + X;
        if (!seen[j] && sp.slot[j] === s) {
          seen[j] = 1;
          comp.push(j);
        }
      }
    }
    if (comp.length > maxSize) continue;
    const inComp = new Set(comp);
    let diagonal = 0;
    const count = new Map();
    for (const c of comp) {
      const x = c % sp.w,
        y = (c / sp.w) | 0;
      for (const [dx, dy] of N8) {
        const X = x + dx,
          Y = y + dy;
        if (!sp.inside(X, Y)) continue;
        const j = Y * sp.w + X;
        if (inComp.has(j)) continue;
        const t = sp.slot[j];
        if (t === s) diagonal++;
        else if (t && t !== SLOT.ink) count.set(t, (count.get(t) || 0) + 1);
      }
    }
    if (diagonal || !count.size) continue;
    const [top] = [...count.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0];
    let shade = 2;
    for (const c of comp) {
      const x = c % sp.w,
        y = (c / sp.w) | 0;
      const nb = N8.map(([dx, dy]) => [x + dx, y + dy]).find(([X, Y]) => sp.at(X, Y) === top);
      if (nb) {
        shade = sp.shadeAt(nb[0], nb[1]);
        break;
      }
    }
    for (const c of comp) sp.set(c % sp.w, (c / sp.w) | 0, top, shade);
    changed++;
  }
  return changed;
}

/**
 * Eyes at map size are a 1x2 dark stroke per eye. Larger reduced eye blobs (under-bang
 * shadows, lashes) keep only their lower facing-side stroke; the rest returns to the
 * hair above or the skin around it, so the face reads as a face, not a mask.
 */
export function tidyEyes(sp, { facing = 1, maxEyes = 2 } = {}) {
  const seen = new Uint8Array(sp.w * sp.h);
  const comps = [];
  for (let i = 0; i < sp.w * sp.h; i++) {
    if (sp.slot[i] !== SLOT.eye || seen[i]) continue;
    const comp = [i];
    seen[i] = 1;
    for (let k = 0; k < comp.length; k++) {
      const x = comp[k] % sp.w,
        y = (comp[k] / sp.w) | 0;
      for (const [dx, dy] of N8) {
        const X = x + dx,
          Y = y + dy;
        if (!sp.inside(X, Y)) continue;
        const j = Y * sp.w + X;
        if (!seen[j] && sp.slot[j] === SLOT.eye) {
          seen[j] = 1;
          comp.push(j);
        }
      }
    }
    comps.push(comp);
  }
  // biggest comps first; extra comps beyond maxEyes dissolve too
  comps.sort((a, b) => b.length - a.length);
  const keep = new Set();
  comps.forEach((comp, n) => {
    if (n >= maxEyes) return;
    let anchor = comp[0];
    for (const i of comp) {
      const y = (i / sp.w) | 0,
        ay = (anchor / sp.w) | 0;
      const x = i % sp.w,
        ax = anchor % sp.w;
      if (y > ay || (y === ay && (facing > 0 ? x > ax : x < ax))) anchor = i;
    }
    keep.add(anchor);
    if (comp.includes(anchor - sp.w)) keep.add(anchor - sp.w);
  });
  for (const comp of comps)
    for (const i of comp) {
      if (keep.has(i)) continue;
      const x = i % sp.w,
        y = (i / sp.w) | 0;
      const above = sp.at(x, y - 1);
      let to = SLOT.skin,
        shade = 3;
      if (above === SLOT.hair || above === SLOT.ink) {
        to = SLOT.hair;
        shade = 1;
      } else {
        const nb = N4.map(([dx, dy]) => [x + dx, y + dy]).find(
          ([X, Y]) => sp.at(X, Y) === SLOT.skin,
        );
        if (nb) shade = sp.shadeAt(nb[0], nb[1]);
      }
      sp.set(x, y, to, shade);
    }
}

/**
 * Face read: after tidyEyes, an eye must sit in skin (a dark stroke with skin on at
 * least two sides). If the reduction left none — bangs and lid shadow merged into
 * the hair — stamp the map-sprite convention for a right-facing 3/4 face: the near
 * eye as a 1x2 stroke about 60% across the face, a row below the hairline; the far eye
 * two pixels behind it when the face is wide enough. `box` = target head box.
 */
export function stampEyes(sp, box, { facing = 1 } = {}) {
  const [x0, y0, x1, y1] = box.map(Math.round);
  const inBox = (x, y) => x >= x0 && x < x1 && y >= y0 && y < y1;
  const skinSides = (x, y) => N4.filter(([dx, dy]) => sp.at(x + dx, y + dy) === SLOT.skin).length;
  let good = 0;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      if (sp.at(x, y) !== SLOT.eye) continue;
      if (skinSides(x, y) >= 2 || (skinSides(x, y) >= 1 && sp.at(x, y + 1) === SLOT.eye)) good++;
    }
  if (good) return false;
  // largest skin run in the head box = the face
  let fx0 = Infinity,
    fy0 = Infinity,
    fx1 = -1,
    fy1 = -1;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (sp.at(x, y) === SLOT.skin) {
        fx0 = Math.min(fx0, x);
        fx1 = Math.max(fx1, x);
        fy0 = Math.min(fy0, y);
        fy1 = Math.max(fy1, y);
      }
  if (fx1 < 0) return false;
  const fw = fx1 - fx0 + 1,
    fh = fy1 - fy0 + 1;
  if (fw < 2 || fh < 2) return false;
  const row = fy0 + Math.max(0, Math.round(fh * 0.2));
  const col = facing > 0 ? fx0 + Math.round((fw - 1) * 0.6) : fx1 - Math.round((fw - 1) * 0.6);
  const place = (x, y) => {
    if (sp.at(x, y) === SLOT.skin && inBox(x, y)) sp.set(x, y, SLOT.eye, 0);
  };
  // find the first skin pixel at/below the target row in that column
  for (let y = row; y <= fy1; y++)
    if (sp.at(col, y) === SLOT.skin) {
      place(col, y);
      if (fh >= 5 && sp.at(col, y + 1) === SLOT.skin && y + 1 < fy1) place(col, y + 1);
      if (fw >= 6) place(col - 2 * facing, y);
      return true;
    }
  return false;
}

/**
 * Art direction on a traced design: shorten the longest blade to `keep` of its length
 * (measured from the hilt, the end nearer the body) and taper the new tip to one pixel.
 * Used where the owner asked for a sword brought in (base Edric).
 */
export function shortenBlade(sp, keep = 0.8) {
  const pts = [];
  for (let i = 0; i < sp.w * sp.h; i++)
    if (sp.slot[i] === SLOT.metal) pts.push([i % sp.w, (i / sp.w) | 0]);
  if (pts.length < 6) return false;
  const mx = pts.reduce((a, p) => a + p[0], 0) / pts.length,
    my = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  let ux = Math.cos(ang),
    uy = Math.sin(ang);
  // orient the axis from the hilt (closer to the body centre) to the tip
  const body = sp.bounds((s) => !WEAPON_SLOTS.has(s));
  const bcx = body.x + body.width / 2,
    bcy = body.y + body.height / 2;
  if ((mx - bcx) * ux + (my - bcy) * uy < 0) {
    ux = -ux;
    uy = -uy;
  }
  const proj = pts.map(([x, y]) => (x - mx) * ux + (y - my) * uy);
  const lo = Math.min(...proj),
    hi = Math.max(...proj);
  const cut = lo + (hi - lo) * keep;
  pts.forEach(([x, y], k) => {
    const t = proj[k];
    const perp = Math.abs(-(x - mx) * uy + (y - my) * ux);
    if (t > cut) sp.set(x, y, SLOT.empty, 0);
    else if (t > cut - 2 && perp > 0.75) sp.set(x, y, SLOT.empty, 0); // taper the tip
  });
  return true;
}

/** Recolour a slot to another material (e.g. mute a lord's gold trim to leather). */
export function remapSlot(sp, from, to, shadeShift = 0) {
  for (let i = 0; i < sp.w * sp.h; i++)
    if (sp.slot[i] === from) {
      sp.slot[i] = to;
      sp.shade[i] = Math.max(0, Math.min(4, sp.shade[i] + shadeShift));
    }
}

/**
 * Face read at map size: inside the face, dark line work (lash lines, brow and
 * bang-shadow outlines) merges with the eyes into a mask. Lines with skin on two or
 * more sides become the skin's shadow step; lines under the hair become hair shadow.
 * Eyes stay the darkest thing on the face. `box` = target head box.
 */
export function clearFace(sp, box) {
  const [x0, y0, x1, y1] = box.map(Math.round);
  let fx0 = Infinity,
    fy0 = Infinity,
    fx1 = -1,
    fy1 = -1;
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++)
      if (sp.at(x, y) === SLOT.skin) {
        fx0 = Math.min(fx0, x);
        fx1 = Math.max(fx1, x);
        fy0 = Math.min(fy0, y);
        fy1 = Math.max(fy1, y);
      }
  if (fx1 < 0) return 0;
  const snap = sp.clone();
  let n = 0;
  for (let y = fy0 - 1; y <= fy1; y++)
    for (let x = fx0; x <= fx1; x++) {
      if (snap.at(x, y) !== SLOT.ink) continue;
      if (N4.some(([dx, dy]) => !snap.at(x + dx, y + dy))) continue; // silhouette edge
      const skin = N4.filter(([dx, dy]) => snap.at(x + dx, y + dy) === SLOT.skin).length;
      const hairAbove = snap.at(x, y - 1) === SLOT.hair;
      if (skin >= 2) sp.set(x, y, SLOT.skin, 1);
      else if (hairAbove) sp.set(x, y, SLOT.hair, 0);
      else continue;
      n++;
    }
  return n;
}

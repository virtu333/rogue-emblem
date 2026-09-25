// Motion on the indexed sprite (before colour, so outline and light are regenerated for
// every frame). Frames are key poses built from the material slots, not whole-sprite
// warps:
//
//   idle0..3  rest; breath (torso settles a pixel, the head a frame later); hair,
//             cape hems and loose cloth trail a pixel behind on the back edge; mounts
//             bob their head and beat their wings; the feet never move.
//   windup    anticipation by weapon type: the blade or axe cocked up behind the
//             shoulder, the lance drawn back level, the bowstring drawn to the cheek
//             with an arrow nocked, the tome or staff raised; the body leans back.
//   strike    the follow-through: sword swept down-forward, lance thrust level and
//             long, axe brought down in front, arrow loosed (string snapped back),
//             tome thrust forward with its light flaring; the upper body lunges.
//
// Weapons are moved as rigid parts about the hand that holds them (rotation by inverse
// nearest mapping of the weapon's own pixels), so the drawn blade/shaft keeps its
// pixels. Riders pose above the saddle; their mount stays planted. Pure.
import { IndexedSprite } from './indexed.mjs';
import { SLOT, WEAPON_SLOTS } from './slots.mjs';

const MOUNT_SLOTS = new Set([SLOT.mount, SLOT.mane]);
const CLOTH_SLOTS = new Set([SLOT.main, SLOT.accent, SLOT.sub, SLOT.linen]);
const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Estimate the waist row: where the legs start (widest gap between two leg columns), else 58% of the body. */
export function waistRow(sp, bodyBounds) {
  const b = bodyBounds;
  // scan up from the feet for the first row where the silhouette is a single run
  // (legs apart -> two runs; hips -> one run)
  let row = Math.round(b.y + b.height * 0.58);
  for (let y = b.y + b.height - 2; y > b.y + b.height * 0.45; y--) {
    let runs = 0,
      inRun = false;
    for (let x = b.x; x < b.x + b.width; x++) {
      const s = sp.at(x, y);
      const on = !!s && !WEAPON_SLOTS.has(s);
      if (on && !inRun) runs++;
      inRun = on;
    }
    if (runs <= 1) {
      row = y;
      break;
    }
  }
  return Math.min(row, Math.round(b.y + b.height * 0.66));
}

/**
 * Anatomy of a placed sprite: body bounds (no weapon, no mount), the row the upper
 * body moves above (waist, or the saddle for riders), the head top, the body's centre
 * column, and whether it is a rider.
 */
export function anatomy(sp) {
  const mountPx = sp.bounds((s) => MOUNT_SLOTS.has(s));
  const body =
    sp.bounds((s) => !WEAPON_SLOTS.has(s) && !MOUNT_SLOTS.has(s)) ||
    sp.bounds((s) => !WEAPON_SLOTS.has(s)) ||
    sp.bounds();
  let waist;
  const rider = !!mountPx && mountPx.width * mountPx.height > body.width * body.height * 0.25;
  if (rider) {
    // the rider's hips: a little under halfway from the head to the hooves (a wing or
    // a raised head makes the mount's own top edge useless as a saddle line)
    const top = Math.min(body.y, mountPx.y);
    waist = Math.round(top + (mountPx.y + mountPx.height - top) * 0.45);
  } else waist = waistRow(sp, body);
  return { body, waist, rider, mount: mountPx, cx: body.x + body.width / 2 };
}

/**
 * Move pixels selected by `pick(x, y, slot)` by (dx(y), dy); returns a new sprite.
 * Moved pixels are drawn over the unmoved ones; vacated pixels become empty.
 */
function shift(sp, pick, dxOf, dy) {
  const out = new IndexedSprite(sp.w, sp.h);
  out.meta = sp.meta;
  const moved = [];
  for (let y = 0; y < sp.h; y++)
    for (let x = 0; x < sp.w; x++) {
      const i = y * sp.w + x;
      const s = sp.slot[i];
      if (!s) continue;
      if (pick(x, y, s)) moved.push([x + dxOf(y), y + dy, s, sp.shade[i]]);
      else out.set(x, y, s, sp.shade[i]);
    }
  for (const [x, y, s, sh] of moved) out.set(x, y, s, sh);
  return out;
}

/** Vacated upper-body seams: a hole with filled pixels above and below takes the one below. */
function mendSeams(sp, fromY, toY) {
  for (let y = fromY; y <= toY; y++)
    for (let x = 1; x < sp.w - 1; x++) {
      if (sp.at(x, y)) continue;
      const up = sp.at(x, y - 1),
        down = sp.at(x, y + 1);
      if (up && down && sp.at(x - 1, y) && sp.at(x + 1, y))
        sp.set(x, y, down, sp.shadeAt(x, y + 1));
    }
  return sp;
}

/**
 * Trailing edge: on rows `rows`, the back-most run of `slots` grows one pixel further
 * back (hair and cape hems lag behind the body). Additive — nothing is vacated.
 */
function trail(sp, slots, rows, facing = 1, amount = 1) {
  const out = sp.clone();
  for (const y of rows) {
    let edge = -1;
    if (facing > 0) {
      for (let x = 0; x < sp.w; x++)
        if (sp.at(x, y)) {
          edge = x;
          break;
        }
    } else
      for (let x = sp.w - 1; x >= 0; x--)
        if (sp.at(x, y)) {
          edge = x;
          break;
        }
    if (edge < 0 || !slots.has(sp.at(edge, y))) continue;
    for (let k = 1; k <= amount; k++)
      out.set(edge - k * facing, y, sp.at(edge, y), Math.max(0, sp.shadeAt(edge, y) - 1));
  }
  return out;
}

/**
 * Wing beat without seams: the top edge of the picked region grows a pixel (dir -1, the
 * wing lifts) or loses its top row (dir 1, the wing drops). Nothing else moves.
 */
function beat(sp, pick, dir) {
  const out = sp.clone();
  for (let y = 0; y < sp.h; y++)
    for (let x = 0; x < sp.w; x++) {
      const s = sp.at(x, y);
      if (!s || !pick(x, y, s) || sp.at(x, y - 1)) continue;
      if (dir < 0) out.set(x, y - 1, s, Math.min(4, sp.shadeAt(x, y) + 1));
      else if (sp.at(x, y + 1)) out.set(x, y, 0, 0);
    }
  return out;
}

const range = (a, b) => Array.from({ length: Math.max(0, b - a) }, (_, i) => a + i);

/**
 * Four idle frames: rest; breath in (torso settles a pixel, head and hair follow a frame
 * later); hold (hair and cape hems trail a pixel behind); breath out. Mounts bob their
 * head and beat their wings a pixel. The legs and feet never move.
 */
export function idleFrames(sp, { facing = 1 } = {}) {
  const a = anatomy(sp);
  const b = a.body;
  const head = b.y + Math.round(b.height * (a.rider ? 0.3 : 0.2));
  const upper = (x, y, s) => y < a.waist && !MOUNT_SLOTS.has(s);
  const torso = (x, y, s) => upper(x, y, s) && y >= head;
  // loose hair on the back of the head, and cloth hems on the back edge below the chest
  const hairRows = range(b.y, Math.round(b.y + b.height * 0.45));
  const hemRows = range(Math.round(b.y + b.height * 0.35), Math.round(b.y + b.height * 0.9));
  const hair = new Set([SLOT.hair]);
  // mount parts: the head (front top quarter), the wings (the top back half of a flyer)
  const m = a.mount;
  const mountHead = m
    ? (x, y, s) =>
        MOUNT_SLOTS.has(s) &&
        y < m.y + m.height * 0.45 &&
        (facing > 0 ? x > m.x + m.width * 0.66 : x < m.x + m.width * 0.34)
    : null;
  const wing = m
    ? (x, y, s) =>
        MOUNT_SLOTS.has(s) &&
        y < m.y + m.height * 0.5 &&
        (facing > 0 ? x < m.x + m.width * 0.5 : x > m.x + m.width * 0.5)
    : null;

  const f0 = sp.clone();
  // 1: breath in — the torso (arms, weapon) settles; the head waits a frame
  let f1 = mendSeams(
    shift(sp, torso, () => 0, 1),
    head,
    a.waist,
  );
  if (mountHead) f1 = beat(f1, mountHead, 1);
  if (wing) f1 = beat(f1, wing, -1);
  // 2: hold — the head settles too; hair and hems trail
  let f2 = mendSeams(
    shift(sp, upper, () => 0, 1),
    b.y,
    a.waist,
  );
  f2 = trail(f2, hair, hairRows, facing);
  f2 = trail(f2, CLOTH_SLOTS, hemRows, facing);
  if (mountHead) f2 = beat(f2, mountHead, 1);
  // 3: breath out — body back up, hair and hems still trailing, wings down
  let f3 = trail(sp, hair, hairRows, facing);
  f3 = trail(f3, CLOTH_SLOTS, hemRows, facing);
  if (wing) f3 = beat(f3, wing, 1);
  return [f0, f1, f2, f3];
}

// --- weapons --------------------------------------------------------------------------

/** Chessboard distance of every filled pixel to the nearest empty one (0 = empty). */
function distanceToEdge(sp) {
  const n = sp.w * sp.h;
  const d = new Int16Array(n).fill(0);
  const big = 999;
  for (let i = 0; i < n; i++) d[i] = sp.slot[i] ? big : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= sp.w || y >= sp.h ? 0 : d[y * sp.w + x]);
  for (let y = 0; y < sp.h; y++)
    for (let x = 0; x < sp.w; x++) {
      const i = y * sp.w + x;
      if (!d[i]) continue;
      d[i] = Math.min(
        d[i],
        at(x - 1, y) + 1,
        at(x, y - 1) + 1,
        at(x - 1, y - 1) + 1,
        at(x + 1, y - 1) + 1,
      );
    }
  for (let y = sp.h - 1; y >= 0; y--)
    for (let x = sp.w - 1; x >= 0; x--) {
      const i = y * sp.w + x;
      if (!d[i]) continue;
      d[i] = Math.min(
        d[i],
        at(x + 1, y) + 1,
        at(x, y + 1) + 1,
        at(x + 1, y + 1) + 1,
        at(x - 1, y + 1) + 1,
      );
    }
  return d;
}

/** 8-connected components of the pixels `pick` selects: arrays of indices. */
function components(sp, pick) {
  const seen = new Uint8Array(sp.w * sp.h);
  const out = [];
  for (let i = 0; i < sp.w * sp.h; i++) {
    if (seen[i] || !sp.slot[i] || !pick(i)) continue;
    const comp = [i];
    seen[i] = 1;
    for (let k = 0; k < comp.length; k++) {
      const x = comp[k] % sp.w,
        y = (comp[k] / sp.w) | 0;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx,
            Y = y + dy;
          if (!sp.inside(X, Y)) continue;
          const j = Y * sp.w + X;
          if (!seen[j] && sp.slot[j] && pick(j)) {
            seen[j] = 1;
            comp.push(j);
          }
        }
    }
    out.push(comp);
  }
  return out;
}

/** Principal axis of a pixel set: centre, unit axis, extent along it. */
function axisOf(sp, idx) {
  const P = idx.map((i) => [i % sp.w, (i / sp.w) | 0]);
  const mx = P.reduce((t, p) => t + p[0], 0) / P.length,
    my = P.reduce((t, p) => t + p[1], 0) / P.length;
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (const [x, y] of P) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  const ang = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(ang),
    uy = Math.sin(ang);
  const proj = P.map(([x, y]) => (x - mx) * ux + (y - my) * uy);
  return { mx, my, ux, uy, lo: Math.min(...proj), hi: Math.max(...proj) };
}

/** The body mass: large thick regions (torso, shield, a mount), grown by `grow` px. */
function bodyZone(sp, grow = 2) {
  const d = distanceToEdge(sp);
  const thick = components(sp, (i) => d[i] >= 3);
  const big = Math.max(0, ...thick.map((c) => c.length));
  const zone = new Uint8Array(sp.w * sp.h);
  for (const c of thick) {
    // an axe head or a gauntlet is thick too, but small next to the torso
    if (c.length < big * 0.25) continue;
    for (const i of c) {
      const x = i % sp.w,
        y = (i / sp.w) | 0;
      for (let dy = -grow; dy <= grow; dy++)
        for (let dx = -grow; dx <= grow; dx++)
          if (sp.inside(x + dx, y + dy)) zone[(y + dy) * sp.w + x + dx] = 1;
    }
  }
  return zone;
}

const NOT_WEAPON = new Set([SLOT.skin, SLOT.hair, SLOT.eye, SLOT.mount, SLOT.mane]);
// a blade drawn near-white reads as linen; it still counts as steel for finding weapons
const BLADE_LIKE = new Set([SLOT.metal, SLOT.linen, SLOT.glow]);
// what a blade or an axe head carries beyond steel: its outline and a gilt guard
const HILT = new Set([SLOT.ink, SLOT.trim]);

/**
 * Pixels of the drawn weapon, found by shape as much as by material (segmentation calls
 * a brown bow leather and a lance's steel tip armour on plated designs): candidates are
 * weapon materials anywhere plus anything that sticks out of the body mass (never skin,
 * hair or the mount); the seed is the longest elongated candidate (weapon materials
 * count extra; nothing below the waist unless it is weapon material). The seed is
 * followed along its axis through the thin line it continues as (a shaft behind the
 * hand), and whatever hangs off it outside the body mass joins it (pennant, axe head,
 * bowstring). The body mass keeps hands, gauntlets and the shield.
 */
function weaponPixels(sp, a, { type = 'sword', hint = null } = {}) {
  const zone = bodyZone(sp);
  const cand = (i) => {
    const s = sp.slot[i];
    if (!s || NOT_WEAPON.has(s)) return false;
    if (WEAPON_SLOTS.has(s)) return true;
    if (zone[i]) return false;
    // below the waist only blade-like materials (a sword held low, a white blade)
    return ((i / sp.w) | 0) < a.waist || BLADE_LIKE.has(s);
  };
  const SHAFT = new Set([SLOT.wood, SLOT.metal, SLOT.leather]);
  const shafted = type === 'lance' || type === 'staff' || type === 'bow';
  // follow a line out of both ends: a band of +-1 outside the body mass; inside it only
  // shaft materials, or the exact axis pixel in dark line work or cloth (a lance shaft
  // painted in the faction colour crossing the mount's neck)
  const follow = (ax, band = [0, -1, 1]) => {
    const found = [];
    for (const dir of [-1, 1]) {
      const end = dir > 0 ? ax.hi : ax.lo;
      let miss = 0;
      for (let t = end + dir; Math.abs(t) < sp.w + sp.h; t += dir) {
        const cx = ax.mx + ax.ux * t,
          cy = ax.my + ax.uy * t;
        let hit = 0;
        for (const o of band) {
          const x = Math.round(cx - ax.uy * o),
            y = Math.round(cy + ax.ux * o);
          if (!sp.inside(x, y)) continue;
          const i = y * sp.w + x;
          const sl = sp.slot[i];
          if (!sl || NOT_WEAPON.has(sl)) continue;
          const lineWork = sl === SLOT.sub || sl === SLOT.ink || sl === SLOT.main;
          // a blade ends at the hand; only a shaft (lance, staff) runs on through the body
          if (zone[i] && !shafted) continue;
          // a blade runs on only in steel, its outline and a guard (cloth, or a limb or a
          // boot in line with it, is not more blade)
          if (
            !shafted &&
            !BLADE_LIKE.has(sl) &&
            !WEAPON_SLOTS.has(sl) &&
            !(Math.abs(o) <= 1 && (sl === SLOT.ink || sl === SLOT.trim))
          )
            continue;
          // ... but not down through the legs or the saddle (they stay planted, and a leg's
          // own outline would read as the shaft's continuation)
          if (zone[i] && y >= a.waist) continue;
          // (the line-work exception is a rider's shaft across the mount; on a standing
          // figure it would run up a cape or hood outline)
          if (zone[i] && !SHAFT.has(sl) && !(o === 0 && lineWork && a.rider)) continue;
          if (Math.abs(o) > 1 && !SHAFT.has(sl)) continue;
          found.push(i);
          hit++;
        }
        if (!hit && ++miss > 2) break;
        if (hit) miss = 0;
      }
    }
    return found;
  };
  // the line to follow: the blade / head when it is a clear line of its own (a pennant
  // or an axe head would tilt the seed's axis off the shaft), else the seed
  const lineOf = (c) => {
    const metal = c.filter((i) => sp.slot[i] === SLOT.metal);
    let ax = axisOf(sp, c);
    if (metal.length >= 3) {
      const m = axisOf(sp, metal);
      if (m.hi - m.lo + 1 >= 5 && (m.hi - m.lo + 1) ** 2 / metal.length >= 2) ax = m;
    }
    const first = follow(ax);
    return { ax, metal, first, all: [...new Set([...c, ...first])] };
  };
  // candidates are scored on the line they grow into: long, straight, thin, weapon
  // material; a mount's leg or a cape edge is thicker and hangs below a rider's hips
  const faceBottom = a.body.y + a.body.height * (a.rider ? 0.3 : 0.22);
  const pickFrom = (comps) => {
    let seed = null,
      grown = null,
      best = 0;
    for (const c of comps) {
      if (c.length < 2) continue;
      const metalN = c.filter(
        (i) => WEAPON_SLOTS.has(sp.slot[i]) || (sp.slot[i] === SLOT.linen && type !== 'bow'),
      ).length;
      const own = axisOf(sp, c);
      const ownExtent = own.hi - own.lo + 1;
      if (ownExtent < 5 && metalN < 2) continue;
      const g = lineOf(c);
      // judge the line on what shows: pixels outside the body mass, and weapon materials
      // (a strap or a seam through the torso is neither)
      const shown = g.all.filter((i) => !zone[i] || WEAPON_SLOTS.has(sp.slot[i]));
      if (shown.length < 4) continue;
      const ax = axisOf(sp, shown);
      const extent = ax.hi - ax.lo + 1;
      const width = shown.length / extent;
      if (extent < 6 || extent / width < 2.2) continue;
      const cy = c.reduce((t, i) => t + ((i / sp.w) | 0), 0) / c.length;
      // a weapon sticks out of the body and is held: a hand (skin below the face, or a
      // glove) touches it
      const outside = g.all.filter((i) => !zone[i]).length / g.all.length;
      const inLine = new Set(g.all);
      let hand = 0;
      const touched = new Set();
      for (const i of g.all) {
        const x = i % sp.w,
          y = (i / sp.w) | 0;
        // the fist can sit a pixel or two from the blade (a guard or hilt between)
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const j = (y + dy) * sp.w + x + dx;
            if (inLine.has(j) || touched.has(j) || y + dy <= faceBottom) continue;
            const t = sp.at(x + dx, y + dy);
            if (t === SLOT.skin) hand += 1;
            else if (t === SLOT.leather || t === SLOT.armor) hand += 0.25;
            else continue;
            touched.add(j);
          }
      }
      // legs reach the ground; weapons rarely do
      // (a blade held low at the side may reach that far: a line of steel is exempt)
      const steel =
        g.all.filter((i) => sp.slot[i] === SLOT.metal || sp.slot[i] === SLOT.glow).length /
        g.all.length;
      const feet =
        steel < 0.5 && g.all.some((i) => ((i / sp.w) | 0) >= a.body.y + a.body.height - 4);
      // blades and shafts are thin; an axe head, a tome or a bow's curve may be wide
      const thin = type === 'sword' || type === 'lance' ? Math.min(1, 3 / width) : 1;
      // a roster hint (normalised point on the figure) settles designs the shape rules miss
      let near = 1;
      if (hint) {
        const hb = sp.bounds();
        const hx = hb.x + hint[0] * hb.width,
          hy = hb.y + hint[1] * hb.height;
        near = g.all.some((i) => Math.hypot((i % sp.w) - hx, ((i / sp.w) | 0) - hy) <= 3) ? 4 : 0.5;
      }
      // an axe has a head (a metal mass); a bow and a staff are wood, not metal
      const material =
        type === 'axe'
          ? metalN >= 6
            ? 1.5
            : 0.6
          : type === 'bow' || type === 'staff'
            ? metalN > 4
              ? 0.8
              : 1.2
            : metalN
              ? 1.5
              : 1;
      const score =
        extent *
        material *
        thin *
        Math.min(1, width / 0.95) *
        (0.3 + 0.7 * outside) *
        (hand >= 1 ? 2 : 1) *
        (a.rider && cy > a.waist ? 0.3 : 1) *
        // (a rider's leg runs down the mount's to the ground as one line too)
        (feet ? 0.3 : 1) *
        near;
      if (score > best) {
        best = score;
        seed = c;
        grown = g;
      }
    }
    return seed ? { seed, grown, best } : null;
  };
  // blades first (steel, or a near-white blade outside the body): a sword touching a cape
  // must not become one piece with it; the shape search runs when no blade reads well
  const blades =
    type === 'bow' || type === 'tome' || type === 'axe'
      ? []
      : components(sp, (i) => {
          const sl = sp.slot[i];
          // (a rider's white mount is linen too)
          return WEAPON_SLOTS.has(sl) || (sl === SLOT.linen && !zone[i] && !a.rider);
        });
  let pick = pickFrom(blades);
  if (!pick || pick.best < 12) {
    const shape = pickFrom(components(sp, cand));
    if (shape && (!pick || shape.best > pick.best * 1.5)) pick = shape;
  }
  if (!pick) return null;
  const { seed, grown } = pick;
  const set = new Set(seed);
  const { ax, metal, first } = grown;
  const perp = (x, y) => Math.abs(-(x - ax.mx) * ax.uy + (y - ax.my) * ax.ux);
  // other weapon-material pieces on the same line (blade and shaft split by the hand)
  for (const c of components(sp, (i) => WEAPON_SLOTS.has(sp.slot[i]))) {
    if (c.some((i) => set.has(i))) continue;
    // (a blade's line ends a few pixels past its own ends: a buckle further on is not it)
    const along = (i) => ((i % sp.w) - ax.mx) * ax.ux + (((i / sp.w) | 0) - ax.my) * ax.uy;
    const near = (i) => shafted || (along(i) >= ax.lo - 4 && along(i) <= ax.hi + 4);
    if (c.every((i) => perp(i % sp.w, (i / sp.w) | 0) <= 1.6 && near(i)))
      for (const i of c) set.add(i);
  }
  for (const i of first) set.add(i);
  // second pass along the axis refitted to what the first found, a wider shaft band
  const line = [...(metal.length >= 3 ? metal : seed), ...first];
  if (line.length >= 6) for (const i of follow(axisOf(sp, line), [0, -1, 1, -2, 2])) set.add(i);
  // attachments hanging off the weapon outside the body mass
  const stack = [...set];
  while (stack.length) {
    const i = stack.pop();
    const x = i % sp.w,
      y = (i / sp.w) | 0;
    for (const [dx, dy] of N4) {
      const X = x + dx,
        Y = y + dy;
      if (!sp.inside(X, Y)) continue;
      const j = Y * sp.w + X;
      if (set.has(j) || zone[j] || !sp.slot[j] || NOT_WEAPON.has(sp.slot[j])) continue;
      // a lance carries a pennant; a blade or an axe only its own head and hilt
      const t = sp.slot[j];
      if (!shafted && !BLADE_LIKE.has(t) && !WEAPON_SLOTS.has(t) && !HILT.has(t)) continue;
      set.add(j);
      stack.push(j);
    }
  }
  return [...set].sort((p, q) => p - q);
}

/**
 * The drawn weapon: its pixels, the hand (grip: the weapon pixel beside the most hand —
 * skin below the face, or glove / gauntlet — else the point nearest the body), the tip
 * (the end with the blade or head, else the end farther from the hand) and the angle
 * from grip to tip. null when no weapon can be found.
 */
export function weaponOf(sp, a = anatomy(sp), opts = {}) {
  let idx = weaponPixels(sp, a, opts);
  if (!idx || idx.length < 3) return null;
  // pieces the weapon cut off from the body (a pommel, the far end of a shaft past the
  // hand) are part of it: small islands of what is left, within two pixels of it
  {
    const cut = new Set(idx);
    const rest = components(sp, (i) => !cut.has(i));
    const main = Math.max(...rest.map((c) => c.length));
    for (const c of rest) {
      if (c.length === main || c.length > 12) continue;
      // (a fist left standing on its own is the hand, not a pommel)
      if (c.some((i) => sp.slot[i] === SLOT.skin)) continue;
      const near = c.some((i) => {
        const x = i % sp.w,
          y = (i / sp.w) | 0;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) if (cut.has((y + dy) * sp.w + x + dx)) return true;
        return false;
      });
      if (near) for (const i of c) cut.add(i);
    }
    idx = [...cut].sort((p, q) => p - q);
  }
  const pts = idx.map((i) => [i % sp.w, (i / sp.w) | 0, sp.slot[i], sp.shade[i]]);
  const inWeapon = new Set(idx);
  const ax = axisOf(sp, idx);
  const { mx, my, ux, uy, lo, hi } = ax;
  const faceBottom = a.body.y + a.body.height * (a.rider ? 0.3 : 0.22);
  let grip = null,
    best = 0;
  for (const [x, y] of pts) {
    let n = 0;
    // the fist can sit a pixel or two from the blade (a guard or hilt between)
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        if (inWeapon.has((y + dy) * sp.w + x + dx)) continue;
        const s = sp.at(x + dx, y + dy);
        if (s === SLOT.skin && y + dy > faceBottom) n += 2;
        else if ((s === SLOT.leather || s === SLOT.armor) && y + dy > faceBottom) n += 1;
      }
    if (n > best) {
      best = n;
      grip = [x, y];
    }
  }
  const endLo = [mx + ux * lo, my + uy * lo],
    endHi = [mx + ux * hi, my + uy * hi];
  if (!grip) {
    const d = (p) => Math.hypot(p[0] - a.cx, p[1] - (a.body.y + a.body.height * 0.45));
    grip = d(endLo) < d(endHi) ? endLo : endHi;
  }
  // the tip: the end whose last quarter holds the blade / head (metal), else the far end
  const len = hi - lo;
  const metalNear = (t0, t1) =>
    pts.filter(([x, y, sl]) => {
      const t = (x - mx) * ux + (y - my) * uy;
      return sl === SLOT.metal && t >= Math.min(t0, t1) && t <= Math.max(t0, t1);
    }).length;
  const mLo = metalNear(lo, lo + len * 0.25),
    mHi = metalNear(hi - len * 0.25, hi);
  const dist = (p) => Math.hypot(p[0] - grip[0], p[1] - grip[1]);
  let tip;
  if (mLo >= 2 && mLo >= mHi * 2) tip = endLo;
  else if (mHi >= 2 && mHi >= mLo * 2) tip = endHi;
  // a lance or staff at rest points its head up
  else if ((opts.type === 'lance' || opts.type === 'staff') && Math.abs(endLo[1] - endHi[1]) > 4)
    tip = endLo[1] < endHi[1] ? endLo : endHi;
  else tip = dist(endLo) > dist(endHi) ? endLo : endHi;
  // the hand is never on the head: a tip at the grip means the grip end was misread
  if (dist(tip) < len / 4) tip = tip === endLo ? endHi : endLo;
  return {
    pts,
    set: inWeapon,
    // a hand was found on it: it can be swung about the grip; otherwise it only rides along
    // held: a hand was found near it, or it at least touches the body (a hilt in a fist
    // the tracer drew as trim); a loose fragment is never swung
    held:
      best > 0 ||
      pts.some(([x, y]) =>
        N4.some(([dx, dy]) => {
          const t = sp.at(x + dx, y + dy);
          return t && !inWeapon.has((y + dy) * sp.w + x + dx) && !MOUNT_SLOTS.has(t);
        }),
      ),
    grip,
    tip,
    angle: Math.atan2(tip[1] - grip[1], tip[0] - grip[0]),
    length: len + 1,
  };
}

/** Remove the weapon pixels from a sprite (they are redrawn by placeWeapon). */
function withoutWeapon(sp, w) {
  const out = sp.clone();
  for (const i of w.set) out.slot[i] = 0;
  return mendHoles(out);
}

/** Holes left inside the body where a weapon crossed it take their neighbours' material. */
function mendHoles(sp) {
  const snap = sp.clone();
  for (let y = 1; y < sp.h - 1; y++)
    for (let x = 1; x < sp.w - 1; x++) {
      if (snap.at(x, y)) continue;
      const nb = N4.map(([dx, dy]) => [snap.at(x + dx, y + dy), snap.shadeAt(x + dx, y + dy)]);
      if (nb.filter(([s]) => s).length < 3) continue;
      const [s, v] = nb.find(([t]) => t && t !== SLOT.ink) || nb.find(([t]) => t);
      sp.set(x, y, s, v);
    }
  return sp;
}

/**
 * Draw the weapon rotated by `rot` about its grip and moved by (dx, dy): inverse nearest
 * mapping over the rotated bounds, so a line stays a continuous line. Weapon pixels are
 * drawn over the body (the hand holds it in front).
 */
export function placeWeapon(
  sp,
  w,
  { rot = 0, dx = 0, dy = 0, along = 0, stretch = false, outline = rot !== 0 } = {},
) {
  const out = sp.clone();
  const map = new Map(w.pts.map(([x, y, s, v]) => [`${x},${y}`, [s, v]]));
  const [gx, gy] = w.grip;
  const c = Math.cos(rot),
    s = Math.sin(rot);
  // translate along the (new) weapon axis as well (lance draw / thrust)
  const ax = Math.cos(w.angle + rot),
    ay = Math.sin(w.angle + rot);
  const ox = dx + ax * along,
    oy = dy + ay * along;
  // source-space axis (grip -> tip) for the stretch
  const ux = Math.cos(w.angle),
    uy = Math.sin(w.angle);
  // a thrust pushed past the hand stretches the shaft back to it rather than letting
  // the weapon float free: source positions between the grip and `along` sample the
  // shaft's cross-section at the grip
  const gap = stretch && along > 0 ? along : 0;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of w.pts) {
    const rx = gx + (x - gx) * c - (y - gy) * s + ox,
      ry = gy + (x - gx) * s + (y - gy) * c + oy;
    x0 = Math.min(x0, rx, rx - ax * gap);
    y0 = Math.min(y0, ry, ry - ay * gap);
    x1 = Math.max(x1, rx, rx - ax * gap);
    y1 = Math.max(y1, ry, ry - ay * gap);
  }
  const placed = new Set();
  const lookup = (sx, sy) => map.get(`${Math.round(sx)},${Math.round(sy)}`);
  for (let Y = Math.floor(y0) - 1; Y <= Math.ceil(y1) + 1; Y++)
    for (let X = Math.floor(x0) - 1; X <= Math.ceil(x1) + 1; X++) {
      // inverse: target -> source
      const tx = X - ox - gx,
        ty = Y - oy - gy;
      let sx = gx + tx * c + ty * s,
        sy = gy - tx * s + ty * c;
      let hit = lookup(sx, sy);
      if (!hit && gap) {
        // behind the moved grip, within the gap: the grip's cross-section
        const t = (sx - gx) * ux + (sy - gy) * uy;
        // only the shaft itself (within 1.5 px of the axis through the grip)
        const off = Math.abs((sx - gx) * -uy + (sy - gy) * ux);
        if (t < 0 && t >= -gap - 0.5 && off <= 1.5) {
          sx -= ux * t;
          sy -= uy * t;
          hit = lookup(sx, sy);
        }
      }
      if (hit) {
        out.set(X, Y, hit[0], hit[1]);
        placed.add(Y * out.w + X);
      }
    }
  // a weapon swung across the body is outlined where it lies over it, as a pixel artist
  // would draw it (steel over plate, a dark shaft over dark mail otherwise vanish)
  if (outline)
    for (const i of placed) {
      const x = i % out.w,
        y = (i / out.w) | 0;
      for (const [ddx, ddy] of N4) {
        const X = x + ddx,
          Y = y + ddy;
        if (!out.inside(X, Y) || placed.has(Y * out.w + X)) continue;
        const t = sp.at(X, Y);
        if (!t || t === SLOT.ink || t === SLOT.eye || t === SLOT.skin) continue;
        out.set(X, Y, SLOT.ink, 0);
      }
    }
  return out;
}

/** Tiny islands (<= 3 px) a rotation can leave floating are dropped. */
function dropSpecks(sp) {
  const comps = components(sp, () => true);
  const main = Math.max(0, ...comps.map((c) => c.length));
  for (const c of comps) if (c.length <= 3 && c.length < main) for (const i of c) sp.slot[i] = 0;
  return sp;
}

/** Angle difference that turns `from` to `to` the short way. */
const turn = (from, to) => {
  let d = to - from;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};

/** A short line of `slot` from (x0,y0) to (x1,y1) (Bresenham). */
function line(sp, x0, y0, x1, y1, slot, shade) {
  x0 = Math.round(x0);
  y0 = Math.round(y0);
  x1 = Math.round(x1);
  y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0),
    dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    sp.set(x0, y0, slot, shade);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

/** A small flare of light (glow) centred at (x, y): a plus with a bright core. */
function flare(sp, x, y, r = 1) {
  x = Math.round(x);
  y = Math.round(y);
  sp.set(x, y, SLOT.glow, 4);
  for (let k = 1; k <= r; k++)
    for (const [dx, dy] of N4) sp.set(x + dx * k, y + dy * k, SLOT.glow, 4 - k);
}

// Target weapon directions (radians, facing right; y grows down).
const DEG = Math.PI / 180;
const POSES = {
  // blade cocked up behind the shoulder, then swept down in front
  sword: { windup: -115 * DEG, strike: 12 * DEG, lean: [-1, 2], reach: 2 },
  // shaft drawn back level, then thrust level and long
  lance: { windup: 0, strike: 0, drawBack: -4, thrust: 5, clear: 6, lean: [-1, 2] },
  // axe raised high behind, then brought down in front
  axe: { windup: -100 * DEG, strike: 50 * DEG, lean: [-1, 2] },
};

/**
 * Attack key poses (windup, strike) for a weapon type: sword, lance, axe, bow, tome,
 * staff, breath or none. Legs (and a rider's mount) stay planted.
 */
export function attackFrames(sp, { weapon = 'sword', facing = 1, hint = null } = {}) {
  const a = anatomy(sp);
  const b = a.body;
  const span = Math.max(1, a.waist - b.y);
  const w =
    weapon === 'none' || weapon === 'breath' ? null : weaponOf(sp, a, { type: weapon, hint });
  const base = w ? withoutWeapon(sp, w) : sp;
  const upper = (x, y, s) => y < a.waist && !MOUNT_SLOTS.has(s);
  // body: lean back one for the windup; lunge forward for the strike (shoulders most)
  const lunge = (n) => (y) =>
    facing * (y >= a.waist ? 0 : Math.round(n * (0.5 + (0.5 * (a.waist - y)) / span)));
  const bodyPose = (n) => mendSeams(shift(base, upper, lunge(n), n > 0 ? 1 : 0), b.y, a.waist);

  const posed = (n, weaponPose) => {
    const body = bodyPose(n);
    if (!w) return body;
    const gy = Math.round(w.grip[1]);
    const move = { dx: lunge(n)(gy), dy: gy < a.waist && n > 0 ? 1 : 0 };
    // a weapon no hand was found on is not swung (it would float free): it rides along
    return dropSpecks(placeWeapon(body, w, w.held ? { ...move, ...weaponPose } : move));
  };

  const face = (ang) => (facing > 0 ? ang : Math.PI - ang);
  const P = POSES[weapon];
  if (P && w) {
    if (weapon === 'lance') {
      const level = turn(w.angle, face(0));
      // the thrust carries the head clear of whatever stands in front at the grip's
      // height (a shield, the mount's neck): at least P.thrust, at most half the lance
      const gy = Math.round(w.grip[1]);
      const tipReach = w.grip[0] + facing * Math.hypot(w.tip[0] - w.grip[0], w.tip[1] - w.grip[1]);
      let front = facing > 0 ? -Infinity : Infinity;
      for (let y = gy - 3; y <= gy + 3; y++)
        for (let x = 0; x < base.w; x++)
          if (base.at(x, y)) front = facing > 0 ? Math.max(front, x) : Math.min(front, x);
      const clear = Number.isFinite(front) ? facing * (front - tipReach) + P.clear : 0;
      const thrust = Math.round(Math.min(Math.max(P.thrust, clear), w.length / 2));
      return [
        posed(P.lean[0], { rot: level, along: P.drawBack }),
        posed(P.lean[1], { rot: level, along: thrust, stretch: true }),
      ];
    }
    // of a few nearby key angles, keep the one that shows the most weapon outside the
    // body (a low-guard blade swept "forward" can otherwise end hidden across the torso)
    const bodyMask = bodyPose(0);
    const best = (angles, n, extra = {}) => {
      let pick = null,
        seen = -1,
        pickSunk = false;
      const tried = new Set();
      const queue = [...angles];
      while (queue.length) {
        const ang = queue.shift();
        if (tried.has(ang)) continue;
        tried.add(ang);
        const f = posed(n, { rot: turn(w.angle, face(ang)), ...extra });
        let shown = 0;
        let sunk = false;
        for (let i = 0; i < f.w * f.h; i++)
          if (WEAPON_SLOTS.has(f.slot[i]) && !bodyMask.slot[i]) {
            shown++;
            // a head driven below the feet reads as buried in the ground
            if (((i / f.w) | 0) >= b.y + b.height - 1) sunk = true;
          }
        if (sunk) shown *= 0.5;
        if (shown > seen) {
          seen = shown;
          pick = f;
          pickSunk = sunk;
        }
        // a low-held weapon swung down would bury its head: lift the swing until it clears
        if (!queue.length && pickSunk && tried.size < angles.length + 3)
          queue.push(Math.min(...tried) - 20 * DEG);
      }
      return pick;
    };
    const spread = [0, -20 * DEG, 20 * DEG];
    return [
      best(
        spread.map((d) => P.windup + d),
        P.lean[0],
      ),
      best(
        spread.map((d) => P.strike + d),
        P.lean[1],
        { along: P.reach || 0 },
      ),
    ];
  }
  if (weapon === 'bow' && w) return bowFrames(sp, a, w, facing, posed);
  if ((weapon === 'tome' || weapon === 'staff') && w) {
    // raise the implement (and the hand with it), then thrust it forward with a flare
    const windup = posed(-1, { dy: -3 });
    const strike = posed(2, weapon === 'staff' ? { rot: turn(w.angle, face(-60 * DEG)) } : {});
    const tip = weapon === 'staff' ? w.tip : w.grip;
    flare(strike, tip[0] + facing * (weapon === 'staff' ? 3 : 4), tip[1] + 1, 1);
    return [windup, strike];
  }
  // breath / none / unarmed: rear back, then lunge forward (the weapon, if any, rides along)
  return [posed(-1, {}), posed(2, {})];
}

/**
 * Bow: windup = the string drawn to the cheek with an arrow nocked (lines from the bow's
 * tips to the drawing hand, arrow along the draw); strike = arrow loosed, string snapped
 * back to the bow, a pixel of recoil.
 */
function bowFrames(sp, a, w, facing, posed) {
  // the bow's tips: extreme weapon pixels along its (mostly vertical) axis
  const byY = [...w.pts].sort((p, q) => p[1] - q[1]);
  const top = byY[0],
    bot = byY[byY.length - 1];
  const midY = (top[1] + bot[1]) / 2;
  // the bow's belly faces forward; the string sits behind it
  const bowX =
    facing > 0 ? Math.max(...w.pts.map((p) => p[0])) : Math.min(...w.pts.map((p) => p[0]));
  const draw = [bowX - facing * 6, midY];
  const windup = posed(-1, {});
  line(windup, top[0], top[1], draw[0], draw[1], SLOT.linen, 3);
  line(windup, bot[0], bot[1], draw[0], draw[1], SLOT.linen, 3);
  // arrow: shaft from the drawing hand past the bow, a metal head at the front
  line(windup, draw[0], draw[1], bowX + facing * 2, midY, SLOT.wood, 3);
  windup.set(Math.round(bowX + facing * 3), Math.round(midY), SLOT.metal, 4);
  const strike = posed(-1, {});
  // loosed: the string snaps straight between the tips
  line(strike, top[0], top[1], bot[0], bot[1], SLOT.linen, 2);
  return [windup, strike];
}

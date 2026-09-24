// Code-driven motion on the indexed sprite (before colour, so the outline and light
// are regenerated for every frame). Part-aware: the legs and feet never move (the
// baseline holds), the upper body breathes, hair and loose cloth trail, the weapon
// bobs; the attack pose leans and lunges the upper body forward with a shear, the
// weapon leading. Pure.
import { IndexedSprite } from './indexed.mjs';
import { SLOT, WEAPON_SLOTS } from './slots.mjs';

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
 * Move pixels selected by `pick(x, y, slot)` by (dx(y), dy); returns a new sprite.
 * Moved pixels are drawn over the unmoved ones; vacated pixels become empty unless
 * `fillFrom` is 'below' (copy the unmoved pixel from the row below — seam repair).
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

/**
 * Four idle frames: rest, breath in (upper body -1 px down... chest settles), hold,
 * breath out, with hair and weapon trailing by one frame.
 */
export function idleFrames(sp, { body, waist } = {}) {
  const b = body || sp.bounds((s) => !WEAPON_SLOTS.has(s));
  const wy = waist ?? waistRow(sp, b);
  const upper = (x, y, s) => y < wy && !(s === SLOT.leather && y > wy - 2);
  const hairTrail = (x, y, s) =>
    s === SLOT.hair && y > b.y + b.height * 0.12 && x < b.x + b.width * 0.5;
  const f0 = sp.clone();
  // breath: everything above the waist settles one pixel
  const f1 = shift(sp, upper, () => 0, 1);
  // hold: settled, hair trails one pixel back (wind), weapon settles with the arms
  const f2 = shift(f1, hairTrail, () => -1, 0);
  // rise: hair still trailing, body back up
  const f3 = shift(sp, hairTrail, () => -1, 0);
  return [f0, f1, f2, f3];
}

/**
 * Attack key poses: windup (lean back one, weapon up two) and strike (upper body
 * lunges forward with a shear — the head leads least, the arms most — and the weapon
 * leads further). Legs stay planted.
 */
export function attackFrames(sp, { body, waist, facing = 1 } = {}) {
  const b = body || sp.bounds((s) => !WEAPON_SLOTS.has(s));
  const wy = waist ?? waistRow(sp, b);
  const span = Math.max(1, wy - b.y);
  const upper = (x, y, s) => y < wy || WEAPON_SLOTS.has(s);
  const windup = shift(sp, upper, (y) => -facing * (y < wy ? 1 : 0), 0);
  const windupW = shift(
    windup,
    (x, y, s) => WEAPON_SLOTS.has(s),
    () => -facing,
    -2,
  );
  const lean = (y) => facing * (y >= wy ? 2 : Math.round(1 + (2 * (wy - y)) / span));
  const strike = shift(sp, upper, lean, 1);
  const strikeW = shift(
    strike,
    (x, y, s) => WEAPON_SLOTS.has(s),
    () => facing * 2,
    0,
  );
  return [windupW, strikeW];
}

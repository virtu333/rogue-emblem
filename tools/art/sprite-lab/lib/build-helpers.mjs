// Shared drawing helpers used by class recipes (split out to avoid an import cycle).
import { FACES, HAIR, HEADGEAR, BEARDS } from './heads.mjs';

// Draw a head (face + hair + beard + headgear) at socket (hx, hy).
export function drawHead(f, id, hx, hy, opts = {}) {
  const gear = HEADGEAR[id.headgear ?? 'none'];
  const face = FACES[id.face ?? 'youth'];
  // identity accessory: a neckerchief whose tail trails over the back shoulder
  if (id.scarf)
    f.stamp(['...oOOo.', 'uoOOoOo.', 'uo......', 'u.......'], hx - 2, hy + 8, {
      tag: 'torso',
      remap: { sub: id.scarf === 'linen' ? 'linen' : 'sub' },
    });
  f.stamp(face, hx, hy, { tag: 'head', rim: false });
  if (id.beard && BEARDS[id.beard]) {
    BEARDS[id.beard].forEach(
      (row, k) => row && f.stamp([row], hx, hy + k, { tag: 'head', casts: false }),
    );
  }
  const hair = HAIR[id.hair ?? 'crop'];
  const pid = f.stamp(hair.front, hx, hy, { tag: 'hair' });
  if (gear) {
    if (gear.clearRows) {
      for (let y = hy - 2; y < hy + gear.clearRows; y++)
        for (let x = hx - 2; x < hx + 11; x++) {
          const p = f.get(x, y);
          if (p && f.parts[p.pid].tag === 'hair') f.px(x, y, null, 0, -1);
        }
    }
    if (gear.faceShade)
      for (const r of gear.faceShade)
        for (let x = hx; x < hx + 10; x++) {
          const p = f.get(x, hy + r);
          if (p && p.slot === 'skin') f.shade[(hy + r) * f.w + x] = Math.max(0, p.shade - 1);
        }
    f.stamp(gear.rows, hx + (gear.dx ?? 0), hy + (gear.dy ?? 0), {
      tag: 'headgear',
      remap: { metal: opts.helmSlot ?? 'armor' },
    });
  }
  return pid;
}

export function drawHairBack(f, id, hx, hy) {
  const hair = HAIR[id.hair ?? 'crop'];
  if (hair.back)
    f.stamp(hair.back, hx + (hair.backDx ?? 0), hy + (hair.backDy ?? 0), { tag: 'hairBack' });
}

// Gold thread cord (player motif) / iron strap (enemy): a 1px baldric from
// shoulder to hip with a knot. Procedural so it follows every torso.
export function cord(f, [x0, y0], [x1, y1], { knot = true } = {}) {
  const pid = f.begin('cord', { casts: false });
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  for (let k = 0; k <= n; k++) {
    const x = Math.round(x0 + ((x1 - x0) * k) / n);
    const y = Math.round(y0 + ((y1 - y0) * k) / n);
    if (!f.get(x, y)) continue; // only over the body
    f.px(x, y, 'trim', k % 3 === 0 ? 4 : 3, pid);
  }
  if (knot) {
    const kx = Math.round((x0 + x1) / 2),
      ky = Math.round((y0 + y1) / 2);
    f.px(kx, ky, 'trim', 4, pid);
    f.px(kx + 1, ky, 'trim', 2, pid);
    f.px(kx, ky + 1, 'trim', 2, pid);
  }
}

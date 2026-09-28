// "The Ford": the fight's staging as data plus pure queries. Step 2 of the fight-design
// method (gesture drawings on a flat camera): every position, every step and who holds the
// initiative, planned side-on before any dynamic camera. ford.js places the fighters from
// here, so space stays continuous across cuts; ford_previs.js draws it as stick figures.
//
// Time is piece-local seconds: at(bar, beat) = T(bar, beat) - 44.0 (the piece starts on bar
// 28 beat 3). Metres: X along the crossing (our bank at X < -8, the Empire's at X > +8),
// Y up from the water surface (Y = 0), Z depth (the ford's line is Z = 0, upstream is -Z).
//
// Everything below is one physical story, checked by validate():
//  - the spear reaches 2.6 m from the Warden's hands at full thrust (2.15 m in guard);
//  - Edric wades at about 2.5 m/s (4.4 m/s on the bank) and charges at 3.5 m/s;
//  - the thrust's point crosses Edric's line while his head is a hand's breadth below it;
//  - at the clash Edric is past the point (inside the reach) and the shaft is what he hits;
//  - in the bind both weapons pass through one contact point;
//  - the yield drags that point along Edric's blade, and his weight goes onto the slick stone.

import { T, KIT, BEAT, BAR } from './engine/score.js';

export const MUSIC_OFFSET = 44.0;
export const at = (bar, beat = 1) => T(bar, beat) - MUSIC_OFFSET;
export const DURATION = at(37);
export { BEAT, BAR };

/** The named moments (piece-local seconds). Bar.beat in FORD.md is at(bar, beat). */
export const TIME = {
  roll: at(28, 3), // 0.0  the rush down the Thread
  run: at(29, 1), // 0.8  Edric starts to run
  water: at(30, 1), // 2.4  Edric enters the water, the Warden steps in, the line steps
  level: at(30, 3), // 3.2  the line halts, the spear is levelled
  plant: at(31, 1), // 4.0  the Warden plants his feet
  eye: at(31, 4), // 5.2  close-up of Edric's eye
  charge: at(32, 1), // 5.6  Edric charges
  drop: 5.7, // Edric reads the Warden sinking and drops
  thrustGo: 5.85, // the snap begins (150 ms)
  thrust: at(32, 2), // 6.0  full extension, on the snare
  recover: 6.45, // the Warden pulls the spear back
  sprayEnd: at(32, 4), // 6.8  the spray sheet falls, Edric coils in it
  clash: at(33, 1), // 7.2  on the crash
  bind: at(33, 3), // 8.0
  decide: at(34, 3), // 9.6  the tilt of the helm
  yield: at(35, 1), // 10.4 the Warden gives way
  stone: 10.6, // Edric's lead foot on the slick stone
  cut: at(35, 3), // 11.2 the crimson cut, on the crash
  fall: at(36, 1), // 12.0 hips touch the water, on the kick
  landed: at(36, 2), // 12.4 back and head down, on the snare
  lift: at(36, 4), // 13.2 the paint begins to lift
  end: DURATION, // 13.6
};

// ----------------------------------------------------------------------- small maths

const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const lerp = (a, b, k) => a + (b - a) * k;
const sm = (u) => {
  u = clamp(u);
  return u * u * (3 - 2 * u);
};

/** Anime timing: ease-in for anticipation, snaps for hits, holds. */
export const EASE = {
  lin: (u) => u,
  in: (u) => u ** 2.2,
  in3: (u) => u ** 3,
  out: (u) => 1 - (1 - u) ** 2.2,
  out3: (u) => 1 - (1 - u) ** 3,
  snap: (u) => 1 - (1 - u) ** 4,
  inout: sm,
  hold: (u) => (u < 1 ? 0 : 1),
  // overshoot then settle (follow-through)
  back: (u) => 1 + 2.4 * (u - 1) ** 3 + 1.4 * (u - 1) ** 2,
};

/** Scalar keys [[t, v, ease?]] -> f(t); ease names the segment that ends at that key. */
function keyed(keys) {
  return (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [t0, v0] = keys[i - 1];
        const [t1, v1, e = 'inout'] = keys[i];
        return lerp(v0, v1, EASE[e]((t - t0) / (t1 - t0)));
      }
    }
    return keys[keys.length - 1][1];
  };
}

/**
 * A position over time through keys [[t, x, v?, ease?]]: monotone cubic Hermite (no
 * overshoot; a hold stays put) with optional velocities at keys, or, when a key names an
 * ease, that segment is x0 + dx * ease(u) instead. Speed is its derivative.
 */
function path(keys) {
  const n = keys.length;
  const sl = [];
  for (let i = 0; i < n - 1; i++)
    sl.push((keys[i + 1][1] - keys[i][1]) / (keys[i + 1][0] - keys[i][0]));
  const m = keys.map((k, i) => {
    const a = i > 0 ? sl[i - 1] : sl[0];
    const b = i < n - 1 ? sl[i] : sl[n - 2];
    let v;
    if (k[2] !== undefined && k[2] !== null) {
      v = k[2];
      const lim = 3 * Math.min(Math.abs(a), Math.abs(b));
      v = Math.sign(v) * Math.min(Math.abs(v), lim);
    } else if (i === 0 || i === n - 1) v = i === 0 ? sl[0] : sl[n - 2];
    else v = a * b <= 0 ? 0 : (2 * a * b) / (a + b);
    return v;
  });
  const pos = (t) => {
    if (t <= keys[0][0]) return keys[0][1];
    if (t >= keys[n - 1][0]) return keys[n - 1][1];
    let i = 1;
    while (t > keys[i][0]) i++;
    const [t0, x0] = keys[i - 1];
    const [t1, x1, , e] = keys[i];
    const u = (t - t0) / (t1 - t0);
    if (e) return lerp(x0, x1, EASE[e](u));
    const h = t1 - t0;
    const u2 = u * u;
    const u3 = u2 * u;
    return (
      (2 * u3 - 3 * u2 + 1) * x0 +
      (u3 - 2 * u2 + u) * h * m[i - 1] +
      (-2 * u3 + 3 * u2) * x1 +
      (u3 - u2) * h * m[i]
    );
  };
  const speed = (t) => (pos(t + 0.004) - pos(t - 0.004)) / 0.008;
  return { pos, speed };
}

// ---------------------------------------------------------------------- the ford

/** Water depth (m) at X: 0 at the banks (|X| >= 8), 0.5 by |X| = 5, 0.6 midstream. */
export function waterDepth(X) {
  const a = Math.abs(X);
  if (a >= 8) return 0;
  if (a >= 5) return 0.5 * sm((8 - a) / 3);
  return 0.5 + 0.1 * sm((5 - a) / 5);
}

/** Bank height above the water (m): a gentle ramp up from the waterline at |X| = 8. */
export function bankHeight(X) {
  const a = Math.abs(X);
  return a <= 8 ? 0 : 0.055 * (a - 8);
}

/** The riverbed / bank surface (Y) at X. */
export const bedY = (X) => (Math.abs(X) < 8 ? -waterDepth(X) : bankHeight(X));

/**
 * The stones. `top` is the height of the crown above the surface, `w` the width along X,
 * `z` the offset from the ford's line (a stone with |z| > 0.3 can't take a footstep).
 * Upstream stones (z < 0) are for the wide shot only.
 */
export const STONES = [
  { id: 's-6', x: -6.0, z: 0.75, w: 0.7, top: 0.14 },
  { id: 's-1.5', x: -1.5, z: 0.5, w: 0.6, top: 0.12 },
  { id: 's+2', x: 2.0, z: 0.55, w: 0.6, top: 0.13 },
  { id: 's+3.8', x: 3.8, z: 0, w: 0.55, top: 0.12, slick: true },
  { id: 'up-7', x: -7.2, z: -3.4, w: 1.0, top: 0.2 },
  { id: 'up-4.5', x: -4.5, z: -2.6, w: 0.8, top: 0.16 },
  { id: 'up+0.5', x: 0.5, z: -3.6, w: 1.3, top: 0.22 },
  { id: 'up+5.5', x: 5.5, z: -2.9, w: 0.9, top: 0.18 },
];
export const SLICK = STONES.find((s) => s.slick);

/** Height of the stone crown at (X, Z), or -Infinity when there is no stone under it. */
function stoneY(X, Z) {
  let y = -Infinity;
  for (const s of STONES) {
    const dx = (2 * (X - s.x)) / s.w;
    if (Math.abs(dx) >= 1 || Math.abs(Z - s.z) > 0.3) continue;
    const bed = bedY(s.x);
    y = Math.max(y, bed + (s.top - bed) * Math.sqrt(1 - dx ** 4));
  }
  return y;
}

/** What a foot stands on at (X, Z): the bed, or a stone's crown. */
export const groundY = (X, Z = 0) => Math.max(bedY(X), stoneY(X, Z));

// ------------------------------------------------------------------- the skeleton
//
// A small 2D skeleton (hips, spine, neck, head, shoulder, elbows, hands, knees, feet) and a
// weapon held in the hands as a rigid segment. The trunk and head are forward kinematics
// from a few angles; limbs are two-bone IK: feet go to where the foot tracks say (planted
// on the bed or a stone), hands to the weapon's grips. A pose is a handful of numbers, so
// two poses mix cleanly (joint angles and targets lerp, the IK does the rest).

const ANKLE = 0.07; // the ankle is this far above what the sole stands on

const dims = (s) => ({
  thigh: 0.44 * s,
  shin: 0.44 * s,
  trunk: 0.56 * s,
  neck: 0.19 * s,
  headR: 0.115 * s,
  upper: 0.3 * s,
  fore: 0.29 * s,
});

/** Two-bone IK from (hx, hy) to (tx, ty); the joint bends toward `pref`. Clamps to reach. */
function ik2(hx, hy, tx, ty, a, b, pref) {
  const dx = tx - hx;
  const dy = ty - hy;
  const d = Math.hypot(dx, dy) || 1e-6;
  const dc = clamp(d, Math.abs(a - b) + 1e-3, a + b - 1e-4);
  const ux = dx / d;
  const uy = dy / d;
  const ang = Math.acos(clamp((a * a + dc * dc - b * b) / (2 * a * dc), -1, 1));
  const c = Math.cos(ang);
  const s = Math.sin(ang);
  const k1 = [hx + a * (ux * c - uy * s), hy + a * (ux * s + uy * c)];
  const k2 = [hx + a * (ux * c + uy * s), hy + a * (-ux * s + uy * c)];
  const ex = hx + ux * dc;
  const ey = hy + uy * dc;
  const sc = (k) => (k[0] - (hx + ex) / 2) * pref[0] + (k[1] - (hy + ey) / 2) * pref[1];
  return { joint: sc(k1) >= sc(k2) ? k1 : k2, end: [ex, ey], over: Math.max(0, d - (a + b)) };
}

const reach = (sx, sy, tx, ty, L) => {
  const d = Math.hypot(tx - sx, ty - sy);
  return d <= L ? [tx, ty] : [sx + ((tx - sx) * L) / d, sy + ((ty - sy) * L) / d];
};

const POSE_KEYS = ['hipY', 'lean', 'curve', 'head', 'rear', 'ang', 'gap', 'rt', 'free', 'swing', 'bob'];

/** A pose: the base merged with overrides (so a library entry lists only what differs). */
const BASE = {
  hipY: 0.9, // hips above what the feet stand on (m, before scale)
  lean: 0.05, // trunk from vertical toward facing (rad)
  curve: 0.02, // the spine's bow (m), forward positive: the line of action
  head: 0, // head tilt relative to the trunk (rad), forward positive
  rear: [0.1, -0.45], // the weapon hand's grip, from the shoulder (forward, up)
  ang: 1.3, // the weapon's angle: 0 forward, + up, pi backward
  gap: 0, // the lead hand along the shaft from the rear hand; 0 = one-handed
  rt: 2.55, // spear: rear hand to point
  free: [0.05, -0.5], // the free hand when one-handed
  swing: 0, // run-cycle amount (arm swing, hip bob)
  bob: 0.03,
};
const mkPose = (o) => ({ ...BASE, ...o });

function mixPose(a, b, k) {
  const o = {};
  for (const key of POSE_KEYS) {
    const x = a[key];
    const y = b[key];
    o[key] = Array.isArray(x) ? [lerp(x[0], y[0], k), lerp(x[1], y[1], k)] : lerp(x, y, k);
  }
  return o;
}

/** Pose keys [[t, name, ease?]] over a library -> pose(t). */
function poseTrack(lib, keys) {
  const f = (name) => {
    if (!lib[name]) throw new Error(`no pose "${name}"`);
    return lib[name];
  };
  return (t) => {
    if (t <= keys[0][0]) return f(keys[0][1]);
    for (let i = 1; i < keys.length; i++) {
      if (t <= keys[i][0]) {
        const [t0, n0] = keys[i - 1];
        const [t1, n1, e = 'inout'] = keys[i];
        return mixPose(f(n0), f(n1), EASE[e]((t - t0) / (t1 - t0)));
      }
    }
    return f(keys[keys.length - 1][1]);
  };
}

/** A step function [[t, label]] -> label(t). */
function labels(keys) {
  return (t) => {
    let v = keys[0][1];
    for (const [tk, lab] of keys) if (t >= tk) v = lab;
    return v;
  };
}

/** A foot's track: keys [[t, x, lift, arc?, ease?]]; equal x and lift = planted. */
function footTrack(keys) {
  return (t) => {
    if (t <= keys[0][0]) return { x: keys[0][1], lift: keys[0][2] };
    for (let i = 1; i < keys.length; i++) {
      const [t1, x1, l1, arc = 0, e = 'inout'] = keys[i];
      if (t <= t1) {
        const [t0, x0, l0] = keys[i - 1];
        const u = (t - t0) / (t1 - t0);
        const E = EASE[e](u);
        return { x: lerp(x0, x1, E), lift: lerp(l0, l1, E) + arc * Math.sin(Math.PI * u) };
      }
    }
    const k = keys[keys.length - 1];
    return { x: k[1], lift: k[2] };
  };
}

const SWORD = { blade: 1.0, pommel: 0.15 };
const SPEAR = { length: 3.05 };

/**
 * An actor from data: a hip path, pose and action keys, foot tracks, and weapon aims (a
 * weapon that must pass through a moving point: the bind, the cut). skeleton(t) solves the
 * whole figure; everything is a pure function of t.
 */
function makeActor(spec) {
  const { name, kind, scale = 1, X, Zf = () => 0, face = () => 1, pose, action, feet } = spec;
  const aims = spec.aims || [];
  const gait = spec.gait || null; // { t0, every }
  const D = dims(scale);
  const armL = (D.upper + D.fore) * 0.985;

  const aimAt = (t) => {
    let best = null;
    for (const a of aims) {
      const w =
        t <= a.a || t >= a.d
          ? 0
          : t < a.b
            ? sm((t - a.a) / (a.b - a.a))
            : t <= a.c
              ? 1
              : 1 - sm((t - a.c) / (a.d - a.c));
      if (w > 0 && (!best || w > best.w)) best = { w, pt: a.pt(t), through: a.through };
    }
    return best;
  };

  const skeleton = (t) => {
    const f = face(t);
    const x = X.pos(t);
    const z = Zf(t);
    const P = pose(t);
    // the gait: step index s, its fraction u; the hips bob and the free arm swings
    const s = gait ? (t - gait.t0) / gait.every : 0;
    const u = s - Math.floor(s);
    const bob = P.swing ? -P.bob * scale * P.swing * Math.cos(2 * Math.PI * (u - 0.35)) : 0;
    const hips = [x, groundY(x, z) + P.hipY * scale + bob];
    const tv = [Math.sin(P.lean) * f, Math.cos(P.lean)];
    const nv = [Math.cos(P.lean) * f, -Math.sin(P.lean)]; // toward the chest
    const neck = [hips[0] + tv[0] * D.trunk, hips[1] + tv[1] * D.trunk];
    const spine = [
      hips[0] + tv[0] * D.trunk * 0.5 + nv[0] * P.curve * scale,
      hips[1] + tv[1] * D.trunk * 0.5 + nv[1] * P.curve * scale,
    ];
    const ha = P.lean + P.head;
    const hv = [Math.sin(ha) * f, Math.cos(ha)];
    const head = [neck[0] + hv[0] * D.neck, neck[1] + hv[1] * D.neck];
    const sh = [neck[0] - tv[0] * 0.05 * scale, neck[1] - tv[1] * 0.05 * scale];
    let over = 0;

    const legs = {};
    for (const nm of ['N', 'F']) {
      const ft = feet[nm](t);
      const ty = groundY(ft.x, z) + ANKLE + ft.lift;
      const r = ik2(hips[0], hips[1], ft.x, ty, D.thigh, D.shin, [f, 0.15]);
      over += r.over;
      legs[nm] = { knee: r.joint, foot: r.end, toe: [r.end[0] + 0.19 * scale * f, r.end[1] - 0.05] };
    }

    // the weapon: rear hand from the pose, then aimed if a contact point pulls on it
    const Rt = reach(sh[0], sh[1], sh[0] + P.rear[0] * scale * f, sh[1] + P.rear[1] * scale, armL);
    const aim = aimAt(t);
    let ang = P.ang;
    let rt = P.rt;
    if (aim) {
      const a = Math.atan2(aim.pt[1] - Rt[1], (aim.pt[0] - Rt[0]) * f);
      ang = lerp(P.ang, a, aim.w);
      if (aim.through === 'reach' && kind !== 'sword')
        rt = lerp(P.rt, Math.hypot(aim.pt[0] - Rt[0], aim.pt[1] - Rt[1]) + 0.1, aim.w);
    }
    const dir = [Math.cos(ang) * f, Math.sin(ang)];
    let gap = P.gap;
    let lead = null;
    if (gap > 0) {
      for (; gap > 0.08; gap -= 0.02) {
        lead = [Rt[0] + dir[0] * gap, Rt[1] + dir[1] * gap];
        if (Math.hypot(lead[0] - sh[0], lead[1] - sh[1]) <= armL) break;
      }
      if (gap <= 0.08) lead = null;
    }
    let wpn;
    if (kind === 'sword') {
      wpn = {
        kind: 'sword',
        butt: [Rt[0] - dir[0] * SWORD.pommel, Rt[1] - dir[1] * SWORD.pommel],
        tip: [Rt[0] + dir[0] * SWORD.blade, Rt[1] + dir[1] * SWORD.blade],
      };
    } else {
      const tip = [Rt[0] + dir[0] * rt, Rt[1] + dir[1] * rt];
      wpn = {
        kind: 'spear',
        butt: [tip[0] - dir[0] * SPEAR.length, tip[1] - dir[1] * SPEAR.length],
        tip,
      };
    }
    Object.assign(wpn, { rear: Rt, lead, dir, ang, aimW: aim ? aim.w : 0 });

    // arms: the near arm holds the rear grip; the far arm the lead grip, or swings free
    let farT = lead;
    if (!farT) {
      const sw = P.swing;
      farT = [
        sh[0] + (P.free[0] * scale + 0.3 * scale * sw * Math.sin(Math.PI * s)) * f,
        sh[1] + P.free[1] * scale + 0.11 * scale * sw * Math.sin(Math.PI * s + 0.6),
      ];
      farT = reach(sh[0], sh[1], farT[0], farT[1], armL);
    }
    const pref = [-0.35 * f, -1];
    const an = ik2(sh[0], sh[1], Rt[0], Rt[1], D.upper, D.fore, pref);
    const af = ik2(sh[0], sh[1], farT[0], farT[1], D.upper, D.fore, pref);
    over += an.over + af.over;
    const arms = {
      N: { elbow: an.joint, hand: an.end },
      F: { elbow: af.joint, hand: af.end },
    };
    return {
      name,
      t,
      facing: f,
      X: x,
      Z: z,
      hips,
      spine,
      neck,
      head,
      headR: D.headR,
      shoulder: sh,
      legs,
      arms,
      weapon: wpn,
      over,
    };
  };

  return {
    name,
    kind,
    scale,
    dims: D,
    X,
    Zf,
    face,
    action,
    pose,
    skeleton,
    at(t) {
      const sk = skeleton(t);
      return {
        X: sk.X,
        Y: sk.hips[1],
        Z: sk.Z,
        facing: sk.facing,
        action: action(t),
        pose: sk,
        speed: X.speed(t),
      };
    },
  };
}

/**
 * Footfalls for a run or march: landing k at t0 + k * every, alternating N/F. The planted
 * foot is under the hips at mid-stance, so it stays put while the hips pass over it (no
 * sliding); the swing between plants is an arc. Pushes landings to `lands`.
 */
function runSteps(feet, lands, Xp, who, t0, n, o) {
  const { every, stance, h, first = 0, fwd = 0, override = {} } = o;
  const at_ = (v, t) => (typeof v === 'function' ? v(t) : v);
  const last = { N: null, F: null };
  for (const nm of ['N', 'F']) last[nm] = feet[nm][feet[nm].length - 1];
  for (let k = 0; k < n; k++) {
    const tk = t0 + k * every;
    const nm = (first + k) % 2 ? 'F' : 'N';
    const st = at_(stance, tk);
    const x = override[k] ?? Xp.pos(tk + st / 2) + fwd;
    const keys = feet[nm];
    const prev = keys[keys.length - 1];
    const lo = Math.max(prev[0] + 0.01, tk - (2 * every - st));
    if (lo < tk - 0.02 && (prev[1] !== x || prev[2] !== 0)) keys.push([lo, prev[1], prev[2]]);
    keys.push([tk, x, 0, at_(h, tk)]);
    keys.push([tk + st, x, 0]);
    lands.push({ t: tk, foot: nm, x, actor: who, stance: st });
  }
}

// -------------------------------------------------------------------- pose library
//
// Gesture poses: a clear line of action, weight over the support foot, anticipation before
// a strike, overshoot and follow-through after, the collapse arc in the fall. Each lists
// only what differs from BASE. (lean: trunk from vertical toward facing; head: relative to
// the trunk; rear/free: hands from the shoulder, forward/up; ang: 0 forward, + up.)

const EDRIC_LIB = Object.fromEntries(
  Object.entries({
    // on the bank, braced to run: the weight is over the front leg, the blade trails
    brace: { hipY: 0.78, lean: 0.32, curve: 0.05, head: -0.2, rear: [-0.05, -0.5], ang: 2.9, free: [0.2, -0.35] },
    // running: the body falls forward and the legs catch it
    runLand: { hipY: 0.84, lean: 0.4, curve: 0.06, head: -0.3, rear: [0.05, -0.5], ang: 2.95, swing: 1, bob: 0.05 },
    // wading: knees high, more upright, every stride a fight with the water
    runWade: { hipY: 0.8, lean: 0.32, curve: 0.05, head: -0.25, rear: [0.05, -0.5], ang: 2.9, swing: 0.8, bob: 0.05 },
    // the charge into measure: chest over the knee, the blade tucked back and low
    charge: { hipY: 0.74, lean: 0.52, curve: 0.07, head: -0.42, rear: [-0.05, -0.55], ang: 3.0, swing: 1, bob: 0.06 },
    // he has read the Warden's shoulders sink: the weight drops, the trunk comes upright
    dropAnt: { hipY: 0.52, lean: 0.1, curve: 0.05, head: -0.1, rear: [-0.05, -0.5], ang: 3.0, free: [0.3, -0.3] },
    // the slide: hips on the bed, trunk thrown back, chin up, eyes on the point, one hand dragging
    slide: { hipY: 0.19, lean: -0.95, curve: -0.05, head: 0.75, rear: [-0.1, -0.2], ang: 2.85, free: [0.2, -0.5] },
    slideEnd: { hipY: 0.2, lean: -0.7, curve: -0.03, head: 0.55, rear: [-0.05, -0.25], ang: 2.7, free: [0.25, -0.5] },
    // gathering in the spray: knees drawn in, both hands on the hilt, the blade cocked back
    coil: { hipY: 0.4, lean: 0.3, curve: 0.06, head: -0.3, rear: [0.05, -0.55], gap: 0.16, ang: 2.4 },
    // the clash: a deep lunge, the blade rising to beat the shaft
    clash: { hipY: 0.62, lean: 0.52, curve: 0.06, head: -0.4, rear: [0.48, -0.1], gap: 0.14, ang: 0.85 },
    bindPush: { hipY: 0.58, lean: 0.6, curve: 0.07, head: -0.45, rear: [0.48, -0.1], gap: 0.14, ang: 0.85 },
    bindHard: { hipY: 0.54, lean: 0.7, curve: 0.08, head: -0.55, rear: [0.5, -0.12], gap: 0.14, ang: 0.85 },
    // the yield: the resistance is gone, the weight goes on, the blade is pressed down
    overbal: { hipY: 0.55, lean: 1.05, curve: 0.06, head: -0.7, rear: [0.5, -0.5], gap: 0.12, ang: -0.1 },
    slipCatch: { hipY: 0.4, lean: 1.22, curve: 0.05, head: -0.85, rear: [0.45, -0.6], gap: 0.12, ang: -0.3 },
    // the cut: the chest opens, the head is thrown back, the sword arm flung up
    cutHit: { hipY: 0.5, lean: -0.15, curve: -0.1, head: -0.5, rear: [0.15, 0.15], ang: 1.3, free: [0.5, 0.2] },
    stagger: { hipY: 0.52, lean: -0.45, curve: -0.08, head: -0.35, rear: [0.25, 0.1], ang: 1.0, free: [0.45, 0.1] },
    falling: { hipY: 0.36, lean: -0.85, curve: -0.06, head: -0.2, rear: [0.3, 0.0], ang: 0.6, free: [0.4, 0.15] },
    land: { hipY: 0.15, lean: -1.3, curve: -0.04, head: -0.1, rear: [0.3, 0.05], ang: 0.3, free: [0.4, 0.1] },
    lying: { hipY: 0.12, lean: -1.5, curve: -0.02, head: 0.05, rear: [0.25, 0.05], ang: 0.15, free: [0.45, 0.05] },
  }).map(([k, v]) => [k, mkPose(v)]),
);

const WARDEN_LIB = Object.fromEntries(
  Object.entries({
    // on the bank: the spear grounded and upright at his side
    ready: { hipY: 0.92, lean: -0.02, curve: 0, rear: [0.12, -0.3], gap: 0.5, ang: 1.5 },
    march: { hipY: 0.9, lean: 0.05, rear: [0.12, -0.3], gap: 0.5, ang: 1.3, swing: 0.5, bob: 0.03 },
    // the spear comes down to level, the point at Edric's chest
    guard: { hipY: 0.82, lean: 0.08, curve: 0.02, rear: [0.1, -0.3], gap: 0.42, ang: 0.04 },
    // anticipation: the weight sinks back over the rear leg, the point lifts a hair
    thrustAnt: { hipY: 0.76, lean: -0.04, curve: -0.03, head: 0.05, rear: [-0.02, -0.3], gap: 0.42, ang: 0.1 },
    // full extension: the rear arm to the shoulder, the lead arm straight, the front knee deep
    thrust: { hipY: 0.7, lean: 0.5, curve: 0.06, head: -0.4, rear: [0.1, -0.2], gap: 0.45, ang: 0.04, rt: 2.9 },
    recover: { hipY: 0.78, lean: 0.12, curve: 0.02, rear: [0.05, -0.3], gap: 0.42, ang: 0.25 },
    // the block: the shaft up across the body to meet whatever comes out of the spray
    block: { hipY: 0.8, lean: 0.1, curve: 0.02, rear: [0.05, -0.28], gap: 0.45, ang: 0.3, rt: 2.75 },
    bindHold: { hipY: 0.78, lean: 0.1, curve: 0.03, rear: [0.05, -0.28], gap: 0.45, ang: 0.3, rt: 2.75 },
    // he decides: only the helm moves (a tilt down at the blade)
    decide: { hipY: 0.78, lean: 0.1, curve: 0.03, head: 0.26, rear: [0.05, -0.28], gap: 0.45, ang: 0.3, rt: 2.75 },
    // the tell: his knees loosen, the weight goes back
    yieldAnt: { hipY: 0.73, lean: -0.02, curve: -0.02, head: 0.1, rear: [0.05, -0.3], gap: 0.45, ang: 0.3, rt: 2.75 },
    // the step back, the shaft turned down over the blade
    yield: { hipY: 0.8, lean: -0.2, curve: -0.05, head: -0.05, rear: [0.1, -0.3], gap: 0.45, ang: -0.3, rt: 2.6 },
    // the wind-up: hands to the head, the point up
    wind: { hipY: 0.82, lean: -0.12, curve: -0.04, head: -0.2, rear: [0.1, 0.2], gap: 0.3, ang: 0.95, rt: 2.2 },
    cutFollow: { hipY: 0.66, lean: 0.55, curve: 0.06, head: 0.15, rear: [0.35, -0.25], gap: 0.3, ang: -0.9, rt: 2.0 },
    standOver: { hipY: 0.9, lean: 0.08, curve: 0.02, head: 0.3, rear: [0.12, -0.35], gap: 0.5, ang: -0.5, rt: 2.5 },
  }).map(([k, v]) => [k, mkPose(v)]),
);

const SOLDIER_LIB = { stand: WARDEN_LIB.ready, march: WARDEN_LIB.march };

// ------------------------------------------------------------------------ the actors

const LANDS = []; // every footfall: { t, foot, x, actor, stance }

// ---- the contact points (the bind, then the yield dragging it down Edric's blade)
const BIND = { t0: TIME.clash, t1: 10.75 };
const bindX = keyed([
  [7.2, 3.7],
  [7.5, 3.72, 'out'],
  [9.6, 3.85],
  [10.4, 3.9],
  [10.75, 4.05, 'in'],
]);
const bindY = keyed([
  [7.2, 0.9],
  [9.6, 0.86],
  [10.4, 0.8],
  [10.75, 0.05, 'in'],
]);
const bindPt = (t) => [bindX(t), bindY(t)];

// ---- Edric
const edricPath = path([
  [0, -14.0],
  [0.8, -14.0, 0],
  [1.5, -12.4, 4.5],
  [2.4, -8.5, 4.1],
  [3.2, -5.7, 3.0],
  [4.0, -3.6, 2.5],
  [5.2, -0.9, 2.3],
  [5.6, 0.05, 2.5],
  [5.85, 0.85, 3.4],
  [6.0, 1.32, 3.0],
  [6.4, 2.0, 0.6],
  [6.8, 2.25, 0],
  [7.2, 2.55, 0.6],
  [7.5, 2.65, 0],
  [8.7, 2.68, 0],
  [9.05, 2.78, 0],
  [10.3, 2.8, 0],
  [10.4, 2.8, 0.5],
  [10.6, 3.15, 1.8],
  [10.95, 3.5, 0.8],
  [11.2, 3.58, 0.3],
  [11.6, 3.75, 0.5],
  [12.0, 4.02, 0.7],
  [12.4, 4.12, 0],
]);
const eX = (t) => edricPath.pos(t);
const edricFeet = {
  N: [
    [0, -13.7, 0],
    [0.74, -13.7, 0],
  ],
  F: [
    [0, -14.3, 0],
    [1.0, -14.3, 0],
  ],
};
runSteps(edricFeet, LANDS, edricPath, 'edric', 0.85, 20, {
  every: 0.25,
  stance: (t) => lerp(0.14, 0.2, sm((t - 2.4) / 0.8)),
  h: (t) => lerp(0.3, 0.42, sm((t - 2.4) / 0.8)),
});
edricFeet.N.push(
  [5.83, eX(5.83) + 0.5, 0, 0.3],
  [5.9, eX(5.83) + 0.5, 0],
  [5.98, eX(5.98) + 0.75, 0.1, 0, 'out'],
  [6.4, eX(6.4) + 0.8, 0.12],
  [6.8, eX(6.8) + 0.65, 0.1],
  [7.12, 3.15, 0, 0.18, 'out'], // the lead foot of the lunge
  [8.9, 3.15, 0],
  [9.05, 3.3, 0, 0.1],
  [10.3, 3.3, 0],
  [10.6, SLICK.x, 0, 0.16, 'out'], // onto the slick stone
  [10.7, SLICK.x, 0],
  [10.95, 4.45, 0], // and off the far side of it
  [11.2, 4.5, 0],
  [11.9, 4.75, 0.06],
  [12.4, 4.95, 0.12],
);
edricFeet.F.push(
  [5.95, eX(5.95) + 0.35, 0.12],
  [6.4, eX(6.4) + 0.4, 0.06],
  [6.8, eX(6.8) + 0.25, 0.04],
  [6.95, 2.0, 0, 0.12], // the rear foot of the lunge
  [8.55, 2.0, 0],
  [8.72, 2.1, 0, 0.12],
  [10.45, 2.1, 0],
  [10.95, 3.0, 0, 0.2],
  [11.4, 3.2, 0],
  [12.4, 4.85, 0.06],
);
const edric = makeActor({
  name: 'edric',
  kind: 'sword',
  scale: 1,
  X: edricPath,
  face: () => 1,
  gait: { t0: 0.85, every: 0.25 },
  feet: { N: footTrack(edricFeet.N), F: footTrack(edricFeet.F) },
  pose: poseTrack(EDRIC_LIB, [
    [0, 'brace'],
    [0.72, 'brace'],
    [0.98, 'runLand', 'out'],
    [2.3, 'runLand'],
    [3.0, 'runWade'],
    [5.5, 'runWade'],
    [5.72, 'charge'],
    [5.85, 'dropAnt', 'in'],
    [5.97, 'slide', 'snap'],
    [6.55, 'slide'],
    [6.75, 'slideEnd'],
    [6.95, 'coil'],
    [7.05, 'coil'],
    [7.2, 'clash', 'snap'],
    [7.5, 'bindPush', 'out'],
    [9.0, 'bindPush'],
    [9.6, 'bindHard'],
    [10.4, 'bindHard'],
    [10.55, 'overbal', 'out'],
    [10.8, 'slipCatch'],
    [11.15, 'slipCatch'],
    [11.28, 'cutHit', 'snap'],
    [11.55, 'stagger', 'out'],
    [11.85, 'falling', 'in'],
    [12.0, 'land', 'in'],
    [12.4, 'lying', 'out'],
    [13.6, 'lying'],
  ]),
  action: labels([
    [0, 'stand'],
    [0.8, 'run'],
    [2.45, 'wade-run'],
    [5.6, 'charge'],
    [5.7, 'drop-slide'],
    [6.8, 'burst'],
    [7.2, 'clash'],
    [7.4, 'bind'],
    [10.4, 'yield-step'],
    [10.55, 'overbalance'],
    [10.62, 'slip'],
    [11.2, 'struck'],
    [11.55, 'fall'],
    [12.4, 'down'],
  ]),
  aims: [{ a: 7.1, b: 7.2, c: 10.7, d: 10.85, pt: bindPt, through: 'ray' }],
});

// the crimson cut lands on the middle of Edric's back
const backPt = (t) => {
  const s = edric.skeleton(t);
  const n = [-Math.cos(Math.asin(clamp((s.neck[0] - s.hips[0]) / edric.dims.trunk, -1, 1))), 0];
  const lean = Math.atan2((s.neck[0] - s.hips[0]) * s.facing, s.neck[1] - s.hips[1]);
  n[0] = -Math.cos(lean) * s.facing;
  n[1] = Math.sin(lean);
  return [s.spine[0] + n[0] * 0.11, s.spine[1] + n[1] * 0.11];
};

// ---- the Warden
const wardenPath = path([
  [1.4, 9.0, 0],
  [2.4, 8.35, -1.2],
  [3.0, 7.05, -2.3],
  [3.6, 5.65, -2.3],
  [3.85, 5.05, -1.5],
  [4.0, 4.7, 0],
  [5.5, 4.7, 0],
  [5.85, 4.78, 0],
  [6.0, 4.55, null, 'snap'],
  [6.45, 4.55, 0],
  [6.8, 4.7, 0],
  [7.2, 4.7, 0],
  [7.3, 4.85, null, 'out'],
  [8.0, 4.88, 0],
  [8.6, 4.88, 0],
  [8.95, 5.05, 0],
  [10.4, 5.05, 0],
  [10.6, 5.6, null, 'snap'],
  [11.0, 5.6, 0],
  [11.2, 5.35, null, 'snap'],
  [11.6, 5.35, 0],
  [12.0, 5.5, 0],
]);
const wX = (t) => wardenPath.pos(t);
const wardenFeet = { N: [[0, 8.7, 0]], F: [[0, 9.3, 0]] };
runSteps(wardenFeet, LANDS, wardenPath, 'warden', 1.6, 7, {
  every: 0.4,
  stance: 0.46,
  h: 0.22,
  override: { 5: 5.05, 6: 4.35 },
});
wardenFeet.N.push(
  [5.86, 4.35, 0],
  [6.0, 4.23, 0, 0, 'snap'], // the lunge slides the front foot
  [6.45, 4.23, 0],
  [6.8, 4.35, 0],
  [8.85, 4.35, 0],
  [9.0, 4.65, 0, 0.1],
  [10.5, 4.65, 0],
  [10.7, 5.25, 0, 0.12],
  [10.95, 5.25, 0],
  [11.15, 4.95, 0, 0.15, 'snap'],
  [12.4, 4.95, 0],
);
wardenFeet.F.push(
  [8.6, 5.05, 0],
  [8.8, 5.35, 0, 0.12],
  [10.4, 5.35, 0],
  [10.55, 5.95, 0, 0.18, 'out'], // the step back
  [11.5, 5.95, 0],
  [11.8, 5.6, 0, 0.1],
);
LANDS.push(
  { t: 6.0, foot: 'N', x: 4.23, actor: 'warden', stance: 0.5, lunge: true },
  { t: 10.55, foot: 'F', x: 5.95, actor: 'warden', stance: 0.8, yield: true },
);
const warden = makeActor({
  name: 'warden',
  kind: 'spear',
  scale: 1.06,
  X: wardenPath,
  Zf: keyed([
    [0, 0],
    [11.6, 0],
    [12.3, -0.45],
  ]),
  face: () => -1,
  gait: { t0: 1.6, every: 0.4 },
  feet: { N: footTrack(wardenFeet.N), F: footTrack(wardenFeet.F) },
  pose: poseTrack(WARDEN_LIB, [
    [0, 'ready'],
    [1.4, 'ready'],
    [2.3, 'march'],
    [3.3, 'march'],
    [3.85, 'guard'],
    [5.5, 'guard'],
    [5.83, 'thrustAnt'],
    [6.0, 'thrust', 'snap'],
    [6.45, 'thrust'],
    [6.8, 'block'],
    [7.2, 'block'],
    [7.3, 'bindHold', 'out'],
    [9.55, 'bindHold'],
    [9.75, 'decide'],
    [10.2, 'decide'],
    [10.38, 'yieldAnt'],
    [10.4, 'yieldAnt'],
    [10.6, 'yield', 'snap'],
    [10.8, 'yield'],
    [11.08, 'wind'],
    [11.4, 'cutFollow', 'snap'],
    [11.6, 'cutFollow'],
    [12.0, 'standOver'],
    [13.6, 'standOver'],
  ]),
  action: labels([
    [0, 'stand'],
    [1.4, 'step'],
    [2.4, 'wade-march'],
    [4.0, 'guard'],
    [5.5, 'thrust'],
    [6.45, 'recover'],
    [6.8, 'guard'],
    [7.2, 'clash'],
    [7.4, 'bind'],
    [9.6, 'decide'],
    [10.4, 'yield-step'],
    [10.8, 'cut'],
    [11.5, 'recover'],
    [12.0, 'stand'],
  ]),
  aims: [
    { a: 7.1, b: 7.2, c: 10.7, d: 10.85, pt: bindPt, through: 'ray' },
    { a: 11.1, b: 11.2, c: 11.2, d: 11.32, pt: backPt, through: 'reach' },
  ],
});

// ---- the line: eight Empire soldiers on the bank, stepping in unison
const soldiers = Array.from({ length: 8 }, (_, i) => {
  const x0 = 11.0 + 0.43 * i;
  const p = path([
    [2.15, x0, 0],
    [3.25, x0 - 1.3, 0],
  ]);
  const ft = { N: [[0, x0 - 0.3, 0]], F: [[0, x0 + 0.3, 0]] };
  runSteps(ft, LANDS, p, `line${i}`, 2.4, 3, { every: 0.4, stance: 0.3, h: 0.12 });
  return makeActor({
    name: `line${i}`,
    kind: 'spear',
    scale: 0.95 + 0.02 * (i % 3),
    X: p,
    Zf: () => -0.3 * (i % 3),
    face: () => -1,
    gait: { t0: 2.4, every: 0.4 },
    feet: { N: footTrack(ft.N), F: footTrack(ft.F) },
    pose: poseTrack(SOLDIER_LIB, [
      [0, 'stand'],
      [2.15, 'stand'],
      [2.4, 'march'],
      [3.25, 'march'],
      [3.4, 'stand'],
    ]),
    action: labels([
      [0, 'stand'],
      [2.4, 'step'],
      [3.25, 'halt'],
    ]),
  });
});
LANDS.sort((a, b) => a.t - b.t);

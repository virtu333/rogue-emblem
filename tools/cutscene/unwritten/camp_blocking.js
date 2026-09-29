// "The Night Before": the scene's staging as data plus pure queries (CAMP.md). Step 2 of the
// method (plan flat before shooting): where everyone sits, which way they face, what each
// looks at and when, which gesture lands on which note, and where the camp's things stand.
// camp.js shoots from here so space stays continuous across the cuts; camp_previs.js draws it
// from above.
//
// Time is piece-local seconds: at(bar, beat) = T(bar, beat) - 6.4 (the piece starts on bar 5).
// Metres: X to the right of the default camera, Y up, Z away from it (the camera looks up +Z);
// the fire is the origin.

import { BAR, BEAT, T } from './engine/score.js';
import { lerpCam, lookAt } from './engine/world.js';

export const MUSIC_OFFSET = T(5, 1); // 6.4 s
export const FIRST_BAR = 5;
export const at = (bar, beat = 1) => T(bar, beat) - MUSIC_OFFSET;
export const DURATION = at(13); // 12.8 s
export { BAR, BEAT };

/** Beats into the piece (0 = bar 5 beat 1) -> seconds. */
export const beat = (b) => b * BEAT;

// ------------------------------------------------------------------ the score, bars 5-12

// the Thread on the lead guitar (battle_broken_sun.py: HOOK, then HOOK2 ending on the leading
// tone), beats from the start of bar 5
const HOOK =
  'B4:0.5 E5:0.5 F#5:0.5 B5:1.5 A5:0.5 G5:0.5 F#5:1.5 E5:0.5 F#5:1 A5:1 B5:1.5 A5:0.5 F#5:1 D5:1 E5:3 r:1';
const HOOK2 = HOOK.replace('D5:1 E5:3 r:1', 'D#5:1 E5:2 r:2');
const PITCH = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
export const NOTES = (() => {
  const out = [];
  let b = 0;
  for (const tok of `${HOOK} ${HOOK2}`.split(' ')) {
    const [n, d] = tok.split(':');
    const dur = Number(d);
    if (n !== 'r') {
      const m = /^([A-G])(#?)(\d)$/.exec(n);
      out.push({
        beat: b,
        t: b * BEAT,
        dur: dur * BEAT,
        midi: 12 * (Number(m[3]) + 1) + PITCH[m[1]] + (m[2] ? 1 : 0),
        name: n,
      });
    }
    b += dur;
  }
  return out;
})();

// the kit (the DRIVE pattern of bars 5-11 and the fill of bar 12), beats from the start of bar 5
const step = (bar, pattern) =>
  [...pattern].flatMap((ch, i) => (ch === '.' ? [] : [(bar - 5) * 4 + i * 0.25]));
const rep = (from, to, pattern) =>
  Array.from({ length: to - from + 1 }, (_, i) => step(from + i, pattern)).flat();
export const HITS = {
  kick: [...rep(5, 11, 'x.....x.x.....x.'), ...step(12, 'x.x.x.x...X.X...')].map(beat),
  snare: [...rep(5, 11, '....x.......x...'), ...step(12, '....x.....X.X...')].map(beat),
  crash: [...step(5, 'X'), ...step(9, 'X'), ...step(12, 'X.........X.....')].map(beat),
};

// ------------------------------------------------------------------ the shots' edges

/** The shots' start and end, on the tune (S1 opens on the crash; S7 starts on the leading tone). */
export const S = {
  crane: [at(5, 1), at(7, 1)], // the sky, tilt down to the camp
  three: [at(7, 1), at(8, 1)], // the three-shot
  sera: [at(8, 1), at(9, 1)], // Sera, the long E
  sky: [at(9, 1), at(10, 1)], // what she sees, on the crash
  edric: [at(10, 1), at(11, 1)], // Edric's eyes lift
  kira: [at(11, 1), at(11, 4)], // Kira sees him look
  rise: [at(11, 4), DURATION], // he rises, on the leading tone
};

/** Named moments (piece-local seconds). */
export const TIME = {
  crash: at(5, 1), // 0.0   the Thread flares
  settle: at(6, 3), // 2.4   the crane comes to rest on the camp
  serarest: at(8, 4), // 5.6   the melody rests; her eyes come down
  crash2: at(9, 1), // 6.4   what she sees
  edricLift: at(10, 2), // 8.0   his eyes lift
  edricMeet: at(10, 3), // 8.8   they meet
  kiraStop: at(11, 1), // 9.6   the tapping stops
  kiraFold: at(11, 2), // 10.0  she folds the map
  rise: at(11, 4), // 11.2  on the leading tone, his hand goes down
  standing: at(12, 3), // 12.0  he is up
  hit: at(12, 3.5), // 12.3  the big hit: kick + snare + crash
  hit2: at(12, 4), // 12.4  the second
  end: DURATION,
};

// ------------------------------------------------------------------ the people

/**
 * Where each sits (metres; the seat's ground point) and which way they face (+1 toward +X),
 * their eye height above the ground when seated (m), and what they are doing when. `gaze` is
 * a list of [t, target] keys (a target is a person, 'fire', 'sky', 'map' or a point [X, Y, Z]).
 * `gestures`: [t0, t1, name, on] where `on` names the note or hit it lands on.
 */
export const FIRE = { x: 0, z: 0, y: 0.5, r: 0.55 };

export const PEOPLE = {
  edric: {
    seat: [-1.55, 0.15],
    face: 1,
    eyeY: 1.05,
    height: 1.78, // standing
    gaze: [
      [0, 'fire'],
      [TIME.edricLift, 'sera'],
      [at(10, 4), 'sera'],
      [at(11, 2), 'fire'],
      [TIME.rise, 'sky'],
    ],
    gestures: [
      [TIME.edricLift - 0.4, TIME.edricLift + 0.4, 'lifts his eyes', 'E5 (10.2)'],
      [TIME.edricMeet, at(11, 1), 'breath out, the ghost of a smile', 'A5 (10.4)'],
      [TIME.rise, TIME.standing, 'puts a hand down and rises', 'D#5 (11.4)'],
      [TIME.standing, TIME.end, 'stands looking at the Thread', 'the big hit (12.3.5)'],
    ],
  },
  sera: {
    seat: [1.45, -0.1],
    face: -1,
    eyeY: 0.98,
    height: 1.68,
    gaze: [
      [0, 'sky'],
      [TIME.serarest, 'edric'],
      [at(9, 1), 'sky'],
      [at(10, 1), 'edric'],
    ],
    gestures: [
      [at(8, 1), at(8, 4), 'looks up: a breath, a glint in her eye', 'E5 held (8.1)'],
      [TIME.serarest, at(9, 1), 'one slow blink, her eyes come down', 'the rest (8.4)'],
    ],
  },
  kira: {
    seat: [1.05, 1.75],
    face: -1,
    eyeY: 1.35, // on the crate
    height: 1.72,
    gaze: [
      [0, 'map'],
      [TIME.kiraStop, 'edric'],
      [TIME.kiraFold, 'map'],
    ],
    gestures: [
      [0, TIME.kiraStop, 'taps the map', 'the drive'],
      [TIME.kiraStop, TIME.kiraFold, 'the finger stops, her eyes go to Edric', 'B5 (11.1)'],
      [TIME.kiraFold, at(11, 4), 'folds the map', 'A5 (11.2)'],
    ],
  },
};

// ------------------------------------------------------------------ the camp

/**
 * The set. Tents: (x, z) centre, ridge length L, width w, height h, door toward the fire
 * (yaw is set from the position plus a little jitter). The rest is dressing that gives the
 * light something to fall on: the fire's stones and logs, stumps and a bench, barrels and
 * crates, a spear tripod, the banner pole, a palisade, far sentry fires.
 */
export const SET = {
  // Ridge tents. (x, z) centre, ridge length L, width w, pole height h, `yaw` the ridge's direction
  // (its -u end, the door, faces the fire when the yaw points away from it), `sag` how far the ridge
  // dips between the poles (m), `open` a door left open (a dark flap). Sizes, angles and sags differ;
  // some stand half behind others, or behind the barrels.
  tents: [
    { x: -6.4, z: 5.8, L: 4.2, w: 3.1, h: 2.6, yaw: 0.34, sag: 0.2 },
    { x: -1.9, z: 11.0, L: 3.4, w: 2.6, h: 2.2, yaw: 1.2, sag: 0.13, open: true },
    { x: 4.6, z: 9.8, L: 4.8, w: 3.4, h: 2.9, yaw: -0.3, sag: 0.24 },
    { x: 0.9, z: 14.6, L: 3.6, w: 2.8, h: 2.4, yaw: 0.5, sag: 0.16 }, // peeks between the two
    { x: 7.8, z: 5.2, L: 3.9, w: 2.9, h: 2.4, yaw: 0.22, sag: 0.15 },
    { x: 6.0, z: 7.6, L: 2.5, w: 1.9, h: 1.55, yaw: 0.05, sag: 0.09 }, // a one-man wedge behind the barrels
    { x: -12.4, z: 2.6, L: 4.0, w: 3.0, h: 2.5, yaw: 0.9, sag: 0.17 },
    { x: 14.6, z: 1.6, L: 5.6, w: 4.0, h: 3.3, yaw: -0.45, sag: 0.26, rope: 2.0 },
    { x: -10.6, z: 12.8, L: 5.6, w: 4.0, h: 3.2, yaw: 0.12, sag: 0.25 },
    { x: -16.4, z: 8.5, L: 4.4, w: 3.2, h: 2.7, yaw: 1.0, sag: 0.18 },
    { x: 12.0, z: 12.6, L: 4.6, w: 3.4, h: 2.8, yaw: 0.3, sag: 0.2 },
  ],
  stumps: [
    { x: -3.3, z: -1.0, r: 0.26, h: 0.42 },
    { x: 3.1, z: -0.6, r: 0.22, h: 0.36 },
    { x: -3.6, z: 0.8, r: 0.24, h: 0.4 },
  ],
  benches: [{ x: -3.2, z: 1.9, sx: 0.85, sz: 0.16, h: 0.38, yaw: 0.5 }],
  barrels: [
    { x: 5.4, z: 6.6, r: 0.36, h: 0.85 },
    { x: 6.1, z: 7.1, r: 0.34, h: 0.8 },
    { x: -4.3, z: 7.7, r: 0.35, h: 0.82 },
  ],
  crates: [
    { x: 5.9, z: 5.7, sx: 0.4, sy: 0.32, sz: 0.4, yaw: 0.3 },
    { x: -0.6, z: 6.2, sx: 0.42, sy: 0.3, sz: 0.34, yaw: -0.2 },
    { x: 1.05, z: 1.75, sx: 0.4, sy: 0.24, sz: 0.34, yaw: 0.1, hidden: true }, // Kira's crate is drawn
  ],
  // What carries each person's weight (CRAFT.md, Grounding). A seat is part of the world: drawn,
  // lit by the fire, with its own contact shadow, and the figure's contact plane is its top.
  //   slab:    a flat faceted rock (a, c half lengths along its yaw, b thickness scale, crown 0..1)
  //   blanket: a folded striped blanket (sx, sz half sizes, h thick)
  //   Kira sits on the crate her drawing already paints, so her seat is only a footprint (`ghost`)
  //   that gives the ground a contact shadow and the fire something to throw one from.
  seats: [
    {
      id: 'edric',
      kind: 'slab',
      x: -1.47,
      z: 0.38,
      a: 0.7,
      c: 0.5,
      b: 0.12,
      crown: 0.72,
      yaw: 0.1,
    },
    { id: 'sera', kind: 'blanket', x: 1.45, z: 0.24, sx: 0.5, sz: 0.4, h: 0.06, yaw: -0.14 },
    { id: 'kira', kind: 'ghost', x: 1.05, z: 1.75, sx: 0.42, sz: 0.34, h: 0.5, yaw: 0.1 },
  ],
  // three spears leaning together (bases around a point, tips meeting 2.4 m up)
  tripod: { x: -5.0, z: 3.4 },
  banner: { x: 7.6, z: 5.2, h: 3.3 },
  palisade: { z: 15.5, x0: -16, x1: 18, bow: 2.4 },
  // far sentry fires and the ridge sentry
  farFires: [
    { x: 17, z: 26 },
    { x: -19, z: 33 },
    { x: 31, z: 44 },
    { x: -34, z: 52 },
  ],
};

// ------------------------------------------------------------------ the Thread

/**
 * The Thread across the sky, as an arc of directions (radians): from behind the west ridge,
 * over the camp, down behind the east: azimuth 0 is straight up +Z, positive toward +X.
 */
export const THREAD = {
  az0: -1.95,
  az1: 1.75,
  peak: 0.62, // elevation at the top of the arc
  skew: 0.28, // the arc leans (peak nearer az 0.28)
  wave: 0.012,
};

// ------------------------------------------------------------------ the cameras

const sm = (a, b, v) => {
  const k = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return k * k * (3 - 2 * k);
};
const mix = (a, b, k) => a + (b - a) * k;

/**
 * The seven cameras as data (world.js cameras: x, y, z, yaw, pitch, roll, focal), each a
 * function of shot-local time. camp.js shoots through them and camp_previs.js draws their
 * frusta from above. The camera stays on one side of the line (south of the fire, looking
 * north) except for the last low angle, and moves only in slow pushes, one tilt down at
 * the top and one tilt up at the end.
 */
export const CAMERA = {
  // the sky, held for the crash and the first notes; then a long tilt down to the camp
  crane: (lt) => {
    const k = sm(0, 1, (lt - 0.45) / 2.35) ** 0.9;
    const c = lerpCam(
      { x: 1.2, y: 2.4, z: -13.5, yaw: 0.3, pitch: 0.72, roll: 0, focal: 300 },
      { x: -0.2, y: 1.25, z: -6.6, yaw: 0.0, pitch: -0.02, roll: 0, focal: 310 },
      k,
    );
    // never a frozen card: the sky drifts a little even while the camera waits
    return { ...c, yaw: c.yaw - 0.02 * lt * (1 - k), pitch: c.pitch + 0.012 * lt * (1 - k) };
  },
  // the three-shot: low, from the south, a slow push
  three: (lt) => {
    const k = lt / 1.6;
    return lookAt(
      { x: mix(-0.35, 0.05, k), y: 0.72, z: mix(-3.5, -3.15, k) },
      { x: 0.05, y: 1.02, z: 0.6 },
      { focal: 340 },
    );
  },
  // Sera close: from the south-east, so the fire is at the left edge and lights her face
  sera: (lt) => {
    const k = lt / 1.6;
    return lookAt(
      { x: mix(1.35, 1.42, k), y: 0.85, z: mix(-1.5, -1.38, k) },
      { x: 1.08, y: 0.95, z: 0 },
      { focal: 540 },
    );
  },
  // what she sees: the sky, wide and canted, a slow drift along the Thread
  sky: (lt) => {
    const k = lt / 1.6;
    return lookAt(
      { x: mix(-0.2, 0.5, k), y: 0.8, z: -3.2 },
      { x: mix(-2.0, 1.0, k), y: mix(4.6, 5.8, k), z: 6 },
      { focal: 250, roll: mix(0.08, 0.15, k) },
    );
  },
  // Edric from the south-west, close: the fire is at the right edge and lights his face
  edric: (lt) => {
    const k = lt / 1.6;
    return lookAt(
      { x: mix(-2.35, -2.15, k), y: 0.9, z: mix(-1.45, -1.3, k) },
      { x: -1.65, y: 0.92, z: 0.15 },
      { focal: 520 },
    );
  },
  // Kira from the south-east: she faces the fire, so it lights her; a slow push
  kira: (lt) => {
    const k = lt / 1.2;
    return lookAt(
      { x: mix(2.45, 2.3, k), y: 1.25, z: mix(0.4, 0.55, k) },
      { x: 1.0, y: 1.32, z: 1.75 },
      { focal: 560 },
    );
  },
  // he rises: a low camera close to him that tilts up as he stands; then one move on the fill:
  // a breath of anticipation (a small dolly in, 0.55-0.72), a fast middle, a long settle back and
  // up that arrives on the big hit (1.4) and keeps drifting after it: he is small under the Thread
  rise: (lt) => {
    const eye = { x: -1.95, y: 0.5, z: -1.85 };
    const tilt = (l) => mix(0.85, 1.55, sm(0.1, 1.0, l));
    const cam = (l, dolly = 0) => {
      // toward the seat along the ground, by `dolly` metres
      const dx = 0.5;
      const dz = 2.0;
      const n = Math.hypot(dx, dz);
      return lookAt(
        { x: eye.x + (dx / n) * dolly, y: eye.y, z: eye.z + (dz / n) * dolly },
        { x: -1.45, y: tilt(l), z: 0.15 },
        { focal: 350 + 6 * (dolly / 0.16) },
      );
    };
    const T0 = 0.55; // anticipation starts
    const T1 = 0.72; // the pull-back starts
    const T2 = 1.6; // and is done
    if (lt < T0) return cam(lt);
    const dolly = 0.16 * sm(T0, T1, lt);
    if (lt < T1) return cam(lt, dolly);
    const far = { x: -0.75, y: 0.42, z: -3.55, yaw: 0.05, pitch: 0.26, roll: 0, focal: 315 };
    // smootherstep: slow out of the anticipation, fast in the middle, a long settle
    const u = Math.min(1, (lt - T1) / (T2 - T1));
    const k = u * u * u * (u * (6 * u - 15) + 10);
    const c = lerpCam(cam(T1, 0.16), far, k);
    // after the hit the camera keeps drifting back, very slowly: the last frame is never frozen
    return {
      ...c,
      z: c.z - 0.12 * Math.max(0, lt - 1.4),
      pitch: c.pitch + 0.006 * Math.max(0, lt - 1.4),
    };
  },
};

// ------------------------------------------------------------------ queries

const P3 = (name) => {
  const p = PEOPLE[name];
  return { x: p.seat[0], y: p.eyeY, z: p.seat[1] };
};

/** World point a gaze target names. */
export function targetPoint(tg) {
  if (Array.isArray(tg)) return { x: tg[0], y: tg[1], z: tg[2] };
  if (tg === 'fire') return { x: FIRE.x, y: FIRE.y, z: FIRE.z };
  if (tg === 'sky') return { x: 0, y: 30, z: 20 };
  if (tg === 'map') return { x: 0, y: 0.5, z: 1.6 };
  return P3(tg);
}

/** What a person looks at at time t. */
export function gazeTarget(who, t) {
  const keys = PEOPLE[who].gaze;
  let g = keys[0][1];
  for (const [k, tg] of keys) if (t >= k - 1e-9) g = tg;
  return g;
}

/** The direction (unit) from a person's eyes to what they look at, at time t. */
export function gazeDir(who, t) {
  const e = P3(who);
  const p = targetPoint(gazeTarget(who, t));
  const d = [p.x - e.x, p.y - e.y, p.z - e.z];
  const l = Math.hypot(...d) || 1;
  return d.map((v) => v / l);
}

/** The gesture in progress for a person at time t, or null. */
export function gestureAt(who, t) {
  for (const g of PEOPLE[who].gestures) if (t >= g[0] && t < g[1]) return g[2];
  return null;
}

/** The world point of a person's seat (feet) and of their eyes. */
export const seatOf = (who) => ({ x: PEOPLE[who].seat[0], y: 0, z: PEOPLE[who].seat[1] });
export const eyesOf = P3;

/** Checks the staging is one physical story; returns the list of problems (empty = fine). */
export function validate() {
  const bad = [];
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  // the eyelines that carry the scene: each looks the way they face
  const faceOk = (who, tg) => {
    const g = PEOPLE[who];
    const d = gazeDir(who, tg);
    return Math.sign(d[0]) === g.face || Math.abs(d[0]) < 0.1;
  };
  if (!faceOk('edric', TIME.edricMeet))
    bad.push('Edric cannot look at Sera facing the way he sits');
  if (!faceOk('sera', TIME.serarest)) bad.push('Sera cannot look at Edric facing the way she sits');
  if (!faceOk('kira', TIME.kiraStop)) bad.push('Kira cannot look at Edric facing the way she sits');
  // the circle is small enough to talk across and wide enough for the fire
  for (const a of Object.keys(PEOPLE))
    for (const b of Object.keys(PEOPLE))
      if (a < b) {
        const d = dist(
          { x: PEOPLE[a].seat[0], z: PEOPLE[a].seat[1] },
          { x: PEOPLE[b].seat[0], z: PEOPLE[b].seat[1] },
        );
        if (d < 1.5 || d > 4.2) bad.push(`${a} and ${b} sit ${d.toFixed(2)} m apart`);
      }
  for (const [n, p] of Object.entries(PEOPLE)) {
    const d = dist({ x: p.seat[0], z: p.seat[1] }, FIRE);
    if (d < 1.2 || d > 2.4) bad.push(`${n} sits ${d.toFixed(2)} m from the fire`);
  }
  // shots run edge to edge on the tune's notes or the kit's hits
  const edges = Object.values(S).flat();
  const onsets = [...NOTES.map((n) => n.t), ...HITS.crash, ...HITS.kick];
  for (const e of edges)
    if (e > 0.001 && e < DURATION - 0.001 && !onsets.some((o) => Math.abs(o - e) < 0.02))
      bad.push(`a cut at ${e.toFixed(3)} s is not on a note or a hit`);
  let prev = 0;
  for (const [n, [a, b]] of Object.entries(S)) {
    if (Math.abs(a - prev) > 0.001) bad.push(`shot ${n} does not start where the last ended`);
    prev = b;
  }
  if (Math.abs(prev - DURATION) > 0.001) bad.push('the shots do not fill the piece');
  return bad;
}

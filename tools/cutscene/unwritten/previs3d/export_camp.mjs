// Export "The Night Before" for the Blender previs: the shots' cameras at 24 fps (camp_blocking
// CAMERA, as camp.js shoots them), each person's seat, facing and gaze point per frame, the
// gestures, the fire and the set. Pure: no browser.
//
//   node tools/cutscene/unwritten/previs3d/export_camp.mjs [--out file.json]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const i = process.argv.indexOf('--out');
const OUT = i < 0 ? path.join(ROOT, 'References/cutscene/previs3d/camp.json') : process.argv[i + 1];
const FPS = 24;

const C = await import('../camp_blocking.js');
const n = Math.round(C.DURATION * FPS);
const shots = Object.entries(C.S).map(([name, [from, to]]) => ({ name, from, to }));
const shotAt = (t) => shots.find((s) => t >= s.from && t < s.to) || shots[shots.length - 1];

const cams = [];
const gaze = Object.fromEntries(Object.keys(C.PEOPLE).map((k) => [k, []]));
const gesture = Object.fromEntries(Object.keys(C.PEOPLE).map((k) => [k, []]));
for (let f = 0; f <= n; f++) {
  const t = f / FPS;
  const s = shotAt(t);
  cams.push({ t, shot: s.name, cam: C.CAMERA[s.name](t - s.from) });
  for (const who of Object.keys(C.PEOPLE)) {
    const p = C.targetPoint(C.gazeTarget(who, t));
    gaze[who].push([p.x, p.y, p.z]);
    gesture[who].push(C.gestureAt(who, t));
  }
}

const data = {
  piece: 'camp',
  fps: FPS,
  duration: C.DURATION,
  time: C.TIME,
  shots,
  fire: C.FIRE,
  people: C.PEOPLE,
  set: C.SET,
  cams,
  gaze,
  gesture,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data));
console.log(`wrote ${OUT}: ${n + 1} frames, ${shots.length} shots`);

// Export "The Ford" for the Blender previs: every actor's solved skeleton at 24 fps from
// ford_blocking.js, the stones, the water and bed profile, the events, and (with --cams)
// the camera each frame was actually rendered through, logged from the running piece.
//
//   node tools/cutscene/unwritten/previs3d/export_ford.mjs [--cams] [--out file.json]
//
// The skeleton is the blocking's 2D side-on figure (X along the crossing, Y up) at the actor's
// depth Z; Blender spreads the near and far limbs across the body's width. The cameras come
// from the browser because each shot computes its own (orbits, cranes, shake): a hook on
// World.prototype.render records the camera and the actors passed to it, per frame.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');
const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i < 0 ? d : process.argv[i + 1];
};
const OUT = arg('out', path.join(ROOT, 'References/cutscene/previs3d/ford.json'));
const FPS = 24;

const B = await import('../ford_blocking.js');
const n = Math.round(B.DURATION * FPS);
const actors = {};
for (const name of Object.keys(B.ACTORS)) {
  const a = B.ACTORS[name];
  actors[name] = { kind: a.kind, scale: a.scale, dims: a.dims, frames: [] };
  for (let i = 0; i <= n; i++) {
    const t = i / FPS;
    const s = a.skeleton(t);
    actors[name].frames.push({
      facing: s.facing,
      Z: s.Z,
      hips: s.hips,
      spine: s.spine,
      neck: s.neck,
      head: s.head,
      shoulder: s.shoulder,
      legs: s.legs,
      arms: s.arms,
      weapon: { kind: s.weapon.kind, butt: s.weapon.butt, tip: s.weapon.tip },
      action: a.action ? a.action(t) : null,
    });
  }
}
const bed = [];
for (let X = -20; X <= 20.001; X += 0.25) bed.push([X, B.bedY(X)]);

const data = {
  piece: 'ford',
  fps: FPS,
  duration: B.DURATION,
  time: B.TIME,
  stones: B.STONES,
  bed,
  events: B.EVENTS,
  actors,
  cams: null,
};

if (process.argv.includes('--cams')) data.cams = await captureCams();

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(data));
console.log(`wrote ${OUT}: ${n + 1} frames, ${Object.keys(actors).length} actors` +
  (data.cams ? `, ${data.cams.filter(Boolean).length} frames with a world camera` : ''));

async function captureCams() {
  const { createServer } = await import('vite');
  const { chromium } = await import('playwright');
  const server = await createServer({
    root: ROOT,
    logLevel: 'error',
    server: { port: 3291, strictPort: false, host: '127.0.0.1', hmr: false, watch: null },
  });
  await server.listen();
  const base = server.resolvedUrls.local[0].replace(/\/$/, '');
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
  try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => console.error('page error:', e.message));
    await page.goto(`${base}/tools/cutscene/unwritten/index.html?export=1&piece=ford`);
    await page.waitForFunction(() => window.cutscene);
    await page.evaluate(async () => {
      const W = await import('/tools/cutscene/unwritten/engine/world.js');
      const proto = W.World.prototype;
      const orig = proto.render;
      window.__camlog = [];
      proto.render = function (f, t, cam, o = {}) {
        // the world's own ground (it has a shoal the blocking doesn't) and stones, once
        if (!window.__ground) {
          const xs = [];
          const zs = [];
          for (let X = -16; X <= 16.001; X += 0.2) xs.push(+X.toFixed(2));
          for (let Z = -14; Z <= 10.001; Z += 0.2) zs.push(+Z.toFixed(2));
          window.__ground = {
            xs,
            zs,
            ground: zs.map((Z) => xs.map((X) => this.groundY(X, Z))),
            stand: zs.map((Z) => xs.map((X) => this.standY(X, Z))),
            stones: this.stones.map((s) => ({
              X: s.X, Z: s.Z, a: s.a, c: s.c, ex: s.ex, ez: s.ez, top: s.top,
              slick: !!s.slick,
            })),
          };
        }
        window.__camlog.push({
          t,
          cam: { ...cam },
          stage: o.stage ?? 0,
          actors: (o.actors || []).map((a) => ({
            name: a.name ?? a.id ?? null,
            X: a.X,
            Y: a.Y,
            Z: a.Z,
          })),
        });
        return orig.call(this, f, t, cam, o);
      };
    });
    const cams = [];
    for (let i = 0; i <= n; i++) {
      const t = i / FPS;
      const log = await page.evaluate((tt) => {
        window.__camlog = [];
        window.cutscene.frame(tt);
        return window.__camlog;
      }, t);
      // a frame may render the world more than once (a transition): keep the last (on top)
      cams.push(log.length ? { ...log[log.length - 1], passes: log.length } : null);
    }
    data.world = await page.evaluate(() => window.__ground);
    data.shots = await page.evaluate(() => window.cutscene.ready.shots);
    return cams;
  } finally {
    await browser.close();
    await server.close();
  }
}

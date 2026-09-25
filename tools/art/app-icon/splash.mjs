// splash.mjs — the iOS launch image: the Hollow Dawn mark on the void.
//
//   node tools/art/app-icon/splash.mjs
//
// Replaces Capacitor's placeholder (a blue X on white) in
// ios/App/App/Assets.xcassets/Splash.imageset/ (the three file names Contents.json lists
// for 1x/2x/3x; same bytes each). The mark is the shipped icon's: the Hollow Sun with a
// crimson-to-ember corona and the gold horizon thread beneath it, no text. The field is
// the palette's void (uiPalette.json `void`), which LaunchScreen.storyboard also uses as
// its background colour.
//
// Centre-safe: the storyboard aspect-fills this 2732 square, so a landscape phone shows
// only the centre ~1260 rows and a portrait phone only the centre ~1260 columns. The
// whole mark (a 560 px plate) sits inside both.

import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Plate, INK, EMB, BLD, UNL, GOLD, pick, dist, smooth, angDiff } from './lib.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const OUT = join(root, 'ios', 'App', 'App', 'Assets.xcassets', 'Splash.imageset');
const UI = JSON.parse(readFileSync(join(root, 'src', 'ui', 'uiPalette.json'), 'utf8'));
const FIELD = UI.void; // #07060b, the palette void (also the storyboard background)
const SIZE = 2732;
const GRID = 112;
const SCALE = 5; // 560 px plate

export function renderSplashPlate() {
  const p = new Plate(GRID);
  const C = { x: 56, y: 52 };
  const R = 20;
  const beadAng = (-135 * Math.PI) / 180;
  const bead = { x: C.x + Math.cos(beadAng) * R, y: C.y + Math.sin(beadAng) * R };
  // the icon's dusk-to-dawn corona: violet night, crimson, ember
  const RAMP = [FIELD, INK[1], UNL[0], UNL[1], BLD[1], BLD[2], EMB[2], BLD[4], EMB[3]];
  const HZ = C.y + R + 7; // the horizon thread
  p.paint((x, y, ix, iy) => {
    const d = dist(x, y, C.x, C.y);
    let L = 0;
    if (d > R) {
      const out = d - R;
      L = 4.8 * Math.exp(-out / 3.2) + 2.2 * Math.exp(-out / 12);
      const db = dist(x, y, bead.x, bead.y);
      L += 1.4 * Math.exp(-((db / 7) ** 2));
    }
    // dawn pooling along the horizon under the sun
    L +=
      3.4 *
      Math.exp(-(((y - HZ) / 4) ** 2)) *
      Math.exp(-(((x - C.x) / 22) ** 2)) *
      (y < HZ ? 1 : 0.4);
    // fade exactly to the field well before the plate edge (no seam)
    L *= 1 - smooth(34, 52, d);
    return pick(RAMP, L, ix, iy);
  });
  p.paint((x, y) => (dist(x, y, C.x, C.y) < R ? INK[0] : null));
  // corona ring, thickening toward the diamond-ring bead
  p.paint((x, y) => {
    const d = dist(x, y, C.x, C.y);
    const near = Math.cos(
      Math.min(Math.PI, Math.abs(angDiff(Math.atan2(y - C.y, x - C.x), beadAng))),
    );
    const w = 1 + Math.max(0, near) * 0.9;
    if (d >= R && d < R + w) return near > 0.9 ? EMB[6] : near > -0.1 ? EMB[5] : EMB[4];
    if (d < R && d >= R - Math.max(0, near) * 1.2) return EMB[5];
    return null;
  });
  // the horizon thread: gold at the centre, fading to the void both ways
  p.paint((x, y, ix, iy) => {
    if (iy !== HZ) return null;
    const t = Math.abs(x - C.x) / 50;
    if (t >= 1) return null;
    const ramp = [FIELD, EMB[1], EMB[2], EMB[3], EMB[4], EMB[5], EMB[6]];
    return pick(ramp, (1 - t) ** 1.3 * 6.2, ix, iy);
  });
  // the bead: a small four-point glint
  p.paint((x, y, ix, iy) => {
    const dx = x - bead.x;
    const dy = y - bead.y;
    const d = Math.hypot(dx, dy);
    let L = 6 * Math.exp(-((d / 1.4) ** 2));
    L += 3.6 * Math.exp(-((dy / 0.55) ** 2)) * Math.exp(-Math.abs(dx) / 3.2);
    L += 3.6 * Math.exp(-((dx / 0.55) ** 2)) * Math.exp(-Math.abs(dy) / 3.2);
    return L < 1.3 ? null : pick(GOLD, 2.6 + L * 0.8, ix, iy);
  });
  return p;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const plate = await renderSplashPlate().png(GRID * SCALE);
  const off = Math.round((SIZE - GRID * SCALE) / 2);
  const png = await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: FIELD } })
    .composite([{ input: plate, left: off, top: off }])
    .removeAlpha()
    .png({ palette: true, colours: 64, dither: 0, compressionLevel: 9, effort: 10 })
    .toBuffer();
  const { writeFile } = await import('node:fs/promises');
  for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png']) {
    await writeFile(join(OUT, name), png);
  }
  console.log(`wrote ios splash x3 (${SIZE}x${SIZE}, ${(png.length / 1024).toFixed(0)} KB each)`);
}

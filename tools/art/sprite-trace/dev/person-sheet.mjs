// Dev: portrait person next to their baked map sprite, for every class x person, so the
// pairs can be checked by eye (docs/art-direction/sprites-v3/people_*.png).
//
//   node tools/art/sprite-trace/dev/person-sheet.mjs <out.png> [--classes fighter,warrior]
//        [--zoom 2] [--portrait 96] [--per 5] [--npc] [--top]  (--top: upper body only)
//
// Each tile: the PC-98 portrait the unit shows in that class (public/assets/portraits/pc98)
// | the traced sprite's rest frame on grass, cropped to the figure's cell. --npc bakes the
// verdigris NPC version instead of the player one.
import { existsSync } from 'node:fs';
import { readRaster, writePng, textRaster } from '../lib/io.mjs';
import { Raster, hstack, vstack } from '../lib/raster.mjs';
import { bakeFrames } from '../lib/pipeline.mjs';
import { swatch } from '../lib/terrain.mjs';
import { GENERIC_CLASSES, PORTRAIT_VARIANTS, peopleForClass, personEntry } from '../roster.mjs';

const args = process.argv.slice(2);
const flag = (n, d) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const out = args[0];
const Z = +flag('zoom', 2);
const P = +flag('portrait', 96);
const per = +flag('per', 5);
const npc = args.includes('--npc');
const only = flag('classes', null)?.split(',');
const INK = [24, 24, 28, 255];
const PLATE = [66, 72, 84, 255];
const grass = swatch('grass');

const onGrass = (img) => {
  const bg = new Raster(img.w, img.h);
  for (let y = 0; y < img.h; y += grass.h)
    for (let x = 0; x < img.w; x += grass.w) bg.draw(grass, x, y);
  return bg.draw(img, 0, 0);
};

async function portrait(id) {
  const file = `public/assets/portraits/pc98/${P}/${id}.png`;
  const plate = new Raster(P, P).fillRect(0, 0, P, P, PLATE);
  if (!id || !existsSync(file)) return plate;
  return plate.draw(await readRaster(file), 0, 0);
}

const rows = [];
for (const [cls] of GENERIC_CLASSES) {
  if (only && !only.includes(cls)) continue;
  const className = Object.keys(PORTRAIT_VARIANTS.classes).find(
    (c) => c.toLowerCase().replace(/ /g, '_') === cls,
  );
  const tiles = [];
  for (const person of peopleForClass(cls)) {
    const entry = personEntry(cls, person, npc ? 'npc' : 'player');
    const { still } = await bakeFrames(entry);
    // the figure's part of the 96 px cell (feet on row 66)
    const top = args.includes('--top');
    const cell = still.w === 96 ? still.crop(top ? 16 : 8, 4, top ? 64 : 80, top ? 40 : 68) : still;
    const sprite = onGrass(cell).scale(Z);
    const face = await portrait(PORTRAIT_VARIANTS.identities[person].renders[className]);
    const h = Math.max(face.h, sprite.h);
    const pair = hstack([face, sprite], 2, INK);
    const w = entry.person;
    const label = await textRaster(
      `${person} ${w.g} ${w.design.toUpperCase()}\n${w.skin.replace('skin', '')} ${w.hair.replace('hair', '')}${w.bald ? ' bald' : ''}`,
      { size: 10, bg: '#18181c', width: pair.w },
    );
    tiles.push(vstack([pair, label]));
    void h;
  }
  const title = await textRaster(className, { size: 12, bg: '#18181c', width: 110 });
  for (let i = 0; i < tiles.length; i += per)
    rows.push(
      hstack(
        [
          i ? await textRaster('', { bg: '#18181c', width: 110 }) : title,
          ...tiles.slice(i, i + per),
        ],
        6,
        INK,
      ),
    );
}
await writePng(vstack(rows, 6, INK), out);
console.log(`wrote ${out}`);

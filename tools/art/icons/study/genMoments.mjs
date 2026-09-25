// Generated art for the "moments": blessing card paintings and service vignettes,
// then the PC-98 scene treatment (lib/sceneTreat.mjs) at display resolution.
//   node tools/art/icons/study/genMoments.mjs [--only id,id] [--treat-only]
// Raw generations + provenance: References/items-study/gen/moments (gitignored).
import fs from 'node:fs';
import sharp from 'sharp';
import { MODELS } from '../../gen/geminiImage.mjs';
import { treatScene } from '../lib/sceneTreat.mjs';
import { paced } from './paced.mjs';

const argv = process.argv.slice(2);
const model = MODELS[argv.includes('--model') ? argv[argv.indexOf('--model') + 1] : 'pro'];
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const RAW = 'References/items-study/gen/moments';
const OUT = 'References/items-study/moments';

const WORLD =
  '1990s Japanese PC-98 computer game illustration: painted pixel art with a limited palette, visible ' +
  'ordered dithering in gradients, clean dark ink linework, flat cel shading. A dusk-lit, melancholy ' +
  'fantasy world going dark; the only warm light is candle, forge and ember gold. Palette: deep ink ' +
  'violet-black, ember gold, crimson, verdigris green, cold steel blue, bone white. Low warm key light ' +
  'from the upper left, shadows lean violet. No text, no letters, no logo, no border, no frame, no UI.';

const CARD =
  `${WORLD} Vertical tarot-like card painting (art only; the frame is added later), a single clear ` +
  'subject with a strong silhouette in the middle two-thirds, simple dark background with room at the ' +
  'top and bottom. Where a sky shows, a black eclipse sun with a thin gold corona (the Hollow Sun). ' +
  'Full-bleed: the painting runs edge to edge on all four sides, no white margin, no inner panel, no card border.';

const SCENE =
  `${WORLD} Wide establishing vignette of an interior or place, no people facing the viewer, the ` +
  'subject in the right half with darker quieter space on the left for menu text, strong ' +
  'depth, a warm focal light.';

export const MOMENTS = [
  // Blessing cards (id = blessing id).
  {
    id: 'coin_of_fate',
    kind: 'card',
    subject:
      'a stone shrine altar with a small heap of offered coins in candlelight, one gold coin turning in the air above an open pilgrim hand',
  },
  {
    id: 'steady_hands',
    kind: 'card',
    subject:
      "an archer's gloved hands drawing a bowstring beside a perfectly still shrine pool that reflects the eclipse sun",
  },
  {
    id: 'field_medic',
    kind: 'card',
    subject:
      'a shrine doorway at dusk, a hooded sister holding out a small clay jar of green salve, candle glow behind her, her face hidden in shadow',
  },
  {
    id: 'scholar_vow',
    kind: 'card',
    subject:
      "a novice's desk in a candlelit shrine library: an open book, a quill, a tall stack of books, one candle",
  },
  {
    id: 'iron_oath',
    kind: 'card',
    subject:
      'an armoured gauntlet laid palm-down on a black anvil stone, sworn, ember light from below',
  },
  {
    id: 'pilgrim_coin',
    kind: 'card',
    subject:
      'a scallop-shell pilgrim token on a knotted cord, held above a roadside stall with coins and scales',
  },
  {
    id: 'forbidden_tome',
    kind: 'card',
    subject:
      'an ancient book bound in iron chains on a crypt shelf, faint violet light leaking from between its pages, dust',
  },
  {
    id: 'blood_forge',
    kind: 'card',
    subject:
      'a sword blade being quenched in a stone basin of dark red blood at a black forge, a hiss of steam and sparks',
  },
  // Service vignettes.
  {
    id: 'forge',
    kind: 'scene',
    subject:
      'a village forge at dusk: a heavy anvil with a glowing orange blade on it, sparks in the air, a hammer, bellows, racks of swords and axes on the wall, embers in the hearth',
  },
  {
    id: 'church',
    kind: 'scene',
    subject:
      'a small stone chapel: rows of votive candles before a worn goddess statue whose face is chipped away, a round stained window showing a black eclipse sun with a thin gold corona',
  },
  {
    id: 'shop',
    kind: 'scene',
    subject:
      'a frontier village shop counter under a canvas awning at dusk: shelves of potion vials, a weapon rack, brass scales, a coin tray, a hanging lantern',
  },
  {
    id: 'arena',
    kind: 'scene',
    subject:
      'a colosseum gate seen from the tunnel: an iron portcullis half raised, sunlit sand arena beyond, torches in brackets, crimson banners',
  },
  {
    id: 'ruins',
    kind: 'scene',
    subject:
      'overgrown shrine ruins at night, broken columns and a collapsed dome, a few lanterns and relic goods laid out on a cloth, violet mist',
  },
  {
    id: 'caravan',
    kind: 'scene',
    subject:
      'a covered merchant caravan wagon stopped on a dusk road, lanterns hanging from the canopy, open crates of goods, a tethered horse in silhouette',
  },
];

const jobs = MOMENTS.filter((m) => !only || only.includes(m.id)).map((m) => ({
  name: m.id,
  kind: m.kind,
  prompt: `${m.kind === 'card' ? CARD : SCENE}\nSubject: ${m.subject}.`,
  model,
  aspectRatio: m.kind === 'card' ? '2:3' : '16:9',
  imageSize: '1K',
  out: `${RAW}/${m.id}`,
}));

const results = await paced(jobs, { gapMs: 20000 });
fs.mkdirSync(OUT, { recursive: true });
for (const [i, r] of results.entries()) {
  if (r.error) continue;
  const job = jobs[i];
  const [w, h] = job.kind === 'card' ? [192, 288] : [480, 270];
  const { data } = await sharp(r.files[0])
    .resize(w, h, { fit: 'cover', kernel: 'lanczos3' })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const treated = treatScene(new Uint8Array(data), w, h, {
    colours: job.kind === 'card' ? 18 : 22,
  });
  await sharp(Buffer.from(treated), { raw: { width: w, height: h, channels: 4 } })
    .png({ compressionLevel: 9, palette: true })
    .toFile(`${OUT}/${job.name}.png`);
  await sharp(r.files[0])
    .resize(w * 2, h * 2)
    .jpeg({ quality: 82 })
    .toFile(`${OUT}/${job.name}-raw.jpg`);
  console.log('treated', job.name);
}

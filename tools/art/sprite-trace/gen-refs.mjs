#!/usr/bin/env node
// Map-size references for the traced sprites that the reviewed sources could only give
// through a strong reduction (lords and bosses drawn at ~128 px, traced at scale 0.1-0.45:
// faces collapse, straps turn to mottling). The image model redraws each figure at the
// map size the tracer wants (~48-64 art px tall on a clean pixel grid) from the owner's
// on-map style board and the unit's approved identity (its rebuilt sprite, plus the
// PC-98 portrait for the face), so the trace runs near 1:1 where it matches the bar.
//
//   node tools/art/sprite-trace/gen-refs.mjs [--only a,b] [--model pro|flash] [--takes 2] [--force]
//
// Raw generations (flat magenta backdrop) go to References/sprite-refs-2026-09-25/raw/
// (gitignored, cached by tools/art/gen/geminiImage.mjs); each take is keyed to alpha,
// trimmed and written to docs/art/sprite-candidates-2026-09-25/takes/<id>-<n>.png. The
// chosen take is copied to docs/art/sprite-candidates-2026-09-25/sources/<id>.png, which
// roster.mjs reads. Nothing here ships: the tracer turns sources into the atlas.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { generateAll, MODELS } from '../gen/geminiImage.mjs';

const args = process.argv.slice(2);
const flag = (n, d = null) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const REFS = 'References/sprite-refs-2026-09-25';
const RAW = `${REFS}/raw`;
const TAKES = `${REFS}/takes`;
const OUT = 'docs/art/sprite-candidates-2026-09-25';
const STYLE = 'docs/art/sprite-candidates-2026-09-22/reference.png';
const EXEMPLAR = 'docs/art/sprite-candidates-2026-09-22/sources/edric.png';
const R = (n) => `docs/art/rebuilt-sprite-sources/${n}.png`;
const PORTRAIT = (n) => `assets/portraits/pc98/192/${n}.png`;

const BASE = [
  'Create ONE original production tactical MAP SPRITE for a tactics RPG. Image 1 is the owner-approved target style:',
  'copy the craftsmanship, compact proportions, purposeful pixel clusters and strong dark contour of its SMALL ON-MAP',
  'figures (not the terrain). Image 2 is an approved sprite made for this set: match its pixel scale, rendering and',
  'framing exactly (one figure, whole body and weapon visible, centred with a wide empty margin).',
  'The remaining images are the IDENTITY of this character (a large detailed sprite and a portrait): keep their',
  'face, hair, headgear, colours, costume and signature weapon, but redraw them at map size — simplify ornament into',
  'a few large identity-bearing shapes, never shrink the big drawing.',
  'Detailed late-16-bit pixel art, about 4 heads tall, the figure about 56 art pixels tall, every art pixel drawn as',
  'a crisp, equal, square block (a clean pixel grid, no anti-aliasing, no sub-pixel detail, no blur), readable face',
  'with a lit cheek and dark eyes, clearly grouped metal/cloth/skin colours, 1-pixel dark outline.',
  'Idle three-quarter stance facing slightly right, slight overhead map angle, feet planted.',
  'BACKGROUND: perfectly flat solid pure magenta (#FF00FF) filling the entire canvas — no floor, no shadow, no',
  'gradient, no glow, no text, no ring, no frame. Do not use magenta or pink anywhere on the figure.',
].join(' ');

// v2 (second pass): the model tends to copy the identity sprite's resolution (native
// 100-300 px, i.e. no gain); spell out the pixel budget.
const SCALE = [
  'PIXEL SCALE IS THE POINT OF THIS IMAGE: the whole character, head to feet, is only about 56 pixels tall,',
  'like image 2 — big chunky square pixels, each about one fortieth of the image height, the head only about',
  '12 pixels tall. The identity images are drawn at a much higher resolution: do NOT copy their resolution or',
  'their fine detail; redraw the same character with far fewer, larger pixels, as a small map sprite.',
].join(' ');
const PROMPTS = { v1: BASE, v2: `${BASE} ${SCALE}` };

/** id -> { refs (identity), subject } */
export const SUBJECTS = {
  kira: {
    refs: [R('lord_kira'), PORTRAIT('lord_kira')],
    subject:
      'Kira, young tactician lord: long silver-white hair in a high ponytail, pale face, long plum-purple coat with cream lining over a charcoal tunic, brown belt and tall brown boots, an open brown tome held in her left hand at the chest, right arm extended pointing forward. Slender, commanding.',
  },
  kira_promoted: {
    refs: [R('lord_kira_promoted'), PORTRAIT('lord_kira')],
    subject:
      'Kira promoted (Grandmaster): the same silver-ponytailed woman, longer plum-purple greatcoat with cream trim and a few gold-thread motifs, silver clasps, open tome in her left hand, right arm pointing forward. More ornate than her base form but the same silhouette.',
  },
  voss: {
    refs: [R('lord_voss'), PORTRAIT('lord_voss')],
    subject:
      'Voss, veteran ranger lord: dark brown hair swept back, full dark beard, weathered face, ragged moss-green hooded mantle over brown leather and a little dull mail, a bow and quiver slung on his back, a long broad steel greatsword held low in both hands angled down to his right. Heavy, grounded stance.',
  },
  voss_promoted: {
    refs: [R('lord_voss_promoted'), PORTRAIT('lord_voss')],
    subject:
      'Voss promoted: the same bearded ranger now in dark steel plate over chainmail, ragged moss-green mantle, bow and quiver on his back, long broad greatsword held low in both hands angled down to his right. Broad armoured silhouette.',
  },
  cael: {
    refs: [R('lord_cael'), PORTRAIT('lord_cael')],
    subject:
      'Cael, stoic veteran guardian lord: open-faced steel kettle helmet over a stern clean-shaven face with dark brows, dark steel plate armour with a crimson scarf wrapped at the neck and a crimson tabard with a pale cross, a tall kite shield slung on his back, a long-hafted steel battle axe held upright in both hands in front of him, axe head low at his right. Broad and square.',
  },
  cael_promoted: {
    refs: [R('lord_cael_promoted'), PORTRAIT('lord_cael')],
    subject:
      'Cael promoted: the same helmeted veteran in heavier dark steel plate with crimson layered pauldrons and a crimson tabard with a pale cross, a steel spear-tipped poleaxe held upright in both hands (spike above his head, broad axe blade low at his right). Tall, broad, square silhouette.',
  },
  sera_promoted: {
    refs: [R('lord_sera_promoted'), 'docs/art/sprite-candidates-2026-09-22/sources/sera.png', PORTRAIT('lord_sera')],
    subject:
      'Sera promoted (Light Priestess): the same red-haired woman as her base sprite (the third image), long flowing red hair, warm face, now a longer cream and plum robe with a little gold trim and a pale sash, a tall silver staff topped with a small radiant cross-star held upright at her right, a small open book in her left hand. Serene; cream and red dominate.',
  },
  astrid: {
    refs: [R('lord_astrid'), PORTRAIT('lord_astrid')],
    subject:
      'Astrid, pegasus knight lord riding a white winged horse: pale silver-blonde hair tied back, light silver armour over a navy-blue tunic, a short blue scarf, a long steel lance held level and clearly visible, pointing forward-right past the horse head. Mounted: the pegasus faces right with wings raised behind the rider, all four legs visible.',
  },
  astrid_promoted: {
    refs: [R('lord_astrid_promoted'), PORTRAIT('lord_astrid')],
    subject:
      'Astrid promoted (Seraph Knight) riding a white winged horse: pale silver-blonde hair, a winged silver circlet-helm, ornate silver armour with navy-blue and gold panels, blue scarf, a long steel lance held level and clearly visible pointing forward-right past the horse head. Mounted: the pegasus faces right with large wings raised behind, all four legs visible.',
  },
  boss_iron_captain: {
    refs: [R('boss_iron_captain'), PORTRAIT('boss_iron_captain')],
    subject:
      'Iron Captain, imperial cavalry boss riding a dark bay warhorse: silver plate armour and open steel helmet, crimson cape and crimson saddle cloth, a lance held upright with a small crimson pennant. Mounted: the horse faces right, all four legs visible, rider seated.',
  },
  boss_knight_commander: {
    refs: [R('boss_knight_commander'), PORTRAIT('boss_knight_commander')],
    subject:
      'Knight Commander, imperial paladin boss riding a grey dapple warhorse: grey-haired man in silver plate with gold trim, long crimson and gold caparison with a pale cross, a lance held upright with a crimson-and-gold pennant. Mounted: the horse faces right, all four legs visible.',
  },
  boss_dark_rider: {
    refs: [R('boss_dark_rider'), PORTRAIT('boss_dark_rider')],
    subject:
      'Dark Rider, sinister knight boss on a black horse with a long black mane and tail: black plate armour with crimson accents and a winged horned helm, tattered crimson-black cape, a black halberd held raised. Mounted: the horse faces right, all four legs visible.',
  },
  boss_iron_wall: {
    refs: [R('boss_iron_wall'), PORTRAIT('boss_iron_wall')],
    subject:
      'Iron Wall, fortress-knight boss: great helm with a cross visor, massive silver plate armour, crimson cape and tabard, an enormous crimson tower shield with a pale stripe on his left, a long spear held upright on his right. Very broad, immovable, heavy silhouette.',
  },
  boss_blade_lord: {
    refs: [R('boss_blade_lord'), PORTRAIT('boss_blade_lord')],
    subject:
      'Blade Lord, duelist boss: long black hair, pale sharp face, crimson longcoat with gold buttons over dark armour, a single silver shoulder guard, a long curved sabre held low at his right. Lean, elegant, dangerous.',
  },
  boss_the_emperor: {
    refs: [R('boss_the_emperor'), PORTRAIT('boss_the_emperor')],
    subject:
      'The Emperor, final boss: grey-haired older man with a gold crown, ornate navy-blue and gold plate armour, crimson cape, a gold tower shield with a black eagle on his left, a tall spear held upright on his right. Regal, broad, imposing.',
  },
  boss_the_lieutenant: {
    refs: [R('boss_the_lieutenant'), PORTRAIT('boss_the_lieutenant')],
    subject:
      "The Lieutenant, the Emperor's enforcer: short black and white streaked hair, scarred face, dark charcoal plate with crimson lines, a long tattered crimson cape, a straight steel sword held low at his right. Tall and lean.",
  },
  boss_archmage: {
    refs: [R('boss_archmage'), PORTRAIT('boss_archmage')],
    subject:
      'Archmage, sorcerer boss: long white hair and beard, gaunt face, long black and crimson robe with gold patterns, a gold staff with a red orb in his right hand, an open crimson tome in his left. Tall and stooped.',
  },
  boss_warchief: {
    refs: [R('boss_warchief'), PORTRAIT('boss_warchief')],
    subject:
      'Warchief, barbarian boss: bald head with a red mohawk crest, bare muscular arms, studded leather and a few steel plates, ragged crimson cape, a heavy steel war axe held in his right hand. Broad and brutish.',
  },
  boss_berserker_king: {
    refs: [R('boss_berserker_king'), PORTRAIT('boss_berserker_king')],
    subject:
      'Berserker King: wild spiky red hair, bare muscular torso with crossed straps, ragged crimson loincloth and fur boots, a huge double-bladed steel axe held in both hands at his left. Crouched, savage.',
  },
};

const only = flag('only')?.split(',');
const takes = +flag('takes', 2);
const from = +flag('from', 0);
const prompt = PROMPTS[flag('prompt', 'v1')];
const model = MODELS[flag('model', 'pro')] || MODELS.pro;
const ids = Object.keys(SUBJECTS).filter((id) => !only || only.includes(id));
mkdirSync(RAW, { recursive: true });
mkdirSync(TAKES, { recursive: true });
mkdirSync(`${OUT}/sources`, { recursive: true });

const jobs = [];
for (const id of ids) {
  const s = SUBJECTS[id];
  for (let n = from; n < from + takes; n++)
    jobs.push({
      id,
      n,
      prompt: `${prompt} Subject: ${s.subject}${n % 2 ? ` (Variation ${n + 1}.)` : ''}`,
      refs: [STYLE, EXEMPLAR, ...s.refs.filter((r) => r !== EXEMPLAR && existsSync(r))],
      model,
      aspectRatio: '1:1',
      imageSize: '2K',
      out: `${RAW}/${id}-${n}`,
      force: args.includes('--force'),
    });
}

/**
 * Key the flat backdrop to alpha. Asked for magenta; the model sometimes paints white or
 * grey instead, so the backdrop colour is read from the border. Flood from the border
 * through backdrop-coloured pixels (so interior reds survive), then drop the blended fringe.
 */
export async function keyMagenta(file, out) {
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const px = (i) => [data[i * 4], data[i * 4 + 1], data[i * 4 + 2]];
  const border = [];
  for (let x = 0; x < w; x += 4) border.push(px(x), px((h - 1) * w + x));
  for (let y = 0; y < h; y += 4) border.push(px(y * w), px(y * w + w - 1));
  const med = [0, 1, 2].map((c) => border.map((p) => p[c]).sort((m, n) => m - n)[border.length >> 1]);
  const magenta = med[0] > 150 && med[2] > 150 && med[1] < 110;
  const dist = (i) => {
    const p = px(i);
    return Math.hypot(p[0] - med[0], p[1] - med[1], p[2] - med[2]);
  };
  const isBg = magenta
    ? (i) => {
        const [r, g, b] = px(i);
        // magenta: red and blue high and close, green low
        return r > 150 && b > 150 && g < 110 && Math.abs(r - b) < 70;
      }
    : (i) => dist(i) < 48;
  const fringe = magenta
    ? (i) => {
        const [r, g, b] = px(i);
        // blended edge: noticeably more red+blue than green, and red ~ blue
        return r + b > 2.4 * g + 90 && Math.abs(r - b) < 90 && Math.min(r, b) > 90;
      }
    : (i) => dist(i) < 110;
  const bg = new Uint8Array(w * h);
  const stack = [];
  for (let x = 0; x < w; x++) stack.push(x, (h - 1) * w + x);
  for (let y = 0; y < h; y++) stack.push(y * w, y * w + w - 1);
  while (stack.length) {
    const i = stack.pop();
    if (bg[i] || !isBg(i)) continue;
    bg[i] = 1;
    const x = i % w;
    const y = (i / w) | 0;
    if (x > 0) stack.push(i - 1);
    if (x < w - 1) stack.push(i + 1);
    if (y > 0) stack.push(i - w);
    if (y < h - 1) stack.push(i + w);
  }
  // enclosed backdrop pockets (between an arm and the body) are pure magenta too (a
  // white or grey backdrop could be a highlight inside the figure: only the flood counts)
  if (magenta) for (let i = 0; i < w * h; i++) if (!bg[i] && isBg(i)) bg[i] = 2;
  // two passes of fringe removal next to the backdrop
  for (let pass = 0; pass < 2; pass++) {
    const next = bg.slice();
    for (let i = 0; i < w * h; i++) {
      if (bg[i]) continue;
      const x = i % w;
      const y = (i / w) | 0;
      const nb =
        (x > 0 && bg[i - 1]) ||
        (x < w - 1 && bg[i + 1]) ||
        (y > 0 && bg[i - w]) ||
        (y < h - 1 && bg[i + w]);
      if (nb && fringe(i)) next[i] = 3;
    }
    bg.set(next);
  }
  for (let i = 0; i < w * h; i++) if (bg[i]) data[i * 4 + 3] = 0;
  await sharp(data, { raw: { width: w, height: h, channels: 4 } })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 1 })
    .extend({ top: 24, bottom: 24, left: 24, right: 24, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toFile(out);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  if (args.includes('--rekey')) {
    // re-key every raw generation (after a keyer change)
    const { readdirSync } = await import('node:fs');
    for (const f of readdirSync(RAW).filter((x) => /\.(png|jpg)$/.test(x) && !/-\d+-\d+\./.test(x)))
      await keyMagenta(`${RAW}/${f}`, `${TAKES}/${f.replace(/\.(png|jpg)$/, '.png')}`);
    console.log('re-keyed');
  } else if (args.includes('--choose')) {
    // --choose id:n,id:n -> the take's recovered pixel grid, shown 6x (nearest), becomes
    // docs/art/sprite-candidates-2026-09-25/sources/<id>.png (a clean grid the tracer
    // re-reads exactly; a few KB instead of the 2K generation), with its provenance
    const { readRaster, writePng } = await import('./lib/io.mjs');
    const { recoverFigure } = await import('./lib/trace.mjs');
    const provFile = `${OUT}/prompts.json`;
    const prov = existsSync(provFile) ? JSON.parse(readFileSync(provFile, 'utf8')) : {};
    for (const pick of flag('choose').split(',')) {
      const [id, n] = pick.split(':');
      const src = await readRaster(`${TAKES}/${id}-${n}.png`);
      const b = src.alphaBounds(64);
      const res = recoverFigure(src.crop(b.x, b.y, b.width, b.height));
      await writePng(res.native.scale(6), `${OUT}/sources/${id}.png`);
      const gen = JSON.parse(readFileSync(`${RAW}/${id}-${n}.gen.json`, 'utf8'));
      prov[id] = {
        take: `${id}-${n}`,
        model: gen.model,
        prompt: gen.prompt,
        refs: gen.refs,
        native: [res.native.w, res.native.h],
        pitch: +(+res.pitch?.x || 0).toFixed(2),
        at: gen.at,
      };
      console.log(`chose ${id}-${n}: native ${res.native.w}x${res.native.h}`);
    }
    const sorted = Object.fromEntries(
      Object.keys(prov)
        .sort()
        .map((k) => [k, prov[k]]),
    );
    writeFileSync(provFile, `${JSON.stringify(sorted, null, 2)}\n`);
  } else {
    await generateAll(jobs, {
      concurrency: +flag('concurrency', 3),
      onDone: async (job, res) => {
        if (res?.error) return console.log(`${job.id}-${job.n}: ERROR ${res.error}`);
        const file = res.files[0];
        await keyMagenta(file, `${TAKES}/${job.id}-${job.n}.png`);
        console.log(`${job.id}-${job.n}: ${res.cached ? 'cached' : 'generated'} -> ${file}`);
      },
    });
  }
}

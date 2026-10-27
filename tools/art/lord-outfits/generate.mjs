#!/usr/bin/env node
// Generate lord outfit portrait samples with the shared Gemini client.
//
//   node tools/art/lord-outfits/generate.mjs [--only ashen_crown,...] [--takes 4]
//        [--promoted] [--model pro|flash] [--concurrency 2]
//
// References, in order: the house style sheet (four approved rebuilt portraits), then the
// lord's own rebuilt portrait (identity: same face, hair, age); a promoted take adds the
// picked base take (picks.json) as the costume to make grander. Raw images (not shipped)
// land in References/lord-outfits/raw/<outfit>[_promoted]-t<n>.png with the client's cache
// records and generations.jsonl provenance; a re-run pays for nothing already drawn.
import { existsSync, mkdirSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { generateImage, MODELS } from '../gen/geminiImage.mjs';
import { STYLE } from '../portrait-variants/prompts.mjs';
import { LORD_OUTFITS } from './outfits.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
export const WORK = join(ROOT, 'References/lord-outfits');
export const RAW = join(WORK, 'raw');
const REFS = join(WORK, 'refs');
const args = process.argv.slice(2);
const opt = (n, d = null) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const ONLY = opt('--only')?.split(',');
const TAKES = Number(opt('--takes', 4));
const PROMOTED = args.includes('--promoted');
const MODEL = MODELS[opt('--model', 'pro')] || MODELS.pro;
const CONCURRENCY = Number(opt('--concurrency', 2));
mkdirSync(RAW, { recursive: true });
mkdirSync(REFS, { recursive: true });

const PICKS = JSON.parse(
  readFileSync(join(ROOT, 'tools/art/lord-outfits/picks.json'), 'utf8'),
).picks;
const baseTake = (outfitId) => {
  const take = PICKS[outfitId]?.base;
  const file =
    take && ['.png', '.jpg'].map((e) => join(RAW, `${outfitId}-t${take}${e}`)).find(existsSync);
  if (!file) throw new Error(`no picked base take for ${outfitId}`);
  return file;
};
const rebuilt = (id) => join(ROOT, 'assets/portraits/rebuilt', `${id}.png`);

async function styleSheet() {
  const out = join(REFS, 'style.png');
  if (existsSync(out)) return out;
  const ids = ['generic_fighter', 'generic_warlock', 'lord_sera', 'generic_sniper'];
  const tiles = await Promise.all(
    ids.map((id) => sharp(rebuilt(id)).resize(512, 512, { kernel: 'lanczos3' }).png().toBuffer()),
  );
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#ffffff' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % 2) * 512, top: (i >> 1) * 512 })))
    .png()
    .toFile(out);
  return out;
}

async function identity(id) {
  const out = join(REFS, `${id}.png`);
  if (existsSync(out)) return out;
  await sharp(rebuilt(id))
    .resize(1024, 1024, { fit: 'contain', background: '#ffffff', kernel: 'lanczos3' })
    .flatten({ background: '#ffffff' })
    .png()
    .toFile(out);
  return out;
}

export function outfitPrompt(outfit, { promoted = false, take = 1 } = {}) {
  return [
    STYLE,
    '',
    `Character: the exact same person as in the second reference image - ${outfit.lord}, ${outfit.look} - keep the face, skin tone, eye colour, hair, age, facial hair, scars and expression identical.`,
    `New outfit ("${outfit.name}"), replacing what they wear in the second reference image: ${outfit.outfit}.`,
    promoted
      ? 'This is the promoted, more senior version of the look. The third reference image shows this person already wearing the outfit: keep that design (its shapes, colours and motifs) and make it grander and more ornate (finer trim, an extra layer of plate or cloth, a richer cloak), as the second reference image is a grander version of their usual clothes.'
      : '',
    `Take ${take}: an original take on this outfit; keep the person unmistakable.`,
  ]
    .filter(Boolean)
    .join('\n');
}

const style = await styleSheet();
const jobs = [];
for (const outfit of LORD_OUTFITS) {
  if (ONLY && !ONLY.includes(outfit.id)) continue;
  const lordId = `lord_${outfit.lord.toLowerCase()}${PROMOTED ? '_promoted' : ''}`;
  const ident = await identity(lordId);
  for (let take = 1; take <= TAKES; take++) {
    const name = `${outfit.id}${PROMOTED ? '_promoted' : ''}-t${take}`;
    jobs.push(() =>
      generateImage({
        prompt: outfitPrompt(outfit, { promoted: PROMOTED, take }),
        refs: PROMOTED ? [style, ident, baseTake(outfit.id)] : [style, ident],
        model: MODEL,
        aspectRatio: '1:1',
        imageSize: '1K',
        out: join(RAW, name),
      })
        .then((r) => console.log(`${r.cached ? 'cached' : 'drawn '} ${name}`))
        .catch((e) => console.error(`FAILED ${name}: ${e.message}`)),
    );
  }
}
let next = 0;
const worker = async () => {
  while (next < jobs.length) await jobs[next++]();
};
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));

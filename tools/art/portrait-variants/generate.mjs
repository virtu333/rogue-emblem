#!/usr/bin/env node
// Generate portrait variant references with the shared Gemini client.
//
//   node tools/art/portrait-variants/generate.mjs [--only id,id] [--side player|enemy]
//        [--limit N] [--concurrency 2] [--pace 8] [--model pro|flash] [--dry]
//
// Raw generations (1024 px, not shipped) land in References/portrait-variants/raw/
// with the client's cache records and generations.jsonl provenance. Jobs run in
// dependency waves: a person's first render before their other classes, the
// class default before the costume references that point at it. A job waits
// until every reference it uses is current (its cached generation matches its
// present prompt and references), so a changed person is redrawn before the
// renders that copy their face. Requests are paced (--pace seconds between
// starts) and back off for minutes on the API's spend-rate limit.
// Retakes and fixes live in notes.json ({ id: { note, take } }) so every prompt
// that produced a shipped portrait is reproducible from the repo.
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { generateImage, generationHash, MODELS } from '../gen/geminiImage.mjs';
import { buildPlan } from './plan.mjs';
import { promptFor } from './prompts.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');
export const WORK = join(ROOT, 'References/portrait-variants');
export const RAW = join(WORK, 'raw');
const REFS = join(WORK, 'refs');
const args = process.argv.slice(2);
const opt = (n, d = null) => (args.includes(n) ? args[args.indexOf(n) + 1] : d);
const ONLY = opt('--only')?.split(',');
const SIDE = opt('--side');
const LIMIT = Number(opt('--limit', Infinity));
const CONCURRENCY = Number(opt('--concurrency', 2));
const PACE = Number(opt('--pace', 8));
// --model pro (default, best reference following) | flash (cheaper; its own daily quota)
const MODEL = MODELS[opt('--model', 'pro')] || MODELS.pro;
const DRY = args.includes('--dry');

const pc98 = JSON.parse(readFileSync(join(ROOT, 'src/ui/Pc98PortraitManifest.json'), 'utf8'));
const rebuilt = JSON.parse(readFileSync(join(ROOT, 'src/ui/RebuiltPortraitManifest.json'), 'utf8'));
const notes = existsSync(join(ROOT, 'tools/art/portrait-variants/notes.json'))
  ? JSON.parse(readFileSync(join(ROOT, 'tools/art/portrait-variants/notes.json'), 'utf8'))
  : {};

const reviewFile = join(ROOT, 'tools/art/portrait-variants/review.json');
const accepted = existsSync(reviewFile)
  ? JSON.parse(readFileSync(reviewFile, 'utf8')).accepted || {}
  : {};
const sha = (buf) => createHash('sha256').update(buf).digest('hex').slice(0, 16);

const { jobs } = buildPlan(new Set(Object.keys(pc98.portraits)));
mkdirSync(RAW, { recursive: true });
mkdirSync(REFS, { recursive: true });

/** The generated (or kept) image for an id, or null. */
export function rawFile(id) {
  for (const ext of ['.png', '.jpg'])
    if (existsSync(join(RAW, id + ext))) return join(RAW, id + ext);
  return null;
}

async function flatOnWhite(src, out, size) {
  if (existsSync(out)) return out;
  await sharp(src)
    .resize(size, size, { fit: 'contain', background: '#ffffff', kernel: 'lanczos3' })
    .flatten({ background: '#ffffff' })
    .png()
    .toFile(out);
  return out;
}

async function styleSheet() {
  const out = join(REFS, 'style.png');
  if (existsSync(out)) return out;
  const ids = ['generic_fighter', 'generic_warlock', 'lord_sera', 'generic_sniper'];
  const tiles = await Promise.all(
    ids.map((id) =>
      sharp(join(ROOT, 'assets/portraits/rebuilt', rebuilt[id].file))
        .resize(512, 512, { kernel: 'lanczos3' })
        .png()
        .toBuffer(),
    ),
  );
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#ffffff' } })
    .composite(tiles.map((input, i) => ({ input, left: (i % 2) * 512, top: (i >> 1) * 512 })))
    .png()
    .toFile(out);
  return out;
}

/** Reference image for an id used as identity or costume reference. */
async function refImage(id) {
  const job = jobs.find((j) => j.id === id);
  if (job?.mode === 'keep')
    return flatOnWhite(
      join(ROOT, 'assets/portraits/rebuilt', rebuilt[id].file),
      join(REFS, `${id}.png`),
      1024,
    );
  return rawFile(id);
}

/** Legacy 128 px portrait being remastered, enlarged so the model reads it. */
async function legacyRef(id) {
  return flatOnWhite(
    join(ROOT, 'assets/portraits', `${id}.png`),
    join(REFS, `legacy-${id}.png`),
    512,
  );
}

const style = await styleSheet();
const byId = new Map(jobs.map((j) => [j.id, j]));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function specFor(j) {
  const refs = [style];
  let identity = false;
  let costume = false;
  if (j.mode === 'remaster') {
    refs.push(await legacyRef(j.id));
    identity = true;
  } else if (j.identityRef) {
    const r = await refImage(j.identityRef);
    if (!r) return null;
    refs.push(r);
    identity = true;
  }
  if (j.costumeRef) {
    const r = await refImage(j.costumeRef);
    if (!r) return null;
    refs.push(r);
    costume = true;
  }
  const note = notes[j.id];
  let prompt = promptFor(j, { identity, costume });
  if (note?.note) prompt += `\n${note.note}`;
  if (note?.take) prompt += `\n(Variation ${note.take}.)`;
  return {
    prompt,
    refs,
    model: MODEL,
    aspectRatio: '1:1',
    imageSize: '1K',
    out: join(RAW, j.id),
    id: j.id,
  };
}

/** The raw exists and was generated from the job's current prompt and references. */
async function fresh(id) {
  const j = byId.get(id);
  if (!j || j.mode === 'keep') return true;
  if (!rawFile(id)) return false;
  // Reviewed and accepted (review.mjs): kept even if a reference was redrawn.
  if (accepted[id] && accepted[id] === sha(readFileSync(rawFile(id)))) return true;
  const cache = join(RAW, `${id}.gen.json`);
  if (!existsSync(cache)) return false;
  const spec = await specFor(j);
  return Boolean(spec) && JSON.parse(readFileSync(cache, 'utf8')).hash === generationHash(spec);
}

async function depsFresh(j) {
  for (const dep of [j.identityRef, j.costumeRef].filter(Boolean))
    if (!(await fresh(dep))) return false;
  return true;
}

let lastStart = 0;
async function paced(spec) {
  for (let attempt = 0; ; attempt++) {
    const wait = lastStart + PACE * 1000 - Date.now();
    lastStart = Math.max(Date.now(), lastStart + PACE * 1000);
    if (wait > 0) await sleep(wait);
    const t0 = Date.now();
    try {
      const res = await generateImage(spec);
      console.log(
        `  ${spec.id.padEnd(44)} ${res.cached ? 'cached' : `${((Date.now() - t0) / 1000).toFixed(0)}s`}`,
      );
      return true;
    } catch (error) {
      // A daily quota does not come back in minutes: stop instead of backing off.
      if (/per_day|PerDay/.test(error.message)) {
        console.log(`  ${spec.id.padEnd(44)} daily quota exhausted for ${spec.model}; stopping`);
        process.exit(3);
      }
      const limited = /rate limit|RESOURCE_EXHAUSTED|\b429\b|quota/i.test(error.message);
      if (limited && attempt < 10) {
        const backoff = 60 * (attempt + 1);
        console.log(`  ${spec.id.padEnd(44)} rate limited; waiting ${backoff}s`);
        await sleep(backoff * 1000);
        continue;
      }
      console.log(`  ${spec.id.padEnd(44)} ERROR ${error.message.slice(0, 160)}`);
      return false;
    }
  }
}

const selected = jobs.filter(
  (j) => j.mode !== 'keep' && (!ONLY || ONLY.includes(j.id)) && (!SIDE || j.side === SIDE),
);
let wave = 0;
let done = 0;
const failed = new Set();
while (done < LIMIT) {
  const ready = [];
  let waiting = 0;
  for (const j of selected) {
    if (failed.has(j.id) || (await fresh(j.id))) continue;
    if (await depsFresh(j)) ready.push(await specFor(j));
    else waiting++;
  }
  if (!ready.length) {
    if (waiting)
      console.log(`blocked: ${waiting} jobs wait on references that failed or were not selected`);
    break;
  }
  const batch = ready.slice(0, Math.max(0, LIMIT - done));
  wave += 1;
  console.log(`wave ${wave}: ${batch.length} jobs (${waiting} waiting)`);
  if (DRY) {
    for (const b of batch)
      console.log(`  ${b.id}  refs=${b.refs.map((r) => r.split('/').pop()).join(',')}`);
    break;
  }
  let next = 0;
  const worker = async () => {
    while (next < batch.length) {
      const spec = batch[next++];
      if (!(await paced(spec))) failed.add(spec.id);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));
  done += batch.length;
}
let stale = 0;
for (const j of selected) if (!(await fresh(j.id))) stale++;
console.log(
  `raw portraits: ${readdirSync(RAW).filter((f) => /\.(png|jpg)$/.test(f)).length}; selected jobs not current: ${stale}`,
);

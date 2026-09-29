#!/usr/bin/env node
// Generate motion clips with MiniMax H3 (image to video) for the Unwritten Page engine.
//
//   node tools/cutscene/unwritten/motion/minimax.mjs <job> [<job> ...]
//   node tools/cutscene/unwritten/motion/minimax.mjs --list
//   node tools/cutscene/unwritten/motion/minimax.mjs --poll <job>      (resume a submitted job)
//
// Jobs are in camp_jobs.json next to this file. Each one animates a keyed cut-out from
// docs/art-direction/anime-op/cutouts/, placed on a flat green frame, and asks for
// motion that stays on the green so it can be keyed again. Clips land in
// References/cutscene/unwritten/clips/ (not committed); every submission is logged with
// its cost in clips/spend.jsonl.
//
// Needs MINIMAX_API_KEY in .env (gitignored), or an environment proxy that adds the key. Price (Sep 2026): H3 768P $0.08/s.

import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const ROOT = path.resolve(HERE, '../../../..');
const OUT = path.join(ROOT, 'References/cutscene/unwritten/clips');
const CUTS = path.join(ROOT, 'docs/art-direction/anime-op/cutouts');
const BASE = 'https://api.minimax.io';
const PRICE = { '768P': 0.08, '2K': 0.13, '480P': 0.05 };

let env = {};
try {
  env = Object.fromEntries(
    fs
      .readFileSync(path.join(ROOT, '.env'), 'utf8')
      .split('\n')
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [
        l.slice(0, l.indexOf('=')),
        l.slice(l.indexOf('=') + 1).replace(/^["']|["']$/g, ''),
      ]),
  );
} catch {
  /* no .env: fine when a proxy adds the key */
}
const KEY = env.MINIMAX_API_KEY || process.env.MINIMAX_API_KEY;
// No local key: send no Authorization header and let the environment's proxy add it.
const H = {
  'Content-Type': 'application/json',
  ...(KEY ? { Authorization: `Bearer ${KEY}` } : {}),
};

const JOBS = JSON.parse(fs.readFileSync(path.join(HERE, 'camp_jobs.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });

/**
 * A key frame (first or last), 1280x720 PNG as a data URI. Either
 *   - a keyed cut-out (`cutout`, in docs/art-direction/anime-op/cutouts/) on flat #00FF00,
 *     placed by { h: fraction of frame height, x, y: centre-bottom in 0..1 }, or
 *   - a painting (`image`, a repo path), optionally cropped ([x, y, w, h] in 0..1),
 *     filling the frame (for a plate clip: no key).
 */
async function keyFrame(job, which, spec) {
  const W = 1280;
  const Hh = 720;
  let png;
  if (spec.image) {
    const src = path.join(ROOT, spec.image);
    const meta = await sharp(src).metadata();
    let img = sharp(src);
    if (spec.crop) {
      const [x, y, w, h] = spec.crop;
      img = img.extract({
        left: Math.round(x * meta.width),
        top: Math.round(y * meta.height),
        width: Math.round(w * meta.width),
        height: Math.round(h * meta.height),
      });
    }
    png = await img.resize(W, Hh, { fit: 'cover' }).png().toBuffer();
  } else {
    // one cut-out, or several (`layers`, back to front), on flat green
    const comp = [];
    for (const L of spec.layers || [spec]) {
      const src = path.join(CUTS, L.cutout);
      const meta = await sharp(src).metadata();
      const p = L.place || {};
      const h = Math.round(Hh * (p.h ?? 0.8));
      const w = Math.round((meta.width * h) / meta.height);
      const fig = await sharp(src).resize(w, h).flop(!!L.flip).png().toBuffer();
      comp.push({
        input: fig,
        left: Math.round(W * (p.x ?? 0.5) - w / 2),
        top: Math.round(Hh * (p.y ?? 0.92) - h),
      });
    }
    png = await sharp({ create: { width: W, height: Hh, channels: 4, background: '#00ff00' } })
      .composite(comp)
      .flatten({ background: '#00ff00' })
      .png()
      .toBuffer();
  }
  fs.writeFileSync(path.join(OUT, `${job.name}.${which}.png`), png);
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function audio(job) {
  if (!job.audio) return null;
  const f = path.join(ROOT, job.audio);
  return `data:audio/mpeg;base64,${fs.readFileSync(f).toString('base64')}`;
}

async function submit(name) {
  const job = JOBS[name];
  if (!job) throw new Error(`no job ${name}`);
  job.name = name;
  const content = [{ type: 'text', text: job.prompt }];
  content.push({
    type: 'image_url',
    image_url: { url: await keyFrame(job, 'first', job) },
    role: 'first_frame',
  });
  if (job.last)
    content.push({
      type: 'image_url',
      image_url: { url: await keyFrame(job, 'last', job.last) },
      role: 'last_frame',
    });
  const a = await audio(job);
  if (a) content.push({ type: 'audio_url', audio_url: { url: a }, role: 'reference_audio' });
  const body = {
    model: job.model || 'MiniMax-H3',
    content,
    resolution: job.resolution || '768P',
    duration: job.duration || 5,
    ratio: 'adaptive',
  };
  const r = await fetch(`${BASE}/v2/video_generation`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.task_id) throw new Error(`${name}: ${JSON.stringify(j).slice(0, 400)}`);
  const cost = (PRICE[body.resolution] || 0.08) * body.duration;
  fs.appendFileSync(
    path.join(OUT, 'spend.jsonl'),
    `${JSON.stringify({ at: new Date().toISOString(), job: name, task: j.task_id, model: body.model, resolution: body.resolution, duration: body.duration, usd: cost })}\n`,
  );
  fs.writeFileSync(path.join(OUT, `${name}.task`), j.task_id);
  console.log(`${name}: task ${j.task_id} (~$${cost.toFixed(2)})`);
  return j.task_id;
}

/** fetch, retried through network hiccups (a dropped connection must not lose a job) */
async function fetchRetry(url, opts, tries = 8) {
  for (let k = 0; ; k++) {
    try {
      return await fetch(url, opts);
    } catch (e) {
      if (k >= tries) throw e;
      await new Promise((res) => setTimeout(res, 5000 * (k + 1)));
    }
  }
}

async function poll(name, task) {
  if (fs.existsSync(path.join(OUT, `${name}.mp4`))) return path.join(OUT, `${name}.mp4`);
  for (;;) {
    const r = await fetchRetry(`${BASE}/v2/query/video_generation/${task}`, { headers: H });
    const j = await r.json();
    const t = j.task || j;
    const st = t.status;
    if (st === 'succeeded') {
      const url = t.content?.url || t.content?.video_url || t.url;
      const v = await fetchRetry(url);
      const f = path.join(OUT, `${name}.mp4`);
      fs.writeFileSync(f, Buffer.from(await v.arrayBuffer()));
      console.log(`${name}: done -> ${path.relative(ROOT, f)}`);
      return f;
    }
    if (st === 'failed' || st === 'cancelled')
      throw new Error(`${name}: ${st} ${JSON.stringify(j).slice(0, 400)}`);
    process.stdout.write(`${name}: ${st || JSON.stringify(j).slice(0, 120)}\r`);
    await new Promise((res) => setTimeout(res, 10000));
  }
}

const args = process.argv.slice(2);
if (args[0] === '--list') {
  for (const [k, v] of Object.entries(JOBS))
    console.log(`${k.padEnd(18)} ${v.duration || 5}s  ${v.cutout}`);
} else if (args[0] === '--poll') {
  await Promise.all(
    args.slice(1).map((n) => poll(n, fs.readFileSync(path.join(OUT, `${n}.task`), 'utf8').trim())),
  );
} else {
  await Promise.all(
    args.map(async (n) => {
      const task = await submit(n);
      return poll(n, task);
    }),
  );
}

// A small fal.ai client for the cutscene pipeline: any endpoint, local files uploaded first.
//
//   node tools/cutscene/unwritten/motion/fal.mjs <endpoint> <input.json> [--out dir] [--name n]
//
// input.json is the endpoint's input. Any string value that is a path to a local file (or
// any entry of an array of them) is uploaded to fal storage and replaced by its URL, so a
// job can name our cut-outs and previs renders directly. The result JSON and every media
// file in it are saved to <out>/<name>.*; each submission is logged to
// References/cutscene/fal/spend.jsonl. Needs FAL_API_KEY (or FAL_KEY) in .env.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../../..');

function loadEnv() {
  const p = path.join(ROOT, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();
const KEY = process.env.FAL_API_KEY || process.env.FAL_KEY;
if (!KEY) throw new Error('FAL_API_KEY missing from .env');
const AUTH = { Authorization: `Key ${KEY}` };

const TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

async function retry(fn, tries = 6) {
  let err;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      err = e;
      await new Promise((r) => setTimeout(r, 1500 * (i + 1)));
    }
  }
  throw err;
}

const uploaded = new Map();
export async function upload(file) {
  const abs = path.resolve(ROOT, file);
  if (uploaded.has(abs)) return uploaded.get(abs);
  const type = TYPES[path.extname(abs).toLowerCase()] || 'application/octet-stream';
  const init = await retry(async () => {
    const r = await fetch(
      'https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3',
      {
        method: 'POST',
        headers: { ...AUTH, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content_type: type, file_name: path.basename(abs) }),
      },
    );
    if (!r.ok) throw new Error(`upload initiate ${r.status}: ${await r.text()}`);
    return r.json();
  });
  await retry(async () => {
    const r = await fetch(init.upload_url, {
      method: 'PUT',
      headers: { 'Content-Type': type },
      body: fs.readFileSync(abs),
    });
    if (!r.ok) throw new Error(`upload PUT ${r.status}`);
  });
  uploaded.set(abs, init.file_url);
  return init.file_url;
}

const isLocal = (v) =>
  typeof v === 'string' &&
  !/^(https?:|data:)/.test(v) &&
  /\.[a-z0-9]{2,4}$/i.test(v) &&
  fs.existsSync(path.resolve(ROOT, v));

async function resolveFiles(v) {
  if (Array.isArray(v)) return Promise.all(v.map(resolveFiles));
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = await resolveFiles(x);
    return o;
  }
  return isLocal(v) ? upload(v) : v;
}

export async function run(endpoint, input, { log = true, label = '' } = {}) {
  const body = await resolveFiles(input);
  const sub = await retry(async () => {
    const r = await fetch(`https://queue.fal.run/${endpoint}`, {
      method: 'POST',
      headers: { ...AUTH, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`submit ${r.status}: ${await r.text()}`);
    return r.json();
  });
  if (log) {
    const p = path.join(ROOT, 'References/cutscene/fal/spend.jsonl');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(
      p,
      JSON.stringify({
        at: new Date().toISOString(),
        endpoint,
        label,
        request: sub.request_id,
        duration: input.duration ?? null,
        resolution: input.resolution ?? null,
        num_images: input.num_images ?? null,
        draft: input.draft ?? null,
      }) + '\n',
    );
  }
  const t0 = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, 4000));
    const st = await retry(async () => {
      const r = await fetch(`${sub.status_url}?logs=0`, { headers: AUTH });
      if (!r.ok && r.status !== 202) throw new Error(`status ${r.status}`);
      return r.json();
    });
    if (st.status === 'COMPLETED') break;
    if (st.status === 'FAILED' || st.error) throw new Error(`failed: ${JSON.stringify(st)}`);
    if (Date.now() - t0 > 40 * 60 * 1000) throw new Error('timed out');
  }
  return retry(async () => {
    for (const url of [sub.response_url, `https://queue.fal.run/${endpoint}/requests/${sub.request_id}`]) {
      const r = await fetch(url, { headers: AUTH });
      const j = await r.json();
      if (r.ok) return j;
      // the queue sometimes re-validates the finished output as if it were an input (a 422
      // whose `input` is the result): the work is done and paid for, so keep it
      const got = j?.detail?.[0]?.input;
      if (r.status === 422 && got && (got.images || got.video)) return got;
      if (url !== sub.response_url) throw new Error(`result ${r.status}: ${JSON.stringify(j)}`);
    }
  });
}

/** Every media URL in a result, with a suggested extension. */
function media(o, acc = []) {
  if (Array.isArray(o)) o.forEach((x) => media(x, acc));
  else if (o && typeof o === 'object') {
    if (typeof o.url === 'string' && /^https?:/.test(o.url)) acc.push(o);
    else Object.values(o).forEach((x) => media(x, acc));
  }
  return acc;
}

export async function save(result, out, name) {
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, `${name}.json`), JSON.stringify(result, null, 2));
  const files = [];
  for (const [i, m] of media(result).entries()) {
    const ext =
      path.extname(new URL(m.url).pathname) ||
      { 'video/mp4': '.mp4', 'image/png': '.png', 'image/jpeg': '.jpg' }[m.content_type] ||
      '.bin';
    const f = path.join(out, `${name}${i ? `_${i}` : ''}${ext}`);
    const buf = Buffer.from(await (await retry(() => fetch(m.url))).arrayBuffer());
    fs.writeFileSync(f, buf);
    files.push(f);
  }
  return files;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const [endpoint, inFile] = process.argv.slice(2);
  const arg = (k, d) => {
    const i = process.argv.indexOf(`--${k}`);
    return i < 0 ? d : process.argv[i + 1];
  };
  const input = JSON.parse(fs.readFileSync(inFile, 'utf8'));
  const name = arg('name', path.basename(inFile, '.json'));
  const out = arg('out', path.join(ROOT, 'References/cutscene/fal', name));
  const res = await run(endpoint, input, { label: name });
  const files = await save(res, out, name);
  console.log(files.join('\n'));
}

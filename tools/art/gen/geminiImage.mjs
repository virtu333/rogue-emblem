// geminiImage — shared client for generated art references (Gemini image models, Veo).
//
// Auth: in the cloud environment the egress proxy injects the API key header for
// generativelanguage.googleapis.com, so no key lives in the repo or in env. Locally,
// set GEMINI_API_KEY (or GOOGLE_API_KEY) and it is sent as x-goog-api-key.
//
// Requests go through curl, which honours HTTPS_PROXY and the proxy CA; Node's fetch
// ignores the proxy unless NODE_USE_ENV_PROXY=1 is set at startup.
//
// Every call is cached by a hash of (model, prompt, reference bytes, config), so
// re-running a pipeline never pays twice for the same image, and each output gets a
// provenance line in <outDir>/generations.jsonl.

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const API = 'https://generativelanguage.googleapis.com/v1beta';
export const MODELS = {
  pro: 'gemini-3-pro-image', // best quality, strongest reference following
  flash: 'gemini-3.1-flash-image', // fast and cheap: iteration, batches
  veo: 'veo-3.1-generate-preview', // motion references
  veoFast: 'veo-3.1-fast-generate-preview',
};

const MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

function curlJson(url, body, { method = 'POST', timeoutMs = 300000 } = {}) {
  const headers = ['-H', 'Content-Type: application/json'];
  const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (key) headers.push('-H', `x-goog-api-key: ${key}`);
  const tmp = body
    ? path.join(
        os.tmpdir(),
        `gem-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`,
      )
    : null;
  if (tmp) fs.writeFileSync(tmp, JSON.stringify(body));
  const args = [
    '-sS',
    '-X',
    method,
    ...headers,
    url,
    '--max-time',
    String(Math.ceil(timeoutMs / 1000)),
  ];
  if (tmp) args.push('--data-binary', `@${tmp}`);
  return new Promise((resolve, reject) => {
    execFile('curl', args, { maxBuffer: 512 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (tmp) fs.rmSync(tmp, { force: true });
      if (err) return reject(new Error(`curl failed: ${stderr || err.message}`));
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(new Error(`non-JSON response: ${String(stdout).slice(0, 300)}`));
      }
    });
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function withRetry(fn, { tries = 5 } = {}) {
  let last;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fn();
      const code = res?.error?.code;
      if (code === 429 || (code >= 500 && code < 600))
        throw Object.assign(new Error(res.error.message), { retry: true, res });
      return res;
    } catch (err) {
      last = err;
      if (!err.retry && !/curl failed/.test(err.message)) throw err;
      await sleep(2000 * 2 ** i);
    }
  }
  throw last;
}

function refPart(ref) {
  const file = typeof ref === 'string' ? ref : ref.path;
  const mimeType = MIME[path.extname(file).toLowerCase()] || 'image/png';
  return { inlineData: { mimeType, data: fs.readFileSync(file).toString('base64') } };
}

/**
 * Generate image(s) from a prompt plus optional reference images.
 * @param {object} o
 * @param {string} o.prompt
 * @param {string[]} [o.refs] reference image paths (style, identity, composition)
 * @param {string} [o.model] MODELS.pro by default
 * @param {string} [o.aspectRatio] e.g. '1:1', '16:9', '3:2', '2:3', '21:9'
 * @param {string} [o.imageSize] '1K' | '2K' | '4K' (pro models)
 * @param {string} o.out output path without extension (".png"/".jpg" added per mime)
 * @param {boolean} [o.force] ignore the cache
 * @returns {Promise<{ files: string[], text: string, cached: boolean }>}
 */
export async function generateImage({
  prompt,
  refs = [],
  model = MODELS.pro,
  aspectRatio,
  imageSize,
  out,
  force = false,
}) {
  if (!prompt || !out) throw new Error('generateImage needs prompt and out');
  const refBytes = refs.map((r) => fs.readFileSync(typeof r === 'string' ? r : r.path));
  const hash = createHash('sha256')
    .update(JSON.stringify({ model, prompt, aspectRatio, imageSize }))
    .update(Buffer.concat(refBytes.map((b) => createHash('sha256').update(b).digest())))
    .digest('hex')
    .slice(0, 16);
  const dir = path.dirname(out);
  fs.mkdirSync(dir, { recursive: true });
  const cacheFile = `${out}.gen.json`;
  if (!force && fs.existsSync(cacheFile)) {
    const c = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
    if (c.hash === hash && c.files.every((f) => fs.existsSync(f))) return { ...c, cached: true };
  }
  const imageConfig = {};
  if (aspectRatio) imageConfig.aspectRatio = aspectRatio;
  if (imageSize) imageConfig.imageSize = imageSize;
  const body = {
    contents: [{ parts: [...refs.map(refPart), { text: prompt }] }],
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
    },
  };
  const res = await withRetry(() => curlJson(`${API}/models/${model}:generateContent`, body));
  if (res.error) throw new Error(`${res.error.code} ${res.error.message}`);
  const parts = res.candidates?.[0]?.content?.parts || [];
  const files = [];
  let text = '';
  parts.forEach((p) => {
    if (p.inlineData?.data) {
      const ext = p.inlineData.mimeType === 'image/jpeg' ? '.jpg' : '.png';
      const file = files.length ? `${out}-${files.length}${ext}` : `${out}${ext}`;
      fs.writeFileSync(file, Buffer.from(p.inlineData.data, 'base64'));
      files.push(file);
    } else if (p.text) text += p.text;
  });
  if (!files.length) {
    const reason =
      res.candidates?.[0]?.finishReason || res.promptFeedback?.blockReason || 'no image';
    throw new Error(`no image returned (${reason}) ${text.slice(0, 200)}`);
  }
  const record = {
    hash,
    model,
    prompt,
    refs: refs.map(String),
    aspectRatio,
    imageSize,
    files,
    text,
    at: new Date().toISOString(),
  };
  fs.writeFileSync(cacheFile, JSON.stringify(record, null, 2));
  fs.appendFileSync(path.join(dir, 'generations.jsonl'), `${JSON.stringify(record)}\n`);
  return { files, text, cached: false };
}

/** Run jobs with bounded concurrency (be polite to rate limits). */
export async function generateAll(jobs, { concurrency = 3, onDone } = {}) {
  const results = new Array(jobs.length);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const i = next++;
      try {
        results[i] = await generateImage(jobs[i]);
      } catch (error) {
        results[i] = { error: error.message };
      }
      onDone?.(jobs[i], results[i], i);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return results;
}

/**
 * Veo motion reference (long-running). Returns the saved .mp4 path.
 * @param {object} o { prompt, image (optional first-frame path), model, aspectRatio, out }
 */
export async function generateVideo({
  prompt,
  image,
  model = MODELS.veoFast,
  aspectRatio = '16:9',
  out,
  pollMs = 10000,
}) {
  const instance = { prompt };
  if (image) {
    const p = refPart(image).inlineData;
    instance.image = { bytesBase64Encoded: p.data, mimeType: p.mimeType };
  }
  const op = await withRetry(() =>
    curlJson(`${API}/models/${model}:predictLongRunning`, {
      instances: [instance],
      parameters: { aspectRatio },
    }),
  );
  if (op.error) throw new Error(`${op.error.code} ${op.error.message}`);
  let state = op;
  while (!state.done) {
    await sleep(pollMs);
    state = await withRetry(() => curlJson(`${API}/${op.name}`, null, { method: 'GET' }));
    if (state.error) throw new Error(`${state.error.code} ${state.error.message}`);
  }
  const uri =
    state.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ||
    state.response?.generatedVideos?.[0]?.video?.uri;
  if (!uri) throw new Error(`no video in response: ${JSON.stringify(state).slice(0, 300)}`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const file = `${out}.mp4`;
  await new Promise((resolve, reject) => {
    const key = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    const args = ['-sSL', '-o', file, uri];
    if (key) args.splice(2, 0, '-H', `x-goog-api-key: ${key}`);
    execFile('curl', args, (err, _o, stderr) =>
      err ? reject(new Error(stderr || err.message)) : resolve(),
    );
  });
  return file;
}

#!/usr/bin/env node
// Generate raw painted heroes for items (direction B). Raw images + provenance go to
// References/items-art/hero/raw (gitignored); treat.mjs keys, crops and dithers them.
//   node tools/art/icons/hero/generate.mjs [--only id,id] [--from 1] [--takes 1]
//                                           [--model pro|flash] [--no-fallback]
import fs from 'node:fs';
import { runJobs } from '../../gen/quotaRunner.mjs';
import { HERO_SUBJECTS, heroPrompt } from './prompts.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const only = arg('only', null)?.split(',');
const takes = Number(arg('takes', 1));
const from = Number(arg('from', 1));
const model = arg('model', 'pro');
export const RAW = 'References/items-art/hero/raw';

const jobs = [];
for (let take = from; take <= takes; take += 1)
  for (const id of Object.keys(HERO_SUBJECTS)) {
    if (only && !only.includes(id)) continue;
    jobs.push({
      name: `${id}#${take}`,
      prompt: heroPrompt(id, take),
      aspectRatio: '1:1',
      imageSize: '1K',
      // Takes from each model are kept apart so both can be compared.
      out: `${RAW}/${id}-${model}-t${take}`,
    });
  }
fs.mkdirSync(RAW, { recursive: true });
const results = await runJobs(jobs, {
  model,
  fallback: argv.includes('--no-fallback') ? null : 'flash',
  log: `${RAW}/run.log`,
});
const failed = results.filter((r) => r.error);
console.log(`${results.length - failed.length}/${results.length} ok`);
if (failed.length) process.exitCode = 1;

#!/usr/bin/env node
// Generate the raw paintings for blessing cards and service vignettes.
//   node tools/art/moments/generate.mjs [--kind card|scene] [--only id,id] [--takes 2]
//                                       [--model pro|flash] [--no-fallback]
// Raw images + provenance (generations.jsonl, <out>.gen.json) go to
// References/items-art/moments/ (gitignored). Curate with treat.mjs; only the treated,
// display-size PNGs listed in selections.json ship.
import fs from 'node:fs';
import { runJobs } from '../gen/quotaRunner.mjs';
import { CARDS, VIGNETTES, momentPrompt } from './prompts.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const kind = arg('kind', 'all');
const only = arg('only', null)?.split(',');
const takes = Number(arg('takes', 2));
const firstTake = Number(arg('from', 1));
export const RAW = 'References/items-art/moments';

const jobs = [];
for (let take = firstTake; take <= takes; take += 1) {
  const add = (k, table, aspectRatio) => {
    for (const [id, subject] of Object.entries(table)) {
      if (only && !only.includes(id)) continue;
      jobs.push({
        name: `${k}/${id}#${take}`,
        prompt: momentPrompt(k, subject, take),
        aspectRatio,
        imageSize: '1K',
        out: `${RAW}/${k}/${id}-t${take}`,
      });
    }
  };
  if (kind === 'all' || kind === 'card') add('card', CARDS, '3:4');
  if (kind === 'all' || kind === 'scene') add('scene', VIGNETTES, '16:9');
}
fs.mkdirSync(RAW, { recursive: true });
const results = await runJobs(jobs, {
  model: arg('model', 'pro'),
  fallback: argv.includes('--no-fallback') ? null : 'flash',
  log: `${RAW}/run.log`,
});
const failed = results.filter((r) => r.error);
console.log(`${results.length - failed.length}/${results.length} ok`);
if (failed.length) process.exitCode = 1;

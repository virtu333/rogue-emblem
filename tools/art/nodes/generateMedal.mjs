#!/usr/bin/env node
// Generate raw candidates for the Event medal (and, with --dark <pick>, its Dark Omen).
//   node tools/art/nodes/generateMedal.mjs [--takes 2] [--only signpost,cairn]
//                                          [--model pro|flash] [--no-fallback]
//   node tools/art/nodes/generateMedal.mjs --dark <picked-event-raw.png> [--takes 3]
// Raw images + provenance go to References/event-art/medal/ (gitignored); bakeMedals.mjs
// turns the picks in selections.json into the shipped atlas.
import { runJobs } from '../gen/quotaRunner.mjs';
import { DARK_OMEN, EVENT_CONCEPTS, STYLE } from './prompts.mjs';

const argv = process.argv.slice(2);
const arg = (k, d) => (argv.includes(`--${k}`) ? argv[argv.indexOf(`--${k}`) + 1] : d);
const takes = Number(arg('takes', 2));
const only = arg('only', null)?.split(',');
const dark = arg('dark', null);
export const RAW = 'References/event-art/medal';
const SHEET = 'assets/sprites/nodes/weathered-nodes.png';

const jobs = [];
for (let take = 1; take <= takes; take += 1) {
  if (dark) {
    jobs.push({
      name: `dark#${take}`,
      prompt: `${DARK_OMEN}${take > 1 ? ` Alternative take ${take}.` : ''}`,
      refs: [dark, SHEET],
      aspectRatio: '1:1',
      imageSize: '1K',
      out: `${RAW}/dark-t${take}`,
    });
    continue;
  }
  for (const [id, subject] of Object.entries(EVENT_CONCEPTS)) {
    if (only && !only.includes(id)) continue;
    jobs.push({
      name: `event/${id}#${take}`,
      prompt: `${STYLE}\nSubject: ${subject}.${take > 1 ? ` Alternative composition ${take}.` : ''}`,
      refs: [SHEET],
      aspectRatio: '1:1',
      imageSize: '1K',
      out: `${RAW}/${id}-t${take}`,
    });
  }
}
const results = await runJobs(jobs, {
  model: arg('model', 'pro'),
  fallback: argv.includes('--no-fallback') ? null : 'flash',
  log: `${RAW}/run.log`,
});
const failed = results.filter((r) => r.error);
console.log(`${results.length - failed.length}/${results.length} ok`);
if (failed.length) process.exitCode = 1;

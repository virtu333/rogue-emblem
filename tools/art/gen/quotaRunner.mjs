// quotaRunner — sequential generation for production batches, with model fallback.
//
// Jobs run one at a time with a pause between paid calls. The Pro image model has a
// shared daily quota; when a call reports the quota as exhausted, the runner switches
// the rest of the batch to the fallback model (Flash) instead of retrying for hours.
// Each job records which model actually produced it (the geminiImage provenance log
// and `<out>.gen.json` say the same), so curation can hold both to the same bar.
import fs from 'node:fs';
import { generateImage, MODELS } from './geminiImage.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A 429 that means "no more today", not "slow down". */
export function isDailyQuota(message = '') {
  return /quota|exhausted|per day|RESOURCE_EXHAUSTED/i.test(message) && /429|quota/i.test(message);
}

/**
 * @param {Array<{name:string, prompt:string, out:string, aspectRatio?:string, imageSize?:string, refs?:string[]}>} jobs
 * @param {{model?:'pro'|'flash', fallback?:'flash'|null, gapMs?:number, log?:string}} options
 * @returns {Promise<Array<{name:string, files?:string[], model?:string, cached?:boolean, error?:string}>>}
 */
export async function runJobs(
  jobs,
  { model = 'pro', fallback = 'flash', gapMs = 12000, log } = {},
) {
  let current = model;
  const results = [];
  const note = (line) => {
    console.log(line);
    if (log) fs.appendFileSync(log, `${new Date().toISOString()} ${line}\n`);
  };
  for (const job of jobs) {
    let result = null;
    for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
      try {
        const r = await generateImage({ ...job, model: MODELS[current] });
        const record = JSON.parse(fs.readFileSync(`${job.out}.gen.json`, 'utf8'));
        result = { name: job.name, files: r.files, cached: r.cached, model: record.model };
        note(`${r.cached ? 'cached' : 'new'} ${record.model} ${job.name}`);
        if (!r.cached) await sleep(gapMs);
      } catch (error) {
        const message = String(error.message || error);
        if (isDailyQuota(message) && current !== fallback && fallback) {
          note(`quota exhausted on ${current}; switching to ${fallback} (${job.name})`);
          current = fallback;
          continue;
        }
        if (/no image returned/i.test(message) && attempt < 2) {
          note(`retry ${job.name}: ${message.slice(0, 120)}`);
          await sleep(gapMs);
          continue;
        }
        result = { name: job.name, error: message };
        note(`FAILED ${job.name}: ${message.slice(0, 160)}`);
      }
    }
    results.push(result || { name: job.name, error: 'gave up' });
  }
  return results;
}

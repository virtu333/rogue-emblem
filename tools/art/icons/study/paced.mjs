// Sequential generation with a pause between paid calls (the key has a spend-rate cap).
import { generateImage } from '../../gen/geminiImage.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function paced(jobs, { gapMs = 15000, retries = 3 } = {}) {
  const results = [];
  for (const job of jobs) {
    let r;
    for (let a = 0; a <= retries; a++) {
      try {
        r = await generateImage(job);
        break;
      } catch (e) {
        r = { error: e.message };
        if (!/rate|429|exhausted/i.test(e.message)) break;
        await sleep(60000 * (a + 1));
      }
    }
    console.log(
      r.error
        ? `FAILED ${job.name || job.out}: ${r.error.slice(0, 120)}`
        : `${r.cached ? 'cached' : 'new'} ${job.name || job.out}`,
    );
    results.push(r);
    if (!r.cached && !r.error) await sleep(gapMs);
  }
  return results;
}

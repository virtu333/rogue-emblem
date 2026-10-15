import { describe, it, expect } from 'vitest';
import { summarizeDurations, summaryMarkdown } from '../tools/e2eDurationReporter.js';

const result = (file, title, durationMs, retry = 0) => ({
  file,
  title,
  durationMs,
  status: 'passed',
  retry,
});

describe('e2e duration report', () => {
  it("sums each file's tests, retries included, slowest file first", () => {
    const report = summarizeDurations(
      [
        result('a.spec.js', 'one', 10_000),
        result('b.spec.js', 'two', 30_000),
        result('a.spec.js', 'three', 5_000),
        // A retried test: the failed attempt and the retry both cost the shard time.
        result('a.spec.js', 'one', 20_000, 1),
      ],
      { lane: 'portrait', shard: '2/6', wallMs: 40_000 },
    );
    expect(Object.keys(report.files)).toEqual(['a.spec.js', 'b.spec.js']);
    expect(report.files['a.spec.js']).toEqual({
      seconds: 35,
      tests: 2,
      retried: 1,
      slowest: [
        { title: 'one', seconds: 30 },
        { title: 'three', seconds: 5 },
      ],
    });
    expect(report.files['b.spec.js'].seconds).toBe(30);
    expect(report).toMatchObject({
      lane: 'portrait',
      shard: '2/6',
      wallSeconds: 40,
      workSeconds: 65,
    });
  });

  it('writes a job-summary table in minutes', () => {
    const md = summaryMarkdown(
      summarizeDurations([result('a.spec.js', 'one', 90_000)], { lane: 'smoke', wallMs: 60_000 }),
    );
    expect(md).toContain('### e2e durations: smoke');
    expect(md).toContain('| a.spec.js | 1.5 | 1 | 0 |');
  });
});

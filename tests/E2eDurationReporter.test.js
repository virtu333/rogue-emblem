import { describe, it, expect } from 'vitest';
import {
  nearTimeoutLines,
  summarizeDurations,
  summaryMarkdown,
} from '../tools/e2eDurationReporter.js';

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

  it('lists the attempts that used 60% or more of their timeout, closest first', () => {
    const near = (title, durationMs, timeoutMs, status = 'passed', retry = 0) => ({
      ...result('a.spec.js', title, durationMs, retry),
      status,
      timeoutMs,
    });
    const report = summarizeDurations([
      near('comfortable', 17_999, 30_000),
      near('at the line', 18_000, 30_000),
      near('close', 27_000, 30_000),
      near('long but given room', 60_000, 120_000),
      near('timed out', 30_100, 30_000, 'timedOut'),
      near('retried close', 24_000, 30_000, 'passed', 1),
      // No timeout known (an older result): never listed.
      result('a.spec.js', 'unknown', 90_000),
    ]);
    expect(report.nearTimeout.map((t) => t.title)).toEqual([
      'timed out',
      'close',
      'retried close',
      'at the line',
    ]);
    expect(report.nearTimeout[1]).toEqual({
      file: 'a.spec.js',
      title: 'close',
      seconds: 27,
      timeoutSeconds: 30,
      share: 0.9,
      status: 'passed',
      retry: 0,
    });
    const lines = nearTimeoutLines(report);
    expect(lines[0]).toBe('[e2e near timeout] 4 attempt(s) used 60%+ of their timeout:');
    expect(lines[1]).toContain('a.spec.js › timed out (timedOut)');
    expect(lines[3]).toContain('(retry)');
    expect(summaryMarkdown(report)).toContain('| a.spec.js › close | 27 | 30 | passed |');
  });

  it('prints nothing near the timeout when every test had room', () => {
    const report = summarizeDurations([
      { ...result('a.spec.js', 'one', 1_000), timeoutMs: 30_000 },
    ]);
    expect(report.nearTimeout).toEqual([]);
    expect(nearTimeoutLines(report)).toEqual([]);
    expect(summaryMarkdown(report)).not.toContain('Near their timeout');
  });
});

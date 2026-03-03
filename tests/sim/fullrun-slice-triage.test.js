import { describe, it, expect } from 'vitest';
import { parseArgsFrom, extractSectionLines, parseFailingMetrics } from './fullrun-slice-triage.js';

describe('fullrun-slice-triage helpers', () => {
  it('parses range shorthand', () => {
    const opts = parseArgsFrom(['--slice', 'progression_invincible', '--range', 'abc123..def456']);
    expect(opts.slice).toBe('progression_invincible');
    expect(opts.from).toBe('abc123');
    expect(opts.to).toBe('def456');
    expect(opts.firstParent).toBe(true);
  });

  it('parses explicit range with default to HEAD', () => {
    const opts = parseArgsFrom(['--slice', 'ambush_hard_invincible', '--from', '7be192d']);
    expect(opts.from).toBe('7be192d');
    expect(opts.to).toBe('HEAD');
  });

  it('extracts threshold breach lines from output sections', () => {
    const output = `
--- Summary ---
ok

--- Threshold Breaches ---
avg_gold=31285.33 > threshold=26600.00
avg_ambush_battles=0.25 < threshold=0.50

--- Slice Failures ---
slice=ambush_hard_invincible exit_code=1
`;

    const lines = extractSectionLines(output, '--- Threshold Breaches ---');
    expect(lines).toEqual([
      'avg_gold=31285.33 > threshold=26600.00',
      'avg_ambush_battles=0.25 < threshold=0.50',
    ]);
  });

  it('falls back to failure section when threshold section is missing', () => {
    const output = `
--- Failures ---
seed=123 result=stuck
`;
    const lines = parseFailingMetrics(output, 1);
    expect(lines).toEqual(['seed=123 result=stuck']);
  });
});

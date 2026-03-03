import { describe, expect, it } from 'vitest';
import {
  extractChangedThresholdLines,
  extractSliceThresholdValues,
  missingPrNoteSections,
  validateThresholdPrNotes,
} from '../tools/checkThresholdPrNotes.js';

describe('checkThresholdPrNotes helpers', () => {
  it('extracts threshold values by slice from slice source text', () => {
    const source = `
export const FULLRUN_SLICES = {
  progression_invincible: {
    args: [
      '--seed-start',
      '201',
      '--max-avg-shop-spent',
      '9500',
      '--max-timeout-rate',
      '0.00',
    ],
  },
};
`;

    const values = extractSliceThresholdValues(source);
    expect(values.get('progression_invincible:--max-avg-shop-spent')).toBe('9500');
    expect(values.get('progression_invincible:--max-timeout-rate')).toBe('0.00');
    expect(values.has('progression_invincible:--seed-start')).toBe(false);
  });

  it('detects value-only threshold changes between commit snapshots', () => {
    const beforeSource = `
export const FULLRUN_SLICES = {
  progression_invincible: {
    args: [
      '--max-avg-shop-spent',
      '9500',
      '--max-timeout-rate',
      '0.00',
    ],
  },
};
`;
    const afterSource = `
export const FULLRUN_SLICES = {
  progression_invincible: {
    args: [
      '--max-avg-shop-spent',
      '11600',
      '--max-timeout-rate',
      '0.00',
    ],
  },
};
`;

    const lines = extractChangedThresholdLines(beforeSource, afterSource);
    expect(lines).toEqual(['progression_invincible --max-avg-shop-spent: 9500 -> 11600']);
  });

  it('finds missing required PR note sections', () => {
    const missing = missingPrNoteSections('first_bad_sha=abc123');
    expect(missing).toEqual([
      'attribution command',
      'parent_sha',
      'failing metrics',
      'touched files',
    ]);
  });

  it('enforces PR body fields when threshold lines changed', () => {
    const beforeSource = `
export const FULLRUN_SLICES = {
  progression_invincible: {
    args: [
      '--max-avg-shop-spent',
      '9500',
    ],
  },
};
`;
    const afterSource = `
export const FULLRUN_SLICES = {
  progression_invincible: {
    args: [
      '--max-avg-shop-spent',
      '11600',
    ],
  },
};
`;
    const payload = {
      pull_request: {
        body: `
cmd: npm run sim:fullrun:harness:triage -- --slice progression_invincible --range a..b
first_bad_sha=7be192d
parent_sha=1234567
failing metrics:
- avg_shop_spent=10533 > threshold=9500
touched files:
- tests/sim/fullrun-slices.js
`,
      },
    };

    const result = validateThresholdPrNotes({
      payload,
      beforeText: beforeSource,
      afterText: afterSource,
    });

    expect(result.enforced).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it('does not enforce when non-threshold values changed only', () => {
    const beforeSource = `
export const FULLRUN_SLICES = {
  progression_invincible: {
    args: [
      '--seed-start',
      '201',
    ],
  },
};
`;
    const afterSource = `
export const FULLRUN_SLICES = {
  progression_invincible: {
    args: [
      '--seed-start',
      '202',
    ],
  },
};
`;

    const result = validateThresholdPrNotes({
      payload: {
        pull_request: {
          body: '',
        },
      },
      beforeText: beforeSource,
      afterText: afterSource,
    });

    expect(result.enforced).toBe(false);
    expect(result.missing).toEqual([]);
  });
});

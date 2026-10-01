import { describe, it, expect } from 'vitest';
import { helpPreviewPlan, HELP_PREVIEW_CHARS } from '../src/ui/ContextHelp.js';
import { SCROLLS_HELP, WEAPON_ARTS_HELP } from '../src/ui/helpTopics.js';

// A hover preview shows a short guide whole and only the leading blocks of a long one.
const text = (n) => 'x'.repeat(n);

describe('helpPreviewPlan', () => {
  it('shows every block of a guide that fits the budget', () => {
    const blocks = [{ lead: text(50) }, text(100), { tip: text(50) }];
    expect(helpPreviewPlan(blocks, 200)).toEqual({ shown: blocks, truncated: false });
  });

  it('stops at the first block that would pass the budget, in reading order', () => {
    const blocks = [{ lead: text(50) }, text(100), text(60), text(10)];
    const plan = helpPreviewPlan(blocks, 200);
    // 50 + 100 fits; 60 more would reach 210. The later 10-char block is not pulled forward.
    expect(plan.shown).toEqual(blocks.slice(0, 2));
    expect(plan.truncated).toBe(true);
  });

  it('always shows the first block, however long', () => {
    const blocks = [{ lead: text(500) }, text(10)];
    const plan = helpPreviewPlan(blocks, 100);
    expect(plan.shown).toEqual([blocks[0]]);
    expect(plan.truncated).toBe(true);
  });

  it('skips empty blocks and survives no content', () => {
    expect(helpPreviewPlan([{ points: [] }, '', text(5)], 100)).toEqual({
      shown: [text(5)],
      truncated: false,
    });
    expect(helpPreviewPlan(undefined)).toEqual({ shown: [], truncated: false });
  });

  it('keeps the scroll guide whole and trims the longer weapon-art guide', () => {
    expect(helpPreviewPlan(SCROLLS_HELP)).toEqual({ shown: SCROLLS_HELP, truncated: false });
    const arts = helpPreviewPlan(WEAPON_ARTS_HELP);
    expect(arts.truncated).toBe(true);
    expect(arts.shown[0]).toBe(WEAPON_ARTS_HELP[0]);
    expect(arts.shown.length).toBeLessThan(WEAPON_ARTS_HELP.length);
    expect(HELP_PREVIEW_CHARS).toBe(600);
  });
});

import { describe, it, expect } from 'vitest';
import { traceId } from '../tools/art/sprite-trace/lib/pipeline.mjs';
import { ROSTER } from '../tools/art/sprite-trace/roster.mjs';
import { KINDS, fitScale } from '../tools/art/sprite-trace/lib/place.mjs';
import { BODY_EXCLUDE } from '../tools/art/sprite-trace/lib/slots.mjs';

// The map sprites' size budget (tools/art/sprite-trace/lib/place.mjs KINDS `mass`), traced
// from the real reference art: the broad designs that drew far more of the board than
// others of their kind at the same height (owner review, 2026-10-27: the Great Knight)
// now cover no more than their kind's budget, while dragons keep their looming size.

const D = 1.5;

/** Traced px of body (weapons excluded), the measure the budget caps. */
function bodyArea(sprite) {
  let n = 0;
  for (let i = 0; i < sprite.w * sprite.h; i++)
    if (sprite.slot[i] && !BODY_EXCLUDE.has(sprite.slot[i])) n++;
  return n;
}

/** The scale the height rule alone gives (no budget), from the trace's own measures. */
function heightRuleScale(t) {
  const { prep, seg, sprite } = t;
  const { w, h } = seg;
  const asp = sprite.meta.aspect;
  let bx0 = Infinity,
    by0 = Infinity,
    bx1 = -1,
    by1 = -1,
    fx0 = Infinity,
    fy0 = Infinity,
    fx1 = -1,
    fy1 = -1;
  for (let p = 0; p < w * h; p++) {
    if (!prep.fill[p]) continue;
    const x = p % w,
      y = (p / w) | 0;
    fx0 = Math.min(fx0, x);
    fx1 = Math.max(fx1, x);
    fy0 = Math.min(fy0, y);
    fy1 = Math.max(fy1, y);
    if (BODY_EXCLUDE.has(prep.fill[p])) continue;
    bx0 = Math.min(bx0, x);
    bx1 = Math.max(bx1, x);
    by0 = Math.min(by0, y);
    by1 = Math.max(by1, y);
  }
  return fitScale((by1 - by0 + 1) * asp, fx1 - fx0 + 1, (fy1 - fy0 + 1) * asp, sprite.meta.kind, D);
}

// the reduction rounds and outlines the fill, so a capped figure lands near, not on, it
const SLACK = 1.15;
const budget = (kind) => KINDS[kind].mass * D * D * SLACK;

describe('map sprites keep to their kind’s size budget', () => {
  // every armoured rider, foot knight and flyer design the battlefield shows
  const ids = Object.keys(ROSTER.sources).filter(
    (id) =>
      ['mounted', 'heavy', 'flyer'].includes(ROSTER.sources[id].kind) &&
      ROSTER.sources[id].mass !== false &&
      /_(a|b|e)$/.test(id),
  );

  it('covers the broad designs that stood out', () => {
    for (const id of ['great_knight_a', 'great_knight_b', 'great_knight_e', 'dark_knight_a'])
      expect(ids).toContain(id);
    expect(ids).toContain('knight_e');
  });

  it.each(ids)('%s covers no more than its kind allows', async (id) => {
    const t = await traceId(id, { density: D });
    expect(bodyArea(t.sprite)).toBeLessThanOrEqual(budget(t.sprite.meta.kind));
  });

  it('leaves a slight design at the height rule (the Paladin)', async () => {
    for (const id of ['paladin_a', 'paladin_e', 'knight_a']) {
      const t = await traceId(id, { density: D });
      expect(t.sprite.meta.scale).toBeCloseTo(heightRuleScale(t), 6);
    }
  });

  it('shrinks the Great Knight below the height rule', async () => {
    const t = await traceId('great_knight_b', { density: D });
    expect(t.sprite.meta.scale).toBeLessThan(heightRuleScale(t) * 0.9);
  });

  it('lets the dragons loom (no budget)', async () => {
    for (const id of ['dragon_e', 'dragon_lord_e']) {
      expect(ROSTER.sources[id].mass).toBe(false);
      const t = await traceId(id, { density: D });
      expect(t.sprite.meta.scale).toBeCloseTo(heightRuleScale(t), 6);
      expect(bodyArea(t.sprite)).toBeGreaterThan(budget('mounted'));
    }
  });
});

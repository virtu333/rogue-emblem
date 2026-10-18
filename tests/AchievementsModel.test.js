// What the Records tab, the Home Base chip and the unlock card show (ui/achievementsModel.js).
//
// Ways this can fail, each pinned below:
// - a secret not yet earned gives away its name or its rule;
// - an earned secret still reads "???";
// - a counted achievement shows no progress, or keeps a bar once earned;
// - an achievement a newer build earned is counted (the total would read 70 / 69);
// - the retroactive pass shows a card per achievement instead of one summary;
// - an unknown id makes an empty card.

import { describe, expect, it } from 'vitest';
import {
  HIDDEN_RULE,
  HIDDEN_TEXT,
  achievementChipText,
  achievementsView,
  unlockCards,
} from '../src/ui/achievementsModel.js';
import { achievementEntries, emptyAchievementState } from '../src/engine/Achievements.js';

const state = (earned = {}, extra = {}) => ({ ...emptyAchievementState(), earned, ...extra });
const rowOf = (view, id) => view.sections.flatMap((s) => s.rows).find((r) => r.id === id);

describe('the tab', () => {
  it('lists every entry once, in its section, counted', () => {
    const view = achievementsView(state());
    expect(view.total).toBe(achievementEntries().length);
    expect(view.earned).toBe(0);
    expect(view.sections.map((s) => s.label)).toEqual([
      'The March',
      'The Field',
      'The Company',
      'The Road',
      'The Challenge',
      'Secrets',
    ]);
    expect(view.sections.reduce((n, s) => n + s.total, 0)).toBe(view.total);
    expect(view.byTier.map((t) => t.label)).toEqual(['Bronze', 'Silver', 'Gold', 'Black Sun']);
  });

  it('a secret reads ??? until earned, then its name, rule and date', () => {
    const locked = rowOf(achievementsView(state()), 'unfathomed');
    expect(locked).toMatchObject({ name: HIDDEN_TEXT, rule: HIDDEN_RULE, hidden: true });
    const at = Date.UTC(2026, 9, 17, 12);
    const open = rowOf(achievementsView(state({ unfathomed: { at } })), 'unfathomed');
    expect(open).toMatchObject({ name: 'Unfathomed', hidden: false, earned: true });
    expect(open.rule).toBe('Land a critical hit on the Entity.');
    expect(open.date).toMatch(/2026/);
    // An ordinary entry is never hidden.
    expect(rowOf(achievementsView(state()), 'first_blood').name).toBe('First Blood');
  });

  it('a counted entry shows its progress until earned', () => {
    const totals = { marks: ['ember', 'forge', 'hunt', 'road', 'veil'] };
    const s = state({}, { sets: { ...emptyAchievementState().sets, marks: ['forge', 'veil'] } });
    expect(rowOf(achievementsView(s, { totals }), 'five_marks').progress).toEqual({
      have: 2,
      goal: 5,
    });
    const done = { ...s, earned: { five_marks: { at: 1 } } };
    expect(rowOf(achievementsView(done, { totals }), 'five_marks').progress).toBeNull();
    // A set whose total the data does not give shows no bar (never "0 / 0").
    expect(rowOf(achievementsView(s), 'five_marks').progress).toBeNull();
  });

  it("a newer build's achievement is kept but not counted", () => {
    const view = achievementsView(state({ first_blood: { at: 1 }, from_the_future: { at: 2 } }));
    expect(view.earned).toBe(1);
    expect(view.percent).toBe(Math.floor(100 / view.total));
  });

  it('the chip', () => {
    const chip = achievementChipText(state({ first_blood: { at: 1 } }));
    expect(chip).toEqual({ label: 'Achievements', count: `1 / ${achievementEntries().length}` });
  });
});

describe('the unlock card', () => {
  it('one card per achievement, named with its tier', () => {
    expect(unlockCards(['first_blood', 'shatter'])).toEqual([
      {
        kind: 'unlock',
        id: 'first_blood',
        tier: 'bronze',
        heading: 'Achievement · Bronze',
        name: 'First Blood',
        rule: 'Win a battle in a run.',
      },
      expect.objectContaining({ id: 'shatter', tier: 'gold', heading: 'Achievement · Gold' }),
    ]);
  });

  it('the retroactive pass is one summary card at its best tier', () => {
    expect(unlockCards(['first_blood', 'into_the_dusk', 'deeper_roads'], { retro: true })).toEqual([
      {
        kind: 'retro',
        tier: 'gold',
        heading: 'From your past runs',
        name: '3 achievements earned',
        rule: 'See them in Records.',
      },
    ]);
    expect(unlockCards(['first_blood'], { retro: true })[0].name).toBe('1 achievement earned');
  });

  it('an unknown id makes no card', () => {
    expect(unlockCards(['not_a_thing'])).toEqual([]);
    expect(unlockCards(null)).toEqual([]);
  });
});

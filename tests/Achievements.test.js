// The achievements' rules and state (engine/Achievements.js, docs/specs/achievements.md).
//
// Ways this can fail, each pinned below:
// - an achievement fires for the wrong facts, or never fires (a rule typo, a renamed fact);
// - a near miss counts (one turn short of par, a run that was lost, the wrong rung);
// - a set-completing achievement completes before every id is in (or never does);
// - the union of two copies loses one, moves a date later, or counts a steal twice;
// - a retried battle commit adds its steals again;
// - a garbled save throws or invents an achievement.

import { describe, expect, it } from 'vitest';
import {
  ACHIEVEMENT_RULES,
  achievementCatalog,
  achievementEntries,
  achievementProgress,
  applyAchievementFacts,
  emptyAchievementState,
  isEarned,
  mergeAchievementStates,
  normalizeAchievementState,
  tallyTotal,
  validateAchievementsCatalog,
} from '../src/engine/Achievements.js';
import { readFileSync } from 'node:fs';

const NOW = 1_700_000_000_000;
const apply = (state, facts, ctx = {}) =>
  applyAchievementFacts(state, facts, { now: NOW, slot: '1', ...ctx });
const earnedBy = (facts, state = emptyAchievementState()) => apply(state, facts).unlocked;

// A plain won battle of a run, with nothing special about it.
const battle = (extra = {}) => ({
  standard: true,
  key: `1:act2:n${Math.random()}:3`,
  actId: 'act2',
  actBoss: false,
  gateBoss: false,
  descent: false,
  bossesSlain: [],
  objective: 'rout',
  turn: 7,
  par: 8,
  foesDefeated: 4,
  maxUnitKills: 2,
  alliesWounded: 2,
  alliesFallen: 0,
  allEscaped: false,
  maxStrike: 12,
  entityCrits: 0,
  shatters: 0,
  ballistaBossKills: 0,
  cleanNecromancerKills: 0,
  maxRefreshBurst: 0,
  maxPushTiles: 0,
  steals: 0,
  perfectLevelUps: 0,
  talkRecruits: 0,
  vigil: false,
  vigilSummoned: 0,
  limbsEnabled: false,
  limbsSprouted: 0,
  loneCommander: false,
  eclipsedElite: false,
  bossBeatenAfterLosses: 0,
  heraldHeard: false,
  ngPlusVeteran: false,
  ...extra,
});
const runEnd = (extra = {}) => ({
  victory: true,
  difficulty: 'normal',
  commander: 'Edric',
  allyFalls: 2,
  visionUses: 1,
  shopBuys: 4,
  battlesWon: 20,
  overPar: 3,
  blessingIds: [],
  shrineSkipped: false,
  ...extra,
});

describe('the catalog', () => {
  it('is valid: every entry has a rule and every rule an entry', () => {
    const result = validateAchievementsCatalog();
    expect(result.errors).toEqual([]);
    expect(achievementEntries()).toHaveLength(69);
    expect(Object.keys(ACHIEVEMENT_RULES)).toHaveLength(69);
  });

  it('refuses a duplicate id, an unknown tier and an entry without a rule', () => {
    const catalog = structuredClone(achievementCatalog());
    catalog.achievements.push({ ...catalog.achievements[0] });
    catalog.achievements.push({
      id: 'made_up',
      name: 'X',
      rule: 'Y',
      tier: 'tin',
      section: 'march',
    });
    const { errors } = validateAchievementsCatalog(catalog);
    expect(errors.some((e) => e.includes('duplicate id'))).toBe(true);
    expect(errors.some((e) => e.includes('made_up: unknown tier'))).toBe(true);
    expect(errors.some((e) => e.includes('made_up: no rule'))).toBe(true);
  });

  it('the shipped copy in public/data matches data/', () => {
    const a = readFileSync('data/achievements.json', 'utf8');
    const b = readFileSync('public/data/achievements.json', 'utf8');
    expect(JSON.parse(b)).toEqual(JSON.parse(a));
  });
});

// Each rule: facts that earn it, and the nearest facts that do not.
const CASES = {
  banner_at_dawn: [{ prologueComplete: true }, { prologueComplete: false }],
  first_blood: [{ battle: battle() }, { battle: battle({ standard: false }) }],
  past_the_first_gate: [
    { battle: battle({ actId: 'act1', actBoss: true }) },
    { battle: battle({ actId: 'act2', actBoss: true }) },
  ],
  deeper_roads: [{ battle: battle({ actId: 'act3' }) }, { battle: battle({ actId: 'act2' }) }],
  first_light: [
    { runEnd: runEnd({ difficulty: 'normal' }) },
    { runEnd: runEnd({ difficulty: 'normal', victory: false }) },
  ],
  down_the_stair: [{ battle: battle({ descent: true }) }, { battle: battle() }],
  into_the_dusk: [{ runEnd: runEnd({ difficulty: 'dusk' }) }, { runEnd: runEnd() }],
  the_glass_breaks: [{ battle: battle({ gateBoss: true }) }, { battle: battle({ actBoss: true }) }],
  the_sleeper_falls: [
    { battle: battle({ bossesSlain: ['The Entity'] }) },
    { battle: battle({ bossesSlain: ['The Lieutenant'] }) },
  ],
  black_sun: [
    { runEnd: runEnd({ difficulty: 'lunatic' }) },
    { runEnd: runEnd({ difficulty: 'hard' }) },
  ],
  who_rides_again: [{ battle: battle({ ngPlusVeteran: true }) }, { battle: battle() }],
  seize_the_day: [{ battle: battle({ objective: 'seize' }) }, { battle: battle() }],
  ahead_of_the_dark: [
    { battle: battle({ turn: 5, par: 8 }) },
    { battle: battle({ turn: 6, par: 8 }) },
  ],
  not_a_scratch: [
    { battle: battle({ foesDefeated: 6, alliesWounded: 0 }) },
    { battle: battle({ foesDefeated: 6, alliesWounded: 1 }) },
  ],
  all_out: [
    { battle: battle({ objective: 'escape', allEscaped: true }) },
    { battle: battle({ objective: 'escape', allEscaped: false }) },
  ],
  heavy_hand: [{ battle: battle({ maxStrike: 50 }) }, { battle: battle({ maxStrike: 49 }) }],
  red_harvest: [{ battle: battle({ maxUnitKills: 10 }) }, { battle: battle({ maxUnitKills: 9 }) }],
  shatter: [{ battle: battle({ shatters: 1 }) }, { battle: battle() }],
  dawn_strike: [{ battle: battle({ turn: 1 }) }, { battle: battle({ turn: 2 }) }],
  encore: [{ battle: battle({ maxRefreshBurst: 3 }) }, { battle: battle({ maxRefreshBurst: 2 }) }],
  light_fingers: [{ battle: battle({ steals: 1 }) }, { battle: battle() }],
  bolt_from_the_blue: [{ battle: battle({ ballistaBossKills: 1 }) }, { battle: battle() }],
  rink: [{ battle: battle({ maxPushTiles: 4 }) }, { battle: battle({ maxPushTiles: 3 }) }],
  bone_dry: [{ battle: battle({ cleanNecromancerKills: 1 }) }, { battle: battle() }],
  silent_vigil: [
    { battle: battle({ vigil: true, vigilSummoned: 0 }) },
    { battle: battle({ vigil: true, vigilSummoned: 1 }) },
  ],
  root_and_branch: [
    { battle: battle({ bossesSlain: ['The Entity'], limbsEnabled: true, limbsSprouted: 0 }) },
    { battle: battle({ bossesSlain: ['The Entity'], limbsEnabled: true, limbsSprouted: 1 }) },
  ],
  talked_down: [{ battle: battle({ talkRecruits: 1 }) }, { battle: battle() }],
  new_colours: [{ run: { playerPromotion: true } }, { run: { playerPromotion: false } }],
  a_name_to_remember: [{ run: { epithet: true } }, { run: { epithet: false } }],
  sworn: [{ run: { oath: true } }, { run: { oath: false } }],
  spoils_of_war: [{ run: { bossRecruits: 1 } }, { run: { bossRecruits: 0 } }],
  marked: [{ run: { markIds: ['forge'] } }, { run: { markIds: [] } }],
  perfect_year: [{ battle: battle({ perfectLevelUps: 1 }) }, { battle: battle() }],
  living_legend: [{ run: { maxDeeds: 5 } }, { run: { maxDeeds: 4 } }],
  full_banner: [
    { run: { lordCount: 7 }, totals: { lords: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } },
    { run: { lordCount: 6 }, totals: { lords: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } },
  ],
  lone_lord: [
    { battle: battle({ loneCommander: true, actId: 'act3' }) },
    { battle: battle({ loneCommander: true, actId: 'act2' }) },
  ],
  nobody_left_behind: [
    { runEnd: runEnd({ difficulty: 'hard', allyFalls: 0 }) },
    { runEnd: runEnd({ difficulty: 'dusk', allyFalls: 0 }) },
  ],
  a_vow_taken: [{ run: { blessingVows: 1 } }, { run: { blessingVows: 0 } }],
  a_price_paid: [{ run: { actBossCards: 1 } }, { run: { actBossCards: 0 } }],
  not_today: [{ run: { visionUses: 1 } }, { run: { visionUses: 0 } }],
  cleansed: [{ run: { cleanses: 1 } }, { run: { cleanses: 0 } }],
  paid_in_full: [{ run: { contractsPaid: 1 } }, { run: { contractsPaid: 0 } }],
  dark_omen: [{ run: { darkOmens: 1 } }, { run: { darkOmens: 0 } }],
  old_stones: [{ run: { sanctums: 1 } }, { run: { sanctums: 0 } }],
  under_the_dark: [{ battle: battle({ eclipsedElite: true }) }, { battle: battle() }],
  crowd_pleaser: [{ run: { arenaGoldWins: 1 } }, { run: { arenaGoldWins: 0 } }],
  champion_of_the_pit: [
    { run: { arenaPlatinumWins: 1 } },
    { run: { arenaGoldWins: 3, arenaPlatinumWins: 0 } },
  ],
  deep_pockets: [{ run: { gold: 10_000 } }, { run: { gold: 9_999 } }],
  masterwork: [{ run: { maxForge: 10 } }, { run: { maxForge: 9 } }],
  one_of_a_kind: [{ run: { epicNames: ['Hollowsong'] } }, { run: { epicNames: [] } }],
  trophy_hunter: [{ run: { trophy: true } }, { run: { trophy: false } }],
  self_reliant: [
    { runEnd: runEnd({ shopBuys: 0 }) },
    { runEnd: runEnd({ shopBuys: 0, victory: false }) },
  ],
  clear_sight: [
    { runEnd: runEnd({ difficulty: 'lunatic', visionUses: 0 }) },
    { runEnd: runEnd({ difficulty: 'lunatic', visionUses: 1 }) },
  ],
  few_and_proud: [
    { runEnd: runEnd({ blessingIds: ['the_chosen_few'] }) },
    { runEnd: runEnd({ blessingIds: ['bulwark'] }) },
  ],
  on_schedule: [
    { runEnd: runEnd({ difficulty: 'hard', overPar: 0 }) },
    { runEnd: runEnd({ difficulty: 'hard', overPar: 1 }) },
  ],
  no_blessing: [
    { runEnd: runEnd({ difficulty: 'lunatic', shrineSkipped: true }) },
    { runEnd: runEnd({ difficulty: 'hard', shrineSkipped: true }) },
  ],
  the_unbroken_thread: [
    { runEnd: runEnd({ difficulty: 'lunatic', allyFalls: 0, visionUses: 0 }) },
    { runEnd: runEnd({ difficulty: 'lunatic', allyFalls: 1, visionUses: 0 }) },
  ],
  not_this_thread: [{ prologueProtectedFall: true }, {}],
  third_time: [
    { battle: battle({ bossBeatenAfterLosses: 3 }) },
    { battle: battle({ bossBeatenAfterLosses: 2 }) },
  ],
  unfathomed: [{ battle: battle({ entityCrits: 1 }) }, { battle: battle() }],
  the_heralds_ear: [
    { battle: battle({ bossesSlain: ['The Entity'], heraldHeard: true }) },
    { battle: battle({ bossesSlain: ['The Entity'], heraldHeard: false }) },
  ],
};
// Set- and tally-completing entries are covered on their own below.
const SET_ENTRIES = [
  'every_rung',
  'kingslayers_ledger',
  'five_marks',
  'every_deed',
  'seven_banners',
  'every_road_a_tale',
  'armory_of_legends',
  'cutpurse',
];

describe('each rule', () => {
  it('every entry is covered by a case here or a set test below', () => {
    const covered = new Set([...Object.keys(CASES), ...SET_ENTRIES]);
    expect(achievementEntries().filter((e) => !covered.has(e.id))).toEqual([]);
  });

  for (const [id, [meets, misses]] of Object.entries(CASES)) {
    it(`${id}: earned by its facts, not by the nearest miss`, () => {
      expect(earnedBy(meets)).toContain(id);
      expect(earnedBy(misses)).not.toContain(id);
    });
  }

  it('a scripted battle earns nothing a battle could', () => {
    const facts = { battle: battle({ standard: false, turn: 1, maxStrike: 99, steals: 2 }) };
    expect(earnedBy(facts)).toEqual([]);
  });

  it('a rule that throws is not met and breaks nothing', () => {
    // A battle with garbled fields: the rules read them as zero.
    const facts = { battle: { standard: true, bossesSlain: 'x', turn: 'soon' } };
    expect(() => earnedBy(facts)).not.toThrow();
    expect(earnedBy(facts)).toEqual(['first_blood']);
  });
});

describe('sets', () => {
  const totals = {
    rungs: ['normal', 'dusk', 'hard', 'lunatic'],
    bosses: ['A', 'B', 'The Entity'],
    marks: ['forge', 'hunt'],
    deeds: ['d1', 'd2'],
    commanders: ['Edric', 'Sera'],
    events: ['e1', 'e2'],
    epics: ['X', 'Y'],
  };

  it('Every Rung needs a won run on all four, and a lost run adds no rung', () => {
    let s = emptyAchievementState();
    for (const difficulty of ['normal', 'dusk', 'hard'])
      s = apply(s, { runEnd: runEnd({ difficulty }), totals }).state;
    s = apply(s, { runEnd: runEnd({ difficulty: 'lunatic', victory: false }), totals }).state;
    expect(isEarned(s, 'every_rung')).toBe(false);
    expect(s.sets.rungs).toEqual(['dusk', 'hard', 'normal']);
    const last = apply(s, { runEnd: runEnd({ difficulty: 'lunatic' }), totals });
    expect(last.unlocked).toEqual(expect.arrayContaining(['every_rung', 'black_sun']));
  });

  it("Kingslayer's Ledger completes with the last boss, across battles", () => {
    let s = apply(emptyAchievementState(), {
      battle: battle({ bossesSlain: ['A'] }),
      totals,
    }).state;
    s = apply(s, { battle: battle({ bossesSlain: ['B'] }), totals }).state;
    expect(isEarned(s, 'kingslayers_ledger')).toBe(false);
    const r = apply(s, { battle: battle({ bossesSlain: ['The Entity'] }), totals });
    expect(r.unlocked).toContain('kingslayers_ledger');
  });

  it('the run-fed sets: Marks, Events, epics; and deeds and commanders', () => {
    let r = apply(emptyAchievementState(), {
      run: { markIds: ['forge', 'hunt'], eventIds: ['e1'], epicNames: ['X', 'Y'] },
      totals,
    });
    expect(r.unlocked).toEqual(expect.arrayContaining(['five_marks', 'armory_of_legends']));
    expect(r.unlocked).not.toContain('every_road_a_tale');
    r = apply(r.state, { run: { eventIds: ['e2'] }, totals });
    expect(r.unlocked).toContain('every_road_a_tale');
    r = apply(r.state, { deedIds: ['d1', 'd2'], totals });
    expect(r.unlocked).toContain('every_deed');
    r = apply(r.state, { runEnd: runEnd({ commander: 'Edric' }), totals });
    expect(r.unlocked).not.toContain('seven_banners');
    r = apply(r.state, { runEnd: runEnd({ commander: 'Sera', victory: false }), totals });
    expect(r.unlocked).not.toContain('seven_banners');
    r = apply(r.state, { runEnd: runEnd({ commander: 'Sera' }), totals });
    expect(r.unlocked).toContain('seven_banners');
  });

  it('an empty total never completes a set', () => {
    expect(earnedBy({ totals: { marks: [] }, run: { markIds: [] } })).not.toContain('five_marks');
  });

  it('progress counts the ids in the totals only', () => {
    const s = apply(emptyAchievementState(), {
      battle: battle({ bossesSlain: ['A', 'Varro'] }),
      totals,
    }).state;
    const entry = achievementEntries().find((e) => e.id === 'kingslayers_ledger');
    expect(achievementProgress(s, entry, totals)).toEqual({ have: 1, goal: 3 });
  });
});

describe('the steal tally', () => {
  it('counts once per battle: a retried commit adds nothing; 15 earns Cutpurse', () => {
    let s = emptyAchievementState();
    const b = battle({ key: '9:act2:a:1', steals: 2 });
    s = apply(s, { battle: b }).state;
    s = apply(s, { battle: b }).state;
    expect(tallyTotal(s, 'steals')).toBe(2);
    for (let i = 0; i < 6; i++)
      s = apply(s, { battle: battle({ key: `9:k${i}`, steals: 2 }) }).state;
    expect(tallyTotal(s, 'steals')).toBe(14);
    expect(isEarned(s, 'cutpurse')).toBe(false);
    const r = apply(s, { battle: battle({ key: '9:last', steals: 1 }) });
    expect(r.unlocked).toContain('cutpurse');
    const entry = achievementEntries().find((e) => e.id === 'cutpurse');
    expect(achievementProgress(r.state, entry)).toEqual({ have: 15, goal: 15 });
  });

  it('two slots tally apart, and their union adds them without counting either twice', () => {
    const one = apply(emptyAchievementState(), { battle: battle({ key: 'a', steals: 3 }) }, { slot: '1' }).state; // prettier-ignore
    const two = apply(emptyAchievementState(), { battle: battle({ key: 'b', steals: 4 }) }, { slot: '2' }).state; // prettier-ignore
    const merged = mergeAchievementStates(one, two, one, mergeAchievementStates(one, two));
    expect(tallyTotal(merged, 'steals')).toBe(7);
  });
});

describe('state', () => {
  it('earning is once: a second meeting of the facts unlocks nothing and keeps the date', () => {
    const first = apply(emptyAchievementState(), { battle: battle() }, { now: 111 });
    const again = apply(first.state, { battle: battle() }, { now: 222 });
    expect(again.unlocked).toEqual([]);
    expect(again.state.earned.first_blood.at).toBe(111);
  });

  it('the union keeps every achievement at its earliest date and every set id', () => {
    const a = {
      earned: { first_blood: { at: 500 }, future_feat: { at: 9 } },
      sets: { rungs: ['dusk'] },
    };
    const b = {
      earned: { first_blood: { at: 300 }, shatter: { at: 0 } },
      sets: { rungs: ['hard'] },
    };
    const m = mergeAchievementStates(a, b);
    expect(m.earned).toEqual({
      first_blood: { at: 300 },
      future_feat: { at: 9 },
      shatter: { at: 0 },
    });
    expect(m.sets.rungs).toEqual(['dusk', 'hard']);
    // A dated copy replaces an undated one.
    expect(mergeAchievementStates(b, { earned: { shatter: { at: 42 } } }).earned.shatter.at).toBe(
      42,
    );
  });

  it('a garbled save normalizes to what it can read, keeping unknown ids', () => {
    expect(normalizeAchievementState(null)).toEqual(emptyAchievementState());
    expect(normalizeAchievementState('x')).toEqual(emptyAchievementState());
    const out = normalizeAchievementState({
      earned: { 'Bad Id': { at: 1 }, newer_build_feat: { at: 'x' }, shatter: { at: 5 } },
      sets: { bosses: ['B', 'A', 'A', 7, ''] },
      tally: { steals: { 1: 3, 'bad slot!': 9, 2: -4 } },
    });
    expect(out.earned).toEqual({ newer_build_feat: { at: 0 }, shatter: { at: 5 } });
    expect(out.sets.bosses).toEqual(['A', 'B']);
    expect(out.tally.steals).toEqual({ 1: 3 });
  });

  it('the earned list is in catalog order', () => {
    const r = apply(emptyAchievementState(), {
      battle: battle({ turn: 1, par: 0, maxStrike: 60, objective: 'seize' }),
    });
    const order = achievementEntries().map((e) => e.id);
    expect(r.unlocked).toEqual([...r.unlocked].sort((x, y) => order.indexOf(x) - order.indexOf(y)));
    expect(r.unlocked).toEqual(['first_blood', 'seize_the_day', 'heavy_hand', 'dawn_strike']);
  });
});

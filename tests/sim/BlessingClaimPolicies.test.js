// The blessing sims' claiming policies stay alive (tests/sim/ClaimingPolicies.js,
// ClaimingRunDriver.js; `npm run sim:blessings`). Each policy exists so a card's mechanic is
// actually exercised in a full run; if a change to the game or the driver stopped one firing,
// the balance report would quietly measure nothing for those cards. On a small fixed seed set
// (First Light: the cheapest rung) every policy must fire at least once.
//
// Two scenarios:
// * natural: the report's own setup (every policy on, the shrine's pick random by seed).
// * granted: the same, holding the cards whose mechanic needs them from the start (Twin Chapel's
//   second vow, Cutpurse's Luck's Steal, Open Roll's swap, Watcher's Grace's boss-map charge,
//   Lottery Loot's card, Dawn Tithe's gold), given through the engine's own mid-run take.

import { describe, it, expect, beforeAll } from 'vitest';
import { loadGameData } from '../testData.js';
import { installStatefulSeed, restoreStatefulRandom } from '../../sim/lib/StatefulRNG.js';
import { ClaimingRunDriver } from './ClaimingRunDriver.js';

const NATURAL_SEEDS = [1, 3, 5, 7, 11];
const GRANTED_SEEDS = [2, 9];
const GRANTED = [
  'twin_chapel',
  'cutpurses_luck',
  'open_roll',
  'watchers_grace',
  'lottery_loot',
  'dawn_tithe',
];

async function play(gameData, seed, options = {}) {
  const rng = installStatefulSeed(seed);
  try {
    const driver = new ClaimingRunDriver(gameData, {
      rng,
      runOptions: { runSeed: seed, difficultyId: 'normal', autoSelectBlessing: false },
      ...options,
    });
    return await driver.run();
  } finally {
    restoreStatefulRandom();
  }
}

function total(results, key) {
  return results.reduce((sum, r) => sum + (Number(r.claims?.[key]) || 0), 0);
}

function bySource(results, source) {
  return results.reduce((sum, r) => sum + (r.claims?.earnedTakenBySource?.[source] || 0), 0);
}

describe('blessing sims: every claiming policy fires', () => {
  let natural = [];
  let granted = [];

  beforeAll(async () => {
    const gameData = loadGameData();
    for (const seed of NATURAL_SEEDS) natural.push(await play(gameData, seed));
    for (const seed of GRANTED_SEEDS)
      granted.push(await play(gameData, seed, { grantBlessings: GRANTED, verifyReplay: true }));
  }, 240_000);

  it('plays every run to its end', () => {
    for (const r of [...natural, ...granted]) {
      expect(r.result).toBe('victory');
      expect(r.battleLog.length).toBeGreaterThan(10);
    }
  });

  it('takes a blessing and a gift at the shrine', () => {
    expect(total(natural, 'startBlessings')).toBeGreaterThan(0);
    expect(total(natural, 'giftsTaken')).toBeGreaterThan(0);
  });

  it('takes owed earned picks: act bosses, eclipsed elites, the Colosseum', () => {
    expect(bySource(natural, 'act_boss')).toBeGreaterThan(0);
    expect(bySource(natural, 'eclipsed_elite')).toBeGreaterThan(0);
    expect(bySource(natural, 'colosseum')).toBeGreaterThan(0);
    expect(total(natural, 'colosseumBouts')).toBeGreaterThan(0);
  });

  it("takes the Old Sanctum's card as a church vow, and an event's earned grant", () => {
    expect(total(natural, 'sanctumTaken')).toBeGreaterThan(0);
    expect(total(natural, 'eventEarnedGrants')).toBeGreaterThan(0);
  });

  it("claims battle loot, Lottery Loot's card and Dawn Tithe's gold", () => {
    expect(total(natural, 'rewardClaims')).toBeGreaterThan(0);
    expect(total(granted, 'lotteryCardsOffered')).toBeGreaterThan(0);
    expect(total(granted, 'dawnTitheGold')).toBeGreaterThan(0);
  });

  it("steals from carriers (twice as many under Cutpurse's Luck)", () => {
    expect(total(natural, 'steals')).toBeGreaterThan(0);
    expect(total(granted, 'steals')).toBeGreaterThan(0);
  });

  it('recruits by Talk and swaps a recruit candidate under Open Roll', () => {
    expect(total(natural, 'talkRecruits')).toBeGreaterThan(0);
    expect(total(granted, 'recruitAlternatesOffered')).toBeGreaterThan(0);
    expect(total(granted, 'recruitSwaps')).toBeGreaterThan(0);
  });

  it("spends Vision charges, a Watcher's Grace charge on a boss map among them", () => {
    expect(total(natural, 'visionRewinds')).toBeGreaterThan(0);
    expect(total(granted, 'visionGraceRewinds')).toBeGreaterThan(0);
  });

  it('replays a rewound battle exactly (the agent re-chooses every recorded action)', () => {
    expect(total(granted, 'visionRewinds')).toBeGreaterThan(0);
    expect(total(granted, 'replayMismatches')).toBe(0);
  });

  it('makes a second church vow under Twin Chapel', () => {
    expect(total(granted, 'secondVows')).toBeGreaterThan(0);
  });

  it('forges, heals between battles, learns scrolls and takes the boss recruit', () => {
    const all = [...natural, ...granted];
    for (const key of ['paidForges', 'itemHeals', 'skillScrollsLearned', 'bossRecruits'])
      expect(total(all, key), key).toBeGreaterThan(0);
  });
});

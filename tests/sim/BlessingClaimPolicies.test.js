// The blessing sims' claiming policies stay alive (tests/sim/ClaimingPolicies.js,
// ClaimingRunDriver.js; `npm run sim:blessings`). Each policy exists so a card's mechanic is
// actually exercised in a full run; if a change to the game or the driver stopped one firing,
// the balance report would quietly measure nothing for those cards.
//
// Every scenario below FORCES its policy's situation, so none depends on which seed wins which
// battle or on what a run happens to roll (an unrelated change to level-ups or loot cannot turn
// this red): the engine's own offers are filed or the subject is placed (a Thief beside a
// carrier, a Commander's fall, a church, a Colosseum node, an event pinned to its id, a boss
// node played on its own), and the policy under test must then do its part through the driver's
// own node handlers. Where the setup is a lookup (a seed whose shrine offers a gift) the test
// scans a range for one, which holds whatever the stream's exact values are. Each assertion is a
// property of the plumbing (the policy acted, the driver counted it), never a rate.
//
// Proof that a policy is guarded: turn it off (`claims.<name>: false`, or break its function) and
// the test of that policy goes red (see the "off switch" test, which does it for the two the
// report once ran without: Steal and Vision).

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadGameData } from '../testData.js';
import { installStatefulSeed, restoreStatefulRandom } from '../../sim/lib/StatefulRNG.js';
import { arriveAs } from '../eventKit.js';
import { ClaimingRunDriver } from './ClaimingRunDriver.js';

// A boss battle played on its own takes a few seconds on a loaded machine.
vi.setConfig({ testTimeout: 90_000 });

const gameData = loadGameData();
const SEED = 4;

let rng = null;
beforeEach(() => {
  rng = installStatefulSeed(SEED);
});
afterEach(() => {
  restoreStatefulRandom();
  rng = null;
});

function makeDriver(options = {}) {
  const { seed = SEED, ...rest } = options;
  rng.setState(seed);
  const driver = new ClaimingRunDriver(gameData, {
    rng,
    runOptions: { runSeed: seed, difficultyId: 'normal', autoSelectBlessing: false },
    ...rest,
  });
  driver.init();
  return driver;
}

const ids = (driver) => driver.runManager.getActiveBlessingIds();
const count = (driver, key) => Number(driver.claimCounts[key]) || 0;

/** A node of the given type: the map's own (not yet complete), else one filed on the map. */
function nodeOf(driver, type, extra = {}) {
  const map = driver.runManager.nodeMap;
  const found = map.nodes.find((n) => n.type === type && !n.completed && !n.isAmbush);
  if (found) return Object.assign(found, extra);
  const node = { id: `forced_${type}`, type, row: 3, col: 0, completed: false, ...extra };
  map.nodes.push(node);
  return node;
}

/** A tile next to (col,row) the unit could stand on, free of every unit. */
function freeNeighbour(battle, col, row, taken) {
  const occupied = new Set(
    [...battle.playerUnits, ...battle.enemyUnits, ...(battle.npcUnits || [])].map(
      (u) => `${u.col},${u.row}`,
    ),
  );
  for (const [dc, dr] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const c = col + dc;
    const r = row + dr;
    if (c < 0 || r < 0 || c >= battle.grid.cols || r >= battle.grid.rows) continue;
    if (occupied.has(`${c},${r}`) || taken?.has(`${c},${r}`)) continue;
    if (!(battle.grid.getMoveCost(c, r, 'Infantry') < 99)) continue;
    return { col: c, row: r };
  }
  return null;
}

/**
 * Wrap a driver's battle build: `setup(battle, built)` arranges the field before the agent plays.
 * By default it runs on the first build only; `every` runs it on each build too, as a Vision
 * rewind's replay rebuilds the battle from its start and must find the same field.
 */
function onBattle(driver, setup, { every = false } = {}) {
  const build = driver._buildBattle.bind(driver);
  let first = true;
  driver._buildBattle = (node, entry) => {
    const built = build(node, entry);
    if (first || every) {
      first = false;
      setup(built.driver.battle, built);
    }
    return built;
  };
}

describe('the shrine', () => {
  it('takes the first blessing on offer under the "first" policy', () => {
    const driver = makeDriver({ claims: { startOffer: 'first' } });
    expect(count(driver, 'startBlessings')).toBe(1);
    expect(ids(driver).length).toBe(1);
  });

  it('takes the gift when the random pick lands on it (a seed whose shrine offers one is found)', () => {
    let taken = null;
    for (let seed = 1; seed <= 120 && !taken; seed++) {
      const driver = makeDriver({ seed });
      if (count(driver, 'giftsTaken') > 0) taken = driver;
    }
    expect(taken, 'a seed in 1..120 whose random shrine pick is the gift').not.toBeNull();
    expect(taken.runManager.startGift?.id).toBeTruthy();
  });
});

describe('earned picks', () => {
  // One source at a time: a card taken from one offer leaves every other offer that holds it.
  async function owedPick(source) {
    const { prepareEarnedBlessingPick, prepareEliteEarnedDrop, prepareColosseumOffer } =
      await import('../../src/engine/EarnedBlessings.js');
    const driver = makeDriver();
    const rm = driver.runManager;
    if (source === 'act_boss') {
      const boss = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
      expect(prepareEarnedBlessingPick(rm, boss)?.status).toBe('owed');
    } else if (source === 'eclipsed_elite') {
      // The drop is a one-in-three roll on a stream keyed by its node: file nodes until one hits
      // (a property of the engine's stream, not of any battle).
      let hit = null;
      for (let i = 0; i < 60 && !hit; i++) {
        const node = { id: `act1_forced_${i}`, type: 'battle', battleParams: { isEclipsed: true } };
        if (prepareEliteEarnedDrop(rm, node)?.status === 'owed') hit = node;
      }
      expect(hit, 'an eclipsed-elite node whose drop rolls a card').not.toBeNull();
    } else {
      expect(prepareColosseumOffer(rm, 'forced_colosseum')?.status).toBe('owed');
    }
    return driver;
  }

  it.each(['act_boss', 'eclipsed_elite', 'colosseum'])(
    'takes the owed %s pick after the node',
    async (source) => {
      const driver = await owedPick(source);
      const before = ids(driver).length;
      driver._afterNode();
      expect(count(driver, 'earnedTaken')).toBe(1);
      expect(driver.claimCounts.earnedTakenBySource[source]).toBe(1);
      expect(ids(driver).length).toBe(before + 1);
      expect(driver.offers.some((o) => o.source === source && o.taken)).toBe(true);
    },
  );

  it('leaves an owed pick alone with the policy off (the stock sims skip it)', async () => {
    const driver = await owedPick('act_boss');
    driver.claims.earnedPicks = false;
    driver._afterNode();
    expect(count(driver, 'earnedTaken')).toBe(0);
  });
});

describe('churches', () => {
  it("takes the Old Sanctum's card as its vow", () => {
    const driver = makeDriver();
    const node = nodeOf(driver, 'church', { sanctum: true, eclipse: undefined });
    const result = driver._claimChurchNode(node);
    expect(count(driver, 'sanctumTaken')).toBe(1);
    expect(result.sanctum).toBeTruthy();
    expect(driver.offers.some((o) => o.source === 'sanctum' && o.taken)).toBe(true);
  });

  it('makes a second, different vow under Twin Chapel', () => {
    const driver = makeDriver({ grantBlessings: ['twin_chapel'] });
    const rm = driver.runManager;
    // A promotion is a vow only the army's level can make: a veteran, and the purse for it.
    for (const unit of rm.roster) unit.level = Math.max(unit.level || 1, 12);
    rm.gold = 20000;
    const node = nodeOf(driver, 'church');
    const result = driver._claimChurchNode(node);
    expect(result.vows.length).toBe(2);
    expect(new Set(result.vows).size).toBe(2);
    expect(count(driver, 'secondVows')).toBe(1);
  });
});

describe('the Colosseum', () => {
  it('fights bouts for a purse and counts the bouts and wins', () => {
    const driver = makeDriver();
    const rm = driver.runManager;
    rm.gold = 20000;
    for (const unit of rm.roster) {
      unit.level = 20;
      for (const stat of ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES'])
        unit.stats[stat] = (unit.stats[stat] || 0) + 25;
      unit.currentHP = unit.stats.HP;
    }
    const node = nodeOf(driver, 'colosseum');
    const result = driver._claimColosseumNode(node);
    expect(result.bouts).toBeGreaterThan(0);
    expect(count(driver, 'colosseumBouts')).toBe(result.bouts);
    expect(count(driver, 'colosseumWins')).toBeGreaterThan(0);
  });
});

describe('events', () => {
  it("takes an event's earned grant before any other choice (the Wandering Smith's covenant)", async () => {
    const driver = makeDriver();
    const rm = driver.runManager;
    rm.gold = 5000;
    const node = arriveAs(rm, 'wandering_smith', nodeOf(driver, 'battle'));
    const result = await driver._claimEventNode(node);
    expect(result.result).toBe('event_done');
    expect(count(driver, 'eventEarnedGrants')).toBe(1);
    expect(ids(driver)).toContain('smiths_covenant');
  });
});

describe('between battles', () => {
  it('drinks a Vulnerary when hurt, learns a scroll and equips a ring', () => {
    const driver = makeDriver();
    const rm = driver.runManager;
    const unit = rm.roster[0];
    unit.consumables = [
      structuredClone(rm.getConsumableCatalog().find((c) => c.name === 'Vulnerary')),
    ];
    unit.currentHP = 1;
    const scroll = (gameData.weapons || []).find((w) => w.type === 'Scroll' && w.skillId);
    rm.scrolls = [structuredClone({ ...scroll, uid: 'itm_forced_scroll' })];
    driver._afterNode();
    expect(count(driver, 'itemHeals')).toBeGreaterThan(0);
    expect(unit.currentHP).toBeGreaterThan(1);
    expect(count(driver, 'skillScrollsLearned')).toBe(1);
  });

  it("forges at a shop: free with Smith's Mark, paid when the purse is comfortable", async () => {
    const driver = makeDriver({ grantBlessings: ['frugal_smith'] });
    driver.runManager.gold = 9000;
    const node = nodeOf(driver, 'shop');
    await driver._claimShopNode(node);
    expect(count(driver, 'freeForges')).toBeGreaterThan(0);
    const paidDriver = makeDriver();
    paidDriver.runManager.gold = 9000;
    await paidDriver._claimShopNode(nodeOf(paidDriver, 'shop'));
    expect(count(paidDriver, 'paidForges')).toBe(1);
  });
});

describe('a boss battle, played on its own', () => {
  async function playBoss({ fall = false } = {}) {
    const driver = makeDriver({
      grantBlessings: ['watchers_grace', 'lottery_loot', 'dawn_tithe'],
      verifyReplay: true,
    });
    const rm = driver.runManager;
    rm.visionChargesRemaining = 3;
    const boss = rm.nodeMap.nodes.find((n) => n.id === rm.nodeMap.bossNodeId);
    // Dawn Tithe pays for turns under par: the battle is read as won on turn one (the policy
    // and the report line are what is under test, not how fast a seed's army wins).
    const play = driver._playBattle.bind(driver);
    driver._playBattle = async (...args) => {
      const played = await play(...args);
      played.driver.battle.turnManager.turnNumber = 1;
      return played;
    };
    if (fall)
      onBattle(driver, (battle, built) => {
        // The commander falls once, after the first action: a Vision charge is spent on it
        // (a casual commander stands again, as the sims play it).
        const step = built.driver.step.bind(built.driver);
        let n = 0;
        built.driver.step = async (action) => {
          await step(action);
          if (++n === 1) battle._removeUnit(battle.playerUnits.find((u) => u.isCommander));
        };
      });
    const result = await driver._claimBattleNode(boss);
    return { driver, result };
  }

  it('claims its loot, Lottery Loot, Dawn Tithe and the boss recruit', async () => {
    const { driver } = await playBoss();
    expect(count(driver, 'rewardClaims')).toBe(1);
    expect(count(driver, 'lotteryCardsOffered')).toBeGreaterThan(0);
    expect(count(driver, 'dawnTitheGold')).toBeGreaterThan(0);
    expect(count(driver, 'bossRecruits')).toBe(1);
  });

  it("rewinds a Commander's fall with a Vision charge, a Watcher's Grace charge first, and replays exactly", async () => {
    const { driver, result } = await playBoss({ fall: true });
    // The injected fall guarantees one rewind; a boss map's own falls may add others.
    expect(result.rewinds).toBeGreaterThanOrEqual(1);
    expect(count(driver, 'visionRewinds')).toBeGreaterThanOrEqual(1);
    expect(count(driver, 'visionGraceRewinds')).toBeGreaterThanOrEqual(1);
    expect(count(driver, 'replayMismatches')).toBe(0);
  });
});

describe('a Thief beside a carrier', () => {
  /** A tough, unarmed Thief of the army stands beside a carrier nothing else can fell. */
  async function playSteal({ carrierSpeed, grant = [], claims = {} }) {
    const driver = makeDriver({ grantBlessings: grant, claims: { vision: false, ...claims } });
    const rm = driver.runManager;
    const node = nodeOf(driver, 'battle');
    onBattle(
      driver,
      (battle) => {
        const thief = battle.playerUnits.find((u) => !u.isCommander) || battle.playerUnits[0];
        thief.skills = [...(thief.skills || []), 'steal'];
        thief.weapon = null;
        thief.inventory = [];
        Object.assign(thief.stats, { HP: 99, DEF: 60, RES: 60, SPD: 1 });
        thief.currentHP = 99;
        const carrier = battle.enemyUnits[0];
        const tile = freeNeighbour(battle, thief.col, thief.row);
        expect(tile, 'a free tile beside the Thief').not.toBeNull();
        Object.assign(carrier, tile);
        carrier.carriedItem = {
          ...structuredClone(rm.getConsumableCatalog().find((c) => c.name === 'Vulnerary')),
          uid: 'itm_forced_carry',
        };
        Object.assign(carrier.stats, { HP: 999, DEF: 99, RES: 99, SPD: carrierSpeed });
        carrier.currentHP = 999;
      },
      { every: true },
    );
    await driver._claimBattleNode(node);
    return driver;
  }

  it('steals from it', async () => {
    const driver = await playSteal({ carrierSpeed: 0 });
    expect(count(driver, 'steals')).toBeGreaterThan(0);
  });

  it("steals from a faster carrier under Cutpurse's Luck (the speed waiver), never without it", async () => {
    const lucky = await playSteal({ carrierSpeed: 40, grant: ['cutpurses_luck'] });
    expect(count(lucky, 'steals')).toBeGreaterThan(0);
    expect(count(lucky, 'stealsSpeedWaived')).toBeGreaterThan(0);
    const plain = await playSteal({ carrierSpeed: 40 });
    expect(count(plain, 'stealsSpeedWaived')).toBe(0);
  });
});

describe('a recruit node', () => {
  it('meets the other candidate under Open Roll and swaps for the stronger one', async () => {
    const driver = makeDriver({ grantBlessings: ['open_roll'] });
    const rm = driver.runManager;
    const node = nodeOf(driver, 'recruit');
    // The loom's preview of the other candidate is made the stronger unit (the swap itself is the
    // engine's own, `swapRecruitCandidate`).
    const preview = rm.getRecruitAlternate(node.id);
    expect(preview, 'Open Roll offers an alternate').toBeTruthy();
    const build = rm.getRecruitNodeUnit.bind(rm);
    rm.getRecruitNodeUnit = (n, options) => {
      const built = build(n, options);
      if (options?.preview && built?.unit) built.unit.stats.HP += 60;
      return built;
    };
    await driver._claimBattleNode(node);
    expect(count(driver, 'recruitAlternatesOffered')).toBe(1);
    expect(count(driver, 'recruitSwaps')).toBe(1);
  });

  it('recruits by Talk when the commander stands beside the green unit', async () => {
    const driver = makeDriver();
    const node = nodeOf(driver, 'recruit');
    onBattle(
      driver,
      (battle) => {
        const lord = battle.playerUnits.find((u) => u.isLord) || battle.playerUnits[0];
        const npc = battle.npcUnits[0];
        expect(npc, 'a green recruit on the field').toBeTruthy();
        Object.assign(npc, freeNeighbour(battle, lord.col, lord.row));
      },
      { every: true },
    );
    await driver._claimBattleNode(node);
    expect(count(driver, 'talkRecruits')).toBeGreaterThan(0);
  });
});

describe('the off switches', () => {
  it('Steal off: the Thief beside the carrier steals nothing', async () => {
    const driver = makeDriver({ claims: { steal: false } });
    const rm = driver.runManager;
    const node = nodeOf(driver, 'battle');
    onBattle(
      driver,
      (battle) => {
        const thief = battle.playerUnits[0];
        thief.skills = [...(thief.skills || []), 'steal'];
        const carrier = battle.enemyUnits[0];
        Object.assign(carrier, freeNeighbour(battle, thief.col, thief.row));
        carrier.carriedItem = {
          ...structuredClone(rm.getConsumableCatalog().find((c) => c.name === 'Vulnerary')),
          uid: 'itm_forced_carry',
        };
      },
      { every: true },
    );
    await driver._claimBattleNode(node);
    expect(count(driver, 'steals')).toBe(0);
  });

  it("Vision off: a Commander's fall is not rewound", async () => {
    const driver = makeDriver({ claims: { vision: false } });
    driver.runManager.visionChargesRemaining = 3;
    const node = nodeOf(driver, 'battle');
    onBattle(driver, (battle, built) => {
      const step = built.driver.step.bind(built.driver);
      let n = 0;
      built.driver.step = async (action) => {
        await step(action);
        if (++n === 1) battle._removeUnit(battle.playerUnits.find((u) => u.isCommander));
      };
    });
    await driver._claimBattleNode(node);
    expect(count(driver, 'visionRewinds')).toBe(0);
  });
});

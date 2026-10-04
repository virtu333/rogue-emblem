// Playtest 2026-10-04: an arena bout was one exchange, so a level-matched challenger
// almost never fell (a sim: 78-98% draws by tier). Draws paid no gold and a quarter
// of the XP while the fighter kept the HP it lost. Bouts now go round by round until
// one fighter falls (up to arena.maxRounds, then a draw); the fee is paid as the bout
// starts; the player may yield between rounds; the forecast shows the odds.
//
// Hand-built fighters, Sword against Sword (no triangle), no skills, so every number
// below is worked out by hand:
//   entrant  HP 30, STR 10, SKL 20, SPD 10, DEF 5; blade might 5, hit 100, weight 0
//   brute    HP 25, STR 8,  SKL 20, SPD 10, DEF 5; same blade
// Each hits for 10 (entrant: 10 + 5 - 5) and 8 (brute: 8 + 5 - 5), once per round
// (equal speed: no doubles). LCK 30 each: hit 100 + 40 + 30 - 50 = 120 (a dull blade:
// 20, a miss at the pinned roll), and crit 10 - 30: none. Math.random is pinned at 0.5,
// so every strike that can hit does and no skill procs.
import './harness/JourneyTestSetup.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ColosseumOverlay } from '../src/ui/ColosseumOverlay.js';
import { arenaOddsText } from '../src/ui/ArenaMenu.js';
import {
  arenaRoundOutcome,
  estimateArenaOdds,
  resolveArenaRound,
} from '../src/engine/ArenaBout.js';
import { calculateArenaReward } from '../src/engine/ColosseumEngine.js';
import { loadGameData } from './testData.js';

const blade = () => ({
  name: 'Test Blade',
  type: 'Sword',
  might: 5,
  hit: 100,
  crit: 0,
  weight: 0,
  range: '1',
  rankRequired: 'Prof',
});
const dull = () => ({ ...blade(), name: 'Dull Blade', hit: 0, might: 0 });

function fighter(name, stats, weapon = blade()) {
  return {
    name,
    className: 'Myrmidon',
    tier: 'base',
    level: 5,
    isLord: false,
    faction: name === 'Brute' ? 'enemy' : 'player',
    stats: { MAG: 0, RES: 0, LCK: 30, MOV: 5, ...stats },
    xp: 0,
    currentHP: stats.HP,
    weapon,
    inventory: [weapon],
    proficiencies: [{ type: 'Sword', rank: 'Prof' }],
    skills: [],
    traits: [],
    moveType: 'Infantry',
  };
}
const entrant = (weapon) => fighter('Ada', { HP: 30, STR: 10, SKL: 20, SPD: 10, DEF: 5 }, weapon);
const brute = (weapon) => fighter('Brute', { HP: 25, STR: 8, SKL: 20, SPD: 10, DEF: 5 }, weapon);

const TIER = {
  name: 'bronze',
  entryFee: 50,
  goldReward: 200,
  xpMultiplier: 1,
  levelOffset: [0, 0],
};
let gameData;
beforeEach(() => {
  gameData = loadGameData();
  vi.spyOn(Math, 'random').mockReturnValue(0.5);
});
afterEach(() => vi.restoreAllMocks());

function texts(scene) {
  const s = scene._journeySurface;
  return !s || s.destroyed ? [] : [s.title, ...s.root.all().map((n) => n.textContent)].map(String);
}
function press(scene, label) {
  const node = scene._journeySurface.root
    .all()
    .find((n) => n.tag === 'button' && !n.disabled && n.textContent === label);
  if (!node) throw new Error(`No button "${label}" in ${scene._journeySurface.title}`);
  node.onclick();
}
function arena({ unit, foe, gold = 1000, maxRounds = 10 }) {
  const scene = { registry: { get: () => null } };
  gameData.colosseum = structuredClone(gameData.colosseum);
  gameData.colosseum.arena.maxRounds = maxRounds;
  const run = {
    gold,
    currentAct: 'act1',
    difficultyId: 'normal',
    roster: [unit],
    awardGold(n) {
      this.gold += n;
    },
    spendGold(n) {
      if (this.gold < n) return false;
      this.gold -= n;
      return true;
    },
    markNodeComplete: vi.fn(),
  };
  const node = { id: 'col' };
  const overlay = new ColosseumOverlay(scene, run, gameData);
  overlay.show(node, vi.fn());
  overlay._selectedUnit = unit;
  overlay._selectedTier = TIER;
  overlay._challenger = { unit: foe };
  overlay._showForecast();
  return { scene, run, node, overlay };
}

describe('arena bout engine', () => {
  it('carries both fighters’ HP from round to round until one falls', () => {
    const a = entrant();
    const b = brute();
    const seen = [];
    let outcome = null;
    for (let round = 1; !outcome; round++) {
      outcome = arenaRoundOutcome(resolveArenaRound(a, b, gameData), round, 10);
      seen.push([a.currentHP, b.currentHP]);
    }
    // Round 3: Ada strikes first and fells the Brute (5 → 0) before its counter.
    expect(seen).toEqual([
      [22, 15],
      [14, 5],
      [14, 0],
    ]);
    expect(outcome).toBe('win');
  });

  it('a lethal blow leaves the entrant at 1 HP, and the bout is lost', () => {
    const a = entrant(dull());
    const b = brute();
    let outcome = null;
    let round = 0;
    while (!outcome) outcome = arenaRoundOutcome(resolveArenaRound(a, b, gameData), ++round, 10);
    // 30 → 22 → 14 → 6 → lethal in round 4.
    expect([outcome, round, a.currentHP]).toEqual(['lose', 4, 1]);
  });

  it('is a draw at the round cap', () => {
    const a = entrant(dull());
    const b = brute(dull());
    const outcomes = [1, 2, 3].map((r) =>
      arenaRoundOutcome(resolveArenaRound(a, b, gameData), r, 3),
    );
    expect(outcomes).toEqual([null, null, 'draw']);
  });

  it('odds never move the game’s dice or the fighters, and repeat exactly', () => {
    vi.restoreAllMocks();
    const pinned = vi.fn(() => 0.5);
    Math.random = pinned;
    try {
      const a = entrant();
      const b = brute();
      const before = structuredClone([a, b]);
      const odds = estimateArenaOdds(a, b, gameData, { trials: 50 });
      expect(Math.random).toBe(pinned);
      expect(pinned).not.toHaveBeenCalled();
      expect([a, b]).toEqual(before);
      expect(odds).toEqual({ win: 1, lose: 0, draw: 0 });
      expect(estimateArenaOdds(a, b, gameData, { trials: 50 })).toEqual(odds);
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('fighters that cannot be copied give no odds instead of failing the forecast', () => {
    const a = entrant();
    a.sprite = { destroy() {} };
    expect(estimateArenaOdds(a, brute(), gameData, { trials: 5 })).toBeNull();
  });

  it('odds read as estimates, never certainties', () => {
    expect(arenaOddsText({ win: 1, lose: 0, draw: 0 })).toBe(
      'If fought to the end: Win over 95% · Lose under 5%',
    );
    expect(arenaOddsText({ win: 0.62, lose: 0.35, draw: 0.03 })).toBe(
      'If fought to the end: Win about 60% · Lose about 35% · Draw about 5%',
    );
  });

  it('a yield forfeits the fee and earns nothing, like a loss', () => {
    expect(calculateArenaReward(TIER, 'yield', 40, 0, gameData.colosseum)).toEqual({
      goldDelta: -50,
      xpGained: 0,
    });
  });
});

describe('arena overlay: a bout round by round', () => {
  it('a win: the fee goes in at Fight, comes back with the prize at the end', () => {
    const unit = entrant();
    const { scene, run, overlay } = arena({ unit, foe: brute() });
    press(scene, 'Fight');
    // Paid on entry, before the result.
    expect(run.gold).toBe(950);
    expect(texts(scene)).toContain('Arena · Round 1');
    press(scene, 'Next round');
    expect(texts(scene)).toContain('Arena · Round 2');
    press(scene, 'Next round');
    expect(texts(scene)).toContain('Arena · Combat result');
    expect(run.gold).toBe(1200);
    expect(unit.currentHP).toBe(14);
    expect(overlay._fightsPerUnit.Ada).toBe(1);
  });

  it('a loss: fee gone, fighter at 1 HP, no XP', () => {
    const unit = entrant(dull());
    const { scene, run } = arena({ unit, foe: brute() });
    press(scene, 'Fight');
    for (let i = 0; i < 3; i++) press(scene, 'Next round');
    expect(texts(scene)).toContain('Arena · Combat result');
    expect([run.gold, unit.currentHP, unit.xp]).toEqual([950, 1, 0]);
  });

  it('a yield between rounds: fee gone, the fighter keeps its HP', () => {
    const unit = entrant();
    const { scene, run } = arena({ unit, foe: brute() });
    press(scene, 'Fight');
    press(scene, 'Yield (forfeit 50 G)');
    expect(texts(scene)).toContain('Arena · Rewards');
    expect(texts(scene)).toContain('Yielded: the fee is forfeit.');
    expect([run.gold, unit.currentHP]).toEqual([950, 22]);
  });

  it('a draw at the round cap returns the fee and trains a little', () => {
    const unit = entrant(dull());
    const { scene, run } = arena({ unit, foe: brute(dull()), maxRounds: 2 });
    press(scene, 'Fight');
    press(scene, 'Next round');
    expect(texts(scene)).toContain('Arena · Combat result');
    expect(run.gold).toBe(1000);
    expect(unit.xp).toBeGreaterThan(0);
  });

  it('each round is saved; leaving mid-bout keeps the fee and the HP (a yield)', () => {
    const unit = entrant();
    const { scene, run, node, overlay } = arena({ unit, foe: brute() });
    press(scene, 'Fight');
    expect(node.colosseumState.fightsPerUnit.Ada).toBe(1);
    overlay.hide();
    const again = new ColosseumOverlay(scene, run, gameData);
    again.show(node, vi.fn());
    expect(again._fightsPerUnit.Ada).toBe(1);
    expect([run.gold, unit.currentHP]).toEqual([950, 22]);
    expect(texts(scene)).toContain('Colosseum');
  });

  it('cannot enter without the fee', () => {
    const unit = entrant();
    const { scene, run } = arena({ unit, foe: brute(), gold: 40 });
    press(scene, 'Fight');
    expect(run.gold).toBe(40);
    expect(unit.currentHP).toBe(30);
    expect(texts(scene)).toContain('Arena · Choose tier');
  });
});

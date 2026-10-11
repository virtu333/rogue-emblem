// Cutpurse's Luck, Open Roll, Twin Chapel and Omen Reader (docs/specs/blessings-v3.md §5, PR
// D4): the §5 cards that act on the road (carriers, recruit nodes, churches, the Eclipse). Each
// test is named after a realistic way the rule breaks. Seeded draws are pinned: a card's own
// stream never moves the node-map, battle, loot or recruit streams.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/ui/serviceSave.js', () => ({ saveServiceRun: vi.fn(() => '') }));
import { RunManager } from '../src/engine/RunManager.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { resolveDifficultyMode } from '../src/engine/DifficultyEngine.js';
import { assignEnemyCarry } from '../src/engine/EnemyCarry.js';
import {
  STEAL_REASONS,
  isFastEnoughToSteal,
  settleSteal,
  stealBlockReason,
} from '../src/engine/Steal.js';
import { stealStatus } from '../src/engine/ActionAbilitySystem.js';
import { stealRunOptions } from '../src/engine/ShrineBoons.js';
import {
  churchBlessingBlock,
  churchBlessingOffers,
  churchCleanseBlock,
  churchVowBlock,
  churchVowCommitNote,
  churchVowLine,
  churchVowStatusLine,
  churchVows,
  cleanseAtChurch,
  commitChurchVow,
  takeChurchBlessing,
} from '../src/engine/ChurchVow.js';
import { churchPromotionBlock } from '../src/engine/ChurchCommands.js';
import { addBurden } from '../src/engine/Burdens.js';
import { buildEclipseView } from '../src/engine/EclipseSystem.js';
import { recruitHash } from '../src/engine/RecruitNodeSystem.js';
import { createSeededRng } from '../src/engine/BlessingEngine.js';
import { describeLoomNode } from '../src/ui/loomModel.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { installFakeDom } from './helpers/fakeDom.js';
import { _resetInputFocus } from '../src/utils/inputFocus.js';
import { ChurchMenu } from '../src/ui/ChurchMenu.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
afterEach(() => restoreMathRandom());

function startRun({ seed = 99, difficultyId = 'dusk' } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, difficultyId, applyBlessingsAtStart: false });
  return rm;
}
function hold(rm, ...ids) {
  rm.activeBlessings = ids.map((id) => ({ id, rolledCost: null }));
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
  return rm;
}
const roundTrip = (rm) => RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
const modifiers = (rung) => resolveDifficultyMode(data.difficulty, rung).modifiers;

// ── Cutpurse's Luck ───────────────────────────────────────────────────────

describe("Cutpurse's Luck: twice as many carriers", () => {
  const garrison = (seed) =>
    Array.from({ length: 6 }, (_, i) => ({
      className: 'Fighter',
      col: i + seed * 7,
      row: seed,
      level: 3 + (seed % 5),
    }));
  const roll = (spawns, passes) =>
    assignEnemyCarry(spawns, {
      act: 'act3',
      difficultyId: 'dusk',
      templateId: 'tpl',
      carryConfig: modifiers('dusk').carryConfig,
      lootTables: data.lootTables,
      passes,
    });

  it("the first pass is the rung's own roll: every carrier without the card carries the same with it", () => {
    for (let seed = 1; seed <= 300; seed++) {
      const plain = garrison(seed);
      const lucky = garrison(seed);
      roll(plain, 1);
      roll(lucky, 2);
      for (const [i, spawn] of plain.entries())
        if (spawn.carries) {
          expect(lucky[i].carries, `seed ${seed}`).toBe(spawn.carries);
          expect(lucky[i].carryValue).toBe(spawn.carryValue);
        }
    }
  });

  it('doubles the carriers (Dusk Act III: 0.3 a battle becomes about 0.6)', () => {
    let plain = 0;
    let lucky = 0;
    const N = 4000;
    for (let seed = 1; seed <= N; seed++) {
      plain += roll(garrison(seed), 1).carriers;
      lucky += roll(garrison(seed), 2).carriers;
    }
    // Two independent passes at 0.3 with one slot each: 0.6 carriers a battle (0.3 + 0.3).
    expect(plain / N).toBeGreaterThan(0.27);
    expect(plain / N).toBeLessThan(0.33);
    expect(lucky / plain).toBeGreaterThan(1.85);
    expect(lucky / plain).toBeLessThan(2.15);
  });

  it('the second pass is independent of the first (its own stream, not the same roll again)', () => {
    // Independent passes at 0.3: one carrier in 2 x 0.3 x 0.7 = 42% of battles, two in 9%.
    // A pass that replayed the first one's stream would give one carrier never and two in 30%.
    const counts = [0, 0, 0];
    const N = 4000;
    for (let seed = 1; seed <= N; seed++) counts[roll(garrison(seed), 2).carriers]++;
    expect(counts[1] / N).toBeGreaterThan(0.38);
    expect(counts[1] / N).toBeLessThan(0.46);
    expect(counts[2] / N).toBeGreaterThan(0.07);
    expect(counts[2] / N).toBeLessThan(0.11);
  });

  it('never makes a boss or an elite captain a carrier', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const spawns = garrison(seed).map((s, i) => (i < 5 ? { ...s, isBoss: true } : s));
      roll(spawns, 4);
      expect(
        spawns.slice(0, 5).some((s) => s.carries),
        `seed ${seed}`,
      ).toBe(false);
    }
  });

  it('rides the battle params only while held; a generated map keeps the Math.random cursor', () => {
    const plain = startRun();
    const lucky = hold(startRun(), 'cutpurses_luck');
    const node = plain.nodeMap.nodes.find((n) => n.type === 'battle');
    expect('carryPasses' in plain.getBattleParams(node)).toBe(false);
    expect(lucky.getBattleParams(node).carryPasses).toBe(2);
    let extra = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const params = { ...modifiers('dusk'), difficultyId: 'dusk', act: 'act3', objective: 'rout' };
      const gen = (p) => {
        installSeed(seed);
        try {
          return {
            battle: generateBattle({ deployCount: 6, row: 3, ...p }, data),
            next: Math.random(),
          };
        } finally {
          restoreMathRandom();
        }
      };
      const without = gen(params);
      const withCard = gen({ ...params, carryPasses: 2 });
      expect(withCard.next, `seed ${seed}`).toBe(without.next);
      expect(withCard.battle.mapLayout).toEqual(without.battle.mapLayout);
      const strip = (bc) => bc.enemySpawns.map(({ carries: _a, carryValue: _b, ...rest }) => rest);
      expect(strip(withCard.battle)).toEqual(strip(without.battle));
      extra +=
        withCard.battle.enemySpawns.filter((s) => s.carries).length -
        without.battle.enemySpawns.filter((s) => s.carries).length;
    }
    expect(extra).toBeGreaterThan(0);
  });

  /** The scene's rule: the locked map if there is one, else a new map, locked (BattleScene). */
  const enterBattle = (rm, node, seed) => {
    const locked = rm.getLockedBattleConfig(node.id);
    if (locked) return locked;
    installSeed(seed);
    try {
      const battle = generateBattle({ deployCount: 4, ...rm.getBattleParams(node) }, data);
      rm.lockBattleConfig(node.id, battle);
      return battle;
    } finally {
      restoreMathRandom();
    }
  };
  const carriersOf = (battle) =>
    battle.enemySpawns.map((s) => [s.col, s.row, s.carries ?? null, s.carryValue ?? null]);

  it('a map locked before the card is taken keeps its carriers (never re-rolled)', () => {
    const rm = startRun();
    const node = rm.nodeMap.nodes.find((n) => n.type === 'battle');
    const before = JSON.stringify(enterBattle(rm, node, 3));
    hold(rm, 'cutpurses_luck');
    expect(rm.getBattleParams(node).carryPasses).toBe(2); // the card rides the params now
    // Re-entering the node (with another battle stream, and after a reload) meets the same map.
    expect(JSON.stringify(enterBattle(rm, node, 4))).toBe(before);
    expect(JSON.stringify(enterBattle(roundTrip(rm), node, 5))).toBe(before);
  });

  it("a map generated with the card keeps the card's carriers through the lock and a reload", () => {
    let checked = 0;
    for (let seed = 1; seed <= 40 && checked < 3; seed++) {
      const rm = hold(startRun({ seed }), 'cutpurses_luck');
      const node = rm.nodeMap.nodes.find((n) => n.type === 'battle');
      const battle = enterBattle(rm, node, seed);
      if (!battle.enemySpawns.some((s) => s.carries)) continue;
      checked++;
      const carriers = carriersOf(battle);
      expect(carriersOf(rm.getLockedBattleConfig(node.id))).toEqual(carriers);
      const back = roundTrip(rm);
      expect(carriersOf(enterBattle(back, node, seed + 100))).toEqual(carriers);
    }
    expect(checked).toBe(3);
  });
});

describe("Cutpurse's Luck: a player's Steal ignores the speed check", () => {
  const STATS = { HP: 20, STR: 4, MAG: 0, SKL: 7, SPD: 5, DEF: 2, RES: 2, LCK: 7, MOV: 5 };
  const unit = (name, faction, col, extra = {}) => ({
    name,
    faction,
    col,
    row: 5,
    currentHP: 20,
    stats: { ...STATS },
    weapon: null,
    inventory: [],
    consumables: [],
    skills: [],
    proficiencies: [],
    ...extra,
  });
  const vulnerary = () => ({
    ...structuredClone(data.consumables.find((c) => c.name === 'Vulnerary')),
    uid: 'itm_v',
  });
  const quick = () =>
    unit('Quick', 'enemy', 6, { stats: { ...STATS, SPD: 15 }, carriedItem: vulnerary() });
  const ability = data.skills.find((s) => s.id === 'steal').actionAbility;

  it('a slow player thief steals with the card, and only with it', () => {
    const plain = startRun();
    const lucky = hold(startRun(), 'cutpurses_luck');
    const thief = unit('Thief', 'player', 5, { skills: ['steal'] });
    expect(isFastEnoughToSteal(thief, quick())).toBe(false);
    expect(settleSteal(thief, quick(), { run: plain })).toBeNull();
    const foe = quick();
    const facts = settleSteal(thief, foe, { run: lucky });
    expect(facts?.destination).toBe('bag');
    expect(foe.carriedItem).toBeUndefined();
    expect(thief.consumables.map((c) => c.uid)).toEqual(['itm_v']);
  });

  it('a foe thief never gains it, even in a run that holds it', () => {
    const lucky = hold(startRun(), 'cutpurses_luck');
    const enemyThief = unit('Rogue', 'enemy', 5, { skills: ['steal'] });
    expect(stealRunOptions(lucky, enemyThief)).toEqual({});
    const mark = unit('Mark', 'player', 6, {
      stats: { ...STATS, SPD: 15 },
      carriedItem: vulnerary(),
    });
    expect(settleSteal(enemyThief, mark, { run: lucky })).toBeNull();
  });

  it('without the card the row still says "Too slow"; with it the carrier is a target', () => {
    const thief = unit('Thief', 'player', 5, { skills: ['steal'] });
    const lucky = hold(startRun(), 'cutpurses_luck');
    const probe = { canAddToConvoy: () => true };
    expect(stealStatus(thief, ability, { enemies: [quick()], ...probe })).toEqual({
      targets: [],
      reason: STEAL_REASONS.tooSlow,
    });
    const status = stealStatus(thief, ability, {
      enemies: [quick()],
      ...probe,
      ...stealRunOptions(lucky, thief),
    });
    expect(status.targets.map((t) => t.unit.name)).toEqual(['Quick']);
    // Room is still checked: a full bag and convoy refuse it even with the speed waived.
    const full = unit('Full', 'player', 5, {
      consumables: Array.from({ length: 3 }, () => vulnerary()),
    });
    expect(
      stealBlockReason(full, quick(), { canAddToConvoy: () => false, ignoreSpeed: true }),
    ).toBe(STEAL_REASONS.full);
  });
});

// ── Open Roll ─────────────────────────────────────────────────────────────

/** A unit as data, its items' uids read without the process-wide counter (itm_<n>_<rand>). */
const sameUnit = (unit) => JSON.parse(JSON.stringify(unit).replace(/itm_\d+_/g, 'itm_n_'));

/** A seed whose Act 1 map has at least `count` recruit nodes. */
function seedWithRecruits(count = 2) {
  for (let seed = 1; seed < 400; seed++) {
    const rm = startRun({ seed });
    if (rm.nodeMap.nodes.filter((n) => n.type === 'recruit').length >= count) return seed;
  }
  throw new Error('no seed with recruit nodes');
}

describe('Open Roll: recruit nodes show two candidates', () => {
  const recruits = (rm) => rm.nodeMap.nodes.filter((n) => n.type === 'recruit');

  it('every open recruit node gets a second candidate; the previews and the map do not move', () => {
    const seed = seedWithRecruits(2);
    const plain = startRun({ seed });
    const roll = hold(startRun({ seed }), 'open_roll');
    const strip = (nodes) => nodes.map(({ recruitAlternate: _a, ...rest }) => rest);
    expect(strip(roll.nodeMap.nodes)).toEqual(strip(plain.nodeMap.nodes));
    for (const node of recruits(roll)) {
      expect(node.recruitAlternate, node.id).toMatchObject({ v: 1 });
      expect(node.recruitAlternate.className).not.toBe(node.recruitPreview.className);
    }
    expect(recruits(plain).some((n) => n.recruitAlternate)).toBe(false);
  });

  it('no two candidates on the map (or any unit) share a name, and both are promised', () => {
    for (let seed = 1; seed <= 60; seed++) {
      const rm = hold(startRun({ seed }), 'open_roll');
      const names = recruits(rm).flatMap((n) => [n.recruitPreview.name, n.recruitAlternate.name]);
      expect(new Set(names).size, `seed ${seed}`).toBe(names.length);
      for (const name of names) expect(rm.roster.map((u) => u.name)).not.toContain(name);
      const promised = rm.getPromisedRecruitNames();
      for (const name of names) expect(promised.has(name)).toBe(true);
    }
  });

  it('an alternate drawn later (a node that lacked one) never takes a name already promised', () => {
    let checked = 0;
    for (let seed = 1; seed <= 120; seed++) {
      const rm = hold(startRun({ seed }), 'open_roll');
      const nodes = recruits(rm);
      if (nodes.length < 2) continue;
      // Node A loses its alternate; node B's alternate takes the very name A would draw again.
      const [a, b] = nodes;
      const again = a.recruitAlternate;
      delete a.recruitAlternate;
      b.recruitAlternate = { ...b.recruitAlternate, name: again.name };
      rm.ensureRecruitPreviews();
      const names = nodes.flatMap((n) => [n.recruitPreview.name, n.recruitAlternate.name]);
      expect(new Set(names).size, `seed ${seed}`).toBe(names.length);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("the alternate is drawn on its own stream, not the preview's, and is the same every time", () => {
    // The class an alternate's first draw picks on a stream (the pool minus the preview's class).
    const classOn = (key, rm, node) => {
      const pool = data.recruits[rm.nodeMap.actId].classPool;
      const others = pool.filter((c) => c !== node.recruitPreview.className);
      const rng = createSeededRng(recruitHash(`${key}:${rm.runSeed >>> 0}:${node.id}`));
      return others[Math.floor(rng() * others.length)];
    };
    let nodes = 0;
    let apart = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const rm = hold(startRun({ seed }), 'open_roll');
      const again = hold(startRun({ seed }), 'open_roll');
      for (const node of recruits(rm)) {
        nodes++;
        expect(node.recruitAlternate.className, `seed ${seed}`).toBe(
          classOn('recruit-preview-alt', rm, node),
        );
        if (classOn('recruit-preview', rm, node) !== node.recruitAlternate.className) apart++;
        // Stable: the same run draws the same alternate, before and after a reload.
        const twin = again.nodeMap.nodes.find((n) => n.id === node.id);
        expect(twin.recruitAlternate).toEqual(node.recruitAlternate);
        expect(roundTrip(rm).nodeMap.nodes.find((n) => n.id === node.id).recruitAlternate).toEqual(
          node.recruitAlternate,
        );
      }
    }
    expect(nodes).toBeGreaterThan(20);
    // The two streams really differ here (so the check above can tell them apart).
    expect(apart).toBeGreaterThan(nodes / 3);
  });

  it('a swap meets the other candidate, built on the same unit stream', () => {
    const seed = seedWithRecruits(1);
    const rm = hold(startRun({ seed }), 'open_roll');
    const node = recruits(rm)[0];
    const first = node.recruitPreview;
    const second = node.recruitAlternate;
    const builtSecond = rm.getRecruitNodeUnit(node, { preview: second });
    expect(rm.swapRecruitCandidate(node.id)).toMatchObject({ ok: true });
    expect(node.recruitPreview).toEqual(second);
    expect(node.recruitAlternate).toEqual(first);
    const met = rm.getRecruitNodeUnit(node);
    expect(met.unit.name).toBe(second.name);
    expect(sameUnit(met.unit)).toEqual(sameUnit(builtSecond.unit));
    // And the battle meets the one chosen.
    expect(rm.getBattleParams(node).recruitPreview.name).toBe(second.name);
  });

  it("the unit stream is the node's own: the first candidate is the same unit with or without the card", () => {
    const seed = seedWithRecruits(1);
    const plain = startRun({ seed });
    const roll = hold(startRun({ seed }), 'open_roll');
    const id = recruits(plain)[0].id;
    const a = plain.getRecruitNodeUnit(plain.nodeMap.nodes.find((n) => n.id === id));
    const b = roll.getRecruitNodeUnit(roll.nodeMap.nodes.find((n) => n.id === id));
    expect(sameUnit(b.unit)).toEqual(sameUnit(a.unit));
  });

  it('a swap is refused once the encounter is set, and without the card', () => {
    const seed = seedWithRecruits(1);
    const plain = startRun({ seed });
    expect(plain.swapRecruitCandidate(recruits(plain)[0].id).ok).toBe(false);
    const rm = hold(startRun({ seed }), 'open_roll');
    const node = recruits(rm)[0];
    const before = structuredClone(node.recruitPreview);
    rm.lockBattleConfig(node.id, { npcSpawn: { ...before }, playerSpawns: [] });
    expect(rm.swapRecruitCandidate(node.id)).toEqual({ ok: false, reason: 'locked' });
    expect(rm.getRecruitAlternate(node.id)).toBeNull();
    expect(node.recruitPreview).toEqual(before);
  });

  it('a reload keeps the swap (and the alternate)', () => {
    const seed = seedWithRecruits(1);
    const rm = hold(startRun({ seed }), 'open_roll');
    const node = recruits(rm)[0];
    rm.swapRecruitCandidate(node.id);
    const back = roundTrip(rm);
    const loaded = back.nodeMap.nodes.find((n) => n.id === node.id);
    expect(loaded.recruitPreview).toEqual(node.recruitPreview);
    expect(loaded.recruitAlternate).toEqual(node.recruitAlternate);
    expect(back.getRecruitAlternate(node.id)).toEqual(node.recruitAlternate);
  });

  it('taken mid-run (an event), the current map gains its alternates at once; the next act too', () => {
    const seed = seedWithRecruits(1);
    const rm = startRun({ seed });
    expect(rm.addBlessingMidRun('open_roll')).toBe(true);
    expect(recruits(rm).every((n) => n.recruitAlternate)).toBe(true);
    rm.advanceAct();
    expect(recruits(rm).every((n) => n.recruitAlternate)).toBe(true);
  });
});

// ── Twin Chapel ───────────────────────────────────────────────────────────

describe('Twin Chapel: each church accepts two vows', () => {
  const church = 'act1_3_2';

  it('without it: one vow, and the other vows say why (the lines as they always were)', () => {
    const rm = startRun();
    commitChurchVow(rm, church, 'promote');
    expect(rm.churchVowByNodeId[church]).toBe('promote');
    expect(churchVowBlock(rm, church, 'blessing')).toBe(
      'Your vow here was Promotion: this altar gives no blessing and lifts no burden.',
    );
    expect(churchVowStatusLine(rm, church)).toBe(churchVowLine('promote'));
    expect(churchVowCommitNote(rm, church, 'blessing')).toBeNull();
  });

  it('with it: a second, different vow; never the same vow twice, never a third', () => {
    const rm = hold(startRun(), 'twin_chapel');
    commitChurchVow(rm, church, 'promote');
    expect(churchVowStatusLine(rm, church)).toBe(
      'Your vow here was Promotion. Twin Chapel: one more vow is open, each a different one.',
    );
    expect(churchVowBlock(rm, church, 'blessing')).toBe('');
    // The promotions stay open: a church's promotions are one vow.
    expect(churchVowBlock(rm, church, 'promote')).toBe('');
    commitChurchVow(rm, church, 'promote');
    expect(churchVows(rm, church)).toEqual(['promote']);
    // The altar's own offer for this church (seeded): take its first.
    const offer = churchBlessingOffers(rm, church, data)[0];
    expect(takeChurchBlessing(rm, church, offer.id, data).ok).toBe(true);
    expect(rm.churchVowByNodeId[church]).toEqual(['promote', 'blessing']);
    expect(churchBlessingBlock(rm, church, 'field_medic', data)).toBe(
      'This altar has already blessed you.',
    );
    expect(churchVowBlock(rm, church, 'cleanse')).toBe(
      'Your vows here were Promotion and a Blessing: this altar lifts no burden.',
    );
    addBurden(rm, 'ill_omen', {});
    // The cleansing reads the node: make this one a church.
    rm.nodeMap.nodes.find((n) => n.row === 1).id = church;
    rm.nodeMap.nodes.find((n) => n.id === church).type = 'church';
    expect(churchCleanseBlock(rm, church, 'ill_omen')).toBe(
      'Your vows here were Promotion and a Blessing: this altar lifts no burden.',
    );
    // A promotion still works: Promotion is one of the two vows made.
    const unit = rm.roster[0];
    expect(churchPromotionBlock(rm, unit, church, data)).not.toMatch(/vow/i);
  });

  it('a vow note says what the vow leaves open', () => {
    const rm = hold(startRun(), 'twin_chapel');
    expect(churchVowCommitNote(rm, church, 'blessing')).toBe(
      'Twin Chapel: this is one of your vows here; one more stays open.',
    );
    commitChurchVow(rm, church, 'blessing');
    expect(churchVowCommitNote(rm, church, 'cleanse')).toBe(
      'This is your last vow here: this church will promote no one.',
    );
    expect(churchVowCommitNote(rm, church, 'blessing')).toBeNull();
  });

  it('the vow line counts the vows the run really has (three with a second extra)', () => {
    const rm = hold(startRun(), 'twin_chapel');
    expect(churchVowStatusLine(rm, church)).toBe(
      'Promote your units, or take a blessing: two different vows per church (Twin Chapel). The first promotion, the blessing or the cleansing makes each.',
    );
    rm.blessingRuntimeModifiers.extraChurchVows = 2;
    expect(churchVowStatusLine(rm, church)).toBe(
      'Promote your units, or take a blessing: three different vows per church (Twin Chapel). The first promotion, the blessing or the cleansing makes each.',
    );
    commitChurchVow(rm, church, 'promote');
    commitChurchVow(rm, church, 'blessing');
    expect(churchVowStatusLine(rm, church)).toBe(
      'Your vows here were Promotion and a Blessing. Twin Chapel: one more vow is open, each a different one.',
    );
  });

  it('an old save keeps its one vow (a string), a two-vow save its list; junk is dropped', () => {
    const rm = startRun();
    const saved = JSON.parse(JSON.stringify(rm.toJSON()));
    saved.churchVowByNodeId = {
      a: 'promote',
      b: ['promote', 'cleanse'],
      c: ['blessing', 'blessing'],
      d: ['nonsense'],
      e: 7,
    };
    const back = RunManager.fromJSON(saved, data);
    expect(back.churchVowByNodeId).toEqual({
      a: 'promote',
      b: ['promote', 'cleanse'],
      c: 'blessing',
    });
    expect(churchVows(back, 'b')).toEqual(['promote', 'cleanse']);
  });
});

describe('Twin Chapel: the church menu keeps the altar open for the second vow', () => {
  beforeEach(() => {
    installFakeDom(vi);
    _resetInputFocus();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    _resetInputFocus();
  });

  /** The church menu at a church node of `rm`, rendered as the route map opens it. */
  function churchMenu(rm) {
    const node = rm.nodeMap.nodes.find((n) => n.row === 1);
    node.type = 'church';
    const scene = {
      gameData: data,
      runManager: rm,
      events: { on: vi.fn(), once: vi.fn(), off: vi.fn() },
      registry: {
        get: (k) =>
          ({
            hints: { hasSeen: () => true, markSeen: vi.fn() },
            settings: { getHints: () => false, getGuidance: () => 'off' },
            meta: { runsCompleted: 1 },
          })[k],
      },
      textures: { exists: () => false },
      _churchNode: { id: node.id },
      _churchRuinsMode: false,
    };
    return { node, open: () => new ChurchMenu({ scene, leaveChurchNode: vi.fn() }) };
  }
  const altar = (menu) => menu.surface.body.querySelectorAll('.church-blessing');

  for (const first of ['promote', 'cleanse']) {
    it(`after a ${first} vow the altar still offers its blessings, open`, () => {
      const rm = hold(startRun(), 'twin_chapel');
      addBurden(rm, 'ill_omen', {});
      const { node, open } = churchMenu(rm);
      if (first === 'cleanse') expect(cleanseAtChurch(rm, node.id, 'ill_omen').ok).toBe(true);
      else commitChurchVow(rm, node.id, 'promote');
      expect(churchVows(rm, node.id)).toEqual([first]);
      const menu = open();
      const buttons = altar(menu);
      expect(buttons.length).toBeGreaterThan(0);
      expect(buttons.every((b) => !b.disabled)).toBe(true);
      // Taking one closes the altar (the blessing vow is made) and fills the church's two vows.
      const offer = churchBlessingOffers(rm, node.id, data)[0];
      expect(takeChurchBlessing(rm, node.id, offer.id, data).ok).toBe(true);
      menu.render();
      expect(altar(menu)).toHaveLength(0);
      menu.surface.destroy?.();
    });
  }

  it('without the card the altar after a promotion is shown closed, with its reason', () => {
    const rm = startRun();
    const { node, open } = churchMenu(rm);
    commitChurchVow(rm, node.id, 'promote');
    const buttons = altar(open());
    expect(buttons.length).toBeGreaterThan(0);
    expect(buttons.every((b) => b.disabled)).toBe(true);
  });
});

// ── Omen Reader ───────────────────────────────────────────────────────────

describe('Omen Reader: the next two falls marked; the Eclipse spares recruits', () => {
  const eclipseOf = (rm, actShadow) => {
    rm.eclipse = { ...rm.eclipse, shadow: actShadow, actShadow };
  };

  it('a recruit node never falls, in play or on load; without the card it does', () => {
    const seed = seedWithRecruits(1);
    const plain = startRun({ seed });
    const omen = hold(startRun({ seed }), 'omen_reader');
    for (const rm of [plain, omen]) {
      eclipseOf(rm, 500);
      rm.applyEclipseNow();
    }
    const recruitIds = plain.nodeMap.nodes
      .filter((n) => n.eclipse?.fromType === 'recruit')
      .map((n) => n.id);
    expect(recruitIds.length).toBeGreaterThan(0);
    for (const id of recruitIds)
      expect(omen.nodeMap.nodes.find((n) => n.id === id).type).toBe('recruit');
    // On load (fromJSON applies the Eclipse again) the spared node still stands.
    const back = roundTrip(omen);
    for (const id of recruitIds)
      expect(back.nodeMap.nodes.find((n) => n.id === id).type).toBe('recruit');
    // Everything else falls as before.
    const other = plain.nodeMap.nodes.filter((n) => n.eclipse && n.eclipse.fromType !== 'recruit');
    for (const n of other)
      expect(omen.nodeMap.nodes.find((m) => m.id === n.id).eclipse).toBeTruthy();
  });

  /** The batches the dark takes, raising the act shadow one point at a time. */
  const fallBatches = (rm, count) => {
    const batches = [];
    for (let act = 1; act <= 400 && batches.length < count; act++) {
      eclipseOf(rm, act);
      const fell = rm.applyEclipseNow().map((node) => node.id);
      if (fell.length) batches.push(fell.sort());
    }
    return batches;
  };
  const marksOf = (view) => {
    const ranks = [];
    for (const [id, info] of view.nodes)
      if (info.foretold) (ranks[info.omenRank - 1] ||= []).push({ id, info });
    return ranks;
  };

  it('marks the next two falls by threshold: every node in each batch, tied ones sharing a rank', () => {
    let ties = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const rm = hold(startRun({ seed }), 'omen_reader');
      const ranks = marksOf(rm.getEclipseView());
      expect(ranks, `seed ${seed}`).toHaveLength(2);
      for (const group of ranks) {
        expect(group.length, `seed ${seed}`).toBeGreaterThan(0);
        // A tie says how many fall with it.
        for (const { info } of group) expect(info.omenShared).toBe(group.length - 1);
        if (group.length > 1) ties++;
      }
      const batches = fallBatches(rm, 2);
      // The first batch the dark takes is exactly rank 1 (marked[0] falls first, and nothing
      // falls with it unmarked); the second is exactly rank 2.
      expect(ranks[0].map((m) => m.id).sort(), `seed ${seed}`).toEqual(batches[0]);
      expect(ranks[1].map((m) => m.id).sort(), `seed ${seed}`).toEqual(batches[1]);
    }
    // The seeds really hold ties (the rule for them is exercised, not assumed).
    expect(ties).toBeGreaterThan(3);
  });

  it('a tied knot says it falls with others; a lone one does not', () => {
    const line = (info) =>
      describeLoomNode(
        { id: 'n', type: 'shop', row: 2, col: 1 },
        { state: 'future', eclipse: info },
      ).warning;
    const base = { eclipsed: false, remaining: 5, near: false, foretold: true };
    expect(line({ ...base, omenRank: 1, omenShared: 0 })).toBe(
      'Omen: the dark takes this knot next.',
    );
    expect(line({ ...base, omenRank: 1, omenShared: 1 })).toBe(
      'Omen: the dark takes this knot next, with one other.',
    );
    expect(line({ ...base, omenRank: 2, omenShared: 2 })).toBe(
      'Omen: the dark takes this knot soon after the next, with 2 others.',
    );
    expect(line({ ...base, omenRank: 2, omenShared: 0 })).toBe(
      'Omen: the dark takes this knot soon after the next.',
    );
  });

  it('never foretells a spared, current or locked node; a run without it foretells nothing', () => {
    const seed = seedWithRecruits(1);
    const rm = hold(startRun({ seed }), 'omen_reader');
    const node = rm.nodeMap.nodes.find((n) => n.type === 'battle' && n.row > 0);
    node.encounterLocked = true;
    const view = rm.getEclipseView();
    for (const n of rm.nodeMap.nodes) {
      const info = view.nodes.get(n.id);
      if (n.type === 'recruit' || n.id === node.id) expect(info?.foretold, n.id).toBeFalsy();
    }
    expect([...startRun({ seed }).getEclipseView().nodes.values()].some((i) => i.foretold)).toBe(
      false,
    );
    // The pure view: foretell 0 marks nothing, whatever the map.
    const bare = buildEclipseView({
      state: rm.eclipse,
      config: rm.getEclipseConfig(),
      nodeMap: rm.nodeMap,
      runSeed: rm.runSeed,
    });
    expect([...bare.nodes.values()].some((i) => i.foretold)).toBe(false);
  });
});

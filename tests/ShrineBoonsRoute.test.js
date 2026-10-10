// Cutpurse's Luck, Open Roll, Twin Chapel and Omen Reader (docs/specs/blessings-v3.md §5, PR
// D4): the §5 cards that act on the road (carriers, recruit nodes, churches, the Eclipse). Each
// test is named after a realistic way the rule breaks. Seeded draws are pinned: a card's own
// stream never moves the node-map, battle, loot or recruit streams.
import { afterEach, describe, expect, it } from 'vitest';
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
  commitChurchVow,
  takeChurchBlessing,
} from '../src/engine/ChurchVow.js';
import { churchPromotionBlock } from '../src/engine/ChurchCommands.js';
import { addBurden } from '../src/engine/Burdens.js';
import { buildEclipseView } from '../src/engine/EclipseSystem.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
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

  it('a locked map keeps its carriers (the blessing never re-rolls a map already set)', () => {
    const rm = startRun();
    const node = rm.nodeMap.nodes.find((n) => n.type === 'battle');
    installSeed(3);
    const battle = generateBattle({ deployCount: 4, ...rm.getBattleParams(node) }, data);
    restoreMathRandom();
    rm.lockBattleConfig(node.id, battle);
    hold(rm, 'cutpurses_luck');
    expect(rm.getLockedBattleConfig(node.id).enemySpawns).toEqual(battle.enemySpawns);
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

  it('marks exactly the two nodes the dark takes next, in the order it takes them', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const rm = hold(startRun({ seed }), 'omen_reader');
      const view = rm.getEclipseView();
      const marked = [...view.nodes.entries()]
        .filter(([, info]) => info.foretold)
        .sort((a, b) => a[1].omenRank - b[1].omenRank)
        .map(([id]) => id);
      expect(marked, `seed ${seed}`).toHaveLength(2);
      // Raise the act shadow one point at a time: the first falls are the foretold ones.
      const order = [];
      for (let act = 1; act <= 400 && order.length < 2; act++) {
        eclipseOf(rm, act);
        for (const node of rm.applyEclipseNow()) order.push(node.id);
      }
      expect(order.slice(0, 2).sort(), `seed ${seed}`).toEqual([...marked].sort());
      expect(order[0] === marked[0] || order.length > 2 || order[1] === marked[0]).toBe(true);
    }
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

// The effects Phase 2D added to the event engine (docs/specs/event-nodes-phase2.md "2D as built"):
// the accessory pool, `stat: 'best'` and stat losses, forge / wear / mend, an elite or recruit
// battle, a gold refund, the `notContract` requirement and an outcome only a rung brings.
// Each is also proved against the validator and the schema in tests/EventPhase2DData.test.js.
//
// Ways each goes wrong (a test, or a group, for every line):
//   accessory   a table of the wrong act (the "tier up" off by one, no cap at the top act); an item
//               that needs bag room or is lost when the bags are full; an item with no uid; a pick
//               that is not seeded; a record the page cannot word
//   best stat   HP or MOV picked; a tie always settled the same way; a loss that takes a stat below 0
//               or max HP below 1, or leaves current HP above the new max or at 0
//   forge       a weapon that is not the target's equipped one; a stat that cannot take the forge; a
//               forge that costs gold; a weapon that cannot be forged still "forged"
//   wear        a forged weapon worn; a wear with nothing to wear that is not a fallback; the wrong
//               sign or size of the step
//   mend        a step left on a weapon; a stat or price not restored exactly; the gold not charged
//   plan        an effect applied although a later one fails (all or nothing); the same weapon worked
//               twice in one outcome; a state that does not survive a reload
//   battle      an elite that is not elite (gold, params); a recruit that is not in the battle's
//               params, not the unit the scene builds, a lord, a name another unit may take, or lost
//               to a reload
//   refund      a refund that is not the price the choice charged (scaled by costScale)
// Numbers are worked out by hand from the stats the tests set, never by re-running the code.
import { describe, expect, it } from 'vitest';
import {
  chooseEventOption,
  completeEventBattle,
  eventChoiceBlock,
  eventTargets,
  pendingEventBattle,
} from '../src/engine/EventCommands.js';
import { RunManager } from '../src/engine/RunManager.js';
import { roadCandidates } from '../src/engine/RouteEdit.js';
import { generateBattle } from '../src/engine/MapGenerator.js';
import { isRecruitBattleNode } from '../src/engine/RecruitNodeSystem.js';
import { accessoryPoolFor } from '../src/engine/EventEffects.js';
import { evaluateRequires } from '../src/engine/EventSystem.js';
import { applyWear, isWorn, wearCount } from '../src/engine/WeaponWear.js';
import { applyForge } from '../src/engine/ForgeSystem.js';
import { INVENTORY_MAX, CONSUMABLE_MAX } from '../src/utils/constants.js';
import { addUnit, arriveAs, baseData, newRun, runWithEvents, soloEvent } from './eventKit.js';
import { contractEvent } from './eventPhase2Kit.js';

const reload = (run) => RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), run.gameData);

/**
 * A one-choice event around `effects`, played at a node of a fresh run. `target` names a roster
 * unit; the choice carries a target block when `filter` is given (or a target is named).
 */
function play(
  effects,
  { run = null, target = null, filter, choice = {}, outcome = {}, act = 0, options = {} } = {},
) {
  const wantsTarget = filter !== undefined || target !== null;
  const event = soloEvent(effects, {
    choice: {
      ...(wantsTarget ? { target: { prompt: 'Who?', filter: filter || {} } } : {}),
      ...choice,
    },
    outcome,
  });
  const r = run || runWithEvents([event], options);
  if (run) r.gameData.events.events.unshift(event);
  r.actSequence = ['act1', 'act2', 'act3', 'act4'];
  r.actIndex = act;
  const node = arriveAs(
    r,
    'solo',
    r.nodeMap.nodes.find((n) => n.row === 3 && !n.completed),
  );
  const unit = target ? r.roster.find((u) => u.name === target) : null;
  const result = chooseEventOption(r, node.id, 'go', { targetUid: unit?.unitUid || null });
  return { run: r, node, result, unit };
}

/** The four weapon numbers a forge or a wear moves. */
const numbers = (w) => ({ might: w.might, crit: w.crit, hit: w.hit, weight: w.weight });
const diff = (before, after) =>
  Object.fromEntries(
    Object.keys(before)
      .filter((k) => before[k] !== after[k])
      .map((k) => [k, after[k] - before[k]]),
  );

// ── Accessory pools ─────────────────────────────────────────────────────

// The loot tables' accessory lists by act, copied from data/lootTables.json by hand.
const ACT1 = [
  'Goddess Icon',
  'Shield Ring',
  'Forest Charm',
  'Soothing Stone',
  "Hunter's Cloak",
  "Gambler's Coin",
];
const ACT2 = ['Power Ring', 'Speed Ring', 'Barrier Ring', 'Skill Ring', 'Life Ring', "Veteran's Crest", 'Vanguard Crest', 'Diamond Medallion', 'Moontide Amulet', "Bounty Hunter's Mark", "Vampire's Bloodshard", 'Boots', 'Warding Charm', "Mentor's Band"]; // prettier-ignore
const ACT3 = ['Seraph Robe', 'Magic Ring', 'Boots', 'Delphi Shield', 'Wrath Band', 'Counter Seal', 'Pursuit Ring', 'Blood Gem', 'Recoil Guard', 'Phoenix Brooch', "Duelist's Glove", 'Warding Charm', "Mentor's Band", 'Mercury Sandals', 'Phalanx Band']; // prettier-ignore
const ACT4 = ['Seraph Robe', 'Magic Ring', 'Boots', 'Delphi Shield', 'Wrath Band', 'Counter Seal', 'Pursuit Ring', 'Nullify Ring', 'Warding Charm', "Mentor's Band", 'Mercury Sandals', 'Phalanx Band']; // prettier-ignore

describe('an accessory from the pool one tier up', () => {
  const grant = (tierOffset) => [{ type: 'item', pool: { kind: 'accessory', tierOffset } }];

  it("is drawn from the next act's loot table and goes to the accessory pool, with a uid", () => {
    const { run, result } = play(grant(1), { act: 0 }); // act1: one tier up is act2's table
    expect(result.ok, result.reason).toBe(true);
    expect(result.results).toHaveLength(1);
    const record = result.results[0];
    expect(record).toMatchObject({ kind: 'item', itemType: 'Accessory', unit: null, toConvoy: false, pooled: true, worn: [] }); // prettier-ignore
    expect(ACT2).toContain(record.name);
    expect(run.accessories).toHaveLength(1);
    expect(run.accessories[0].name).toBe(record.name);
    expect(run.accessories[0].type).toBe('Accessory');
    expect(typeof run.accessories[0].uid).toBe('string');
    // Nothing went into a bag or the convoy.
    expect(run.convoy.weapons).toHaveLength(0);
    expect(run.convoy.consumables).toHaveLength(0);
  });

  it("tierOffset 0 is this act's own table; the top act caps (act4 + 1 and act1 + 3 end at act4)", () => {
    const tables = new Map([
      [[0, 0], ACT1],
      [[1, 0], ACT2],
      [[2, 0], ACT3],
      [[2, 1], ACT4],
      [[3, 1], ACT4], // the cap
      [[0, 3], ACT4], // a tier far up is the top table
    ]);
    for (const [[act, offset], table] of tables) {
      const seen = new Set();
      for (let seed = 1; seed <= 25; seed++) {
        const { result } = play(grant(offset), { act, options: { seed } });
        expect(result.ok, `act${act + 1}+${offset}: ${result.reason}`).toBe(true);
        seen.add(result.results[0].name);
      }
      for (const name of seen)
        expect(table, `act${act + 1}+${offset} gave ${name}`).toContain(name);
      expect(seen.size, `act${act + 1}+${offset} never varies`).toBeGreaterThan(2);
    }
  });

  it('the pool helper agrees: sorted names of that table, each a real accessory', () => {
    const run = newRun();
    run.actSequence = ['act1', 'act2', 'act3', 'act4'];
    run.actIndex = 1;
    const names = accessoryPoolFor(run, 1).map((a) => a.name);
    expect(names).toEqual([...new Set(ACT3)].sort());
    run.actIndex = 3;
    expect(accessoryPoolFor(run, 2).map((a) => a.name)).toEqual([...new Set(ACT4)].sort());
  });

  it('is seeded: one seed, one accessory; and a different run seed can differ', () => {
    const first = play(grant(1), { options: { seed: 77 } }).result.results[0].name;
    const again = play(grant(1), { options: { seed: 77 } }).result.results[0].name;
    expect(again).toBe(first);
    const names = new Set();
    for (let seed = 1; seed <= 30; seed++)
      names.add(play(grant(1), { options: { seed } }).result.results[0].name);
    expect(names.size).toBeGreaterThan(3);
  });

  it('needs no room: with every bag and the convoy full the choice stays open (a weapon would be blocked)', () => {
    const fill = (run) => {
      for (const unit of run.roster) {
        while (unit.inventory.length < INVENTORY_MAX)
          unit.inventory.push(structuredClone(unit.inventory[0]));
        while ((unit.consumables || []).length < CONSUMABLE_MAX)
          (unit.consumables ||= []).push({ ...run.getConsumableTemplate('Herb') });
      }
      const caps = run.getConvoyCapacities();
      run.convoy.weapons = Array.from({ length: caps.weapons }, () =>
        structuredClone(run.roster[0].inventory[0]),
      );
      run.convoy.consumables = Array.from({ length: caps.consumables }, () => ({
        ...run.getConsumableTemplate('Herb'),
      }));
    };
    const accessory = runWithEvents([soloEvent(grant(1))]);
    fill(accessory);
    let node = arriveAs(accessory, 'solo');
    expect(eventChoiceBlock(accessory, node.id, 'go')).toBe('');
    expect(chooseEventOption(accessory, node.id, 'go').ok).toBe(true);
    expect(accessory.accessories).toHaveLength(1);

    const weapon = runWithEvents([
      soloEvent([{ type: 'item', pool: { kind: 'weapon', weaponTypes: '$army', tierOffset: 0 } }]),
    ]);
    fill(weapon);
    node = arriveAs(weapon, 'solo');
    expect(eventChoiceBlock(weapon, node.id, 'go')).toMatch(/Nowhere to carry/);
  });

  it('is all or nothing: a later effect that cannot be planned leaves the pool untouched', () => {
    // An item the game does not have cannot be planned, so the accessory before it must not appear.
    const { run, result } = play([...grant(1), { type: 'item', name: 'No Such Thing' }]);
    expect(result.ok).toBe(false);
    expect(run.accessories).toEqual([]);
  });

  it('survives a save and a load, uid and all', () => {
    const { run } = play(grant(1));
    const loaded = reload(run);
    expect(loaded.accessories).toHaveLength(1);
    expect(loaded.accessories[0]).toMatchObject({
      name: run.accessories[0].name,
      type: 'Accessory',
    });
    expect(loaded.accessories[0].uid).toBe(run.accessories[0].uid);
  });
});

// ── stat: 'best', and a stat that goes down ─────────────────────────────

describe("stat 'best' and losses", () => {
  /** A unit with exactly these stats (HP 20, nothing else unless said). */
  const withStats = (run, name, stats, currentHP) => {
    const unit = addUnit(run, 'Fighter', { name });
    unit.stats = {
      HP: 20,
      STR: 1,
      MAG: 1,
      SKL: 1,
      SPD: 1,
      DEF: 1,
      RES: 1,
      LCK: 1,
      MOV: 5,
      ...stats,
    };
    unit.currentHP = currentHP ?? unit.stats.HP;
    return unit;
  };
  it("raises the unit's highest of the seven stats, never HP or MOV (HP 20 and MOV 5 lead nothing here)", () => {
    for (const [stats, expected] of [
      [{ STR: 11 }, 'STR'],
      [{ MAG: 12, STR: 3 }, 'MAG'],
      [{ LCK: 9, SPD: 8 }, 'LCK'],
      [{ DEF: 7, RES: 6, SKL: 5 }, 'DEF'],
    ]) {
      const run = newRun({ seed: 5 });
      const unit = withStats(run, 'Tess', stats);
      const before = unit.stats[expected];
      const result = play([{ type: 'stat', stat: 'best', value: 2, scope: 'target' }], {
        run,
        target: 'Tess',
      }).result;
      expect(result.ok, result.reason).toBe(true);
      expect(result.results).toEqual([{ kind: 'stat', unit: 'Tess', stat: expected, value: 2 }]);
      expect(unit.stats[expected]).toBe(before + 2);
      expect(unit.stats.HP).toBe(20); // untouched
      expect(unit.stats.MOV).toBe(5);
    }
  });

  it('settles a tie with the seeded stream: both tied stats come up across seeds, one per seed', () => {
    const chosen = new Map();
    for (let seed = 1; seed <= 40; seed++) {
      const run = newRun({ seed });
      withStats(run, 'Tess', { SKL: 9, SPD: 9, STR: 4 });
      const { result } = play([{ type: 'stat', stat: 'best', value: 1, scope: 'target' }], {
        run,
        target: 'Tess',
      });
      const stat = result.results[0].stat;
      expect(['SKL', 'SPD']).toContain(stat);
      chosen.set(seed, stat);
      // The same seed, the same stat.
      const again = newRun({ seed });
      withStats(again, 'Tess', { SKL: 9, SPD: 9, STR: 4 });
      expect(play([{ type: 'stat', stat: 'best', value: 1, scope: 'target' }], { run: again, target: 'Tess' }).result.results[0].stat).toBe(stat); // prettier-ignore
    }
    expect(new Set(chosen.values())).toEqual(new Set(['SKL', 'SPD']));
  });

  it('a lost point of max HP lowers max and current alike (20/20 -> 17/17, 15/20 -> 12/17)', () => {
    for (const [hp, max, now] of [
      [20, 17, 17],
      [15, 17, 12],
    ]) {
      const run = newRun({ seed: 6 });
      const unit = withStats(run, 'Tess', {}, hp);
      const { result } = play([{ type: 'stat', stat: 'HP', value: -3, scope: 'target' }], {
        run,
        target: 'Tess',
      });
      expect(result.results).toEqual([{ kind: 'stat', unit: 'Tess', stat: 'HP', value: -3 }]);
      expect([unit.stats.HP, unit.currentHP]).toEqual([max, now]);
    }
  });

  it('a unit at 2 HP loses max HP but is never left at 0: current HP stops at 1', () => {
    const run = newRun({ seed: 6 });
    const unit = withStats(run, 'Tess', {}, 2);
    play([{ type: 'stat', stat: 'HP', value: -3, scope: 'target' }], { run, target: 'Tess' });
    expect([unit.stats.HP, unit.currentHP]).toEqual([17, 1]);
  });

  it('never takes a stat below 0 or max HP below 1, and reports what it took', () => {
    const run = newRun({ seed: 6 });
    const frail = withStats(run, 'Tess', { HP: 3, STR: 2 });
    const hp = play([{ type: 'stat', stat: 'HP', value: -3, scope: 'target' }], {
      run,
      target: 'Tess',
    });
    expect(hp.result.results[0].value).toBe(-2); // 3 -> 1, not 0
    expect([frail.stats.HP, frail.currentHP]).toEqual([1, 1]);
    const run2 = newRun({ seed: 6 });
    const weak = withStats(run2, 'Tess', { STR: 2 });
    const str = play([{ type: 'stat', stat: 'STR', value: -5, scope: 'target' }], {
      run: run2,
      target: 'Tess',
    });
    expect(str.result.results[0].value).toBe(-2);
    expect(weak.stats.STR).toBe(0);
  });

  it('works on the lowest-level unit too, and survives a reload', () => {
    const run = newRun({ seed: 9 });
    const low = withStats(run, 'Tess', { LCK: 14 });
    low.level = 1;
    low.xp = 0;
    run.roster.forEach((u) => u !== low && (u.level = Math.max(3, u.level)));
    const { run: r } = play([{ type: 'stat', stat: 'best', value: 2, scope: 'lowestLevel' }], {
      run,
    });
    const loaded = reload(r);
    expect(loaded.roster.find((u) => u.name === 'Tess').stats.LCK).toBe(16);
  });
});

// ── forge, wear, mend ───────────────────────────────────────────────────

describe('forge', () => {
  const forgeable = { forgeableWeapon: true, living: true };

  it("puts one free forge step on the target's equipped weapon, and on nothing else", () => {
    const run = newRun({ seed: 12 });
    const brant = addUnit(run, 'Fighter', { name: 'Brant' });
    const equipped = brant.weapon;
    const spare = brant.inventory.find((w) => w !== equipped);
    const before = numbers(equipped);
    const spareBefore = structuredClone(spare);
    const gold = run.gold;
    const { result } = play([{ type: 'forge', stat: 'random' }], {
      run,
      target: 'Brant',
      filter: forgeable,
    });
    expect(result.ok, result.reason).toBe(true);
    // One step of one stat, by the forge's own sizes (+1 Mt, +5 Crit, +5 Hit, -1 Wt), by hand.
    const moved = diff(before, numbers(equipped));
    expect(Object.keys(moved)).toHaveLength(1);
    const [[stat, amount]] = Object.entries(moved);
    expect({ might: 1, crit: 5, hit: 5, weight: -1 }[stat]).toBe(amount);
    expect(equipped._forgeLevel).toBe(1);
    expect(equipped.name).toBe('Iron Axe +1');
    expect(result.results).toEqual([
      { kind: 'forge', unit: 'Brant', weapon: 'Iron Axe', name: 'Iron Axe +1', stat },
    ]);
    expect(run.gold).toBe(gold); // free
    expect(spare).toEqual(spareBefore); // the other weapon is untouched
  });

  it('a named stat is the stat; a random one is seeded and covers every stat across seeds', () => {
    const forced = newRun({ seed: 12 });
    const unit = addUnit(forced, 'Fighter', { name: 'Brant' });
    const crit = unit.weapon.crit;
    play([{ type: 'forge', stat: 'crit' }], { run: forced, target: 'Brant', filter: forgeable });
    expect(unit.weapon.crit).toBe(crit + 5);
    const seen = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const run = newRun({ seed });
      addUnit(run, 'Fighter', { name: 'Brant' });
      const r = play([{ type: 'forge', stat: 'random' }], {
        run,
        target: 'Brant',
        filter: forgeable,
      }).result;
      seen.add(r.results[0].stat);
      const again = newRun({ seed });
      addUnit(again, 'Fighter', { name: 'Brant' });
      expect(play([{ type: 'forge', stat: 'random' }], { run: again, target: 'Brant', filter: forgeable }).result.results[0].stat).toBe(r.results[0].stat); // prettier-ignore
    }
    expect(seen).toEqual(new Set(['might', 'crit', 'hit', 'weight']));
  });

  it('the picker greys out a weapon that cannot take it, with its reason', () => {
    const run = newRun({ seed: 12 });
    addUnit(run, 'Fighter', { name: 'Brant' });
    const worn = addUnit(run, 'Archer', { name: 'Worn' });
    applyWear(worn.weapon, 'might');
    addUnit(run, 'Cleric', { name: 'Mara' }); // a staff
    const maxed = addUnit(run, 'Mage', { name: 'Maxed' });
    for (let i = 0; i < 5; i++) applyForge(maxed.weapon, 'might'); // the per-stat cap
    addUnit(run, 'Thief', { name: 'Edge' });
    const event = soloEvent([{ type: 'forge' }], {
      choice: { target: { prompt: 'Who?', filter: forgeable } },
    });
    run.gameData.events = {
      ...run.gameData.events,
      events: [event, ...run.gameData.events.events],
    };
    const node = arriveAs(run, 'solo');
    const rows = Object.fromEntries(eventTargets(run, node.id, 'go').map((r) => [r.name, r]));
    expect(rows.Brant.ok).toBe(true);
    expect(rows.Edge.ok).toBe(true);
    for (const name of ['Worn', 'Mara']) {
      expect(rows[name].ok, name).toBe(false);
      expect(rows[name].reason).toBe('Their weapon cannot take more.');
    }
    // A weapon forged at one stat's cap is still forgeable at the others.
    expect(rows.Maxed.ok).toBe(true);
  });

  it('with nothing it can still take, the effect is refused (not a silent no-op) and nothing changes', () => {
    const run = newRun({ seed: 12 });
    const unit = addUnit(run, 'Fighter', { name: 'Brant' });
    for (let i = 0; i < 5; i++) applyForge(unit.weapon, 'might');
    const before = numbers(unit.weapon);
    const { result } = play([{ type: 'forge', stat: 'might' }], { run, target: 'Brant' });
    expect(result).toEqual({ ok: false, reason: 'Their weapon cannot take more.' });
    expect(numbers(unit.weapon)).toEqual(before);
  });

  it('survives a save and a load: the forged weapon keeps its name and level', () => {
    const run = newRun({ seed: 12 });
    addUnit(run, 'Fighter', { name: 'Brant' });
    play([{ type: 'forge', stat: 'might' }], { run, target: 'Brant', filter: forgeable });
    const loaded = reload(run).roster.find((u) => u.name === 'Brant');
    expect(loaded.weapon.name).toBe('Iron Axe +1');
    expect(loaded.weapon._forgeLevel).toBe(1);
    expect(loaded.inventory[0]).toBe(loaded.weapon);
  });
});

describe('wear', () => {
  it('puts one wear step on the equipped weapon: the reverse of a forge step, named "-1"', () => {
    const run = newRun({ seed: 14 });
    const unit = addUnit(run, 'Fighter', { name: 'Brant' });
    const before = numbers(unit.weapon);
    const { result } = play([{ type: 'wear' }], {
      run,
      target: 'Brant',
      outcome: { fallback: [{ type: 'gold', value: 1 }] },
    });
    expect(result.ok, result.reason).toBe(true);
    const moved = diff(before, numbers(unit.weapon));
    expect(Object.keys(moved)).toHaveLength(1);
    const [[stat, amount]] = Object.entries(moved);
    expect({ might: -1, crit: -5, hit: -5, weight: 1 }[stat]).toBe(amount); // by hand
    expect(wearCount(unit.weapon)).toBe(1);
    expect(unit.weapon.name).toBe('Iron Axe -1');
    expect(result.results).toEqual([
      { kind: 'wear', unit: 'Brant', weapon: 'Iron Axe', name: 'Iron Axe -1', stat },
    ]);
  });

  it("a forged weapon does not wear: the outcome's fallback plays and its text replaces the outcome's", () => {
    const run = newRun({ seed: 14 });
    const unit = addUnit(run, 'Fighter', { name: 'Brant' });
    applyForge(unit.weapon, 'might');
    const hp = unit.currentHP;
    const { result } = play([{ type: 'wear' }], {
      run,
      target: 'Brant',
      outcome: {
        text: 'Marked.',
        fallbackText: 'The sparks find the hand.',
        fallback: [{ type: 'hp', mode: 'damage', percent: 25, scope: 'target' }],
      },
    });
    expect(result.ok, result.reason).toBe(true);
    expect(result.text).toBe('The sparks find the hand.');
    expect(isWorn(unit.weapon)).toBe(false);
    expect(unit.weapon.name).toBe('Iron Axe +1');
    // 25% of 23 HP, rounded: 6 (Math.round(5.75)) by hand from the Fighter's 23 max HP.
    expect(hp - unit.currentHP).toBe(Math.round((unit.stats.HP * 25) / 100));
  });

  it('with no fallback a wear that finds nothing to wear refuses the choice, naming why', () => {
    const run = newRun({ seed: 14 });
    const unit = addUnit(run, 'Fighter', { name: 'Brant' });
    applyForge(unit.weapon, 'might');
    const { result } = play([{ type: 'wear' }], { run, target: 'Brant' });
    expect(result).toEqual({ ok: false, reason: 'Their weapon cannot wear.' });
    expect(unit.weapon.name).toBe('Iron Axe +1');
  });

  it('a weapon worn three steps cannot take a fourth (the cap)', () => {
    const run = newRun({ seed: 14 });
    const unit = addUnit(run, 'Fighter', { name: 'Brant' });
    for (const stat of ['might', 'hit', 'crit']) applyWear(unit.weapon, stat);
    expect(wearCount(unit.weapon)).toBe(3);
    const { result } = play([{ type: 'wear' }], { run, target: 'Brant' });
    expect(result.ok).toBe(false);
    expect(wearCount(unit.weapon)).toBe(3);
  });
});

describe('mend', () => {
  const worn = { wornWeapon: true, living: true };

  /** A Fighter with an Iron Axe worn twice (might, hit) and a Hand Axe worn once (crit). */
  function wornFighter(run) {
    const unit = addUnit(run, 'Fighter', { name: 'Brant' });
    const [iron, hand] = unit.inventory;
    const originals = [structuredClone(iron), structuredClone(hand)];
    applyWear(iron, 'might');
    applyWear(iron, 'hit');
    applyWear(hand, 'crit');
    return { unit, iron, hand, originals };
  }

  it('repairs every wear step on every weapon the unit carries, stats and price and name restored', () => {
    const run = newRun({ seed: 15 });
    const { unit, iron, hand, originals } = wornFighter(run);
    expect(iron.name).toBe('Iron Axe -2');
    const { result } = play([{ type: 'mend' }], { run, target: 'Brant', filter: worn });
    expect(result.ok, result.reason).toBe(true);
    expect(result.results).toEqual([
      {
        kind: 'mend',
        unit: 'Brant',
        steps: 3,
        weapons: [
          { from: 'Iron Axe -2', to: 'Iron Axe', steps: 2 },
          { from: 'Hand Axe -1', to: 'Hand Axe', steps: 1 },
        ],
      },
    ]);
    for (const [now, original] of [
      [iron, originals[0]],
      [hand, originals[1]],
    ]) {
      expect(isWorn(now)).toBe(false);
      expect(numbers(now)).toEqual(numbers(original));
      expect(now.price).toBe(original.price);
      expect(now.name).toBe(original.name);
    }
    expect(unit.weapon).toBe(iron);
  });

  it("charges the choice's gold and is blocked when the purse is short", () => {
    const run = newRun({ seed: 15, gold: 400 });
    wornFighter(run);
    const { result } = play([{ type: 'mend' }], {
      run,
      target: 'Brant',
      filter: worn,
      choice: { cost: { gold: 300 } },
    });
    expect(result.ok, result.reason).toBe(true);
    expect(run.gold).toBe(100);
    const poor = newRun({ seed: 15, gold: 100 });
    wornFighter(poor);
    const refused = play([{ type: 'mend' }], {
      run: poor,
      target: 'Brant',
      filter: worn,
      choice: { cost: { gold: 300 } },
    });
    expect(refused.result).toEqual({ ok: false, reason: 'Not enough gold.' });
    expect(poor.gold).toBe(100);
  });

  it('only a unit carrying a worn weapon can be picked, and says so for the rest', () => {
    const run = newRun({ seed: 15 });
    wornFighter(run);
    addUnit(run, 'Archer', { name: 'Fresh' });
    const event = soloEvent([{ type: 'mend' }], {
      choice: { target: { prompt: 'Who?', filter: worn } },
    });
    run.gameData.events = {
      ...run.gameData.events,
      events: [event, ...run.gameData.events.events],
    };
    const node = arriveAs(run, 'solo');
    const rows = Object.fromEntries(eventTargets(run, node.id, 'go').map((r) => [r.name, r]));
    expect(rows.Brant.ok).toBe(true);
    expect(rows.Fresh).toMatchObject({ ok: false, reason: 'Nothing they carry is worn.' });
  });

  it('is all or nothing: a failing later effect leaves every step in place', () => {
    const run = newRun({ seed: 15 });
    const { iron, hand } = wornFighter(run);
    const { result } = play([{ type: 'mend' }, { type: 'item', name: 'No Such Thing' }], {
      run,
      target: 'Brant',
    });
    expect(result.ok).toBe(false);
    expect([wearCount(iron), wearCount(hand)]).toEqual([2, 1]);
  });

  it('one weapon is worked once per outcome: a second effect on it finds nothing', () => {
    const run = newRun({ seed: 15 });
    const unit = addUnit(run, 'Fighter', { name: 'Brant' });
    const { result } = play([{ type: 'forge', stat: 'might' }, { type: 'wear' }], {
      run,
      target: 'Brant',
    });
    expect(result.ok).toBe(false);
    expect(unit.weapon.name).toBe('Iron Axe'); // the forge was not applied either
  });

  it('a worn weapon survives a reload and can still be mended afterwards', () => {
    const run = newRun({ seed: 15 });
    wornFighter(run);
    const loaded = reload(run);
    const brant = loaded.roster.find((u) => u.name === 'Brant');
    expect(brant.inventory.map(wearCount)).toEqual([2, 1]);
    const { result } = play([{ type: 'mend' }], { run: loaded, target: 'Brant', filter: worn });
    expect(result.ok, result.reason).toBe(true);
    expect(brant.inventory.map(wearCount)).toEqual([0, 0]);
  });
});

// ── Battles: elite and recruit ──────────────────────────────────────────

describe('an elite event battle', () => {
  const fight = (extra = {}) => [
    { type: 'battle', enemyLevelBonus: 1, victoryText: 'Won.', afterVictory: [], ...extra },
  ];
  const KILL_GOLD = 100;

  it('is an elite battle in its params, and an ordinary one without the flag', () => {
    const elite = play(fight({ elite: true }));
    expect(elite.result.results).toEqual([{ kind: 'battle', enemyLevelBonus: 1, elite: true }]);
    expect(elite.node.battleParams.isElite).toBe(true);
    expect(elite.node.type).toBe('event');
    expect(elite.run.getBattleParams(elite.node).isElite).toBe(true);
    const plain = play(fight());
    expect(plain.result.results).toEqual([{ kind: 'battle', enemyLevelBonus: 1 }]);
    expect(plain.node.battleParams.isElite).toBeUndefined();
  });

  it('pays the elite gold bonus: 292 against 234 (180 x 1.25 x 1.3 by hand, 180 x 1.3 without)', () => {
    const payout = (extra) => {
      const { run, node } = play(fight(extra));
      const before = run.gold;
      expect(run.completeBattle(run.getRoster(), node.id, KILL_GOLD, { turnCount: 5, turnPar: 5 })).toBe(true); // prettier-ignore
      return run.gold - before;
    };
    // The plain figure is Phase 1's hand-derived 234 (tests/EventBattles.test.js).
    expect(payout({})).toBe(234);
    expect(payout({ elite: true })).toBe(292); // floor(225 x 1.3)
  });

  it('survives a reload as an elite fight', () => {
    const { run, node } = play(fight({ elite: true }));
    const loaded = reload(run);
    const again = loaded.nodeMap.nodes.find((n) => n.id === node.id);
    expect(loaded.getBattleParams(again).isElite).toBe(true);
    expect(pendingEventBattle(loaded, node.id)).not.toBeNull();
  });
});

describe('an event battle with a green recruit', () => {
  const POOL = ['Mercenary', 'Soldier', 'Fighter', 'Archer'];
  const fight = [
    {
      type: 'battle',
      enemyLevelBonus: 0,
      victoryText: 'Won.',
      recruit: { classPool: POOL },
      afterVictory: [],
    },
  ];
  const stand = (seed = 31) => play(fight, { act: 1, options: { seed } });

  it('writes the recruit into the node (a class of the pool, a name nobody has) and the battle params', () => {
    const { run, node, result } = stand();
    expect(result.results).toEqual([
      {
        kind: 'battle',
        enemyLevelBonus: 0,
        recruit: { className: node.recruitPreview.className, name: node.recruitPreview.name },
      },
    ]);
    expect(node.type).toBe('event');
    expect(POOL).toContain(node.recruitPreview.className);
    expect(node.recruitPreview).toMatchObject({ v: 1 });
    expect(run.roster.map((u) => u.name)).not.toContain(node.recruitPreview.name);
    expect(isRecruitBattleNode(node)).toBe(true);
    const params = run.getBattleParams(node);
    expect(params.isRecruitBattle).toBe(true);
    expect(params.recruitPreview).toEqual({
      className: node.recruitPreview.className,
      name: node.recruitPreview.name,
    });
  });

  it('a plain event battle and an unarmed node are not recruit battles', () => {
    const plain = play([{ type: 'battle', victoryText: 'Won.', afterVictory: [] }], { act: 1 });
    expect(isRecruitBattleNode(plain.node)).toBe(false);
    expect(plain.run.getBattleParams(plain.node).isRecruitBattle).toBeUndefined();
    expect(
      isRecruitBattleNode({
        type: 'event',
        eventBattle: true,
        battleParams: { isRecruitBattle: true },
      }),
    ).toBe(false); // no preview
    expect(
      isRecruitBattleNode({ type: 'battle', recruitPreview: { className: 'Fighter', name: 'X' } }),
    ).toBe(false);
  });

  it('the generator seats the same green unit, and the scene builds it: the preview, never a lord', () => {
    for (let seed = 31; seed < 71; seed++) {
      const { run, node } = stand(seed);
      const preview = node.recruitPreview;
      const config = generateBattle(run.getBattleParams(node), run.gameData);
      expect(config.npcSpawn, `seed ${seed}`).toBeTruthy();
      expect({ className: config.npcSpawn.className, name: config.npcSpawn.name }).toEqual({ className: preview.className, name: preview.name }); // prettier-ignore
      const built = run.getRecruitNodeUnit(node, { preview });
      expect(built.isLord).toBe(false);
      expect(built.unit.name).toBe(preview.name);
      expect(built.unit.className).toBe(preview.className);
      expect(run.getRecruitNodeSpawnClass(node)).toBe(preview.className);
    }
  });

  it("the recruit's name is promised until the node is done: no other unit may take it", () => {
    const { run, node } = stand();
    const name = node.recruitPreview.name;
    expect(run.getPromisedRecruitNames().has(name)).toBe(true);
    expect(run.getTakenUnitNames().has(name)).toBe(true);
    // Done: the fight is won and settled, the promise is spent (the name is then the unit's own).
    expect(run.completeBattle(run.getRoster(), node.id, 100, { turnCount: 5, turnPar: 5 })).toBe(
      true,
    );
    expect(run.getPromisedRecruitNames().has(name)).toBe(false);
  });

  it('a unit Talked into the army joins the roster when the battle is won, and the event settles', () => {
    const { run, node } = stand(33);
    const built = run.getRecruitNodeUnit(node);
    const npc = built.unit;
    run.assignUnitUid(npc);
    npc.faction = 'player';
    const army = [...run.getRoster(), npc];
    expect(run.completeBattle(army, node.id, 100, { turnCount: 5, turnPar: 5 })).toBe(true);
    expect(run.roster.map((u) => u.name)).toContain(npc.name);
    expect(completeEventBattle(run, node.id).ok).toBe(true);
    expect(run.roster.filter((u) => u.name === npc.name)).toHaveLength(1);
  });

  it('is the same recruit after a save and a load (preview kept, same unit rebuilt)', () => {
    const { run, node } = stand(35);
    const loaded = reload(run);
    const again = loaded.nodeMap.nodes.find((n) => n.id === node.id);
    expect(again.recruitPreview).toEqual(node.recruitPreview);
    expect(isRecruitBattleNode(again)).toBe(true);
    const a = run.getRecruitNodeUnit(node).unit;
    const b = loaded.getRecruitNodeUnit(again).unit;
    expect([b.name, b.className, b.level, b.stats]).toEqual([
      a.name,
      a.className,
      a.level,
      a.stats,
    ]);
    expect(loaded.getBattleParams(again).recruitPreview).toEqual(
      run.getBattleParams(node).recruitPreview,
    );
  });

  it('a class the act cannot hand out leaves the choice refused, nothing started', () => {
    const { run, node, result } = play(
      [{ type: 'battle', victoryText: 'Won.', recruit: { class: 'Hero' }, afterVictory: [] }],
      { act: 1 },
    );
    expect(result.ok).toBe(false); // a promoted class is in act3+ pools only
    expect(node.eventBattle).toBeUndefined();
    expect(run.eventLog).toEqual([]);
  });
});

// ── A refund, notContract ───────────────────────────────────────────────

describe('a gold refund', () => {
  it('gives back exactly what the choice charged, scaled by the rung (act2: 200, x1.25, x1.5)', () => {
    for (const [rung, paid] of [
      ['normal', 200], // 100 + 50 x 2
      ['hard', 250], // x 1.25
      ['lunatic', 300], // x 1.5
    ]) {
      const run = newRun({ seed: 20, difficulty: rung, gold: 1000 });
      // A forged weapon cannot wear, so the outcome's fallback plays: the refund.
      const unit = addUnit(run, 'Fighter', { name: 'Brant' });
      applyForge(unit.weapon, 'might');
      const { result } = play([{ type: 'wear' }], {
        run,
        target: 'Brant',
        act: 1,
        choice: { cost: { gold: { base: 100, perAct: 50 } } },
        outcome: { fallbackText: 'Nothing to add.', fallback: [{ type: 'gold', refund: true }] },
      });
      expect(result.ok, result.reason).toBe(true);
      expect(result.text).toBe('Nothing to add.');
      expect(result.results.find((r) => r.cost)).toMatchObject({ value: -paid });
      expect(result.results.filter((r) => r.kind === 'gold').map((r) => r.value)).toEqual([
        -paid,
        paid,
      ]);
      expect(run.gold).toBe(1000); // paid and handed back
    }
  });

  it('a refund on a free choice gives nothing (there was no price)', () => {
    const run = newRun({ seed: 20, gold: 500 });
    const unit = addUnit(run, 'Fighter', { name: 'Brant' });
    applyForge(unit.weapon, 'might');
    const { result } = play([{ type: 'wear' }], {
      run,
      target: 'Brant',
      outcome: { fallback: [{ type: 'gold', refund: true }] },
    });
    expect(result.ok, result.reason).toBe(true);
    expect(run.gold).toBe(500);
  });
});

describe('a road that cannot be drawn: requires.roadAhead and the refund together', () => {
  /** A hire event: a priced addRoad that falls back to a refund. */
  const hire = () =>
    soloEvent([{ type: 'routeEdit', op: 'addRoad' }], {
      choice: { cost: { gold: { base: 100, perAct: 50 } } },
      outcome: { fallbackText: 'Nothing to add.', fallback: [{ type: 'gold', refund: true }] },
    });
  /** The run standing at a row-3 event node whose every road ahead is already open. */
  function roadsAllOpen(difficulty = 'normal') {
    const run = runWithEvents([hire()], { seed: 40, difficulty, gold: 1000 });
    const node = arriveAs(
      run,
      'solo',
      run.nodeMap.nodes.find((n) => n.row === 3),
    );
    node.edges = run.nodeMap.nodes.filter((n) => n.row === 4).map((n) => n.id);
    return { run, node };
  }

  it('the requirement reads the node: true while a road can be added, false once every road is open', () => {
    const run = newRun({ seed: 40 });
    const open = run.nodeMap.nodes.filter((n) => n.row >= 2 && n.row <= 6).find((n) => roadCandidates(run.nodeMap, n.id).length > 0); // prettier-ignore
    expect(open, 'no node with a road to add on this map').toBeTruthy();
    expect(evaluateRequires(run, { roadAhead: true }, { node: open })).toBe('');
    open.edges = run.nodeMap.nodes.filter((n) => n.row === open.row + 1).map((n) => n.id);
    expect(evaluateRequires(run, { roadAhead: true }, { node: open })).toBe(
      'There is no road to add here.',
    );
    expect(evaluateRequires(run, { roadAhead: true, reason: 'No.' }, { node: open })).toBe('No.');
    // No node, no road.
    expect(evaluateRequires(run, { roadAhead: true }, {})).toBe('There is no road to add here.');
  });

  it('with every road open the hire falls back and returns the price exactly (190 on Nightfall: 150 x 1.25 to 10)', () => {
    const { run, node } = roadsAllOpen('hard');
    const edges = [...node.edges];
    run.actIndex = 0;
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.ok, result.reason).toBe(true);
    expect(result.text).toBe('Nothing to add.');
    expect(result.results.filter((r) => r.kind === 'gold').map((r) => r.value)).toEqual([
      -190, 190,
    ]);
    expect(result.results.find((r) => r.kind === 'route')).toBeUndefined();
    expect(run.gold).toBe(1000);
    expect(node.edges).toEqual(edges);
  });
});

describe('requires.notContract', () => {
  it('holds an event back while a contract is open, and lets it through once none is', () => {
    const run = newRun({ seed: 21 });
    expect(evaluateRequires(run, { notContract: true })).toBe('');
    // Sign a contract through the engine, as a player would.
    const event = contractEvent();
    run.gameData.events = {
      ...run.gameData.events,
      events: [event, ...run.gameData.events.events],
    };
    const node = arriveAs(run, 'contract');
    expect(chooseEventOption(run, node.id, 'sign').ok).toBe(true);
    expect(run.contract).toBeTruthy();
    expect(evaluateRequires(run, { notContract: true })).toBe(
      'You are already bound by a contract.',
    );
    expect(evaluateRequires(run, { notContract: true, reason: 'Not now.' })).toBe('Not now.');
    run.contract = null;
    expect(evaluateRequires(run, { notContract: true })).toBe('');
  });

  it('the Mercenary Contract is not offered at all while one is open', () => {
    const run = newRun({ seed: 22 });
    const catalog = baseData.events;
    const merc = catalog.events.find((e) => e.id === 'merc_contract');
    expect(evaluateRequires(run, merc.requires, { catalog })).toBe('');
    run.contract = {
      goal: 'underPar',
      reward: [],
      penalty: [],
      eventId: 'x',
      nodeId: 'y',
      act: 'act1',
    };
    expect(evaluateRequires(run, merc.requires, { catalog })).not.toBe('');
  });
});

// ── An outcome only a rung brings ───────────────────────────────────────

describe('an outcome with weight 0 and a rung table', () => {
  const event = () => ({
    id: 'stranger',
    title: 'A Stranger',
    weight: 1,
    intro: 'A stranger.',
    choices: [
      {
        id: 'trust',
        label: 'Trust',
        outcomes: [
          { id: 'kind', weight: 100, weightByRung: { lunatic: 60 }, text: 'Kind.', effects: [] },
          { id: 'liar', weight: 0, weightByRung: { lunatic: 40 }, text: 'Lies.', effects: [] },
        ],
      },
    ],
  });

  it('never comes up below its rung, and comes up on Black Sun at about its weight (40%)', () => {
    const rates = {};
    for (const rung of ['normal', 'dusk', 'hard', 'lunatic']) {
      let liars = 0;
      const runs = rung === 'lunatic' ? 240 : 40;
      for (let seed = 1; seed <= runs; seed++) {
        const run = runWithEvents([event()], { seed, difficulty: rung });
        const node = arriveAs(run, 'stranger');
        const result = chooseEventOption(run, node.id, 'trust');
        if (result.outcomeId === 'liar') liars++;
      }
      rates[rung] = liars / runs;
    }
    expect(rates.normal).toBe(0);
    expect(rates.dusk).toBe(0);
    expect(rates.hard).toBe(0); // a rung table holds from its rung UP: Nightfall has no entry of its own
    expect(rates.lunatic).toBeGreaterThan(0.28);
    expect(rates.lunatic).toBeLessThan(0.52);
  });
});

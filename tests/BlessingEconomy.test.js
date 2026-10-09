// Advance Pay, Quartermaster Cache, Blood Forge and Nomad's Pact (docs/specs/blessings-v3.md
// §4). Each test is named after the way the rule could realistically break.
import { describe, it, expect, afterEach } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import { addToConsumables } from '../src/engine/UnitManager.js';
import { FORGE_MAX_LEVEL, FORGE_STAT_CAP } from '../src/utils/constants.js';
import { applyForge } from '../src/engine/ForgeSystem.js';
import { raiseJoinLevel, joinLevelRng } from '../src/engine/RecruitJoinLevel.js';
import { generateBossRecruitCandidates } from '../src/engine/BossRecruitSystem.js';
import { generateMercenaryCandidates } from '../src/engine/ColosseumEngine.js';
import { prepareBossRecruit } from '../src/engine/PendingBossRecruit.js';
import { describeActStartGrants } from '../src/engine/ActStartNotice.js';
import { isSafeEventBlessing } from '../src/engine/EventSystem.js';
import { installSeed, restoreMathRandom } from '../sim/lib/SeededRNG.js';
import { loadGameData } from './testData.js';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => store[key] ?? null,
    setItem: (key, val) => {
      store[key] = String(val);
    },
    removeItem: (key) => {
      delete store[key];
    },
  },
  configurable: true,
  writable: true,
});

const data = loadGameData();

afterEach(() => {
  restoreMathRandom();
});

/** A fresh run with the given blessing taken at the shrine (no price, as a tier-1 vow). */
function runHolding(id, { seed = 7001 } = {}) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, applyBlessingsAtStart: false });
  rm.activeBlessings = [{ id, rolledCost: null }];
  rm._runStartBlessingsApplied = false;
  rm.applyRunStartBlessingEffects();
  return rm;
}

function plainRun(seed = 7001) {
  const rm = new RunManager(data);
  rm.startRun({ runSeed: seed, applyBlessingsAtStart: false });
  return rm;
}

function reload(rm) {
  return RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
}

function goldPayments(rm) {
  return rm.blessingHistory.filter(
    (e) => e.stage === 'act_transition' && e.effectType === 'act_start_gold',
  );
}

describe('Advance Pay (coin_of_fate)', () => {
  it('pays 500 at the shrine and does not pay the 250 for the act it was taken in', () => {
    const rm = plainRun();
    const base = rm.gold;
    rm.activeBlessings = [{ id: 'coin_of_fate', rolledCost: null }];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(rm.gold).toBe(base + 500);
    // The recurring part is on file, already settled for Act 1 (a second pay call is a no-op).
    expect(rm.blessingRuntimeModifiers.actStartGrants).toEqual([
      { blessingId: 'coin_of_fate', kind: 'gold', value: 250, paidActs: ['act1'] },
    ]);
    expect(rm._payActStartGrants('act_transition')).toEqual([]);
    expect(rm.gold).toBe(base + 500);
  });

  it('pays 250 as each later act begins, exactly once, the final boss act included', () => {
    const rm = runHolding('coin_of_fate');
    const acts = rm.actSequence.slice(1);
    expect(acts).toContain('finalBoss');
    for (const act of acts) {
      const before = rm.gold;
      const result = rm.advanceAct();
      expect(rm.currentAct).toBe(act);
      expect(rm.gold).toBe(before + 250);
      expect(result.actStartGrants).toHaveLength(1);
      expect(result.actStartGrants[0]).toMatchObject({ kind: 'gold', value: 250 });
      // Nothing more however often the pay step runs again in the same act.
      expect(rm._payActStartGrants('act_transition')).toEqual([]);
      expect(rm.gold).toBe(before + 250);
    }
    expect(goldPayments(rm)).toHaveLength(acts.length);
    // The last act has no successor: advancing again pays nothing and moves nothing.
    const before = rm.gold;
    expect(rm.advanceAct().actStartGrants).toEqual([]);
    expect(rm.gold).toBe(before);
  });

  it('a save loaded on the act the pay was made in does not pay it again', () => {
    const rm = runHolding('coin_of_fate');
    rm.advanceAct(); // Act 2, paid
    const gold = rm.gold;
    const restored = reload(rm);
    expect(restored.currentAct).toBe('act2');
    expect(restored.gold).toBe(gold);
    expect(restored._payActStartGrants('act_transition')).toEqual([]);
    expect(restored.gold).toBe(gold);
    // ...and the next act still pays its own 250, once.
    restored.advanceAct();
    expect(restored.gold).toBe(gold + 250);
    expect(reload(restored)._payActStartGrants('act_transition')).toEqual([]);
  });

  it('taken at a church in Act 2 pays 500 now and 250 from Act 3, not 250 for Act 2', () => {
    const rm = plainRun();
    rm.advanceAct();
    expect(rm.currentAct).toBe('act2');
    const base = rm.gold;
    expect(rm.addBlessingMidRun('coin_of_fate')).toBe(true);
    expect(rm.gold).toBe(base + 500);
    expect(rm.advanceAct().actStartGrants).toHaveLength(1);
    expect(rm.currentAct).toBe('act3');
    expect(rm.gold).toBe(base + 500 + 250);
  });

  it('the prologue never pays an act-start grant', () => {
    const rm = new RunManager(data);
    rm.startPrologue(data, data.prologue);
    rm._actStartGrantList().push({
      blessingId: 'coin_of_fate',
      kind: 'gold',
      value: 250,
      paidActs: [],
    });
    const gold = rm.gold;
    expect(rm._payActStartGrants('act_transition')).toEqual([]);
    expect(rm.gold).toBe(gold);
  });

  it('a run with no such blessing pays nothing when an act turns', () => {
    const rm = plainRun();
    const gold = rm.gold;
    expect(rm.advanceAct().actStartGrants).toEqual([]);
    expect(rm.gold).toBe(gold);
    expect(rm.takeActStartNotice()).toEqual([]);
  });

  it('a damaged saved list is dropped field by field instead of paying garbage', () => {
    const rm = runHolding('coin_of_fate');
    const json = JSON.parse(JSON.stringify(rm.toJSON()));
    json.blessingRuntimeModifiers.actStartGrants = [
      { blessingId: 'coin_of_fate', kind: 'gold', value: 250.9, paidActs: ['act1', 7, 'act1'] },
      { blessingId: 'x', kind: 'gold', value: -5, paidActs: [] },
      { blessingId: 'x', kind: 'item', itemName: '', count: 1, paidActs: [] },
      { blessingId: 'x', kind: 'mystery', value: 5 },
      'junk',
      null,
    ];
    const restored = RunManager.fromJSON(json, data);
    expect(restored.blessingRuntimeModifiers.actStartGrants).toEqual([
      { blessingId: 'coin_of_fate', kind: 'gold', value: 250, paidActs: ['act1'] },
    ]);
    // A save from before the field existed has none and loads.
    delete json.blessingRuntimeModifiers.actStartGrants;
    expect(RunManager.fromJSON(json, data).blessingRuntimeModifiers.actStartGrants).toEqual([]);
  });

  it('the act-start notice names what was paid and is shown once', () => {
    const rm = runHolding('coin_of_fate');
    rm.advanceAct();
    const notice = rm.takeActStartNotice();
    expect(describeActStartGrants(notice)).toBe('Advance Pay: +250 gold');
    expect(rm.takeActStartNotice()).toEqual([]);
  });
});

describe('Quartermaster Cache', () => {
  const elixirsIn = (rm) => rm.getConvoyItems().consumables.filter((i) => i.name === 'Elixir');

  it('delivers an Elixir at the shrine (Act 1 included) and one as each later act begins', () => {
    const rm = runHolding('quartermaster_cache');
    expect(elixirsIn(rm)).toHaveLength(1);
    for (const act of rm.actSequence.slice(1)) {
      rm.advanceAct();
      expect(rm.currentAct).toBe(act);
    }
    expect(elixirsIn(rm)).toHaveLength(rm.actSequence.length);
  });

  it('delivers a catalog Elixir with its own uid, not a shared object', () => {
    const rm = runHolding('quartermaster_cache');
    rm.advanceAct();
    const elixirs = elixirsIn(rm);
    const template = rm.getConsumableTemplate('Elixir');
    expect(elixirs).toHaveLength(2);
    for (const item of elixirs) {
      expect(item.uses).toBe(template.uses);
      expect(item.type).toBe('Consumable');
      expect(typeof item.uid).toBe('string');
    }
    expect(new Set(elixirs.map((i) => i.uid)).size).toBe(2);
  });

  it('a save loaded in the act it paid in does not deliver again', () => {
    const rm = runHolding('quartermaster_cache');
    rm.advanceAct();
    const restored = reload(rm);
    expect(restored._payActStartGrants('act_transition')).toEqual([]);
    expect(elixirsIn(restored)).toHaveLength(2);
  });

  it('a full convoy sends the Elixir to the commander, then the other lords, then anyone', () => {
    const rm = plainRun();
    const template = rm.getConsumableTemplate('Elixir');
    while (rm.addToConvoy(template)) {
      /* fill the convoy */
    }
    const edric = rm.roster.find((u) => u.name === 'Edric');
    const sera = rm.roster.find((u) => u.name === 'Sera');
    const gaspar = rm.roster.find((u) => u.name === 'Gaspar');
    rm._actStartGrantList().push({
      blessingId: 'quartermaster_cache',
      kind: 'item',
      itemName: 'Elixir',
      count: 1,
      paidActs: [],
    });
    rm._payActStartGrants('run_start');
    expect(edric.consumables.filter((i) => i.name === 'Elixir')).toHaveLength(1);
    // Edric's bag full: the next act's goes to the other lord.
    while (addToConsumables(edric, template)) {
      /* fill */
    }
    rm.advanceAct();
    expect(sera.consumables.filter((i) => i.name === 'Elixir')).toHaveLength(1);
    // Both lords full: a non-lord carries it.
    while (addToConsumables(sera, template)) {
      /* fill */
    }
    rm.advanceAct();
    expect(gaspar.consumables.filter((i) => i.name === 'Elixir')).toHaveLength(1);
  });

  it('with no room anywhere the Elixir is lost, logged as overflow, and the act counts as paid', () => {
    const rm = plainRun();
    const template = rm.getConsumableTemplate('Elixir');
    while (rm.addToConvoy(template)) {
      /* fill the convoy */
    }
    for (const unit of rm.roster)
      while (addToConsumables(unit, template)) {
        /* fill every bag */
      }
    const convoyBefore = rm.getConvoyCounts().consumables;
    rm._actStartGrantList().push({
      blessingId: 'quartermaster_cache',
      kind: 'item',
      itemName: 'Elixir',
      count: 1,
      paidActs: [],
    });
    const paid = rm._payActStartGrants('act_transition');
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ overflow: 1, toConvoy: 0, toUnits: 0 });
    expect(rm.getConvoyCounts().consumables).toBe(convoyBefore);
    expect(describeActStartGrants(paid)).toContain('no room');
    const logged = rm.blessingHistory.filter((e) => e.effectType === 'act_start_convoy_item');
    expect(logged.at(-1).details.overflow).toBe(1);
    // Paid for this act: freeing room does not make it deliver late.
    rm.convoy.consumables.length = 0;
    expect(rm._payActStartGrants('act_transition')).toEqual([]);
    expect(rm.getConvoyCounts().consumables).toBe(0);
  });

  it('taken at a church in Act 3 delivers that act’s Elixir now, once', () => {
    const rm = plainRun();
    rm.advanceAct();
    rm.advanceAct();
    expect(rm.currentAct).toBe('act3');
    expect(rm.addBlessingMidRun('quartermaster_cache')).toBe(true);
    expect(elixirsIn(rm)).toHaveLength(1);
    expect(rm._payActStartGrants('act_transition')).toEqual([]);
    rm.advanceAct();
    expect(elixirsIn(rm)).toHaveLength(2);
  });

  it('the old per-lord Elixir is gone: lords’ own bags are untouched at the shrine', () => {
    const base = plainRun();
    const rm = runHolding('quartermaster_cache');
    const names = (run) => run.roster.map((u) => u.consumables.map((c) => c.name));
    expect(names(rm)).toEqual(names(base));
  });

  it('is event-safe by boon type (a mid-run take pays the current act)', () => {
    const qc = data.blessings.blessings.find((b) => b.id === 'quartermaster_cache');
    expect(isSafeEventBlessing({ ...qc, pact: undefined })).toBe(true);
  });
});

describe('Blood Forge', () => {
  const lord = (rm, name) => rm.roster.find((u) => u.name === name);

  it('forges Edric’s Steel Sword twice, leaving the Iron Sword, Sera’s staff and the recruit alone', () => {
    const rm = plainRun();
    const gasparBefore = JSON.stringify(lord(rm, 'Gaspar').inventory);
    const ironBefore = JSON.stringify(
      lord(rm, 'Edric').inventory.find((w) => w.name === 'Iron Sword'),
    );
    rm.activeBlessings = [{ id: 'blood_forge', rolledCost: null }];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();

    const edric = lord(rm, 'Edric');
    const steel = edric.inventory.find((w) => w._baseName === 'Steel Sword');
    expect(steel.might).toBe(10);
    expect(steel._forgeLevel).toBe(2);
    expect(steel.name).toBe('Steel Sword +2');
    expect(JSON.stringify(edric.inventory.find((w) => w.name === 'Iron Sword'))).toBe(ironBefore);
    // Sera: Glimmer forged, the Heal staff not.
    const sera = lord(rm, 'Sera');
    expect(sera.inventory.find((w) => w._baseName === 'Glimmer')._forgeLevel).toBe(2);
    expect(sera.inventory.find((w) => w.name === 'Heal')._forgeLevel).toBeUndefined();
    // A non-lord's weapons are untouched.
    expect(JSON.stringify(lord(rm, 'Gaspar').inventory)).toBe(gasparBefore);
  });

  it('a starting non-lord (Gaspar) is not forged', () => {
    const rm = runHolding('blood_forge');
    const gaspar = lord(rm, 'Gaspar');
    expect(gaspar.inventory.every((w) => !w._forgeLevel)).toBe(true);
  });

  it('a recruit who really joins later (a recruit node’s unit) arrives unforged', () => {
    const rm = runHolding('blood_forge');
    const node = rm.nodeMap.nodes.find((n) => n.type === 'recruit' && n.recruitPreview);
    expect(node).toBeTruthy();
    const built = rm.getRecruitNodeUnit(node);
    expect(built.unit.inventory.length).toBeGreaterThan(0);
    expect(built.unit.inventory.every((w) => !w._forgeLevel)).toBe(true);
    expect(built.unit.weapon?._forgeLevel || 0).toBe(0);
  });

  it('forges the strongest weapon in the bag as the same object, and its price does not grow', () => {
    const rm = plainRun();
    const edric = lord(rm, 'Edric');
    // Edric starts with the Iron Sword in hand and the Steel Sword in the bag.
    const steel = edric.inventory.find((w) => w.name === 'Steel Sword');
    const basePrice = steel.price;
    rm.activeBlessings = [{ id: 'blood_forge', rolledCost: null }];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(edric.inventory).toContain(steel);
    expect(steel._forgeLevel).toBe(2);
    // The shrine gives the forge for free (applyForge `free`): resale value stays put, as
    // Smith's Mark's free forge does, so the gift cannot be sold on for gold.
    expect(steel.price).toBe(basePrice);
    expect(steel._forgeHistory.every((step) => step.cost === 0)).toBe(true);
  });

  it('forges the equipped weapon in place when it is the strongest, and it stays equipped', () => {
    const rm = plainRun();
    const edric = lord(rm, 'Edric');
    const steel = edric.inventory.find((w) => w.name === 'Steel Sword');
    edric.weapon = steel;
    rm.activeBlessings = [{ id: 'blood_forge', rolledCost: null }];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(edric.weapon).toBe(steel);
    expect(edric.weapon.might).toBe(10);
  });

  it('a tie in Might goes to the equipped weapon, then to the earlier bag slot', () => {
    const rm = plainRun();
    const edric = lord(rm, 'Edric');
    const steelA = structuredClone(edric.inventory.find((w) => w.name === 'Steel Sword'));
    const steelB = structuredClone(steelA);
    // Equipped Steel Sword in the LATER slot beats the earlier slot.
    edric.inventory = [steelA, steelB];
    edric.weapon = steelB;
    expect(rm._bestForgeableWeapon(edric, 'might')).toBe(steelB);
    // Nothing equipped is stronger: the earlier slot wins the tie.
    const iron = structuredClone(steelA);
    iron.name = 'Iron Sword';
    iron.might = 5;
    edric.inventory = [iron, steelA, steelB];
    edric.weapon = iron;
    expect(rm._bestForgeableWeapon(edric, 'might')).toBe(steelA);
  });

  it('skips a weapon already at its forge limit and forges the next best', () => {
    const rm = plainRun();
    const edric = lord(rm, 'Edric');
    const steel = edric.inventory.find((w) => w.name === 'Steel Sword');
    steel._forgeLevel = FORGE_MAX_LEVEL;
    rm.activeBlessings = [{ id: 'blood_forge', rolledCost: null }];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(steel._forgeLevel).toBe(FORGE_MAX_LEVEL);
    const iron = edric.inventory.find((w) => w._baseName === 'Iron Sword');
    expect(iron.might).toBe(7);
  });

  it('a weapon with one Might forge left takes one step, not an error or a second', () => {
    const rm = plainRun();
    const edric = lord(rm, 'Edric');
    const steel = edric.inventory.find((w) => w.name === 'Steel Sword');
    for (let i = 0; i < FORGE_STAT_CAP - 1; i++)
      expect(applyForge(steel, 'might').success).toBe(true);
    const might = steel.might;
    rm.activeBlessings = [{ id: 'blood_forge', rolledCost: null }];
    rm._runStartBlessingsApplied = false;
    rm.applyRunStartBlessingEffects();
    expect(steel.might).toBe(might + 1);
  });

  it('never picks a weapon the lord cannot wield, however strong', () => {
    const rm = plainRun();
    const edric = lord(rm, 'Edric');
    const silverLance = structuredClone(
      data.weapons.find((w) => w.type === 'Lance' && w.might > 12),
    );
    edric.inventory.push(silverLance);
    expect(rm._bestForgeableWeapon(edric, 'might')).toBe(
      edric.inventory.find((w) => w.name === 'Steel Sword'),
    );
  });

  it('a lord with no forgeable weapon is skipped without error', () => {
    const rm = plainRun();
    const sera = lord(rm, 'Sera');
    sera.inventory = sera.inventory.filter((w) => w.type === 'Staff');
    sera.weapon = sera.inventory[0];
    expect(rm._bestForgeableWeapon(sera, 'might')).toBeNull();
    rm.activeBlessings = [{ id: 'blood_forge', rolledCost: null }];
    rm._runStartBlessingsApplied = false;
    expect(() => rm.applyRunStartBlessingEffects()).not.toThrow();
  });
});

describe('Nomad’s Pact beyond recruit nodes', () => {
  /** A roster whose commander is high enough that Act 3 offers promoted recruits. */
  function bossRoster(level = 14) {
    const rm = plainRun(4242);
    for (const unit of rm.roster) unit.level = level;
    return rm.roster;
  }
  function bossDraft(seed, bonus, { actId = 'act3', roster = bossRoster() } = {}) {
    installSeed(seed);
    const candidates = generateBossRecruitCandidates(actId, roster, data, null, [], [], 4242, {
      recruitLevelBonus: bonus,
    });
    const nextRandom = Math.random();
    restoreMathRandom();
    return { candidates, nextRandom };
  }

  it('boss candidates (base, promoted and the lord) join exactly 2 levels higher, same classes and names', () => {
    const seen = { base: 0, promoted: 0, lord: 0 };
    for (let seed = 1; seed <= 60; seed++) {
      const without = bossDraft(seed, 0);
      const withPact = bossDraft(seed, 2);
      expect(withPact.candidates.map((c) => [c.className, c.displayName, c.isLord])).toEqual(
        without.candidates.map((c) => [c.className, c.displayName, c.isLord]),
      );
      // The draft consumed the shared random stream identically.
      expect(withPact.nextRandom).toBe(without.nextRandom);
      withPact.candidates.forEach((candidate, i) => {
        const plain = without.candidates[i].unit;
        const unit = candidate.unit;
        expect(unit.level).toBe(Math.min(20, plain.level + 2));
        expect(unit.currentHP).toBeLessThanOrEqual(unit.stats.HP);
        const total = (u) => Object.values(u.stats).reduce((a, b) => a + b, 0);
        expect(total(unit)).toBeGreaterThanOrEqual(total(plain) + (unit.level - plain.level));
        if (candidate.isLord) seen.lord++;
        else if (unit.tier === 'promoted') seen.promoted++;
        else seen.base++;
      });
    }
    expect(seen.base).toBeGreaterThan(0);
    expect(seen.promoted).toBeGreaterThan(0);
    expect(seen.lord).toBeGreaterThan(0);
  });

  it('a recruit never rises past its class’s level cap', () => {
    const rm = plainRun();
    const unit = structuredClone(rm.roster.find((u) => u.name === 'Gaspar'));
    unit.level = 19;
    expect(raiseJoinLevel(unit, 2, { classes: data.classes, rng: joinLevelRng(1, 'Gaspar') })).toBe(
      1,
    );
    expect(unit.level).toBe(20);
    expect(raiseJoinLevel(unit, 2, { classes: data.classes, rng: joinLevelRng(1, 'Gaspar') })).toBe(
      0,
    );
    expect(unit.level).toBe(20);
  });

  it('the same seed and name always roll the same gains, and another name rolls its own', () => {
    const rm = plainRun();
    const make = () => structuredClone(rm.roster.find((u) => u.name === 'Gaspar'));
    const a = make();
    const b = make();
    raiseJoinLevel(a, 2, { classes: data.classes, rng: joinLevelRng(99, 'Gaspar') });
    raiseJoinLevel(b, 2, { classes: data.classes, rng: joinLevelRng(99, 'Gaspar') });
    expect(a.stats).toEqual(b.stats);
    // Another name draws from its own stream: over a few seeds the gains differ somewhere
    // (one seed alone could coincide).
    let differs = false;
    for (let seed = 1; seed <= 12 && !differs; seed++) {
      const one = make();
      const other = make();
      raiseJoinLevel(one, 2, { classes: data.classes, rng: joinLevelRng(seed, 'Gaspar') });
      raiseJoinLevel(other, 2, { classes: data.classes, rng: joinLevelRng(seed, 'Bram') });
      differs = JSON.stringify(one.stats) !== JSON.stringify(other.stats);
    }
    expect(differs).toBe(true);
  });

  it('a penalty (Scholar’s Vow −1) leaves boss recruits exactly as they are', () => {
    const rm = plainRun(4242);
    for (const unit of rm.roster) unit.level = 14;
    rm.actIndex = 2; // Act 3
    const draft = (bonus) => {
      const run = reload(rm);
      run.blessingRuntimeModifiers.recruitLevelBonus = bonus;
      run.pendingBossRecruit = null;
      installSeed(31337);
      const candidates = prepareBossRecruit(run, data);
      restoreMathRandom();
      return candidates.map((c) => c.unit);
    };
    // Item uids come from a process-wide counter: compare everything but them.
    const normalize = (units) =>
      JSON.parse(
        JSON.stringify(units, (key, value) =>
          key === 'uid' || key === 'portraitVariant' ? undefined : value,
        ),
      );
    expect(normalize(draft(-1))).toEqual(normalize(draft(0)));
    const raised = draft(2);
    expect(raised.map((u) => u.name)).toEqual(draft(0).map((u) => u.name));
    expect(raised.some((u, i) => u.level > draft(0)[i].level)).toBe(true);
  });

  function mercBoard(seed, bonus, actId = 'act2', lordLevel = 6) {
    installSeed(seed);
    const board = generateMercenaryCandidates(
      actId,
      lordLevel,
      data.recruits,
      data.classes,
      data.weapons,
      data.skills,
      'normal',
      data.colosseum,
      Math.random,
      data.traits,
      [],
      null,
      { runSeed: 4242 },
      { recruitLevelBonus: bonus },
    );
    const nextRandom = Math.random();
    restoreMathRandom();
    return { board, nextRandom };
  }

  it('mercenaries join 2 levels higher with identical classes, names, prices and kit', () => {
    let promoted = 0;
    let base = 0;
    // Act 3 at a low lord level puts the +2 across the weapon-tier line (level 6): the kit
    // must still be the one the unraised level bought.
    for (const [actId, lordLevel] of [
      ['act2', 6],
      ['act3', 4],
    ]) {
      for (let seed = 1; seed <= 40; seed++) {
        const without = mercBoard(seed, 0, actId, lordLevel);
        const withPact = mercBoard(seed, 2, actId, lordLevel);
        expect(withPact.nextRandom).toBe(without.nextRandom);
        expect(withPact.board.map((c) => [c.unit.className, c.unit.name, c.hireCost])).toEqual(
          without.board.map((c) => [c.unit.className, c.unit.name, c.hireCost]),
        );
        withPact.board.forEach((candidate, i) => {
          const plain = without.board[i].unit;
          expect(candidate.unit.level).toBe(Math.min(20, plain.level + 2));
          // Equipment tier reads the level before the bonus.
          expect(candidate.unit.weapon?.name).toBe(plain.weapon?.name);
          expect(candidate.unit.currentHP).toBeLessThanOrEqual(candidate.unit.stats.HP);
          if (candidate.unit.tier === 'promoted') promoted++;
          else base++;
        });
      }
    }
    expect(promoted).toBeGreaterThan(0);
    expect(base).toBeGreaterThan(0);
  });

  it('a mercenary board with no bonus (or an invalid one) is unchanged', () => {
    for (const bonus of [0, undefined, -1, Number.NaN]) {
      const plain = mercBoard(5, 0);
      const other = mercBoard(5, bonus);
      expect(JSON.stringify(other.board)).toBe(JSON.stringify(plain.board));
    }
  });
});

describe('the data rows', () => {
  const index = new Map(data.blessings.blessings.map((b) => [b.id, b]));

  it('keep their ids and tiers and carry the new cards', () => {
    expect(index.get('coin_of_fate')).toMatchObject({ name: 'Advance Pay', tier: 1 });
    expect(index.get('coin_of_fate').boons).toEqual([
      { type: 'gold_delta', params: { value: 500 } },
      { type: 'act_start_gold', params: { value: 250 } },
    ]);
    expect(index.get('quartermaster_cache').boons).toEqual([
      { type: 'act_start_convoy_item', params: { itemName: 'Elixir', count: 1 } },
    ]);
    expect(index.get('blood_forge').boons).toEqual([
      { type: 'starting_best_weapon_forge', params: { stat: 'might', value: 2 } },
    ]);
    expect(index.get('nomad_pact').boons).toEqual([
      { type: 'recruit_level_bonus', params: { value: 2 } },
    ]);
    expect(index.get('nomad_pact').description).toMatch(/boss recruits and mercenaries/);
  });

  it('Advance Pay is not an event-safe blessing (gold is the events’ own currency)', () => {
    expect(isSafeEventBlessing(index.get('coin_of_fate'))).toBe(false);
  });
});

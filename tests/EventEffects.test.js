// EventEffects through the command API: what each effect type does to a real run
// (docs/specs/event-nodes.md §5), and the plan-then-apply rule.
//
// Ways an effect goes wrong:
//   gold      a loss that drives gold below 0, or is not reported at its true size
//   item      a Legend, Rare, signature, scroll, staff or per-battle weapon; the wrong tier for the
//             act; an item that lands in a full bag or is lost when the convoy is full; wear
//             that is not applied or hits a stat the weapon cannot wear
//   skill     a skill the unit already knows, a lord's personal skill, a skill lost at the
//             five-skill cap instead of benched, the wrong pool for the unit's weapon
//   hp        a hit that kills, a heal past max, the wrong scope, a number rounded the wrong way
//   shadow    only one of the two meters moving, a fall that never happens, a change while the
//             Eclipse is off
//   blessing  an unsafe boon (a run-start grant) or one the run already holds
//   burden    a stack instead of a merge; owed taken from the wrong act
//   layToRest a unit that can still be revived, or whose name is free again
//   consume   the wrong holder, an emptied item left in the bag
//   stat      the wrong unit, a stat other than the ones named
//   plan      an effect applied although a later one fails; a second choice allowed; a state
//             that changes when the apply throws
// Expected numbers are worked out by hand from the units' stats in the comments.
import { describe, expect, it, vi } from 'vitest';
import {
  arriveAtEvent,
  chooseEventOption,
  eventChoiceBlock,
  eventState,
  eventView,
} from '../src/engine/EventCommands.js';
import { EVENT_WEAPON_TYPES, isEventWeapon, lootWeaponNames } from '../src/engine/EventEffects.js';
import { reviveAtChurch, churchReviveBlock } from '../src/engine/ChurchCommands.js';
import { nodeFallThreshold } from '../src/engine/EclipseSystem.js';
import { knowsSkill } from '../src/engine/UnitManager.js';
import { flagValue } from '../src/engine/EventSystem.js';
import { wearCount } from '../src/engine/WeaponWear.js';
import {
  addUnit,
  arriveAs,
  baseData,
  eventNode,
  fallAlly,
  hpByName,
  newRun,
  runWithEvents,
  soloEvent,
} from './eventKit.js';

/** Run a one-choice event made of `effects` and return { run, node, result }. */
function play(
  effects,
  { run = null, targetName = null, choice = {}, outcome = {}, options = {} } = {},
) {
  const event = soloEvent(effects, { choice, outcome });
  const r = run || runWithEvents([event], options);
  if (run) r.gameData.events.events.unshift(event);
  const node = arriveAs(r, 'solo');
  const target = targetName ? r.roster.find((u) => u.name === targetName) : null;
  const result = chooseEventOption(r, node.id, 'go', { targetUid: target?.unitUid || null });
  return { run: r, node, result };
}

const withTarget = { choice: { target: { prompt: 'Who?', filter: {} } } };

describe('gold', () => {
  it('adds a fixed amount and reports it', () => {
    const { run, result } = play([{ type: 'gold', value: 80 }]);
    expect(run.gold).toBe(280); // the run starts with 200
    expect(result.results).toEqual([{ kind: 'gold', value: 80, requested: 80 }]);
  });

  it('scales { base, perAct } by the act (act2: 100 + 2 x 100 = 300)', () => {
    const run = runWithEvents([soloEvent([{ type: 'gold', value: { base: 100, perAct: 100 } }])]);
    run.actIndex = 1;
    const node = arriveAs(
      run,
      'solo',
      run.nodeMap.nodes.find((n) => n.row === 3),
    );
    chooseEventOption(run, node.id, 'go');
    expect(run.gold).toBe(500);
  });

  it('a loss never takes gold below 0 and reports what it took', () => {
    const run = runWithEvents([soloEvent([{ type: 'gold', value: { base: -50, perAct: -50 } }])], {
      gold: 30,
    });
    const node = arriveAs(run, 'solo');
    const result = chooseEventOption(run, node.id, 'go');
    expect(run.gold).toBe(0);
    // act1: -50 - 50 = -100 asked, only 30 there
    expect(result.results[0]).toEqual({ kind: 'gold', value: -30, requested: -100 });
  });

  it('a cost is paid up front whatever the outcome (the coin is gone anyway)', () => {
    const { run, result } = play([], { choice: { cost: { gold: { base: 100, perAct: 100 } } } });
    expect(run.gold).toBe(0); // 200 - 200
    expect(result.results[0]).toMatchObject({ kind: 'gold', value: -200, cost: true });
  });

  it('a cost the army cannot pay is refused with nothing taken', () => {
    const run = runWithEvents([soloEvent([], { choice: { cost: { gold: 500 } } })]);
    const node = arriveAs(run, 'solo');
    expect(eventChoiceBlock(run, node.id, 'go')).toBe('Not enough gold.');
    const result = chooseEventOption(run, node.id, 'go');
    expect(result).toEqual({ ok: false, reason: 'Not enough gold.' });
    expect(run.gold).toBe(200);
  });

  it('costs follow costScale: 200 becomes 250 on Nightfall and 300 on Black Sun', () => {
    for (const [difficulty, paid] of [
      ['normal', 200],
      ['dusk', 200],
      ['hard', 250],
      ['lunatic', 300],
    ]) {
      const run = runWithEvents(
        [soloEvent([], { choice: { cost: { gold: { base: 100, perAct: 100 } } } })],
        {
          difficulty,
          gold: 1000,
        },
      );
      const node = arriveAs(run, 'solo');
      chooseEventOption(run, node.id, 'go');
      expect(1000 - run.gold, difficulty).toBe(paid);
    }
  });
});

describe('item', () => {
  const armyPool = (tierOffset = 0, extra = {}) => ({
    type: 'item',
    pool: { kind: 'weapon', weaponTypes: '$army', tierOffset },
    to: 'auto',
    ...extra,
  });

  it('draws only event weapons: never Legend, Rare, signature, scroll, staff or per-battle', () => {
    const lootNames = lootWeaponNames(baseData.lootTables);
    const seen = new Set();
    for (const act of [0, 1, 2, 3]) {
      for (const offset of [0, 1, 2]) {
        for (let seed = 1; seed <= 25; seed++) {
          const run = runWithEvents([soloEvent([armyPool(offset)])], { seed });
          run.actSequence = ['act1', 'act2', 'act3', 'act4'];
          run.actIndex = act;
          const node = arriveAs(
            run,
            'solo',
            run.nodeMap.nodes.find((n) => n.row === 3),
          );
          const res = chooseEventOption(run, node.id, 'go');
          expect(res.ok, res.reason).toBe(true);
          const item = res.results.find((r) => r.kind === 'item');
          const weapon = baseData.weapons.find((w) => w.name === item.name);
          expect(isEventWeapon(weapon, lootNames), item.name).toBe(true);
          expect(['Legend', 'Rare']).not.toContain(weapon.tier);
          expect(weapon.signatureOf).toBeUndefined();
          expect(['Scroll', 'Staff', 'Consumable', 'Breath']).not.toContain(weapon.type);
          expect(weapon.perBattleUses).toBeFalsy();
          expect(EVENT_WEAPON_TYPES).toContain(weapon.type);
          seen.add(`${act}:${offset}:${weapon.tier}`);
        }
      }
    }
    // The tier: act baseline (Iron, Steel, Silver, Silver) plus the offset, capped at Silver.
    const tiersOf = (act, offset) =>
      [...seen].filter((s) => s.startsWith(`${act}:${offset}:`)).map((s) => s.split(':')[2]);
    expect(tiersOf(0, 0)).toEqual(['Iron']);
    expect(tiersOf(0, 1)).toEqual(['Steel']);
    expect(tiersOf(1, 0)).toEqual(['Steel']);
    expect(tiersOf(1, 1)).toEqual(['Silver']);
    expect(tiersOf(2, 0)).toEqual(['Silver']);
    expect(tiersOf(2, 1)).toEqual(['Silver']); // capped: never Legend
    expect(tiersOf(3, 2)).toEqual(['Silver']);
  });

  it('a $target pool gives only what the target can wield (Sera: Light)', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { run, result } = play(
        [
          {
            type: 'item',
            pool: { kind: 'weapon', weaponTypes: '$target', tierOffset: 1 },
            to: 'target',
          },
        ],
        { ...withTarget, targetName: 'Sera', options: { seed } },
      );
      expect(result.ok, result.reason).toBe(true);
      const item = result.results[0];
      expect(baseData.weapons.find((w) => w.name === item.name).type).toBe('Light');
      expect(item.unit).toBe('Sera');
      expect(
        run.roster.find((u) => u.name === 'Sera').inventory.some((w) => w.name === item.name),
      ).toBe(true);
    }
  });

  it('auto delivery: the target first, then the commander, then anyone who can use it, then the convoy', () => {
    const find = (run, name) => run.roster.find((u) => u.name === name);
    // Target (Gaspar, who can wield swords and lances) takes it.
    const first = play(
      [
        {
          type: 'item',
          pool: { kind: 'weapon', weaponTypes: ['Sword'], tierOffset: 0 },
          to: 'auto',
        },
      ],
      { ...withTarget, targetName: 'Gaspar' },
    );
    expect(first.result.results[0].unit).toBe('Gaspar');
    // Target's bag is full: the commander takes it.
    let run = runWithEvents([
      soloEvent(
        [
          {
            type: 'item',
            pool: { kind: 'weapon', weaponTypes: ['Sword'], tierOffset: 0 },
            to: 'auto',
          },
        ],
        withTarget,
      ),
    ]);
    const gaspar = find(run, 'Gaspar');
    while (gaspar.inventory.length < 5) gaspar.inventory.push(structuredClone(gaspar.inventory[0]));
    let node = arriveAs(run, 'solo');
    let result = chooseEventOption(run, node.id, 'go', { targetUid: gaspar.unitUid });
    expect(result.results[0].unit).toBe('Edric');
    // The commander is full too: Sera cannot wield a sword, so nobody on the roster can use
    // it: it goes to the convoy.
    run = runWithEvents([
      soloEvent(
        [
          {
            type: 'item',
            pool: { kind: 'weapon', weaponTypes: ['Sword'], tierOffset: 0 },
            to: 'auto',
          },
        ],
        withTarget,
      ),
    ]);
    for (const name of ['Gaspar', 'Edric']) {
      const unit = find(run, name);
      while (unit.inventory.length < 5) unit.inventory.push(structuredClone(unit.inventory[0]));
    }
    node = arriveAs(run, 'solo');
    result = chooseEventOption(run, node.id, 'go', { targetUid: find(run, 'Gaspar').unitUid });
    expect(result.results[0]).toMatchObject({ unit: null, toConvoy: true });
    expect(run.convoy.weapons.length).toBe(1);
  });

  it('to: target goes to the convoy when the target is full; to: convoy always goes there', () => {
    const effect = {
      type: 'item',
      pool: { kind: 'weapon', weaponTypes: ['Sword'], tierOffset: 0 },
      to: 'target',
    };
    const direct = play([effect], { ...withTarget, targetName: 'Edric' });
    expect(direct.result.results[0].unit).toBe('Edric');
    const full = runWithEvents([soloEvent([effect], withTarget)]);
    const edric = full.roster.find((u) => u.name === 'Edric');
    while (edric.inventory.length < 5) edric.inventory.push(structuredClone(edric.inventory[0]));
    const node = arriveAs(full, 'solo');
    const overflow = chooseEventOption(full, node.id, 'go', { targetUid: edric.unitUid });
    expect(overflow.results[0]).toMatchObject({ unit: null, toConvoy: true });
    const { run, result } = play([{ ...effect, to: 'convoy' }], {
      ...withTarget,
      targetName: 'Edric',
    });
    expect(result.results[0].toConvoy).toBe(true);
    // Nothing was added to Edric's own bag.
    expect(run.roster.find((u) => u.name === 'Edric').inventory.length).toBe(
      newRun().roster.find((u) => u.name === 'Edric').inventory.length,
    );
  });

  it('a named consumable is delivered as the run acquires it (a Vulnerary has 2 uses)', () => {
    const { run, result } = play([{ type: 'item', name: 'Vulnerary', to: 'target' }], {
      ...withTarget,
      targetName: 'Edric',
    });
    expect(result.ok).toBe(true);
    const bag = run.roster.find((u) => u.name === 'Edric').consumables;
    expect(bag.at(-1)).toMatchObject({ name: 'Vulnerary', uses: 2 });
  });

  it('wear: n steps are applied to wearable stats and the weapon says so', () => {
    const { run, result } = play([armyPool(1, { wear: 2 })]);
    const item = result.results[0];
    expect(item.worn).toHaveLength(2);
    for (const stat of item.worn) expect(['might', 'hit', 'crit', 'weight']).toContain(stat);
    const holder = item.unit ? run.roster.find((u) => u.name === item.unit) : null;
    const weapon = (holder ? holder.inventory : run.convoy.weapons).find((w) =>
      w.name.includes('-2'),
    );
    expect(weapon).toBeTruthy();
    expect(wearCount(weapon)).toBe(2);
    expect(weapon.name).toMatch(/ -2$/);
  });

  it('wear is seeded: the same run seed wears the same stats', () => {
    const wearOf = (seed) =>
      play([armyPool(1, { wear: 3 })], { options: { seed } }).result.results[0].worn;
    expect(wearOf(31)).toEqual(wearOf(31));
    const spread = new Set();
    for (let seed = 1; seed <= 20; seed++) spread.add(wearOf(seed).join());
    expect(spread.size).toBeGreaterThan(3);
  });

  it('a choice that may grant an item is blocked when nowhere can carry one', () => {
    const WEAPON_LINE = 'No room for another weapon. Make room in a bag or the convoy.';
    const run = runWithEvents([soloEvent([armyPool()], { id: 'solo' })]);
    const node = arriveAs(run, 'solo');
    expect(eventChoiceBlock(run, node.id, 'go')).toBe('');
    // Weapon bags and the weapon convoy full, consumable space everywhere: still no place for
    // a weapon (free consumable slots are not weapon slots), and the commit would fail alike.
    for (const unit of run.roster) {
      while (unit.inventory.length < 5)
        unit.inventory.push(structuredClone(unit.inventory[0] || run.gameData.weapons[0]));
    }
    const caps = run.getConvoyCapacities();
    run.convoy.weapons = Array.from({ length: caps.weapons }, () =>
      structuredClone(run.gameData.weapons[0]),
    );
    expect(run.roster.some((u) => u.consumables.length < 3)).toBe(true);
    expect(run.getConvoyCounts().consumables).toBeLessThan(caps.consumables);
    expect(eventChoiceBlock(run, node.id, 'go')).toBe(WEAPON_LINE);
    expect(chooseEventOption(run, node.id, 'go')).toEqual({ ok: false, reason: WEAPON_LINE });
    // Both bag kinds and both convoy compartments full: the same answer.
    for (const unit of run.roster)
      while (unit.consumables.length < 3)
        unit.consumables.push(run.getConsumableTemplate('Vulnerary'));
    run.convoy.consumables = Array.from({ length: caps.consumables }, () =>
      run.getConsumableTemplate('Vulnerary'),
    );
    expect(eventChoiceBlock(run, node.id, 'go')).toBe(WEAPON_LINE);
    // One free place in the weapon convoy and the choice is open again.
    run.convoy.weapons.pop();
    expect(eventChoiceBlock(run, node.id, 'go')).toBe('');
    // A choice that cannot grant an item is never blocked for room.
    const quiet = runWithEvents([soloEvent([{ type: 'flag', key: 'k', value: true }])]);
    const quietNode = arriveAs(quiet, 'solo');
    for (const unit of quiet.roster)
      while (unit.inventory.length < 5) unit.inventory.push(structuredClone(unit.inventory[0]));
    expect(eventChoiceBlock(quiet, quietNode.id, 'go')).toBe('');
  });
});

describe('learnSkill and fallenSkill', () => {
  const learn = (extra) => ({ type: 'learnSkill', to: 'target', ...extra });
  const fallback = [{ type: 'flag', key: 'fell_through', value: true }];

  it('teaches a named skill to the target', () => {
    const { run, result } = play([learn({ skillId: 'vantage' })], {
      ...withTarget,
      targetName: 'Edric',
      outcome: { fallback },
    });
    expect(result.results).toEqual([
      { kind: 'skill', unit: 'Edric', skillId: 'vantage', benched: false },
    ]);
    expect(run.roster.find((u) => u.name === 'Edric').skills).toContain('vantage');
  });

  it('a pool never repeats a skill the unit already knows', () => {
    const run = runWithEvents([
      soloEvent([learn({ pool: ['vantage', 'wrath'] })], {
        choice: withTarget.choice,
        outcome: { fallback },
      }),
    ]);
    const edric = run.roster.find((u) => u.name === 'Edric');
    edric.skills = [...edric.skills, 'vantage'];
    const node = arriveAs(run, 'solo');
    const result = chooseEventOption(run, node.id, 'go', { targetUid: edric.unitUid });
    expect(result.results[0].skillId).toBe('wrath');
  });

  it('at the skill cap the skill is benched, not lost, and reported benched', () => {
    const run = runWithEvents([
      soloEvent([learn({ skillId: 'wrath' })], {
        choice: withTarget.choice,
        outcome: { fallback },
      }),
    ]);
    const edric = run.roster.find((u) => u.name === 'Edric');
    edric.skills = ['guard', 'pavise', 'vantage', 'cancel', 'adept'];
    expect(edric.skills).toHaveLength(5);
    const node = arriveAs(run, 'solo');
    const result = chooseEventOption(run, node.id, 'go', { targetUid: edric.unitUid });
    expect(result.results[0]).toEqual({
      kind: 'skill',
      unit: 'Edric',
      skillId: 'wrath',
      benched: true,
    });
    expect(edric.skills).toHaveLength(5);
    expect(edric.benchedSkills).toContain('wrath');
    expect(knowsSkill(edric, 'wrath')).toBe(true);
  });

  it('poolByType follows the unit: a Mastery lancer learns from the lance pool, a swordsman from the sword pool', () => {
    const effect = learn({ poolByType: { Sword: ['vantage'], Lance: ['guard'], Axe: ['wrath'] } });
    const guard = play([effect], { ...withTarget, targetName: 'Gaspar', outcome: { fallback } });
    expect(guard.result.results[0].skillId).toBe('guard'); // Gaspar: Lance Mast beats Sword Mast by wielding Steel Lance
    const vantage = play([effect], { ...withTarget, targetName: 'Edric', outcome: { fallback } });
    expect(vantage.result.results[0].skillId).toBe('vantage');
  });

  it('an empty pool falls through to the outcome fallback (and its text)', () => {
    const run = runWithEvents([
      soloEvent([learn({ skillId: 'vantage' }), { type: 'gold', value: 999 }], {
        choice: withTarget.choice,
        outcome: { fallback, fallbackText: 'Nothing left to show you.' },
      }),
    ]);
    const edric = run.roster.find((u) => u.name === 'Edric');
    edric.skills = [...edric.skills, 'vantage'];
    const node = arriveAs(run, 'solo');
    const result = chooseEventOption(run, node.id, 'go', { targetUid: edric.unitUid });
    expect(result.ok).toBe(true);
    expect(result.text).toBe('Nothing left to show you.');
    expect(flagValue(run.storyFlags, 'fell_through')).toBe(true);
    expect(run.gold).toBe(200); // the outcome's own effects did not run
  });

  it('is seeded: a fresh run with the same seed teaches the same skill', () => {
    const pick = (seed) =>
      play([learn({ pool: ['vantage', 'wrath', 'guard', 'cancel'] })], {
        ...withTarget,
        targetName: 'Edric',
        outcome: { fallback },
        options: { seed },
      }).result.results[0].skillId;
    expect(pick(77)).toBe(pick(77));
    expect(new Set([1, 2, 3, 4, 5, 6, 7, 8].map(pick)).size).toBeGreaterThan(1);
  });

  it("fallenSkill teaches one of the named fallen ally's skills, never a personal one, then layToRest", () => {
    const run = runWithEvents([
      {
        ...soloEvent([{ type: 'fallenSkill', to: 'target' }, { type: 'layToRest' }], {
          requires: { fallen: true },
          choice: { target: { prompt: 'Who?', filter: { living: true, learnsFromFallen: true } } },
        }),
        id: 'the_echo',
      },
    ]);
    const lancer = addUnit(run, 'Cavalier', { name: 'Brant' });
    lancer.skills = ['pavise', 'charisma', 'wrath'];
    fallAlly(run, lancer);
    const node = arriveAs(run, 'the_echo');
    const edric = run.roster.find((u) => u.name === 'Edric');
    run.eventStateByNodeId[node.id].fallen = { unitUid: lancer.unitUid, name: 'Brant' };
    // Edric already knows wrath: only pavise is left to teach (charisma is personal).
    edric.skills = [...edric.skills, 'wrath'];
    const result = chooseEventOption(run, node.id, 'go', { targetUid: edric.unitUid });
    expect(result.ok, result.reason).toBe(true);
    expect(result.results[0]).toEqual({
      kind: 'skill',
      unit: 'Edric',
      skillId: 'pavise',
      benched: false,
      from: 'Brant',
    });
    expect(result.results[1]).toEqual({ kind: 'layToRest', name: 'Brant' });
  });
});

describe('hp', () => {
  // Edric 20 HP, Sera 18, Gaspar 18 (full).
  const hp = (extra) => ({ type: 'hp', ...extra });

  it('damage 30% of max to the target: 30% of 20 = 6', () => {
    const { run, result } = play([hp({ mode: 'damage', percent: 30, scope: 'target' })], {
      ...withTarget,
      targetName: 'Edric',
    });
    expect(run.roster.find((u) => u.name === 'Edric').currentHP).toBe(14);
    expect(result.results[0]).toMatchObject({
      kind: 'hp',
      mode: 'damage',
      total: 6,
      units: [{ name: 'Edric', amount: 6 }],
    });
  });

  it('damage never kills: even 100% to all leaves everyone at 1 HP', () => {
    const { run } = play([hp({ mode: 'damage', percent: 100, scope: 'all' })]);
    expect(hpByName(run)).toEqual({ Edric: 1, Sera: 1, Gaspar: 1 });
    // And a unit already at 1 loses nothing more.
    const again = play([hp({ mode: 'damage', percent: 50, scope: 'all' })], { run });
    expect(again.result.results[0].total).toBe(0);
    expect(hpByName(run)).toEqual({ Edric: 1, Sera: 1, Gaspar: 1 });
  });

  it('to: 1 takes a unit down to exactly 1 HP', () => {
    const { run } = play([hp({ mode: 'damage', to: 1, scope: 'target' })], {
      ...withTarget,
      targetName: 'Gaspar',
    });
    expect(run.roster.find((u) => u.name === 'Gaspar').currentHP).toBe(1);
  });

  it('heal 20% to all: 4 of 20, 4 of 18 (3.6 rounds up), capped at max', () => {
    const run = runWithEvents([soloEvent([hp({ mode: 'heal', percent: 20, scope: 'all' })])]);
    run.roster[0].currentHP = 10; // Edric 10/20 -> 14
    run.roster[1].currentHP = 17; // Sera 17/18 -> 18 (+1 only)
    run.roster[2].currentHP = 1; // Gaspar 1/18 -> 5
    const node = arriveAs(run, 'solo');
    const result = chooseEventOption(run, node.id, 'go');
    expect(hpByName(run)).toEqual({ Edric: 14, Sera: 18, Gaspar: 5 });
    expect(result.results[0].total).toBe(4 + 1 + 4);
  });

  it('scope commander hits only the commander; randomUnit picks one unit, the same every time', () => {
    const { run } = play([hp({ mode: 'damage', percent: 40, scope: 'commander' })]);
    expect(hpByName(run)).toEqual({ Edric: 12, Sera: 18, Gaspar: 18 }); // 40% of 20 = 8
    const one = (seed) => {
      const r = play([hp({ mode: 'damage', percent: 50, scope: 'randomUnit' })], {
        options: { seed },
      }).run;
      return r.roster.filter((u) => u.currentHP < u.stats.HP).map((u) => u.name);
    };
    expect(one(5)).toHaveLength(1);
    expect(one(5)).toEqual(one(5));
  });

  it('percentByRung: 20% on First Light, 30% on Nightfall and Black Sun (of 20 HP: 4 and 6)', () => {
    const lost = (difficulty) => {
      const run = runWithEvents(
        [
          soloEvent(
            [hp({ mode: 'damage', percent: 20, percentByRung: { hard: 30 }, scope: 'target' })],
            withTarget,
          ),
        ],
        { difficulty },
      );
      const node = arriveAs(run, 'solo');
      const edric = run.roster.find((u) => u.name === 'Edric');
      chooseEventOption(run, node.id, 'go', { targetUid: edric.unitUid });
      return 20 - edric.currentHP;
    };
    expect(lost('normal')).toBe(4);
    expect(lost('dusk')).toBe(4);
    expect(lost('hard')).toBe(6);
    expect(lost('lunatic')).toBe(6);
  });

  it('goes through UnitHealth: taking the HP a unit owes settles an accessory debt', () => {
    const run = runWithEvents([soloEvent([hp({ mode: 'heal', percent: 100, scope: 'all' })])]);
    run.roster[0].currentHP = 5;
    run.roster[0]._accessoryHpOwed = 2;
    const node = arriveAs(run, 'solo');
    chooseEventOption(run, node.id, 'go');
    expect(run.roster[0].currentHP).toBe(20);
    expect(run.roster[0]._accessoryHpOwed).toBeUndefined(); // full HP forgives the debt
  });
});

describe('shadow', () => {
  const shadow = (value) => ({ type: 'shadow', value });

  it('gain raises both the meter and the act pressure', () => {
    const { run, result } = play([shadow(3)]);
    expect(run.eclipse.shadow).toBe(3);
    expect(run.eclipse.actShadow).toBe(3);
    expect(result.results[0]).toMatchObject({
      kind: 'shadow',
      value: 3,
      actValue: 3,
      requested: 3,
    });
  });

  it('relief lowers both and floors at 0 (like Kindle)', () => {
    const run = runWithEvents([soloEvent([shadow(-4)])]);
    run.eclipse = { ...run.eclipse, shadow: 10, actShadow: 6 };
    const node = arriveAs(run, 'solo');
    chooseEventOption(run, node.id, 'go');
    expect(run.eclipse.shadow).toBe(6);
    expect(run.eclipse.actShadow).toBe(2);
    const floored = runWithEvents([soloEvent([shadow(-4)])]);
    floored.eclipse = { ...floored.eclipse, shadow: 1, actShadow: 2 };
    chooseEventOption(floored, arriveAs(floored, 'solo').id, 'go');
    expect(floored.eclipse.shadow).toBe(0);
    expect(floored.eclipse.actShadow).toBe(0);
  });

  it('the meter stops at the cap, the act pressure does not', () => {
    const run = runWithEvents([soloEvent([shadow(3)])]);
    run.eclipse = { ...run.eclipse, shadow: 99, actShadow: 10 };
    const node = arriveAs(run, 'solo');
    const result = chooseEventOption(run, node.id, 'go');
    expect(run.eclipse.shadow).toBe(100);
    expect(run.eclipse.actShadow).toBe(13);
    expect(result.results[0]).toMatchObject({ value: 1, actValue: 3, requested: 3 });
  });

  it('the dark takes what the new pressure reaches (and never the event itself)', () => {
    const run = runWithEvents([soloEvent([shadow(3)])]);
    const node = arriveAs(run, 'solo');
    // A fallable node whose threshold the gain will just cross.
    const rows = run.nodeMap.nodes.length
      ? Math.max(...run.nodeMap.nodes.map((n) => n.row)) + 1
      : 0;
    const victim = run.nodeMap.nodes
      .filter(
        (n) =>
          n.id !== node.id &&
          !n.completed &&
          n.type === 'battle' &&
          n.row >= 2 &&
          n.id !== run.nodeMap.startNodeId,
      )
      .sort(
        (a, b) =>
          nodeFallThreshold(a, { runSeed: run.runSeed, rows, config: run.getEclipseConfig() }) -
          nodeFallThreshold(b, { runSeed: run.runSeed, rows, config: run.getEclipseConfig() }),
      )[0];
    const threshold = nodeFallThreshold(victim, {
      runSeed: run.runSeed,
      rows,
      config: run.getEclipseConfig(),
    });
    run.eclipse = { ...run.eclipse, actShadow: threshold - 1 };
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.results[0].fell).toContain(victim.id);
    expect(victim.eclipse).toBeTruthy();
    expect(run.nodeMap.nodes.find((n) => n.id === node.id).type).toBe('event');
    expect(run.nodeMap.nodes.find((n) => n.id === node.id).eclipse).toBeUndefined();
  });

  it('with the Eclipse off it does nothing', () => {
    const run = runWithEvents([soloEvent([shadow(3)])]);
    run.eclipse = { ...run.eclipse, enabled: false };
    const node = arriveAs(run, 'solo');
    const result = chooseEventOption(run, node.id, 'go');
    expect(run.eclipse.shadow).toBe(0);
    expect(run.eclipse.actShadow).toBe(0);
    expect(result.results[0]).toMatchObject({ kind: 'shadow', value: 0, requested: 3 });
  });
});

describe('vision, flag, stat', () => {
  it('vision adds a charge and floors a loss at 0', () => {
    const { run } = play([{ type: 'vision', value: 1 }]);
    expect(run.visionChargesRemaining).toBe(2); // the run starts with 1
    const lost = play([{ type: 'vision', value: -3 }]);
    expect(lost.run.visionChargesRemaining).toBe(0);
    expect(lost.result.results[0].value).toBe(-1);
  });

  it('flag stores string, number and boolean values', () => {
    const { run } = play([
      { type: 'flag', key: 'a', value: true },
      { type: 'flag', key: 'b', value: 3 },
      { type: 'flag', key: 'c', value: 'x' },
    ]);
    // New writes carry the act they were set in ({ value, act }); readers see the value.
    expect(run.storyFlags).toEqual({
      a: { value: true, act: 'act1' },
      b: { value: 3, act: 'act1' },
      c: { value: 'x', act: 'act1' },
    });
    expect(['a', 'b', 'c'].map((key) => flagValue(run.storyFlags, key))).toEqual([true, 3, 'x']);
  });

  it('stat lowestLevel boosts the lowest-level unit (ties: lowest XP) by exactly the stat asked', () => {
    const run = runWithEvents([
      soloEvent([{ type: 'stat', stat: ['SKL', 'SPD'], value: 1, scope: 'lowestLevel' }]),
    ]);
    const [edric, sera, gaspar] = run.roster;
    edric.level = 3;
    sera.level = 2;
    sera.xp = 10;
    gaspar.level = 2;
    gaspar.xp = 4; // lowest level 2, lowest xp 4: Gaspar
    const before = { SKL: gaspar.stats.SKL, SPD: gaspar.stats.SPD, edricSKL: edric.stats.SKL };
    const node = arriveAs(run, 'solo');
    const result = chooseEventOption(run, node.id, 'go');
    const { stat, unit } = result.results[0];
    expect(unit).toBe('Gaspar');
    expect(['SKL', 'SPD']).toContain(stat);
    expect(gaspar.stats[stat]).toBe(before[stat] + 1);
    expect(gaspar.stats[stat === 'SKL' ? 'SPD' : 'SKL']).toBe(
      before[stat === 'SKL' ? 'SPD' : 'SKL'],
    );
    expect(edric.stats.SKL).toBe(before.edricSKL);
  });

  it('stat to the target raises that unit only', () => {
    const { run } = play([{ type: 'stat', stat: 'DEF', value: 2, scope: 'target' }], {
      ...withTarget,
      targetName: 'Sera',
    });
    const sera = run.roster.find((u) => u.name === 'Sera');
    const fresh = newRun().roster.find((u) => u.name === 'Sera');
    expect(sera.stats.DEF).toBe(fresh.stats.DEF + 2);
  });
});

describe('blessing', () => {
  const blessingEvent = (tier) => soloEvent([{ type: 'blessing', tier }]);

  it('hands out a safe tier-1 blessing the run lacks, applied at once (blessed_vigor: lords +4 HP)', () => {
    const run = runWithEvents([blessingEvent(1)]);
    // Hold the other two safe tier-1 blessings so the draw is forced.
    run.activeBlessings = [{ id: 'steady_hands' }, { id: 'field_medic' }];
    const node = arriveAs(run, 'solo');
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.results[0]).toMatchObject({ kind: 'blessing', id: 'blessed_vigor', tier: 1 });
    expect(run.getActiveBlessingIds()).toContain('blessed_vigor');
    const edric = run.roster.find((u) => u.name === 'Edric');
    const gaspar = run.roster.find((u) => u.name === 'Gaspar');
    expect(edric.stats.HP).toBe(24); // lord: 20 + 4
    expect(gaspar.stats.HP).toBe(18); // not a lord
  });

  it('never an unsafe blessing: not coin_of_fate (gold), never the same one twice', () => {
    const picked = new Set();
    for (let seed = 1; seed <= 40; seed++) {
      const run = runWithEvents([blessingEvent(1)], { seed });
      const node = arriveAs(run, 'solo');
      const first = chooseEventOption(run, node.id, 'go').results[0].id;
      picked.add(first);
      expect(run.getActiveBlessingIds().filter((id) => id === first)).toHaveLength(1);
    }
    expect([...picked].sort()).toEqual(['blessed_vigor', 'field_medic', 'steady_hands']);
  });

  it('tier 3 draws only from the safe tier-3 set', () => {
    const picked = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const run = runWithEvents([blessingEvent(3)], { seed });
      const node = arriveAs(run, 'solo');
      picked.add(chooseEventOption(run, node.id, 'go').results[0].id);
    }
    // Tier III since blessings v3: every one is safe mid-run (no pact, no deploy cap).
    expect([...picked].sort()).toEqual([
      'focused_curriculum',
      'iron_oath',
      'merchant_bane',
      'nomad_pact',
      'war_veteran',
    ]);
  });

  it('with nothing left to give the plan fails and nothing changes', () => {
    const run = runWithEvents([
      soloEvent([
        { type: 'gold', value: 50 },
        { type: 'blessing', tier: 1 },
      ]),
    ]);
    run.activeBlessings = ['steady_hands', 'blessed_vigor', 'field_medic'].map((id) => ({ id }));
    const node = arriveAs(run, 'solo');
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.ok).toBe(false);
    expect(run.gold).toBe(200);
  });
});

describe('burden', () => {
  const taken = (effects, difficulty) => {
    const run = runWithEvents([soloEvent(effects)], { difficulty });
    chooseEventOption(run, arriveAs(run, 'solo').id, 'go');
    return run;
  };

  it('Ill Omen: 3 battles on Dusk and above, 2 on First Light, +1 shadow each', () => {
    expect(taken([{ type: 'burden', id: 'ill_omen' }], 'normal').burdens).toEqual([
      { id: 'ill_omen', battles: 2, extraShadow: 1 },
    ]);
    expect(taken([{ type: 'burden', id: 'ill_omen' }], 'dusk').burdens).toEqual([
      { id: 'ill_omen', battles: 3, extraShadow: 1 },
    ]);
  });

  it('Debt: owed is { base, perAct } at the act (450 + 300 = 750 in act 1); a quarter garnished on First Light, a half above', () => {
    const effects = [{ type: 'burden', id: 'debt', params: { owed: { base: 450, perAct: 300 } } }];
    expect(taken(effects, 'normal').burdens).toEqual([{ id: 'debt', owed: 750, garnish: 0.25 }]);
    expect(taken(effects, 'hard').burdens).toEqual([{ id: 'debt', owed: 750, garnish: 0.5 }]);
  });

  it('never stacks with itself: Debt adds to what is owed, Ill Omen refreshes its battles', () => {
    const run = runWithEvents([
      soloEvent([
        { type: 'burden', id: 'debt', params: { owed: 100 } },
        { type: 'burden', id: 'debt', params: { owed: 50 } },
        { type: 'burden', id: 'ill_omen' },
      ]),
    ]);
    run.burdens = [{ id: 'ill_omen', battles: 1, extraShadow: 1 }];
    chooseEventOption(run, arriveAs(run, 'solo').id, 'go');
    expect(run.burdens.filter((b) => b.id === 'debt')).toEqual([
      { id: 'debt', owed: 150, garnish: 0.25 },
    ]);
    expect(run.burdens.filter((b) => b.id === 'ill_omen')).toEqual([
      { id: 'ill_omen', battles: 2, extraShadow: 1 },
    ]);
  });
});

describe('layToRest', () => {
  function echoRun() {
    const run = runWithEvents([
      { ...soloEvent([{ type: 'layToRest' }], { requires: { fallen: true } }), id: 'the_echo' },
    ]);
    const archer = addUnit(run, 'Archer', { name: 'Hale', level: 4 });
    fallAlly(run, archer);
    const node = arriveAs(run, 'the_echo');
    return { run, archer, node };
  }

  it('removes the unit from the fallen and records it; nothing can revive it', () => {
    const { run, archer, node } = echoRun();
    run.gold = 5000;
    expect(churchReviveBlock(run, archer)).toBe(''); // revivable before
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.results).toEqual([{ kind: 'layToRest', name: 'Hale' }]);
    expect(run.fallenUnits).toHaveLength(0);
    expect(run.laidToRest.map((u) => u.name)).toEqual(['Hale']);
    expect(churchReviveBlock(run, archer)).toBe('Unit is no longer awaiting revival.');
    expect(reviveAtChurch(run, archer).ok).toBe(false);
    expect(run.reviveFallenUnit(archer, 0)).toBe(false);
    expect(run.roster.map((u) => u.name)).not.toContain('Hale');
  });

  it('the run still remembers them: the name stays taken and a laid-to-rest lord is never offered again', () => {
    const { run, node } = echoRun();
    chooseEventOption(run, node.id, 'go');
    expect(run.getTakenUnitNames().has('Hale')).toBe(true);
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    const loaded = run.constructor.fromJSON(saved, run.gameData);
    expect(loaded.laidToRest.map((u) => u.name)).toEqual(['Hale']);
    expect(loaded.fallenUnits).toHaveLength(0);
    expect(loaded.getTakenUnitNames().has('Hale')).toBe(true);
  });
});

describe('consume', () => {
  const vuln = (run, uses) => ({ ...run.getConsumableTemplate('Vulnerary'), uses });
  const consumeEvent = () =>
    soloEvent([{ type: 'consume', name: 'Vulnerary', uses: 1 }], {
      choice: { requires: { consumable: 'Vulnerary' } },
    });

  it('spends a use from the healthiest holder (highest HP ratio), not the one who needs it', () => {
    const run = runWithEvents([consumeEvent()]);
    const [edric, , gaspar] = run.roster;
    edric.consumables = [vuln(run, 2)];
    gaspar.consumables = [vuln(run, 2)];
    gaspar.currentHP = 9; // 9/18 = .5; Edric is at 1.0
    const node = arriveAs(run, 'solo');
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.results[0]).toEqual({
      kind: 'consume',
      name: 'Vulnerary',
      uses: 1,
      holder: 'Edric',
    });
    expect(edric.consumables[0].uses).toBe(1);
    expect(gaspar.consumables[0].uses).toBe(2);
  });

  it('an emptied item leaves the bag, the way using it anywhere else does', () => {
    const run = runWithEvents([consumeEvent()]);
    run.roster[0].consumables = [vuln(run, 1)];
    chooseEventOption(run, arriveAs(run, 'solo').id, 'go');
    expect(run.roster[0].consumables).toHaveLength(0);
  });

  it('falls back to the convoy when no unit holds one, and prefers a bag over the convoy', () => {
    const bare = () => {
      const r = runWithEvents([consumeEvent()]);
      for (const unit of r.roster) unit.consumables = [];
      return r;
    };
    let run = bare();
    run.convoy.consumables = [vuln(run, 2)];
    chooseEventOption(run, arriveAs(run, 'solo').id, 'go');
    expect(run.convoy.consumables[0].uses).toBe(1);
    run = bare();
    run.convoy.consumables = [vuln(run, 2)];
    run.roster[2].consumables = [vuln(run, 2)];
    const result = chooseEventOption(run, arriveAs(run, 'solo').id, 'go');
    expect(result.results[0].holder).toBe('Gaspar');
    expect(run.convoy.consumables[0].uses).toBe(2);
    // A convoy item emptied is removed from the convoy.
    run = bare();
    run.convoy.consumables = [vuln(run, 1)];
    chooseEventOption(run, arriveAs(run, 'solo').id, 'go');
    expect(run.convoy.consumables).toHaveLength(0);
  });

  it('the choice is blocked while nobody has one to spare', () => {
    const run = runWithEvents([consumeEvent()]);
    for (const unit of run.roster) unit.consumables = [];
    run.convoy.consumables = [];
    const node = arriveAs(run, 'solo');
    expect(eventChoiceBlock(run, node.id, 'go')).toBe('You have no Vulnerary to spare.');
  });
});

describe('plan, then apply', () => {
  const snapshot = (run) =>
    JSON.stringify({
      gold: run.gold,
      roster: run.roster,
      convoy: run.convoy,
      eclipse: run.eclipse,
      flags: run.storyFlags,
      log: run.eventLog,
      burdens: run.burdens,
      fallen: run.fallenUnits,
      vision: run.visionChargesRemaining,
      blessings: run.activeBlessings,
    });

  it('a plan failure applies none of the effects and records nothing', () => {
    const run = runWithEvents([
      soloEvent([
        { type: 'gold', value: 500 },
        { type: 'flag', key: 'k', value: true },
        { type: 'shadow', value: 5 },
        { type: 'hp', mode: 'damage', percent: 50, scope: 'all' },
        { type: 'item', name: 'Excalibur' },
      ]),
    ]);
    const node = arriveAs(run, 'solo');
    const before = snapshot(run);
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.ok).toBe(false);
    expect(snapshot(run)).toBe(before);
    expect(eventState(run, node.id).choiceId).toBeUndefined();
    // The choice is still open: a fixed event could be chosen again.
    expect(eventView(run, node.id).phase).toBe('choosing');
  });

  it('an exception while applying rolls the run back whole', () => {
    const run = runWithEvents([
      soloEvent([
        { type: 'gold', value: 500 },
        { type: 'hp', mode: 'damage', percent: 50, scope: 'all' },
        { type: 'shadow', value: 5 },
        { type: 'blessing', tier: 1 },
      ]),
    ]);
    const node = arriveAs(run, 'solo');
    run.addBlessingMidRun = () => {
      throw new Error('boom');
    };
    const before = snapshot(run);
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('Nothing changed');
    expect(snapshot(run)).toBe(before);
    expect(eventState(run, node.id).choiceId).toBeUndefined();
  });

  it('a second choice is refused and changes nothing', () => {
    const run = runWithEvents([soloEvent([{ type: 'gold', value: 100 }])]);
    const node = arriveAs(run, 'solo');
    expect(chooseEventOption(run, node.id, 'go').ok).toBe(true);
    const before = snapshot(run);
    expect(chooseEventOption(run, node.id, 'go')).toEqual({
      ok: false,
      reason: 'You have already chosen.',
    });
    expect(snapshot(run)).toBe(before);
    expect(run.eventLog).toHaveLength(1);
  });

  it('logs { eventId, choiceId, outcomeId, act } once', () => {
    const run = runWithEvents([soloEvent([])]);
    chooseEventOption(run, arriveAs(run, 'solo').id, 'go');
    expect(run.eventLog).toEqual([
      { eventId: 'solo', choiceId: 'go', outcomeId: 'only', act: 'act1' },
    ]);
  });

  it('refuses a target who does not meet the filter, and one outside the army', () => {
    const run = runWithEvents([
      soloEvent([{ type: 'flag', key: 'k', value: 1 }], {
        choice: {
          target: { prompt: 'Who?', filter: { weaponTypes: ['Axe'] }, reason: 'No axe here.' },
        },
      }),
    ]);
    const node = arriveAs(run, 'solo');
    expect(eventChoiceBlock(run, node.id, 'go')).toBe('No axe here.');
    run.roster[0].proficiencies.push({ type: 'Axe', rank: 'Prof' });
    expect(eventChoiceBlock(run, node.id, 'go')).toBe('');
    expect(eventChoiceBlock(run, node.id, 'go', run.roster[1].unitUid)).toBe('Cannot use axe.');
    expect(eventChoiceBlock(run, node.id, 'go', 'ru999')).toBe('Choose someone in the army.');
    expect(chooseEventOption(run, node.id, 'go')).toEqual({ ok: false, reason: 'Choose who.' });
    expect(chooseEventOption(run, node.id, 'go', { targetUid: run.roster[0].unitUid }).ok).toBe(
      true,
    );
  });

  it('never reads Math.random and leaves the surrounding stream where it was', () => {
    const run = runWithEvents([
      soloEvent(
        [
          { type: 'item', name: 'Vulnerary', to: 'target' },
          {
            type: 'item',
            pool: { kind: 'weapon', weaponTypes: '$army', tierOffset: 0 },
            to: 'auto',
            wear: 1,
          },
          { type: 'blessing', tier: 1 },
          { type: 'hp', mode: 'damage', percent: 10, scope: 'randomUnit' },
        ],
        withTarget,
      ),
    ]);
    const node = arriveAs(run, 'solo');
    const spy = vi.spyOn(Math, 'random');
    try {
      const result = chooseEventOption(run, node.id, 'go', { targetUid: run.roster[0].unitUid });
      expect(result.ok, result.reason).toBe(true);
      expect(spy).not.toHaveBeenCalled();
      expect(Math.random).toBe(spy);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('arrival', () => {
  it('records the event once and is idempotent; the node becomes the current node', () => {
    const run = newRun({ seed: 12 });
    const node = eventNode(run);
    const first = arriveAtEvent(run, node.id);
    expect(first.eventId).toBeTruthy();
    expect(run.currentNodeId).toBe(node.id);
    expect(arriveAtEvent(run, node.id)).toEqual(first);
    expect(run.getAvailableNodes().map((n) => n.id)).toEqual([node.id]);
  });

  it('returns null for a node that is not an event, in a prologue run, or without data', () => {
    const run = newRun();
    expect(arriveAtEvent(run, run.nodeMap.startNodeId)).toBeNull();
    expect(arriveAtEvent(run, 'nope')).toBeNull();
    const node = eventNode(run);
    run.mode = 'prologue';
    expect(arriveAtEvent(run, node.id)).toBeNull();
    run.mode = 'standard';
    run.gameData = { ...run.gameData, events: null };
    expect(arriveAtEvent(run, node.id)).toBeNull();
  });

  it('the Echo records the fallen ally it names and the outcome page keeps the name', () => {
    const run = newRun({ seed: 3 });
    const archer = addUnit(run, 'Archer', { name: 'Hale' });
    fallAlly(run, archer);
    const node = eventNode(run);
    const state = arriveAs(run, 'the_echo', node) && eventState(run, node.id);
    expect(state.fallen).toEqual({ unitUid: archer.unitUid, name: 'Hale' });
    expect(eventView(run, node.id).intro).toBe(
      'At a crossroads cairn a voice you know asks you to stop. Hale is here. Mostly.',
    );
  });
});

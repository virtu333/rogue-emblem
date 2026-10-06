// The room check of a choice that may grant an item (docs/specs/event-nodes.md §5, "Room
// for items"). It must say what the planner would do: a weapon needs a unit's WEAPON bag
// (and a unit that can wield it) or a place in the convoy's WEAPON compartment; an item needs
// a consumable slot or the convoy's consumable compartment. The check never depends on the
// hidden outcome, so an open choice cannot fail at planning and a choice that could never
// fail is never greyed.
//
// The starting army (Edric: sword; Sera: Light and staves; Gaspar: sword and lance), Act I
// (Iron weapons), a convoy of 20 weapons and 15 consumables. Each bag holds 5 weapons and 3
// consumables.
//
// Ways this can fail, a test each:
//   1. free consumable space (a bag, or the convoy's) opens a weapon-granting choice that then
//      fails at planning: "any unit has any slot" read as "a weapon can be carried";
//   2. a free weapon slot on a unit that cannot wield any possible weapon opens the choice
//      although the convoy is full;
//   3. a free weapon slot on a unit that can, or room in the weapon convoy, does not open it;
//   4. a consumable reward is blocked by full weapon bags, or opened by free weapon space only;
//   5. a choice with a weapon-granting and a non-granting outcome (or only a fallback, or only an
//      afterVictory item) is blocked or opened depending on the seed, or ignores the other paths;
//   6. two items in one path are checked one at a time (one free slot opens a choice that needs
//      two);
//   7. a unit the item could not reach is offered in the picker as pickable;
//   8. an effect that is not an item (gold, a flag...) is blocked for room.
import { describe, expect, it } from 'vitest';
import {
  chooseEventOption,
  eventChoiceBlock,
  eventTargets,
  eventView,
} from '../src/engine/EventCommands.js';
import { arriveAs, runWithEvents, soloEvent } from './eventKit.js';

const WEAPON_LINE = 'No room for another weapon. Make room in a bag or the convoy.';
const ITEM_LINE = 'No room for another item. Make room in a bag or the convoy.';

const swordPool = {
  type: 'item',
  pool: { kind: 'weapon', weaponTypes: ['Sword'], tierOffset: 0 },
  to: 'auto',
};
const armyPool = {
  type: 'item',
  pool: { kind: 'weapon', weaponTypes: '$army', tierOffset: 0 },
  to: 'auto',
};
const vulnerary = { type: 'item', name: 'Vulnerary', to: 'auto' };
const flag = { type: 'flag', key: 'seen', value: true };

/** A run holding one event whose single choice `go` has the given outcomes. */
function setup(outcomes, { choice = {}, seed = 101 } = {}) {
  const event = soloEvent([], { choice });
  event.choices[0].outcomes = outcomes.map((outcome, index) => ({
    id: `o${index}`,
    weight: 50,
    text: 'Done.',
    ...outcome,
  }));
  const run = runWithEvents([event], { seed });
  const node = arriveAs(run, 'solo');
  return { run, node, block: () => eventChoiceBlock(run, node.id, 'go') };
}
const one = (effects, options) => setup([{ effects }], options);

const unit = (run, name) => run.roster.find((u) => u.name === name);
const iron = (run) => run.gameData.weapons.find((w) => w.name === 'Iron Sword');
/** Fill a unit's weapon bag to its five slots. */
function fillWeapons(run, name) {
  const u = unit(run, name);
  while (u.inventory.length < 5) u.inventory.push(structuredClone(iron(run)));
}
function fillConsumables(run, name) {
  const u = unit(run, name);
  while (u.consumables.length < 3) u.consumables.push(run.getConsumableTemplate('Vulnerary'));
}
const everyone = ['Edric', 'Sera', 'Gaspar'];
const fullWeaponBags = (run) => everyone.forEach((name) => fillWeapons(run, name));
const fullConsumableBags = (run) => everyone.forEach((name) => fillConsumables(run, name));
function fullWeaponConvoy(run) {
  run.convoy.weapons = Array.from({ length: run.getConvoyCapacities().weapons }, () =>
    structuredClone(iron(run)),
  );
}
function fullConsumableConvoy(run) {
  run.convoy.consumables = Array.from({ length: run.getConvoyCapacities().consumables }, () =>
    run.getConsumableTemplate('Vulnerary'),
  );
}
/** No weapon can be carried anywhere; consumables have room everywhere. */
function noWeaponRoom(run) {
  fullWeaponBags(run);
  fullWeaponConvoy(run);
}

describe('a weapon needs weapon space', () => {
  it('free consumable space (bags and convoy) does not open a weapon choice; the choice cannot fail at planning', () => {
    const { run, node, block } = one([armyPool]);
    expect(block()).toBe('');
    noWeaponRoom(run);
    expect(run.roster.every((u) => u.consumables.length < 3)).toBe(true); // space the old check counted
    expect(run.getConvoyCounts().consumables).toBe(0);
    expect(block()).toBe(WEAPON_LINE);
    expect(chooseEventOption(run, node.id, 'go')).toEqual({ ok: false, reason: WEAPON_LINE });
    expect(eventView(run, node.id).choices[0].block).toBe(WEAPON_LINE);
    // Nothing changed.
    expect(run.convoy.weapons.length).toBe(run.getConvoyCapacities().weapons);
  });

  it('full everywhere says the same: the reward is a weapon', () => {
    const { run, block } = one([armyPool]);
    noWeaponRoom(run);
    fullConsumableBags(run);
    fullConsumableConvoy(run);
    expect(block()).toBe(WEAPON_LINE);
  });

  it('a free weapon slot on a unit that cannot wield the reward does not open it', () => {
    const { run, node, block } = one([swordPool]);
    noWeaponRoom(run);
    unit(run, 'Sera').inventory.pop(); // a free slot, but Sera (Light, staves) cannot wield a sword
    expect(unit(run, 'Sera').inventory.length).toBeLessThan(5);
    expect(block()).toBe(WEAPON_LINE);
    expect(chooseEventOption(run, node.id, 'go').ok).toBe(false);
  });

  it('a free weapon slot on a unit that can wield it opens the choice, and the sword lands there', () => {
    const { run, node, block } = one([swordPool]);
    noWeaponRoom(run);
    unit(run, 'Gaspar').inventory.pop();
    expect(block()).toBe('');
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.ok).toBe(true);
    expect(result.results[0]).toMatchObject({ kind: 'item', unit: 'Gaspar', toConvoy: false });
    expect(unit(run, 'Gaspar').inventory.length).toBe(5);
  });

  it('room in the weapon convoy alone opens the choice', () => {
    const { run, node, block } = one([swordPool]);
    fullWeaponBags(run);
    fullWeaponConvoy(run);
    run.convoy.weapons.pop();
    expect(block()).toBe('');
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.results[0]).toMatchObject({ kind: 'item', toConvoy: true });
  });

  it('room in the consumable convoy does not count for a weapon', () => {
    const { run, block } = one([swordPool]);
    fullWeaponBags(run);
    fullWeaponConvoy(run);
    run.convoy.consumables = [];
    expect(block()).toBe(WEAPON_LINE);
  });
});

describe('a consumable needs consumable space', () => {
  it('opens on consumable space alone, whatever the weapon space', () => {
    const { run, node, block } = one([vulnerary]);
    noWeaponRoom(run);
    expect(block()).toBe('');
    const result = chooseEventOption(run, node.id, 'go');
    expect(result.ok).toBe(true);
    expect(result.results[0]).toMatchObject({ kind: 'item', name: 'Vulnerary' });
  });

  it('is blocked when every consumable place is full, even with weapon space everywhere', () => {
    const { run, node, block } = one([vulnerary]);
    fullConsumableBags(run);
    fullConsumableConvoy(run);
    expect(run.roster.every((u) => u.inventory.length < 5)).toBe(true);
    expect(block()).toBe(ITEM_LINE);
    expect(chooseEventOption(run, node.id, 'go')).toEqual({ ok: false, reason: ITEM_LINE });
  });

  it('one unit with a free consumable slot is enough', () => {
    const { run, block } = one([vulnerary]);
    fullConsumableBags(run);
    fullConsumableConvoy(run);
    unit(run, 'Sera').consumables.pop();
    expect(block()).toBe('');
  });
});

describe('the check never depends on the hidden outcome', () => {
  const mixed = () => setup([{ effects: [armyPool] }, { effects: [flag] }]);

  it('a choice with a weapon outcome and a plain one is blocked when no weapon fits, for every seed', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { run, block } = setup([{ effects: [armyPool] }, { effects: [flag] }], { seed });
      expect(block(), `seed ${seed} with room`).toBe('');
      noWeaponRoom(run);
      expect(block(), `seed ${seed} without room`).toBe(WEAPON_LINE);
    }
  });

  it('an open mixed choice never fails for room, whichever outcome the seed picks', () => {
    const picked = new Set();
    for (let seed = 1; seed <= 20; seed++) {
      const { run, node } = setup([{ effects: [armyPool] }, { effects: [flag] }], { seed });
      unit(run, 'Edric').inventory.length = 4;
      fullWeaponBags(run);
      run.convoy.weapons = [];
      const result = chooseEventOption(run, node.id, 'go');
      expect(result.ok, `seed ${seed}`).toBe(true);
      picked.add(result.outcomeId);
    }
    expect(picked.size).toBe(2); // both outcomes were really exercised
  });

  it('a path that grants nothing in its main effects but an item in its fallback still counts', () => {
    const { run, block } = setup([{ effects: [flag], fallback: [armyPool] }]);
    expect(block()).toBe('');
    noWeaponRoom(run);
    expect(block()).toBe(WEAPON_LINE);
  });

  it('an item in the spoils of a fight (afterVictory) counts: the player is stopped before the fight', () => {
    const battle = (afterVictory) => ({ type: 'battle', enemyLevelBonus: 0, afterVictory });
    const { run, block } = one([battle([flag, armyPool])]);
    expect(block()).toBe('');
    noWeaponRoom(run);
    expect(block()).toBe(WEAPON_LINE);
    // A fight whose spoils are gold never asks for room.
    const gold = one([battle([{ type: 'gold', value: 50 }])]);
    noWeaponRoom(gold.run);
    expect(gold.block()).toBe('');
  });

  it('the choice-level item and the outcome item share the same room (one slot is not two)', () => {
    const { run, block } = setup([{ effects: [swordPool] }], { choice: { effects: [swordPool] } });
    noWeaponRoom(run);
    run.convoy.weapons.pop(); // one place only
    expect(block()).toBe(WEAPON_LINE);
    run.convoy.weapons.pop();
    expect(block()).toBe('');
  });

  it('two items in one outcome: one free place is not enough, two are', () => {
    const { run, node, block } = one([swordPool, swordPool]);
    noWeaponRoom(run);
    run.convoy.weapons.pop();
    expect(block()).toBe(WEAPON_LINE);
    run.convoy.weapons.pop();
    expect(block()).toBe('');
    expect(chooseEventOption(run, node.id, 'go').ok).toBe(true);
  });

  it('a weapon and a consumable are checked in their own places', () => {
    const { run, block } = one([swordPool, vulnerary]);
    noWeaponRoom(run);
    expect(block()).toBe(WEAPON_LINE);
    unit(run, 'Edric').inventory.pop();
    expect(block()).toBe('');
    fullConsumableBags(run);
    fullConsumableConvoy(run);
    expect(block()).toBe(ITEM_LINE);
  });

  it('reads only the run: asking twice answers the same and changes nothing', () => {
    const { run, node } = mixed();
    noWeaponRoom(run);
    const before = JSON.stringify(run.toJSON());
    const first = eventChoiceBlock(run, node.id, 'go');
    const second = eventChoiceBlock(run, node.id, 'go');
    expect(second).toBe(first);
    expect(JSON.stringify(run.toJSON())).toBe(before);
  });
});

describe('effects that are not items never need room', () => {
  it('gold, a flag, a stat or an hp change opens a choice in a full army', () => {
    const { run, block } = one([
      flag,
      { type: 'gold', value: 40 },
      { type: 'hp', mode: 'heal', percent: 10, scope: 'all' },
    ]);
    noWeaponRoom(run);
    fullConsumableBags(run);
    fullConsumableConvoy(run);
    expect(block()).toBe('');
  });
});

describe('the unit picker', () => {
  // The prize is a weapon of the target's own kind, to the target, else the convoy, else anyone.
  const prize = {
    type: 'item',
    pool: { kind: 'weapon', weaponTypes: '$target', tierOffset: 0 },
    to: 'target',
  };
  const picking = () => one([prize], { choice: { target: { prompt: 'Who?', filter: {} } } });

  it('greys a unit no weapon could reach, with the reason, and keeps the others pickable', () => {
    const { run, node, block } = picking();
    noWeaponRoom(run);
    unit(run, 'Edric').inventory.pop(); // only Edric (and no one who wields Light) can take anything
    const rows = eventTargets(run, node.id, 'go');
    const byName = Object.fromEntries(rows.map((row) => [row.name, row]));
    expect(byName.Edric.ok).toBe(true);
    expect(byName.Sera).toMatchObject({ ok: false, reason: WEAPON_LINE }); // Glimmer: no one else wields it
    // Gaspar wields swords and lances, as Edric does: Edric's slot is a place for his reward.
    expect(byName.Gaspar.ok).toBe(true);
    // The view's picker rows say the same.
    const view = eventView(run, node.id).choices[0].target.candidates;
    expect(view.find((row) => row.name === 'Sera')).toMatchObject({
      ok: false,
      reason: WEAPON_LINE,
    });
    // The choice itself is open (someone can be picked); naming Sera is refused with the line.
    expect(block()).toBe('');
    expect(eventChoiceBlock(run, node.id, 'go', unit(run, 'Sera').unitUid)).toBe(WEAPON_LINE);
    expect(chooseEventOption(run, node.id, 'go', { targetUid: unit(run, 'Sera').unitUid }).ok).toBe(
      false,
    );
    expect(
      chooseEventOption(run, node.id, 'go', { targetUid: unit(run, 'Gaspar').unitUid }).ok,
    ).toBe(true);
  });

  it('is blocked outright when no unit could be reached', () => {
    const { run, block } = picking();
    noWeaponRoom(run);
    expect(block()).toBe(WEAPON_LINE);
  });
});

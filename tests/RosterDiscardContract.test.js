// Discard makes room for an owed contract reward (docs/specs/event-nodes-phase2.md "Contract
// settlement recovery"). A kept weapon reward with every bag and the convoy full of weapons is
// owed ("No room for Steel Lance") and holds the party at the node, where no shop can buy a
// weapon off it; the roster's Discard frees a slot and Claim then pays.
// Ways this goes wrong:
//   - discarding does not free what the planner counts (a bag slot for a unit that can wield
//     the reward, a convoy slot), so Claim stays blocked;
//   - discarding the wrong kind (a consumable) frees a weapon slot, or a blocked Claim changes
//     the run;
//   - the freed room is lost by a save and a reload, or the reward lands twice.
// Both of these run the real commands: the victory commit (completeBattle), the roster's
// rosterItemAction and deliverContractSettlement.
import { describe, expect, it } from 'vitest';
import { arriveAtEvent, chooseEventOption, leaveEvent } from '../src/engine/EventCommands.js';
import { deliverContractSettlement } from '../src/engine/ContractSettlement.js';
import { contractRewardOwed } from '../src/engine/Contracts.js';
import { rosterItemAction, rosterItemBlock } from '../src/engine/RosterInventory.js';
import { canEquip } from '../src/engine/UnitManager.js';
import { eventNode, runWithEvents } from './eventKit.js';
import { contractEvent, roundTrip } from './eventPhase2Kit.js';

const STEEL_LANCE = [{ type: 'item', name: 'Steel Lance' }];

/** Every bag and both convoy compartments full: nothing more can be given. */
function fillArmy(run) {
  for (const unit of run.roster) {
    while (unit.inventory.length < 5) unit.inventory.push(structuredClone(unit.inventory[0]));
    while (unit.consumables.length < 3)
      unit.consumables.push(run.getConsumableTemplate('Vulnerary'));
  }
  const caps = run.getConvoyCapacities();
  run.convoy.weapons = Array.from({ length: caps.weapons }, (_, i) => ({
    ...structuredClone(run.gameData.weapons[0]),
    uid: `stored-${i}`,
  }));
  run.convoy.consumables = Array.from({ length: caps.consumables }, () =>
    run.getConsumableTemplate('Vulnerary'),
  );
}

/** A won battle whose kept Steel Lance reward has nowhere to go. */
function ownedLance() {
  const run = runWithEvents([contractEvent({ reward: STEEL_LANCE })], { seed: 61 });
  const node = eventNode(run);
  arriveAtEvent(run, node.id);
  expect(chooseEventOption(run, node.id, 'sign').ok).toBe(true);
  expect(leaveEvent(run, node.id).ok).toBe(true);
  fillArmy(run);
  const battle = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
  run.currentNodeId = battle.id;
  expect(run.completeBattle(run.getRoster(), battle.id, 100, { turnCount: 1, turnPar: 5 })).toBe(
    true,
  );
  expect(run.contractOwed).toMatchObject({ kept: true, blocked: 'No room for Steel Lance' });
  return { run, battle };
}

const lances = (run) =>
  [...run.roster.flatMap((unit) => unit.inventory), ...run.convoy.weapons].filter(
    (item) => item.name === 'Steel Lance',
  ).length;
const weaponTotal = (run) =>
  run.roster.reduce((sum, unit) => sum + unit.inventory.length, 0) + run.convoy.weapons.length;

describe('Discard clears the way for an owed weapon reward', () => {
  it('Claim is blocked while everything is full, a convoy weapon is discarded, then it pays once', () => {
    const { run } = ownedLance();
    const before = lances(run);
    const total = weaponTotal(run);

    const stuck = deliverContractSettlement(run);
    expect(stuck).toMatchObject({ ok: false, blocked: true, reason: 'No room for Steel Lance' });
    expect(weaponTotal(run)).toBe(total);

    const stored = run.getConvoyItems().weapons[3];
    expect(rosterItemBlock(run, run.roster[0], stored, 'discard')).toBe('');
    expect(rosterItemAction(run, run.roster[0], stored, 'discard')).toBe('');
    expect(weaponTotal(run)).toBe(total - 1);
    expect(run.convoy.weapons.map((item) => item.uid)).not.toContain(stored.uid);

    const paid = deliverContractSettlement(run);
    expect(paid.ok).toBe(true);
    expect(paid.settlement.results[0]).toMatchObject({ kind: 'item', name: 'Steel Lance' });
    expect(lances(run)).toBe(before + 1);
    expect(weaponTotal(run)).toBe(total);
    expect(run.contractOwed).toBeNull();
    expect(contractRewardOwed(run)).toBe(false);
    // Claimed once: nothing more is owed or paid.
    expect(deliverContractSettlement(run)).toBeNull();
    expect(lances(run)).toBe(before + 1);
  });

  it('a weapon discarded from a bag frees the slot for a unit that can wield the reward', () => {
    const { run } = ownedLance();
    const wielder = run.roster.find((unit) =>
      canEquip(unit, { type: 'Lance', rankRequired: 'Prof' }),
    );
    expect(wielder).toBeTruthy();
    // Only the wielder's own bag has room for the lance: the convoy stays full.
    const spare = wielder.inventory[4];
    expect(rosterItemAction(run, wielder, spare, 'discard')).toBe('');
    expect(wielder.inventory).toHaveLength(4);
    expect(run.convoy.weapons).toHaveLength(run.getConvoyCapacities().weapons);
    const before = lances(run);

    expect(deliverContractSettlement(run).ok).toBe(true);
    expect(lances(run)).toBe(before + 1);
    expect(wielder.inventory).toHaveLength(5);
  });

  it('discarding a consumable does not make room for a weapon', () => {
    const { run } = ownedLance();
    const unit = run.roster[0];
    expect(rosterItemAction(run, unit, unit.consumables[0], 'discard')).toBe('');
    expect(rosterItemAction(run, unit, run.convoy.consumables[0], 'discard')).toBe('');
    const total = weaponTotal(run);
    expect(deliverContractSettlement(run)).toMatchObject({
      ok: false,
      blocked: true,
      reason: 'No room for Steel Lance',
    });
    expect(weaponTotal(run)).toBe(total);
    expect(contractRewardOwed(run)).toBe(true);
  });

  it('the whole recovery: full army, owed, discard, reload, Claim, reload: gone, owned, paid once', () => {
    const { run, battle } = ownedLance();
    const caps = run.getConvoyCapacities();
    const owned = lances(run);
    const stored = run.convoy.weapons[0];
    expect(run.convoy.weapons).toHaveLength(caps.weapons);

    // The party is held; the player discards a stored weapon (confirmed in the UI) and the run saves.
    expect(rosterItemAction(run, run.roster[0], stored, 'discard')).toBe('');

    // A reload between the discard and the Claim keeps both: the discard, and the owed reward.
    const reloaded = roundTrip(run);
    expect(reloaded.convoy.weapons).toHaveLength(caps.weapons - 1);
    expect(reloaded.convoy.weapons.map((item) => item.uid)).not.toContain(stored.uid);
    expect(contractRewardOwed(reloaded)).toBe(true);
    expect(reloaded.contractOwed).toMatchObject({ kept: true, effects: STEEL_LANCE });
    expect(reloaded.currentNodeId).toBe(battle.id);
    expect(lances(reloaded)).toBe(owned);

    // Claim pays the reward once, into the slot the discard made.
    const paid = deliverContractSettlement(reloaded);
    expect(paid.ok).toBe(true);
    expect(lances(reloaded)).toBe(owned + 1);
    expect(reloaded.contractOwed).toBeNull();
    expect(reloaded.convoy.weapons).toHaveLength(caps.weapons);

    // A suspend and resume after the Claim: the discarded weapon is still gone, the reward is still
    // owned, nothing is owed again, and a second Claim finds nothing to pay.
    const resumed = roundTrip(reloaded);
    expect(resumed.convoy.weapons.map((item) => item.uid)).not.toContain(stored.uid);
    expect(lances(resumed)).toBe(owned + 1);
    expect(resumed.contractOwed).toBeNull();
    expect(contractRewardOwed(resumed)).toBe(false);
    expect(deliverContractSettlement(resumed)).toBeNull();
    expect(lances(resumed)).toBe(owned + 1);
    expect(weaponTotal(resumed)).toBe(weaponTotal(run) + 1); // `run` still lacks the reward
  });
});

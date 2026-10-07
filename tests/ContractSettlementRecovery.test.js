// Contract settlement recovery (docs/specs/event-nodes-phase2.md "Contract settlement recovery"):
// a contract is JUDGED once, at the victory commit, and what it earned is then OWED until it is
// delivered or the player gives a reward up. The record is `run.contractOwed`; the delivery is
// `deliverContractSettlement`; only an owed REWARD holds the party.
//
// Ways this goes wrong:
//   - a kept item reward with no room anywhere is closed as a "No room" note (forfeited without the
//     player choosing), or the verdict is thrown away by a failed apply (the contract is cleared
//     before the snapshot, so nothing is left to retry);
//   - the owed claim is lost by a save/reload (it is presentation-only state);
//   - a retry pays twice, pays a partial list, or pays something else (the seed key must be the
//     same on every attempt);
//   - the owed claim is re-judged against a later battle's turns or losses;
//   - a penalty holds the party forever, or a reward is forfeited by anything but the explicit call;
//   - a second contract is signed over an unpaid one, or the record dies at an act transition;
//   - an owed claim is read as an open contract (the HUD judges it, the chip says "Under par").
// Numbers by hand: First Light, kill gold 100 on a battle node = 234 gold (see EventBattles).
import { describe, expect, it, vi } from 'vitest';
import {
  arriveAtEvent,
  chooseEventOption,
  eventChoiceBlock,
  leaveEvent,
} from '../src/engine/EventCommands.js';
import {
  contractBound,
  contractOwedOf,
  contractPenaltyOwed,
  contractRewardOwed,
  contractRewardOwedAt,
  describeContract,
  describeOwedContract,
  normalizeContractOwed,
  settlementLines,
} from '../src/engine/Contracts.js';
import { contractSettlesBattle, contractStanding } from '../src/engine/ContractStanding.js';
import {
  deliverContractSettlement,
  forfeitContractReward,
} from '../src/engine/ContractSettlement.js';
import { planEffects } from '../src/engine/EventEffects.js';
import { describeResult } from '../src/engine/EventResultWords.js';
import { arriveAs, eventNode, runWithEvents } from './eventKit.js';
import { contractEvent, roundTrip } from './eventPhase2Kit.js';

const BATTLE_GOLD = 234;
const STEEL_LANCE = [{ type: 'item', name: 'Steel Lance' }];

function signed(terms = {}, { seed = 61 } = {}) {
  const run = runWithEvents([contractEvent(terms)], { seed });
  const node = eventNode(run);
  expect(arriveAtEvent(run, node.id).eventId).toBe('contract');
  expect(chooseEventOption(run, node.id, 'sign').ok).toBe(true);
  expect(leaveEvent(run, node.id).ok).toBe(true);
  return { run, signedAt: node };
}

/** Every bag and both convoy compartments full: nothing more can be given. */
function fillArmy(run) {
  for (const unit of run.roster) {
    while (unit.inventory.length < 5) unit.inventory.push(structuredClone(unit.inventory[0]));
    while (unit.consumables.length < 3)
      unit.consumables.push(run.getConsumableTemplate('Vulnerary'));
  }
  const caps = run.getConvoyCapacities();
  run.convoy.weapons = Array.from({ length: caps.weapons }, () =>
    structuredClone(run.gameData.weapons[0]),
  );
  run.convoy.consumables = Array.from({ length: caps.consumables }, () =>
    run.getConsumableTemplate('Vulnerary'),
  );
}

const nextBattle = (run) => {
  const node = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
  run.currentNodeId = node.id;
  return node;
};

function win(run, { turns = 1, par = 5, survivors = null, node = nextBattle(run) } = {}) {
  expect(
    run.completeBattle(survivors || run.getRoster(), node.id, 100, {
      turnCount: turns,
      turnPar: par,
    }),
  ).toBe(true);
  return node;
}

const weaponCount = (run) =>
  run.roster.flatMap((unit) => unit.inventory).length + run.convoy.weapons.length;
const namedCount = (run, name) =>
  run.roster.flatMap((unit) => unit.inventory).filter((item) => item.name === name).length +
  run.convoy.weapons.filter((item) => item.name === name).length;

/** The nodes the party may walk to: a held party can only stand where it is. */
const heldAt = (run) => {
  const available = run.getAvailableNodes();
  return available.length === 1 && available[0].id === run.currentNodeId;
};

/** A won battle whose kept Steel Lance reward had nowhere to go. */
function ownedLance() {
  const { run, signedAt } = signed({ reward: STEEL_LANCE });
  fillArmy(run);
  const node = win(run, { turns: 1, par: 5 });
  return { run, signedAt, node };
}

describe('a kept reward with no room is owed, not forfeited', () => {
  it('judges once, applies nothing, holds the party, and says why it waits', () => {
    const { run, signedAt, node } = ownedLance();
    const weapons = weaponCount(run);
    expect(run.contract).toBeNull();
    expect(contractRewardOwed(run)).toBe(true);
    expect(run.contractOwed).toEqual({
      battleNodeId: node.id,
      contractNodeId: signedAt.id,
      eventId: 'contract',
      act: 'act1',
      goal: 'underPar',
      kept: true,
      noPar: false,
      losses: 0,
      effects: STEEL_LANCE,
      seedKey: `event-contract:61:${signedAt.id}`,
      blocked: 'No room for Steel Lance',
      failed: null,
    });
    expect(weaponCount(run)).toBe(weapons);
    expect(namedCount(run, 'Steel Lance')).toBe(0);
    expect(run.lastContractSettlement).toMatchObject({
      kept: true,
      owed: true,
      lines: ['Contract kept: the reward waits — No room for Steel Lance'],
    });
    // the party stays on the battle node until it is delivered or given up
    expect(node.completed).toBe(true);
    expect(heldAt(run)).toBe(true);
    expect(run.getAvailableNodes()[0].id).toBe(node.id);
    expect(contractRewardOwedAt(run, node)).toBe(true);
  });

  it('survives a save and a reload with the same verdict, and still holds the party', () => {
    const { run, node } = ownedLance();
    const loaded = roundTrip(run);
    expect(loaded.contractOwed).toEqual(run.contractOwed);
    expect(contractRewardOwed(loaded)).toBe(true);
    expect(loaded.currentNodeId).toBe(node.id);
    expect(heldAt(loaded)).toBe(true);
  });

  it('Claim with no room changes nothing; once room is made it arrives exactly once', () => {
    const { run, node } = ownedLance();
    const loaded = roundTrip(run);
    const before = JSON.stringify(loaded.toJSON());

    const stuck = deliverContractSettlement(loaded);
    expect(stuck).toMatchObject({ ok: false, blocked: true });
    expect(stuck.reason).toBe('No room for Steel Lance');
    expect(JSON.stringify(loaded.toJSON())).toBe(before);

    loaded.convoy.weapons.pop(); // the player makes room
    const weapons = weaponCount(loaded);
    const paid = deliverContractSettlement(loaded);
    expect(paid.ok).toBe(true);
    expect(paid.settlement).toMatchObject({ kept: true, owed: false, failed: null });
    expect(paid.settlement.results).toHaveLength(1);
    expect(paid.settlement.results[0]).toMatchObject({ kind: 'item', name: 'Steel Lance' });
    expect(paid.settlement.lines).toEqual([expect.stringMatching(/^Contract kept: .*Steel Lance/)]);
    expect(namedCount(loaded, 'Steel Lance')).toBe(1);
    expect(weaponCount(loaded)).toBe(weapons + 1);
    expect(loaded.contractOwed).toBeNull();
    expect(contractRewardOwed(loaded)).toBe(false);

    // nothing more on a second Claim; the party walks on
    expect(deliverContractSettlement(loaded)).toBeNull();
    expect(weaponCount(loaded)).toBe(weapons + 1);
    expect(loaded.getAvailableNodes().map((n) => n.id)).toEqual(
      node.edges.filter((id) => loaded.nodeMap.nodes.some((n) => n.id === id)),
    );
    expect(heldAt(loaded)).toBe(false);
  });

  it('a pool item says it has no room before it has picked one, and still waits', () => {
    const { run } = signed({
      reward: [{ type: 'item', pool: { kind: 'weapon', weaponTypes: '$army', tierOffset: 1 } }],
    });
    fillArmy(run);
    win(run);
    expect(run.contractOwed).toMatchObject({ kept: true, blocked: 'No room for the item' });
    const weapons = weaponCount(run);
    run.convoy.weapons.pop();
    expect(deliverContractSettlement(run).ok).toBe(true);
    expect(weaponCount(run)).toBe(weapons + 1);
  });

  it('a roomy army is paid at the victory exactly as before, and nothing is left owed', () => {
    const { run } = signed({ reward: [{ type: 'gold', value: 600 }] });
    const gold = run.gold;
    win(run);
    expect(run.gold).toBe(gold + BATTLE_GOLD + 600);
    expect(run.contractOwed).toBeNull();
    expect(run.lastContractSettlement).toMatchObject({ kept: true, owed: false });
    expect(run.lastContractSettlement.lines).toEqual(['Contract kept: Gained 600 G']);
    expect(heldAt(run)).toBe(false);
  });

  it('the other terms wait with the item: nothing is paid until all of it can be', () => {
    const { run } = signed({ reward: [...STEEL_LANCE, { type: 'gold', value: 600 }] });
    fillArmy(run);
    const gold = run.gold;
    win(run);
    expect(run.gold).toBe(gold + BATTLE_GOLD); // not even the 600 G that came after the lance
    run.convoy.weapons.pop();
    expect(deliverContractSettlement(run).ok).toBe(true);
    expect(run.gold).toBe(gold + BATTLE_GOLD + 600);
    expect(namedCount(run, 'Steel Lance')).toBe(1);
  });
});

describe('a failed apply keeps the claim and pays the same thing on the retry', () => {
  const reward = [
    { type: 'gold', value: 600 },
    { type: 'blessing', tier: 1 },
  ];

  it('rolls back, stays owed with `failed`, survives a reload, and pays the original payout once', () => {
    // The payout an uninterrupted settlement gives (same seed, no failure).
    const control = signed({ reward }, { seed: 77 });
    win(control.run);
    const expected = control.run.lastContractSettlement.results;
    expect(expected.map((r) => r.kind)).toEqual(['gold', 'blessing']);

    const { run, signedAt } = signed({ reward }, { seed: 77 });
    const gold = run.gold;
    const blessings = run.activeBlessings.length;
    const spy = vi.spyOn(run, 'addBlessingMidRun').mockReturnValue(false);
    const node = win(run);
    spy.mockRestore();

    expect(run.gold).toBe(gold + BATTLE_GOLD); // the 600 G was rolled back with the blessing
    expect(run.activeBlessings).toHaveLength(blessings);
    expect(run.contract).toBeNull();
    expect(run.contractOwed).toMatchObject({
      kept: true,
      battleNodeId: node.id,
      contractNodeId: signedAt.id,
      blocked: null,
      seedKey: `event-contract:77:${signedAt.id}`,
    });
    expect(run.contractOwed.failed).toContain('could not be met');
    expect(run.lastContractSettlement.lines).toEqual([
      'Contract kept: the reward could not be paid yet',
    ]);
    expect(heldAt(run)).toBe(true);

    const loaded = roundTrip(run);
    expect(loaded.contractOwed).toEqual(run.contractOwed);
    const paid = deliverContractSettlement(loaded);
    expect(paid.ok).toBe(true);
    expect(paid.settlement.results).toEqual(expected); // same rolls, same blessing
    expect(loaded.gold).toBe(gold + BATTLE_GOLD + 600); // once, no partial or duplicate gold
    expect(loaded.contractOwed).toBeNull();
    expect(deliverContractSettlement(loaded)).toBeNull();
    expect(loaded.gold).toBe(gold + BATTLE_GOLD + 600);
  });

  it('a retry that fails again is still owed with the failure, and nothing is half applied', () => {
    const { run } = signed({ reward });
    const gold = run.gold;
    const spy = vi.spyOn(run, 'addBlessingMidRun').mockReturnValue(false);
    win(run);
    const afterVictory = run.gold;
    const again = deliverContractSettlement(run);
    spy.mockRestore();
    expect(again).toMatchObject({ ok: false, blocked: false });
    expect(run.gold).toBe(afterVictory);
    expect(afterVictory).toBe(gold + BATTLE_GOLD);
    expect(run.contractOwed.failed).toContain('could not be met');
    expect(deliverContractSettlement(run).ok).toBe(true);
    expect(run.gold).toBe(gold + BATTLE_GOLD + 600);
  });

  it('terms the planner refuses stay owed too (a reward is never closed unpaid)', () => {
    const { run } = signed({
      reward: [
        { type: 'gold', value: 600 },
        { type: 'burden', id: 'ghost' },
      ],
    });
    const gold = run.gold;
    win(run);
    expect(run.gold).toBe(gold + BATTLE_GOLD);
    expect(run.contractOwed).toMatchObject({ kept: true, failed: 'Unknown burden "ghost".' });
    expect(heldAt(run)).toBe(true);
  });
});

describe('the verdict is final', () => {
  it('an owed record ignores the next battle: its turns and losses never re-judge it', () => {
    const { run } = ownedLance();
    const owed = structuredClone(run.contractOwed);
    expect(owed).toMatchObject({ kept: true, losses: 0 });
    // Another battle is won (the held party is bypassed here to reach the next victory): far over
    // par, with a loss. The earlier contract was kept and stays kept.
    const second = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
    run.currentNodeId = second.id;
    const survivors = run.getRoster().slice(0, -1);
    expect(run.completeBattle(survivors, second.id, 100, { turnCount: 40, turnPar: 3 })).toBe(true);
    expect(run.contractOwed).toEqual(owed);
    expect(run.burdens).toEqual([]); // no penalty was ever judged
  });

  it('delivers the original reward at a later victory once room exists, even when that victory is over par', () => {
    const { run } = ownedLance();
    run.convoy.weapons.pop();
    const second = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
    run.currentNodeId = second.id;
    expect(run.completeBattle(run.getRoster(), second.id, 100, { turnCount: 40, turnPar: 3 })).toBe(
      true,
    );
    expect(run.contractOwed).toBeNull();
    expect(namedCount(run, 'Steel Lance')).toBe(1);
    expect(run.burdens).toEqual([]);
    expect(run.lastContractSettlement).toMatchObject({ kept: true, owed: false });
  });
});

describe('giving a reward up is explicit and only for rewards', () => {
  it('nothing forfeits on its own: repeated Claims and a reload leave it owed', () => {
    const { run } = ownedLance();
    for (let i = 0; i < 3; i++) expect(deliverContractSettlement(run).ok).toBe(false);
    expect(roundTrip(run).contractOwed).toEqual(run.contractOwed);
    expect(contractRewardOwed(run)).toBe(true);
  });

  it('forfeitContractReward ends it for good, applies nothing and releases the party', () => {
    const { run, node } = ownedLance();
    const before = weaponCount(run);
    const gold = run.gold;
    expect(forfeitContractReward(run)).toEqual({ ok: true });
    expect(run.contractOwed).toBeNull();
    expect(weaponCount(run)).toBe(before);
    expect(run.gold).toBe(gold);
    expect(run.lastContractSettlement).toMatchObject({ kept: true, owed: false, forfeited: true });
    expect(run.lastContractSettlement.lines).toEqual(['Contract kept: you gave up the reward']);
    expect(heldAt(run)).toBe(false);
    expect(run.getAvailableNodes().length).toBeGreaterThan(0);
    expect(contractRewardOwedAt(run, node)).toBe(false);
    // terminal: a second call and a delivery have nothing to act on
    expect(forfeitContractReward(run)).toMatchObject({ ok: false });
    expect(deliverContractSettlement(run)).toBeNull();
  });

  it('refuses when no reward is owed, and refuses an owed penalty', () => {
    const none = signed().run;
    expect(forfeitContractReward(none)).toMatchObject({ ok: false });

    const { run } = signed({ penalty: [{ type: 'gold', value: -50 }] });
    const owedPenalty = {
      battleNodeId: 'b',
      contractNodeId: 'c',
      eventId: 'contract',
      act: 'act1',
      goal: 'underPar',
      kept: false,
      noPar: false,
      losses: 0,
      effects: [{ type: 'gold', value: -50 }],
      seedKey: 'event-contract:61:c',
      blocked: null,
      failed: 'The terms could not be met (x).',
    };
    run.contract = null;
    run.contractOwed = owedPenalty;
    expect(forfeitContractReward(run)).toMatchObject({ ok: false });
    expect(run.contractOwed).toEqual(owedPenalty);
  });
});

describe('a penalty is retried and never holds the party', () => {
  const penalty = [
    { type: 'gold', value: -50 },
    { type: 'blessing', tier: 1 },
  ];

  it('stays owed after a failed apply without holding the party, and is paid at the next victory', () => {
    const { run } = signed({ penalty });
    const gold = run.gold;
    const spy = vi.spyOn(run, 'addBlessingMidRun').mockReturnValue(false);
    const node = win(run, { turns: 9, par: 5 });
    expect(run.gold).toBe(gold + BATTLE_GOLD); // nothing was taken: rolled back
    expect(run.contractOwed).toMatchObject({ kept: false, effects: penalty });
    expect(run.contractOwed.failed).toContain('could not be met');
    expect(contractPenaltyOwed(run)).toBe(true);
    expect(contractRewardOwed(run)).toBe(false);
    expect(contractRewardOwedAt(run, node)).toBe(false);
    expect(heldAt(run)).toBe(false); // the party walks on
    expect(run.lastContractSettlement.lines).toEqual([
      'Contract broken: the penalty could not be applied yet',
    ]);

    // the next victory retries the same penalty (failure removed)
    spy.mockRestore();
    const afterVictory = run.gold;
    win(run, { turns: 1, par: 5 });
    expect(run.contractOwed).toBeNull();
    expect(run.gold).toBe(afterVictory + BATTLE_GOLD - 50);
    expect(run.lastContractSettlement).toMatchObject({ kept: false, owed: false });
  });

  it('an owed penalty is retried by a Claim too, once and no more', () => {
    const { run } = signed({ penalty: [{ type: 'gold', value: -50 }] });
    run.contract = null;
    run.contractOwed = {
      battleNodeId: 'x',
      contractNodeId: 'y',
      eventId: 'contract',
      act: 'act1',
      goal: 'underPar',
      kept: false,
      noPar: false,
      losses: 0,
      effects: [{ type: 'gold', value: -50 }],
      seedKey: 'event-contract:61:y',
      blocked: null,
      failed: 'earlier failure',
    };
    const gold = run.gold;
    expect(deliverContractSettlement(run).ok).toBe(true);
    expect(run.gold).toBe(gold - 50);
    expect(deliverContractSettlement(run)).toBeNull();
    expect(run.gold).toBe(gold - 50);
  });
});

describe('an unpaid settlement blocks a new contract and survives an act', () => {
  it('a second contract cannot be signed while a claim is owed, until it is delivered', () => {
    const { run } = ownedLance();
    const second = arriveAs(
      run,
      'contract',
      run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed && n.row >= 2),
    );
    expect(contractBound(run)).toBe(true);
    expect(eventChoiceBlock(run, second.id, 'sign')).toBe('You are already bound by a contract.');
    expect(chooseEventOption(run, second.id, 'sign')).toEqual({
      ok: false,
      reason: 'You are already bound by a contract.',
    });
    expect(eventChoiceBlock(run, second.id, 'decline')).toBe('');
    const ctx = {
      run,
      node: second,
      nodeId: second.id,
      phase: 'o',
      choice: { id: 'sign' },
      page: 'start',
    };
    const terms = { type: 'contract', goal: 'noLosses', reward: [], penalty: [] };
    expect(planEffects(ctx, [terms])).toEqual({
      ok: false,
      reason: 'You are already bound by a contract.',
    });
    run.convoy.weapons.pop();
    expect(deliverContractSettlement(run).ok).toBe(true);
    expect(contractBound(run)).toBe(false);
    expect(eventChoiceBlock(run, second.id, 'sign')).toBe('');
  });

  it('the record survives an act transition and a save, and is not a hold in the new act', () => {
    const { run } = ownedLance();
    const owed = structuredClone(run.contractOwed);
    run.advanceAct();
    expect(run.currentAct).not.toBe('act1');
    expect(run.contractOwed).toEqual(owed);
    expect(roundTrip(run).contractOwed).toEqual(owed);
    expect(run.getAvailableNodes().length).toBeGreaterThan(0);
    expect(heldAt(run)).toBe(false);
    // still deliverable once room exists, wherever the party stands
    run.convoy.weapons.pop();
    expect(deliverContractSettlement(run).ok).toBe(true);
    expect(namedCount(run, 'Steel Lance')).toBe(1);
  });
});

describe('the saved record', () => {
  it('an old save has none; junk is dropped; a good record is kept as a copy', () => {
    const { run } = ownedLance();
    const saved = JSON.parse(JSON.stringify(run.toJSON()));
    expect(saved.contractOwed).toEqual(run.contractOwed);
    delete saved.contractOwed;
    expect(run.constructor.fromJSON(saved, run.gameData).contractOwed).toBeNull();
    for (const bad of [null, undefined, 5, 'x', [], {}, { kept: true }, { effects: [] }])
      expect(normalizeContractOwed(bad)).toBeNull();
    const raw = structuredClone(run.contractOwed);
    const kept = normalizeContractOwed(raw);
    expect(kept).toEqual(raw);
    kept.effects[0].name = 'Changed';
    expect(raw.effects[0].name).toBe('Steel Lance');
    // only effects a contract may hold survive a save
    const filtered = normalizeContractOwed({
      ...raw,
      effects: [...raw.effects, { type: 'battle' }, 'junk'],
    });
    expect(filtered.effects).toEqual(STEEL_LANCE);
  });
});

describe('an owed claim is never an open contract', () => {
  it('the chip model, the battle standing and the HUD read none', () => {
    const { run } = ownedLance();
    expect(contractOwedOf(run)).toMatchObject({ kept: true });
    expect(describeContract(run)).toBeNull();
    const next = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
    expect(contractSettlesBattle(run, next.id)).toBe(false);
    expect(contractStanding(run, { nodeId: next.id, turnCount: 99, turnPar: 1 })).toBeNull();
  });

  it('describeOwedContract says what waits and why, for the chip and the page', () => {
    const { run } = ownedLance();
    expect(describeOwedContract(run)).toMatchObject({
      label: 'Contract',
      short: 'Reward waiting',
      kept: true,
      owed: ['Steel Lance'],
      reason: 'No room for Steel Lance',
      blocked: true,
      failed: false,
    });
    expect(describeOwedContract(signed().run)).toBeNull();
  });
});

describe('the words', () => {
  it('say that an owed reward waits, and why', () => {
    const base = { kept: true, owed: true, results: [] };
    expect(settlementLines({ ...base, blocked: 'No room for Steel Lance' })).toEqual([
      'Contract kept: the reward waits — No room for Steel Lance',
    ]);
    expect(settlementLines({ ...base, failed: 'boom' })).toEqual([
      'Contract kept: the reward could not be paid yet',
    ]);
    expect(settlementLines({ kept: false, owed: true, results: [], failed: 'boom' })).toEqual([
      'Contract broken: the penalty could not be applied yet',
    ]);
    expect(settlementLines({ kept: true, results: [], forfeited: true })).toEqual([
      'Contract kept: you gave up the reward',
    ]);
  });

  it('the Event page says a no-room note the same way the band does', () => {
    const note = { kind: 'note', of: 'item', text: 'x', noRoom: true, name: 'Steel Lance' };
    expect(describeResult(note).text).toBe('No room for Steel Lance');
  });
});

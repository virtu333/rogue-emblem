// The contract settlement page (docs/specs/event-nodes-phase2.md "Contract settlement recovery"),
// played through the real ContractSettlementController and ContractSettlementMenu with the
// rendering-only presentation (tests/harness/ContractDriver.js). The engine decides everything
// (tests/ContractSettlementRecovery.test.js); these tests hold the page to what it must show and do.
//
// Ways this can fail, a test (or a group) each:
//   1. the page opens without saying what is owed and why it waits, or hides one of its ways on
//      (Claim, Roster, Back to map, Give up for a reward);
//   2. Claim with no room changes the run, loses the claim or says nothing; Claim with room does not
//      deliver exactly once, does not show what arrived, or does not save;
//   3. Roster leaves the page stale (the engine is not asked again) or loses the page;
//   4. Give up is unconfirmed, not terminal, not durable, or offered for a penalty;
//   5. Back to map / ESC traps the player or forgets the claim, or the map reopens the page by itself
//      after the player closed it (a tap or a reload does reopen it);
//   6. the chip and the pause list say nothing about a waiting settlement.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import './harness/JourneyTestSetup.js';
import { JourneyStorage } from './harness/RunDriver.js';
import { nodeText } from './harness/EventDriver.js';
import { ContractDriver } from './harness/ContractDriver.js';
import { arriveAtEvent, chooseEventOption, leaveEvent } from '../src/engine/EventCommands.js';
import { contractOwedOf, describeOwedContract } from '../src/engine/Contracts.js';
import { saveRun } from '../src/engine/RunManager.js';
import { owedContractChipModel, pauseBurdenEntries } from '../src/ui/eventMenuModel.js';
import { eventNode, runWithEvents } from './eventKit.js';
import { contractEvent } from './eventPhase2Kit.js';

vi.mock('../src/ui/MobileRosterSheet.js', () => ({
  MobileRosterSheet: class {
    constructor(options) {
      Object.assign(this, options);
    }
    destroy() {
      this.destroyed = true;
    }
  },
}));

let storage;
beforeEach(() => {
  storage = new JourneyStorage();
  vi.stubGlobal('localStorage', storage);
  vi.stubGlobal('document', { activeElement: null });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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

const carried = (run, name) =>
  run.roster.flatMap((u) => u.inventory).filter((i) => i.name === name).length +
  run.convoy.weapons.filter((i) => i.name === name).length;

/** A signed contract, a full army, a won battle: the reward is owed and the party held. */
function ownedPage({ reward = [{ type: 'item', name: 'Steel Lance' }], penalty } = {}) {
  const run = runWithEvents([contractEvent({ reward, ...(penalty ? { penalty } : {}) })], {
    seed: 61,
  });
  const node = eventNode(run);
  arriveAtEvent(run, node.id);
  expect(chooseEventOption(run, node.id, 'sign').ok).toBe(true);
  expect(leaveEvent(run, node.id).ok).toBe(true);
  fillArmy(run);
  const battle = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
  run.currentNodeId = battle.id;
  const lances = carried(run, 'Steel Lance'); // the starting kit already carries some
  run.completeBattle(run.getRoster(), battle.id, 100, { turnCount: 1, turnPar: 5 });
  const d = new ContractDriver({ run, nodeId: battle.id });
  d.lances = lances;
  d.gold = run.gold;
  return d;
}
const labels = (d) => d.buttons().map(nodeText);

describe('the page of an owed reward', () => {
  it('says what is owed and why it waits, and offers its four ways on', () => {
    const d = ownedPage();
    expect(d.open({ auto: true })).toBe(true);
    const text = d.text();
    expect(text).toContain('Contract kept');
    expect(text).toContain('The reward is waiting.');
    expect(text).toContain('No room for Steel Lance');
    expect(text).toContain('Make room in a bag or the convoy, then Claim.');
    expect(labels(d)).toEqual(
      expect.arrayContaining(['Claim', 'Back to map', 'Give up the reward', 'Roster']),
    );
    expect(labels(d)).not.toContain('Continue');
    expect(d.menu.closeButton.textContent).toBe('Back to map');
    expect(d.menu.primary).toBe(d.button('Claim'));
    // the route map's "a page is open" flag is up, and nothing was touched
    expect(d.scene.eventOverlay).toBeTruthy();
    expect(contractOwedOf(d.run)).toMatchObject({ kept: true, blocked: 'No room for Steel Lance' });
    expect(d.run.gold).toBe(d.gold);
  });

  it('is not opened for a run that owes nothing', () => {
    const d = ownedPage();
    d.run.contractOwed = null;
    expect(d.open()).toBe(false);
    expect(d.scene.eventOverlay).toBeNull();
  });
});

describe('Claim', () => {
  it('with no room changes nothing, says why it still waits and keeps the claim saved', () => {
    const d = ownedPage();
    d.open();
    const before = JSON.stringify(d.run.toJSON());
    d.press('Claim');
    expect(d.text()).toContain('Still waiting: No room for Steel Lance');
    expect(labels(d)).toContain('Claim');
    expect(JSON.stringify(d.run.toJSON())).toBe(before);
    expect(contractOwedOf(d.saved())).toMatchObject({ kept: true });
  });

  it('after room is made (the Roster) delivers exactly once, shows what arrived and saves', () => {
    const d = ownedPage();
    d.open();
    d.press('Roster'); // the player opens the roster ...
    expect(d.menu.child).toBeTruthy();
    d.run.convoy.weapons.pop(); // ... frees a convoy slot ...
    d.menu.child.onClose(); // ... and closes it: the page asks the engine again and saves
    expect(d.menu.child).toBeNull();
    expect(d.run.contractOwed).not.toBeNull();
    d.press('Claim');
    expect(carried(d.run, 'Steel Lance')).toBe(d.lances + 1);
    const text = d.text();
    expect(text).toContain('The reward arrived.');
    expect(text).toContain('Steel Lance');
    expect(labels(d)).toEqual(['Continue']);
    expect(d.menu.closeButton.textContent).toBe('Continue');
    expect(d.saved().contractOwed).toBeNull();
    expect(carried(d.saved(), 'Steel Lance')).toBe(d.lances + 1);
    // Continue closes the page, frees the party and checks the act, once
    d.press('Continue');
    expect(d.scene.eventOverlay).toBeNull();
    expect(d.scene.checkActComplete).toHaveBeenCalledTimes(1);
    expect(d.run.getAvailableNodes().map((n) => n.id)).not.toContain(d.node.id);
    expect(carried(d.run, 'Steel Lance')).toBe(d.lances + 1);
    expect(d.run.gold).toBe(d.gold);
  });

  it('delivers the whole reward at once, the gold with the item', () => {
    const d = ownedPage({
      reward: [
        { type: 'item', name: 'Steel Lance' },
        { type: 'gold', value: 600 },
      ],
    });
    expect(d.run.gold).toBe(d.gold); // nothing of the contract was paid at the victory
    d.run.convoy.weapons.pop();
    d.open();
    d.press('Claim');
    expect(d.run.gold).toBe(d.gold + 600);
    expect(d.text()).toContain('The reward arrived.');
  });
});

describe('Give up', () => {
  it('asks first: declining changes nothing, confirming is final and saved', () => {
    const d = ownedPage();
    d.open();
    d.press('Give up the reward');
    expect(d.picker.title).toBe('Give up the reward?');
    expect(d.picker.confirmation).toBe(true);
    expect(d.picker.closeLabel).toBe('Keep it owed');
    expect(d.picker.describe()).toContain('This cannot be undone.');
    d.menu.child.close(); // declined
    expect(contractOwedOf(d.run)).not.toBeNull();
    expect(d.text()).toContain('The reward is waiting.');
    d.press('Give up the reward');
    d.confirm();
    expect(d.run.contractOwed).toBeNull();
    expect(d.text()).toContain('You gave up the reward.');
    expect(carried(d.run, 'Steel Lance')).toBe(d.lances);
    expect(d.saved().contractOwed).toBeNull();
    expect(d.run.getAvailableNodes().map((n) => n.id)).not.toContain(d.node.id);
    d.press('Continue');
    expect(d.scene.eventOverlay).toBeNull();
    expect(d.scene.checkActComplete).toHaveBeenCalledTimes(1);
  });

  it('is not offered for a penalty (retried instead), which never holds the party', () => {
    const d = ownedPage({ reward: [], penalty: [{ type: 'gold', value: -40 }] });
    // a broken contract's penalty that failed to apply, as the engine leaves it
    d.run.contractOwed = {
      battleNodeId: d.node.id,
      contractNodeId: 'c1',
      eventId: 'contract',
      act: 'act1',
      goal: 'underPar',
      kept: false,
      noPar: false,
      losses: 0,
      effects: [{ type: 'gold', value: -40 }],
      seedKey: 'event-contract:61:c1',
      blocked: null,
      failed: 'The terms could not be met (x).',
    };
    saveRun(d.run, null, 1);
    expect(d.run.getAvailableNodes().map((n) => n.id)).not.toEqual([d.node.id]);
    d.open();
    const text = d.text();
    expect(text).toContain('Contract broken');
    expect(text).toContain('The penalty could not be applied yet.');
    expect(labels(d)).toEqual(expect.arrayContaining(['Try again', 'Back to map', 'Roster']));
    expect(labels(d)).not.toContain('Give up the reward');
    const gold = d.run.gold;
    d.press('Try again');
    expect(d.run.gold).toBe(gold - 40);
    expect(d.text()).toContain('The penalty was applied.');
  });
});

describe('Back to map', () => {
  it('closes without trapping: everything stays owed, a tap reopens, the map does not by itself', () => {
    const d = ownedPage();
    d.open();
    d.press('Back to map');
    expect(d.scene.eventOverlay).toBeNull();
    expect(d.scene.drawMap).toHaveBeenCalled();
    expect(contractOwedOf(d.saved())).toMatchObject({ kept: true });
    expect(d.run.getAvailableNodes().map((n) => n.id)).toEqual([d.node.id]);
    expect(d.run.canReenterService(d.node.id)).toBe(true);
    expect(d.open({ auto: true })).toBe(false); // the map does not force it back
    expect(d.open()).toBe(true); // a tap on the held node or the chip does
    expect(d.text()).toContain('The reward is waiting.');
  });

  it('ESC is Back to map too', () => {
    const d = ownedPage();
    d.open();
    d.esc();
    expect(d.scene.eventOverlay).toBeNull();
    expect(contractOwedOf(d.run)).not.toBeNull();
  });

  it('a reload reopens it by itself: the claim was saved', () => {
    const d = ownedPage();
    d.open();
    d.press('Back to map');
    d.reload();
    expect(d.run.getAvailableNodes().map((n) => n.id)).toEqual([d.node.id]);
    expect(d.open({ auto: true })).toBe(true);
    expect(d.text()).toContain('The reward is waiting.');
  });
});

describe('the chip and the pause list', () => {
  it('say a reward is waiting and why', () => {
    const d = ownedPage();
    const chip = owedContractChipModel(describeOwedContract(d.run));
    expect(chip).toMatchObject({
      id: 'contract',
      owed: true,
      label: 'Contract',
      short: 'Reward waiting',
    });
    expect(chip.terms).toContain('Owed: Steel Lance.');
    expect(chip.terms).toContain('No room for Steel Lance.');
    const entries = pauseBurdenEntries(d.run, d.run.gameData.events);
    expect(entries.find((e) => e.id === 'contract')).toMatchObject({ short: 'Reward waiting' });
    expect(owedContractChipModel(null)).toBeNull();
  });
});

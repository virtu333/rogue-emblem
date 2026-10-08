// A queued cloud write sends the run exactly as it was saved on the device, never as it is
// when the write gets its turn. The save hands the cloud the same object it just wrote to
// localStorage, and that object holds live state (the roster, the convoy); the write waits
// behind earlier writes and a remote read. Ways this goes wrong:
//   - the delayed write serializes the live convoy: an earlier save goes up holding a reward
//     claimed after it, beside the contract that save still owes, and a device that restores
//     it can be paid the reward twice;
//   - the delayed write carries a savedAt other than the one written locally;
//   - the meta queue has the same flaw (purchases made after a save ride along with the
//     currency that save had not yet spent).
// The run side drives the real commands: the victory commit, the roster's Discard, Claim
// (deliverContractSettlement), saveRun with the scenes' own onSave (pushRunSave).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = {};
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, val) => {
      store[key] = String(val);
    },
    removeItem: (key) => {
      delete store[key];
    },
    key: (i) => Object.keys(store)[i] ?? null,
    get length() {
      return Object.keys(store).length;
    },
  },
  writable: true,
});

const mocked = vi.hoisted(() => ({ fromMock: vi.fn() }));
vi.mock('../src/utils/errorReporter.js', () => ({ reportAsyncError: vi.fn() }));
vi.mock('../src/utils/startupTelemetry.js', () => ({ markStartup: vi.fn() }));
vi.mock('../src/cloud/supabaseClient.js', () => ({
  supabase: {
    from: mocked.fromMock,
    auth: { refreshSession: vi.fn(async () => ({ data: { session: {} }, error: null })) },
  },
}));

import {
  __flushCloudSyncQueuesForTests,
  __resetCloudSyncQueuesForTests,
  __resetCloudSyncStatusForTests,
  pushMeta,
  pushRunSave,
} from '../src/cloud/CloudSync.js';
import { RunManager, saveRun } from '../src/engine/RunManager.js';
import { getMetaKey, getRunKey } from '../src/engine/SlotManager.js';
import { arriveAtEvent, chooseEventOption, leaveEvent } from '../src/engine/EventCommands.js';
import { deliverContractSettlement } from '../src/engine/ContractSettlement.js';
import { contractRewardOwed } from '../src/engine/Contracts.js';
import { rosterItemAction } from '../src/engine/RosterInventory.js';
import { eventNode, runWithEvents } from './eventKit.js';
import { contractEvent } from './eventPhase2Kit.js';

/**
 * One cloud table. Its first remote read waits on `release`, as a slow network does, so
 * every later save queues behind it. `written` keeps each slot payload as the server got it.
 */
function slowTable() {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const state = { row: null, reads: 0, written: [] };
  const filterChain = (handler) => {
    const chain = {
      eq: () => chain,
      is: () => chain,
      select: () => chain,
      maybeSingle: handler,
    };
    return chain;
  };
  const api = {
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          if (state.reads++ === 0) await gate;
          if (!state.row) return { data: null, error: null };
          return { data: { data: state.row.data, updated_at: state.row.updated_at }, error: null };
        },
      }),
    }),
    insert: async (payload) => {
      state.written.push(JSON.parse(JSON.stringify(payload.data['1'])));
      state.row = { data: payload.data, updated_at: `rev-${state.written.length}` };
      return { error: null };
    },
    update: (payload) =>
      filterChain(async () => {
        state.written.push(JSON.parse(JSON.stringify(payload.data['1'])));
        state.row = { data: payload.data, updated_at: `rev-${state.written.length}` };
        return { data: { updated_at: state.row.updated_at }, error: null };
      }),
    delete: () => filterChain(async () => ({ data: null, error: null })),
    upsert: async () => ({ error: null }),
  };
  return { api, state, release: () => release() };
}

/** A won battle whose kept Steel Lance reward has nowhere to go: everything is full. */
function owedLance() {
  const run = runWithEvents([contractEvent({ reward: [{ type: 'item', name: 'Steel Lance' }] })], {
    seed: 61,
  });
  const node = eventNode(run);
  arriveAtEvent(run, node.id);
  expect(chooseEventOption(run, node.id, 'sign').ok).toBe(true);
  expect(leaveEvent(run, node.id).ok).toBe(true);
  for (const unit of run.roster) {
    while (unit.inventory.length < 5) unit.inventory.push(structuredClone(unit.inventory[0]));
  }
  const caps = run.getConvoyCapacities();
  run.convoy.weapons = Array.from({ length: caps.weapons }, (_, i) => ({
    ...structuredClone(run.gameData.weapons[0]),
    uid: `stored-${i}`,
  }));
  const battle = run.nodeMap.nodes.find((n) => n.type === 'battle' && !n.completed);
  run.currentNodeId = battle.id;
  expect(run.completeBattle(run.getRoster(), battle.id, 100, { turnCount: 1, turnPar: 5 })).toBe(
    true,
  );
  expect(run.contractOwed).toMatchObject({ kept: true, blocked: 'No room for Steel Lance' });
  return run;
}

/** Steel Lances anywhere in a saved run payload. */
const lancesIn = (payload) =>
  [...payload.roster.flatMap((unit) => unit.inventory), ...payload.convoy.weapons].filter(
    (item) => item.name === 'Steel Lance',
  ).length;

const SLOT = 1;
const cloudSave = (run) => saveRun(run, (d) => pushRunSave('user-1', SLOT, d), SLOT);

describe('a queued cloud write sends the run as it was saved', () => {
  beforeEach(() => {
    for (const key of Object.keys(store)) delete store[key];
    // A slot with readable progression: a slot without it is held back for recovery.
    store[getMetaKey(SLOT)] = JSON.stringify({ purchasedUpgrades: {}, savedAt: 1 });
    mocked.fromMock.mockReset();
    __resetCloudSyncQueuesForTests();
    __resetCloudSyncStatusForTests();
  });

  it('Discard, then Claim while the first write waits: each write holds its own save, paid once', async () => {
    const runTable = slowTable();
    mocked.fromMock.mockImplementation((table) =>
      table === 'run_saves' ? runTable.api : slowTable().api,
    );
    const run = owedLance();
    const owned = lancesIn(run.toJSON());

    // Save A: a convoy weapon discarded, the reward still owed. Its cloud write is held.
    expect(rosterItemAction(run, run.roster[0], run.convoy.weapons[0], 'discard')).toBe('');
    expect(cloudSave(run)).toMatchObject({ ok: true, cloud: { queued: true } });
    const savedA = JSON.parse(store[getRunKey(SLOT)]);

    // Save B: Claim pays the lance and clears what is owed, before A has gone up.
    expect(deliverContractSettlement(run).ok).toBe(true);
    expect(cloudSave(run).ok).toBe(true);
    const savedB = JSON.parse(store[getRunKey(SLOT)]);

    runTable.release();
    await __flushCloudSyncQueuesForTests();

    expect(runTable.state.written).toHaveLength(2);
    const [cloudA, cloudB] = runTable.state.written;
    // A went up as it was saved: no lance, still owed, the same savedAt.
    expect(lancesIn(cloudA)).toBe(owned);
    expect(cloudA.contractOwed).toMatchObject({ kept: true });
    expect(cloudA).toEqual(savedA);
    // B: the lance, nothing owed.
    expect(lancesIn(cloudB)).toBe(owned + 1);
    expect(cloudB.contractOwed).toBeNull();
    expect(cloudB).toEqual(savedB);

    // A device that restores A (B never arrived) is still owed the lance and is paid it once.
    const restored = RunManager.fromJSON(cloudA, run.gameData);
    expect(contractRewardOwed(restored)).toBe(true);
    expect(deliverContractSettlement(restored).ok).toBe(true);
    expect(lancesIn(restored.toJSON())).toBe(owned + 1);
    expect(deliverContractSettlement(restored)).toBeNull();
    expect(lancesIn(restored.toJSON())).toBe(owned + 1);
  });

  it('a queued meta write keeps the payload it was handed, not later changes to it', async () => {
    const metaTable = slowTable();
    mocked.fromMock.mockImplementation((table) =>
      table === 'meta_progression' ? metaTable.api : slowTable().api,
    );
    const purchased = { vanguard: 1 };
    pushMeta('user-1', SLOT, { valor: 100, purchasedUpgrades: purchased, savedAt: 1000 });
    // The game spends after the save: a live map changes while the write waits.
    purchased.forge = 2;

    metaTable.release();
    await __flushCloudSyncQueuesForTests();

    expect(metaTable.state.written).toEqual([
      { valor: 100, purchasedUpgrades: { vanguard: 1 }, savedAt: 1000 },
    ]);
  });
});

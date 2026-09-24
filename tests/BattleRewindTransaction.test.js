import { describe, it, expect, vi, afterEach } from 'vitest';
import { prepareBattleRewind, persistBattleRewind } from '../src/engine/BattleRewindTransaction.js';
import { createBattleRng } from '../src/engine/BattleRng.js';
import { RunManager, saveRun, clearBattleInProgressInSave } from '../src/engine/RunManager.js';
import { getRunKey } from '../src/engine/SlotManager.js';
import { captureBattleState } from '../src/ui/BattleCheckpointAdapter.js';
afterEach(() => vi.unstubAllGlobals());
function fixture() {
  const rm = new RunManager({});
  rm.visionChargesRemaining = 2;
  rm.visionCount = 0;
  rm.beginBattleInProgress('a', {});
  const state = captureBattleState(
    {
      playerUnits: [],
      enemyUnits: [],
      npcUnits: [],
      grid: { mapLayout: [[0]] },
      runManager: rm,
      _battleRewindPolicy: 'fixed-v1',
      _battleRng: createBattleRng(42),
    },
    { rngSeed: 42 },
  );
  return { rm, state };
}
describe('durable rewind candidate', () => {
  it('writes target + debit + run domain + branch in one real slot record', () => {
    const store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
    });
    const { rm, state } = fixture();
    state.runBattleState.convoy.consumables = [{ name: 'Vulnerary', uses: 3 }];
    const current = structuredClone(rm.toJSON());
    const prepared = prepareBattleRewind(current, state, { history: { revision: 1 } });
    const result = persistBattleRewind(prepared, (candidate) =>
      saveRun({ toJSON: () => candidate }, null, 1),
    );
    expect(result.ok).toBe(true);
    const durable = JSON.parse(store.get(getRunKey(1)));
    expect(durable.visionChargesRemaining).toBe(1);
    expect(durable.battleInProgress.checkpoint.rngState).toEqual(state.rngState);
    expect(durable.convoy).toEqual(state.runBattleState.convoy);
    expect(durable.battleInProgress.timeline).toEqual({ revision: 1 });
    expect(rm.toJSON()).toEqual(current);
  });
  it('failed and throwing writes publish no candidate and mutate no inputs', () => {
    const { rm, state } = fixture(),
      before = structuredClone(rm.toJSON());
    const prepared = prepareBattleRewind(before, state);
    for (const writer of [
      () => ({ ok: false, reason: 'quota' }),
      () => {
        throw new Error('storage');
      },
    ])
      expect(persistBattleRewind(prepared, writer).ok).toBe(false);
    expect(rm.toJSON()).toEqual(before);
    expect(prepareBattleRewind(before, state).candidate).toEqual(prepared.candidate);
  });
  it('rejects stale battle, branch, policy, continuation, bad cursor and depleted charge', () => {
    const { rm, state } = fixture(),
      run = rm.toJSON();
    for (const [r, s, opts] of [
      [run, state, { expectedBattle: -1 }],
      [run, state, { expectedRevision: 4 }],
      [run, { ...state, rewindPolicy: 'legacy-v1' }, {}],
      [run, { ...state, pendingActionCompletion: { kind: 'finish' } }, {}],
      [run, { ...state, rngState: null }, {}],
      [{ ...run, visionChargesRemaining: 0 }, state, {}],
    ])
      expect(prepareBattleRewind(r, s, opts).ok).toBe(false);
  });
  it('full-map reset restores entry supplies and blocks a resolved fatal state', () => {
    const store = new Map();
    vi.stubGlobal('localStorage', {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => store.set(k, v),
    });
    const { rm } = fixture();
    const entry = structuredClone(rm.convoy);
    rm.convoy.consumables.push({ name: 'Village prize' });
    saveRun(rm, null, 1);
    expect(clearBattleInProgressInSave(null, 1).ok).toBe(true);
    expect(JSON.parse(store.get(getRunKey(1))).convoy).toEqual(entry);
    rm.battleInProgress.checkpoint = { recoveryKind: 'fatal_pending' };
    saveRun(rm, null, 1);
    const before = store.get(getRunKey(1));
    expect(clearBattleInProgressInSave(null, 1)).toEqual({ ok: false, reason: 'fatal_pending' });
    expect(store.get(getRunKey(1))).toBe(before);
  });
});

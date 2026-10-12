// sim/descent.js: Act V played twice from one entry state (docs/sim-reports/act-v-descent.md).
// The report's comparisons are only as good as the pairing, so these hold it.
//
// Each test names the realistic failure it catches.
import { describe, it, expect } from 'vitest';
import { loadGameData } from '../testData.js';
import { RunManager } from '../../src/engine/RunManager.js';
import { installStatefulSeed, restoreStatefulRandom } from '../../sim/lib/StatefulRNG.js';
import {
  descentGameData,
  legacyGameData,
  noLandingGameData,
  parseStoneOverride,
  permadeathView,
  playActV,
  revivalStonesForReplay,
} from '../../sim/descent.js';

const data = loadGameData();

/** An entry state at the final act's door, with an army strong enough to walk it. */
function entryCapture(difficulty, seed, { strong = true } = {}) {
  const rng = installStatefulSeed(seed);
  try {
    const rm = new RunManager(data);
    rm.startRun({ runSeed: seed, difficultyId: difficulty, applyBlessingsAtStart: false });
    rm.actIndex = rm.actSequence.indexOf('finalBoss') - 1;
    for (const unit of rm.roster.filter(() => strong)) {
      Object.assign(unit.stats, { HP: 80, STR: 45, MAG: 45, SKL: 40, SPD: 40, DEF: 40, RES: 40 });
      unit.currentHP = unit.stats.HP;
    }
    return {
      kind: 'capture',
      difficulty,
      seed,
      meta: 'none',
      result: 'paused',
      run: rm.toJSON(),
      rngState: rng.getState(),
    };
  } finally {
    restoreStatefulRandom();
  }
}

describe('sim:descent pairs the two Act Vs on one entry state', () => {
  it('sets the route’s switch for its own copy, never in the data', () => {
    // Failure: the sim flips `enabled` on the loaded data (shared by every arm and test), so one
    // arm's switch leaks into the other's (the legacy arm plays the Descent too, or the reverse),
    // or the legacy arm reads the shipped flag (on) and is no legacy act at all.
    expect(data.descent.enabled).toBe(true); // as shipped
    const dark = { ...data, descent: { ...structuredClone(data.descent), enabled: false } };
    const on = descentGameData(dark);
    expect(on.descent.enabled).toBe(true);
    expect(dark.descent.enabled).toBe(false);
    const legacy = legacyGameData(data);
    expect(legacy.descent.enabled).toBe(false);
    expect(data.descent.enabled).toBe(true);
    const off = noLandingGameData(dark);
    expect(off.descent.enabled).toBe(true);
    expect(dark.descent.enabled).toBe(false);
    expect(
      data.descent.routes.entity.rows.some((r) => r.nodes.some((n) => n.key === 'landing')),
    ).toBe(true);
    expect(
      off.descent.routes.entity.rows.some((r) => r.nodes.some((n) => n.key === 'landing')),
    ).toBe(false);
    expect(
      dark.descent.routes.entity.rows.some((r) => r.nodes.some((n) => n.key === 'landing')),
    ).toBe(true);
  });

  it('legacy plays the two-node act, the Descent its route, from the same entry', async () => {
    // Failure: an arm is not the act it names (a stale map, a Rite on the legacy act).
    const capture = entryCapture('hard', 43);
    const legacy = await playActV(data, capture, 'legacy');
    const descent = await playActV(data, capture, 'descent');
    const noLanding = await playActV(data, capture, 'nolanding');
    expect(legacy.routeId).toBeNull();
    expect(legacy.riteStart).toBeNull();
    expect(legacy.battles.length).toBe(1);
    expect(descent.routeId).toBe('entity');
    expect(descent.path.map((p) => p.key)).toContain('landing');
    expect(descent.battles.map((b) => b.descentKey)).toEqual(
      expect.arrayContaining(['stair', 'vigil', 'gate', 'entity']),
    );
    expect(noLanding.path.map((p) => p.key)).not.toContain('landing');
    expect(noLanding.battles.map((b) => b.descentKey)).toContain('gate');
  }, 120_000);

  it('an arm replayed from the same entry plays the same act (the pairing is exact)', async () => {
    // Failure: the entry state or the stream is not put back (a shared object mutated by the
    // first arm, the stream left where the last arm stopped), so the arms are not paired.
    // The army as it starts (no buffs), so the dice decide fights and an unpaired stream shows.
    const capture = entryCapture('normal', 41, { strong: false });
    const first = await playActV(data, capture, 'descent');
    await playActV(data, capture, 'legacy');
    const again = await playActV(data, capture, 'descent');
    expect(again).toEqual(first);
  }, 120_000);

  it('reads a run as lost at its first commander fall or stall (permadeath)', () => {
    // Failure: a later win is counted after a fall that ended the run, or a stall as a clear.
    const won = { commanderKOs: 0, stalled: false };
    const record = (battles, result = 'victory') => ({ battles, result });
    expect(permadeathView(record([won, won])).cleared).toBe(true);
    const fell = permadeathView(record([won, { commanderKOs: 1, stalled: false }, won]));
    expect(fell.cleared).toBe(false);
    expect(fell.fought.length).toBe(2);
    expect(permadeathView(record([{ commanderKOs: 0, stalled: true }, won])).cleared).toBe(false);
    expect(permadeathView(record([won], 'timeout')).cleared).toBe(false);
  });

  it('an Act V replay plays the checkout’s stone table, not the capture’s snapshot', async () => {
    // Failure: a capture made before a stone retune carries the old count in its run, so every
    // retune is replayed under the old number and the report measures nothing.
    const capture = entryCapture('hard', 43);
    capture.run.difficultyModifiers.revivalStones = {
      actBoss: 1,
      emperor: 1,
      lieutenant: 0,
      eliteCaptain: 0,
    };
    const shipped = data.difficulty.modes.hard.revivalStones;
    expect(shipped.lieutenant).toBeGreaterThan(0);
    const played = await playActV(data, capture, 'descent', { stones: null });
    expect(played.stones).toEqual(shipped);
    const over = await playActV(data, capture, 'descent', { stones: 'lieutenant=1' });
    expect(over.stones).toEqual({ ...shipped, lieutenant: 1 });
    expect(revivalStonesForReplay(data, 'hard', { lieutenant: 1 }).emperor).toBe(shipped.emperor);
  });

  it('reads --stones as kind=count pairs and refuses a stranger', () => {
    expect(parseStoneOverride('lieutenant=1')).toEqual({ lieutenant: 1 });
    expect(parseStoneOverride('lieutenant=2,emperor=0')).toEqual({ lieutenant: 2, emperor: 0 });
    expect(parseStoneOverride('')).toEqual({});
    expect(() => parseStoneOverride('entity=1')).toThrow(/--stones/);
    expect(() => parseStoneOverride('lieutenant=x')).toThrow(/--stones/);
  });
});

// The run-start blessing effects, replayed against a fixture written from the code BEFORE the
// handler table (origin/main at 236856d1, the old if-chain in RunManager). Every case is an
// effect (or a short scenario) applied to a fresh seeded run; its fingerprint hashes the state it
// changed (the `toJSON` diff, random ids normalized), the items it granted, the blessing event
// history (as a run-start and as a mid-run grant), and the RNG (draws taken, the next value, the
// restored `Math.random`). tools/blessingEffectFingerprints.mjs holds the cases and writes the
// fixture; the header comment there says how to run it against any ref.
//
// Ways this can fail, a test each:
//   1. a handler's behaviour drifts (a state write, an item, a history record, a draw) - the
//      replay names every case whose hash moved, with the fixture's summary beside the new one;
//   2. the fingerprint stops seeing a kind of change (a stale tool) - the planted-change cases
//      change one handler's gold, history or draws and require the fingerprints to move for
//      that effect and for nothing else;
//   3. the fixture and the cases fall out of step (a case added or dropped without regenerating).
//
// A deliberate behaviour change to a handler regenerates the fixture on purpose:
//   node tools/blessingEffectFingerprints.mjs --write
// and the PR says why (the fixture's `generatedFrom` then names the new base).
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  computeFingerprints,
  dataHash,
  FIXTURE_PATH,
} from '../tools/blessingEffectFingerprints.mjs';
import { loadGameData } from './testData.js';

const gameData = loadGameData();
const fixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'));
const hashOf = (entry) => String(entry).split(' | ')[0];

// The cases whose fingerprint differs from the fixture's; a case missing on either side counts.
// `partial` is a run of some cases only: the fixture's other cases are not asked about.
function movedCases(now, { partial = false } = {}) {
  const labels = partial ? Object.keys(now) : Object.keys({ ...fixture.cases, ...now });
  return labels.filter((label) => hashOf(fixture.cases[label] || '') !== hashOf(now[label] || ''));
}

describe('run-start blessing effects match the pre-table fingerprints', () => {
  let current;
  beforeAll(() => {
    current = computeFingerprints({ RunManager, gameData });
  }, 120000);

  it('replays every case of the fixture to the same fingerprint', () => {
    const moved = movedCases(current);
    const report = moved.map(
      (label) => `${label}\n    was: ${fixture.cases[label]}\n    now: ${current[label]}`,
    );
    const hint =
      dataHash(gameData) === fixture.dataHash
        ? ''
        : "\n(the non-blessing game data differs from the fixture's)";
    expect(report.join('\n') + hint).toBe('');
  });

  it('holds the same set of cases, and enough of them', () => {
    expect(Object.keys(current).sort()).toEqual(Object.keys(fixture.cases).sort());
    expect(fixture.caseCount).toBe(Object.keys(fixture.cases).length);
    expect(fixture.caseCount).toBeGreaterThanOrEqual(700);
    // The fixture was written from the code before the table, not from this branch.
    expect(fixture.generatedFrom).toMatch(/^236856d1/);
  });

  describe('is sensitive to a change in one handler', () => {
    const sampled = new Set(Object.keys(fixture.cases).filter((_, at) => at % 12 === 0));
    // Each subclass perturbs only `gold_delta` after the real dispatcher has run.
    function plantedFingerprints(perturb) {
      class Planted extends RunManager {
        _applySingleRunStartBlessingEffect(blessingId, effect) {
          super._applySingleRunStartBlessingEffect(blessingId, effect);
          if (effect && effect.type === 'gold_delta') perturb(this, blessingId, effect);
        }
      }
      // The gold_delta and dispatcher cases, and a spread of the others to show they hold.
      const only = (label) => /^(gold_delta|dispatch:)/.test(label) || sampled.has(label);
      return computeFingerprints({ RunManager: Planted, gameData }, { only });
    }

    function expectOnlyGoldDeltaMoved(planted) {
      const moved = movedCases(planted, { partial: true });
      // The gold_delta cases move; no other effect's fingerprint does.
      expect(moved.filter((label) => label.startsWith('gold_delta')).length).toBeGreaterThanOrEqual(
        5,
      );
      expect(moved.filter((label) => !/^(gold_delta|dispatch:)/.test(label))).toEqual([]);
    }

    it('a state write: one extra gold', () => {
      expectOnlyGoldDeltaMoved(plantedFingerprints((run) => run.addGold(1)));
    });

    it('a history record: the grant is not recorded', () => {
      expectOnlyGoldDeltaMoved(
        plantedFingerprints((run) => {
          run.blessingHistory.pop();
        }),
      );
    });

    it('an RNG draw: the handler draws once', () => {
      expectOnlyGoldDeltaMoved(plantedFingerprints(() => Math.random()));
    });

    it('a history field: the record carries another value', () => {
      expectOnlyGoldDeltaMoved(
        plantedFingerprints((run) => {
          const last = run.blessingHistory[run.blessingHistory.length - 1];
          if (last?.details) last.details.appliedValue = (last.details.appliedValue ?? 0) + 1;
        }),
      );
    });
  });
});

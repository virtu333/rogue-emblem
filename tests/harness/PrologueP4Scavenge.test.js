// Prologue P4, "The Quarry Gate", after the watchtower's Scavenge (docs/specs/prologue-
// chapter.md §6 P4 and §6 "Route map, row 4"): the army enters with the wounds P3 left
// (HP carries; nothing bought), from P3's real end states (both policies), with every
// deploy the screen allows, under both policies, before the boss's enrage turn. With a
// healer fielded (Sera) the chapter keeps §8's forgiving bar; without one, a share of
// the entering states leave Edric or Gaspar too hurt to fight and nothing to mend them,
// and the floors below say what the chapter still guarantees there (a fall restarts P4
// at its deploy screen, where Sera can be picked).
import { afterEach, describe, expect, it } from 'vitest';
import { restoreMathRandom } from '../../sim/lib/SeededRNG.js';
import {
  intended,
  naive,
  p3EndStates,
  afterWatchtower,
  tally,
  report,
  DEPLOYS,
} from './prologueP4Policies.js';

afterEach(() => restoreMathRandom());

const label = (deploy) => deploy.join('+');
/** The floors per policy: with a healer, §8's bar; without one, what the chapter holds. */
const FLOORS = {
  healer: { intended: 0.95, naive: 0.85 },
  noHealer: { intended: 0.85, naive: 0.8 },
};

describe('Prologue P4 after Scavenge: the wounds P3 left', () => {
  for (const [name, policy] of [
    ['intended', intended],
    ['naive', naive],
  ]) {
    it(`the ${name} play: with Sera fielded it wins as rested; without a healer it holds its floor`, async () => {
      for (const policyEnds of ['intended', 'naive']) {
        const ends = (await p3EndStates({ policy: policyEnds })).map((u) =>
          afterWatchtower(u, { rest: false }),
        );
        for (const deploy of DEPLOYS) {
          const t = await tally(policy, ends, { seeds: 100, deploy });
          report(`${name} after ${policyEnds} P3, Scavenge, ${label(deploy)}`, t);
          const floor = FLOORS[deploy.includes('Sera') ? 'healer' : 'noHealer'][name];
          expect(t.wins, `${policyEnds} P3, ${label(deploy)}`).toBeGreaterThanOrEqual(t.total * floor); // prettier-ignore
        }
      }
    }, 1800000);
  }
});

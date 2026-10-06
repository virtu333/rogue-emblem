// Shared fixtures for the Phase 2 engine tests (docs/specs/event-nodes-phase2.md §2A): events
// built from the new vocabulary (pages, counters, join, contract, routeEdit, tells), the save
// round trip, and a won battle. Plain data; nothing here calls the engine under test except
// what a test asks for.
import { RunManager } from '../src/engine/RunManager.js';

/** The run as a save would carry it and a fresh process load it. */
export const roundTrip = (run) =>
  RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), run.gameData);

const need = (n) => ({ counterAtLeast: { key: 'torches', n }, reason: 'The last torch is gone.' });
const torch = [{ type: 'counter', key: 'torches', delta: -1 }];

/**
 * A three-level mine: torches 3 (Black Sun 2), "Go deeper" spends one, "Climb out" ends the
 * event, the last level holds a guardian (a fight with spoils). Every outcome is 50/50 so a
 * seed sweep sees both.
 */
export const mineEvent = () => ({
  id: 'mine',
  title: 'The Mine',
  weight: 1,
  intro: 'A shaft, a rope and three torches.',
  counters: { torches: 3 },
  countersByRung: { torches: { lunatic: 2 } },
  counterLabels: { torches: 'Torches' },
  choices: [
    {
      id: 'deeper',
      label: 'Go deeper',
      requires: need(1),
      effects: torch,
      outcomes: [
        {
          id: 'ore',
          weight: 50,
          text: 'Ore, glinting.',
          next: 'level_two',
          effects: [{ type: 'gold', value: 10 }],
        },
        { id: 'dust', weight: 50, text: 'Only dust.', next: 'level_two', effects: [] },
      ],
    },
    {
      id: 'climb',
      label: 'Climb out',
      outcomes: [{ id: 'out', weight: 100, text: 'Daylight.', effects: [] }],
    },
  ],
  pages: {
    level_two: {
      text: 'The tunnel narrows.',
      choices: [
        {
          id: 'deeper',
          label: 'Deeper still',
          requires: need(1),
          effects: torch,
          outcomes: [
            {
              id: 'chest',
              weight: 50,
              text: 'An old pay chest.',
              next: 'level_three',
              effects: [{ type: 'gold', value: 100 }],
            },
            { id: 'rats', weight: 50, text: 'Rats.', next: 'level_three', effects: [] },
          ],
        },
        {
          id: 'climb',
          label: 'Climb out',
          outcomes: [
            {
              id: 'out',
              weight: 100,
              text: 'Daylight, with a coin.',
              effects: [{ type: 'gold', value: 5 }],
            },
          ],
        },
      ],
    },
    level_three: {
      text: 'Something sleeps here.',
      choices: [
        {
          id: 'wake',
          label: 'Wake it',
          outcomes: [
            {
              id: 'fight',
              weight: 100,
              text: 'It wakes.',
              effects: [
                {
                  type: 'battle',
                  victoryText: 'It lies still. The hoard is yours.',
                  afterVictory: [{ type: 'gold', value: 200 }],
                },
              ],
            },
          ],
        },
        {
          id: 'climb',
          label: 'Climb out',
          outcomes: [{ id: 'out', weight: 100, text: 'You leave it be.', effects: [] }],
        },
      ],
    },
  },
});

/** A loop on one page: spend a torch to go round again; climbing out ends it. */
export const loopEvent = () => ({
  id: 'loop',
  title: 'The Loop',
  weight: 1,
  intro: 'A torch burns.',
  counters: { torches: 3 },
  choices: [
    {
      id: 'again',
      label: 'Again',
      requires: need(1),
      effects: torch,
      outcomes: [{ id: 'round', weight: 100, text: 'Round.', next: 'ring', effects: [] }],
    },
    {
      id: 'climb',
      label: 'Climb out',
      outcomes: [{ id: 'out', weight: 100, text: 'Out.', effects: [] }],
    },
  ],
  pages: {
    ring: {
      text: 'Still here.',
      choices: [
        {
          id: 'again',
          label: 'Again',
          requires: need(1),
          effects: torch,
          outcomes: [{ id: 'round', weight: 100, text: 'Round.', next: 'ring', effects: [] }],
        },
        {
          id: 'climb',
          label: 'Climb out',
          outcomes: [{ id: 'out', weight: 100, text: 'Out.', effects: [] }],
        },
      ],
    },
  },
});

/** Two pages with the same choice id and a fair coin each: are the two rolls independent? */
export const coinEvent = () => ({
  id: 'coin',
  title: 'The Coin',
  weight: 1,
  intro: 'A coin.',
  choices: [
    {
      id: 'go',
      label: 'Toss',
      outcomes: [
        { id: 'heads', weight: 50, text: 'Heads.', next: 'b', effects: [] },
        { id: 'tails', weight: 50, text: 'Tails.', next: 'b', effects: [] },
      ],
    },
  ],
  pages: {
    b: {
      text: 'Again.',
      choices: [
        {
          id: 'go',
          label: 'Toss',
          outcomes: [
            { id: 'heads', weight: 50, text: 'Heads.', effects: [] },
            { id: 'tails', weight: 50, text: 'Tails.', effects: [] },
          ],
        },
      ],
    },
  },
});

/**
 * A contract event. `goal` and the two effect lists are the terms; a second always-open
 * choice declines.
 */
export const contractEvent = ({
  goal = 'underPar',
  reward = [{ type: 'gold', value: 600 }],
  penalty = [{ type: 'burden', id: 'debt', params: { owed: 300 } }],
  id = 'contract',
} = {}) => ({
  id,
  title: 'The Contract',
  weight: 1,
  intro: 'A captain offers terms.',
  choices: [
    {
      id: 'sign',
      label: 'Sign',
      outcomes: [
        {
          id: 'signed',
          weight: 100,
          text: 'Signed.',
          effects: [{ type: 'contract', goal, reward, penalty }],
        },
      ],
    },
    {
      id: 'decline',
      label: 'Decline',
      outcomes: [{ id: 'no', weight: 100, text: 'No.', effects: [] }],
    },
  ],
});

// Review-only Events for the Phase 2 pages (docs/specs/event-nodes-phase2.md §2E): the shapes the
// real content (`data/events.json`) uses, one per UI surface, so a page can be looked at and
// played (`?devScene=nodemap&preset=event&seed=42&event=dev_mine`) before, or without, the
// shipped events that use it. Reached only through devStartup's event preset; a real run never
// reads this file, and nothing here is game data.
//
//   dev_mine      three pages, the torches counter, a spent torch in every step, and a Thief's tell
//   dev_contract  two contracts (under par / no losses) and a way to decline
//   dev_roads     the route edits: a new road, a place redrawn (both with a fallback), and leaving
//   dev_join      someone who joins the army, with a long name and long copy
//   dev_stress    the longest strings the page must hold: labels, hints, tells, results, a price
//
// `units` are roster additions the fixture's tells need (a Thief aboard speaks up in dev_mine).

const torch = [{ type: 'counter', key: 'torches', delta: -1 }];
const needTorch = {
  counterAtLeast: { key: 'torches', n: 1 },
  reason: 'The last torch has guttered out.',
};

const mine = {
  id: 'dev_mine',
  title: 'The Deep Mine',
  weight: 1,
  intro: 'A shaft, a rope and three torches. The air smells of wet iron and old fires.',
  counters: { torches: 3 },
  counterLabels: { torches: 'Torches' },
  choices: [
    {
      id: 'deeper',
      label: 'Go deeper',
      hint: 'The rope creaks. It holds.',
      requires: needTorch,
      effects: torch,
      tells: [
        {
          when: { class: 'Thief' },
          line: '{name}: This tunnel breathes. There is a way out.',
          reveals: 'ore',
        },
      ],
      outcomes: [
        {
          id: 'ore',
          weight: 100,
          text: 'Ore, glinting in the lamplight. Someone left their pick behind.',
          next: 'level_two',
          effects: [{ type: 'gold', value: 40 }],
        },
      ],
    },
    {
      id: 'climb',
      label: 'Climb out',
      outcomes: [{ id: 'out', weight: 100, text: 'Daylight, and nothing else.', effects: [] }],
    },
  ],
  pages: {
    level_two: {
      text: 'The tunnel narrows to a crawl. A rusted cart sits on dead rails.',
      choices: [
        {
          id: 'deeper',
          label: 'Deeper still',
          requires: needTorch,
          effects: torch,
          outcomes: [
            {
              id: 'chest',
              weight: 100,
              text: 'An old pay chest, never collected. The hinges give at a touch.',
              next: 'level_three',
              effects: [{ type: 'gold', value: 120 }],
            },
          ],
        },
        {
          id: 'climb',
          label: 'Climb out with the ore',
          outcomes: [
            {
              id: 'out',
              weight: 100,
              text: 'You climb out with what you have.',
              effects: [{ type: 'gold', value: 10 }],
            },
          ],
        },
      ],
    },
    level_three: {
      text: 'Something sleeps here, curled around a hoard.',
      choices: [
        {
          id: 'take',
          label: 'Take the hoard and run',
          outcomes: [
            {
              id: 'hoard',
              weight: 100,
              text: 'It does not wake. You do not look back.',
              effects: [
                { type: 'gold', value: 200 },
                { type: 'shadow', value: 2 },
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
};

const contract = {
  id: 'dev_contract',
  title: 'The Mercenary Contract',
  weight: 1,
  intro: 'A captain in a clean coat unrolls terms on a drumhead. She does not ask twice.',
  choices: [
    {
      id: 'par',
      label: 'Win the next fight under par',
      hint: 'Fast, or not at all.',
      outcomes: [
        {
          id: 'signed',
          weight: 100,
          text: 'The captain signs. "Quick, then."',
          effects: [
            {
              type: 'contract',
              goal: 'underPar',
              reward: [{ type: 'gold', value: 600 }],
              penalty: [{ type: 'burden', id: 'debt', params: { owed: 300 } }],
            },
          ],
        },
      ],
    },
    {
      id: 'clean',
      label: 'Win the next fight with no one lost',
      outcomes: [
        {
          id: 'signed',
          weight: 100,
          text: 'The captain nods. "Everyone home."',
          effects: [
            {
              type: 'contract',
              goal: 'noLosses',
              reward: [{ type: 'gold', value: 400 }],
              penalty: [{ type: 'hp', mode: 'damage', percent: 10, scope: 'all' }],
            },
          ],
        },
      ],
    },
    {
      id: 'decline',
      label: 'Decline',
      outcomes: [{ id: 'no', weight: 100, text: 'She rolls the terms up again.', effects: [] }],
    },
  ],
};

const roads = {
  id: 'dev_roads',
  title: 'The Cartographer',
  weight: 1,
  intro: 'A woman sits on a milestone with an inkwell, a pen and a map that is not finished.',
  choices: [
    {
      id: 'guide',
      label: 'Hire her as a guide',
      hint: 'She knows a road that is not on any map. Yet.',
      outcomes: [
        {
          id: 'road',
          weight: 100,
          text: '"Follow the cairns," she says, and draws it as you walk.',
          effects: [{ type: 'routeEdit', op: 'addRoad' }],
          fallback: [{ type: 'gold', value: 30 }],
          fallbackText: '"No road is missing here," she says, and refunds a little.',
        },
      ],
    },
    {
      id: 'ask',
      label: 'Ask about the road ahead',
      outcomes: [
        {
          id: 'village',
          weight: 100,
          text: '"There is a village past the ridge. Smoke from the chimneys."',
          effects: [{ type: 'routeEdit', op: 'redraw', toType: 'shop' }],
          fallback: [{ type: 'gold', value: 10 }],
          fallbackText: '"I have nothing to add," she says.',
        },
      ],
    },
    {
      id: 'leave',
      label: 'Leave her to it',
      outcomes: [{ id: 'gone', weight: 100, text: 'She does not look up.', effects: [] }],
    },
  ],
};

const join = {
  id: 'dev_join',
  title: 'The Volunteer',
  weight: 1,
  intro: 'A young archer stands at the roadside with a bow and a bundle. "I heard you were short."',
  choices: [
    {
      id: 'take',
      label: 'Take her on',
      outcomes: [
        {
          id: 'joined',
          weight: 100,
          text: 'She falls in at the back, already counting arrows.',
          effects: [{ type: 'join', class: 'Archer' }],
        },
      ],
    },
    {
      id: 'send',
      label: 'Send her home',
      outcomes: [{ id: 'sent', weight: 100, text: 'She goes, glancing back twice.', effects: [] }],
    },
  ],
};

// The longest strings the page must hold (UI Polish Guidelines: longest-string testing).
const stress = {
  id: 'dev_stress',
  title: 'The Merchant of Unreasonably Long Titles',
  weight: 1,
  intro:
    'A stall at the crossroads, hung with lanterns of every colour, and a merchant who talks without breathing about the provenance of everything he sells and the unfairness of tolls.',
  counters: { torches: 3, favours: 12 },
  counterLabels: { torches: 'Torches in the lamp room', favours: 'Favours owed' },
  choices: [
    {
      id: 'long',
      label: 'Buy the Sealed Reliquary of the Seventh Lantern',
      hint: 'He swears it is genuine, and swears again when you do not answer.',
      cost: { gold: 150 },
      tells: [
        {
          when: { class: 'Thief' },
          line: '{name}: That seal has been lifted and glued back at least twice, friend.',
          reveals: 'fake',
        },
      ],
      outcomes: [
        {
          id: 'fake',
          weight: 100,
          text: 'The seal comes away in your hand. Inside is a note, in his handwriting, apologising in advance.',
          next: 'haggle',
          effects: [{ type: 'burden', id: 'ill_omen' }],
        },
      ],
    },
    {
      id: 'shut',
      label: 'This choice is greyed out for the look of it',
      requires: {
        goldAtLeast: 99999,
        reason: 'You could not afford it if you sold the army. Twice.',
      },
      outcomes: [{ id: 'x', weight: 100, text: 'Never.', effects: [] }],
    },
    {
      id: 'walk',
      label: 'Walk on',
      outcomes: [
        {
          id: 'on',
          weight: 100,
          text: 'He is still talking when you round the bend.',
          effects: [],
        },
      ],
    },
  ],
  pages: {
    haggle: {
      text: 'He wrings his hands. "A misunderstanding. Allow me to make it right, at a price."',
      choices: [
        {
          id: 'refund',
          label: 'Demand a refund',
          outcomes: [
            {
              id: 'refunded',
              weight: 100,
              text: 'He pays, weeping, in coins that are slightly the wrong shape.',
              effects: [{ type: 'gold', value: 150 }],
            },
          ],
        },
      ],
    },
  },
};

/** Fixture id -> { event, units: [{ className, name }] } (roster additions for its tells). */
export const DEV_EVENT_FIXTURES = Object.freeze({
  dev_mine: { event: mine, units: [{ className: 'Thief', name: 'Mira' }] },
  dev_contract: { event: contract, units: [] },
  dev_roads: { event: roads, units: [] },
  dev_join: { event: join, units: [] },
  dev_stress: { event: stress, units: [{ className: 'Thief', name: 'Bartholomew-Maximilian' }] },
});

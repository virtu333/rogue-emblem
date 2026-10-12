// Set piece v2 fixtures (act-v-descent §9.2): test-only set pieces that use the new keys (a boss
// slot, named units, defeat targets, posts, a Vigil), so the engine is proved before any content
// ships. `withSetPieces(data, ...pieces)` returns game data whose setPieces also hold them.

/** A seize map: one Throne, the boss slot on it, a named guard. */
export const SEIZE_FIXTURE = {
  id: 'fixture_throne',
  title: 'Fixture Throne',
  lore: 'A test throne.',
  objective: 'seize',
  deploy: { max: 3 },
  variants: [
    {
      id: 'a',
      mirror: true,
      map: {
        legend: { '.': 'Plain', T: 'Throne' },
        rows: [
          '. . . . . . . .',
          '. . . . . . . .',
          '. . . . . . . .',
          '. . . . . T . .',
          '. . . . . . . .',
          '. . . . . . . .',
          '. . . . . . . .',
        ],
      },
      playerSpawns: [
        { col: 2, row: 3 },
        { col: 1, row: 3 },
        { col: 1, row: 4 },
        { col: 0, row: 3 },
      ],
      enemies: [
        { col: 5, row: 3, boss: true },
        { col: 7, row: 6, classes: ['Fighter'], id: 'gate_guard', name: 'Gate Guard' },
        { col: 7, row: 0, classes: ['Archer'], minRung: 'hard' },
      ],
    },
  ],
};

/** A defeat map: two named Voices on their sigils (one a post), guards, two circles. */
export const DEFEAT_FIXTURE = {
  id: 'fixture_vigil',
  title: 'Fixture Vigil',
  lore: 'A test vigil.',
  objective: 'rout',
  objectives: {
    version: 1,
    primary: [
      { id: 'voices', kind: 'defeat', targets: ['voice_a', 'voice_b'], label: 'the Voices' },
    ],
  },
  deploy: { max: 3 },
  variants: [
    {
      id: 'a',
      mirror: true,
      map: {
        legend: { '.': 'Plain', F: 'Floor' },
        rows: [
          '. . . . . . . .',
          '. . . . . . F .',
          '. . . . . . . .',
          '. . . . . . . .',
          '. . . . . . . .',
          '. . . . . . F .',
          '. . . . . . . .',
        ],
      },
      playerSpawns: [
        { col: 0, row: 3 },
        { col: 0, row: 2 },
        { col: 0, row: 4 },
      ],
      enemies: [
        {
          col: 6,
          row: 1,
          classes: ['Mage'],
          id: 'voice_a',
          name: 'Voice of the Calling',
          target: true,
          aiMode: 'post',
        },
        {
          col: 6,
          row: 5,
          classes: ['Mage'],
          id: 'voice_b',
          name: 'Voice of the Binding',
          target: true,
        },
        { col: 7, row: 3, classes: ['Fighter'] },
        { col: 7, row: 0, classes: ['Fighter'] },
      ],
      vigil: {
        sigils: [
          { id: 'sigil_a', col: 6, row: 1, target: 'voice_a' },
          { id: 'sigil_b', col: 6, row: 5, target: 'voice_b' },
        ],
        circles: [
          { id: 'circle_a', col: 4, row: 0, voice: 'voice_a' },
          { id: 'circle_b', col: 4, row: 6, voice: 'voice_b' },
        ],
      },
    },
  ],
};

/** The gate: defeat '@boss' on an Act V map, the boss seated by name in the params. */
export const GATE_FIXTURE = {
  id: 'fixture_gate',
  title: 'Fixture Gate',
  lore: 'A test gate.',
  objective: 'rout',
  objectives: { version: 1, primary: [{ id: 'gate', kind: 'defeat', targets: ['@boss'] }] },
  acts: ['finalBoss'],
  deploy: { max: 3 },
  variants: [
    {
      id: 'a',
      map: {
        legend: { '.': 'Plain' },
        rows: [
          '. . . . . . . .',
          '. . . . . . . .',
          '. . . . . . . .',
          '. . . . . . . .',
          '. . . . . . . .',
          '. . . . . . . .',
          '. . . . . . . .',
        ],
      },
      playerSpawns: [
        { col: 0, row: 3 },
        { col: 0, row: 2 },
        { col: 0, row: 4 },
      ],
      enemies: [
        { col: 7, row: 3, boss: true },
        { col: 6, row: 0, classes: ['Sage'] },
      ],
    },
  ],
};

/** Game data whose setPieces also hold `pieces` (the shipped ones kept). */
export function withSetPieces(data, ...pieces) {
  return {
    ...data,
    setPieces: { ...data.setPieces, setPieces: [...data.setPieces.setPieces, ...pieces] },
  };
}

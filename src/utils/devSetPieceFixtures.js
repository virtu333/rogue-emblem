// Review-only set pieces (docs/specs/act-v-descent.md §3.1, §9.5): the shapes the real Act V
// content uses, so a mechanic can be looked at and played before the shipped set piece exists.
// Reached only through devStartup's battle route (`?devScene=battle&preset=battle_smoke&
// setPiece=dev_vigil&act=5`), which adds them to that page's game data; the unit tests build
// their Vigil battles from the same data. A real run never reads this file, and nothing here is
// game data (the real `the_vigil` set piece arrives with the content PR).
//
//   dev_vigil   a ring hall: four named Circle Adepts (the Voices) on four sigils around the
//               centre, the Waking's among them, each tethered to a summoning circle at the
//               ring's edge; a few guards. Objective: defeat the four Voices.

const VIGIL = {
  id: 'dev_vigil',
  title: 'The Vigil (review)',
  lore: 'A ring hall under the stones. Four voices keep one word between them.',
  objective: 'rout',
  objectives: {
    version: 1,
    primary: [
      {
        id: 'voices',
        kind: 'defeat',
        targets: ['voice_calling', 'voice_binding', 'voice_feeding', 'voice_waking'],
        label: 'the Voices',
      },
    ],
  },
  acts: ['finalBoss'],
  deploy: { max: 5 },
  variants: [
    {
      id: 'ring',
      mirror: true,
      map: {
        legend: { '.': 'Floor', P: 'Pillar' },
        rows: [
          '. . . . . . . . . . . . .',
          '. . P . . . . . . . P . .',
          '. . . . . . . . . . . . .',
          '. . . . P . . . P . . . .',
          '. . . . . . . . . . . . .',
          '. . . . . . . . . . . . .',
          '. . . . . . . . . . . . .',
          '. . . . P . . . P . . . .',
          '. . . . . . . . . . . . .',
          '. . P . . . . . . . P . .',
          '. . . . . . . . . . . . .',
        ],
      },
      playerSpawns: [
        { col: 1, row: 9 },
        { col: 0, row: 9 },
        { col: 1, row: 10 },
        { col: 0, row: 10 },
        { col: 2, row: 10 },
        { col: 0, row: 8 },
      ],
      enemies: [
        {
          col: 6,
          row: 3,
          classes: ['Circle Adept'],
          id: 'voice_calling',
          name: 'Voice of the Calling',
          target: true,
          aiMode: 'post',
        },
        {
          col: 8,
          row: 5,
          classes: ['Circle Adept'],
          id: 'voice_binding',
          name: 'Voice of the Binding',
          target: true,
          aiMode: 'post',
        },
        {
          col: 6,
          row: 7,
          classes: ['Circle Adept'],
          id: 'voice_feeding',
          name: 'Voice of the Feeding',
          target: true,
          aiMode: 'post',
        },
        {
          col: 4,
          row: 5,
          classes: ['Circle Adept'],
          id: 'voice_waking',
          name: 'Voice of the Waking',
          target: true,
          aiMode: 'post',
        },
        { col: 6, row: 5, classes: ['Dark Knight'], aiMode: 'guard' },
        { col: 10, row: 3, classes: ['Assassin'], hold: 1 },
        { col: 10, row: 7, classes: ['Sage'], minRung: 'lunatic' },
      ],
      vigil: {
        sigils: [
          { id: 'sigil_calling', col: 6, row: 3, target: 'voice_calling' },
          { id: 'sigil_binding', col: 8, row: 5, target: 'voice_binding' },
          { id: 'sigil_feeding', col: 6, row: 7, target: 'voice_feeding' },
          { id: 'sigil_waking', col: 4, row: 5, target: 'voice_waking', waking: true },
        ],
        circles: [
          { id: 'circle_calling', col: 6, row: 0, voice: 'voice_calling' },
          { id: 'circle_binding', col: 12, row: 5, voice: 'voice_binding' },
          { id: 'circle_feeding', col: 6, row: 10, voice: 'voice_feeding' },
          { id: 'circle_waking', col: 2, row: 5, voice: 'voice_waking' },
        ],
        maxCalled: 8,
      },
    },
  ],
};

/** The review set pieces by id. */
export const DEV_SET_PIECE_FIXTURES = Object.freeze({ [VIGIL.id]: VIGIL });

/** Game data whose setPieces also hold the review set piece `id` (unchanged for any other id). */
export function withDevSetPiece(gameData, id) {
  const piece = DEV_SET_PIECE_FIXTURES[id];
  const list = gameData?.setPieces?.setPieces;
  if (!piece || !Array.isArray(list) || list.some((p) => p?.id === id)) return gameData;
  return {
    ...gameData,
    setPieces: { ...gameData.setPieces, setPieces: [...list, structuredClone(piece)] },
  };
}

// Roster: which reference figure each traced sprite comes from, and the per-figure
// segmentation recipe (see lib/segment.mjs). References:
//   S = the reviewed class sheets (Player A / Player B / Enemy, left to right)
//   R = the approved rebuilt lords and bosses (assets/sprites/rebuilt)
const S = (name) => `docs/art/class-sprite-review-2026-09-22/sheets/${name}.png`;
const R = (name) => `assets/sprites/rebuilt/${name}.png`;

// Mount overrides (normalised boxes): the horse / pegasus body is its own material so
// faction and corruption treatments leave a white pegasus white and a bay horse bay.
const HORSE = [
  { slot: 'mount', box: [0, 0.5, 1, 1], from: ['leather', 'sub', 'skin', 'hair'] },
  { slot: 'mount', box: [0.7, 0.25, 1, 0.55], from: ['leather', 'sub', 'skin', 'hair'] },
];
const PEGASUS = [
  { slot: 'mount', box: [0, 0.5, 1, 1], from: ['armor', 'linen', 'skin', 'metal'] },
  { slot: 'mount', box: [0, 0.2, 0.42, 0.62], from: ['armor', 'linen', 'skin', 'metal'] },
  { slot: 'mount', box: [0.62, 0.15, 0.9, 0.55], from: ['armor', 'linen', 'skin', 'hair'] },
];

export const ROSTER = {
  sources: {
    // --- lords (approved identities) ---------------------------------------------
    edric: { src: R('lord_edric'), kind: 'infantry', main: 'teal', hair: 'brown' },
    edric_promoted: {
      src: R('lord_edric_promoted'),
      kind: 'infantry',
      main: 'teal',
      hair: 'brown',
      armor: true,
    },
    sera: { src: R('lord_sera'), kind: 'mage', main: 'purple', hair: 'red' },
    kira: { src: R('lord_kira'), kind: 'infantry', main: 'purple', hair: 'silver' },
    // --- generic classes (A = player design, B = second player design, E = enemy) ---
    myrmidon_a: { src: S('myrmidon'), figure: 0, kind: 'infantry', main: 'blue', hair: 'brown' },
    myrmidon_b: { src: S('myrmidon'), figure: 1, kind: 'infantry', main: 'blue', hair: 'silver' },
    myrmidon_e: { src: S('myrmidon'), figure: 2, kind: 'infantry', main: 'red', hair: 'black' },
    mercenary_a: { src: S('mercenary'), figure: 0, kind: 'infantry', main: 'blue', hair: 'brown' },
    mercenary_e: {
      src: S('mercenary'),
      figure: 2,
      kind: 'infantry',
      main: 'red',
      hair: null,
      armor: true,
    },
    thief_a: { src: S('thief'), figure: 0, kind: 'crouch', main: 'blue', hair: 'brown' },
    thief_e: { src: S('thief'), figure: 2, kind: 'crouch', main: 'red', hair: null },
    fighter_a: { src: S('fighter'), figure: 0, kind: 'infantry', main: 'blue', hair: 'brown' },
    fighter_e: { src: S('fighter'), figure: 2, kind: 'infantry', main: 'red', hair: null },
    knight_a: {
      src: S('knight'),
      figure: 0,
      kind: 'heavy',
      main: 'blue',
      hair: 'brown',
      armor: true,
    },
    knight_e: {
      src: S('knight'),
      figure: 2,
      kind: 'heavy',
      main: 'red',
      hair: null,
      armor: true,
      eyes: false,
    },
    archer_a: { src: S('archer'), figure: 0, kind: 'infantry', main: 'blue', hair: 'brown' },
    archer_e: { src: S('archer'), figure: 2, kind: 'infantry', main: 'red', hair: null },
    mage_a: { src: S('mage'), figure: 0, kind: 'mage', main: 'blue', hair: 'brown' },
    mage_e: { src: S('mage'), figure: 2, kind: 'mage', main: 'red', hair: null },
    cleric_a: { src: S('cleric'), figure: 0, kind: 'mage', main: 'blue', hair: 'brown' },
    cleric_e: { src: S('cleric'), figure: 2, kind: 'mage', main: 'red', hair: null },
    cavalier_a: {
      src: S('cavalier'),
      figure: 0,
      kind: 'mounted',
      main: 'blue',
      hair: 'brown',
      armor: true,
      rects: HORSE,
    },
    cavalier_e: {
      src: S('cavalier'),
      figure: 2,
      kind: 'mounted',
      main: 'red',
      hair: null,
      armor: true,
      eyes: false,
      head: [0.3, 0.1, 0.5, 0.3],
      rects: HORSE,
    },
    pegasus_a: {
      src: S('pegasus-knight'),
      figure: 0,
      kind: 'flyer',
      main: 'blue',
      hair: 'brown',
      armor: true,
      rects: PEGASUS,
    },
    pegasus_e: {
      src: S('pegasus-knight'),
      figure: 2,
      kind: 'flyer',
      main: 'red',
      hair: null,
      armor: true,
      eyes: false,
      head: [0.45, 0.02, 0.62, 0.25],
      rects: PEGASUS,
    },
    swordmaster_a: {
      src: S('swordmaster'),
      figure: 0,
      kind: 'infantry',
      main: 'blue',
      hair: 'brown',
    },
    swordmaster_b: {
      src: S('swordmaster'),
      figure: 1,
      kind: 'infantry',
      main: 'blue',
      hair: 'red',
    },
    swordmaster_e: {
      src: S('swordmaster'),
      figure: 2,
      kind: 'infantry',
      main: 'red',
      hair: 'black',
    },
    // --- bosses -------------------------------------------------------------------
    boss_blade_lord: {
      src: R('boss_blade_lord'),
      kind: 'boss',
      main: 'red',
      hair: 'black',
      armor: true,
    },
    boss_iron_wall: {
      src: R('boss_iron_wall'),
      kind: 'boss',
      main: 'red',
      hair: null,
      armor: true,
    },
  },
};

// Runtime textures to bake (keys follow RebuiltSprites / BattleUnitVisuals naming).
// source = roster id; faction = treatment; keepMain = keep the design's own cloth
// (lords' identity colours, bosses' own heraldry); recruits = seeded identities.
const CLASSES = [
  ['myrmidon', 'myrmidon'],
  ['mercenary', 'mercenary'],
  ['thief', 'thief'],
  ['fighter', 'fighter'],
  ['knight', 'knight'],
  ['archer', 'archer'],
  ['mage', 'mage'],
  ['cleric', 'cleric'],
  ['cavalier', 'cavalier'],
  ['pegasus_knight', 'pegasus'],
];

export const BAKE = [
  { key: 'lord_edric', source: 'edric', faction: 'player', keepMain: true },
  { key: 'lord_edric_promoted', source: 'edric_promoted', faction: 'player', keepMain: true },
  { key: 'lord_sera', source: 'sera', faction: 'player', keepMain: true },
  { key: 'lord_kira', source: 'kira', faction: 'player', keepMain: true },
  ...CLASSES.flatMap(([cls, id]) => [
    { key: cls, source: `${id}_a`, faction: 'player' },
    { key: `enemy_${cls}`, source: `${id}_e`, faction: 'enemy' },
    { key: `enemy_${cls}~corrupt`, source: `${id}_e`, faction: 'corrupted', corrupt: true },
    { key: `npc_${cls}`, source: `${id}_a`, faction: 'npc' },
  ]),
  { key: 'swordmaster', source: 'swordmaster_a', faction: 'player' },
  { key: 'enemy_swordmaster', source: 'swordmaster_e', faction: 'enemy' },
  { key: 'boss_blade_lord', source: 'boss_blade_lord', faction: 'enemy', keepMain: true },
  { key: 'boss_iron_wall', source: 'boss_iron_wall', faction: 'enemy', keepMain: true },
];

/** Seeded recruit identities baked for the review: six people, base and promoted. */
export const RECRUITS = {
  count: 6,
  seedPrefix: '20260924:recruit:',
  lines: [
    {
      base: ['myrmidon_a', 'myrmidon_b'],
      promoted: ['swordmaster_a', 'swordmaster_b'],
      key: 'myrmidon',
      promotedKey: 'swordmaster',
    },
  ],
};

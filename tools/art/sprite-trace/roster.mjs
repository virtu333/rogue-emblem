// Roster: which reference figure each traced sprite comes from, and the per-figure
// segmentation recipe (see lib/segment.mjs). Source priority (owner direction,
// 2026-09-24): the newest "detailed map sprite" candidates first, then the latest
// revision of each class sheet, then the original class sheets, then rebuilt art.
//
//   C   docs/art/sprite-candidates-2026-09-22/sources — newest map-scale candidates (Edric,
//       Sera, player Archer, enemy Knight), generated against the owner's on-map reference
//   L   class-sprite-review-2026-09-22/legibility-v2/sheets — sword-class silhouette revision
//   P2  .../player-set-2/sheets, P3 .../player-set-3/sheets — later player design passes
//   RV  .../revision/sheets — archer revision (with an enemy design)
//   S   .../sheets — the original reviewed class sheets (Player A / Player B / Enemy)
//   R   assets/sprites/rebuilt — approved rebuilt lords and bosses
// `figures` = number of figures on a sheet (split on transparent gutters, left to right).
const CS = 'docs/art/class-sprite-review-2026-09-22';
const C = (name) => `docs/art/sprite-candidates-2026-09-22/sources/${name}.png`;
const L = (name) => `${CS}/legibility-v2/sheets/${name}.png`;
const P2 = (name) => `${CS}/player-set-2/sheets/${name}.png`;
const P3 = (name) => `${CS}/player-set-3/sheets/${name}.png`;
const RV = (name) => `${CS}/revision/sheets/${name}.png`;
const S = (name) => `${CS}/sheets/${name}.png`;
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
    // --- lords ---------------------------------------------------------------------------
    // owner note on this candidate: less gold trim on the base lord, sword brought in
    edric: {
      src: C('edric'),
      kind: 'infantry',
      main: 'teal',
      hair: 'brown',
      armor: true,
      muteTrim: true,
      bladeKeep: 0.8,
    },
    edric_promoted: {
      src: R('lord_edric_promoted'),
      kind: 'infantry',
      main: 'teal',
      hair: 'brown',
      armor: true,
    },
    sera: { src: C('sera'), kind: 'mage', main: 'purple', hair: 'red' },
    kira: { src: R('lord_kira'), kind: 'infantry', main: 'purple', hair: 'silver' },
    // --- sword classes: legibility-v2 silhouettes -------------------------------------------
    myrmidon_a: { src: L('myrmidon'), figure: 0, kind: 'infantry', main: 'blue', hair: 'black' },
    myrmidon_b: { src: L('myrmidon'), figure: 1, kind: 'infantry', main: 'blue', hair: 'silver' },
    myrmidon_e: { src: L('myrmidon'), figure: 2, kind: 'infantry', main: 'red', hair: 'silver' },
    mercenary_a: { src: L('mercenary'), figure: 0, kind: 'infantry', main: 'blue', hair: 'brown' },
    mercenary_b: { src: L('mercenary'), figure: 1, kind: 'infantry', main: 'blue', hair: 'black' },
    mercenary_e: {
      src: L('mercenary'),
      figure: 2,
      kind: 'infantry',
      main: 'red',
      hair: null,
      armor: true,
      eyes: false,
    },
    thief_a: { src: L('thief'), figure: 0, kind: 'crouch', main: 'blue', hair: null },
    thief_b: { src: L('thief'), figure: 1, kind: 'crouch', main: 'blue', hair: 'green' },
    thief_e: { src: L('thief'), figure: 2, kind: 'crouch', main: 'red', hair: null },
    // --- later player designs (player-set-2/3, candidates); enemies from the newest sheet
    //     that has one ---------------------------------------------------------------------
    fighter_a: {
      src: P2('fighter'),
      figure: 0,
      figures: 2,
      kind: 'infantry',
      main: 'blue',
      hair: 'red',
    },
    fighter_b: {
      src: P2('fighter'),
      figure: 1,
      figures: 2,
      kind: 'infantry',
      main: 'blue',
      hair: 'black',
    },
    fighter_e: { src: S('fighter'), figure: 2, kind: 'infantry', main: 'red', hair: null },
    knight_a: {
      src: P2('knight'),
      figure: 0,
      figures: 2,
      kind: 'heavy',
      main: 'blue',
      hair: 'silver',
      armor: true,
    },
    knight_b: {
      src: P2('knight'),
      figure: 1,
      figures: 2,
      kind: 'heavy',
      main: 'blue',
      hair: null,
      armor: true,
    },
    knight_e: {
      src: C('knight'),
      kind: 'heavy',
      main: 'red',
      hair: null,
      armor: true,
      eyes: false,
    },
    archer_a: { src: C('archer'), kind: 'infantry', main: 'blue', hair: 'brown' },
    archer_b: { src: RV('archer'), figure: 1, kind: 'infantry', main: 'blue', hair: 'black' },
    archer_e: {
      src: RV('archer'),
      figure: 2,
      kind: 'infantry',
      main: 'red',
      hair: null,
      eyes: false,
    },
    mage_a: { src: P2('mage'), figure: 0, figures: 2, kind: 'mage', main: 'blue', hair: 'green' },
    mage_b: { src: P2('mage'), figure: 1, figures: 2, kind: 'mage', main: 'blue', hair: 'silver' },
    mage_e: { src: S('mage'), figure: 2, kind: 'mage', main: 'red', hair: null },
    cleric_a: { src: P2('cleric'), figure: 0, figures: 2, kind: 'mage', main: 'blue', hair: null },
    cleric_b: { src: P2('cleric'), figure: 1, figures: 2, kind: 'mage', main: 'blue', hair: 'red' },
    cleric_e: { src: S('cleric'), figure: 2, kind: 'mage', main: 'red', hair: null },
    cavalier_a: {
      src: P3('cavalier'),
      figure: 0,
      figures: 2,
      kind: 'mounted',
      main: 'blue',
      hair: 'black',
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
      src: P3('pegasus-knight'),
      figure: 0,
      figures: 2,
      kind: 'flyer',
      main: 'blue',
      hair: 'black',
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
    // --- promotion line for the seeded recruits (original sheet: no later revision) --------
    swordmaster_a: {
      src: S('swordmaster'),
      figure: 0,
      kind: 'infantry',
      main: 'blue',
      hair: 'brown',
      head: [0.44, 0.0, 0.64, 0.2],
    },
    swordmaster_b: {
      src: S('swordmaster'),
      figure: 1,
      kind: 'infantry',
      main: 'blue',
      hair: 'red',
      head: [0.3, 0.0, 0.62, 0.24],
    },
    swordmaster_e: {
      src: S('swordmaster'),
      figure: 2,
      kind: 'infantry',
      main: 'red',
      hair: 'black',
    },
    // --- bosses (rebuilt art) --------------------------------------------------------------
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
    // --- earlier sources of the same units, kept for the source-comparison sheet -----------
    edric_rebuilt: { src: R('lord_edric'), kind: 'infantry', main: 'teal', hair: 'brown' },
    sera_rebuilt: { src: R('lord_sera'), kind: 'mage', main: 'purple', hair: 'red' },
    myrmidon_v1: { src: S('myrmidon'), figure: 0, kind: 'infantry', main: 'blue', hair: 'brown' },
    knight_v1: {
      src: S('knight'),
      figure: 2,
      kind: 'heavy',
      main: 'red',
      hair: null,
      armor: true,
      eyes: false,
    },
    knight_v1a: {
      src: S('knight'),
      figure: 0,
      kind: 'heavy',
      main: 'blue',
      hair: 'brown',
      armor: true,
    },
    pegasus_v1: {
      src: S('pegasus-knight'),
      figure: 0,
      kind: 'flyer',
      main: 'blue',
      hair: 'brown',
      armor: true,
      rects: PEGASUS,
    },
    cavalier_v1: {
      src: S('cavalier'),
      figure: 0,
      kind: 'mounted',
      main: 'blue',
      hair: 'brown',
      armor: true,
      rects: HORSE,
    },
    archer_v1: { src: S('archer'), figure: 0, kind: 'infantry', main: 'blue', hair: 'brown' },
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

import { readFileSync } from 'node:fs';

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
//   R   docs/art/rebuilt-sprite-sources — the full-size rebuilt lords and bosses (the game
//       ships them baked to 64 px, docs/mobile-memory-budget.md)
// `figures` = number of figures on a sheet (split on transparent gutters, left to right).
const CS = 'docs/art/class-sprite-review-2026-09-22';
const C = (name) => `docs/art/sprite-candidates-2026-09-22/sources/${name}.png`;
const L = (name) => `${CS}/legibility-v2/sheets/${name}.png`;
const P2 = (name) => `${CS}/player-set-2/sheets/${name}.png`;
const P3 = (name) => `${CS}/player-set-3/sheets/${name}.png`;
const RV = (name) => `${CS}/revision/sheets/${name}.png`;
const S = (name) => `${CS}/sheets/${name}.png`;
const R = (name) => `docs/art/rebuilt-sprite-sources/${name}.png`;
//   G   docs/art/sprite-candidates-2026-09-25/sources — map-size redraws of the lords and
//       bosses that R could only give through a strong reduction (tools/art/sprite-trace/
//       gen-refs.mjs: style board + the unit's rebuilt sprite and portrait as identity),
//       stored as their recovered pixel grid at 6x
const G = (name) => `docs/art/sprite-candidates-2026-09-25/sources/${name}.png`;

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
    // lavender-white hair reads as steel and the dark face as leather: box them
    myrmidon_b: {
      src: L('myrmidon'),
      figure: 1,
      kind: 'infantry',
      main: 'blue',
      hair: 'silver',
      head: [0.27, 0.13, 0.68, 0.36],
      rects: [
        { slot: 'hair', box: [0.27, 0.13, 0.68, 0.26], from: ['metal', 'linen', 'sub', 'armor'] },
        { slot: 'skin', box: [0.4, 0.2, 0.68, 0.36], from: ['leather'] },
      ],
    },
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
    pegasus_knight_a: {
      src: P3('pegasus-knight'),
      figure: 0,
      figures: 2,
      kind: 'flyer',
      main: 'blue',
      hair: 'black',
      armor: true,
      rects: PEGASUS,
    },
    pegasus_knight_e: {
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

// --- full battlefield roster (2026-09-24: traced sprites are the default art) -------------
// Every class a unit can have on the battlefield gets a traced sprite. Generic classes
// read Player A / Player B / Enemy from the reviewed class sheets unless a later pass (or
// a candidate) already supplies that figure above; enemy-only creatures have one design.

// White horses keep their own coat under every faction and grade (same boxes as HORSE).
const WHITE_HORSE = HORSE.map((r) => ({ ...r, from: ['armor', 'linen', 'skin', 'metal'] }));

const PLAYER_A = { main: 'blue', hair: 'brown' };
const PLAYER_B = { main: 'blue', hair: 'red' };
// Enemy designs are hooded or helmeted: no hair mass, no stamped eyes on a visor.
const ENEMY = { main: 'red', hair: null, armor: true, eyes: false };

/**
 * Generic classes: [runtime key, sheet id, kind, overrides { all, a, b, e }].
 * Runtime key = class name lower-cased with underscores (TracedSprites.tracedKeyFor).
 */
export const GENERIC_CLASSES = [
  ['myrmidon', 'myrmidon', 'infantry'],
  ['mercenary', 'mercenary', 'infantry'],
  ['thief', 'thief', 'crouch'],
  ['fighter', 'fighter', 'infantry'],
  ['knight', 'knight', 'heavy'],
  ['archer', 'archer', 'infantry'],
  ['mage', 'mage', 'mage'],
  ['cleric', 'cleric', 'mage'],
  ['cavalier', 'cavalier', 'mounted', { all: { armor: true, rects: HORSE } }],
  ['pegasus_knight', 'pegasus-knight', 'flyer', { all: { armor: true, rects: PEGASUS } }],
  ['wyvern_rider', 'wyvern-rider', 'flyer', { all: { armor: true } }],
  ['dancer', 'dancer', 'infantry'],
  ['swordmaster', 'swordmaster', 'infantry'],
  ['general', 'general', 'heavy', { all: { armor: true }, a: { hair: null, eyes: false } }],
  ['warrior', 'warrior', 'infantry', { all: { armor: true } }],
  ['paladin', 'paladin', 'mounted', { all: { armor: true, rects: WHITE_HORSE } }],
  ['sniper', 'sniper', 'infantry'],
  ['sage', 'sage', 'mage'],
  ['bishop', 'bishop', 'mage'],
  // the blade lies across the cloak; a bent leg is the longer line otherwise
  ['assassin', 'assassin', 'infantry', { a: { weaponAt: [0.49, 0.64] }, b: { hair: 'blond' } }],
  ['bard', 'bard', 'infantry'],
  [
    'falcon_knight',
    'falcon-knight',
    'flyer',
    {
      all: { armor: true, rects: PEGASUS },
      // the lance lies level along the mount; the shape rules otherwise take a hind leg
      a: { weaponAt: [0.88, 0.66] },
    },
  ],
  ['wyvern_lord', 'wyvern-lord', 'flyer', { all: { armor: true } }],
  ['hero', 'hero', 'infantry', { all: { armor: true } }],
  ['duelist', 'duelist', 'infantry'],
  ['great_knight', 'great-knight', 'mounted', { all: { armor: true } }],
  ['berserker', 'berserker', 'infantry'],
  ['dark_knight', 'dark-knight', 'mounted', { all: { armor: true, rects: HORSE } }],
  ['bow_knight', 'bow-knight', 'mounted', { all: { rects: HORSE } }],
  ['warlock', 'warlock', 'mage'],
  ['battle_monk', 'battle-monk', 'infantry'],
  ['trickster', 'trickster', 'infantry'],
  ['hunter', 'hunter', 'infantry'],
];

/** Enemy-only creatures (one design each): [runtime key, sheet id, kind, recipe]. */
export const ENEMY_ONLY_CLASSES = [
  ['zombie', 'zombie', 'infantry', { main: 'red', hair: null, eyes: false }],
  ['revenant', 'revenant', 'infantry', { main: 'red', hair: null, armor: true, eyes: false }],
  ['dragon', 'dragon', 'mounted', { main: 'red', hair: null, eyes: false, linen: false }],
  ['dragon_lord', 'dragon-lord', 'mounted', { main: 'red', hair: null, eyes: false, linen: false }],
];

// Later player passes for figures the class table would otherwise read from `S`.
Object.assign(ROSTER.sources, {
  cavalier_b: {
    src: P3('cavalier'),
    figure: 1,
    figures: 2,
    kind: 'mounted',
    main: 'blue',
    hair: 'black',
    armor: true,
    rects: HORSE,
  },
  pegasus_knight_b: {
    src: P3('pegasus-knight'),
    figure: 1,
    figures: 2,
    kind: 'flyer',
    main: 'blue',
    hair: 'brown',
    armor: true,
    rects: PEGASUS,
  },
  wyvern_rider_a: {
    src: P3('wyvern-rider'),
    figure: 0,
    figures: 2,
    kind: 'flyer',
    main: 'blue',
    hair: 'black',
    armor: true,
  },
  wyvern_rider_b: {
    src: P3('wyvern-rider'),
    figure: 1,
    figures: 2,
    kind: 'flyer',
    main: 'blue',
    hair: 'black',
    armor: true,
  },
  dancer_a: {
    src: P3('dancer'),
    figure: 0,
    figures: 2,
    kind: 'infantry',
    main: 'blue',
    hair: 'black',
  },
  dancer_b: {
    src: P3('dancer'),
    figure: 1,
    figures: 2,
    kind: 'infantry',
    main: 'blue',
    hair: 'red',
  },
});

for (const [cls, sheet, kind, o = {}] of GENERIC_CLASSES) {
  const all = o.all || {};
  const add = (id, figure, recipe) => {
    ROSTER.sources[id] ||= { src: S(sheet), figure, kind, ...recipe };
  };
  add(`${cls}_a`, 0, { ...PLAYER_A, ...all, ...(o.a || {}) });
  add(`${cls}_b`, 1, { ...PLAYER_B, ...all, ...(o.b || {}) });
  add(`${cls}_e`, 2, { ...all, ...ENEMY, ...(o.e || {}) });
}
for (const [cls, sheet, kind, recipe] of ENEMY_ONLY_CLASSES)
  ROSTER.sources[`${cls}_e`] ||= { src: S(sheet), kind, ...recipe };

// --- lords: identity first (the portraits), then source priority ----------------------------
// The lord-class sheets were drawn as the named lords, but Voss and Cael there are young,
// bare-headed recruits while every portrait (and the rebuilt sprite) shows the bearded
// hooded ranger and the helmeted veteran, and the sheet Kira wears navy where her
// portrait wears plum, so those three keep the rebuilt art. `_s` = the class-sheet
// figure; both candidates are compared in docs/art-direction/sprites-v3/lord_sources.
Object.assign(ROSTER.sources, {
  edric_promoted_s: {
    src: S('great-lord'),
    figure: 0,
    figures: 2,
    kind: 'infantry',
    main: 'teal',
    hair: 'brown',
    armor: true,
  },
  sera_promoted: { src: R('lord_sera_promoted'), kind: 'mage', main: 'purple', hair: 'red' },
  sera_promoted_s: {
    src: S('light-priestess'),
    figure: 0,
    figures: 2,
    kind: 'mage',
    main: 'purple',
    hair: 'red',
  },
  kira_s: {
    src: S('tactician'),
    figure: 0,
    figures: 2,
    kind: 'mage',
    main: 'blue',
    hair: 'silver',
  },
  kira_promoted: { src: R('lord_kira_promoted'), kind: 'infantry', main: 'purple', hair: 'silver' },
  kira_promoted_s: {
    src: S('grandmaster'),
    figure: 0,
    figures: 2,
    kind: 'mage',
    main: 'blue',
    hair: 'silver',
  },
  voss: { src: R('lord_voss'), kind: 'infantry', main: 'green', hair: 'black', armor: true },
  voss_promoted: {
    src: R('lord_voss_promoted'),
    kind: 'infantry',
    main: 'green',
    hair: 'black',
    armor: true,
  },
  rowan: { src: R('lord_rowan'), kind: 'mounted', main: null, hair: 'red', rects: HORSE },
  rowan_s: {
    src: S('chevalier'),
    figure: 0,
    figures: 2,
    kind: 'mounted',
    main: 'blue',
    hair: 'red',
    armor: true,
    rects: HORSE,
  },
  rowan_promoted: {
    src: R('lord_rowan_promoted'),
    kind: 'mounted',
    main: null,
    hair: 'red',
    armor: true,
    rects: HORSE,
  },
  rowan_promoted_s: {
    src: S('holy-knight'),
    figure: 0,
    figures: 2,
    kind: 'mounted',
    main: 'blue',
    hair: 'red',
    armor: true,
    rects: HORSE,
  },
  astrid: {
    src: R('lord_astrid'),
    kind: 'flyer',
    main: 'blue',
    hair: 'silver',
    armor: true,
    rects: PEGASUS,
  },
  astrid_s: {
    src: S('sky-lancer'),
    figure: 0,
    figures: 2,
    kind: 'flyer',
    main: 'blue',
    hair: 'silver',
    armor: true,
    rects: PEGASUS,
  },
  astrid_promoted: {
    src: R('lord_astrid_promoted'),
    kind: 'flyer',
    main: 'blue',
    hair: 'silver',
    armor: true,
    rects: PEGASUS,
  },
  astrid_promoted_s: {
    src: S('seraph-knight'),
    figure: 0,
    figures: 2,
    kind: 'flyer',
    main: 'blue',
    hair: 'silver',
    armor: true,
    rects: PEGASUS,
  },
  cael: { src: R('lord_cael'), kind: 'infantry', main: 'red', hair: null, armor: true },
  cael_promoted: {
    src: R('lord_cael_promoted'),
    kind: 'infantry',
    main: 'red',
    hair: null,
    armor: true,
  },
});

// --- bosses (rebuilt art; the Entity from the revision pass) ---------------------------------
const BOSS = { kind: 'boss', main: 'red', armor: true };
Object.assign(ROSTER.sources, {
  boss_archmage: { src: R('boss_archmage'), ...BOSS, hair: 'silver', armor: false },
  boss_berserker_king: { src: R('boss_berserker_king'), ...BOSS, hair: 'red' },
  boss_dark_rider: {
    src: R('boss_dark_rider'),
    ...BOSS,
    kind: 'mounted',
    hair: null,
    eyes: false,
    rects: HORSE,
  },
  boss_iron_captain: {
    src: R('boss_iron_captain'),
    ...BOSS,
    kind: 'mounted',
    hair: null,
    rects: HORSE,
  },
  boss_knight_commander: {
    src: R('boss_knight_commander'),
    ...BOSS,
    kind: 'mounted',
    hair: null,
    rects: WHITE_HORSE,
  },
  boss_the_emperor: { src: R('boss_the_emperor'), ...BOSS, hair: 'blond' },
  boss_the_lieutenant: { src: R('boss_the_lieutenant'), ...BOSS, hair: 'black' },
  boss_warchief: { src: R('boss_warchief'), ...BOSS, hair: null },
  entity: {
    src: RV('entity'),
    figure: 0,
    figures: 1,
    kind: 'entity',
    main: 'purple',
    hair: null,
    eyes: false,
    linen: true,
  },
});

// --- map-size redraws (2026-09-25): `<id>_g` = the same unit from G at trace scale
// 0.55-0.9 instead of 0.1-0.45 (faces, straps and weapons survive as drawn). The recipe
// is the R/sheet recipe of the same unit; composition-specific boxes are re-fitted.
const GENERATED = {
  kira: {},
  kira_promoted: {},
  voss: {},
  // the auto head box lands on the bow tip: box the head
  voss_promoted: { head: [0.36, 0.05, 0.66, 0.28] },
  cael: {},
  cael_promoted: {},
  sera_promoted: {},
  astrid: { rects: PEGASUS },
  astrid_promoted: { rects: PEGASUS },
  boss_iron_captain: { rects: HORSE },
  // grey dapple horse, silver hair and the gold of his rank
  boss_knight_commander: { rects: WHITE_HORSE, hair: 'silver', keep: ['trim'] },
  boss_dark_rider: { rects: HORSE },
  boss_iron_wall: {},
  // a pale, bloodless face reads as plate to the colour rules
  boss_blade_lord: {
    head: [0.3, 0.02, 0.7, 0.3],
    rects: [{ slot: 'skin', box: [0.4, 0.12, 0.6, 0.29], from: ['armor', 'linen', 'metal', 'sub'] }],
  },
  // the Emperor's gold plate and crown are his; the empire's iron swap would grey them
  boss_the_emperor: { keep: ['trim', 'armor'] },
  boss_the_lieutenant: {},
  boss_archmage: {},
  boss_warchief: {},
  boss_berserker_king: {},
};
for (const [id, fit] of Object.entries(GENERATED)) {
  // lords whose rebuilt entry is named after the lord (kira) or the class sheet (_s)
  const base = ROSTER.sources[id] || ROSTER.sources[`${id}_s`];
  const { figure: _f, figures: _n, head: _h, rects: _r, ...recipe } = base;
  ROSTER.sources[`${id}_g`] = { ...recipe, ...fit, src: G(id) };
}

/** Named lords: [name, base source, promoted source, why]. */
export const LORDS = [
  [
    'edric',
    'edric',
    'edric_promoted_s',
    '09-22 candidate; Great Lord sheet (rebuilt+ is not a grid)',
  ],
  ['sera', 'sera', 'sera_promoted_g', '09-22 candidate; map-size redraw of the Light Priestess'],
  ['kira', 'kira_g', 'kira_promoted_g', 'map-size redraws of the rebuilt plum-coated tactician'],
  ['voss', 'voss_g', 'voss_promoted_g', 'map-size redraws of the bearded hooded ranger'],
  ['rowan', 'rowan_s', 'rowan_promoted_s', 'class sheets: same ginger cavalier, faces survive'],
  ['astrid', 'astrid_g', 'astrid_promoted_g', 'map-size redraws: pale-haired rider, lance level'],
  ['cael', 'cael_g', 'cael_promoted_g', 'map-size redraws of the helmeted veteran'],
];

/** Named bosses (enemies.json bosses): runtime key boss_<name> -> source. */
export const BOSSES = {
  boss_iron_captain: 'boss_iron_captain_g',
  boss_warchief: 'boss_warchief_g',
  boss_knight_commander: 'boss_knight_commander_g',
  boss_archmage: 'boss_archmage_g',
  boss_dark_rider: 'boss_dark_rider_g',
  boss_blade_lord: 'boss_blade_lord_g',
  boss_iron_wall: 'boss_iron_wall_g',
  boss_berserker_king: 'boss_berserker_king_g',
  boss_the_emperor: 'boss_the_emperor_g',
  boss_the_lieutenant: 'boss_the_lieutenant_g',
  boss_the_entity: 'entity',
};

/**
 * Seeded identities: every generic class bakes the same six people (design A/B, hair,
 * skin, headband), so `name hash % 6` picks the same person in every class and a unit
 * keeps its look through either promotion branch or a reclass.
 */
export const RECRUITS = {
  count: 6,
  seedPrefix: '20260924:recruit:',
  // a designed cast rather than six dice rolls: every skin family, hair that always
  // separates from the face at map size, three with a band (which promotion turns gold)
  cast: [
    { design: 0, hair: 'hairBrown', skin: 'skinWarm', band: null },
    { design: 1, hair: 'hairAuburn', skin: 'skinFair', band: null },
    { design: 0, hair: 'hairBlack', skin: 'skinDeep', band: 'boneCloth' },
    { design: 1, hair: 'hairSilver', skin: 'skinOlive', band: 'plumCloth' },
    { design: 0, hair: 'hairAsh', skin: 'skinFair', band: 'rustCloth' },
    { design: 1, hair: 'hairBlack', skin: 'skinTan', band: 'oliveCloth' },
  ],
};

/** Promoted-tier classes (data/classes.json), by runtime key. */
export const PROMOTED_CLASSES = new Set(
  JSON.parse(readFileSync(new URL('../../../data/classes.json', import.meta.url), 'utf8'))
    .filter((c) => c.tier === 'promoted')
    .map((c) => c.name.toLowerCase().replace(/ /g, '_')),
);

/** Every runtime texture: { key, source, faction, keepMain, corrupt, identity }. */
export function bakeEntries(identities) {
  const out = [];
  for (const [name, base, promoted] of LORDS) {
    out.push({ key: `lord_${name}`, source: base, faction: 'player', keepMain: true });
    out.push({ key: `lord_${name}_promoted`, source: promoted, faction: 'player', keepMain: true });
  }
  for (const [cls] of GENERIC_CLASSES) {
    // promotion keeps the person (hair, skin) and adds one signature accent: whatever
    // band they wore becomes a gold circlet, and everyone promoted wears one
    const promoted = PROMOTED_CLASSES.has(cls);
    identities.forEach((id, i) =>
      out.push({
        key: `${cls}-${i}`,
        source: `${cls}_${id.design ? 'b' : 'a'}`,
        faction: 'player',
        identity: promoted ? { ...id.colours, accent: 'gold', band: true } : id.colours,
      }),
    );
    out.push({ key: `enemy_${cls}`, source: `${cls}_e`, faction: 'enemy' });
    out.push({
      key: `enemy_${cls}-corrupt`,
      source: `${cls}_e`,
      faction: 'corrupted',
      corrupt: true,
    });
    out.push({ key: `npc_${cls}`, source: `${cls}_a`, faction: 'npc' });
  }
  for (const [cls] of ENEMY_ONLY_CLASSES) {
    // a reclass seal can turn a recruit into one of these (same tier, same move type)
    out.push({ key: cls, source: `${cls}_e`, faction: 'player' });
    out.push({ key: `enemy_${cls}`, source: `${cls}_e`, faction: 'enemy' });
    out.push({
      key: `enemy_${cls}-corrupt`,
      source: `${cls}_e`,
      faction: 'corrupted',
      corrupt: true,
    });
  }
  // The Entity keeps its own colours (it is not an imperial soldier)
  out.push({ key: 'enemy_entity', source: 'entity', faction: null });
  for (const [key, source] of Object.entries(BOSSES))
    out.push(
      source === 'entity'
        ? { key, source, faction: null }
        : { key, source, faction: 'enemy', keepMain: true },
    );
  return out;
}

/** Review helper: a runtime key, or a plain class key (design A, player faction). */
export function reviewEntry(key, entries) {
  return (
    entries.find((e) => e.key === key) ||
    (ROSTER.sources[`${key}_a`] ? { key, source: `${key}_a`, faction: 'player' } : null)
  );
}

// --- attack poses: the weapon each design is drawn holding ---------------------------------
// (the drawn weapon, not the class's first proficiency: the reviewed Dark Knight and
// Great Knight hold swords, the Battle Monk an axe, the Hunter a sword with the bow slung)
const POSE_BY_CLASS = {
  myrmidon: 'sword',
  mercenary: 'sword',
  // daggers and a dance read as a lunge at map size
  thief: 'none',
  fighter: 'axe',
  knight: 'lance',
  archer: 'bow',
  mage: 'tome',
  cleric: 'staff',
  cavalier: 'lance',
  pegasus_knight: 'lance',
  wyvern_rider: 'lance',
  dancer: 'none',
  swordmaster: 'sword',
  general: 'lance',
  warrior: 'axe',
  paladin: 'lance',
  sniper: 'bow',
  sage: 'tome',
  bishop: 'staff',
  assassin: 'sword',
  bard: 'tome',
  falcon_knight: 'lance',
  wyvern_lord: 'lance',
  hero: 'sword',
  duelist: 'sword',
  great_knight: 'sword',
  berserker: 'axe',
  dark_knight: 'sword',
  bow_knight: 'bow',
  warlock: 'tome',
  battle_monk: 'axe',
  trickster: 'sword',
  hunter: 'sword',
  zombie: 'axe',
  revenant: 'sword',
  dragon: 'breath',
  dragon_lord: 'breath',
};
const POSE_BY_SOURCE = {
  edric: 'sword',
  edric_promoted: 'sword',
  edric_promoted_s: 'sword',
  sera: 'staff',
  sera_promoted: 'staff',
  sera_promoted_s: 'staff',
  kira: 'tome',
  kira_s: 'tome',
  kira_promoted: 'tome',
  kira_promoted_s: 'tome',
  voss: 'sword',
  voss_promoted: 'sword',
  rowan: 'lance',
  rowan_s: 'lance',
  rowan_promoted: 'staff',
  rowan_promoted_s: 'lance',
  astrid: 'lance',
  // the class-sheet sky lancer shows no clear lance at map size (the cape is the only
  // long line): she lunges
  astrid_s: 'none',
  astrid_promoted: 'lance',
  astrid_promoted_s: 'lance',
  cael: 'axe',
  cael_promoted: 'axe',
  boss_archmage: 'tome',
  boss_berserker_king: 'axe',
  boss_blade_lord: 'sword',
  boss_dark_rider: 'lance',
  boss_iron_captain: 'lance',
  boss_iron_wall: 'lance',
  boss_knight_commander: 'lance',
  boss_the_emperor: 'lance',
  boss_the_lieutenant: 'sword',
  boss_warchief: 'axe',
  entity: 'none',
};

/** The attack pose of a roster source (sword, lance, axe, bow, tome, staff, breath, none). */
export function poseFor(sourceId) {
  const e = ROSTER.sources[sourceId];
  if (e?.pose) return e.pose;
  if (POSE_BY_SOURCE[sourceId]) return POSE_BY_SOURCE[sourceId];
  // a map-size redraw holds the same weapon as the unit it redraws
  if (sourceId.endsWith('_g')) return poseFor(sourceId.slice(0, -2));
  const cls = sourceId.replace(/_(a|b|e|v1a?|rebuilt)$/, '');
  return POSE_BY_CLASS[cls] || 'none';
}

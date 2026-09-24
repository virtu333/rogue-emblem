// Roster: which reference figure each traced sprite comes from, and the per-figure
// segmentation recipe (see lib/segment.mjs). References:
//   S = the reviewed class sheets (Player A / Player B / Enemy, left to right)
//   R = the approved rebuilt lords and bosses (assets/sprites/rebuilt)
const S = (name) => `docs/art/class-sprite-review-2026-09-22/sheets/${name}.png`;
const R = (name) => `assets/sprites/rebuilt/${name}.png`;

export const ROSTER = {
  sources: {
    // --- lords (approved identities) ---------------------------------------------
    edric: { src: R('lord_edric'), kind: 'infantry', main: 'teal', hair: 'brown' },
    edric_promoted: { src: R('lord_edric_promoted'), kind: 'infantry', main: 'teal', hair: 'brown', armor: true },
    sera: { src: R('lord_sera'), kind: 'mage', main: 'purple', hair: 'red' },
    kira: { src: R('lord_kira'), kind: 'infantry', main: 'purple', hair: 'silver' },
    // --- generic classes (A = player design, B = second player design, E = enemy) ---
    myrmidon_a: { src: S('myrmidon'), figure: 0, kind: 'infantry', main: 'blue', hair: 'brown' },
    myrmidon_b: { src: S('myrmidon'), figure: 1, kind: 'infantry', main: 'blue', hair: 'silver' },
    myrmidon_e: { src: S('myrmidon'), figure: 2, kind: 'infantry', main: 'red', hair: 'black' },
    mercenary_a: { src: S('mercenary'), figure: 0, kind: 'infantry', main: 'blue', hair: 'brown' },
    mercenary_e: { src: S('mercenary'), figure: 2, kind: 'infantry', main: 'red', hair: null, armor: true },
    thief_a: { src: S('thief'), figure: 0, kind: 'crouch', main: 'blue', hair: 'brown' },
    thief_e: { src: S('thief'), figure: 2, kind: 'crouch', main: 'red', hair: null },
    fighter_a: { src: S('fighter'), figure: 0, kind: 'infantry', main: 'blue', hair: 'brown' },
    fighter_e: { src: S('fighter'), figure: 2, kind: 'infantry', main: 'red', hair: null },
    knight_a: { src: S('knight'), figure: 0, kind: 'heavy', main: 'blue', hair: 'brown', armor: true },
    knight_e: { src: S('knight'), figure: 2, kind: 'heavy', main: 'red', hair: null, armor: true },
    archer_a: { src: S('archer'), figure: 0, kind: 'infantry', main: 'blue', hair: 'brown' },
    archer_e: { src: S('archer'), figure: 2, kind: 'infantry', main: 'red', hair: null },
    mage_a: { src: S('mage'), figure: 0, kind: 'mage', main: 'blue', hair: 'brown' },
    mage_e: { src: S('mage'), figure: 2, kind: 'mage', main: 'red', hair: null },
    cleric_a: { src: S('cleric'), figure: 0, kind: 'mage', main: 'blue', hair: 'brown' },
    cleric_e: { src: S('cleric'), figure: 2, kind: 'mage', main: 'red', hair: null },
    cavalier_a: { src: S('cavalier'), figure: 0, kind: 'mounted', main: 'blue', hair: 'brown', armor: true },
    cavalier_e: { src: S('cavalier'), figure: 2, kind: 'mounted', main: 'red', hair: null, armor: true },
    pegasus_a: { src: S('pegasus-knight'), figure: 0, kind: 'flyer', main: 'blue', hair: 'brown', armor: true },
    pegasus_e: { src: S('pegasus-knight'), figure: 2, kind: 'flyer', main: 'red', hair: null, armor: true },
    swordmaster_a: { src: S('swordmaster'), figure: 0, kind: 'infantry', main: 'blue', hair: 'brown' },
    swordmaster_b: { src: S('swordmaster'), figure: 1, kind: 'infantry', main: 'blue', hair: 'red' },
    // --- bosses -------------------------------------------------------------------
    boss_blade_lord: { src: R('boss_blade_lord'), kind: 'boss', main: 'red', hair: 'black', armor: true },
    boss_iron_wall: { src: R('boss_iron_wall'), kind: 'boss', main: 'red', hair: null, armor: true },
  },
};

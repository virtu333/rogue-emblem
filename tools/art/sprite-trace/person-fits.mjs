// Person fits (2026-09-26): segmentation fixes for the generic player designs, so a
// portrait person's skin and hair ramps land on the whole figure. The reviewed designs
// were drawn as particular people (a dark-skinned woman, a red-haired swordswoman); the
// colour rules find their face but read bare arms as leather, a ponytail or a beard as
// cloth. Each entry is merged into the roster source of that id (roster.mjs):
//   rects  relabel boxes (normalised to the figure's bounds; `where` = a colour family of
//          lib/segment.mjs), applied first so they can seed the matches
//   match  extend a slot to the pixels drawn in its own colours (lib/segment.mjs)
//   head   the head box, where the automatic one lands on a hand or a blade
// Checked by eye with tools/art/sprite-trace/dev/slots-sheet.mjs (segmentation),
// dev/slot-probe.mjs (text map for boxes) and dev/person-sheet.mjs (portrait | sprite).
// Pure data.

/** Bare skin drawn in the face's colours (arms, shoulders, neck). */
const ARMS = (box = [0, 0.1, 1, 0.7], dE = 6, from = ['leather', 'accent', 'sub']) => ({
  slot: 'skin',
  from,
  box,
  dE,
});
/** Hair connected to the crown and drawn in its colours (ponytail, fringe, beard). */
const HAIR = (box = [0, 0, 1, 0.45], dE = 8, from = ['leather', 'accent', 'sub', 'skin']) => ({
  slot: 'hair',
  from,
  box,
  dE,
  grow: true,
});
const ANY = ['main', 'sub', 'trim', 'leather', 'accent', 'skin', 'linen', 'hair', 'armor', 'wood'];
/** The class sheets' player B is a red-haired woman: every vivid red pixel up top is hair. */
const RED_HAIR = (box = [0, 0, 1, 0.5]) => ({
  slot: 'hair',
  box,
  from: ANY,
  where: 'vividRedHair',
});
const RED_B = { rects: [RED_HAIR()], match: [HAIR()] };

export const PERSON_FITS = {
  // every design without its own entry
  default: { match: [HAIR()] },
  fighter_a: {
    head: [0.33, 0, 0.68, 0.22],
    rects: [
      { slot: 'hair', box: [0.35, 0, 0.7, 0.12], from: ['leather'] },
      { slot: 'hair', box: [0.42, 0.1, 0.62, 0.22], from: ['leather'] },
      { slot: 'skin', box: [0, 0.12, 0.35, 0.45], from: ['accent'] },
    ],
    match: [ARMS(), HAIR([0.3, 0, 0.7, 0.25])],
  },
  fighter_b: {
    match: [ARMS()],
    rects: [{ slot: 'skin', box: [0.25, 0.08, 0.5, 0.3], from: ['accent'] }],
  },
  mercenary_a: {
    // sandy hair: its highlights read as skin (and grown from skin it would take the face)
    rects: [{ slot: 'hair', box: [0.37, 0.1, 0.64, 0.19], from: ['skin', 'trim'] }],
    match: [HAIR(undefined, undefined, ['leather', 'accent', 'sub'])],
  },
  knight_b: {
    // the open helm's face reads as leather
    faceRects: [{ slot: 'skin', box: [0.44, 0.19, 0.64, 0.3], from: ['leather'] }],
    match: [HAIR()],
  },
  cavalier_b: {
    // black bun as line work, the face as gold and leather
    head: [0.38, 0.08, 0.6, 0.23],
    faceRects: [{ slot: 'skin', box: [0.44, 0.12, 0.6, 0.23], from: ['trim', 'leather'] }],
    rects: [
      { slot: 'hair', box: [0.4, 0.09, 0.56, 0.15], from: ['ink', 'sub'] },
      { slot: 'hair', box: [0.4, 0.15, 0.47, 0.22], from: ['ink', 'sub'] },
    ],
  },
  mage_b: {
    // lavender curls take the hat's hue (lighter), the face reads as leather
    faceRects: [{ slot: 'skin', box: [0.38, 0.15, 0.55, 0.29], from: ['leather'] }],
    rects: [{ slot: 'hair', box: [0.2, 0.08, 0.62, 0.3], from: ['main'], where: 'light' }],
  },
  cleric_a: {
    // a bald head drawn in leather tones; the scalp top becomes a hair cap that a bald
    // person's crown turns back into skin (a man with hair keeps it)
    head: [0.3, 0, 0.58, 0.22],
    faceRects: [{ slot: 'skin', box: [0.3, 0, 0.58, 0.22], from: ['leather'] }],
    rects: [{ slot: 'hair', box: [0.3, 0, 0.58, 0.075], from: ['skin'] }],
  },
  thief_a: {
    // the face under the hood reads as leather; the hood's inner shadow is the fringe
    faceRects: [{ slot: 'skin', box: [0.58, 0.22, 0.78, 0.4], from: ['leather'] }],
    rects: [{ slot: 'hair', box: [0.62, 0.19, 0.8, 0.235], from: ['ink'] }],
  },
  sage_a: {
    // brown hair reads as leather, the face as linen and gold
    faceRects: [
      { slot: 'skin', box: [0.52, 0.14, 0.66, 0.23], from: ['linen', 'trim', 'metal', 'main'] },
    ],
    rects: [{ slot: 'hair', box: [0.35, 0, 0.7, 0.15], from: ['leather'] }],
    match: [HAIR(undefined, undefined, ['leather', 'accent', 'sub'])],
  },
  assassin_b: {
    // a blond ponytail and hairline drawn in the skin's tones
    rects: [
      { slot: 'hair', box: [0.38, 0, 0.54, 0.2], from: ['skin', 'leather', 'trim'] },
      { slot: 'hair', box: [0.52, 0.06, 0.7, 0.085], from: ['skin', 'ink', 'main'] },
      { slot: 'hair', box: [0.64, 0.09, 0.72, 0.16], from: ['leather', 'trim'] },
    ],
  },
  dancer_b: {
    // an auburn bob drawn in the skin's hue family
    rects: [{ slot: 'hair', box: [0.3, 0, 0.8, 0.3], from: ['skin'], where: 'auburnHair' }],
  },
  mercenary_b: {
    // black curls read as line work, the face and arms as leather
    head: [0.36, 0.08, 0.64, 0.36],
    rects: [
      { slot: 'hair', box: [0.37, 0.09, 0.64, 0.19], from: ['ink', 'sub', 'hair'] },
      { slot: 'hair', box: [0.37, 0.19, 0.47, 0.26], from: ['ink'] },
    ],
    match: [ARMS()],
  },
  myrmidon_b: { match: [ARMS(), HAIR()] },
  // --- class-sheet B designs (red-haired women) ------------------------------------------
  swordmaster_b: RED_B,
  warrior_b: RED_B,
  paladin_b: RED_B,
  sniper_b: RED_B,
  sage_b: RED_B,
  bishop_b: RED_B,
  bard_b: RED_B,
  falcon_knight_b: RED_B,
  wyvern_lord_b: RED_B,
  hero_b: RED_B,
  duelist_b: RED_B,
  great_knight_b: RED_B,
  berserker_b: RED_B,
  dark_knight_b: RED_B,
  bow_knight_b: RED_B,
  warlock_b: RED_B,
  battle_monk_b: RED_B,
  trickster_b: RED_B,
  hunter_b: RED_B,
};

// The material-slot model shared by every tracer stage (same idea as the sprite-lab:
// every pixel is (slot, shade) until the last step, so faction, identity, corruption
// and states are ramp swaps). Pure constants.

export const SLOTS = [
  'empty', // 0
  'ink', // 1  outlines / interior line work
  'eye', // 2
  'skin', // 3
  'hair', // 4
  'main', // 5  faction area (player steel blue / enemy crimson lacquer / NPC verdigris)
  'sub', // 6  secondary cloth (charcoal, trousers, undershirt)
  'leather', // 7  belts, boots, gloves, straps
  'metal', // 8  weapon blades, spear heads
  'armor', // 9  plate, mail, helmets
  'trim', // 10 gold thread / buckles / embroidery (player) — iron trim for the enemy
  'linen', // 11 white / cream cloth
  'wood', // 12 shafts, bows, staves, book covers
  'mount', // 13 horse / pegasus / wyvern body
  'mane', // 14 mane, tail
  'glow', // 15 magic light, gems
  'accent', // 16 other saturated cloth kept from the source (scarves, sashes)
];

export const SLOT = Object.fromEntries(SLOTS.map((s, i) => [s, i]));

/** Slots whose pixels move with the weapon in motion frames. */
export const WEAPON_SLOTS = new Set([SLOT.metal, SLOT.wood, SLOT.glow]);

/** Slots that belong to the body silhouette (used for body-height sizing). */
export const BODY_EXCLUDE = new Set([SLOT.empty, SLOT.metal, SLOT.wood, SLOT.glow]);

/**
 * Priority of a slot when several compete for one reduced pixel (coverage x priority).
 * Small, identity-critical features (eyes, gold thread, skin of faces and hands,
 * weapon lines) must survive the reduction; big cloth masses can afford to lose.
 */
export const PRIORITY = {
  [SLOT.ink]: 1.0,
  [SLOT.eye]: 5.0,
  [SLOT.skin]: 1.3,
  [SLOT.hair]: 1.05,
  [SLOT.main]: 1.0,
  [SLOT.sub]: 0.95,
  [SLOT.leather]: 1.0,
  [SLOT.metal]: 1.5,
  [SLOT.armor]: 1.05,
  [SLOT.trim]: 1.4,
  [SLOT.linen]: 1.1,
  [SLOT.wood]: 1.35,
  [SLOT.mount]: 1.0,
  [SLOT.mane]: 1.0,
  [SLOT.glow]: 1.6,
  [SLOT.accent]: 1.1,
};

/** False colours for slot-map diagnostics. */
export const SLOT_DEBUG = {
  [SLOT.ink]: [10, 10, 14],
  [SLOT.eye]: [255, 0, 255],
  [SLOT.skin]: [250, 190, 150],
  [SLOT.hair]: [150, 80, 30],
  [SLOT.main]: [40, 90, 230],
  [SLOT.sub]: [70, 70, 90],
  [SLOT.leather]: [120, 70, 40],
  [SLOT.metal]: [230, 240, 255],
  [SLOT.armor]: [150, 160, 175],
  [SLOT.trim]: [250, 200, 40],
  [SLOT.linen]: [240, 230, 200],
  [SLOT.wood]: [180, 120, 60],
  [SLOT.mount]: [110, 160, 90],
  [SLOT.mane]: [60, 110, 50],
  [SLOT.glow]: [120, 255, 240],
  [SLOT.accent]: [200, 40, 160],
};

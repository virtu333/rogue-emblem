// Seeded identity. A recruit's look is a pure function of (appearanceSeed,
// class family): skin, hair style + ramp, face, beard, headgear, identity cloth.
// The seed is stored on the unit at recruitment, so the same person keeps the
// same face through promotion, reloads and cloud sync.
//
// Enemies do NOT roll identity: generic enemies wear their class's issue kit so
// every enemy Myrmidon reads as the same class at a glance (only skin varies).
import { mulberry32, pick, pickW } from './rng.mjs';

const SKINS = [
  ['skinFair', 3],
  ['skinWarm', 3],
  ['skinOlive', 2],
  ['skinTan', 2],
  ['skinDeep', 2],
];
const HAIR_RAMPS = [
  ['hairBlack', 3],
  ['hairBrown', 2.5],
  ['hairChestnut', 2],
  ['hairAuburn', 1.2],
  ['hairAsh', 1.5],
  ['hairSilver', 0.8],
  ['hairSlate', 1],
];
// no teal/green (Edric's signature), no blue or crimson (the factions)
const SUB_CLOTH = ['charcoal', 'ash', 'olive', 'rust', 'umber'];

// What each class family is allowed to roll. Keeps the class cue intact:
// e.g. an Archer may lower its hood, but never trades it for a helmet.
const FAMILY = {
  myrmidon: {
    scarf: true,
    hair: ['ponytail', 'bun', 'crop', 'long', 'shag'],
    headgear: [
      ['headband', 3],
      ['none', 2],
      ['headbandMain', 1],
    ],
    face: [
      ['youth', 3],
      ['mature', 1],
    ],
  },
  swordmaster: { same: 'myrmidon' },
  mercenary: {
    scarf: true,
    hair: ['shag', 'crop', 'swept', 'shaved', 'bob'],
    headgear: [
      ['none', 4],
      ['headband', 1],
    ],
    face: [
      ['mature', 3],
      ['youth', 1],
    ],
    beard: true,
  },
  thief: {
    hair: ['crop', 'shag', 'swept', 'bob'],
    headgear: [
      ['hood', 4],
      ['hoodSub', 1],
    ],
    face: [
      ['youth', 3],
      ['soft', 1],
    ],
  },
  fighter: {
    scarf: true,
    hair: ['crop', 'shaved', 'shag', 'spiky'],
    headgear: [
      ['headbandMain', 2],
      ['none', 2],
      ['headband', 1],
    ],
    face: [
      ['mature', 3],
      ['youth', 1],
    ],
    beard: true,
  },
  knight: {
    hair: ['crop', 'shag', 'bob', 'swept'],
    headgear: [['openHelm', 1]],
    face: [
      ['mature', 2],
      ['youth', 1],
      ['soft', 1],
    ],
    beard: true,
  },
  archer: {
    scarf: true,
    hair: ['swept', 'crop', 'ponytail', 'shag', 'bob'],
    headgear: [
      ['hood', 2],
      ['none', 2],
    ],
    face: [
      ['youth', 2],
      ['soft', 1],
      ['mature', 1],
    ],
  },
  mage: {
    hair: ['bob', 'swept', 'long', 'crop', 'bun', 'spiky'],
    headgear: [
      ['none', 5],
      ['circlet', 1],
    ],
    face: [
      ['soft', 2],
      ['youth', 2],
      ['mature', 1],
    ],
  },
  cleric: {
    hair: ['long', 'bob', 'bun', 'crop'],
    headgear: [
      ['none', 3],
      ['veil', 2],
    ],
    face: [
      ['soft', 3],
      ['youth', 1],
    ],
  },
  cavalier: {
    scarf: true,
    hair: ['crop', 'swept', 'shag', 'bob'],
    headgear: [
      ['none', 3],
      ['kettle', 1],
    ],
    face: [
      ['mature', 2],
      ['youth', 2],
    ],
    beard: true,
  },
  pegasus_knight: {
    hair: ['ponytail', 'bob', 'long', 'bun'],
    headgear: [
      ['none', 3],
      ['circlet', 1],
    ],
    face: [
      ['youth', 2],
      ['soft', 2],
    ],
  },
};

export function familyOf(cls) {
  const fam = FAMILY[cls];
  return fam?.same ? FAMILY[fam.same] : fam;
}

export function rollIdentity(seed, cls) {
  const fam = familyOf(cls) ?? FAMILY.myrmidon;
  const rnd = mulberry32(seed);
  const face = pickW(rnd, fam.face);
  const id = {
    skin: pickW(rnd, SKINS),
    hairRamp: pickW(rnd, HAIR_RAMPS),
    hair: pick(rnd, fam.hair),
    face,
    headgear: pickW(rnd, fam.headgear),
    sub: pick(rnd, SUB_CLOTH),
  };
  const b = rnd();
  id.beard =
    fam.beard && face === 'mature' ? (b < 0.35 ? 'full' : b < 0.6 ? 'stubble' : 'none') : 'none';
  const sc = rnd();
  id.scarf = fam.scarf && sc < 0.4 ? (sc < 0.2 ? 'linen' : 'sub') : null;
  return id;
}

// Issue kit for generic enemies of each class: fixed silhouette-bearing gear,
// dark imperial cloth; only skin and (mostly hidden) hair vary with the seed.
const ENEMY_KIT = {
  myrmidon: { hair: 'ponytail', headgear: 'headbandMain', face: 'mature', sub: 'charcoal' },
  swordmaster: { hair: 'ponytail', headgear: 'headbandMain', face: 'mature', sub: 'charcoal' },
  mercenary: { hair: 'crop', headgear: 'kettle', face: 'mature', sub: 'charcoal' },
  thief: { hair: 'crop', headgear: 'hood', face: 'mature', sub: 'charcoal' },
  fighter: { hair: 'shaved', headgear: 'kettle', face: 'mature', sub: 'charcoal' },
  knight: { hair: 'crop', headgear: 'greatHelm', face: 'mature', sub: 'charcoal' },
  archer: { hair: 'crop', headgear: 'hood', face: 'mature', sub: 'charcoal' },
  mage: { hair: 'crop', headgear: 'none', face: 'mature', sub: 'charcoal' },
  cleric: { hair: 'bob', headgear: 'veil', face: 'mature', sub: 'charcoal' },
  cavalier: { hair: 'crop', headgear: 'kettle', face: 'mature', sub: 'charcoal' },
  pegasus_knight: { hair: 'ponytail', headgear: 'kettle', face: 'mature', sub: 'charcoal' },
};

export function enemyIdentity(seed, cls) {
  const rnd = mulberry32(seed ^ 0x9e3779b9);
  return {
    ...(ENEMY_KIT[cls] ?? {}),
    skin: pickW(rnd, SKINS),
    hairRamp: pick(rnd, ['hairBlack', 'hairBrown', 'hairChestnut', 'hairAsh']),
    beard: 'none',
  };
}

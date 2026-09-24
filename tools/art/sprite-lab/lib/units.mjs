// Unit specs used by the lab: which classes, which seeds, how they map to the
// game's names and to the current rebuilt art for comparisons.
import { rollIdentity, enemyIdentity } from './identity.mjs';
import { renderUnit } from './build.mjs';
import { Img } from './image.mjs';

export const LORDS = ['lord_edric', 'lord_sera'];
export const GENERICS = [
  'myrmidon',
  'mercenary',
  'thief',
  'fighter',
  'knight',
  'archer',
  'mage',
  'cleric',
  'cavalier',
  'pegasus_knight',
];

// Weapon/move coverage for the README table.
export const COVERAGE = {
  myrmidon: 'infantry sword (slender, raised)',
  mercenary: 'infantry sword (broad, over shoulder)',
  thief: 'infantry sword (short, crouch)',
  fighter: 'infantry axe',
  knight: 'armored lance + shield',
  archer: 'infantry bow',
  mage: 'infantry tome',
  cleric: 'infantry staff',
  cavalier: 'mounted lance (horse)',
  pegasus_knight: 'flyer lance (pegasus)',
};

// Representative player seeds per class (picked from the seeded roll; see README).
export const PLAYER_SEED = {
  myrmidon: 11,
  mercenary: 7,
  thief: 5,
  fighter: 21,
  knight: 4,
  archer: 9,
  mage: 3,
  cleric: 2,
  cavalier: 14,
  pegasus_knight: 8,
  swordmaster: 11,
};

export function spec(cls, faction, seed = PLAYER_SEED[cls] ?? 1, extra = {}) {
  let id = {};
  if (!cls.startsWith('lord_'))
    id = faction === 'player' ? rollIdentity(seed, cls) : enemyIdentity(seed, cls);
  return {
    cls,
    faction,
    seed,
    id: { ...id, ...(extra.id ?? {}) },
    ...extra,
    idOverride: undefined,
  };
}

export function tex(unitSpec, opts = {}) {
  const { rgba } = renderUnit(unitSpec, opts);
  return Img.from(64, 64, rgba);
}

// Current rebuilt/legacy art used in the game for the same unit, when present.
// Player generics with no rebuilt art fall back to the game's legacy 48px sprites.
export const REBUILT_FOR = {
  lord_edric: { player: 'lord_edric' },
  lord_sera: { player: 'lord_sera' },
  myrmidon: { enemy: 'enemy_myrmidon', legacy: 'myrmidon' },
  mercenary: { legacy: 'mercenary' },
  thief: { legacy: 'thief' },
  fighter: { enemy: 'enemy_fighter', player: 'fighter' },
  knight: { enemy: 'enemy_knight', legacy: 'knight' },
  archer: { enemy: 'enemy_archer', legacy: 'archer' },
  mage: { enemy: 'enemy_mage', player: 'mage' },
  cleric: { legacy: 'cleric' },
  cavalier: { enemy: 'enemy_cavalier', legacy: 'cavalier' },
  pegasus_knight: { enemy: 'enemy_pegasus_knight', player: 'pegasus_knight' },
};

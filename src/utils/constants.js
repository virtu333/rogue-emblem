// Core game constants — derived from GDD

export const TILE_SIZE = 32;
export const PORTRAIT_SIZE = 128;

// Weapon triangle bonuses
export const WEAPON_TRIANGLE = {
  advantage: { hit: 10, damage: 1 },
  disadvantage: { hit: -10, damage: -1 },
  masteryAdvantage: { hit: 15, damage: 2 },
  masteryDisadvantage: { hit: -5, damage: -1 },
  // Matchups: winner → loser
  matchups: {
    Sword: 'Axe',
    Axe: 'Lance',
    Lance: 'Sword'
  }
};

// Double attack threshold
export const DOUBLE_ATTACK_SPD_THRESHOLD = 5;

// Critical multiplier
export const CRIT_MULTIPLIER = 3;

// Level cap
export const BASE_CLASS_LEVEL_CAP = 20;
export const PROMOTED_CLASS_LEVEL_CAP = 20;
export const PROMOTION_MIN_LEVEL = 10;

// Skill cap per unit
export const MAX_SKILLS = 5;

// XP system
export const XP_PER_LEVEL = 100;
export const XP_BASE_COMBAT = 30;
export const XP_KILL_BONUS = 20;
export const XP_BASE_DANCE = 20;
export const XP_LEVEL_DIFF_SCALE = 5;
export const XP_LEVEL_DIFF_STEEP = 8; // Steep XP penalty per level for advantage 4-6
export const XP_MIN = 1;
export const XP_STAT_NAMES = ['HP', 'STR', 'MAG', 'SKL', 'SPD', 'DEF', 'RES', 'LCK'];

// Deploy limits by act
export const DEPLOY_LIMITS = {
  act1:      { min: 3, max: 4 },
  act2:      { min: 4, max: 5 },
  act3:      { min: 5, max: 6 },
  postAct:   { min: 4, max: 6 },
  finalBoss: { min: 4, max: 6 },
};

// Enemy count = deployCount + roll(min, max)
// Pattern matches ACT_LEVEL_SCALING in NodeMapGenerator.js
export const ENEMY_COUNT_OFFSET = {
  act1:      { 0: [0, 0], 1: [0, 0], 2: [0, 1], 3: [0, 1], default: [1, 2], boss: [1, 2] },
  act2:      { 0: [1, 1], 1: [1, 2], default: [2, 3], boss: [3, 4] },
  act3:      { 0: [2, 2], default: [3, 4], boss: [4, 5] },
  finalBoss: { boss: [3, 5] },
};

// Colors for unit factions
export const FACTION_COLORS = {
  player: 0x3366cc,  // Blue
  enemy: 0xcc3333,   // Red
  npc: 0x33cc66      // Green
};

// Attack range highlight
export const ATTACK_RANGE_COLOR = 0xcc3333;
export const ATTACK_RANGE_ALPHA = 0.4;

// Terrain heal per turn (forts, thrones)
export const TERRAIN_HEAL_PERCENT = 0.10;
export const FORT_HEAL_DECAY_MULTIPLIERS = [1, 0.67, 0.34, 0.17, 0];
export const ANTI_TURTLE_NO_PROGRESS_TURNS = 3;

// Terrain index enum (matches terrain.json order)
export const TERRAIN = {
  Plain: 0, Forest: 1, Mountain: 2, Fort: 3, Throne: 4,
  Wall: 5, Water: 6, Bridge: 7, Sand: 8, Village: 9,
};

// Boss stat bonus (flat added to all stats)
export const BOSS_STAT_BONUS = 2;

// Boss recruit event
export const BOSS_RECRUIT_LORD_CHANCE = 0.12;  // 12% chance one slot is a lord
export const BOSS_RECRUIT_COUNT = 3;

// Act sequence and config for node map
export const ACT_SEQUENCE = ['act1', 'act2', 'act3', 'finalBoss'];

export const ACT_CONFIG = {
  act1:      { name: 'Border Skirmishes', rows: 6 },  // +1 row (~16 nodes avg, was ~13)
  act2:      { name: 'Occupied Territory', rows: 7 },  // +1 row (~19 nodes avg, was ~16)
  act3:      { name: 'Enemy Stronghold',  rows: 7 },  // +2 rows (~19 nodes avg, was ~13)
  finalBoss: { name: 'Final Battle',      rows: 1 },
};

export const NODE_TYPES = { BATTLE: 'battle', BOSS: 'boss', SHOP: 'shop', RECRUIT: 'recruit', CHURCH: 'church' };

// Gold multiplier per node type (applied to kill gold subtotal in calculateBattleGold)
export const NODE_GOLD_MULTIPLIER = {
  battle: 1.0,
  recruit: 1.2,   // Harder (must keep NPC alive) → more gold
  boss: 1.5,      // Already has GOLD_BOSS_BONUS; this stacks on kill gold
  church: 0,      // No combat
  shop: 0,        // No combat
};
export const ROSTER_CAP = 12;

// Gold economy
export const STARTING_GOLD = 200;
export const GOLD_PER_KILL_BASE = 25;
export const GOLD_PER_LEVEL_BONUS = 7;
export const GOLD_BATTLE_BONUS = 100;
export const GOLD_BOSS_BONUS = 300;
export const GOLD_SKIP_LOOT_MULTIPLIER = 1.50;
export const SHOP_SELL_RATIO = 0.5;
export const CHURCH_PROMOTE_COST = 2000;
export const LOOT_CHOICES = 3;
export const ELITE_LOOT_CHOICES = 4;   // Elite battles offer 4 loot choices
export const ELITE_MAX_PICKS = 2;      // Pick 2 from elite loot
export const ELITE_GOLD_MULTIPLIER = 1.25; // Elite battle gold bonus
export const SHOP_ITEM_COUNT = { min: 4, max: 6 };
export const INVENTORY_MAX = 5;      // Combat weapons + staves only
export const CONSUMABLE_MAX = 3;     // Separate consumables array
export const CONVOY_WEAPON_CAPACITY = 20;
export const CONVOY_CONSUMABLE_CAPACITY = 15;
export const SHOP_REROLL_COST = 150;
export const SHOP_REROLL_ESCALATION = 50;
export const LOOT_GOLD_TEAM_XP = { act1: 15, act2: 20, act3: 30, finalBoss: 40 };

// Weapon forging
export const FORGE_MAX_LEVEL = 15;
export const FORGE_STAT_CAP = 5;
export const FORGE_BONUSES = { might: 1, crit: 5, hit: 5, weight: -1 };
export const FORGE_COSTS = {
  might:  [400, 700, 1100, 1600, 2200],
  crit:   [300, 550, 900, 1200, 1700],
  hit:    [250, 450, 750, 1000, 1400],
  weight: [250, 450, 750, 1000, 1400],
};
export const SHOP_FORGE_LIMITS = { act1: 2, act2: 3, act3: 4, finalBoss: 0 };

// Dual currency economy (Valor = lord-focused, Supply = army-focused)
export const VALOR_PER_ACT = 50;
export const VALOR_PER_BATTLE = 15;
export const VALOR_VICTORY_BONUS = 200;
export const SUPPLY_PER_ACT = 50;
export const SUPPLY_PER_BATTLE = 15;
export const SUPPLY_VICTORY_BONUS = 200;

// Maps upgrade category → currency type
export const CATEGORY_CURRENCY = {
  lord_bonuses: 'valor',
  starting_equipment: 'valor',
  starting_skills: 'valor',
  recruit_stats: 'supply',
  economy: 'supply',
  capacity: 'supply',
};

// Staff mechanics
export const STAFF_BONUS_USE_THRESHOLDS = [8, 14, 20]; // MAG thresholds for +1 use each
export const PHYSIC_RANGE_BONUSES = [{ mag: 10, bonus: 1 }, { mag: 18, bonus: 1 }];

// Starting equipment meta upgrades
export const MAX_STARTING_SKILLS = 2;
// Sunder weapons (enemy-only, halves target DEF)
export const SUNDER_WEAPON_BY_TYPE = {
  Sword: 'Sunder Sword',
  Lance: 'Sunder Lance',
  Axe: 'Sunder Axe',
  Bow: 'Sunder Bow',
};
// Proficiency prefixes that have sunder variants (used to gate sunder rolls)
export const SUNDER_ELIGIBLE_PROFS = new Set(['Swords', 'Lances', 'Axes', 'Bows']);

export const DEADLY_ARSENAL_POOL = {
  Sword: ['Silver Sword', 'Killing Edge', 'Brave Sword', 'Ragnarok', 'Soulreaver', 'Gemini'],
  Lance: ['Silver Lance', 'Killer Lance', 'Brave Lance', 'Doomblade'],
  Axe:   ['Silver Axe', 'Killer Axe', 'Brave Axe', 'Stormbreaker', 'Ruin'],
  Bow:   ['Silver Bow', 'Killer Bow', 'Brave Bow', 'Starfall'],
  Tome:  ['Bolganone', 'Excalibur'],
  Light: ['Aura', 'Luce'],
};
export const RECRUIT_SKILL_POOL = [
  'sol', 'luna', 'astra', 'vantage', 'wrath', 'adept', 'miracle', 'guard',
  'cancel', 'desperation', 'quick_riposte', 'death_blow', 'darting_blow'
];
export const STARTING_ACCESSORY_TIERS = [null, 'Goddess Icon', 'Speed Ring', "Veteran's Crest"];
export const STARTING_STAFF_TIERS = ['Heal', 'Mend', 'Recover'];

// Fog of War
export const VISION_RANGES = { Infantry: 3, Armored: 3, Cavalry: 4, Flying: 5 };
export const FOG_CHANCE_BY_ACT = { act1: 0.10, act2: 0.25, act3: 0.35, finalBoss: 0 };

// Placeholder terrain colors (Phase 1 colored rectangles)
export const TERRAIN_COLORS = {
  Plain:    0x7ec850,
  Forest:   0x2d6a1e,
  Mountain: 0x8b7355,
  Fort:     0xb8a07a,
  Throne:   0xdaa520,
  Wall:     0x4a4a4a,
  Water:    0x2266aa,
  Bridge:   0x8b6c42,
  Sand:     0xd4b96a,
  Village:  0xc47035,
};

import defaults from '../../data/specialChars.json' with { type: 'json' };
import { parseWeaponProficiencies, normalizeUnitClassState } from './UnitManager.js';
import { ensureItemUid } from '../utils/itemUid.js';

// Fixed bases and growths; deliberately bypass recruit rolls, join perks and loadouts.
export function createVeteranKnight(gameData, { difficultyId = 'normal', metaGrowthBonuses = null, growthMultiplier = 1 } = {}) {
  const def = (gameData.specialChars || defaults).find((entry) => entry.id === 'old_knight');
  const cls = gameData.classes?.find((entry) => entry.name === def?.class);
  if (!def || !cls) return null;
  const stats = { ...def.baseStats, ...(def.difficultyBases[difficultyId] || {}) };
  const growths = { ...def.growths };
  for (const [stat, bonus] of Object.entries(metaGrowthBonuses || {})) {
    growths[stat] = (growths[stat] || 0) + Math.round(bonus * growthMultiplier * 0.5);
  }
  const inventory = def.weapons.map((name) => {
    const weapon = gameData.weapons.find((entry) => entry.name === name);
    if (!weapon) throw new Error(`Missing veteran weapon: ${name}`);
    return ensureItemUid(structuredClone(weapon));
  });
  const unit = {
    name: def.name,
    specialCharId: def.id,
    className: def.class,
    baseClass: def.baseClass,
    tier: 'promoted',
    level: 1,
    xp: 0,
    isLord: false,
    personalGrowths: null,
    growths,
    proficiencies: parseWeaponProficiencies(cls.weaponProficiencies),
    skills: [...def.skills],
    traits: [],
    temperament: def.temperament,
    col: 0,
    row: 0,
    mov: stats.MOV,
    moveType: cls.moveType,
    stats,
    currentHP: stats.HP,
    faction: 'player',
    weapon: inventory[0],
    inventory,
    consumables: [],
    affixes: [],
    accessory: null,
    hasMoved: false,
    hasActed: false,
    graphic: null,
    label: null,
    hpBar: null,
  };
  normalizeUnitClassState(unit, cls);
  return unit;
}

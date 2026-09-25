import { describe, expect, it } from 'vitest';
import {
  getCombatForecast,
  weaponSpecialChangesExchangeHp,
  accessoryChangesExchangeHp,
} from '../src/engine/Combat.js';
import { forecastProjection } from '../src/ui/forecastDisplay.js';
import { loadGameData } from './testData.js';

// Playtest 2026-09-22 #23/#35: the HP/KO projection vanished for Lightning
// ("Lightest magic") and for any unit wearing a Soothing Stone, because every
// weapon special and every accessory effect was treated as a hidden proc.
const data = loadGameData();
const catalogWeapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));
const catalogAccessory = (name) => structuredClone(data.accessories.find((a) => a.name === name));
const sword = {
  name: 'Sword',
  type: 'Sword',
  range: '1',
  might: 5,
  hit: 100,
  crit: 0,
  weight: 0,
  special: '',
};
function unit(name, weapon = { ...sword }) {
  return {
    name,
    weapon,
    faction: name === 'A' ? 'player' : 'enemy',
    className: 'Myrmidon',
    skills: [],
    currentHP: 20,
    stats: { HP: 20, STR: 8, MAG: 0, SKL: 10, SPD: 10, DEF: 4, RES: 3, LCK: 20 },
    weaponRank: 'Mast',
  };
}
const forecast = (a, d, distance = 1) =>
  getCombatForecast(a, a.weapon, d, d.weapon, distance, null, null, {
    skillsData: data.skills,
    imbuesData: data.imbues,
  });

describe('forecast HP projection keeps descriptive specials and static accessories', () => {
  it('projects a lethal Lightning exchange (8 damage vs 8 HP)', () => {
    const a = unit('A', catalogWeapon('Lightning'));
    const d = unit('D');
    a.stats.MAG = 20;
    a.stats.SKL = 100;
    d.currentHP = 8;
    const f = forecast(a, d);
    expect(f.attacker.damage).toBeGreaterThanOrEqual(8);
    expect(forecastProjection(f)?.defenderHP).toBe(0);
  });

  it.each([
    'Soothing Stone',
    'Life Ring',
    'Pursuit Ring',
    "Gambler's Coin",
    "Mentor's Band",
    "Duelist's Glove",
  ])('keeps the projection with %s equipped', (name) => {
    const a = unit('A');
    a.accessory = catalogAccessory(name);
    expect(a.accessory).toBeTruthy();
    expect(forecastProjection(forecast(a, unit('D')))).not.toBeNull();
  });

  it.each(["Vampire's Bloodshard", 'Phoenix Brooch'])('omits it with %s (HP changes)', (name) => {
    const a = unit('A');
    a.accessory = catalogAccessory(name);
    expect(forecastProjection(forecast(a, unit('D')))).toBeNull();
  });

  it.each(['Soulreaver', 'Venin Blade'])('omits it when the attacker wields %s', (name) => {
    const a = unit('A', catalogWeapon(name));
    expect(forecastProjection(forecast(a, unit('D')))).toBeNull();
  });

  it('a defender poison weapon only matters when it can counter', () => {
    const archer = unit('A', catalogWeapon('Iron Bow'));
    const d = unit('D', catalogWeapon('Venin Blade'));
    const ranged = forecast(archer, d, 2);
    expect(ranged.defender.canCounter).toBe(false);
    expect(forecastProjection(ranged)).not.toBeNull();
    const melee = forecast(unit('A'), d);
    expect(melee.defender.canCounter).toBe(true);
    expect(forecastProjection(melee)).toBeNull();
  });

  it('classifies every weapon special in the data', () => {
    const dynamic = new Set();
    for (const w of data.weapons) {
      if (w.special && weaponSpecialChangesExchangeHp(w)) dynamic.add(w.special);
    }
    // Only drain and post-combat poison change HP outside the numbers shown.
    expect([...dynamic].sort()).toEqual([
      'Drains HP equal to damage dealt',
      'Poison: target loses 5 HP after combat',
    ]);
  });

  it('lists exactly the accessories that change HP inside an exchange', () => {
    const dynamic = data.accessories
      .filter((a) => a.combatEffects && accessoryChangesExchangeHp({ accessory: a }))
      .map((a) => a.name)
      .sort();
    expect(dynamic).toEqual(['Phoenix Brooch', "Vampire's Bloodshard"]);
  });
});

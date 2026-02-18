import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('data consistency workflow guards', () => {
  it('Doublebow uses a valid, existing weapon-art linkage', () => {
    const weapons = readJson('data/weapons.json');
    const arts = readJson('data/weaponArts.json')?.arts || [];
    const artById = new Map(arts.map((art) => [art.id, art]));
    const doublebow = weapons.find((weapon) => weapon.name === 'Doublebow');

    expect(doublebow).toBeTruthy();
    expect(Array.isArray(doublebow.weaponArtIds)).toBe(true);
    expect(doublebow.weaponArtIds.length).toBeGreaterThan(0);

    for (const artId of doublebow.weaponArtIds) {
      const art = artById.get(artId);
      expect(art).toBeTruthy();
      expect(Array.isArray(art.legendaryWeaponIds)).toBe(true);
      expect(art.legendaryWeaponIds).toContain('Doublebow');
    }
  });

  it('Sera promotion bonuses match Light Priestess promotion bonuses', () => {
    const lords = readJson('data/lords.json');
    const classes = readJson('data/classes.json');
    const sera = lords.find((lord) => lord.name === 'Sera');

    expect(sera).toBeTruthy();
    expect(sera.promotedClass).toBe('Light Priestess');

    const promotedClass = classes.find((klass) => klass.name === sera.promotedClass);
    expect(promotedClass).toBeTruthy();
    expect(sera.promotionBonuses).toEqual(promotedClass.promotionBonuses);
  });

  it('unlock_guard metadata text matches Guard skill behavior', () => {
    const upgrades = readJson('data/metaUpgrades.json');
    const skills = readJson('data/skills.json');
    const guardUnlock = upgrades.find((upgrade) => upgrade.id === 'unlock_guard');
    const guardSkill = skills.find((skill) => skill.id === 'guard');

    expect(guardUnlock).toBeTruthy();
    expect(guardSkill).toBeTruthy();
    expect(guardUnlock.description).toBe('Unlocks Guard (+3 DEF/RES when adjacent to an ally)');
    expect(guardSkill.description).toBe('+3 DEF/RES when adjacent to an ally');
  });

  it('enemy-only Sunder weapons and Venin Bow are excluded from standard loot pools', () => {
    const lootTables = readJson('data/lootTables.json');
    const enemyOnlyWeapons = ['Venin Bow', 'Sunder Sword', 'Sunder Lance', 'Sunder Axe', 'Sunder Bow'];

    for (const act of ['act1', 'act2', 'act3']) {
      const table = lootTables[act] || {};
      const standardWeapons = Array.isArray(table.weapons) ? table.weapons : [];
      const legendaryWeapons = Array.isArray(table.legendaryWeapon) ? table.legendaryWeapon : [];
      for (const weaponName of enemyOnlyWeapons) {
        expect(standardWeapons).not.toContain(weaponName);
        expect(legendaryWeapons).not.toContain(weaponName);
      }
    }
  });
});

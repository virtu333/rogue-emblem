import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createEnemyUnit, promoteUnit, canEquip, resolvePromotionTargetClass } from '../src/engine/UnitManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const dataDir = join(rootDir, 'data');

function loadJSON(filename) {
  return JSON.parse(readFileSync(join(dataDir, filename), 'utf-8'));
}

const classes = loadJSON('classes.json');
const weapons = loadJSON('weapons.json');
const lords = loadJSON('lords.json');
const enemies = loadJSON('enemies.json');
const recruits = loadJSON('recruits.json');
const skills = loadJSON('skills.json');

describe('Wyvern integration (no reclass)', () => {
  it('class data includes Wyvern Rider -> Wyvern Lord progression', () => {
    const rider = classes.find(c => c.name === 'Wyvern Rider');
    const lord = classes.find(c => c.name === 'Wyvern Lord');

    expect(rider).toBeTruthy();
    expect(lord).toBeTruthy();
    expect(rider.tier).toBe('base');
    expect(rider.promotesTo).toBe('Wyvern Lord');
    expect(rider.moveType).toBe('Flying');
    expect(rider.weaponProficiencies).toContain('Lances');

    expect(lord.tier).toBe('promoted');
    expect(lord.promotesFrom).toBe('Wyvern Rider');
    expect(lord.moveType).toBe('Flying');
    expect(lord.weaponProficiencies).toContain('Axes');
  });

  it('Wyvern classes are available in intended enemy and recruit pools', () => {
    expect(enemies.pools.act2.base).toContain('Wyvern Rider');
    expect(enemies.pools.act3.base).toContain('Wyvern Rider');
    expect(enemies.pools.act3.promoted).toContain('Wyvern Lord');
    expect(enemies.pools.postAct.promoted).toContain('Wyvern Lord');

    expect(recruits.act2.classPool).toContain('Wyvern Rider');
    expect(recruits.act3.classPool).toContain('Wyvern Lord');
  });

  it('promotion target resolution supports Wyvern path and stops at promoted tier', () => {
    const rider = classes.find(c => c.name === 'Wyvern Rider');
    const lord = classes.find(c => c.name === 'Wyvern Lord');

    const baseUnit = createEnemyUnit(rider, 10, weapons);
    const promotionTarget = resolvePromotionTargetClass(baseUnit, classes, lords);
    expect(promotionTarget?.name).toBe('Wyvern Lord');

    promoteUnit(baseUnit, lord, lord.promotionBonuses, skills);
    const secondTarget = resolvePromotionTargetClass(baseUnit, classes, lords);
    expect(secondTarget).toBeNull();
  });

  it('Wyvern loadout legality is enforced before/after promotion', () => {
    const rider = classes.find(c => c.name === 'Wyvern Rider');
    const lord = classes.find(c => c.name === 'Wyvern Lord');
    const ironLance = structuredClone(weapons.find(w => w.name === 'Iron Lance'));
    const ironAxe = structuredClone(weapons.find(w => w.name === 'Iron Axe'));

    const unit = createEnemyUnit(rider, 10, weapons);
    expect(canEquip(unit, ironLance)).toBe(true);
    expect(canEquip(unit, ironAxe)).toBe(false);

    promoteUnit(unit, lord, lord.promotionBonuses, skills);
    expect(canEquip(unit, ironLance)).toBe(true);
    expect(canEquip(unit, ironAxe)).toBe(true);
  });

  it('placeholder/final assets for wyvern sprites and portraits are present', () => {
    const expectedFiles = [
      'assets/sprites/characters/wyvern_rider.png',
      'assets/sprites/characters/wyvern_lord.png',
      'assets/sprites/enemies/wyvern_rider.png',
      'assets/sprites/enemies/wyvern_lord.png',
      'assets/portraits/generic_wyvern_rider.png',
      'assets/portraits/generic_wyvern_lord.png',
      'public/assets/sprites/characters/wyvern_rider.png',
      'public/assets/sprites/characters/wyvern_lord.png',
      'public/assets/sprites/enemies/wyvern_rider.png',
      'public/assets/sprites/enemies/wyvern_lord.png',
      'public/assets/portraits/generic_wyvern_rider.png',
      'public/assets/portraits/generic_wyvern_lord.png',
    ];

    for (const relPath of expectedFiles) {
      expect(existsSync(join(rootDir, relPath)), `${relPath} missing`).toBe(true);
    }
  });
});

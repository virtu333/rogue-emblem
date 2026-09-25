import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import {
  FX_FAMILIES,
  WEAPON_FX_RULES,
  fxFamilyIdForWeapon,
  fxFamily,
  statusFxKey,
  dustKeyFor,
  deathStyleFor,
  DEATH_STYLES,
} from '../src/art/combatFx/fxFamilies.js';
import FX_TABLE from '../src/art/combatFx/fxAnims.json';
import { STATUS_CONDITIONS } from '../src/utils/constants.js';

const { weapons, terrain } = loadGameData();
const byName = (name) => weapons.find((w) => w.name === name);

describe('combat FX family mapping (one table, data-driven)', () => {
  it('maps every combat weapon in data/weapons.json to a family whose art exists', () => {
    for (const weapon of weapons.filter((w) => w.type !== 'Scroll')) {
      for (const distance of [1, 2, 3]) {
        const id = fxFamilyIdForWeapon(weapon, { distance });
        expect(FX_FAMILIES[id], `${weapon.name} @${distance}`).toBeTruthy();
        const family = fxFamily(id);
        expect(FX_TABLE.anims[family.impact], `${weapon.name} impact`).toBeTruthy();
        if (family.projectile)
          expect(FX_TABLE.anims[family.projectile.key], `${weapon.name} projectile`).toBeTruthy();
        if (family.extra) expect(FX_TABLE.anims[family.extra]).toBeTruthy();
      }
    }
  });

  it('derives tome elements from weapon names and lore', () => {
    for (const name of ['Fire', 'Elfire', 'Bolganone', 'Witchfire'])
      expect(fxFamilyIdForWeapon(byName(name))).toBe('fire');
    expect(fxFamilyIdForWeapon(byName('Excalibur'))).toBe('wind');
    expect(fxFamilyIdForWeapon(byName('Bolting'), { distance: 5 })).toBe('thunder');
    expect(fxFamilyIdForWeapon(byName('Twisting Vortex'))).toBe('dark');
    // Light tomes stay holy light even when the name says lightning.
    for (const name of ['Lightning', 'Shine', 'Aura', 'Sunflare', 'Luce'])
      expect(fxFamilyIdForWeapon(byName(name))).toBe('light');
    // An unknown tome falls back through lore, then the type default.
    expect(fxFamilyIdForWeapon({ type: 'Tome', name: 'Gale Page', lore: '' })).toBe('wind');
    expect(fxFamilyIdForWeapon({ type: 'Tome', name: 'Odd Page', lore: 'Storm in a book.' })).toBe(
      'thunder',
    );
    expect(fxFamilyIdForWeapon({ type: 'Tome', name: 'Odd Page', lore: '' })).toBe('fire');
  });

  it('picks melee and ranged forms, breath variants and the Entity', () => {
    expect(fxFamilyIdForWeapon(byName('Iron Sword'))).toBe('sword');
    expect(fxFamilyIdForWeapon(byName('Hand Axe'), { distance: 2 })).toBe('thrownAxe');
    expect(fxFamilyIdForWeapon(byName('Hand Axe'), { distance: 1 })).toBe('axe');
    expect(fxFamilyIdForWeapon(byName('Javelin'), { distance: 2 })).toBe('thrownLance');
    expect(fxFamilyIdForWeapon(byName('Levin Sword'), { distance: 2 })).toBe('thunder');
    expect(fxFamilyIdForWeapon(byName('Levin Sword'), { distance: 1 })).toBe('sword');
    expect(fxFamilyIdForWeapon(byName('Wind Sword'), { distance: 2 })).toBe('wind');
    expect(fxFamilyIdForWeapon(byName('Ragnarok'), { distance: 2 })).toBe('bladeWave');
    expect(fxFamilyIdForWeapon(byName('Iron Bow'), { distance: 2 })).toBe('bow');
    expect(fxFamilyIdForWeapon(byName('Fire Breath'))).toBe('breath');
    expect(fxFamilyIdForWeapon(byName('Toxic Breath'))).toBe('breathToxic');
    expect(fxFamilyIdForWeapon(byName('Ancient Breath'))).toBe('breathAncient');
    expect(fxFamilyIdForWeapon(byName('Eldritch Grasp'))).toBe('dark');
    expect(fxFamilyIdForWeapon(byName('Iron Sword'), { entity: true })).toBe('dark');
    expect(fxFamilyIdForWeapon(null)).toBe('sword');
    // Every rule target is a real family.
    const targets = [
      ...Object.values(WEAPON_FX_RULES.byName),
      ...Object.values(WEAPON_FX_RULES.byType),
      ...WEAPON_FX_RULES.elements.map(([f]) => f),
    ].flatMap((r) => (typeof r === 'string' ? [r] : Object.values(r)));
    for (const t of targets) expect(FX_FAMILIES[t], t).toBeTruthy();
  });

  it('has an overlay per status condition in the data, and a generic fallback', () => {
    for (const id of [...Object.keys(STATUS_CONDITIONS), 'poison'])
      expect(FX_TABLE.anims[statusFxKey(id)], id).toBeTruthy();
    expect(statusFxKey('sleep')).toBe('fx_status_sleep');
    expect(statusFxKey('unknown')).toBe('fx_status');
  });

  it('reads the ground under a unit: terrain first, then the biome', () => {
    for (const t of terrain)
      expect(FX_TABLE.anims[dustKeyFor(t.name, 'grassland')], t.name).toBeTruthy();
    expect(dustKeyFor('Plain', 'grassland')).toBe('fx_dust');
    expect(dustKeyFor('Plain', 'tundra')).toBe('fx_dust_snow');
    expect(dustKeyFor('Plain', 'volcano')).toBe('fx_dust_ash');
    expect(dustKeyFor('Water', 'grassland')).toBe('fx_dust_splash');
    expect(dustKeyFor('Swamp', 'swamp')).toBe('fx_dust_mire');
    expect(dustKeyFor('Floor', 'castle')).toBe('fx_dust_stone');
    expect(dustKeyFor('Forest', 'grassland')).toBe('fx_dust_leaves');
    expect(dustKeyFor('Forest', 'tundra')).toBe('fx_dust_snow');
    expect(dustKeyFor('Lava Crack', 'volcano')).toBe('fx_dust_sparks');
  });

  it('gives each death its own treatment within the mote budget', () => {
    expect(deathStyleFor({ faction: 'player' })).toBe('player');
    expect(deathStyleFor({ faction: 'enemy' })).toBe('enemy');
    expect(deathStyleFor({ faction: 'npc' })).toBe('npc');
    expect(deathStyleFor({ faction: 'enemy', isBoss: true })).toBe('boss');
    expect(deathStyleFor({ faction: 'enemy', isBoss: true, isEntity: true })).toBe('entity');
    for (const style of Object.values(DEATH_STYLES)) expect(style.motes).toBeLessThanOrEqual(60);
  });
});

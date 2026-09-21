import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadGameData } from './testData.js';
import { RunManager } from '../src/engine/RunManager.js';
import { generateLootChoices } from '../src/engine/LootSystem.js';
import { canUseWeaponArt, getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { weaponArtDetailLines } from '../src/ui/weaponArtDisplay.js';
const data = loadGameData();
const lateArts = data.weaponArts.arts.filter((a) => a.unlockAct === 'act4');
afterEach(() => vi.restoreAllMocks());
describe('Act 4 reward identity', () => {
  it('offers each late art through a real, compatible scroll reward', () => {
    expect(lateArts).toHaveLength(8);
    for (const art of lateArts) {
      const scroll = data.weapons.find((w) => w.teachesWeaponArtId === art.id);
      expect(scroll).toBeTruthy();
      expect(data.lootTables.act4.weaponArtScroll).toContain(scroll.name);
      for (const earlier of ['act1', 'act2', 'act3'])
        expect(data.lootTables[earlier].weaponArtScroll).not.toContain(scroll.name);
      const table = structuredClone(data.lootTables);
      table.act4.weights = { weaponArtScroll: 100 };
      table.act4.weaponArtScroll = [scroll.name];
      vi.spyOn(Math, 'random').mockReturnValue(0.4);
      const [reward] = generateLootChoices('act4', table, data.weapons, data.consumables, 1);
      expect(reward.item.teachesWeaponArtId).toBe(art.id);
      const unit = {
        faction: 'player',
        currentHP: 30,
        stats: { HP: 30 },
        proficiencies: [{ type: art.weaponType, rank: 'Prof' }],
      };
      expect(scroll.allowedWeaponTypes).toContain(art.weaponType);
      expect(canUseWeaponArt(unit, { type: art.weaponType }, art).ok).toBe(true);
      expect(art.hpCost).toBeGreaterThanOrEqual(7);
      expect(art.perMapLimit).toBeLessThanOrEqual(2);
      const mods = getWeaponArtCombatMods(art);
      for (const [key, value] of Object.entries(art.combatMods)) expect(mods[key]).toEqual(value);
    }
  });
  it('keeps scroll-only arts out of early innate weapon grants and loot', () => {
    const manager = new RunManager(data);
    const pools = manager._buildWeaponArtSpawnPools({ includeSilver: true });
    const innateIds = [...pools.values()].flatMap((byType) => [...byType.values()].flat());
    for (const art of lateArts) expect(innateIds).not.toContain(art.id);
    const table = structuredClone(data.lootTables);
    table.act3.weights = { weapon: 100 };
    table.act3.weapons = ['Silver Sword'];
    vi.spyOn(Math, 'random').mockReturnValue(0.4);
    const [reward] = generateLootChoices(
      'act3',
      table,
      data.weapons,
      data.consumables,
      1,
      0,
      null,
      null,
      null,
      false,
      null,
      false,
      { enableSilver: true, weaponArtCatalog: lateArts },
    );
    expect(reward.item.name).toBe('Silver Sword');
    expect(reward.item.weaponArtIds).toBeUndefined();
  });
  it('raises late value, cuts basic healing, and includes specialist staves', () => {
    const late = data.lootTables.act4,
      prior = data.lootTables.act3;
    expect(late.weights.legendaryWeapon).toBeGreaterThan(prior.weights.legendaryWeapon);
    expect(late.weights.forge).toBeGreaterThan(prior.weights.forge);
    expect(late.healing).not.toContain('Herb');
    for (const name of ['Fortify', 'Sleep Staff', 'Silence Staff']) {
      expect(late.weapons).toContain(name);
      expect(prior.weapons).not.toContain(name);
      expect(data.weapons.find((w) => w.name === name)?.type).toBe('Staff');
    }
  });
  it('explains the shared follow-up tradeoff in item details', () => {
    expect(weaponArtDetailLines(lateArts[0]).join(' ')).toContain(
      'do not gain a follow-up attack from Speed',
    );
  });
});

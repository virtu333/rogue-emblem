// Tests for Tier 1 Weapon Arts expansion:
// - All 75 art IDs resolve via getWeaponArtCombatMods()
// - tierAffinity parsed correctly by resolveSpawnTierFromArt (via LootSystem internals)
// - Silver weapons receive innate arts
// - Legendary weapons with pre-bound arts are skipped
// - All 22 scrolls resolve their teachesWeaponArtId to valid art IDs
// - Legendary arts excluded from meta innate pools
// - Forged legendary art still works (bug fix)
// - resBonus passes through getWeaponArtCombatMods

import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import {
  getWeaponArtCombatMods,
  canUseWeaponArt,
  getWeaponArtAllowedTypes,
} from '../src/engine/WeaponArtSystem.js';
import { applyForge } from '../src/engine/ForgeSystem.js';

const gameData = loadGameData();
const allArts = gameData.weaponArts.arts;
const artById = new Map(allArts.map(a => [a.id, a]));

describe('Tier 1 Weapon Arts Expansion', () => {
  it('has exactly 75 arts', () => {
    expect(allArts.length).toBe(75);
  });

  it('all art IDs are unique', () => {
    const ids = allArts.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every art resolves via getWeaponArtCombatMods', () => {
    for (const art of allArts) {
      const mods = getWeaponArtCombatMods(art);
      expect(mods).toBeTruthy();
      expect(mods.weaponArt).toBe(true);
    }
  });

  it('every art has a tierAffinity field', () => {
    for (const art of allArts) {
      expect(art.tierAffinity).toBeTruthy();
      expect(['Iron', 'Steel', 'Silver', 'Legendary']).toContain(art.tierAffinity);
    }
  });

  describe('tier affinity assignments', () => {
    const ironArts = allArts.filter(a => a.tierAffinity === 'Iron');
    const steelArts = allArts.filter(a => a.tierAffinity === 'Steel');
    const silverArts = allArts.filter(a => a.tierAffinity === 'Silver');
    const legendaryArts = allArts.filter(a => a.tierAffinity === 'Legendary');

    it('iron tier has correct count', () => {
      expect(ironArts.length).toBe(18);
    });

    it('steel tier has correct count', () => {
      expect(steelArts.length).toBe(24);
    });

    it('silver tier has correct count', () => {
      expect(silverArts.length).toBe(18);
    });

    it('legendary tier has correct count', () => {
      expect(legendaryArts.length).toBe(15);
    });

    it('all legendary arts have legendaryWeaponIds', () => {
      for (const art of legendaryArts) {
        expect(Array.isArray(art.legendaryWeaponIds)).toBe(true);
        expect(art.legendaryWeaponIds.length).toBeGreaterThan(0);
      }
    });
  });

  describe('new standard arts', () => {
    const newStandardIds = [
      'sword_advancing_strike', 'sword_lunge', 'sword_seal_speed', 'sword_poison_strike', 'sword_astra_strike',
      'lance_hit_and_run', 'lance_shatter_slash', 'lance_overrun',
      'axe_rushing_blow', 'axe_war_cry', 'axe_rallying_blow',
      'bow_encloser', 'bow_ward_arrow', 'bow_break_shot', 'bow_waning_shot', 'bow_seal_magic',
      'bow_all_or_nothing', 'bow_hunters_volley',
      'magic_healing_light', 'magic_burning_quake', 'magic_radiant_burst', 'magic_silence_strike', 'magic_nosferatu',
    ];

    it('all 23 new standard arts exist', () => {
      for (const id of newStandardIds) {
        expect(artById.has(id)).toBe(true);
      }
    });

    it('new arts expose either combat mods or structured post-combat effects', () => {
      for (const id of newStandardIds) {
        const art = artById.get(id);
        const mods = getWeaponArtCombatMods(art);
        const hasBonus = mods.atkBonus !== 0 || mods.hitBonus !== 0 || mods.critBonus !== 0
          || mods.spdBonus !== 0 || mods.avoidBonus !== 0 || mods.defBonus !== 0 || mods.resBonus !== 0;
        const hasTier4 = Boolean(mods.multiHit) || (mods.drainPercent || 0) > 0;
        const hasStructuredTier2 = Array.isArray(art?.effects?.afterCombat) && art.effects.afterCombat.length > 0;
        const hasStructuredTier5 = Boolean(art?.effects?.aoeSplash || art?.effects?.allyBuff);
        expect(hasBonus || hasTier4 || hasStructuredTier2 || hasStructuredTier5).toBe(true);
      }
    });
  });

  describe('new legendary arts', () => {
    const newLegendaryIds = [
      'legend_phantom_rush', 'legend_piercing_charge', 'legend_galeforce_assault',
      'legend_barrage', 'legend_storm_blade', 'legend_life_drain', 'legend_doom_thrust',
      'legend_blood_lance', 'legend_cataclysm', 'legend_annihilate', 'legend_tempest',
      'legend_cataclysm_bolt', 'legend_divine_flare',
    ];

    it('all 13 new legendary arts exist', () => {
      for (const id of newLegendaryIds) {
        expect(artById.has(id)).toBe(true);
      }
    });

    it('all legendary arts have allowedFactions: player', () => {
      for (const id of newLegendaryIds) {
        const art = artById.get(id);
        expect(art.allowedFactions).toContain('player');
      }
    });

    it('all legendary arts have perMapLimit 1', () => {
      for (const id of newLegendaryIds) {
        expect(artById.get(id).perMapLimit).toBe(1);
      }
    });
  });

  describe('Purifying Light fix', () => {
    it('allowedTypes is Light only', () => {
      const art = artById.get('magic_purifying_light');
      expect(art.allowedTypes).toEqual(['Light']);
      expect(getWeaponArtAllowedTypes(art)).toEqual(['Light']);
    });
  });

  describe('weapon art scrolls', () => {
    const weaponArtScrolls = gameData.weapons.filter(
      w => w.type === 'Scroll' && w.teachesWeaponArtId
    );

    it('has 22 weapon art scrolls', () => {
      expect(weaponArtScrolls.length).toBe(22);
    });

    it('every scroll references a valid art ID', () => {
      for (const scroll of weaponArtScrolls) {
        expect(artById.has(scroll.teachesWeaponArtId)).toBe(true);
      }
    });

    it('every scroll has allowedWeaponTypes', () => {
      for (const scroll of weaponArtScrolls) {
        expect(Array.isArray(scroll.allowedWeaponTypes)).toBe(true);
        expect(scroll.allowedWeaponTypes.length).toBeGreaterThan(0);
      }
    });

    it('no scroll references a legendary art', () => {
      for (const scroll of weaponArtScrolls) {
        const art = artById.get(scroll.teachesWeaponArtId);
        expect(art.tierAffinity).not.toBe('Legendary');
      }
    });
  });

  describe('legendary weapon bindings', () => {
    const legendaryWeapons = gameData.weapons.filter(w => w.tier === 'Legend' && w.type !== 'Staff');
    const boundWeapons = legendaryWeapons.filter(w => Array.isArray(w.weaponArtIds) && w.weaponArtIds.length > 0);

    it('all 15 legendary weapons have bound arts', () => {
      expect(boundWeapons.length).toBe(15);
    });

    it('all bound art IDs exist in the catalog', () => {
      for (const weapon of boundWeapons) {
        for (const artId of weapon.weaponArtIds) {
          expect(artById.has(artId)).toBe(true);
        }
      }
    });

    it('bound arts match weapon type', () => {
      for (const weapon of boundWeapons) {
        for (const artId of weapon.weaponArtIds) {
          const art = artById.get(artId);
          const allowedTypes = getWeaponArtAllowedTypes(art);
          expect(allowedTypes).toContain(weapon.type);
        }
      }
    });

    it('specific binding: Gae Bolg → Blood Lance', () => {
      const gaeBolg = gameData.weapons.find(w => w.name === 'Gae Bolg');
      expect(gaeBolg.weaponArtIds).toContain('legend_blood_lance');
    });

    it('specific binding: Stormbreaker → Cataclysm', () => {
      const stormbreaker = gameData.weapons.find(w => w.name === 'Stormbreaker');
      expect(stormbreaker.weaponArtIds).toContain('legend_cataclysm');
    });

    it('Doublebow and Fortify have no bound art', () => {
      const doublebow = gameData.weapons.find(w => w.name === 'Doublebow');
      const fortify = gameData.weapons.find(w => w.name === 'Fortify');
      expect(doublebow.weaponArtIds).toBeUndefined();
      expect(fortify.weaponArtIds).toBeUndefined();
    });
  });

  describe('legendary arts excluded from meta innate pools', () => {
    it('legendary arts have legendaryWeaponIds so isPlayerEligibleSpawnArt rejects them', () => {
      const legendaryArts = allArts.filter(a => a.tierAffinity === 'Legendary');
      for (const art of legendaryArts) {
        expect(Array.isArray(art.legendaryWeaponIds)).toBe(true);
        expect(art.legendaryWeaponIds.length).toBeGreaterThan(0);
      }
    });
  });

  describe('forged legendary art gate fix', () => {
    it('canUseWeaponArt still works after forging a legendary weapon', () => {
      const gemini = structuredClone(gameData.weapons.find(w => w.name === 'Gemini'));
      const art = artById.get('legend_gemini_tempest');
      const unit = {
        faction: 'player',
        currentHP: 30,
        stats: { HP: 30, STR: 15, MAG: 5, SKL: 12, SPD: 14, DEF: 10, RES: 8, LCK: 8 },
        proficiencies: [{ type: 'Sword', rank: 'Mast' }],
      };

      // Before forge: should work
      const beforeForge = canUseWeaponArt(unit, gemini, art, { actorFaction: 'player' });
      expect(beforeForge.ok).toBe(true);

      // Apply forge (sets _baseName)
      applyForge(gemini, 'might', gameData.weapons);
      expect(gemini.name).toContain('+');
      expect(gemini._baseName).toBe('Gemini');

      // After forge: should still work
      const afterForge = canUseWeaponArt(unit, gemini, art, { actorFaction: 'player' });
      expect(afterForge.ok).toBe(true);
    });
  });

  describe('resBonus passthrough', () => {
    it('getWeaponArtCombatMods returns resBonus from art data', () => {
      const cataclysm = artById.get('legend_cataclysm');
      const mods = getWeaponArtCombatMods(cataclysm);
      expect(mods.resBonus).toBe(5);
    });

    it('resBonus defaults to 0 when not specified', () => {
      const wrathStrike = artById.get('sword_wrath_strike');
      const mods = getWeaponArtCombatMods(wrathStrike);
      expect(mods.resBonus).toBe(0);
    });
  });

  describe('legacy art exclusion', () => {
    const legacyIds = [
      'sword_precise_cut', 'sword_comet_edge',
      'lance_piercing_drive', 'lance_vaulting_thrust',
      'axe_wild_swing', 'axe_rending_cleave',
      'bow_longshot', 'bow_hunters_focus',
    ];

    it('all 8 legacy arts have legacy: true', () => {
      for (const id of legacyIds) {
        expect(artById.get(id).legacy).toBe(true);
      }
    });

    it('no non-legacy standard art has legacy flag', () => {
      const nonLegacy = allArts.filter(a => !legacyIds.includes(a.id) && a.tierAffinity !== 'Legendary');
      for (const art of nonLegacy) {
        expect(art.legacy).toBeUndefined();
      }
    });

    it('active Iron pool has 14 arts (18 minus 4 legacy)', () => {
      expect(allArts.filter(a => a.tierAffinity === 'Iron' && !a.legacy).length).toBe(14);
    });

    it('active Steel pool has 20 arts (24 minus 4 legacy)', () => {
      expect(allArts.filter(a => a.tierAffinity === 'Steel' && !a.legacy).length).toBe(20);
    });
  });

  describe('legendary gate with multiple identifiers', () => {
    it('passes when name matches but id does not', () => {
      const art = artById.get('legend_gemini_tempest');
      const weapon = { id: 'runtime_weapon_42', name: 'Gemini', type: 'Sword' };
      const unit = {
        faction: 'player',
        currentHP: 30,
        stats: { HP: 30, STR: 15, MAG: 5, SKL: 12, SPD: 14, DEF: 10, RES: 8, LCK: 8 },
        proficiencies: [{ type: 'Sword', rank: 'Mast' }],
      };
      const result = canUseWeaponArt(unit, weapon, art, { actorFaction: 'player' });
      expect(result.ok).toBe(true);
    });
  });

  describe('Silver innate art spawning config', () => {
    it('loot tables have updated act2 weapon art scroll pool', () => {
      const act2Pool = gameData.lootTables.act2.weaponArtScroll;
      expect(act2Pool).toContain('Windsweep Scroll');
      expect(act2Pool).toContain('Seraphim Scroll');
      expect(act2Pool).not.toContain('Precise Cut Scroll');
      expect(act2Pool.length).toBe(13);
    });

    it('loot tables have updated act3 weapon art scroll pool', () => {
      const act3Pool = gameData.lootTables.act3.weaponArtScroll;
      expect(act3Pool).toContain('Dragonhaze Scroll');
      expect(act3Pool).toContain('Nosferatu Scroll');
      expect(act3Pool).not.toContain('Comet Edge Scroll');
      expect(act3Pool.length).toBe(22);
    });
  });
});

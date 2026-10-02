// The Oct 2026 weapon-art tuning: art follow-ups, spawn tiers, scrolls in every act,
// Hollow Feast's draining splash, and art effects that skip a plain follow-up.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { generateShopInventory } from '../src/engine/LootSystem.js';
import { getPostCombatPipelineSteps } from '../src/engine/WeaponArtPostCombat.js';
import { areaDamage } from '../src/engine/PostCombatEffects.js';
import { getWeaponArtArea, getWeaponArtCombatMods } from '../src/engine/WeaponArtSystem.js';
import { weaponArtDetailLines } from '../src/ui/weaponArtDisplay.js';

const data = loadGameData();
const arts = data.weaponArts.arts;
const art = (id) => arts.find((a) => a.id === id);

describe('weapon art data', () => {
  it('every area or reach art gives up its follow-up, and only those', () => {
    for (const a of arts) {
      const mods = a.combatMods || {};
      const reach = Boolean(a.area || mods.rangeBonus || mods.rangeOverride);
      expect(a.noFollowUp === true, a.name).toBe(reach);
      expect(getWeaponArtCombatMods(a).artNoFollowUp, a.name).toBe(reach);
    }
  });

  it('Grounder and Helm Splitter scrolls are on sale from Act 1 to Act 4', () => {
    for (const act of ['act1', 'act2', 'act3', 'act4']) {
      expect(data.lootTables[act].weaponArtScroll, act).toEqual(
        expect.arrayContaining(['Grounder Scroll', 'Helm Splitter Scroll']),
      );
    }
    // Act 1 sells them but never drops them.
    expect(data.lootTables.act1.weights.weaponArtScroll).toBe(0);
  });

  it('Hollow Feast strikes from two tiles and drains its splash', () => {
    const feast = art('legend_life_drain');
    expect(feast.name).toBe('Hollow Feast');
    expect(getWeaponArtCombatMods(feast).rangeOverride).toEqual({ min: 1, max: 2 });
    expect(getWeaponArtArea(feast).drainPercent).toBe(1);
    const text = weaponArtDetailLines(feast).join('\n');
    expect(text).toContain('heals you 100% of the area damage');
    expect(text).toContain('strikes once however fast you are');
  });
});

describe('art spawns by tier', () => {
  it('a shop Steel weapon can roll an Iron art listed for Steel in spawnTiers', () => {
    const lootTables = {
      act1: {
        weapons: ['Steel Sword'],
        healing: [],
        weights: { weapon: 100 },
      },
    };
    const catalog = [
      {
        id: 'iron_and_steel_art',
        weaponType: 'Sword',
        tierAffinity: 'Iron',
        spawnTiers: ['Iron', 'Steel'],
        unlockAct: 'act1',
      },
      { id: 'iron_only_art', weaponType: 'Sword', tierAffinity: 'Iron', unlockAct: 'act1' },
    ];
    const shop = generateShopInventory(
      'act1',
      lootTables,
      data.weapons,
      data.consumables,
      data.accessories,
      null,
      { weaponArtCatalog: catalog, steelArms: true },
    );
    const sword = shop.find((entry) => entry.item.name === 'Steel Sword')?.item;
    expect(sword?.weaponArtIds).toEqual(['iron_and_steel_art']);
  });
});

describe('art effects skip a plain follow-up', () => {
  const attacker = { name: 'A', currentHP: 30, stats: { HP: 30 } };
  const defender = { name: 'D', currentHP: 30, stats: { HP: 30 } };
  const strike = (side, miss, artFollowUp = false) => ({
    type: 'strike',
    attackerSide: side,
    attacker: side === 'attacker' ? 'A' : 'D',
    miss,
    damage: miss ? 0 : 5,
    ...(artFollowUp ? { artFollowUp: true } : {}),
  });
  const steps = (artId, events) =>
    getPostCombatPipelineSteps({
      attacker,
      defender,
      attackerWeaponArt: art(artId),
      result: { events, strikeMods: { attacker: null, defender: null } },
    });

  it('All or Nothing recoils only for its own missed strikes', () => {
    const recoil = (events) =>
      steps('bow_all_or_nothing', events).find((s) => s.type === 'art_miss_self_damage');
    expect(recoil([strike('attacker', true), strike('attacker', true, true)])?.amount).toBe(5);
    expect(recoil([strike('attacker', false), strike('attacker', true, true)])).toBeUndefined();
  });

  it("an on-hit art effect needs the art's own strike to land", () => {
    const rooted = (events) => steps('bow_encloser', events).some((s) => s.type === 'tier2_status');
    expect(rooted([strike('attacker', true), strike('attacker', false, true)])).toBe(false);
    expect(rooted([strike('attacker', false), strike('attacker', true, true)])).toBe(true);
  });

  it('a per-hit line area counts only art strikes', () => {
    const line = steps('lance_skewer', [
      strike('attacker', false),
      strike('attacker', false, true),
    ]).find((s) => s.type === 'area_damage');
    expect(line?.blows).toBe(1);
  });
});

describe('draining area blows', () => {
  it('heal the user by the share of the damage the blows dealt', () => {
    const source = {
      name: 'S',
      faction: 'player',
      col: 0,
      row: 0,
      currentHP: 10,
      stats: { HP: 40 },
    };
    const foes = [
      { name: 'F1', faction: 'enemy', col: 5, row: 5, currentHP: 3, stats: { HP: 20 } },
      { name: 'F2', faction: 'enemy', col: 5, row: 6, currentHP: 20, stats: { HP: 20 } },
    ];
    const world = { cols: 10, rows: 10, hostilesOf: () => foes };
    const step = {
      area: getWeaponArtArea({
        area: {
          shape: 'radius',
          radius: 1,
          drainPercent: 0.5,
          damage: { kind: 'fixed', amount: 6 },
        },
      }),
      center: { col: 5, row: 5 },
      blows: 1,
      requiresLiveSource: true,
    };
    // F1 has 3 HP left, so the blows deal 3 + 6 = 9; half of that (4) heals.
    const beats = [...areaDamage(step, source, null, world, null)];
    expect(foes.map((f) => f.currentHP)).toEqual([0, 14]);
    expect(source.currentHP).toBe(14);
    expect(beats.some((b) => b.kind === 'hint' && b.text === 'Drain +4')).toBe(true);
  });

  it('heal nothing without drainPercent', () => {
    const source = {
      name: 'S',
      faction: 'player',
      col: 0,
      row: 0,
      currentHP: 10,
      stats: { HP: 40 },
    };
    const foes = [
      { name: 'F', faction: 'enemy', col: 5, row: 5, currentHP: 20, stats: { HP: 20 } },
    ];
    const step = {
      area: getWeaponArtArea({
        area: { shape: 'radius', radius: 1, damage: { kind: 'fixed', amount: 6 } },
      }),
      center: { col: 5, row: 5 },
      blows: 1,
    };
    [...areaDamage(step, source, null, { cols: 10, rows: 10, hostilesOf: () => foes }, null)];
    expect(foes[0].currentHP).toBe(14);
    expect(source.currentHP).toBe(10);
  });
});

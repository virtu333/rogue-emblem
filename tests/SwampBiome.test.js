import { describe, it, expect, beforeEach } from 'vitest';
import { generateBattle, pickTemplate, rollBiome } from '../src/engine/MapGenerator.js';
import { computeAcidDamage, isAcidTerrainIndex } from '../src/engine/TerrainHazards.js';
import { calculatePar } from '../src/engine/TurnBonusCalculator.js';
import { ACT_BIOME_WEIGHTS, TERRAIN } from '../src/utils/constants.js';
import { loadGameData } from './testData.js';

let data;
beforeEach(async () => {
  data = data || loadGameData();
});

describe('Swamp Biome', () => {
  it('terrain.json includes Swamp and Bog with expected move costs and bonuses', () => {
    const swamp = data.terrain.find((t) => t.name === 'Swamp');
    const bog = data.terrain.find((t) => t.name === 'Bog');

    expect(swamp).toBeTruthy();
    expect(swamp.moveCost.Infantry).toBe('3');
    expect(swamp.moveCost.Armored).toBe('--');
    expect(swamp.moveCost.Cavalry).toBe('--');
    expect(swamp.moveCost.Flying).toBe('1');
    expect(swamp.avoidBonus).toBe('-10');

    expect(bog).toBeTruthy();
    expect(bog.moveCost.Infantry).toBe('2');
    expect(bog.moveCost.Armored).toBe('3');
    expect(bog.moveCost.Cavalry).toBe('3');
    expect(bog.moveCost.Flying).toBe('1');
    expect(bog.avoidBonus).toBe('-5');
  });

  it('terrain.json includes Acidic Swamp and Acidic Bog matching parent movement profiles', () => {
    const acidicSwamp = data.terrain.find((t) => t.name === 'Acidic Swamp');
    const acidicBog = data.terrain.find((t) => t.name === 'Acidic Bog');

    expect(acidicSwamp).toBeTruthy();
    expect(acidicSwamp.moveCost).toEqual(data.terrain[TERRAIN.Swamp].moveCost);
    expect(acidicSwamp.avoidBonus).toBe('-10');
    expect(acidicSwamp.special).toContain('Acid (2T)');

    expect(acidicBog).toBeTruthy();
    expect(acidicBog.moveCost).toEqual(data.terrain[TERRAIN.Bog].moveCost);
    expect(acidicBog.avoidBonus).toBe('-5');
    expect(acidicBog.special).toContain('Acid (2T)');
  });

  it('TERRAIN enum aligns with terrain.json indices for Swamp/Bog', () => {
    expect(TERRAIN.Swamp).toBe(15);
    expect(TERRAIN.Bog).toBe(16);
    expect(TERRAIN.AcidicSwamp).toBe(17);
    expect(TERRAIN.AcidicBog).toBe(18);
    expect(data.terrain[TERRAIN.Swamp].name).toBe('Swamp');
    expect(data.terrain[TERRAIN.Bog].name).toBe('Bog');
    expect(data.terrain[TERRAIN.AcidicSwamp].name).toBe('Acidic Swamp');
    expect(data.terrain[TERRAIN.AcidicBog].name).toBe('Acidic Bog');
  });

  it('Swamp blocks Armored and Cavalry movement', () => {
    const swamp = data.terrain.find((t) => t.name === 'Swamp');
    expect(swamp.moveCost.Armored).toBe('--');
    expect(swamp.moveCost.Cavalry).toBe('--');
  });

  it('negative avoid bonuses parse as negative integers', () => {
    const swamp = data.terrain.find((t) => t.name === 'Swamp');
    const bog = data.terrain.find((t) => t.name === 'Bog');
    expect(parseInt(swamp.avoidBonus, 10)).toBe(-10);
    expect(parseInt(bog.avoidBonus, 10)).toBe(-5);
  });

  it('ACT_BIOME_WEIGHTS include swamp for acts 2-4 and exclude act1', () => {
    expect(ACT_BIOME_WEIGHTS.act2.swamp).toBeGreaterThan(0);
    expect(ACT_BIOME_WEIGHTS.act3.swamp).toBeGreaterThan(0);
    expect(ACT_BIOME_WEIGHTS.act4.swamp).toBeGreaterThan(0);
    expect(ACT_BIOME_WEIGHTS.act1.swamp).toBeUndefined();
  });

  it('rollBiome can produce swamp for act2', () => {
    const seen = new Set();
    for (let i = 0; i < 400; i++) {
      seen.add(rollBiome('act2'));
      if (seen.has('swamp')) break;
    }
    expect(seen.has('swamp')).toBe(true);
  });

  it('mire_crossing template exists with swamp biome and reinforcement contract', () => {
    const t = data.mapTemplates.rout.find((entry) => entry.id === 'mire_crossing');
    expect(t).toBeTruthy();
    expect(t.biome).toBe('swamp');
    expect(t.acts).toEqual(expect.arrayContaining(['act2', 'act3', 'act4']));
    expect(t.parBonus).toBe(2);
    expect(t.reinforcementContractVersion).toBe(1);
    expect(t.reinforcements).toBeTruthy();
    expect(Array.isArray(t.reinforcements.spawnEdges)).toBe(true);
    expect(Array.isArray(t.reinforcements.waves)).toBe(true);
    expect(typeof t.reinforcements.difficultyScaling).toBe('boolean');
    expect(t.reinforcements.turnOffsetByDifficulty).toBeTruthy();
    expect(Array.isArray(t.reinforcements.xpDecay)).toBe(true);
  });

  it('pickTemplate selects a swamp template for swamp rout in acts 2-4', () => {
    for (const act of ['act2', 'act3', 'act4']) {
      for (let i = 0; i < 20; i++) {
        const picked = pickTemplate('rout', data.mapTemplates, act, { biome: 'swamp' });
        expect(picked).toBeTruthy();
        // Future-proof for additional swamp templates.
        expect(picked.biome).toBe('swamp');
      }
    }
  });

  it('generateBattle supports mire_crossing and propagates parBonus', () => {
    let sawSwamp = false;
    let sawBog = false;

    for (let i = 0; i < 15; i++) {
      const battle = generateBattle(
        { act: 'act2', objective: 'rout', templateId: 'mire_crossing', deployCount: 4, row: 1 },
        data,
      );
      expect(battle.templateId).toBe('mire_crossing');
      expect(battle.biome).toBe('swamp');
      expect(battle.parBonus).toBe(2);

      const flat = battle.mapLayout.flat();
      if (flat.includes(TERRAIN.Swamp)) sawSwamp = true;
      if (flat.includes(TERRAIN.Bog)) sawBog = true;
    }

    expect(sawSwamp).toBe(true);
    expect(sawBog).toBe(true);
  });

  it('calculatePar applies template parBonus as an exact +2 across difficulties', () => {
    const mapLayout = Array.from({ length: 8 }, () => Array(12).fill(TERRAIN.Plain));
    const baseParams = {
      cols: 12,
      rows: 8,
      enemyCount: 7,
      objective: 'rout',
      mapLayout,
      terrainData: data.terrain,
    };

    for (const difficultyId of ['normal', 'hard', 'lunatic']) {
      const basePar = calculatePar(baseParams, data.turnBonus, difficultyId);
      const boostedPar = calculatePar({ ...baseParams, parBonus: 2 }, data.turnBonus, difficultyId);
      expect(boostedPar).toBe(basePar + 2);
    }
  });

  it('turnBonus difficultTerrainTypes includes Swamp and Bog', () => {
    const difficultSet = new Set(data.turnBonus.difficultTerrainTypes);
    expect(difficultSet.has('Swamp')).toBe(true);
    expect(difficultSet.has('Bog')).toBe(true);
    expect(difficultSet.has('Acidic Swamp')).toBe(true);
    expect(difficultSet.has('Acidic Bog')).toBe(true);
  });

  it('acid helper functions classify terrain indices and apply capped 5% damage', () => {
    expect(isAcidTerrainIndex(TERRAIN.AcidicSwamp)).toBe(true);
    expect(isAcidTerrainIndex(TERRAIN.AcidicBog)).toBe(true);
    expect(isAcidTerrainIndex(TERRAIN.Swamp)).toBe(false);
    expect(isAcidTerrainIndex(TERRAIN.LavaCrack)).toBe(false);

    expect(computeAcidDamage(20)).toBe(1);
    expect(computeAcidDamage(40)).toBe(2);
    expect(computeAcidDamage(100)).toBe(5);
    expect(computeAcidDamage(200)).toBe(10);
    expect(computeAcidDamage(1)).toBe(1);
  });
});

import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { validateContentContract } from '../../src/data/validators/contentContractValidator.js';

const tempRoots = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2));
}

function makeTempValidatorWorkspace() {
  const root = mkdtempSync(join(tmpdir(), 'emblem-content-contract-'));
  tempRoots.push(root);

  const testsDir = join(root, 'tests', 'fixtures');
  const dataDir = join(root, 'data');
  mkdirSync(testsDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });

  const contractPath = join(testsDir, 'pr1_content_contract.json');
  const accessoriesPath = join(dataDir, 'accessories.json');
  const consumablesPath = join(dataDir, 'consumables.json');
  const lootTablesPath = join(dataDir, 'lootTables.json');

  return {
    contractPath,
    accessoriesPath,
    consumablesPath,
    lootTablesPath,
  };
}

afterEach(() => {
  while (tempRoots.length > 0) {
    rmSync(tempRoots.pop(), { recursive: true, force: true });
  }
});

describe('PR1 content contract', () => {
  it('matches canonical accessories, swiftsoles, and loot distribution', () => {
    const result = validateContentContract();
    const accessories = readJson('data/accessories.json');
    const consumables = readJson('data/consumables.json');
    expect(result.ok, result.issues.join('\n')).toBe(true);
    expect(result.summary.accessories).toBe(accessories.length);
    expect(result.summary.consumables).toBe(consumables.length);
  });

  it('fails on duplicate accessory names in source data', () => {
    const workspace = makeTempValidatorWorkspace();
    const contract = readJson('tests/fixtures/pr1_content_contract.json');
    const accessories = readJson('data/accessories.json');
    const consumables = readJson('data/consumables.json');
    const lootTables = readJson('data/lootTables.json');

    const bloodGem = accessories.find((entry) => entry.name === 'Blood Gem');
    expect(bloodGem).toBeTruthy();
    accessories.unshift({ ...bloodGem, combatEffects: { weaponArtCostReduction: 1 } });

    writeJson(workspace.contractPath, contract);
    writeJson(workspace.accessoriesPath, accessories);
    writeJson(workspace.consumablesPath, consumables);
    writeJson(workspace.lootTablesPath, lootTables);

    const result = validateContentContract(workspace);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.includes('duplicate accessory name "Blood Gem"'))).toBe(true);
  });

  it('fails on duplicate consumable names in source data', () => {
    const workspace = makeTempValidatorWorkspace();
    const contract = readJson('tests/fixtures/pr1_content_contract.json');
    const accessories = readJson('data/accessories.json');
    const consumables = readJson('data/consumables.json');
    const lootTables = readJson('data/lootTables.json');

    const swiftsoles = consumables.find((entry) => entry.name === 'Swiftsoles');
    expect(swiftsoles).toBeTruthy();
    consumables.push({ ...swiftsoles });

    writeJson(workspace.contractPath, contract);
    writeJson(workspace.accessoriesPath, accessories);
    writeJson(workspace.consumablesPath, consumables);
    writeJson(workspace.lootTablesPath, lootTables);

    const result = validateContentContract(workspace);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.includes('duplicate consumable name "Swiftsoles"'))).toBe(true);
  });

  it('enforces PR1 accessory exclusivity across all acts in lootTables', () => {
    const workspace = makeTempValidatorWorkspace();
    const contract = readJson('tests/fixtures/pr1_content_contract.json');
    const accessories = readJson('data/accessories.json');
    const consumables = readJson('data/consumables.json');
    const lootTables = readJson('data/lootTables.json');

    lootTables.act4 = {
      accessories: ['Blood Gem'],
      healing: [],
      statBooster: [],
      promotion: [],
    };

    writeJson(workspace.contractPath, contract);
    writeJson(workspace.accessoriesPath, accessories);
    writeJson(workspace.consumablesPath, consumables);
    writeJson(workspace.lootTablesPath, lootTables);

    const result = validateContentContract(workspace);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.includes('act4.accessories should not include "Blood Gem"'))).toBe(true);
  });

  it('fails when loot tables reference unknown item names', () => {
    const workspace = makeTempValidatorWorkspace();
    const contract = readJson('tests/fixtures/pr1_content_contract.json');
    const accessories = readJson('data/accessories.json');
    const consumables = readJson('data/consumables.json');
    const lootTables = readJson('data/lootTables.json');

    lootTables.act1.accessories.push('Unknown Accessory');
    lootTables.act1.healing.push('Unknown Consumable');

    writeJson(workspace.contractPath, contract);
    writeJson(workspace.accessoriesPath, accessories);
    writeJson(workspace.consumablesPath, consumables);
    writeJson(workspace.lootTablesPath, lootTables);

    const result = validateContentContract(workspace);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.includes('act1.accessories references unknown accessory "Unknown Accessory"'))).toBe(true);
    expect(result.issues.some((issue) => issue.includes('act1.healing references unknown consumable "Unknown Consumable"'))).toBe(true);
  });

  it('fails when source totals drift from expected totals', () => {
    const workspace = makeTempValidatorWorkspace();
    const contract = readJson('tests/fixtures/pr1_content_contract.json');
    const accessories = readJson('data/accessories.json');
    const consumables = readJson('data/consumables.json');
    const lootTables = readJson('data/lootTables.json');

    const extraAccessory = structuredClone(accessories[0]);
    extraAccessory.name = `${extraAccessory.name} (count drift)`;
    accessories.push(extraAccessory);

    const extraConsumable = structuredClone(consumables[0]);
    extraConsumable.name = `${extraConsumable.name} (count drift)`;
    consumables.push(extraConsumable);

    writeJson(workspace.contractPath, contract);
    writeJson(workspace.accessoriesPath, accessories);
    writeJson(workspace.consumablesPath, consumables);
    writeJson(workspace.lootTablesPath, lootTables);

    const result = validateContentContract(workspace);
    expect(result.ok).toBe(false);
    expect(result.issues.some((issue) => issue.includes('data/accessories.json total count expected'))).toBe(true);
    expect(result.issues.some((issue) => issue.includes('data/consumables.json total count expected'))).toBe(true);
  });
});

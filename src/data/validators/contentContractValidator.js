import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import {
  formatAccessoryCombatEffect,
  formatAccessoryDetail,
  HANDLED_ACCESSORY_COMBAT_EFFECT_KEYS,
  HANDLED_ACCESSORY_TURN_START_EFFECT_KEYS,
} from '../../utils/accessoryText.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_REPO_ROOT = join(__dirname, '..', '..', '..');

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function normalizeJson(value) {
  if (Array.isArray(value)) {
    return value.map((entry) => normalizeJson(entry));
  }
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = normalizeJson(value[key]);
    }
    return out;
  }
  return value;
}

function stableStringify(value) {
  if (typeof value === 'undefined') return 'undefined';
  return JSON.stringify(normalizeJson(value));
}

function isDeepEqual(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function compareField(issues, path, expectedValue, actualValue) {
  if (isDeepEqual(expectedValue, actualValue)) return;
  issues.push(`${path}: expected ${stableStringify(expectedValue)}, found ${stableStringify(actualValue)}`);
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseFiniteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function hasGameplayEffects(accessory) {
  if (!accessory || typeof accessory !== 'object') return false;
  if (Object.keys(accessory.effects || {}).length > 0) return true;
  if (Object.keys(accessory.combatEffects || {}).length > 0) return true;
  if (Object.keys(accessory.turnStartEffects || {}).length > 0) return true;
  return false;
}

function buildUniqueByNameMap(entries, issues, pathLabel, itemLabel) {
  const byName = new Map();
  const firstIndexByName = new Map();

  ensureArray(entries).forEach((entry, index) => {
    const name = typeof entry?.name === 'string' ? entry.name : '';
    if (!name) {
      issues.push(`${pathLabel}[${index}] missing required name`);
      return;
    }
    if (byName.has(name)) {
      const firstIndex = firstIndexByName.get(name);
      issues.push(`${pathLabel}: duplicate ${itemLabel} name "${name}" at indices ${firstIndex} and ${index}`);
      return;
    }
    byName.set(name, entry);
    firstIndexByName.set(name, index);
  });

  return byName;
}

function validateExpectedNameUniqueness(expectedEntries, issues, pathLabel, itemLabel) {
  const seen = new Set();
  for (const expected of ensureArray(expectedEntries)) {
    const name = expected?.name;
    if (!name) continue;
    if (seen.has(name)) {
      issues.push(`${pathLabel}: duplicate ${itemLabel} name "${name}"`);
      continue;
    }
    seen.add(name);
  }
}

function validateAccessories(contract, accessories, issues) {
  const contractAccessories = ensureArray(contract.accessories);
  validateExpectedNameUniqueness(contractAccessories, issues, 'tests/fixtures/pr1_content_contract.json:accessories', 'accessory');
  const byName = buildUniqueByNameMap(accessories, issues, 'data/accessories.json', 'accessory');

  for (const expected of contractAccessories) {
    const name = expected?.name;
    if (!name) {
      issues.push('tests/fixtures/pr1_content_contract.json: accessory entry missing name');
      continue;
    }
    const actual = byName.get(name);
    if (!actual) {
      issues.push(`data/accessories.json: missing required accessory "${name}"`);
      continue;
    }
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (field === 'name') continue;
      compareField(issues, `data/accessories.json:${name}.${field}`, expectedValue, actual[field]);
    }
  }
}

function validateConsumables(contract, consumables, issues) {
  const contractConsumables = ensureArray(contract.consumables);
  validateExpectedNameUniqueness(contractConsumables, issues, 'tests/fixtures/pr1_content_contract.json:consumables', 'consumable');
  const byName = buildUniqueByNameMap(consumables, issues, 'data/consumables.json', 'consumable');

  for (const expected of contractConsumables) {
    const name = expected?.name;
    if (!name) {
      issues.push('tests/fixtures/pr1_content_contract.json: consumable entry missing name');
      continue;
    }
    const actual = byName.get(name);
    if (!actual) {
      issues.push(`data/consumables.json: missing required consumable "${name}"`);
      continue;
    }
    for (const [field, expectedValue] of Object.entries(expected)) {
      if (field === 'name') continue;
      compareField(issues, `data/consumables.json:${name}.${field}`, expectedValue, actual[field]);
    }
  }
}

function validateLootDistribution(contract, lootTables, issues) {
  const distribution = contract.lootDistribution || {};
  const accessoriesByAct = distribution.accessoriesByAct || {};
  const expectedActByAccessory = new Map();

  for (const [actId, expectedAccessories] of Object.entries(accessoriesByAct)) {
    const actualPool = lootTables?.[actId]?.accessories;
    if (!Array.isArray(actualPool)) {
      issues.push(`data/lootTables.json:${actId}.accessories must be an array`);
      continue;
    }
    for (const accessoryName of ensureArray(expectedAccessories)) {
      if (!actualPool.includes(accessoryName)) {
        issues.push(`data/lootTables.json:${actId}.accessories missing "${accessoryName}"`);
      }
      if (expectedActByAccessory.has(accessoryName)) {
        issues.push(`tests/fixtures/pr1_content_contract.json: accessory "${accessoryName}" assigned to multiple acts`);
      } else {
        expectedActByAccessory.set(accessoryName, actId);
      }
    }
  }

  const allActs = Object.keys(lootTables || {});
  for (const [accessoryName, expectedAct] of expectedActByAccessory.entries()) {
    for (const actId of allActs) {
      if (actId === expectedAct) continue;
      const actualPool = lootTables?.[actId]?.accessories;
      if (!Array.isArray(actualPool)) continue;
      if (actualPool.includes(accessoryName)) {
        issues.push(`data/lootTables.json:${actId}.accessories should not include "${accessoryName}" (expected only in ${expectedAct})`);
      }
    }
  }

  const swiftsolesActs = ensureArray(distribution.swiftsolesStatBoosterActs);
  for (const actId of swiftsolesActs) {
    const pool = lootTables?.[actId]?.statBooster;
    if (!Array.isArray(pool)) {
      issues.push(`data/lootTables.json:${actId}.statBooster must be an array`);
      continue;
    }
    if (!pool.includes('Swiftsoles')) {
      issues.push(`data/lootTables.json:${actId}.statBooster missing "Swiftsoles"`);
    }
  }

  const swiftsolesExcludedActs = ensureArray(distribution.swiftsolesExcludedStatBoosterActs);
  for (const actId of swiftsolesExcludedActs) {
    const pool = lootTables?.[actId]?.statBooster;
    if (!Array.isArray(pool)) continue;
    if (pool.includes('Swiftsoles')) {
      issues.push(`data/lootTables.json:${actId}.statBooster should not include "Swiftsoles"`);
    }
  }
}

function validateLootReferenceIntegrity(accessories, consumables, lootTables, issues) {
  const accessoryNames = new Set(
    ensureArray(accessories)
      .map((accessory) => accessory?.name)
      .filter(Boolean),
  );
  const consumableNames = new Set(
    ensureArray(consumables)
      .map((consumable) => consumable?.name)
      .filter(Boolean),
  );

  for (const [actId, table] of Object.entries(lootTables || {})) {
    const accessoryPool = Array.isArray(table?.accessories) ? table.accessories : [];
    for (const accessoryName of accessoryPool) {
      if (!accessoryNames.has(accessoryName)) {
        issues.push(`data/lootTables.json:${actId}.accessories references unknown accessory "${accessoryName}"`);
      }
    }
  }

  const consumablePools = ['healing', 'statBooster', 'promotion'];
  for (const [actId, table] of Object.entries(lootTables || {})) {
    for (const poolKey of consumablePools) {
      const pool = Array.isArray(table?.[poolKey]) ? table[poolKey] : [];
      for (const itemName of pool) {
        if (!consumableNames.has(itemName)) {
          issues.push(`data/lootTables.json:${actId}.${poolKey} references unknown consumable "${itemName}"`);
        }
      }
    }
  }
}

function validateAccessoryTextCoverage(accessories, issues) {
  const unknownCombatKeys = new Set();
  const unknownTurnStartKeys = new Set();

  for (const accessory of ensureArray(accessories)) {
    for (const key of Object.keys(accessory?.combatEffects || {})) {
      if (!HANDLED_ACCESSORY_COMBAT_EFFECT_KEYS.includes(key)) {
        unknownCombatKeys.add(key);
      }
    }
    for (const key of Object.keys(accessory?.turnStartEffects || {})) {
      if (!HANDLED_ACCESSORY_TURN_START_EFFECT_KEYS.includes(key)) {
        unknownTurnStartKeys.add(key);
      }
    }
  }

  if (unknownCombatKeys.size > 0) {
    issues.push(`accessoryText: unknown combat effect keys: ${Array.from(unknownCombatKeys).sort().join(', ')}`);
  }
  if (unknownTurnStartKeys.size > 0) {
    issues.push(`accessoryText: unknown turn-start effect keys: ${Array.from(unknownTurnStartKeys).sort().join(', ')}`);
  }

  for (const accessory of ensureArray(accessories)) {
    if (!hasGameplayEffects(accessory)) continue;
    const detail = formatAccessoryDetail(accessory);
    const name = accessory?.name || '<unnamed>';
    if (!detail) {
      issues.push(`accessoryText:${name} should render non-empty detail text`);
      continue;
    }
    if (detail.includes('Combat effect')) {
      issues.push(`accessoryText:${name} fell back to generic combat placeholder text`);
    }

    const combatText = formatAccessoryCombatEffect(accessory);
    const combatEffects = accessory?.combatEffects || {};
    const hasTimedBuff = combatEffects.weaponArtDefBuff || combatEffects.recoilGuard;
    const buffDEF = parseFiniteNumber(combatEffects.buffDEF);
    const buffRES = parseFiniteNumber(combatEffects.buffRES);
    if (hasTimedBuff && (buffDEF !== null || buffRES !== null)) {
      const missing = [];
      if (buffDEF !== null && !combatText.includes(String(buffDEF))) missing.push(`buffDEF=${buffDEF}`);
      if (buffRES !== null && !combatText.includes(String(buffRES))) missing.push(`buffRES=${buffRES}`);
      if (missing.length > 0) {
        issues.push(`accessoryText:${name} missing timed-buff values in combat text (${missing.join(', ')})`);
      }
    }
  }
}

export function validateContentContract(options = {}) {
  const repoRoot = options.repoRoot || DEFAULT_REPO_ROOT;
  const contractPath = options.contractPath || join(repoRoot, 'tests', 'fixtures', 'pr1_content_contract.json');
  const accessoriesPath = options.accessoriesPath || join(repoRoot, 'data', 'accessories.json');
  const consumablesPath = options.consumablesPath || join(repoRoot, 'data', 'consumables.json');
  const lootTablesPath = options.lootTablesPath || join(repoRoot, 'data', 'lootTables.json');

  const issues = [];
  const summary = { accessories: 0, consumables: 0, acts: 0 };

  try {
    const contract = readJson(contractPath);
    const accessories = readJson(accessoriesPath);
    const consumables = readJson(consumablesPath);
    const lootTables = readJson(lootTablesPath);

    summary.accessories = ensureArray(contract.accessories).length;
    summary.consumables = ensureArray(contract.consumables).length;
    summary.acts = Object.keys(contract.lootDistribution?.accessoriesByAct || {}).length;

    validateAccessories(contract, accessories, issues);
    validateConsumables(contract, consumables, issues);
    validateLootDistribution(contract, lootTables, issues);
    validateLootReferenceIntegrity(accessories, consumables, lootTables, issues);
    validateAccessoryTextCoverage(accessories, issues);
  } catch (error) {
    issues.push(`validator runtime error: ${error.message}`);
  }

  return {
    ok: issues.length === 0,
    issues,
    summary,
  };
}

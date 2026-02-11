// Shared test data loader — reads JSON from data/ directory
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');

function loadJSON(filename) {
  return JSON.parse(readFileSync(join(dataDir, filename), 'utf-8'));
}

export function loadGameData() {
  return {
    terrain: loadJSON('terrain.json'),
    lords: loadJSON('lords.json'),
    classes: loadJSON('classes.json'),
    weapons: loadJSON('weapons.json'),
    skills: loadJSON('skills.json'),
    mapSizes: loadJSON('mapSizes.json'),
    mapTemplates: loadJSON('mapTemplates.json'),
    enemies: loadJSON('enemies.json'),
    consumables: loadJSON('consumables.json'),
    lootTables: loadJSON('lootTables.json'),
    recruits: loadJSON('recruits.json'),
    metaUpgrades: loadJSON('metaUpgrades.json'),
    accessories: loadJSON('accessories.json'),
    whetstones: loadJSON('whetstones.json'),
    turnBonus: loadJSON('turnBonus.json'),
    blessings: loadJSON('blessings.json'),
    difficulty: loadJSON('difficulty.json'),
  };
}

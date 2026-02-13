// Pure helpers for tutorial battle setup (no Phaser deps)

import { TERRAIN } from '../utils/constants.js';
import { createLordUnit, addToInventory, addToConsumables, equipWeapon } from './UnitManager.js';

export function buildTutorialBattleConfig() {
  const P = TERRAIN.Plain, F = TERRAIN.Forest, O = TERRAIN.Fort;
  return {
    cols: 8, rows: 6, objective: 'rout',
    mapLayout: [
      [P, P, P, F, P, P, P, P],
      [P, P, F, P, P, P, P, P],
      [P, P, P, P, P, P, P, P],
      [P, P, P, O, P, P, F, P],
      [P, P, P, P, P, P, P, F],
      [P, P, P, P, F, P, P, P],
    ],
    playerSpawns: [
      { col: 1, row: 2 },
      { col: 1, row: 4 },
    ],
    enemySpawns: [
      { className: 'Fighter', level: 1, col: 5, row: 2 },
      { className: 'Archer',  level: 1, col: 6, row: 4 },
    ],
    npcSpawn: null,
    thronePos: null,
  };
}

export function buildTutorialRoster(gameData) {
  const { lords, classes, weapons, consumables } = gameData;

  // Edric -- Lord, level 3, Iron Sword (from createLordUnit) + Vulnerary
  const edricDef = lords.find(l => l.name === 'Edric');
  const edricClass = classes.find(c => c.name === edricDef.class);
  const edric = createLordUnit(edricDef, edricClass, weapons);
  edric.level = 3;
  edric.stats.HP += 2; edric.currentHP += 2;
  edric.stats.STR += 1; edric.stats.SPD += 1;
  const vuln = consumables.find(c => c.name === 'Vulnerary');
  if (vuln) addToConsumables(edric, vuln);

  // Sera -- Light Sage refit as healer: Heal staff + Vulnerary
  const seraDef = lords.find(l => l.name === 'Sera');
  const seraClass = classes.find(c => c.name === seraDef.class);
  const sera = createLordUnit(seraDef, seraClass, weapons);
  sera.level = 3;
  sera.stats.HP += 2; sera.currentHP += 2;
  sera.stats.MAG += 1; sera.stats.SPD += 1;
  if (!sera.proficiencies.some(p => p.type === 'Staff')) {
    sera.proficiencies.push({ type: 'Staff', rank: 'Prof' });
  }
  sera.weapon = null;
  sera.inventory = [];
  const heal = weapons.find(w => w.name === 'Heal');
  if (heal) {
    addToInventory(sera, heal);
    equipWeapon(sera, sera.inventory[0]);
  }
  const vuln2 = consumables.find(c => c.name === 'Vulnerary');
  if (vuln2) addToConsumables(sera, vuln2);

  return [edric, sera];
}

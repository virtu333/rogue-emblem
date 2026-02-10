// Fixture loader — reads JSON fixtures and provides buildRoster helper.

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import {
  createLordUnit,
  createRecruitUnit,
  addToInventory,
  addToConsumables,
  gainExperience,
} from '../../../src/engine/UnitManager.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Build a roster from fixture roster spec + gameData.
 * Returns array of units, or null if roster spec is null (use fallback lords).
 */
function buildRoster(rosterSpec, gameData) {
  if (!rosterSpec) return null;

  const units = [];
  for (const entry of rosterSpec) {
    let unit;
    if (entry.type === 'lord') {
      const lordData = gameData.lords.find(l => l.name === entry.name);
      const classData = gameData.classes.find(c => c.name === lordData.class);
      unit = createLordUnit(lordData, classData, gameData.weapons);

      // Level up to target
      for (let i = 1; i < entry.level; i++) {
        gainExperience(unit, 100);
      }

      // Add extra weapons
      if (entry.extraWeapons) {
        for (const wName of entry.extraWeapons) {
          const w = gameData.weapons.find(wp => wp.name === wName);
          if (w) addToInventory(unit, w);
        }
      }

      // Add staff proficiency + Heal staff
      if (entry.staff) {
        const hasStaffProf = unit.proficiencies.some(p => p.type === 'Staff');
        if (!hasStaffProf) {
          unit.proficiencies.push({ type: 'Staff', rank: 'Prof' });
        }
        const heal = gameData.weapons.find(w => w.name === 'Heal');
        if (heal) addToInventory(unit, heal);
      }
    } else {
      // recruit
      const classData = gameData.classes.find(c => c.name === entry.className);
      unit = createRecruitUnit(
        { name: entry.name, level: entry.level },
        classData,
        gameData.weapons
      );

      // Add staff proficiency + Heal for staff-flagged recruits
      if (entry.staff) {
        const hasStaffProf = unit.proficiencies.some(p => p.type === 'Staff');
        if (!hasStaffProf) {
          unit.proficiencies.push({ type: 'Staff', rank: 'Prof' });
        }
        const heal = gameData.weapons.find(w => w.name === 'Heal');
        if (heal) addToInventory(unit, heal);
      }
    }

    // Give everyone a Vulnerary
    const vuln = gameData.consumables.find(c => c.name === 'Vulnerary');
    if (vuln) addToConsumables(unit, vuln);

    // Ensure player faction
    unit.faction = 'player';

    units.push(unit);
  }
  return units;
}

export function loadFixture(name) {
  const raw = JSON.parse(readFileSync(join(__dirname, `${name}.json`), 'utf-8'));
  return {
    ...raw,
    buildRoster: (gameData) => buildRoster(raw.roster, gameData),
  };
}

export const FIXTURES = ['act1_rout_basic', 'act2_seize_basic', 'healer_heavy'];

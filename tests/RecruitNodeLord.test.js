import { describe, it, expect } from 'vitest';
import { getAvailableLords, createBossLordUnit } from '../src/engine/BossRecruitSystem.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

// Compute expected recruitable lord names from data (excluding starting lords Edric/Sera)
const STARTING_LORDS = new Set(['Edric', 'Sera']);
const RECRUITABLE_LORD_NAMES = gameData.lords
  .map((l) => l.name)
  .filter((n) => !STARTING_LORDS.has(n))
  .sort();

describe('Recruit Node Lord Availability', () => {
  it('returns all recruitable lords when none are in roster', () => {
    const roster = [{ name: 'Edric' }, { name: 'Sera' }];
    const avail = getAvailableLords(roster, gameData.lords);
    expect(avail.map((l) => l.name).sort()).toEqual(RECRUITABLE_LORD_NAMES);
  });

  it('excludes already-recruited lord', () => {
    const roster = [{ name: 'Edric' }, { name: 'Sera' }, { name: 'Kira' }];
    const avail = getAvailableLords(roster, gameData.lords);
    expect(avail).toHaveLength(RECRUITABLE_LORD_NAMES.length - 1);
    expect(avail.map((l) => l.name)).not.toContain('Kira');
  });

  it('returns empty when all recruitable lords recruited', () => {
    const roster = [
      { name: 'Edric' },
      { name: 'Sera' },
      ...RECRUITABLE_LORD_NAMES.map((n) => ({ name: n })),
    ];
    expect(getAvailableLords(roster, gameData.lords)).toHaveLength(0);
  });

  it('excludes lord in fallenUnits (dead lord not re-offered)', () => {
    const roster = [{ name: 'Edric' }, { name: 'Sera' }];
    const fallen = [{ name: 'Kira' }];
    const avail = getAvailableLords(roster, gameData.lords, fallen);
    expect(avail).toHaveLength(RECRUITABLE_LORD_NAMES.length - 1);
    expect(avail.map((l) => l.name)).not.toContain('Kira');
  });

  it('returns empty when all recruitable lords recruited or fallen', () => {
    // Put half in roster, half in fallen
    const half = Math.ceil(RECRUITABLE_LORD_NAMES.length / 2);
    const roster = [
      { name: 'Edric' },
      { name: 'Sera' },
      ...RECRUITABLE_LORD_NAMES.slice(0, half).map((n) => ({ name: n })),
    ];
    const fallen = RECRUITABLE_LORD_NAMES.slice(half).map((n) => ({ name: n }));
    expect(getAvailableLords(roster, gameData.lords, fallen)).toHaveLength(0);
  });

  it('backwards-compatible when fallenUnits not passed', () => {
    const roster = [{ name: 'Edric' }, { name: 'Sera' }];
    const avail = getAvailableLords(roster, gameData.lords);
    expect(avail).toHaveLength(RECRUITABLE_LORD_NAMES.length);
  });

  it('createBossLordUnit creates a valid lord with isLord flag', () => {
    const lordDef = gameData.lords.find((l) => l.name === 'Kira');
    const classData = gameData.classes.find((c) => c.name === lordDef.class);
    const unit = createBossLordUnit(lordDef, classData, gameData.weapons, 5, null);
    expect(unit.isLord).toBe(true);
    expect(unit.name).toBe('Kira');
    expect(unit.level).toBeGreaterThanOrEqual(5);
  });

  it('lord NPC faction can be set to npc', () => {
    const lordDef = gameData.lords.find((l) => l.name === 'Voss');
    const classData = gameData.classes.find((c) => c.name === lordDef.class);
    const unit = createBossLordUnit(lordDef, classData, gameData.weapons, 3, null);
    unit.faction = 'npc';
    expect(unit.faction).toBe('npc');
    expect(unit.isLord).toBe(true);
  });
});

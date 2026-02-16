import { describe, it, expect } from 'vitest';
import { getAvailableLords, createBossLordUnit } from '../src/engine/BossRecruitSystem.js';
import { loadGameData } from './testData.js';

const gameData = loadGameData();

describe('Recruit Node Lord Availability', () => {
  it('returns Kira and Voss when neither is in roster', () => {
    const roster = [{ name: 'Edric' }, { name: 'Sera' }];
    const avail = getAvailableLords(roster, gameData.lords);
    expect(avail.map(l => l.name).sort()).toEqual(['Kira', 'Voss']);
  });

  it('excludes already-recruited lord', () => {
    const roster = [{ name: 'Edric' }, { name: 'Sera' }, { name: 'Kira' }];
    const avail = getAvailableLords(roster, gameData.lords);
    expect(avail).toHaveLength(1);
    expect(avail[0].name).toBe('Voss');
  });

  it('returns empty when both recruited', () => {
    const roster = [{ name: 'Edric' }, { name: 'Sera' }, { name: 'Kira' }, { name: 'Voss' }];
    expect(getAvailableLords(roster, gameData.lords)).toHaveLength(0);
  });

  it('excludes lord in fallenUnits (dead lord not re-offered)', () => {
    const roster = [{ name: 'Edric' }, { name: 'Sera' }];
    const fallen = [{ name: 'Kira' }];
    const avail = getAvailableLords(roster, gameData.lords, fallen);
    expect(avail).toHaveLength(1);
    expect(avail[0].name).toBe('Voss');
  });

  it('returns empty when one lord recruited and other fallen', () => {
    const roster = [{ name: 'Edric' }, { name: 'Sera' }, { name: 'Kira' }];
    const fallen = [{ name: 'Voss' }];
    expect(getAvailableLords(roster, gameData.lords, fallen)).toHaveLength(0);
  });

  it('backwards-compatible when fallenUnits not passed', () => {
    const roster = [{ name: 'Edric' }, { name: 'Sera' }];
    const avail = getAvailableLords(roster, gameData.lords);
    expect(avail).toHaveLength(2);
  });

  it('createBossLordUnit creates a valid lord with isLord flag', () => {
    const lordDef = gameData.lords.find(l => l.name === 'Kira');
    const classData = gameData.classes.find(c => c.name === lordDef.class);
    const unit = createBossLordUnit(lordDef, classData, gameData.weapons, 5, null);
    expect(unit.isLord).toBe(true);
    expect(unit.name).toBe('Kira');
    expect(unit.level).toBeGreaterThanOrEqual(5);
  });

  it('lord NPC faction can be set to npc', () => {
    const lordDef = gameData.lords.find(l => l.name === 'Voss');
    const classData = gameData.classes.find(c => c.name === lordDef.class);
    const unit = createBossLordUnit(lordDef, classData, gameData.weapons, 3, null);
    unit.faction = 'npc';
    expect(unit.faction).toBe('npc');
    expect(unit.isLord).toBe(true);
  });
});

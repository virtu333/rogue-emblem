import { describe, it, expect } from 'vitest';
import { RunManager, serializeUnit } from '../src/engine/RunManager.js';
import { loadGameData } from './testData.js';

function fixture() {
  const data = loadGameData();
  const rm = new RunManager(data);
  rm.startRun();
  rm.activeBlessings = [{ id: 'field_medic' }];
  return { rm, data, unit: { ...structuredClone(rm.roster[0]), consumables: [] } };
}
describe('Field Medic at recruitment', () => {
  it('grants exactly once, including after serialization and a save restore', () => {
    const { rm, data, unit } = fixture();
    rm.grantRecruitBlessingConsumables(unit);
    expect(unit.consumables.map((item) => item.name)).toEqual(['Vulnerary']);
    rm.roster.push(serializeUnit(unit));
    const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(rm.toJSON())), data);
    const recruit = restored.roster.at(-1);
    recruit.consumables = []; // Using the item never grants another on replay.
    restored.grantRecruitBlessingConsumables(recruit);
    expect(recruit.consumables).toEqual([]);
  });
  it('supports existing saves with active blessing but no new runtime modifier', () => {
    const { rm, unit } = fixture();
    rm.resolveThirdLord(unit);
    expect(unit.consumables).toHaveLength(1);
  });
  it('falls back to convoy without replacing a full bag, and respects a full convoy', () => {
    const { rm, unit, data } = fixture();
    const item = data.consumables.find((item) => item.name === 'Vulnerary');
    unit.consumables = Array.from({ length: 3 }, () => structuredClone(item));
    rm.grantRecruitBlessingConsumables(unit);
    expect(unit.consumables).toHaveLength(3);
    expect(rm.convoy.consumables).toHaveLength(1);
    const other = { ...unit, recruitBlessingGrants: [] };
    rm.convoy.consumables = Array.from({ length: rm.getConvoyCapacities().consumables }, () =>
      structuredClone(item),
    );
    rm.grantRecruitBlessingConsumables(other);
    expect(other.recruitBlessingGrants).toEqual([]);
  });
  it('does not grant without Field Medic', () => {
    const { rm, unit } = fixture();
    rm.activeBlessings = [];
    rm.grantRecruitBlessingConsumables(unit);
    expect(unit.consumables).toEqual([]);
  });
});

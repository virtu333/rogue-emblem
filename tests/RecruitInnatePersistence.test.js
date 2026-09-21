import { describe, it, expect } from 'vitest';
import { loadGameData } from './testData.js';
import { createRecruitUnit, getClassInnateSkills } from '../src/engine/UnitManager.js';
import { RunManager } from '../src/engine/RunManager.js';
const data = loadGameData();
const classes = data.classes.filter(
  (c) => c.tier === 'promoted' && c.promotesFrom && c.name !== 'Entity',
);
describe('fresh recruit innate skills match persisted recruits', () => {
  it.each(classes.map((c) => [c.name, c]))(
    '%s receives its class identity before reload',
    (name, cls) => {
      const unit = createRecruitUnit(
        { name: 'New recruit', level: 1 },
        cls,
        data.weapons,
        null,
        null,
        null,
        data.classes,
        { skillsData: data.skills },
      );
      unit.faction = 'player';
      const expected = [
        ...getClassInnateSkills(cls.name, data.skills),
        ...getClassInnateSkills(cls.promotesFrom, data.skills),
      ];
      expect(unit.skills).toEqual(expect.arrayContaining(expected));
      const run = new RunManager(data);
      run.startRun({ runSeed: 42, applyBlessingsAtStart: false });
      run.roster.push(unit);
      const restored = RunManager.fromJSON(JSON.parse(JSON.stringify(run.toJSON())), data);
      expect(restored.roster.find((u) => u.name === 'New recruit').skills).toEqual(unit.skills);
    },
  );
});

// A promoted class can be reached from more than one base: the Soldier (added
// 2026-09-26) promotes into Duelist (also the Myrmidon's) and Paladin (also the
// Cavalier's). classes.json names one promotesFrom per promoted class, so a unit
// remembers its own line (unit.baseClass) and its mastery, missed class skills and
// faces follow that line, not whichever base happens to be listed first.
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import {
  createUnit,
  promoteUnit,
  checkLevelUpSkills,
  reclassUnit,
} from '../src/engine/UnitManager.js';
import { unitBaseClassName, promotedFromName, baseClassesFor } from '../src/engine/ClassLineage.js';
import {
  getBaseClassName,
  getMasteryPerk,
  getMasteryProgress,
} from '../src/engine/MasterySystem.js';
import { serializeUnit } from '../src/engine/RunManager.js';
import { serializeBattleUnit } from '../src/engine/BattleUnitState.js';
import { portraitCandidates } from '../src/ui/portraitArt.js';

const gameData = loadGameData();
const classes = gameData.classes;
const cls = (name) => classes.find((c) => c.name === name);

function promoted(base, target) {
  const unit = createUnit(cls(base), 20, gameData.weapons, { faction: 'player' });
  unit.skills = [];
  const into = cls(target);
  promoteUnit(unit, into, into.promotionBonuses || {}, gameData.skills);
  return unit;
}

describe('the Soldier class', () => {
  it('is a base lance infantry class promoting to Duelist or Paladin', () => {
    const soldier = cls('Soldier');
    expect(soldier.tier).toBe('base');
    expect(soldier.moveType).toBe('Infantry');
    expect(soldier.weaponProficiencies).toBe('Lances (P)');
    expect(soldier.promotesTo).toEqual(['Duelist', 'Paladin']);
    expect(baseClassesFor('Duelist', classes)).toEqual(['Myrmidon', 'Soldier']);
    expect(baseClassesFor('Paladin', classes)).toEqual(['Cavalier', 'Soldier']);
  });

  it('starts with a lance and a javelin to throw', () => {
    const unit = createUnit(cls('Soldier'), 1, gameData.weapons, { faction: 'player' });
    expect(unit.inventory.map((w) => w.type)).toEqual(['Lance', 'Lance']);
    expect(unit.inventory.map((w) => w.name)).toContain('Javelin');
  });

  it('rides as a Paladin and fights with sword and lance as a Duelist', () => {
    const paladin = promoted('Soldier', 'Paladin');
    expect(paladin.moveType).toBe('Cavalry');
    const duelist = promoted('Soldier', 'Duelist');
    expect(duelist.moveType).toBe('Infantry');
    expect(duelist.proficiencies.map((p) => p.type).sort()).toEqual(['Lance', 'Sword']);
  });
});

describe('class lineage', () => {
  it('a promoted unit remembers the line it came from', () => {
    expect(promoted('Soldier', 'Duelist').baseClass).toBe('Soldier');
    expect(promoted('Myrmidon', 'Duelist').baseClass).toBe('Myrmidon');
    expect(promoted('Soldier', 'Paladin').baseClass).toBe('Soldier');
    expect(promoted('Cavalier', 'Paladin').baseClass).toBe('Cavalier');
  });

  it('mastery follows the unit own line (battles and perk)', () => {
    const duelist = promoted('Soldier', 'Duelist');
    duelist.classBattles = { Soldier: 6, Myrmidon: 50, Duelist: 2 };
    expect(getBaseClassName(duelist, classes)).toBe('Soldier');
    expect(getMasteryProgress(duelist, classes)).toBe(8);
    expect(getMasteryPerk(duelist, classes).name).toBe('Shield Wall');
    const myrmidon = promoted('Myrmidon', 'Duelist');
    myrmidon.classBattles = { Soldier: 6, Myrmidon: 5, Duelist: 2 };
    expect(getMasteryProgress(myrmidon, classes)).toBe(7);
    expect(getMasteryPerk(myrmidon, classes).name).toBe("Duelist's Edge");
  });

  it('a promoted unit learns its own base class skill at level 10, not another line s', () => {
    const duelist = promoted('Soldier', 'Duelist');
    duelist.level = 10;
    duelist.skills = [];
    checkLevelUpSkills(duelist, classes);
    expect(duelist.skills).toContain('quick_riposte');
    expect(duelist.skills).not.toContain('vantage');
  });

  it('units saved before the field existed keep the listed line', () => {
    const legacy = { className: 'Duelist', tier: 'promoted' };
    expect(unitBaseClassName(legacy, classes)).toBe('Myrmidon');
    expect(getBaseClassName(legacy, classes)).toBe('Myrmidon');
  });

  it('a stale line (reclassed since) is ignored', () => {
    const unit = promoted('Soldier', 'Duelist');
    reclassUnit(unit, cls('Sniper'), cls('Duelist'), classes, gameData.skills);
    expect(unit.className).toBe('Sniper');
    expect(unitBaseClassName(unit, classes)).toBe('Archer');
  });

  it('base classes are their own line and have no promotedFrom', () => {
    const mage = { className: 'Mage', tier: 'base' };
    expect(unitBaseClassName(mage, classes)).toBe('Mage');
    expect(promotedFromName(mage, classes)).toBeNull();
  });

  it('the line survives the run save and the battle checkpoint', () => {
    const duelist = promoted('Soldier', 'Duelist');
    expect(serializeUnit(duelist).baseClass).toBe('Soldier');
    expect(serializeBattleUnit(duelist).baseClass).toBe('Soldier');
  });

  it('portrait fallbacks follow the line, and a base class never lists itself twice', () => {
    const duelist = { name: 'Rufus', className: 'Duelist', tier: 'promoted', baseClass: 'Soldier' };
    expect(portraitCandidates(duelist, gameData)).toContain('generic_soldier');
    const mage = { name: 'Grunt', className: 'Mage', tier: 'base', faction: 'enemy' };
    const ids = portraitCandidates(mage, gameData);
    expect(ids.filter((id) => id === 'generic_mage')).toHaveLength(1);
  });
});

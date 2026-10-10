// Every promotion path hands over the Iron weapon of each newly wielded type
// (a lord: the promotion weapon). The church's rite once promised it and gave nothing.
import { describe, it, expect, beforeEach } from 'vitest';
import { RunManager } from '../src/engine/RunManager.js';
import {
  createUnit,
  createLordUnit,
  resolvePromotionTargets,
  getReclassTargets,
} from '../src/engine/UnitManager.js';
import { getClassChangeWeaponGrants } from '../src/engine/RosterCommands.js';
import { promotionPathContent } from '../src/ui/growthContent.js';
import { promoteAtChurch } from '../src/engine/ChurchCommands.js';
import { applyRosterClassChange } from '../src/engine/RosterCommands.js';
import { loadGameData } from './testData.js';

const data = loadGameData();
const cls = (n) => data.classes.find((c) => c.name === n);
const names = (u) => u.inventory.map((w) => w.name);
let run;
const mage = () => createUnit(cls('Mage'), 10, data.weapons, { name: 'Test Mage' });
const edric = () => {
  const def = data.lords.find((l) => l.name === 'Edric');
  const u = createLordUnit(def, cls(def.class), data.weapons);
  u.level = 10;
  return u;
};
const seal = (effect, subEffect) => ({
  name: `${effect} seal`,
  type: 'Consumable',
  effect,
  subEffect,
  uses: 1,
});
const target = (u, i = 0) => resolvePromotionTargets(u, data.classes, data.lords)[i];

beforeEach(() => {
  run = new RunManager(data);
  run.gold = 10000;
});

describe('church promotion grants', () => {
  it('Mage to Sage receives Heal and Glimmer', () => {
    const u = mage();
    run.roster = [u];
    const res = promoteAtChurch(run, u, 'n1', target(u), data);
    expect(res.ok).toBe(true);
    expect(names(u)).toEqual(expect.arrayContaining(['Heal', 'Glimmer']));
    expect(res.message).toContain('Heal');
  });
  it('Edric to Great Lord receives an Iron Lance', () => {
    const u = edric();
    run.roster = [u];
    expect(promoteAtChurch(run, u, 'n1', target(u), data).ok).toBe(true);
    expect(names(u)).toContain('Iron Lance');
  });
  it('a full bag still promotes and says what it could not hand over', () => {
    const u = mage();
    run.roster = [u];
    while (u.inventory.length < 5)
      u.inventory.push({ ...data.weapons.find((w) => w.name === 'Fire') });
    const res = promoteAtChurch(run, u, 'n1', target(u), data);
    expect(res.ok).toBe(true);
    expect(res.message).toContain('Bag full');
  });
});

describe('seal promotion and reclass grants', () => {
  it('Master Seal: Mage to Sage and Edric to Great Lord', () => {
    for (const make of [mage, edric]) {
      const u = make();
      run.roster = [u];
      const s = seal('promote');
      u.consumables = [s];
      expect(applyRosterClassChange(run, u, s, target(u), data).ok).toBe(true);
    }
  });
  it('Master Seal grants match the church', () => {
    const u = mage();
    run.roster = [u];
    const s = seal('promote');
    u.consumables = [s];
    applyRosterClassChange(run, u, s, target(u), data);
    expect(names(u)).toEqual(expect.arrayContaining(['Heal', 'Glimmer']));
    const l = edric();
    run.roster = [l];
    const s2 = seal('promote');
    l.consumables = [s2];
    applyRosterClassChange(run, l, s2, target(l), data);
    expect(names(l)).toContain('Iron Lance');
  });
  it('reclass grants the new type', () => {
    const u = createUnit(cls('Fighter'), 5, data.weapons, { name: 'Test Fighter' });
    run.roster = [u];
    const s = seal('reclass', 'infantry');
    u.consumables = [s];
    const t = getReclassTargets(u, data.classes, 'infantry').find((c) =>
      /Archer|Mage|Knight|Mercenary/.test(c.name),
    );
    const before = new Set(u.proficiencies.map((p) => p.type));
    expect(applyRosterClassChange(run, u, s, t, data).ok).toBe(true);
    for (const p of u.proficiencies.filter((p) => !before.has(p.type)))
      expect(u.inventory.some((w) => w.type === p.type)).toBe(true);
  });
});

describe('lords with several promotion weapon types', () => {
  const lord = (name) => {
    const def = data.lords.find((l) => l.name === name);
    const u = createLordUnit(def, cls(def.class), data.weapons);
    u.level = 10;
    return u;
  };
  const promoted = (name) => {
    const u = lord(name);
    run.roster = [u];
    expect(promoteAtChurch(run, u, 'n1', target(u), data).ok).toBe(true);
    return u;
  };
  it('Voss receives the Iron Axe and Iron Bow his promotion opens', () => {
    const u = promoted('Voss');
    expect(names(u)).toEqual(expect.arrayContaining(['Iron Axe', 'Iron Bow']));
  });
  it('Rowan receives Heal and Glimmer', () => {
    expect(names(promoted('Rowan'))).toEqual(expect.arrayContaining(['Heal', 'Glimmer']));
  });
  it('a carried "Iron Lance +1" stops a second Iron Lance', () => {
    const u = edric();
    u.inventory = [{ ...data.weapons.find((w) => w.name === 'Iron Lance'), name: 'Iron Lance +1' }];
    run.roster = [u];
    promoteAtChurch(run, u, 'n1', target(u), data);
    expect(names(u).filter((n) => n.startsWith('Iron Lance'))).toEqual(['Iron Lance +1']);
  });
  it('a type already carried grants nothing twice', () => {
    const u = lord('Voss');
    const before = new Set(u.proficiencies.map((p) => p.type));
    const grants = getClassChangeWeaponGrants(u, before, data, true);
    expect(grants.map((w) => w.name)).not.toContain(u.inventory[0].name);
  });
});

describe('full bag preview', () => {
  it('names the grants a full bag cannot take, and nothing otherwise', () => {
    const u = mage();
    const fire = data.weapons.find((w) => w.name === 'Fire');
    u.inventory = [fire, fire, fire, fire].map((w) => ({ ...w }));
    const t = target(u);
    const content = promotionPathContent(u, t, data);
    expect(content.grants).toEqual(expect.arrayContaining(['Heal', 'Glimmer']));
    expect(content.grantsShort).toEqual(['Glimmer']);
    u.inventory = [];
    expect(promotionPathContent(u, t, data).grantsShort).toEqual([]);
  });
  it('a full bag keeps the promotion and the church spends the vow, with the shortfall in the message', () => {
    const u = mage();
    run.roster = [u];
    const fire = data.weapons.find((w) => w.name === 'Fire');
    u.inventory = [1, 2, 3, 4, 5].map(() => ({ ...fire }));
    const gold = run.gold;
    const res = promoteAtChurch(run, u, 'n1', target(u), data);
    expect(res.ok).toBe(true);
    expect(u.inventory).toHaveLength(5);
    expect(run.gold).toBe(gold - 2000);
    expect(run.getChurchPromotionCount('n1')).toBe(1);
    expect(res.message).toContain('Bag full');
  });
});

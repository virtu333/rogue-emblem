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

describe('lords whose promotion opens one or more weapon types', () => {
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
  it('Voss receives only the Iron Axe: swords and bows he already wielded give nothing', () => {
    const u = lord('Voss');
    u.inventory = ['Steel Sword', 'Steel Bow'].map((n) => ({
      ...data.weapons.find((w) => w.name === n),
    }));
    run.roster = [u];
    const res = promoteAtChurch(run, u, 'n1', target(u), data);
    expect(res.ok).toBe(true);
    expect(names(u)).toEqual(['Steel Sword', 'Steel Bow', 'Iron Axe']);
    expect(res.message).toContain('Received Iron Axe.');
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
  it('every lord is granted exactly the types the promotion newly opens', () => {
    for (const def of data.lords) {
      const u = lord(def.name);
      const before = new Set(u.proficiencies.map((p) => p.type));
      run.roster = [u];
      u.inventory = [];
      run.gold = 10000;
      expect(promoteAtChurch(run, u, `n-${def.name}`, target(u), data).ok).toBe(true);
      const opened = u.proficiencies.filter((p) => !before.has(p.type)).map((p) => p.type);
      expect(u.inventory.map((w) => w.type).sort()).toEqual(
        opened.filter((t) => data.weapons.some((w) => w.type === t && w.tier === 'Iron')).sort(),
      );
    }
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

// A promotion's starter weapon a full bag cannot take goes to the convoy, as any other grant
// a full bag cannot take; only a full convoy too loses it (and says so).
describe('full bag: the grant goes to the convoy', () => {
  const fullOf = (u, name) => {
    const w = data.weapons.find((x) => x.name === name);
    u.inventory = [1, 2, 3, 4, 5].map(() => structuredClone(w));
  };
  const fillConvoy = () => {
    const sword = data.weapons.find((w) => w.name === 'Iron Sword');
    while (run.canAddToConvoy(sword)) run.addToConvoy(sword);
  };
  const convoyNames = () => run.getConvoyItems().weapons.map((w) => w.name);
  // Aldo's case: a Cavalier's lance bag, promoted to Paladin, who opens Swords.
  const cavalier = () => createUnit(cls('Cavalier'), 10, data.weapons, { name: 'Aldo' });
  const paladin = (u) =>
    resolvePromotionTargets(u, data.classes, data.lords).find((c) => c.name === 'Paladin');

  it('a Master Seal promotion with five weapons sends the new Iron Sword to the convoy', () => {
    const u = cavalier();
    run.roster = [u];
    fullOf(u, 'Iron Lance');
    u.consumables = [seal('promote')];
    const before = convoyNames().length;
    const res = applyRosterClassChange(run, u, u.consumables[0], paladin(u), data);
    expect(res.ok).toBe(true);
    expect(u.className).toBe('Paladin');
    expect(names(u)).not.toContain('Iron Sword');
    expect(convoyNames()).toHaveLength(before + 1);
    expect(convoyNames()).toContain('Iron Sword');
    expect(res.notices).toContain('Bag full: Iron Sword sent to the convoy.');
  });
  it('a church promotion with five weapons sends it to the convoy and says so', () => {
    const u = cavalier();
    run.roster = [u];
    fullOf(u, 'Iron Lance');
    const res = promoteAtChurch(run, u, 'n1', paladin(u), data);
    expect(res.ok).toBe(true);
    expect(convoyNames()).toContain('Iron Sword');
    expect(res.message).toContain('Bag full: Iron Sword sent to the convoy.');
  });
  it('a reclass seal with a full bag sends the new weapon to the convoy', () => {
    const u = createUnit(cls('Fighter'), 10, data.weapons, { name: 'Test Fighter' });
    run.roster = [u];
    fullOf(u, 'Iron Axe');
    u.consumables = [seal('reclass', 'infantry')];
    const myrmidon = getReclassTargets(u, data.classes, 'infantry').find(
      (c) => c.name === 'Myrmidon',
    );
    const res = applyRosterClassChange(run, u, u.consumables[0], myrmidon, data);
    expect(res.ok).toBe(true);
    expect(convoyNames()).toContain('Iron Sword');
    expect(res.notices).toContain('Bag full: Iron Sword sent to the convoy.');
  });
  it('bag and convoy both full: the promotion still happens and the loss is named', () => {
    const u = cavalier();
    run.roster = [u];
    fullOf(u, 'Iron Lance');
    fillConvoy();
    const convoyBefore = JSON.stringify(run.getConvoyItems());
    const res = promoteAtChurch(run, u, 'n1', paladin(u), data);
    expect(res.ok).toBe(true);
    expect(u.className).toBe('Paladin');
    expect(JSON.stringify(run.getConvoyItems())).toBe(convoyBefore);
    expect(res.message).toContain('Bag and convoy full: Iron Sword could not be granted.');
  });
  it('the path preview says where the weapon goes, from the same run', () => {
    const u = cavalier();
    fullOf(u, 'Iron Lance');
    const content = promotionPathContent(u, paladin(u), data, { run });
    expect(content.grantsConvoy).toEqual(['Iron Sword']);
    expect(content.grantsLost).toEqual([]);
    fillConvoy();
    const full = promotionPathContent(u, paladin(u), data, { run });
    expect(full.grantsConvoy).toEqual([]);
    expect(full.grantsLost).toEqual(['Iron Sword']);
  });
});

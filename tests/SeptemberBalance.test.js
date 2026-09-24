import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadGameData } from './testData.js';
import { MetaProgressionManager } from '../src/engine/MetaProgressionManager.js';
import { RunManager } from '../src/engine/RunManager.js';
import { calculateDamage, resolveCombat } from '../src/engine/Combat.js';
import { rollStrikeSkills } from '../src/engine/SkillSystem.js';
import { applyRecruitWeaponForge } from '../src/engine/UnitManager.js';
const data = loadGameData();
afterEach(() => vi.restoreAllMocks());
function storage(saved) {
  let text = saved ? JSON.stringify(saved) : null;
  vi.stubGlobal('localStorage', {
    getItem: () => text,
    setItem: (_, value) => {
      text = value;
    },
  });
}
describe('September balance compatibility', () => {
  it('credits purchased reductions once across save/load and keeps old Sol refund basis', () => {
    storage({
      totalValor: 100,
      totalSupply: 100,
      purchasedUpgrades: { weapon_forge: 3, recruit_weapon_forge: 2, unlock_sol: 1 },
    });
    const m = new MetaProgressionManager(data.metaUpgrades);
    expect(m.totalValor).toBe(325);
    expect(m.totalSupply).toBe(1200);
    expect(m.solRefundBasis).toBe(400);
    m._save();
    const next = new MetaProgressionManager(data.metaUpgrades);
    expect(next.totalValor).toBe(325);
    expect(next.totalSupply).toBe(1200);
    expect(next.refundUpgrade('unlock_sol').refundAmount).toBe(400);
    next.totalValor = 1000;
    expect(next.purchaseUpgrade('unlock_sol')).toBe(true);
    expect(next.refundUpgrade('unlock_sol').refundAmount).toBe(600);
  });
  it('does not invent a cost for an old Swift Instinct selection', () => {
    const run = new RunManager(data);
    expect(
      run._normalizeActiveBlessingsForLoad([{ id: 'swift_instinct', rolledCost: null }])[0]
        .rolledCost,
    ).toBeFalsy();
  });
  it('preserves an already rolled Swift drawback', () => {
    const run = new RunManager(data);
    const rolledCost = data.blessings.costPools['2'][0];
    expect(
      run._normalizeActiveBlessingsForLoad([{ id: 'swift_instinct', rolledCost }])[0].rolledCost,
    ).toEqual(rolledCost);
  });
  it('replaces ineligible weight rolls with successful forges', () => {
    const weapon = { name: 'Test', type: 'Sword', might: 4, hit: 80, crit: 0, weight: 0 };
    applyRecruitWeaponForge({ inventory: [weapon] }, 2, () => 0);
    expect(weapon._forgeLevel).toBe(2);
  });
});
const sword = { name: 'Test', type: 'Sword', might: 0, hit: 100, crit: 0, weight: 0, range: '1' };
function unit(name, stats, skills = []) {
  return {
    name,
    stats: { HP: 100, STR: 12, MAG: 12, SKL: 100, SPD: 10, DEF: 20, RES: 6, LCK: 100, ...stats },
    currentHP: 100,
    skills,
    weapon: sword,
    moveType: 'Infantry',
    weaponRank: 'Prof',
  };
}
describe('Luna defense reduction', () => {
  it.each([
    ['Sword', false, 2],
    ['Tome', false, 9],
    ['Sword', true, 9],
  ])('halves the selected defense: %s targetsRES=%s', (type, targetsRES, damage) => {
    expect(
      calculateDamage(unit('A'), { ...sword, type }, unit('D'), null, null, true, {
        halveDefense: true,
        targetsRES,
      }),
    ).toBe(damage);
  });
  it('keeps terrain and avoids quartering Sunder defense', () => {
    expect(
      calculateDamage(unit('A'), sword, unit('D', { DEF: 19 }), null, { defBonus: 2 }, true, {
        halveDefense: true,
      }),
    ).toBe(1);
    const weapon = { ...sword, special: 'Halves target DEF' };
    expect(
      calculateDamage(unit('A'), weapon, unit('D'), null, null, true, { halveDefense: true }),
    ).toBe(2);
  });
  it('can penetrate armor that normally blocks all damage, with crit applied afterward', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const a = unit('A', {}, ['luna']);
    const weapon = { ...sword, crit: 200 };
    a.weapon = weapon;
    const d = unit('D', { LCK: 0 });
    const result = resolveCombat(a, weapon, d, null, 1, null, null, {
      rollStrikeSkills,
      skillsData: data.skills,
    });
    const hit = result.events.find((e) => e.type === 'strike');
    expect(hit.damage).toBe(6);
    expect(hit.skillActivations.some((s) => s.id === 'luna')).toBe(true);
  });
});

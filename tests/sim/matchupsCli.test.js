// sim/matchups.js reports how often each side doubles. The game doubles on attack
// speed (SPD less weapon weight beyond STR/5, plus bonuses), never raw SPD. Ways the
// report can go wrong, each caught below:
//   - it compares raw SPD again (a Myrmidon "never" doubles a Fighter at L1);
//   - its numbers drift from what the engine's forecast would say for the same units;
//   - reading the forecast draws randomness and shifts every seeded result after it;
//   - the output stops saying what the columns count.
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWeaponProficiencies } from '../../src/engine/UnitManager.js';
import { getCombatForecast } from '../../src/engine/Combat.js';
import { getSkillCombatMods, rollStrikeSkills, checkAstra } from '../../src/engine/SkillSystem.js';
import { createEnemy, getData, getWeapon } from '../../sim/lib/SimUnitFactory.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const script = join(root, 'sim', 'matchups.js');
const readJSON = (name) => JSON.parse(readFileSync(join(root, 'data', name), 'utf8'));
const classes = readJSON('classes.json');
const weapons = readJSON('weapons.json');

afterEach(() => vi.restoreAllMocks());

function runSim(args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  expect(result.status, result.stderr).toBe(0);
  return result.stdout;
}

/** Rows of the first table printed after a line containing `title`. */
function tableAfter(stdout, title) {
  const lines = stdout.split('\n');
  let i = lines.findIndex((line) => line.includes(title));
  expect(i, `no "${title}" in the output`).toBeGreaterThanOrEqual(0);
  while (!/^-+(\s+-+)*\s*$/.test(lines[i + 1] || '')) i++;
  const header = lines[i].trim().split(/\s{2,}/);
  const rows = [];
  for (let r = i + 2; r < lines.length && lines[r].trim(); r++) {
    const cells = lines[r].trim().split(/\s{2,}/);
    rows.push(Object.fromEntries(header.map((h, k) => [h, cells[k]])));
  }
  return rows;
}

/**
 * Attack speed of a class at L1, straight from the data and the documented rule:
 * base SPD less max(0, weight − floor(STR / 5)) of its Iron weapon (first non-staff
 * proficiency); a staff (or no weapon) leaves SPD as is. L1 units have base stats
 * and no skills, so nothing else applies.
 */
function attackSpeedAtL1(className) {
  const cls = classes.find((c) => c.name === className);
  const profs = parseWeaponProficiencies(cls.weaponProficiencies);
  const type = (profs.find((p) => p.type !== 'Staff') || profs[0])?.type;
  const weapon =
    weapons.find((w) => w.type === type && w.tier === 'Iron' && !w.special) ||
    weapons.find((w) => w.type === type && w.tier === 'Iron');
  const { SPD, STR } = cls.baseStats;
  if (!weapon || weapon.type === 'Staff') return SPD;
  return SPD - Math.max(0, (weapon.weight || 0) - Math.floor(STR / 5));
}

const pct = (yes) => (yes ? '100%' : '0%');

describe('sim/matchups doubling columns', () => {
  let stdout = '';
  let myrmidon = [];
  beforeAll(() => {
    stdout = runSim(['--trials', '4', '--seed', '11']);
    myrmidon = tableAfter(stdout, 'Myrmidon Doubling Rate vs All (L1)');
  });

  it('a Myrmidon doubles a Fighter at L1 in every fight (attack speed, not raw SPD)', () => {
    const [m, f] = ['Myrmidon', 'Fighter'].map((n) => classes.find((c) => c.name === n));
    // Raw SPD would say no (9 vs 5): the case only passes on attack speed (7 vs 0).
    expect(m.baseStats.SPD).toBeLessThan(f.baseStats.SPD + 5);
    expect(attackSpeedAtL1('Myrmidon')).toBeGreaterThanOrEqual(attackSpeedAtL1('Fighter') + 5);
    const fighter = myrmidon.find((row) => row.Defender === 'Fighter');
    expect(fighter).toMatchObject({ Doubles: '100%', Doubled: '0%' });
  });

  it('every L1 row matches the attack-speed rule for both sides', () => {
    const mine = attackSpeedAtL1('Myrmidon');
    expect(myrmidon.length).toBeGreaterThan(10);
    for (const row of myrmidon) {
      const theirs = attackSpeedAtL1(row.Defender);
      expect(row, row.Defender).toMatchObject({
        Doubles: pct(mine >= theirs + 5),
        Doubled: pct(theirs >= mine + 5),
      });
    }
    // The rule must not be vacuous here: some rows double and some do not.
    expect(new Set(myrmidon.map((row) => row.Doubles))).toEqual(new Set(['100%', '0%']));
  });

  it('the engine forecast agrees with the rule for the same L1 units', () => {
    const data = getData();
    for (const row of myrmidon) {
      const atk = createEnemy('Myrmidon', 1);
      const def = createEnemy(row.Defender, 1);
      const skillCtx = {
        atkMods: getSkillCombatMods(atk, def, [atk], [def], data.skills),
        defMods: getSkillCombatMods(def, atk, [def], [atk], data.skills),
        rollStrikeSkills,
        checkAstra,
        skillsData: data.skills,
      };
      const forecast = getCombatForecast(atk, atk.weapon, def, def.weapon, 1, null, null, skillCtx);
      expect(pct(forecast.attacker.doubles), row.Defender).toBe(row.Doubles);
      expect(pct(forecast.defender.doubles), row.Defender).toBe(row.Doubled);
    }
  });

  it('says what the doubling columns count', () => {
    expect(stdout).toContain('eligible to double');
    expect(stdout).toContain('a fight that ends first still counts');
    const csv = runSim(['--trials', '2', '--seed', '11', '--csv', '--focus', 'Myrmidon']);
    expect(csv).toContain('# doubles / doubled = share of fights');
  });

  it('reading the forecast draws no randomness, so seeded results stay put', () => {
    const data = getData();
    const pairs = [
      ['Myrmidon', 'Fighter', 1],
      ['Knight', 'Mage', 5],
      ['Mercenary', 'Archer', 10],
      ['Swordmaster', 'General', 5, ['wrath', 'crit_plus_15'], 'Keen Sword'],
      ['Hero', 'Swordmaster', 5, ['astra'], 'Oathblade'],
    ];
    for (const [a, d, level, skills = [], weapon = null] of pairs) {
      const atk = createEnemy(a, level);
      const def = createEnemy(d, level);
      if (weapon) atk.weapon = getWeapon(weapon);
      if (skills.length) atk.skills = [...skills];
      const skillCtx = {
        atkMods: getSkillCombatMods(atk, def, [atk], [def], data.skills),
        defMods: getSkillCombatMods(def, atk, [def], [atk], data.skills),
        rollStrikeSkills,
        checkAstra,
        skillsData: data.skills,
      };
      const random = vi.spyOn(Math, 'random');
      getCombatForecast(atk, atk.weapon, def, def.weapon, 1, null, null, skillCtx);
      expect(random, `${a} vs ${d}`).not.toHaveBeenCalled();
      random.mockRestore();
    }
  });
});

import { expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { weaponArtDetailLines } from '../src/ui/weaponArtDisplay.js';
import { applyWeaponArtCost } from '../src/engine/WeaponArtSystem.js';
import { getPostCombatPipelineSteps } from '../src/engine/WeaponArtPostCombat.js';
const arts = loadGameData().weaponArts.arts;
const find = (name) => arts.find((a) => a.name === name);
const details = (name) => weaponArtDetailLines(find(name)).join('\n');
it('explains splash amounts, radius and target caps', () => {
  expect(details('Radiant Burst')).toContain("75% of the first landed strike's damage");
  expect(details('Radiant Burst')).toContain('up to 1 other enemies within 1 tile');
  expect(details('Cataclysm')).toContain('5 damage');
  expect(details('Cataclysm')).toContain('within 2 tile');
});
it('explains ally buffs, exclusions and duration', () => {
  expect(details('Rallying Blow')).toContain('+3 STR, +10 CRIT');
  expect(details('Rallying Blow')).toContain('excludes the user');
  expect(details('Rallying Blow')).toContain('1 phase');
});
it('exposes drawbacks, debuffs and movement timing', () => {
  expect(details('All or Nothing')).toContain('Each missed strike costs the user 5 HP');
  expect(details('Galeforce Assault')).toContain('HP is set to 5, even if every strike misses');
  expect(details('Seal Speed')).toContain('rest of this battle');
  expect(details('Hit and Run')).toContain('counterattack before you retreat');
});
it('every art has cost, requirements, limits, and follow-up rules in its details', () => {
  for (const art of arts) {
    const text = weaponArtDetailLines(art).join('\n');
    expect(text, art.name).toContain('Requires');
    expect(text, art.name).toContain('Base HP cost:');
    expect(text, art.name).toContain('do not gain a follow-up');
    expect(text, art.name).not.toMatch(/undefined|NaN/);
  }
});
it('Phantom Rush spends 8 HP upfront and cannot reset HP after either hits or misses', () => {
  const art = find('Phantom Rush');
  const attacker = { name: 'A', currentHP: 30, stats: { HP: 30 } };
  const defender = { name: 'D', currentHP: 30, stats: { HP: 30 } };
  applyWeaponArtCost(attacker, art);
  expect(attacker.currentHP).toBe(22);
  for (const miss of [true, false]) {
    const steps = getPostCombatPipelineSteps({
      attacker,
      defender,
      attackerWeaponArt: art,
      result: {
        events: [{ type: 'strike', attackerSide: 'attacker', miss, damage: miss ? 0 : 8 }],
      },
    });
    expect(steps.some((s) => s.type === 'tier2_set_hp')).toBe(false);
    expect(steps.some((s) => s.type === 'tier2_move')).toBe(!miss);
  }
});

import { expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { weaponArtDetailLines, weaponArtSheet } from '../src/ui/weaponArtDisplay.js';
import { WEAPON_ARTS_HELP } from '../src/ui/helpTopics.js';
import { helpBlockText } from '../src/ui/ContextHelp.js';
import { applyWeaponArtCost } from '../src/engine/WeaponArtSystem.js';
import { getPostCombatPipelineSteps } from '../src/engine/WeaponArtPostCombat.js';
const arts = loadGameData().weaponArts.arts;
const find = (name) => arts.find((a) => a.name === name);
const details = (name) => weaponArtDetailLines(find(name)).join('\n');
it('explains area amounts, radius, lines and target picks', () => {
  expect(details('Radiant Burst')).toContain(
    'Area: a 75% blow to the most wounded other enemy within 1 tile of the target',
  );
  expect(details('Cataclysm')).toContain(
    'Area: 5 damage to each other enemy within 2 tiles of the target',
  );
  expect(details('Piercing Charge')).toContain(
    'Area: a 100% blow to each enemy up to 1 tile behind the target, per hit',
  );
  // Doom Thrust pierces at range 2 but its push needs it to stand next to the target.
  expect(details('Doom Thrust')).toContain('push the target back 1 tile (only when next to it)');
});
it('explains ally buffs, exclusions and duration', () => {
  // The user is left out unless the data says includeSelf.
  expect(details('Rallying Blow')).toContain(
    'On hit: allies within 2 tiles get +3 STR, +10 CRIT for 1 phase\n',
  );
});
it('exposes drawbacks, debuffs and movement', () => {
  expect(details('All or Nothing')).toContain('On miss: you lose 5 HP per missed strike');
  expect(details('Galeforce Assault')).toContain('After combat: your HP becomes 5, hit or miss');
  expect(details('Seal Speed')).toContain('On hit: target SPD -4 for the battle');
  expect(details('Hit and Run')).toContain('On hit: step back 1 tile');
  expect(details('Annihilate')).toContain('On kill: you get +4 STR, +4 SPD for 1 phase');
  expect(details('Silence Strike')).toContain('silence the target for 2 phases');
});
it('every art reads as a sheet: Cost, Needs and one flavour line with no numbers', () => {
  for (const art of arts) {
    const sheet = weaponArtSheet(art);
    const labels = sheet.map((row) => row.label);
    expect(labels[0], art.name).toBe('Cost');
    expect(sheet[0].text, art.name).toMatch(new RegExp(`^${art.hpCost} HP`));
    expect(labels, art.name).toContain('Needs');
    expect(sheet.at(-1), art.name).toEqual({ label: '', text: art.description });
    // Numbers live in the rows the data generates; flavour never restates (or contradicts) them.
    expect(art.description, art.name).not.toMatch(/\d|%/);
    expect(art.description.length, art.name).toBeLessThanOrEqual(70);
    expect(weaponArtDetailLines(art).join('\n'), art.name).not.toMatch(/undefined|NaN/);
  }
});
it('rules every art shares sit behind the weapon arts help, not on each art', () => {
  const help = WEAPON_ARTS_HELP.map((block) => helpBlockText(block)).join('\n');
  expect(help).toContain('never adds a Speed follow-up');
  expect(help).toContain('The foe still counters before you step, push or swap');
  for (const art of arts)
    expect(weaponArtDetailLines(art).join('\n'), art.name).not.toContain('follow-up');
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

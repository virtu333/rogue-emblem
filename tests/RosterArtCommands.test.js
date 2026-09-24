import { it, expect } from 'vitest';
import { bindRosterArt } from '../src/engine/RosterArtCommands.js';
const art = { id: 'new', weaponType: 'Sword', requiredRank: 'Prof' };
function fixture(ids = []) {
  const weapon = { type: 'Sword', weaponArtIds: ids, weaponArtSources: ids.map(() => 'innate') };
  const unit = { inventory: [weapon], proficiencies: [{ type: 'Sword', rank: 'Prof' }] };
  const scroll = { teachesWeaponArtId: 'new', allowedWeaponTypes: ['Sword'] };
  return { weapon, unit, scroll, run: { roster: [unit], scrolls: [scroll] } };
}
it('binds and consumes once, rejecting repeated confirmation', () => {
  const { run, unit, weapon, scroll } = fixture();
  expect(bindRosterArt(run, unit, weapon, scroll, [art]).ok).toBe(true);
  expect(weapon.weaponArtIds).toEqual(['new']);
  expect(weapon.weaponArtSources).toEqual(['scroll']);
  expect(bindRosterArt(run, unit, weapon, scroll, [art]).ok).toBe(false);
});
it('requires an explicit matching replacement and refuses stale overwrite', () => {
  const { run, unit, weapon, scroll } = fixture(['a', 'b', 'c']);
  expect(bindRosterArt(run, unit, weapon, scroll, [art]).ok).toBe(false);
  expect(
    bindRosterArt(run, unit, weapon, scroll, [art], { index: 1, id: 'stale', source: 'innate' }).ok,
  ).toBe(false);
  expect(run.scrolls).toHaveLength(1);
  expect(
    bindRosterArt(run, unit, weapon, scroll, [art], { index: 1, id: 'b', source: 'innate' }).ok,
  ).toBe(true);
  expect(weapon.weaponArtIds).toEqual(['a', 'new', 'c']);
});
it('rejects incompatible weapons and stale ownership', () => {
  const { run, unit, weapon, scroll } = fixture();
  weapon.type = 'Axe';
  expect(bindRosterArt(run, unit, weapon, scroll, [art]).ok).toBe(false);
  weapon.type = 'Sword';
  unit.inventory = [];
  expect(bindRosterArt(run, unit, weapon, scroll, [art]).ok).toBe(false);
  expect(run.scrolls).toHaveLength(1);
});

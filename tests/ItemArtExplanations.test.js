import { it, expect } from 'vitest';
import { weaponArtScrollText, weaponArtDetailLines } from '../src/ui/weaponArtDisplay.js';
import { rewardPresentation } from '../src/ui/rewardDisplay.js';
import { loadGameData } from './testData.js';
const data = loadGameData();
it('explains what Seraphim scroll grants and how to bind and activate it', () => {
  const scroll = data.weapons.find((w) => w.teachesWeaponArtId === 'magic_seraphim');
  const text = weaponArtScrollText(scroll, data.weaponArts.arts);
  expect(text).toContain('Weapon Art Scroll');
  expect(text).toContain('Tome / Light');
  expect(text).toContain('Roster → Skills → Bind to weapon');
  expect(text).toContain('consumed only after binding');
  expect(text).toContain('Base HP cost: 6');
  expect(text).toContain('2 uses per battle');
  expect(text).toContain('×3 weapon might against armored');
  expect(rewardPresentation({ type: 'rare', item: scroll }).label).toBe('Rare · Weapon Art Scroll');
  expect(rewardPresentation({ item: { type: 'Scroll', skillId: 'vantage' } }).category).toBe(
    'Skill Scroll',
  );
});
it('shows static art costs and limits without leaking previous-map usage', () => {
  const mire = data.weaponArts.arts.find((a) => a.name === 'Mire');
  const text = weaponArtDetailLines(mire).join('\n');
  expect(text).toContain(mire.description);
  expect(text).toContain(`Base HP cost: ${mire.hpCost}`);
  expect(text).toContain('Active attack');
  expect(text).not.toContain('uses left');
});

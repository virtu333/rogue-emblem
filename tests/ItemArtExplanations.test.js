import { it, expect } from 'vitest';
import {
  skillScrollText,
  weaponArtScrollText,
  weaponArtDetailLines,
} from '../src/ui/weaponArtDisplay.js';
import { rewardPresentation } from '../src/ui/rewardDisplay.js';
import { loadGameData } from './testData.js';
const data = loadGameData();
it('explains what Scouring Fire scroll grants and how to bind and activate it', () => {
  const scroll = data.weapons.find((w) => w.teachesWeaponArtId === 'magic_seraphim');
  const text = weaponArtScrollText(scroll, data.weaponArts.arts);
  const art = data.weaponArts.arts.find((a) => a.id === 'magic_seraphim');
  expect(text).toContain(
    'Weapon art scroll: binds Scouring Fire to one Tome / Light weapon for this run.',
  );
  expect(text).toContain('Use: Roster → Skills → Bind to weapon. Kept until bound.');
  expect(text).toContain(`Cost: ${art.hpCost} HP · ${art.perMapLimit} per battle`);
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
  expect(text).toContain(`Cost: ${mire.hpCost} HP`);
  expect(text).not.toContain('uses left');
});
it('a skill scroll says it teaches a skill, and a command skill says so', () => {
  const blink = data.weapons.find((w) => w.skillId === 'blink');
  const text = skillScrollText(blink, data.skills);
  expect(text.split('\n')[0]).toBe('Skill scroll: teaches Blink, a battle command, to one unit.');
  expect(text).toContain('Use: Roster → Skills → Teach. Kept until taught.');
  expect(text).toContain(data.skills.find((s) => s.id === 'blink').description);
  const sol = skillScrollText(
    data.weapons.find((w) => w.skillId === 'sol'),
    data.skills,
  );
  expect(sol.split('\n')[0]).toBe('Skill scroll: teaches Reclaim to one unit.');
});

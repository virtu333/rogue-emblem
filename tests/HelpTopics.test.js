import { describe, it, expect } from 'vitest';
import {
  attributesHelp,
  combatBaselineHelp,
  convoyHelp,
  objectiveHelp,
  terrainHelp,
  WEAPON_ARTS_HELP,
} from '../src/ui/helpTopics.js';
import { helpBlockText, helpPreview } from '../src/ui/ContextHelp.js';
import { MASTERY_HELP } from '../src/ui/rosterDisplay.js';

const axe = { name: 'Test Axe', type: 'Axe', might: 8, hit: 75, crit: 0, weight: 6 };
const unit = (weapon, stats = {}) => ({
  name: 'Bartre',
  weapon,
  stats: { HP: 30, STR: 15, MAG: 1, SKL: 5, SPD: 9, LCK: 3, DEF: 6, RES: 1, MOV: 5, ...stats },
});
const tiles = (blocks) =>
  Object.fromEntries(blocks.find((b) => b.stats).stats.map((t) => [t.label, t]));

describe('combat baseline help', () => {
  it('shows the card numbers as tiles with working that adds up', () => {
    // STR 15 → Str÷5 = 3; weight 6 − 3 = 3; AS 9 − 3 = 6; Atk 15 + 8 = 23;
    // Hit 75 + 5×2 + 3 = 88; Crit ⌊5/2⌋ + 0 = 2.
    const t = tiles(combatBaselineHelp(unit(axe), { avoid: 41 }));
    expect(t.Attack).toMatchObject({ value: 23, note: 'Str 15 + Mt 8' });
    expect(t['Atk Spd']).toMatchObject({ value: 6, note: 'Spd 9 − Wt 3' });
    expect(t.Weight).toMatchObject({ value: 3, note: 'Wt 6 − 3' });
    expect(t.Hit.value).toBe(88);
    expect(t.Crit.value).toBe(2);
    expect(t.Avoid.value).toBe(41);
  });

  it('names a weapon Speed bonus and magic Attack', () => {
    const swift = { ...axe, special: '+5 SPD when equipped' };
    expect(tiles(combatBaselineHelp(unit(swift)))['Atk Spd']).toMatchObject({
      value: 11,
      note: 'Spd 9 − Wt 3 +5',
    });
    const tome = { name: 'Fire', type: 'Tome', might: 5, hit: 90, crit: 0, weight: 4 };
    expect(tiles(combatBaselineHelp(unit(tome, { MAG: 7 }))).Attack.note).toBe('Mag 7 + Mt 5');
  });

  it('drops a note it cannot make add up, and says when nothing can attack', () => {
    const noWeight = { ...axe, weight: 0 };
    const t = tiles(combatBaselineHelp(unit(noWeight)));
    expect(t['Atk Spd'].note).toBe('');
    expect(t.Weight.note).toBe('');
    const staff = { name: 'Heal', type: 'Staff', might: 0, hit: 0, crit: 0, weight: 3 };
    expect(combatBaselineHelp(unit(staff))[0].lead).toBe(
      'Bartre has no attack weapon equipped (Heal is a staff).',
    );
    expect(combatBaselineHelp(unit(null))[0].lead).toBe('Bartre has no attack weapon equipped.');
  });

  it('Avoid defaults to Speed × 2 + Luck off a tile', () => {
    const blocks = combatBaselineHelp(unit(axe));
    expect(tiles(blocks).Avoid.value).toBe(21);
    expect(JSON.stringify(blocks)).toContain('Cover adds more');
  });
});

describe('help topics', () => {
  it('objective help leads with the goal, explains it and lists the rest', () => {
    const blocks = objectiveHelp(
      'Rout: 4 enemies remaining\nRecruit: Talk to green unit',
      'Warchief · 26/26 HP',
      'rout',
    );
    expect(blocks.slice(0, 3)).toEqual([
      { lead: 'Rout: 4 enemies remaining' },
      { points: ['Defeat every enemy on the map.', 'Recruit: Talk to green unit'] },
      { title: 'Boss', points: ['Warchief · 26/26 HP'] },
    ]);
    expect(blocks[3].tip).toMatch(/commander falls, the run ends/);
    // Escape's label already carries its rules; no goal line is added.
    const escape = objectiveHelp(
      'Escape: Only Lords must exit (0/1)\nMove onto an EXIT tile, then choose Escape.',
      '',
      'escape',
    );
    expect(escape[1]).toEqual({ points: ['Move onto an EXIT tile, then choose Escape.'] });
  });

  it('terrain help shows signed bonuses and blocked movement', () => {
    const mountain = {
      special: 'Infantry & Flying only',
      defBonus: '2',
      avoidBonus: '30',
      moveCost: { Infantry: '3', Cavalry: '--' },
    };
    const t = tiles(terrainHelp(mountain, 'Cavalry'));
    expect([t.Defense.value, t.Avoid.value, t['Move cost'].value]).toEqual(['+2', '+30', '✕']);
    expect(tiles(terrainHelp({ avoidBonus: '-10', moveCost: { Infantry: '1' } })).Avoid.value).toBe(
      '−10',
    );
  });

  it('attributes list every stat by name', () => {
    const points = attributesHelp()[0].points;
    expect(points.map((p) => p.term)).toEqual([
      'HP',
      'Strength',
      'Magic',
      'Skill',
      'Speed',
      'Defense',
      'Resistance',
      'Luck',
      'Movement',
    ]);
    expect(points.find((p) => p.term === 'Strength').text).toBe('Physical attack power.');
  });

  it('previews read the first line of structured help', () => {
    expect(helpPreview(MASTERY_HELP)).toBe(MASTERY_HELP[0].lead);
    expect(helpPreview(['plain first', { lead: 'x' }])).toBe('plain first');
    expect(helpBlockText({ points: [{ term: 'Store', text: 'moves it.' }] })).toBe(
      'Store: moves it.',
    );
  });

  // The point of the redesign: short lines a phone reader can scan.
  it('keeps every line short', () => {
    const all = [
      ...combatBaselineHelp(unit(axe), { avoid: 41 }),
      ...attributesHelp(),
      ...WEAPON_ARTS_HELP,
      ...convoyHelp({ weapons: 5, consumables: 3 }),
      ...MASTERY_HELP,
    ];
    const lines = all.flatMap((b) =>
      b.points ? b.points.map((p) => helpBlockText({ points: [p] })) : [helpBlockText(b)],
    );
    for (const line of lines) expect(line.length, line).toBeLessThanOrEqual(100);
  });
});

import { describe, expect, it } from 'vitest';
import { battleItemBrief, battleItemSummary } from '../src/ui/battleItemSummary.js';

describe('battleItemSummary', () => {
  it('includes weapon mechanics instead of showing only stats', () => {
    const text = battleItemSummary({
      name: 'Rapier',
      type: 'Sword',
      might: 5,
      hit: 95,
      crit: 10,
      weight: 2,
      range: '1',
      special: 'Effective vs Armored/Cavalry (2x)',
    });

    expect(text).toContain('Might 5 · Hit 95 · Crit 10');
    expect(text).toContain('Effective vs Armored/Cavalry (2x)');
  });

  it('shows staff mechanics and MAG-adjusted range', () => {
    const text = battleItemSummary(
      {
        name: 'Physic',
        type: 'Staff',
        range: '2',
        uses: 1,
        perBattleUses: true,
        special: 'Ranged heal, MAG + 5 HP',
        rangeBonuses: [
          { mag: 10, bonus: 1 },
          { mag: 18, bonus: 1 },
        ],
      },
      { stats: { MAG: 18 } },
    );

    expect(text).toContain('Ranged heal, MAG + 5 HP');
    expect(text).toContain('Range 2-4');
    expect(text).toContain('Refills each battle');
  });
});

describe('battleItemBrief (one line per menu row; the rest on a long press)', () => {
  const handAxe = {
    name: 'Hand Axe',
    type: 'Axe',
    might: 5,
    hit: 65,
    crit: 0,
    weight: 8,
    range: '1-2',
    special: 'Throwable, lower stats',
  };
  it('keeps the numbers that decide a pick and marks an effect with ✦', () => {
    expect(battleItemBrief(handAxe)).toBe('Mt 5 · Hit 65 · Rng 1-2 ✦');
    // weight and the effect text live in the full detail
    expect(battleItemSummary(handAxe)).toContain('Weight 8');
    expect(battleItemSummary(handAxe)).toContain('Throwable, lower stats');
  });
  it('shows crit only when the weapon has some, and no ✦ without an effect', () => {
    expect(
      battleItemBrief({
        name: 'Killing Edge',
        type: 'Sword',
        might: 9,
        hit: 75,
        crit: 30,
        range: '1',
      }),
    ).toBe('Mt 9 · Hit 75 · Crt 30 · Rng 1');
  });
  it('is far shorter than the full detail for every weapon in the game', async () => {
    const { loadGameData } = await import('./testData.js');
    const weapons = loadGameData().weapons.filter((w) => !['Staff', 'Scroll'].includes(w.type));
    expect(weapons.length).toBeGreaterThan(50);
    for (const w of weapons) {
      const brief = battleItemBrief(w);
      expect(brief, w.name).not.toContain('\n');
      expect(brief.length, w.name).toBeLessThanOrEqual(36);
    }
  });
  it('briefs consumables and staves by what they do and what is left', () => {
    expect(
      battleItemBrief({ name: 'Vulnerary', type: 'Consumable', effect: 'heal', value: 10 }),
    ).toBe('Restore 10 HP');
    expect(
      battleItemBrief(
        { name: 'Heal', type: 'Staff', range: '1', uses: 3, perBattleUses: true },
        { stats: { MAG: 5 } },
      ),
    ).toMatch(/^Rng 1 · \d+\/\d+ uses$/);
    expect(battleItemBrief(null)).toBe('');
  });
});

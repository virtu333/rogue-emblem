import { describe, expect, it } from 'vitest';
import { battleItemSummary } from '../src/ui/battleItemSummary.js';

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

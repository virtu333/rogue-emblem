// itemDetailText: the one text of what an item does, read by the shop's detail pane and
// the battle rewards' detail sheet (so a legendary's special and art reach both).
import { describe, expect, it } from 'vitest';
import { loadGameData } from './testData.js';
import { itemDetailText } from '../src/ui/itemDetailView.js';

const data = loadGameData();
const weapon = (name) => structuredClone(data.weapons.find((w) => w.name === name));

describe('itemDetailText', () => {
  it('a legendary bow names its numbers, its special and its weapon art', () => {
    const text = itemDetailText({ item: weapon('Starfall') }, data);
    const lines = text.split('\n');
    expect(lines.slice(0, 4)).toEqual([
      'Bow',
      'Mt: 12   Hit: 90   Crt: 10',
      'Wt: 7   Rng: 2-3',
      'Special: Extended range',
    ]);
    expect(lines.slice(4).join('\n')).toContain('Starfall Volley');
  });

  it("Hermit's Bow states its condition", () => {
    expect(itemDetailText({ item: weapon("Hermit's Bow") }, data)).toContain(
      'Special: +4 STR, +4 SPD if no adjacent allies',
    );
  });

  it('a consumable says what it does and its uses; a stone its forge', () => {
    const vulnerary = structuredClone(data.consumables.find((c) => c.name === 'Vulnerary'));
    const text = itemDetailText({ item: vulnerary }, data);
    expect(text).toMatch(/\(\d+\/\d+ uses?\)$|\(\d+ uses?\)$/);
    expect(
      itemDetailText(
        { item: { name: 'Might Whetstone', type: 'Whetstone', forgeStat: 'might' } },
        data,
      ),
    ).toBe('Forge: +1 Mt');
  });
});

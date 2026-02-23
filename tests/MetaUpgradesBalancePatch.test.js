import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';

const upgrades = JSON.parse(readFileSync('data/metaUpgrades.json', 'utf8'));
const byId = new Map(upgrades.map((upgrade) => [upgrade.id, upgrade]));

describe('meta upgrades rebalance patch guards', () => {
  const cases = [
    {
      id: 'battle_gold',
      costs: [125, 325],
      description: '+10% battle gold per level',
      effects: [{ battleGoldMultiplier: 0.1 }, { battleGoldMultiplier: 0.2 }],
    },
    {
      id: 'roster_cap',
      costs: [175],
      description: '+3 max roster size',
      effects: [{ rosterCapBonus: 3 }],
      requires: {
        milestones: ['beatAct1'],
      },
    },
    { id: 'vision_charges_2', costs: [200] },
    {
      id: 'vision_charges_3',
      costs: [350],
      requires: {
        upgrades: [{ id: 'vision_charges_2', level: 1 }],
      },
    },
    { id: 'weapon_forge', costs: [150, 325, 550] },
    { id: 'starting_accessory', costs: [100, 300, 500] },
    {
      id: 'weapon_tier_silver',
      costs: [600],
      requires: {
        upgrades: [{ id: 'weapon_tier', level: 1 }],
      },
    },
    {
      id: 'recruit_field_supplies',
      costs: [375],
      requires: {
        upgrades: [{ id: 'starting_vulnerary', level: 1 }],
      },
    },
    { id: 'extra_skill_slot', costs: [750] },
  ];

  it('validates all targeted upgrade costs/effects/prerequisites', () => {
    for (const expected of cases) {
      const upgrade = byId.get(expected.id);
      expect(upgrade, `missing upgrade ${expected.id}`).toBeTruthy();
      expect(upgrade.costs, `${expected.id} costs`).toEqual(expected.costs);

      if (expected.description) {
        expect(upgrade.description, `${expected.id} description`).toBe(expected.description);
      }
      if (expected.effects) {
        expect(upgrade.effects, `${expected.id} effects`).toEqual(expected.effects);
      }
      if (expected.requires) {
        expect(upgrade.requires, `${expected.id} requires`).toEqual(expected.requires);
      }
    }
  });
});

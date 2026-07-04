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
    // 2026-07-04 lord upgrade cost rebalance: lord growth/flat upgrades cost
    // ~1.5x their previous curves so cheap early meta purchases favor the
    // roster (recruit upgrades) over the lord stat-check treadmill.
    { id: 'lord_hp_growth', costs: [75, 80, 105, 130, 210] },
    { id: 'lord_str_growth', costs: [75, 110, 190, 265, 375] },
    { id: 'lord_def_growth', costs: [75, 110, 190, 265, 375] },
    { id: 'lord_spd_growth', costs: [75, 110, 190, 265, 415] },
    { id: 'lord_skl_growth', costs: [75, 110, 150, 190, 300] },
    { id: 'lord_res_growth', costs: [75, 110, 150, 190, 300] },
    { id: 'lord_hp_flat', costs: [190, 450, 875] },
    { id: 'lord_str_flat', costs: [190, 500, 1025] },
    { id: 'lord_def_flat', costs: [190, 500, 1025] },
    { id: 'lord_spd_flat', costs: [190, 525, 1100] },
    { id: 'lord_skl_flat', costs: [190, 425, 750] },
    { id: 'lord_res_flat', costs: [190, 425, 750] },
    // Identity purchases stay untouched by the rebalance.
    { id: 'legendary_heir', costs: [1000, 500, 250, 750] },
    { id: 'commander_choice', costs: [1500] },
    { id: 'partner_choice', costs: [1000] },
    // 2026-07-04 recruit-focused capacity upgrades.
    {
      id: 'recruit_xp',
      costs: [350, 700],
      effects: [{ recruitXpBonus: 0.1 }, { recruitXpBonus: 0.2 }],
    },
    {
      id: 'recruit_accessory',
      costs: [650],
      effects: [{ recruitStartingAccessory: 1 }],
      requires: {
        milestones: ['beatAct1'],
      },
    },
    {
      id: 'recruit_weapon_forge',
      costs: [800, 1400],
      effects: [{ recruitWeaponForge: 1 }, { recruitWeaponForge: 2 }],
      requires: {
        upgrades: [{ id: 'lethal_armory', level: 1 }],
        milestones: ['beatAct1'],
      },
    },
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

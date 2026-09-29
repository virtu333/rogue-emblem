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
    { id: 'vision_charges_2', costs: [200] },
    {
      id: 'vision_charges_3',
      costs: [350],
      requires: {
        upgrades: [{ id: 'vision_charges_2', level: 1 }],
      },
    },
    { id: 'weapon_forge', costs: [150, 250, 400] },
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
      costs: [125],
      requires: {
        upgrades: [{ id: 'starting_vulnerary', level: 1 }],
      },
    },
    { id: 'extra_skill_slot', costs: [750] },
    // 2026-09-27 stat upgrade value pricing: every lord/recruit stat track is
    // priced as (value weight x a shared escalating curve), so buying the next
    // tier of any stat is roughly equally worth it. Weights (DEF = 1): SPD 1.15,
    // STR 0.8, HP 0.55 growth / 0.85 flat, RES 0.45, MAG 0.4, SKL 0.4, LCK 0.35.
    // Measured with sim/metaStatValue.js.
    { id: 'lord_spd_growth', costs: [105, 150, 260, 365, 570] },
    { id: 'lord_def_growth', costs: [90, 130, 230, 320, 495] },
    { id: 'lord_str_growth', costs: [70, 105, 180, 255, 400] },
    { id: 'lord_hp_growth', costs: [50, 70, 125, 175, 275] },
    { id: 'lord_mag_growth', costs: [50, 55, 90, 125, 200] },
    { id: 'lord_res_growth', costs: [50, 60, 100, 145, 225] },
    { id: 'lord_skl_growth', costs: [50, 55, 90, 125, 200] },
    { id: 'lord_lck_growth', costs: [50, 55, 80, 110, 175] },
    { id: 'lord_spd_flat', costs: [250, 695, 1460] },
    { id: 'lord_def_flat', costs: [220, 605, 1270] },
    { id: 'lord_str_flat', costs: [175, 485, 1015] },
    { id: 'lord_hp_flat', costs: [185, 515, 1080] },
    { id: 'lord_mag_flat', costs: [125, 240, 510] },
    { id: 'lord_res_flat', costs: [125, 275, 570] },
    { id: 'lord_skl_flat', costs: [125, 240, 510] },
    { id: 'lord_lck_flat', costs: [125, 210, 445] },
    { id: 'recruit_spd_growth', costs: [65, 85, 130, 175, 260] },
    { id: 'recruit_def_growth', costs: [55, 75, 115, 155, 225] },
    { id: 'recruit_str_growth', costs: [45, 60, 90, 120, 180] },
    { id: 'recruit_hp_growth', costs: [35, 40, 60, 85, 125] },
    { id: 'recruit_mag_growth', costs: [35, 40, 45, 60, 90] },
    { id: 'recruit_res_growth', costs: [35, 40, 50, 70, 100] },
    { id: 'recruit_skl_growth', costs: [35, 40, 45, 60, 90] },
    { id: 'recruit_lck_growth', costs: [35, 40, 45, 55, 80] },
    { id: 'recruit_spd_flat', costs: [150, 365, 760] },
    { id: 'recruit_def_flat', costs: [130, 315, 660] },
    { id: 'recruit_str_flat', costs: [105, 255, 530] },
    { id: 'recruit_hp_flat', costs: [110, 270, 560] },
    { id: 'recruit_mag_flat', costs: [90, 125, 265] },
    { id: 'recruit_res_flat', costs: [90, 145, 295] },
    { id: 'recruit_skl_flat', costs: [90, 125, 265] },
    { id: 'recruit_lck_flat', costs: [90, 110, 230] },
    // Identity purchases stay untouched by the rebalance.
    { id: 'legendary_heir', costs: [1000, 500, 250, 750] },
    { id: 'commander_choice', costs: [1500] },
    { id: 'partner_choice', costs: [1000] },
    // 2026-07-04 recruit-focused capacity upgrades (halved 2026-09-29, below).
    {
      id: 'recruit_xp',
      costs: [175, 350],
      effects: [{ recruitXpBonus: 0.1 }, { recruitXpBonus: 0.2 }],
    },
    {
      id: 'recruit_accessory',
      costs: [325],
      effects: [{ recruitStartingAccessory: 1 }],
      requires: {
        milestones: ['beatAct1'],
      },
    },
    {
      id: 'recruit_weapon_forge',
      costs: [200, 350],
      effects: [{ recruitWeaponForge: 1 }, { recruitWeaponForge: 2 }],
      requires: {
        upgrades: [{ id: 'lethal_armory', level: 1 }],
        milestones: ['beatAct1'],
      },
    },
    // 2026-09-29 playtest: the Battalion tab (recruit power) at half price, and the
    // extra deploy slot cheaper still, open after Act 1.
    {
      id: 'deploy_limit',
      costs: [150],
      effects: [{ deployBonus: 1 }],
      requires: { milestones: ['beatAct1'] },
    },
    { id: 'recruit_skill', costs: [250] },
    { id: 'veteran_recruits', costs: [125, 225, 350] },
    { id: 'extra_starting_unit_pool', costs: [200, 350, 500, 750] },
    { id: 'lethal_armory', costs: [250] },
    { id: 'lethal_armory_killer', costs: [300] },
    { id: 'lethal_armory_silver', costs: [450] },
    { id: 'master_of_arms', costs: [175] },
  ];

  it('prices every stat track by value: no weaker stat costs more than a stronger one', () => {
    // Value order within each group/kind, strongest first.
    const order = {
      growth: ['SPD', 'DEF', 'STR', 'HP', 'RES', 'MAG', 'SKL', 'LCK'],
      flat: ['SPD', 'DEF', 'HP', 'STR', 'RES', 'MAG', 'SKL', 'LCK'],
    };
    for (const group of ['lord', 'recruit']) {
      for (const [kind, stats] of Object.entries(order)) {
        const costsOf = (stat) => byId.get(`${group}_${stat.toLowerCase()}_${kind}`).costs;
        for (let i = 1; i < stats.length; i++) {
          const stronger = costsOf(stats[i - 1]);
          costsOf(stats[i]).forEach((cost, t) => {
            expect(cost, `${group} ${kind} ${stats[i]} tier ${t + 1}`).toBeLessThanOrEqual(
              stronger[t],
            );
          });
        }
        // SPD is worth more than DEF (offense and defense), so it costs more in total.
        const total = (stat) => costsOf(stat).reduce((a, b) => a + b, 0);
        expect(total('SPD')).toBeGreaterThan(total('DEF'));
        for (const stat of stats) {
          const costs = costsOf(stat);
          for (let t = 1; t < costs.length; t++) expect(costs[t]).toBeGreaterThan(costs[t - 1]);
        }
      }
    }
  });

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

  it('the Battalion tree: twelve upgrades, 5,600 Supply in all, and no Expanded Ranks', () => {
    const battalion = upgrades.filter((u) => u.category === 'capacity');
    expect(battalion.map((u) => u.id).sort()).toEqual(
      [
        'deploy_limit',
        'extra_starting_unit_pool',
        'lethal_armory',
        'lethal_armory_killer',
        'lethal_armory_silver',
        'master_of_arms',
        'recruit_accessory',
        'recruit_field_supplies',
        'recruit_skill',
        'recruit_weapon_forge',
        'recruit_xp',
        'veteran_recruits',
      ].sort(),
    );
    // 150 + 250 + 125 + 700 + 1800 + 250 + 300 + 450 + 175 + 525 + 325 + 550
    const total = battalion.reduce((sum, u) => sum + u.costs.reduce((a, b) => a + b, 0), 0);
    expect(total).toBe(5600);
    // The roster has no cap, so nothing sells a bigger one.
    expect(byId.has('roster_cap')).toBe(false);
    for (const u of upgrades)
      for (const effect of u.effects || []) expect(effect).not.toHaveProperty('rosterCapBonus');
  });
});

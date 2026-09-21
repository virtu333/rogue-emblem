import reference from '../../data/referenceViewer.json';
import {
  BASE_CLASS_LEVEL_CAP,
  PROMOTED_CLASS_LEVEL_CAP,
  PROMOTION_MIN_LEVEL,
  WEAPON_TRIANGLE,
} from '../utils/constants.js';

// Detailed reference copy has a different job from the roster's short tooltips.
export function statReferenceEntries(gameData = {}) {
  const row = (name, type, role, rule, progression) => ({
    name,
    type,
    referenceLines: [role, rule, progression],
    description: [role, rule, progression].join(' '),
  });
  const raise = (stat) => {
    const boosters = (gameData.consumables || []).filter(
      (i) => i.effect === 'statBoost' && i.stat === stat,
    );
    const items = boosters.map((i) => `${i.name} +${i.value}`).join(' · ');
    return `${stat === 'MOV' ? 'Promotion bonuses' : 'Level-up growth'}${items ? ` · ${items}` : ' · No dedicated consumable booster'}.`;
  };
  const core = [
    [
      'HP — Health',
      'HP',
      'Life remaining. At 0 HP, a unit falls; losing a lord can end the run.',
      'Some weapon arts spend HP. Healing restores current HP up to its maximum.',
    ],
    [
      'STR — Strength',
      'STR',
      'Physical attack power and weapon handling.',
      'Physical Atk = STR + weapon Might + bonuses. Every 5 STR offsets 1 weapon Weight.',
    ],
    [
      'MAG — Magic',
      'MAG',
      'Magic attack power and staff potency.',
      'Magic Atk = MAG + Might. Healing uses MAG + staff base. Staff capacity gains +1 use at MAG 8, 14 and 20; some staves also gain range.',
    ],
    [
      'SKL — Skill',
      'SKL',
      'Accuracy, critical hits and many skill activations.',
      'Each SKL adds 2 Hit. Base Crit includes floor(SKL / 2). Activation chances depend on the skill.',
    ],
    [
      'SPD — Speed',
      'SPD',
      'Dodging and double attacks.',
      'Base Avoid = SPD × 2 + LCK. Attack Speed also accounts for weapon Weight; double at least 5 AS above the foe.',
    ],
    [
      'DEF — Defense',
      'DEF',
      'Reduces physical damage.',
      'Physical damage = attack power − DEF − applicable terrain defense, minimum 0, before other effects.',
    ],
    [
      'RES — Resistance',
      'RES',
      'Reduces magical damage.',
      'Magical damage uses RES instead of DEF. Weapon and skill effects may change which defense applies.',
    ],
    [
      'LCK — Luck',
      'LCK',
      'Accuracy, dodging and protection against critical hits.',
      'Each LCK adds 1 Hit and 1 Avoid, and subtracts 1 from enemy Crit. Some skills use LCK-based activation chances.',
    ],
    [
      'MOV — Movement',
      'MOV',
      'Movement budget each turn.',
      'Terrain costs depend on move type. MOV never grows on level-up, including extended levels.',
    ],
  ].map(([name, stat, role, rule]) => row(name, 'Core', role, rule, raise(stat)));
  const triangle = WEAPON_TRIANGLE;
  const derived = [
    row(
      'Attack (Atk)',
      'Derived',
      reference.combat.atkFormula,
      reference.combat.effectiveDamageRule,
      `Triangle advantage: +${triangle.advantage.damage} Atk (+${triangle.masteryAdvantage.damage} at Mast). Disadvantage: ${triangle.disadvantage.damage} Atk, also at Mast. Other combat effects can modify damage.`,
    ),
    row(
      'Attack Speed (AS)',
      'Derived',
      reference.combat.asFormula,
      reference.combat.doublingRule,
      'Heavy weapons can cost double attacks. This weight penalty affects AS, not the base SPD used for Avoid.',
    ),
    row(
      'Hit',
      'Derived',
      'Base Hit = weapon Hit + SKL × 2 + LCK.',
      'Forecast Hit subtracts enemy Avoid and includes combat modifiers (0–100). Attacks average two rolls for both sides: 75 Hit succeeds about 87.5% of the time; 25 Hit about 12.5%. Crit and skill chances use one roll.',
      `Triangle: +${triangle.advantage.hit} / ${triangle.disadvantage.hit} Hit at Prof; +${triangle.masteryAdvantage.hit} / ${triangle.masteryDisadvantage.hit} at Mast.`,
    ),
    row(
      'Avoid',
      'Derived',
      'Base Avoid = SPD × 2 + LCK + terrain Avoid.',
      'Flying units do not receive terrain bonuses. Skills, accessories and combat effects can further change Avoid.',
      'Compare enemy Hit against your Avoid when choosing where to stand.',
    ),
    row(
      'Crit / Crit Avoid',
      'Derived',
      'Base Crit = floor(SKL / 2) + weapon Crit − enemy LCK.',
      'Forecast Crit includes combat modifiers and is clamped to 0–100%. Bosses have an additional 15-point crit reduction.',
      'A critical hit normally deals 3× damage. Skills and accessories can modify or prevent critical hits.',
    ),
  ];
  const growth = [
    row(
      'Growth Rates',
      'Growth',
      'Personal growth rates are rolled once from class ranges when a unit is created.',
      'Two recruits of the same class can grow differently. Lords add their personal growth bonuses to the class roll.',
      'Growth is the chance of a +1 on a normal level-up. MOV has no level-up growth.',
    ),
    row(
      'Level-Up',
      'Growth',
      'HP, STR, MAG, SKL, SPD, DEF, RES and LCK roll independently against their growth rates.',
      'If no stat succeeds, the highest-growth stat gains +1 instead. A normal level-up cannot be empty.',
      `Normal level caps: ${BASE_CLASS_LEVEL_CAP} base / ${PROMOTED_CLASS_LEVEL_CAP} promoted. Each stat gains at most +1 per normal level-up.`,
    ),
    row(
      'Promotion',
      'Growth',
      `Eligible base classes can use a Master Seal at level ${PROMOTION_MIN_LEVEL} or higher.`,
      'Promotion applies class stat bonuses (sometimes MOV), may improve growths, resets level to 1, and grants class-innate skills.',
      'When extended leveling is enabled, promoted units past 20 gain 20+N levels: +1 to a random non-MOV stat, ignoring growth rates.',
    ),
    row(
      'Stat Boosters & Meta',
      'Growth',
      'Stat boosters permanently raise a stat and are consumed on use.',
      'Recruit-growth upgrades add 5 percentage points per tier, up to 25. Recruitment stat/growth bonuses apply to newly created recruits, not retroactively.',
      'Other upgrades have their own scope. Stat gains are not subject to a general stat cap; level limits and extended-level rules still apply.',
    ),
  ];
  return [...core, ...derived, ...growth];
}

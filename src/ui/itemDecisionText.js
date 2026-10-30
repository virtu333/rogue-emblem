import { applyForge, forgeSlots } from '../engine/ForgeSystem.js';
import { nextRepairStat, repairWeapon } from '../engine/WeaponWear.js';
import { getStaticCombatStats } from '../engine/Combat.js';
import { rankRequirementText } from './rosterDisplay.js';

/**
 * The shop header's rank line. Skill scrolls carry a `rankRequired` field but
 * teach any unit, so they show none; the wording is `rankRequirementText`'s.
 */
export function shopRequirementLabel(item) {
  if (!item?.rankRequired || item.type === 'Scroll') return '';
  return rankRequirementText(item.type, item.rankRequired);
}

/** Show the wielder's combat baseline after forging a detached weapon copy. */
export function forgeImpactLine(owner, weapon, key) {
  if (!owner || !weapon) return '';
  const next = structuredClone(weapon);
  if (!applyForge(next, key).success) return '';
  return impactLine(owner, weapon, next, key);
}

/** The same line for a repair: the baseline after the weapon's last wear step is mended. */
export function repairImpactLine(owner, weapon) {
  if (!owner || !weapon) return '';
  const key = nextRepairStat(weapon);
  const next = structuredClone(weapon);
  if (!key || !repairWeapon(next).success) return '';
  return impactLine(owner, weapon, next, key);
}

const IMPACT_FIELDS = {
  might: [['atk', 'Attack']],
  hit: [['hit', 'Hit']],
  crit: [['crit', 'Crit']],
  weight: [
    ['atk', 'Attack'],
    ['as', 'AS'],
  ],
};

function impactLine(owner, weapon, next, key) {
  const before = getStaticCombatStats(owner, weapon);
  const after = getStaticCombatStats(owner, next);
  return (IMPACT_FIELDS[key] || [])
    .map(([stat, label]) => `${label} ${before[stat]} → ${after[stat]}`)
    .join(' · ');
}

/** " · Attack 9 → 10" for a forge row, or "" when there is no owner or no change to show. */
export function forgeImpactSuffix(owner, weapon, key) {
  const line = forgeImpactLine(owner, weapon, key);
  return line ? ` · ${line}` : '';
}

/** " · Attack 8 → 9" for a repair, or "" when there is no owner or no change to show. */
export function repairImpactSuffix(owner, weapon) {
  const line = repairImpactLine(owner, weapon);
  return line ? ` · ${line}` : '';
}

/**
 * The forge's impact line as comparison segments (equipmentComparison.comparisonFragment): each
 * change green when it rises, red when it falls; [] when there is no owner or the forge fails.
 */
export function forgeImpactSegments(owner, weapon, key) {
  if (!owner || !weapon) return [];
  const next = structuredClone(weapon);
  if (!applyForge(next, key).success) return [];
  const before = getStaticCombatStats(owner, weapon);
  const after = getStaticCombatStats(owner, next);
  return (IMPACT_FIELDS[key] || []).flatMap(([stat, label], i) => [
    ...(i ? [{ text: ' · ', better: null }] : []),
    {
      text: `${label} ${before[stat]} → ${after[stat]}`,
      better: after[stat] === before[stat] ? null : after[stat] > before[stat],
    },
  ]);
}

const changeRow = (label, before, after, { lowerIsBetter = false, neutral = false } = {}) => ({
  label,
  before,
  after,
  better: before === after || neutral ? null : lowerIsBetter ? after < before : after > before,
});

/**
 * What a forge of `key` changes, laid out for a table (equipmentComparison.changeTable): the
 * weapon's numbers, the owner's combat numbers with it, and its forge slots. With no `key` (a
 * choice not made yet) or a forge that cannot happen, every row is unchanged.
 */
export function forgeChangeSections(owner, weapon, key) {
  if (!weapon) return [];
  const next = structuredClone(weapon);
  const after = key && applyForge(next, key).success ? next : weapon;
  const sections = [
    {
      title: 'Weapon',
      rows: [
        changeRow('Might', weapon.might, after.might),
        changeRow('Hit', weapon.hit, after.hit),
        changeRow('Crit', weapon.crit, after.crit),
        changeRow('Weight', weapon.weight, after.weight, { lowerIsBetter: true }),
      ],
    },
  ];
  if (owner?.stats) {
    const b = getStaticCombatStats(owner, weapon);
    const a = getStaticCombatStats(owner, after);
    sections.push({
      title: owner.name,
      rows: [
        changeRow('Attack', b.atk, a.atk),
        changeRow('Hit', b.hit, a.hit),
        changeRow('Crit', b.crit, a.crit),
        changeRow('Speed', b.as, a.as),
      ],
    });
  }
  const s0 = forgeSlots(weapon);
  const s1 = forgeSlots(after);
  const rows = [changeRow('Forges', `${s0.total}/${s0.max}`, `${s1.total}/${s1.max}`)];
  if (s0.total !== s1.total) rows[0].better = s1.total > s0.total;
  if (s0.asleep || s1.asleep) {
    rows.push(changeRow('Awake', s0.awake, s1.awake));
    // A forge woken early is taken now instead of at an act start: no gain, no loss.
    rows.push(changeRow('Asleep', s0.asleep, s1.asleep, { neutral: true }));
  }
  sections.push({ title: 'Forges', rows });
  return sections;
}

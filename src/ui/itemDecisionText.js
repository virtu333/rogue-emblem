import { applyForge } from '../engine/ForgeSystem.js';
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

function impactLine(owner, weapon, next, key) {
  const before = getStaticCombatStats(owner, weapon);
  const after = getStaticCombatStats(owner, next);
  const fields = {
    might: [['atk', 'Attack']],
    hit: [['hit', 'Hit']],
    crit: [['crit', 'Crit']],
    weight: [
      ['atk', 'Attack'],
      ['as', 'AS'],
    ],
  };
  return (fields[key] || [])
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

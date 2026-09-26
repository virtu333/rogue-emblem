import { applyForge } from '../engine/ForgeSystem.js';
import { getStaticCombatStats } from '../engine/Combat.js';

export function shopRequirementLabel(item) {
  if (!item?.rankRequired || item.type === 'Scroll') return '';
  return `Requires ${item.type} ${item.rankRequired === 'Mast' ? 'Master ' : ''}rank`;
}

/** Show the wielder's combat baseline after forging a detached weapon copy. */
export function forgeImpactLine(owner, weapon, key) {
  if (!owner || !weapon) return '';
  const next = structuredClone(weapon);
  if (!applyForge(next, key).success) return '';
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

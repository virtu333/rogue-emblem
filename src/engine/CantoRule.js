import defaults from '../../data/skills.json' with { type: 'json' };
import { isRooted } from './StatusConditionSystem.js';
import { effectiveSkills } from './EffectiveSkills.js';

// Skill data owns the movement rule. A root overrides every Canto skill.
export function cantoRuleFor(unit, skillsData = defaults) {
  if (!unit || isRooted(unit)) return null;
  const rules = effectiveSkills(unit).map(
    (id) => skillsData?.find((skill) => skill.id === id)?.cantoRule,
  );
  if (rules.includes('any')) return 'any';
  return rules.includes('noncombat') ? 'noncombat' : null;
}

/**
 * How far a unit may move after acting: the movement it has left, scaled by the best
 * Canto skill it holds that applies to this action (a skill's `cantoShare`, default 1,
 * rounded down: Parting Step, half_canto, turns 5 left into 2). 0 means no Canto. `noncombat` skills
 * apply only when the action was not a fight; a root stops every one.
 */
export function cantoAllowance(
  unit,
  remaining,
  { afterCombat = false } = {},
  skillsData = defaults,
) {
  if (!unit || isRooted(unit)) return 0;
  const left = Math.max(0, Math.floor(Number(remaining) || 0));
  let best = 0;
  for (const id of effectiveSkills(unit)) {
    const skill = skillsData?.find((s) => s.id === id);
    const rule = skill?.cantoRule;
    if (rule !== 'any' && !(rule === 'noncombat' && !afterCombat)) continue;
    const share = Number(skill.cantoShare ?? 1);
    if (!(share > 0)) continue;
    best = Math.max(best, Math.floor(left * Math.min(1, share)));
  }
  return best;
}

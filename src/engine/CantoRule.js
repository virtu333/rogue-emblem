import defaults from '../../data/skills.json' with { type: 'json' };
import { isRooted } from './StatusConditionSystem.js';

// Skill data owns the movement rule. A root overrides every Canto skill.
export function cantoRuleFor(unit, skillsData = defaults) {
  if (!unit || isRooted(unit)) return null;
  const rules = (unit.skills || []).map(
    (id) => skillsData?.find((skill) => skill.id === id)?.cantoRule,
  );
  if (rules.includes('any')) return 'any';
  return rules.includes('noncombat') ? 'noncombat' : null;
}

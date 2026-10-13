import {
  getClassChangeWeaponGrants,
  planClassChangeWeaponGrants,
} from '../engine/RosterCommands.js';
import {
  promoteUnit,
  normalizeUnitClassState,
  getReclassStats,
  applyReclassSkills,
  canEquip,
  getCombatWeapons,
  getSkillDisplayNames,
} from '../engine/UnitManager.js';
import { XP_STAT_NAMES, INVENTORY_MAX } from '../utils/constants.js';
import { slotCountsLine } from '../engine/SkillSlots.js';

// Preview a clone with deterministic rules only. Never roll growths, grant
// item UIDs, or consume gameplay RNG merely by browsing classes. `run` is the run whose
// convoy takes a starter weapon the bag cannot (left out, such a weapon reads as lost).
export function classChangePreview(unit, item, target, gameData, run = null) {
  const projected = structuredClone(unit);
  const promoting = item.effect === 'promote';
  let result;
  if (promoting) {
    const bonuses =
      gameData.lords?.find((l) => l.name === unit.name)?.promotionBonuses ||
      target.promotionBonuses;
    if (!bonuses) return 'Promotion data missing.';
    result = promoteUnit(projected, target, bonuses, gameData.skills);
  } else {
    const old = gameData.classes.find((c) => c.name === unit.className);
    projected.stats = getReclassStats(unit, target, old, gameData.classes, gameData.traits || null);
    projected.className = target.name;
    normalizeUnitClassState(projected, target);
    result = applyReclassSkills(projected, gameData.classes, gameData.skills);
  }
  const lines = [
    `${unit.className} → ${target.name}`,
    `Uses 1 ${item.name || 'seal'} charge on Confirm. Cancel uses nothing.`,
    promoting
      ? 'Level resets to 1; XP resets to 0.'
      : 'Level and XP are preserved; HP keeps its proportion.',
    '',
    'Stats',
    [...XP_STAT_NAMES, 'MOV']
      .map((stat) => `${stat} ${unit.stats[stat] || 0} → ${projected.stats[stat] || 0}`)
      .join(' · '),
    '',
    'Weapons',
    `${unit.proficiencies.map((p) => `${p.type} ${p.rank}`).join(', ')} → ${projected.proficiencies.map((p) => `${p.type} ${p.rank}`).join(', ')}`,
  ];
  if (unit.moveType !== projected.moveType)
    lines.push(`Movement: ${unit.moveType} → ${projected.moveType}`);
  const previousTypes = new Set(unit.proficiencies.map((p) => p.type));
  const grants = getClassChangeWeaponGrants(projected, previousTypes, gameData);
  const plan = planClassChangeWeaponGrants(run, unit, grants, INVENTORY_MAX);
  const available = plan.bag;
  for (const weapon of grants) {
    if (plan.bag.includes(weapon)) lines.push(`Starter weapon: ${weapon.name}`);
    else if (plan.convoy.includes(weapon))
      lines.push(`Bag full: ${weapon.name} goes to the convoy.`);
    else
      lines.push(
        `Bag and convoy full: ${weapon.name} cannot be granted. Make room before confirming.`,
      );
  }
  const retained = unit.weapon && canEquip(projected, unit.weapon) ? unit.weapon : null;
  const replacement =
    getCombatWeapons(projected)[0] ||
    available.find((w) => w.type !== 'Staff' && canEquip(projected, w));
  const equipped = promoting ? projected.weapon : retained || replacement;
  lines.push(
    `Equipped: ${unit.weapon?.name || 'None'} → ${equipped?.name || 'None — equip a compatible weapon before battle'}`,
  );
  lines.push('', 'Growths');
  if (promoting) {
    lines.push(
      Object.entries(target.growthBonuses || {})
        .filter(([, v]) => v)
        .map(
          ([stat]) => `${stat} ${unit.growths?.[stat] || 0}% → ${projected.growths?.[stat] || 0}%`,
        )
        .join(' · ') || 'Growth rates unchanged.',
    );
  } else {
    const source = target.growthRanges
      ? target
      : gameData.classes.find((c) => c.name === target.promotesFrom);
    if (source?.growthRanges) {
      lines.push('Growth rates reroll on Confirm within these ranges (not preview rolls):');
      lines.push(
        XP_STAT_NAMES.map((stat) => {
          const bonus = (target.growthBonuses?.[stat] || 0) + (unit.personalGrowths?.[stat] || 0);
          const range = source.growthRanges[stat];
          const [low, high] = range ? range.split('-').map(Number) : [0, 0];
          return `${stat} ${unit.growths?.[stat] || 0}% → ${low + bonus}–${high + bonus}%`;
        }).join(' · '),
      );
    } else lines.push('Growth rates unchanged.');
  }
  lines.push(
    '',
    `${slotCountsLine(unit, gameData.skills)} before change · Existing skills retained`,
  );
  for (const id of result.learnedSkills || []) {
    const skill = gameData.skills.find((s) => s.id === id);
    lines.push(`Learn: ${skill?.name || id}${skill?.description ? ` — ${skill.description}` : ''}`);
  }
  const omitted = getSkillDisplayNames(result.droppedSkills, gameData.skills);
  if (omitted.length) lines.push(`To the bench (slots full): ${omitted.join(', ')}.`);
  if (!result.learnedSkills?.length && !omitted.length) lines.push('No new skills to learn.');
  return lines.join('\n');
}

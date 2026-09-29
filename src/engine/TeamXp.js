// Team XP: a battle reward's "+N XP All" given to the whole roster at once, away
// from the battlefield's level-up cards. Pure: returns what happened to each unit so
// the reward screen can say it (levels, class skills learned, and a class skill that
// came due but found all five slots full).
import { gainExperience, checkLevelUpSkills, skillGateLevels } from './UnitManager.js';

/**
 * Give xpAmount to every unit in the roster and teach any class skill now due.
 * @returns {Array<{ unit, fromLevel, toLevel, gains, learned: string[], blocked: string[] }>}
 *   one entry per unit that levelled up or learned a skill (skill ids, in the order
 *   learned/refused).
 */
export function awardTeamXp(roster, xpAmount, classesData = [], options = {}) {
  const report = [];
  if (!xpAmount) return report;
  for (const unit of roster || []) {
    const fromLevel = unit.level;
    const { levelUps } = gainExperience(unit, xpAmount, options);
    const dropped = [];
    const learned = checkLevelUpSkills(unit, classesData, dropped);
    if (!levelUps.length && !learned.length) continue;
    // As on the battlefield card: only a skill whose level was reached now is news
    // (one that was already refused earlier is retried silently).
    const reached = new Set(levelUps.map((lv) => lv.newLevel));
    const gates = skillGateLevels(unit, classesData);
    const gains = {};
    for (const lv of levelUps)
      for (const [stat, n] of Object.entries(lv.gains || {})) gains[stat] = (gains[stat] || 0) + n;
    report.push({
      unit,
      fromLevel,
      toLevel: unit.level,
      gains,
      learned,
      blocked: dropped.filter((id) => reached.has(gates.get(id))),
    });
  }
  return report;
}

/** One line per unit, e.g. "Kira: Lv 9 → 10 (+1 HP, +1 SPD). Learned Vantage." */
export function teamXpLines(report, skillsData = []) {
  const name = (id) => skillsData.find((s) => s.id === id)?.name || id;
  return report.map((entry) => {
    const gains = Object.entries(entry.gains)
      .filter(([, n]) => n > 0)
      .map(([stat, n]) => `+${n} ${stat}`)
      .join(', ');
    let line = `${entry.unit.name}:`;
    if (entry.toLevel !== entry.fromLevel) line += ` Lv ${entry.fromLevel} → ${entry.toLevel}`;
    else if (gains) line += ' Bonus level'; // past the cap (extended leveling)
    if (gains) line += ` (${gains})`;
    if (gains || entry.toLevel !== entry.fromLevel) line += '.';
    if (entry.learned.length) line += ` Learned ${entry.learned.map(name).join(', ')}.`;
    for (const id of entry.blocked)
      line += ` ${name(id)} needs a free skill slot (all 5 are full).`;
    return line;
  });
}

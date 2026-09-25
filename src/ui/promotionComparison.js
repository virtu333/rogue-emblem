import { XP_STAT_NAMES } from '../utils/constants.js';
import { STAT_COLORS, UI_PALETTE } from '../utils/uiStyles.js';
import { getClassInnateSkills } from '../engine/UnitManager.js';
export function buildPromotionColumn(unit, cls, skillsData) {
  const lines = [];

  // Class name header
  lines.push({ text: cls.name, color: UI_PALETTE.accentText, bold: true, fontSize: '13px' });
  lines.push({ text: '' }); // spacer

  // Stat bonuses: "STR  12 → 14  (+2)"
  lines.push({ text: 'Stat Bonuses', color: UI_PALETTE.muted, bold: true });
  const bonuses = cls.promotionBonuses || {};
  for (const stat of XP_STAT_NAMES) {
    const bonus = bonuses[stat] || 0;
    if (bonus === 0) continue;
    const cur = unit.stats[stat];
    const after = cur + bonus;
    const color = STAT_COLORS[stat] || UI_PALETTE.text;
    lines.push({
      text: `  ${stat.padEnd(4)} ${String(cur).padStart(2)} → ${String(after).padStart(2)}  (+${bonus})`,
      color,
    });
  }
  // MOV bonus (separate since not in XP_STAT_NAMES)
  const movBonus = bonuses.MOV || 0;
  if (movBonus > 0) {
    const cur = unit.stats.MOV;
    lines.push({
      text: `  MOV  ${String(cur).padStart(2)} → ${String(cur + movBonus).padStart(2)}  (+${movBonus})`,
      color: STAT_COLORS.MOV || UI_PALETTE.text,
    });
  }

  lines.push({ text: '' }); // spacer

  // Growth bonuses
  if (cls.growthBonuses && Object.keys(cls.growthBonuses).length > 0) {
    lines.push({ text: 'Growth Bonuses', color: UI_PALETTE.muted, bold: true });
    for (const [stat, val] of Object.entries(cls.growthBonuses)) {
      lines.push({ text: `  +${val}% ${stat}`, color: UI_PALETTE.info });
    }
    lines.push({ text: '' });
  }

  // Weapons
  lines.push({ text: 'Weapons', color: UI_PALETTE.muted, bold: true });
  lines.push({ text: `  ${cls.weaponProficiencies}`, color: UI_PALETTE.text });
  lines.push({ text: '' });

  // Move type (highlight if changed)
  if (cls.moveType !== unit.moveType) {
    lines.push({ text: 'Move Type', color: UI_PALETTE.muted, bold: true });
    lines.push({ text: `  ${unit.moveType} → ${cls.moveType}`, color: UI_PALETTE.info });
    lines.push({ text: '' });
  }

  // Innate skill
  const innateIds = getClassInnateSkills(cls.name, skillsData);
  if (innateIds.length > 0) {
    lines.push({ text: 'Innate Skill', color: UI_PALETTE.muted, bold: true });
    for (const sid of innateIds) {
      const skill = skillsData.find((s) => s.id === sid);
      if (skill) {
        lines.push({ text: `  ${skill.name}`, color: UI_PALETTE.accentText, bold: true });
        // Wrap description to fit column
        const desc = skill.description || '';
        const wrapped = wrap(desc, 26);
        for (const wl of wrapped) {
          lines.push({ text: `  ${wl}`, color: UI_PALETTE.text, fontSize: '10px' });
        }
      }
    }
  }

  return { lines };
}
function wrap(text, maxChars) {
  const words = text.split(' ');
  const result = [];
  let cur = '';
  for (const w of words) {
    if (cur.length + w.length + 1 > maxChars && cur.length > 0) {
      result.push(cur);
      cur = w;
    } else {
      cur = cur ? cur + ' ' + w : w;
    }
  }
  if (cur) result.push(cur);
  return result;
}

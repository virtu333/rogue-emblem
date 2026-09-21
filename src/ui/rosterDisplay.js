// Short display for the seven flat combat-mod keys of a mastery perk.
const PERK_MOD_LABELS = {
  critBonus: 'Crit',
  hitBonus: 'Hit',
  avoidBonus: 'Avo',
  atkBonus: 'Atk',
  defBonus: 'Def',
  resBonus: 'Res',
  spdBonus: 'Spd',
};
export function formatPerkMods(mods) {
  if (!mods) return '';
  return Object.entries(mods)
    .filter(([, v]) => Number.isFinite(v) && v !== 0)
    .map(([k, v]) => `${v > 0 ? '+' : ''}${v} ${PERK_MOD_LABELS[k] || k}`)
    .join(', ');
}

export const MASTERY_HELP = [
  'Class mastery counts battles, not turns or kills. A deployed unit gains one battle of progress when you win and that unit survives. Escaped units count; benched and fallen units do not.',
  'Promotion carries progress from the base class into its promoted class. Reclassing changes the class family being counted; returning to a previous family restores its recorded progress.',
  'The current class family grants its perk once the threshold is reached. Perks from other families do not stack. Traits can change the threshold or replace the perk.',
];

export function proficiencyLabel(proficiency) {
  return `${proficiency.type}: ${{ Prof: 'Proficient', Mast: 'Master' }[proficiency.rank] || proficiency.rank || 'Proficient'}`;
}

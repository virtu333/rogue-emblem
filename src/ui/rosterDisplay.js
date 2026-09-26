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

// ContextHelp blocks (see ContextHelp.js). The lead is the generic answer; the
// roster swaps it for the unit's own progress.
export const MASTERY_HELP = [
  { lead: 'Win battles with a unit to master its class and unlock a perk.' },
  {
    title: 'Progress',
    points: [
      '+1 battle when you win and the unit survives. Escaping counts.',
      'Counts battles, not turns or kills; benched and fallen units do not count.',
    ],
  },
  {
    title: 'Changing class',
    points: [
      'Promotion carries progress into the promoted class.',
      'Reclassing counts a new class family; returning restores its old progress.',
    ],
  },
  {
    title: 'Perk',
    points: [
      'Only the current family’s perk is active. Perks never stack.',
      'Traits can change the threshold or strengthen the perk, never replace it.',
    ],
  },
];

export function proficiencyLabel(proficiency) {
  return `${proficiency.type}: ${{ Prof: 'Proficient', Mast: 'Master' }[proficiency.rank] || proficiency.rank || 'Proficient'}`;
}

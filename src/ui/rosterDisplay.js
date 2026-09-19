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

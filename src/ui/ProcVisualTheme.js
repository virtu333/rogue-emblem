/**
 * ProcVisualTheme -- pure classification + theming for combat proc visuals.
 *
 * Maps skill / weapon-art / affix activations ({ id, name }) to a visual
 * category, decides which combatant a proc belongs to, and provides the
 * category color theme. No Phaser dependencies -- fully unit-testable.
 *
 * Categories:
 *   art     -- weapon arts (deliberate technique)        -> amber
 *   offense -- on-attack procs (Luna, Sol, Astra...)     -> red
 *   defense -- on-defend procs + defensive enemy affixes -> blue
 *   neutral -- everything else (combat-start stances...) -> cyan
 */

export const PROC_CATEGORY = {
  ART: 'art',
  OFFENSE: 'offense',
  DEFENSE: 'defense',
  NEUTRAL: 'neutral',
};

export const PROC_THEME = {
  art: { color: '#ffb347', accent: 0xffb347 },
  offense: { color: '#ff6b6b', accent: 0xff6b6b },
  defense: { color: '#77bbff', accent: 0x77bbff },
  neutral: { color: '#88ffee', accent: 0x88ffee },
};

// Enemy affix activations are not in skills.json; the current trio
// (Shielded, Teleporter, Thorns) are all defensive reactions.
const DEFENSIVE_AFFIX_IDS = new Set(['shielded', 'teleporter', 'thorns']);

// Higher wins when a strike carries procs from multiple categories.
const CATEGORY_PRIORITY = [
  PROC_CATEGORY.ART,
  PROC_CATEGORY.OFFENSE,
  PROC_CATEGORY.DEFENSE,
  PROC_CATEGORY.NEUTRAL,
];

/** Classify one activation entry ({ id, name }) into a PROC_CATEGORY. */
export function classifyActivation(activation, skillsData) {
  if (!activation?.id) return PROC_CATEGORY.NEUTRAL;
  if (activation.id === 'weapon_art') return PROC_CATEGORY.ART;
  if (DEFENSIVE_AFFIX_IDS.has(activation.id)) return PROC_CATEGORY.DEFENSE;
  const skill = (skillsData || []).find((s) => s.id === activation.id);
  if (skill?.trigger === 'on-defend') return PROC_CATEGORY.DEFENSE;
  if (skill?.trigger === 'on-attack') return PROC_CATEGORY.OFFENSE;
  return PROC_CATEGORY.NEUTRAL;
}

/**
 * Split a strike's activations into striker-side and target-side lists,
 * each entry annotated with its category. Defense procs belong to the
 * target (the unit that defended), everything else to the striker.
 */
export function splitStrikeActivations(activations, skillsData) {
  const striker = [];
  const target = [];
  for (const act of activations || []) {
    const category = classifyActivation(act, skillsData);
    const entry = { ...act, category };
    if (category === PROC_CATEGORY.DEFENSE) target.push(entry);
    else striker.push(entry);
  }
  return { striker, target };
}

/** Dominant category of an annotated entry list (art > offense > defense > neutral). */
export function dominantCategory(entries) {
  for (const cat of CATEGORY_PRIORITY) {
    if (entries?.some((e) => e.category === cat)) return cat;
  }
  return PROC_CATEGORY.NEUTRAL;
}

/** Theme for a category (falls back to neutral). */
export function themeFor(category) {
  return PROC_THEME[category] || PROC_THEME.neutral;
}

/** Classify a pre-combat 'skill' event (Astra, Vantage, Desperation) by display name. */
export function classifySkillEventName(name, skillsData) {
  const skill = (skillsData || []).find((s) => s.name === name);
  if (!skill) return PROC_CATEGORY.NEUTRAL;
  if (skill.trigger === 'on-attack') return PROC_CATEGORY.OFFENSE;
  if (skill.trigger === 'on-defend') return PROC_CATEGORY.DEFENSE;
  return PROC_CATEGORY.NEUTRAL;
}

/**
 * If the activation list contains a Legendary-tier weapon art, return its
 * catalog entry (activation entries only carry the display name).
 */
export function findLegendaryArtActivation(activations, artCatalog) {
  for (const act of activations || []) {
    if (act.id !== 'weapon_art') continue;
    const art = (artCatalog || []).find((a) => a.name === act.name);
    if (art?.tierAffinity === 'Legendary') return art;
  }
  return null;
}

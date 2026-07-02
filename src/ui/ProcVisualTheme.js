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

/** Find a weapon-art catalog entry by activation display name. */
export function findArtByName(name, artCatalog) {
  return (artCatalog || []).find((a) => a.name === name) || null;
}

/**
 * If the activation list contains a Legendary-tier weapon art, return its
 * catalog entry (activation entries only carry the display name).
 */
export function findLegendaryArtActivation(activations, artCatalog) {
  for (const act of activations || []) {
    if (act.id !== 'weapon_art') continue;
    const art = findArtByName(act.name, artCatalog);
    if (art?.tierAffinity === 'Legendary') return art;
  }
  return null;
}

/**
 * Effect overlay for a proc activation: which spritesheet plays and on whom
 * ('striker' or 'target', relative to the strike). Drain effects sit on the
 * striker (the healed side); reflected/debuff-the-attacker procs (Thorns,
 * Intimidate) also land on the striker. Unmapped ids fall back by category.
 */
const ACTIVATION_FX = {
  // offense
  luna: { key: 'fx_pierce', at: 'target' },
  lethality: { key: 'fx_pierce', at: 'target' },
  flare: { key: 'fx_pierce', at: 'target' },
  astra: { key: 'fx_flurry', at: 'target' },
  adept: { key: 'fx_flurry', at: 'target' },
  sol: { key: 'fx_drain', at: 'striker' },
  aether: { key: 'fx_drain', at: 'striker' },
  drain: { key: 'fx_drain', at: 'striker' },
  zombie_drain: { key: 'fx_drain', at: 'striker' },
  seraph_strike: { key: 'fx_light', at: 'target' },
  divine_charge: { key: 'fx_light', at: 'target' },
  commanders_gambit: { key: 'fx_buff', at: 'striker' },
  // defense (played on the defending unit == strike target)
  pavise: { key: 'fx_shield', at: 'target' },
  aegis: { key: 'fx_shield', at: 'target' },
  miracle: { key: 'fx_shield', at: 'target' },
  cancel: { key: 'fx_shield', at: 'target' },
  dragon_scale: { key: 'fx_shield', at: 'target' },
  shielded: { key: 'fx_shield', at: 'target' },
  teleporter: { key: 'fx_shield', at: 'target' },
  intimidate: { key: 'fx_status', at: 'striker' },
  thorns: { key: 'fx_pierce', at: 'striker' },
};

export function fxForActivation(entry) {
  if (!entry) return null;
  const mapped = ACTIVATION_FX[entry.id];
  if (mapped) return mapped;
  if (entry.category === PROC_CATEGORY.DEFENSE) return { key: 'fx_shield', at: 'target' };
  if (entry.category === PROC_CATEGORY.OFFENSE) return { key: 'fx_pierce', at: 'target' };
  return null; // arts get the ring burst; neutral stances get no overlay
}

/** Ring bursts for a weapon-art strike, scaling with the art's tier. */
export function artBurstsForTier(tierAffinity) {
  if (tierAffinity === 'Legendary') return 3;
  if (tierAffinity === 'Silver') return 2;
  return 1;
}

/**
 * Signature 8-frame effect for a Legendary weapon-art strike, keyed by the
 * art's weapon type. Tome (and anything unmapped) uses the magic signature.
 */
const SIG_FX_BY_WEAPON_TYPE = {
  Sword: 'fx_sig_sword',
  Lance: 'fx_sig_lance',
  Axe: 'fx_sig_axe',
  Bow: 'fx_sig_bow',
};

export function sigFxForWeaponType(weaponType) {
  return SIG_FX_BY_WEAPON_TYPE[weaponType] || 'fx_sig_magic';
}

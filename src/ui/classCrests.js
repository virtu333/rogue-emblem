// Class crests — the heraldic emblem language (docs/art-direction/growth/README.md).
//
// One crest per class, composed from its class line:
//   primary    the line's weapon (sword, curved, dagger, lance, axe, bow, tome,
//              staff, light, breath, fan, eclipse)
//   twin       the primary is doubled (crossed) — a mastery class that adds no
//              new weapon type (Swordmaster, Berserker, Sniper, Warlock...)
//   secondary  weapon types the class adds over its base, crossed behind
//   mount      supporter behind the charge: horse, wing (pegasus), wyvern, tower
//   mark       small chief mark for the school: a gold star marks the lord lines
//   tier       the frame: base (steel rim), promoted (gilt rim + notched
//              crown), boss (cracked unlight rim)
// Pure data + lookups (no DOM, no Phaser, no JSON imports) so the crest
// build tool (tools/art/crests) and the runtime read the same table.

const c = (line, tier, primary, extra = {}) =>
  Object.freeze({
    line,
    tier,
    primary,
    twin: Boolean(extra.twin),
    secondary: Object.freeze([...(extra.secondary || [])]),
    mount: extra.mount || null,
    mark: extra.mark || null,
  });

export const CLASS_CREST_SPECS = Object.freeze({
  // Sword lines
  Myrmidon: c('myrmidon', 'base', 'curved'),
  Swordmaster: c('myrmidon', 'promoted', 'curved', { twin: true }),
  Duelist: c('myrmidon', 'promoted', 'curved', { secondary: ['lance'] }),
  Mercenary: c('mercenary', 'base', 'sword', { mark: 'coin' }),
  Hero: c('mercenary', 'promoted', 'sword', { secondary: ['axe'], mark: 'coin' }),
  Hunter: c('mercenary', 'promoted', 'sword', { secondary: ['bow'], mark: 'coin' }),
  Thief: c('thief', 'base', 'dagger', { mark: 'key' }),
  Assassin: c('thief', 'promoted', 'dagger', { secondary: ['bow'], mark: 'moon' }),
  Trickster: c('thief', 'promoted', 'dagger', { secondary: ['staff'], mark: 'key' }),
  Dancer: c('dancer', 'base', 'fan'),
  Bard: c('dancer', 'promoted', 'fan', { secondary: ['staff'] }),
  Lord: c('lord', 'base', 'sword', { mark: 'star' }),
  'Great Lord': c('lord', 'promoted', 'sword', { secondary: ['lance'], mark: 'star' }),
  // Axe lines
  Fighter: c('fighter', 'base', 'axe'),
  Warrior: c('fighter', 'promoted', 'axe', { secondary: ['bow'] }),
  Berserker: c('fighter', 'promoted', 'axe', { twin: true }),
  Sentinel: c('sentinel', 'base', 'axe', { mark: 'star' }),
  Champion: c('sentinel', 'promoted', 'axe', { secondary: ['lance'], mark: 'star' }),
  // Lance lines
  Knight: c('knight', 'base', 'lance', { mount: 'tower' }),
  General: c('knight', 'promoted', 'lance', { secondary: ['axe'], mount: 'tower' }),
  'Great Knight': c('knight', 'promoted', 'lance', { secondary: ['axe', 'sword'], mount: 'horse' }),
  Cavalier: c('cavalier', 'base', 'lance', { mount: 'horse' }),
  Paladin: c('cavalier', 'promoted', 'lance', { secondary: ['sword'], mount: 'horse' }),
  'Dark Knight': c('cavalier', 'promoted', 'lance', {
    secondary: ['tome'],
    mount: 'horse',
    mark: 'moon',
  }),
  Chevalier: c('chevalier', 'base', 'lance', { mount: 'horse', mark: 'star' }),
  'Holy Knight': c('chevalier', 'promoted', 'lance', {
    secondary: ['staff', 'light'],
    mount: 'horse',
    mark: 'star',
  }),
  'Pegasus Knight': c('pegasus', 'base', 'lance', { mount: 'wing' }),
  'Falcon Knight': c('pegasus', 'promoted', 'lance', { secondary: ['sword'], mount: 'wing' }),
  'Wyvern Rider': c('wyvern', 'base', 'lance', { mount: 'wyvern' }),
  'Wyvern Lord': c('wyvern', 'promoted', 'lance', { secondary: ['axe'], mount: 'wyvern' }),
  'Sky Lancer': c('skylancer', 'base', 'lance', { mount: 'wing', mark: 'star' }),
  'Seraph Knight': c('skylancer', 'promoted', 'lance', {
    secondary: ['light'],
    mount: 'wing',
    mark: 'star',
  }),
  // Bow lines
  Archer: c('archer', 'base', 'bow'),
  Sniper: c('archer', 'promoted', 'bow', { twin: true, mark: 'arrow' }),
  'Bow Knight': c('archer', 'promoted', 'bow', { secondary: ['sword'], mount: 'horse' }),
  Ranger: c('ranger', 'base', 'bow', { secondary: ['sword'], mark: 'star' }),
  Vanguard: c('ranger', 'promoted', 'bow', { secondary: ['sword', 'axe'], mark: 'star' }),
  // Tome and staff lines
  Mage: c('mage', 'base', 'tome', { mark: 'flame' }),
  Sage: c('mage', 'promoted', 'tome', { secondary: ['staff'], mark: 'flame' }),
  Warlock: c('mage', 'promoted', 'tome', { twin: true, mark: 'eye' }),
  Tactician: c('tactician', 'base', 'tome', { mark: 'star' }),
  Grandmaster: c('tactician', 'promoted', 'tome', { secondary: ['sword'], mark: 'star' }),
  Cleric: c('cleric', 'base', 'staff', { mark: 'chalice' }),
  Bishop: c('cleric', 'promoted', 'staff', { secondary: ['light'], mark: 'chalice' }),
  'Battle Monk': c('cleric', 'promoted', 'staff', { secondary: ['axe'], mark: 'chalice' }),
  'Light Sage': c('lightsage', 'base', 'light', { mark: 'star' }),
  'Light Priestess': c('lightsage', 'promoted', 'light', { secondary: ['staff'], mark: 'star' }),
  // Enemy-only lines (the roster never shows them, the compendium may)
  Zombie: c('zombie', 'base', 'axe', { mark: 'crack' }),
  Revenant: c('zombie', 'promoted', 'axe', { secondary: ['sword'], mark: 'crack' }),
  Dragon: c('dragon', 'base', 'breath', { mount: 'wyvern' }),
  'Dragon Lord': c('dragon', 'promoted', 'breath', { twin: true, mount: 'wyvern' }),
  Entity: c('entity', 'boss', 'eclipse', { mark: 'ring' }),
});

export const CREST_LINE_IDS = Object.freeze([
  ...new Set(Object.values(CLASS_CREST_SPECS).map((spec) => spec.line)),
]);

/** Weapon glyph for a proficiency type (classes.json → crest vocabulary). */
export const WEAPON_GLYPH = Object.freeze({
  Sword: 'sword',
  Lance: 'lance',
  Axe: 'axe',
  Bow: 'bow',
  Tome: 'tome',
  Staff: 'staff',
  Light: 'light',
  Breath: 'breath',
});

export function crestId(className) {
  return String(className || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

export function crestSpecForClass(className) {
  return Object.prototype.hasOwnProperty.call(CLASS_CREST_SPECS, className)
    ? CLASS_CREST_SPECS[className]
    : null;
}

/**
 * The crest a unit shows: its own class; an unknown class falls back to its
 * base class (promotesFrom) and then to null (callers render nothing).
 */
export function crestForUnit(unit, classesData = []) {
  if (!unit?.className) return null;
  const own = crestSpecForClass(unit.className);
  if (own) return { id: crestId(unit.className), className: unit.className, ...own };
  const base = classesData?.find?.((entry) => entry?.name === unit.className)?.promotesFrom;
  const fallback = typeof base === 'string' ? crestSpecForClass(base) : null;
  return fallback ? { id: crestId(base), className: base, ...fallback } : null;
}

/** Accessible label: "Swordmaster crest · promoted". */
export function crestLabel(className, spec = crestSpecForClass(className)) {
  if (!spec) return '';
  return `${className} crest · ${spec.tier === 'promoted' ? 'promoted' : spec.tier === 'boss' ? 'unknown' : 'base'}`;
}

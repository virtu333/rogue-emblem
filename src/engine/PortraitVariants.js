// Portrait variety: which face a generic unit wears (pure, no Phaser).
//
// Each base class line (a base class and its promotions) has several people
// ("identities", src/data/portraitVariants.json, built by
// tools/art/portrait-variants). A unit stores its person in
// `unit.portraitVariant` once, when it is created, recruited, hired or
// offered as a boss recruit, so the face is stable for the unit's lifetime:
// promotion only changes which drawing of that person is shown (the same
// Fighter becomes the same Warrior). Enemies store one of their class's enemy
// faces, keyed by their spawn identity.
//
// Choices are stable hashes of (run seed, name, class) - never Math.random,
// which is the battle RNG during battles - and prefer a person no one else in
// the roster (or the recently fallen) already wears. A name that reads as a
// man or a woman (data/recruits.json name pools) gets a matching face.
// Lords and bosses keep their own portraits and never get a variant.
import table from '../data/portraitVariants.json' with { type: 'json' };

export const PORTRAIT_VARIANTS = table;

/** FNV-1a with a murmur3 finalizer: stable, well-mixed 32-bit hash. */
export function stableHash(text) {
  let h = 2166136261 >>> 0;
  const s = String(text ?? '');
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

const seedOf = (seed) => (Number.isFinite(Number(seed)) ? Number(seed) >>> 0 : 0);

/** Lords and bosses keep their own portraits. */
export function wearsOwnPortrait(unit) {
  return Boolean(unit?.isLord || unit?.isBoss);
}

/** 'm' | 'f' | null for a recruit name ("Bram 2" reads as "Bram"). */
export function nameGender(name) {
  const base = String(name || '')
    .replace(/\s+\d+$/, '')
    .trim();
  return table.names[base] || null;
}

/** People who have a drawing in this class. */
export function portraitPeopleForClass(className) {
  return table.classes[className] || [];
}

export function isPortraitPerson(person) {
  return typeof person === 'string' && Boolean(table.identities[person]);
}

function orderPeople(pool, key) {
  return [...pool].sort(
    (a, b) => stableHash(`${key}|${a}`) - stableHash(`${key}|${b}`) || (a < b ? -1 : 1),
  );
}

/**
 * The person for a new unit: hash order over the class's people (gender
 * matched to the name when known), skipping people in `taken`, then in
 * `avoid` (a softer preference), before allowing a repeat.
 * @param {{name?:string, className:string, seed?:number, taken?:Iterable<string>, avoid?:Iterable<string>}} o
 * @returns {string|null}
 */
export function choosePortraitPerson({ name, className, seed, taken = [], avoid = [] }) {
  let pool = portraitPeopleForClass(className);
  if (!pool.length) return null;
  const gender = nameGender(name);
  if (gender) {
    const matching = pool.filter((p) => table.identities[p].gender === gender);
    if (matching.length) pool = matching;
  }
  const ordered = orderPeople(pool, `${seedOf(seed)}|${name || ''}|${className}`);
  const hard = new Set(taken);
  const soft = new Set(avoid);
  return (
    ordered.find((p) => !hard.has(p) && !soft.has(p)) ||
    ordered.find((p) => !hard.has(p)) ||
    ordered[0]
  );
}

/** Enemy face id for a class from a stable spawn key (null when the class has one face). */
export function chooseEnemyFace(className, key) {
  const pool = table.enemy[className] || [];
  if (pool.length < 2) return pool[0] || null;
  return pool[stableHash(`enemy|${key}|${className}`) % pool.length];
}

function isEnemyFace(unit, value) {
  return typeof value === 'string' && (table.enemy[unit?.className] || []).includes(value);
}

const peopleOf = (units, except) =>
  (units || [])
    .filter((u) => u && u !== except && !wearsOwnPortrait(u) && u.faction !== 'enemy')
    .map((u) => u.portraitVariant)
    .filter(isPortraitPerson);

/**
 * Give a unit its face once (idempotent: an existing valid choice is kept).
 * Player-side units get a person; enemies get an enemy face from `spawnKey`.
 * @param {object} unit
 * @param {{roster?:object[], fallen?:object[], others?:object[], seed?:number, spawnKey?:string}} context
 *   roster/others: units whose people are taken; fallen: people to avoid if possible
 * @returns {string|null} the stored value
 */
export function assignPortraitVariant(unit, context = {}) {
  if (!unit || wearsOwnPortrait(unit)) return null;
  const { roster = [], fallen = [], others = [], seed, spawnKey } = context;
  if (unit.faction === 'enemy') {
    if (isEnemyFace(unit, unit.portraitVariant)) return unit.portraitVariant;
    const key = spawnKey ?? `${unit.name}|${unit.level ?? ''}`;
    const face = chooseEnemyFace(unit.className, key);
    if (face) unit.portraitVariant = face;
    return face;
  }
  if (isPortraitPerson(unit.portraitVariant)) return unit.portraitVariant;
  const person = choosePortraitPerson({
    name: unit.name,
    className: unit.className,
    seed,
    taken: [...peopleOf(roster, unit), ...peopleOf(others, unit)],
    avoid: peopleOf(fallen, unit),
  });
  if (person) unit.portraitVariant = person;
  return person;
}

/**
 * Assign faces to several units in order, each one seeing the choices made
 * before it (candidates offered together never share a face).
 */
export function assignPortraitVariants(units, context = {}) {
  const assigned = [];
  for (const unit of units || []) {
    assignPortraitVariant(unit, { ...context, others: [...(context.others || []), ...assigned] });
    assigned.push(unit);
  }
  return units;
}

/**
 * Legacy saves: units from before portrait variety get a stable,
 * de-duplicated person on load. Roster order decides ties, so loading the
 * same save twice gives the same faces; units that have one keep it.
 */
export function backfillPortraitVariants(roster = [], { fallen = [], seed } = {}) {
  const all = [...(roster || []), ...(fallen || [])];
  const missing = all.filter(
    (u) =>
      u && !wearsOwnPortrait(u) && u.faction !== 'enemy' && !isPortraitPerson(u.portraitVariant),
  );
  for (const unit of missing)
    assignPortraitVariant(unit, { roster: all.filter((u) => u !== unit), seed });
  return missing.length;
}

/**
 * The person a player-side unit shows in its current class, or null (lords,
 * bosses, enemies, classes without people). This is the one resolver for
 * both the portrait (variantPortraitId) and the map sprite
 * (TracedSprites.tracedKeyFor), so the face and the figure are always the
 * same person. Units without a stored choice (previews, units that never
 * passed an assignment point) get a stable hash-based person that is not
 * persisted. A unit reclassed out of its line shows a stable counterpart of
 * the same gender in the new line.
 */
export function displayedPerson(unit) {
  if (!unit || wearsOwnPortrait(unit) || unit.faction === 'enemy') return null;
  const person = isPortraitPerson(unit.portraitVariant)
    ? unit.portraitVariant
    : choosePortraitPerson({ name: unit.name, className: unit.className, seed: 0 });
  if (!person) return null;
  if (table.identities[person].renders[unit.className]) return person;
  // Reclassed into another line: a stable counterpart of the same gender.
  const pool = portraitPeopleForClass(unit.className);
  if (!pool.length) return null;
  const same = pool.filter((p) => table.identities[p].gender === table.identities[person].gender);
  const pick = (same.length ? same : pool)[stableHash(person) % (same.length || pool.length)];
  return table.identities[pick].renders[unit.className] ? pick : null;
}

/**
 * The portrait id a unit shows through its variant, or null (lords, bosses,
 * classes without variants). Player-side units show displayedPerson's
 * drawing in their class; enemies one of their class's enemy faces.
 */
export function variantPortraitId(unit) {
  if (!unit || wearsOwnPortrait(unit)) return null;
  if (unit.faction === 'enemy') {
    if (isEnemyFace(unit, unit.portraitVariant)) return unit.portraitVariant;
    return chooseEnemyFace(
      unit.className,
      `${unit.battleEntityId || unit.name}|${unit.level ?? ''}`,
    );
  }
  const person = displayedPerson(unit);
  return person ? table.identities[person].renders[unit.className] : null;
}

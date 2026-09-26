// Class lineage: which base class a unit's promoted class grew from. Pure.
//
// classes.json names one `promotesFrom` per promoted class, but a promoted class
// can be reached from more than one base (Duelist from Myrmidon or Soldier,
// Paladin from Cavalier or Soldier). A unit remembers its own line in
// `unit.baseClass`, set when it promotes (UnitManager.promoteUnit); units
// promoted before that field existed fall back to the class's promotesFrom.

function findClass(classesData, name) {
  return Array.isArray(classesData) ? classesData.find((c) => c?.name === name) || null : null;
}

function promotesTo(cls) {
  if (!cls?.promotesTo) return [];
  return Array.isArray(cls.promotesTo) ? cls.promotesTo : [cls.promotesTo];
}

/** True when `baseName` is a base class whose promotions include `promotedName`. */
export function isLineOf(baseName, promotedName, classesData) {
  const base = findClass(classesData, baseName);
  return Boolean(base && base.tier === 'base' && promotesTo(base).includes(promotedName));
}

/**
 * The base class a unit's current class belongs to: its own class when base,
 * its remembered line when that line really promotes into its class, else the
 * class entry's promotesFrom. Null when the unit has no class.
 */
export function unitBaseClassName(unit, classesData) {
  const current = unit?.className;
  if (!current) return null;
  const entry = findClass(classesData, current);
  // A class is its own line unless it is promoted or declares where it promotes from.
  if (entry && entry.tier !== 'promoted' && !entry.promotesFrom) return current;
  const remembered = unit?.baseClass;
  if (typeof remembered === 'string' && isLineOf(remembered, current, classesData))
    return remembered;
  return entry?.promotesFrom || null;
}

/** Every base class that promotes into `promotedName`, in data order. */
export function baseClassesFor(promotedName, classesData) {
  return (Array.isArray(classesData) ? classesData : [])
    .filter((c) => c?.tier === 'base' && promotesTo(c).includes(promotedName))
    .map((c) => c.name);
}

/**
 * The base class a promoted unit came from, or null for a base (or unknown) class:
 * the drop-in for reading `promotesFrom` off the unit's class entry.
 */
export function promotedFromName(unit, classesData) {
  const base = unitBaseClassName(unit, classesData);
  return base && base !== unit?.className ? base : null;
}

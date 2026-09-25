// DeedTitles — how an earned epithet is written next to a name. Dependency-
// free so every renderer (ceremonies, menus, records) can import it cheaply.
// `unit.name` is identity; titles are only ever composed for display.

export const DEED_FORMS = Object.freeze(['who', 'the', 'of', 'bane', 'title', 'name']);

// Appositive forms take a comma: "Elara, Who Held the Bridge", "Elara, Bane
// of the Emperor", "Elara, Lantern of the March". The rest follow the name:
// "Elara the Untouched", "Elara of the Mire", "Elara Deathblow".
const APPOSITIVE_FORMS = new Set(['who', 'bane', 'title']);

/** Whether a title takes a comma after the name. */
export function isAppositive(form) {
  return APPOSITIVE_FORMS.has(form);
}

/** The unit's displayed epithet `{id, text, form}` or null. */
export function unitEpithet(unit) {
  const e = unit?.deeds?.epithet;
  if (!e || typeof e !== 'object' || typeof e.text !== 'string' || !e.text.trim()) return null;
  return { id: typeof e.id === 'string' ? e.id : '', text: e.text.trim(), form: e.form };
}

export function epithetText(unit) {
  return unitEpithet(unit)?.text || '';
}

/**
 * "Elara, Who Held the Bridge" · "Elara the Untouched" · "Elara Deathblow".
 * `epithet` is `{text, form}` (or an earned entry `{epithet, form}`).
 */
export function titledName(name, epithet) {
  const base = typeof name === 'string' ? name : '';
  const text = typeof epithet?.text === 'string' ? epithet.text : epithet?.epithet;
  if (!base || typeof text !== 'string' || !text.trim()) return base;
  return `${base}${isAppositive(epithet.form) ? ', ' : ' '}${text.trim()}`;
}

/** The single display helper: the name, with the title when asked. */
export function unitDisplayName(unit, { epithet = false } = {}) {
  const name = typeof unit?.name === 'string' ? unit.name : '';
  return epithet ? titledName(name, unitEpithet(unit)) : name;
}

/** Mid-sentence form for a `{text, form}` title: "Elara, Who Held the Bridge," */
export function sentenceTitle(name, epithet) {
  const titled = titledName(name, epithet);
  const text = typeof epithet?.text === 'string' ? epithet.text : epithet?.epithet;
  return typeof text === 'string' && text.trim() && isAppositive(epithet.form)
    ? `${titled},`
    : titled;
}

/** Mid-sentence form for a unit: "Elara, Who Held the Bridge, has fallen." */
export function sentenceName(unit) {
  return sentenceTitle(unit?.name, unitEpithet(unit));
}

// Command parsing for headless play (tools/play): words, tiles, clauses and item names.

/** A refusal the player can read: the command was not carried out. */
export class PlayError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlayError';
  }
}

/** A name that fits several different items: `choice` is the first one's #number. */
export class AmbiguousItem extends PlayError {
  constructor(message, token, choice) {
    super(message);
    this.name = 'AmbiguousItem';
    this.token = token;
    this.choice = choice;
  }
}

/** "end" straight after a turn ended on its own: refused, since it would skip a turn. */
export class EndAfterTurnEnded extends PlayError {
  constructor(message) {
    super(message);
    this.name = 'EndAfterTurnEnded';
  }
}

/** Splits a command into words; "double quotes" keep a multi-word name together. */
export function tokenize(text) {
  const words = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(String(text ?? ''))) !== null) words.push(m[1] ?? m[2] ?? m[3]);
  return words;
}

/** "x,y" (or "x y" as two words joined by the caller), or "stay" for the unit's own tile. */
export function parseTile(word, unit = null) {
  const w = String(word ?? '')
    .trim()
    .toLowerCase();
  if ((w === 'stay' || w === 'here') && unit) return { col: unit.col, row: unit.row };
  const m = /^(\d+),(\d+)$/.exec(w);
  if (!m)
    throw new PlayError(`Expected a tile as x,y${unit ? ' or "stay"' : ''}, got "${word ?? ''}".`);
  return { col: Number(m[1]), row: Number(m[2]) };
}

/**
 * Splits words at keywords: `attack E2 with Steel Sword art precise` with
 * ['with','art'] gives head ['E2'] and clauses { with: 'Steel Sword', art: 'precise' }.
 */
export function splitClauses(words, keywords) {
  const keys = new Set(keywords);
  const head = [];
  const clauses = {};
  let current = null;
  for (const word of words) {
    const lower = word.toLowerCase();
    if (keys.has(lower) && !(lower in clauses)) {
      current = lower;
      clauses[current] = [];
      continue;
    }
    if (current) clauses[current].push(word);
    else head.push(word);
  }
  for (const k of Object.keys(clauses)) {
    if (!clauses[k].length) throw new PlayError(`"${k}" needs a value.`);
    clauses[k] = clauses[k].join(' ');
  }
  return { head, clauses };
}

/** Fields that name or describe an item without changing how it plays. */
const PRESENTATION_FIELDS = new Set(['uid', 'lore', 'description', 'flavor', 'flavorText', 'icon']);

/** An item's state apart from its identity and text: equal for copies that play alike. */
function itemSignature(item) {
  return JSON.stringify(
    Object.keys(item || {})
      .filter((k) => !PRESENTATION_FIELDS.has(k))
      .sort()
      .map((k) => [k, item[k]]),
  );
}

/** What tells same-named items apart: uses left or spent, forging, imbue, arts. */
export function itemDistinction(item) {
  const parts = [];
  if (item.uses !== undefined) parts.push(`${item.uses} uses`);
  if (item._usesSpent) parts.push(`${item._usesSpent} uses spent`);
  if (item._forgeLevel) parts.push(`forged +${item._forgeLevel}`);
  for (const stat of ['might', 'hit', 'crit', 'weight'])
    if (item._forgeBonuses?.[stat])
      parts.push(`${stat} ${item._forgeBonuses[stat] > 0 ? '+' : ''}${item._forgeBonuses[stat]}`);
  if (item._imbueId) parts.push(`imbued ${item._imbueId}`);
  if (item.weaponArtIds?.length) parts.push(`arts ${item.weaponArtIds.join('/')}`);
  return parts.join(', ');
}

/**
 * The item a token names among `list`: "#2" (1-based position), an exact name, or a
 * unique name prefix (case-insensitive). Several items with that name are one choice
 * only when they are alike in every way but their uid; otherwise the token is refused
 * with each one's position and what sets it apart. Throws a PlayError listing the
 * choices.
 */
export function findItem(list, token, what = 'item') {
  const items = (list || []).filter(Boolean);
  const t = String(token ?? '')
    .trim()
    .toLowerCase();
  const show = () => items.map((i, n) => `#${n + 1} ${i.name}`).join(', ') || 'none';
  if (!t) throw new PlayError(`Name a ${what}. Choose from: ${show()}.`);
  const index = /^#(\d+)$/.exec(t);
  if (index) {
    const item = items[Number(index[1]) - 1];
    if (!item) throw new PlayError(`No ${what} ${token}. Choose from: ${show()}.`);
    return item;
  }
  const oneOf = (matches) => {
    if (matches.every((i) => itemSignature(i) === itemSignature(matches[0]))) return matches[0];
    throw new AmbiguousItem(
      `"${token}" names ${matches.length} different ${what}s: ${matches
        .map(
          (i) =>
            `#${items.indexOf(i) + 1} ${i.name}${itemDistinction(i) ? ` (${itemDistinction(i)})` : ''}`,
        )
        .join('; ')}. Name one by its #number.`,
      String(token),
      items.indexOf(matches[0]) + 1,
    );
  };
  const exact = items.filter((i) => String(i.name).toLowerCase() === t);
  if (exact.length >= 1) return oneOf(exact);
  const prefix = items.filter((i) => String(i.name).toLowerCase().startsWith(t));
  if (prefix.length === 1) return prefix[0];
  if (prefix.length > 1 && prefix.every((i) => i.name === prefix[0].name)) return oneOf(prefix);
  if (prefix.length > 1)
    throw new PlayError(`"${token}" matches several: ${prefix.map((i) => i.name).join(', ')}.`);
  throw new PlayError(`No ${what} "${token}". Choose from: ${show()}.`);
}

/** A 1-based list index: "2" or "#2". */
export function parseIndex(word, count, what = 'choice') {
  const m = /^#?(\d+)$/.exec(String(word ?? '').trim());
  const n = m ? Number(m[1]) : NaN;
  if (!(n >= 1 && n <= count))
    throw new PlayError(`Choose a ${what} from 1 to ${count}${word ? `, not "${word}"` : ''}.`);
  return n - 1;
}

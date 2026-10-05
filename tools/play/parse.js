// Command parsing for headless play (tools/play): words, tiles, clauses and item names.

/** A refusal the player can read: the command was not carried out. */
export class PlayError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PlayError';
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

/**
 * The item a token names among `list`: "#2" (1-based position), an exact name, or a
 * unique name prefix (case-insensitive). Throws a PlayError listing the choices.
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
  const exact = items.filter((i) => String(i.name).toLowerCase() === t);
  if (exact.length >= 1) return exact[0];
  const prefix = items.filter((i) => String(i.name).toLowerCase().startsWith(t));
  if (prefix.length === 1) return prefix[0];
  if (prefix.length > 1 && prefix.every((i) => i.name === prefix[0].name)) return prefix[0];
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

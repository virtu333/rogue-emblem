// actNames.js — how the game names an act ("Act II", "Final Act"), one rule for the engine's
// words (a burden's span) and the ceremony layer's (ceremonyContent re-exports both). Pure.

const ROMAN = [
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I'],
];

/** 1 -> "I", 4 -> "IV" ('' outside 1..39). */
export function romanNumeral(value) {
  let n = Math.trunc(Number(value));
  if (!Number.isFinite(n) || n <= 0 || n > 39) return '';
  let out = '';
  for (const [size, glyph] of ROMAN) {
    while (n >= size) {
      out += glyph;
      n -= size;
    }
  }
  return out;
}

/** "Act II", "Final Act", "Beyond the Acts" — title case; renderers uppercase. */
export function actLabel(actId) {
  const match = /^act(\d+)$/.exec(String(actId || ''));
  if (match) return `Act ${romanNumeral(Number(match[1]))}`;
  if (actId === 'finalBoss') return 'Final Act';
  if (actId === 'secretAct') return 'Beyond the Acts';
  if (actId === 'prologue') return 'Prologue';
  return '';
}

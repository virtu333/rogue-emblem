// Full-screen DOM surfaces (.re-screen and its variants) sit on the whole
// viewport, so on a notched iPhone in landscape their bottom edge meets the
// home bar (~21 px). A variant that tightens the base padding must keep the
// bottom safe inset, or its bottom row (the battle timeline's Rewind button)
// lands under the home bar.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

/** Top-level space-separated values of a declaration (parentheses kept whole). */
function values(text) {
  const out = [];
  let depth = 0;
  let current = '';
  for (const ch of text.trim()) {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (/\s/.test(ch) && depth === 0) {
      if (current) out.push(current);
      current = '';
    } else current += ch;
  }
  if (current) out.push(current);
  return out;
}

/** The bottom value of a `padding` shorthand. */
export function paddingBottom(text) {
  const v = values(text);
  return v.length >= 3 ? v[2] : v[0];
}

function screenPaddings() {
  const found = [];
  for (const file of readdirSync('src/ui').filter((f) => f.endsWith('.css'))) {
    const css = readFileSync(`src/ui/${file}`, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [, selector, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/\.re-screen\b/.test(selector)) continue;
      for (const [, prop, value] of body.matchAll(/(?:^|;)\s*(padding(?:-bottom)?)\s*:\s*([^;]+)/g))
        found.push({
          file,
          selector: selector.trim().replace(/\s+/g, ' '),
          bottom: prop === 'padding' ? paddingBottom(value) : value.trim(),
        });
    }
  }
  return found;
}

describe('full-screen surfaces keep the home-bar inset', () => {
  it('reads the bottom of a padding shorthand', () => {
    expect(paddingBottom('6px max(8px, env(a)) 7px max(8px, env(b))')).toBe('7px');
    expect(paddingBottom('max(6px, env(x)) 8px')).toBe('max(6px, env(x))');
    expect(paddingBottom('4px')).toBe('4px');
  });

  it('every .re-screen padding keeps env(safe-area-inset-bottom) at the bottom', () => {
    const rules = screenPaddings();
    // The base rule and its tightened variants are all found.
    expect(rules.map((r) => r.selector)).toEqual(
      expect.arrayContaining(['.re-screen', '.bt-battlefield.re-screen', '.vr-picker.re-screen']),
    );
    const missing = rules.filter((r) => !/env\(\s*safe-area-inset-bottom/.test(r.bottom));
    expect(missing).toEqual([]);
  });
});

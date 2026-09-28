// Every portrait layout keys off html.portrait-ui AND sits inside an
// `@media (orientation: portrait)` block, so the class is inert on a landscape page
// (a stale class during a turn, or a test that forces it, never moves landscape
// layouts). This scans every stylesheet for a portrait-ui rule outside such a block.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function cssFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...cssFiles(path));
    else if (name.endsWith('.css')) out.push(path);
  }
  return out;
}

/** Selectors naming portrait-ui that are not inside an orientation: portrait query. */
export function ungatedPortraitRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const stack = [];
  const offenders = [];
  let prelude = '';
  for (const ch of text) {
    if (ch === '{') {
      const head = prelude.trim();
      stack.push(head);
      const gated = stack.some((h) => /^@media[^{]*orientation:\s*portrait/.test(h));
      if (!head.startsWith('@') && /\.portrait-ui\b/.test(head) && !gated) offenders.push(head);
      prelude = '';
    } else if (ch === '}') {
      stack.pop();
      prelude = '';
    } else if (ch === ';') {
      prelude = '';
    } else prelude += ch;
  }
  return offenders;
}

describe('portrait CSS gating', () => {
  it('finds a rule outside the orientation query (the check itself works)', () => {
    expect(ungatedPortraitRules('html.portrait-ui .a { color: red; }')).toEqual([
      'html.portrait-ui .a',
    ]);
    expect(
      ungatedPortraitRules(
        '@media (orientation: portrait) { html.portrait-ui .a { color: red; } }',
      ),
    ).toEqual([]);
    expect(
      ungatedPortraitRules(
        '@media (orientation: portrait) { @supports (display: grid) { html.portrait-ui .a { x: y; } } }',
      ),
    ).toEqual([]);
    expect(
      ungatedPortraitRules('@media (max-width: 700px) { html.portrait-ui .a { x: y; } }'),
    ).toEqual(['html.portrait-ui .a']);
  });

  it('keeps every portrait-ui rule in the app inside @media (orientation: portrait)', () => {
    const files = [...cssFiles(join(root, 'src')), join(root, 'index.html')];
    const offenders = [];
    for (const file of files) {
      let css = readFileSync(file, 'utf8');
      if (file.endsWith('.html'))
        css = [...css.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
      for (const rule of ungatedPortraitRules(css))
        offenders.push(`${relative(root, file)}: ${rule.replace(/\s+/g, ' ')}`);
    }
    expect(offenders).toEqual([]);
  });
});

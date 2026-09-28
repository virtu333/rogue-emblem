// The help pop-up (ContextHelp) hugs its text: `height: fit-content`, capped. Its
// body must keep an `auto` flex basis. With the menu kit's `flex: 1` (basis 0%)
// WebKit sized the dialog as if the body were empty, so on iPhone every (i) pop-up
// showed only its header and scroll arrows (Chromium lays it out either way, so a
// browser spec here cannot catch it).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const css = readFileSync(join(root, 'src/ui/contextHelp.css'), 'utf8').replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Declarations of the first top-level rule whose selector list is exactly `selector`. */
function declarations(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
  const match = css.match(new RegExp(`(?:^|})\\s*${escaped}\\s*\\{([^}]*)\\}`));
  if (!match) return null;
  return Object.fromEntries(
    match[1]
      .split(';')
      .map((d) => d.split(':').map((p) => p.trim()))
      .filter(([prop, value]) => prop && value)
      .map(([prop, ...rest]) => [prop, rest.join(':')]),
  );
}

describe('help pop-up sizing', () => {
  it('the dialog hugs its content', () => {
    expect(declarations('html .re-help.re-compact-menu.re-screen')?.height).toBe('fit-content');
  });

  it('the body keeps an auto flex basis and may shrink to scroll', () => {
    const body = declarations('.re-help .re-menu-body');
    expect(body?.flex).toBeTruthy();
    const [grow, shrink, basis] = body.flex.split(/\s+/);
    expect(Number(grow)).toBe(0);
    expect(Number(shrink)).toBeGreaterThan(0);
    expect(basis).toBe('auto');
  });
});

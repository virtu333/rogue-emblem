// Scenes and UI never write a unit's XP directly: every gain goes through the engine
// (UnitManager.gainExperience, BattleXp.applyXpGain, TeamXp, promotion), which keeps
// the rules that ride on XP (wraps, the level cap, extended leveling, the skills a
// level teaches) whatever is drawn. The EXP bars and the gauge read a record of the
// gain (engine/XpProgress) and never touch `unit.xp` (docs/specs/exp-bars.md §1).
// The analog of HpWriteBoundary.test.js. No write is allowed: when this was written
// there was none (the heal action's presentation facts named their award `xp`; they
// were renamed `awardedXp` so the rule needs no exceptions).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/scenes', 'src/ui'];
// `x.xp = …`, `x.xp += …` (any compound), `x.xp++` / `x.xp--`, `++x.xp` / `--x.xp`,
// and the bracket forms `x['xp'] = …`.
const WRITE =
  /(?:\.xp|\[\s*['"`]xp['"`]\s*\])\s*(?:(?:[-+*/%]|\*\*|\?\?|\|\||&&)?=(?!=)|\+\+|--)|(?:\+\+|--)\s*[\w$.]*(?:\.xp\b|\[\s*['"`]xp['"`]\s*\])/;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.js') ? [path] : [];
  });
}

function xpWrites() {
  const found = [];
  for (const file of ROOTS.flatMap(sourceFiles)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, i) => {
        const code = text.replace(/\/\/.*$/, '').trim();
        if (WRITE.test(code)) found.push(`${file.replace(/\\/g, '/')}:${i + 1}  ${code}`);
      });
  }
  return found;
}

describe('XP writes stay in the engine', () => {
  it('scenes and UI never write a unit’s XP', () => {
    expect(xpWrites()).toEqual([]);
  });

  it('the pattern catches the forms a write takes', () => {
    for (const line of [
      'u.xp = 5;',
      'u.xp += 2;',
      'u.xp -= 2;',
      'u.xp++;',
      'u.xp--;',
      '++u.xp;',
      'unit.xp ||= 0;',
      'unit.xp ??= 0;',
      "u['xp'] = 0;",
      'facts.xp = xp;',
    ])
      expect(WRITE.test(line), line).toBe(true);
    for (const line of [
      'if (u.xp === 5)',
      'u.xp <= 0',
      'u.xp >= 99',
      'const xp = u.xp;',
      'xp: unit.xp,',
      'const facts = { xp: 1 };',
      'u.xpMultiplier = 2;',
      'u.xpShare += 1;',
      'facts.awardedXp = xp;',
    ])
      expect(WRITE.test(line), line).toBe(false);
  });
});

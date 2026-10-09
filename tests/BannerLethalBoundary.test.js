// The Unbroken Banner covers every way a player unit can fall (an earned blessing,
// engine/BattleBlessings.js). A blow can fell a unit in two places only: the combat exchange
// (Combat.rollStrike, which hands the battle's blessings to UnitHealth.absorbLethal) and a
// floor-0 UnitHealth.damageUnit / damageUnitDetailed (an area art, a ram's crash, a lethal
// after-combat blow, a Deathburst, a ballista bolt, the Entity's splash). Every other loss
// is floored at 1 and can never fell anyone.
//
// So every damageUnit / damageUnitDetailed call in the game either says `floor: 1` (it
// cannot kill) or hands over `blessings` (the banner can hold it). A new lethal source that
// forgets the option would let the banner's ally die: this scan names it.
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src'];
// The harness mirrors the scene's lethal paths and must hand the option over too.
const EXTRA_FILES = ['tests/harness/HeadlessBattle.js'];
const OWNER = 'src/engine/UnitHealth.js';
const CALL = /\bdamageUnit(?:Detailed)?\(/g;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.js') ? [path] : [];
  });
}

/** Each call's argument text (balanced parentheses), with its file and line. */
export function damageCalls(file, text) {
  const calls = [];
  const code = text.replace(/\/\/.*$/gm, (m) => ' '.repeat(m.length));
  for (const match of code.matchAll(CALL)) {
    // A definition (`function damageUnit(`) is not a call.
    if (/function\s+$/.test(code.slice(Math.max(0, match.index - 12), match.index))) continue;
    let depth = 1;
    let i = match.index + match[0].length;
    const start = i;
    while (i < code.length && depth > 0) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')') depth--;
      i++;
    }
    calls.push({
      file,
      line: code.slice(0, match.index).split('\n').length,
      args: code
        .slice(start, i - 1)
        .replace(/\s+/g, ' ')
        .trim(),
    });
  }
  return calls;
}

/** A call the banner can hold, or one that cannot kill. */
export const coversBanner = (args) => /\bfloor:\s*1\b/.test(args) || /\bblessings\b/.test(args);

function allCalls() {
  const files = [...ROOTS.flatMap(sourceFiles), ...EXTRA_FILES]
    .map((f) => f.replace(/\\/g, '/'))
    .filter((f) => f !== OWNER);
  return files.flatMap((file) => damageCalls(file, readFileSync(file, 'utf8')));
}

describe('every lethal damageUnit call hands the banner its chance', () => {
  it('each call is floored at 1 or passes the battle’s blessings', () => {
    const bare = allCalls().filter((c) => !coversBanner(c.args));
    expect(bare.map((c) => `${c.file}:${c.line}  damageUnit(${c.args})`)).toEqual([]);
  });

  it('the scan finds the lethal paths it guards (it cannot silently find nothing)', () => {
    const calls = allCalls();
    const lethal = calls.filter((c) => /\bblessings\b/.test(c.args));
    const where = new Set(lethal.map((c) => c.file));
    expect(where).toEqual(
      new Set(['src/engine/PostCombatEffects.js', 'src/scenes/BattleScene.js']),
    );
    // Deathburst, the ballista and the Entity's splash in the scene; the area blows, the ram's
    // crash and the after-combat blow in the post-combat pipeline.
    expect(lethal.filter((c) => c.file === 'src/scenes/BattleScene.js')).toHaveLength(3);
    expect(lethal.filter((c) => c.file === 'src/engine/PostCombatEffects.js')).toHaveLength(3);
  });

  it('the rule catches the forms a call takes', () => {
    const [call] = damageCalls(
      'x.js',
      'const { lost } = damageUnitDetailed(\n  unit,\n  amount,\n);',
    );
    expect(call.args).toBe('unit, amount,');
    expect(coversBanner(call.args)).toBe(false);
    expect(coversBanner('unit, 5, { floor: 1, disturbs: false }')).toBe(true);
    expect(coversBanner('unit, 5, { floor }')).toBe(false);
    expect(coversBanner('victim, dmg, { blessings: this._battleBlessings }')).toBe(true);
    expect(damageCalls('x.js', 'export function damageUnit(unit, amount, opts = {}) {}')).toEqual(
      [],
    );
  });
});

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

/**
 * A call the banner can hold (it hands over `blessings:` with a value: never a literal null or
 * undefined, and never the bare shorthand of a local that may be anything), or one that
 * cannot kill (`floor: 1`).
 */
export const coversBanner = (args) =>
  /\bfloor:\s*1\b/.test(args) || /\bblessings:\s*(?!null\b|undefined\b|void\b)[\w.$?]/.test(args);

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
    const lethal = calls.filter((c) => /\bblessings:/.test(c.args));
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
    expect(coversBanner('victim, dmg, { blessings: world?.battleBlessings ?? null }')).toBe(true);
    expect(coversBanner('victim, dmg, { blessings: null }')).toBe(false);
    expect(coversBanner('victim, dmg, { blessings: undefined }')).toBe(false);
    expect(coversBanner('victim, dmg, { blessings }')).toBe(false);
    expect(damageCalls('x.js', 'export function damageUnit(unit, amount, opts = {}) {}')).toEqual(
      [],
    );
  });
});

/** A method's body (balanced braces) in `text`, by its definition `  name(`. */
function methodBody(text, name) {
  const at = text.search(new RegExp(`\\n  ${name}\\(`));
  if (at < 0) return null;
  let i = text.indexOf('{', text.indexOf(')', at));
  const start = i;
  let depth = 0;
  do {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') depth--;
    i++;
  } while (i < text.length && depth > 0);
  return text.slice(start, i);
}

describe('every exchange the battle resolves carries the banner', () => {
  // The exchange's hold (Combat.rollStrike) reads `skillCtx.battleBlessings`, and the
  // post-combat blows read `world.battleBlessings`. A resolveCombat call with a context built
  // elsewhere, or a builder that drops the field, would let an ally die in the exchange while
  // every damageUnit call above still passes.
  const FILES = {
    'src/scenes/BattleScene.js': { ctx: 'buildSkillCtx', world: '_postCombatWorld' },
    'tests/harness/HeadlessBattle.js': { ctx: '_buildSkillCtx', world: '_postCombatWorld' },
  };

  it.each(Object.entries(FILES))('%s: its builders hand over the battle’s state', (file, names) => {
    const text = readFileSync(file, 'utf8');
    for (const name of [names.ctx, names.world]) {
      const body = methodBody(text, name);
      expect(body, `${file} ${name}`).toBeTruthy();
      expect(body, `${file} ${name}`).toMatch(/battleBlessings:\s*this\._battleBlessings\b/);
    }
  });

  it.each(Object.entries(FILES))(
    '%s: every resolveCombat call takes the context its builder made',
    (file, names) => {
      const code = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
      const calls = [...code.matchAll(/\bresolveCombat\(([^;]*?)\);/gs)];
      expect(calls.length, file).toBeGreaterThan(0);
      for (const call of calls) {
        const args = call[1]
          .split(',')
          .map((a) => a.trim())
          .filter(Boolean);
        expect(args.at(-1), `${file}: resolveCombat(${args.join(', ')})`).toBe('skillCtx');
        const before = code.slice(0, call.index);
        const made = before.slice(before.lastIndexOf('const skillCtx ='));
        expect(made, file).toMatch(new RegExp(`^const skillCtx = this\\.${names.ctx}\\(`));
      }
    },
  );
});

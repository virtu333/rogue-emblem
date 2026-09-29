// Scenes and UI never write a unit's HP directly: every heal, hit and HP cost goes
// through engine/UnitHealth.js, which keeps the rules that ride on HP (accessory
// debt) whatever is drawn. A direct write here is how rendering came to own game
// state before (BattleScene.updateHPBar settled the debt).
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['src/scenes', 'src/ui'];
const WRITE = /\bcurrentHP\s*(?:[-+*/]?=(?!=)|\+\+|--)/;

// Each allowed write, by file and the text of its line, with why it is not play.
const ALLOWED = [
  {
    file: 'src/scenes/BattleScene.js',
    line: 'enemy.currentHP = enemy.stats.HP;',
    why: 'building a boss at spawn (its stats were just raised), not an HP change in play',
  },
  {
    file: 'src/scenes/BattleScene.js',
    line: 'attacker.currentHP = this._getWeaponArtHpAfterCost(attacker, weaponArt);',
    why: 'forecast preview of a weapon art HP cost, restored in the same finally',
  },
  {
    file: 'src/scenes/BattleScene.js',
    line: 'attacker.currentHP = originalHP;',
    why: 'the restore half of that forecast preview',
  },
];

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith('.js') ? [path] : [];
  });
}

function hpWrites() {
  const found = [];
  for (const file of ROOTS.flatMap(sourceFiles)) {
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((text, i) => {
        const code = text.replace(/\/\/.*$/, '').trim();
        if (WRITE.test(code)) found.push({ file: file.replace(/\\/g, '/'), line: code, at: i + 1 });
      });
  }
  return found;
}

describe('HP writes stay in the engine', () => {
  it('scenes and UI change HP only through UnitHealth', () => {
    const unexpected = hpWrites().filter(
      (w) => !ALLOWED.some((a) => a.file === w.file && a.line === w.line),
    );
    expect(unexpected.map((w) => `${w.file}:${w.at}  ${w.line}`)).toEqual([]);
  });

  it('every allowed write still exists (the list cannot go stale)', () => {
    const writes = hpWrites();
    for (const allowed of ALLOWED) {
      expect(writes.some((w) => w.file === allowed.file && w.line === allowed.line)).toBe(true);
    }
  });

  it('the pattern catches the forms a write takes', () => {
    for (const line of [
      'u.currentHP = 5;',
      'u.currentHP += 2;',
      'u.currentHP -= 2;',
      'u.currentHP++;',
    ])
      expect(WRITE.test(line)).toBe(true);
    for (const line of ['if (u.currentHP === 5)', 'u.currentHP <= 0', 'const hp = u.currentHP;'])
      expect(WRITE.test(line)).toBe(false);
  });
});

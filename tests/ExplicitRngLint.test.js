// The lint ban on ambient randomness along the explicit-RNG player attack path
// (compression plan step 3, eslint.config.js). CI runs `npm run lint`; this
// proves the rule is wired to the right files and methods and still bites.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';
import { ESLint } from 'eslint';
import { EXPLICIT_RNG_MODULES, EXPLICIT_RNG_SCENE_METHODS } from '../eslint.config.js';

const root = new URL('../', import.meta.url);
const eslint = new ESLint({ cwd: root.pathname });
const RULES = new Set(['no-restricted-properties', 'no-restricted-syntax']);

async function rngErrors(code, filePath) {
  const [result] = await eslint.lintText(code, { filePath });
  return result.messages.filter((m) => RULES.has(m.ruleId)).map((m) => `${m.line}: ${m.message}`);
}
const source = (path) => readFileSync(new URL(path, root), 'utf-8');

// Linting BattleScene (11k lines) is slow on a loaded machine.
describe('explicit-RNG lint scope', { timeout: 60_000 }, () => {
  it('covers every module the player attack resolves through', () => {
    expect(EXPLICIT_RNG_MODULES).toEqual(
      expect.arrayContaining([
        'src/engine/Combat.js',
        'src/engine/SkillSystem.js',
        'src/engine/AffixSystem.js',
        'src/engine/HitRoll.js',
        'src/engine/ImbueSystem.js',
        'src/engine/WeaponArtSystem.js',
      ]),
    );
    const scene = source('src/scenes/BattleScene.js');
    for (const method of EXPLICIT_RNG_SCENE_METHODS)
      expect(scene, method).toMatch(new RegExp(`\\n  (async )?${method}\\(`));
  });

  it('the migrated modules and scene methods are clean', async () => {
    for (const path of [...EXPLICIT_RNG_MODULES, 'src/scenes/BattleScene.js'])
      expect(await rngErrors(source(path), path), path).toEqual([]);
  });

  it.each(EXPLICIT_RNG_MODULES)('%s: an ambient draw is an error', async (path) => {
    const planted = `${source(path)}\nexport function stray() {\n  return Math.random() < 0.5;\n}\n`;
    expect((await rngErrors(planted, path)).length).toBe(1);
    // ambientRandom is a default for callers without a generator, never a draw.
    const direct = `${source(path)}\nexport function stray2() {\n  return ambientRandom();\n}\n`;
    expect((await rngErrors(direct, path)).length).toBe(1);
  });

  it('BattleScene: Math.random inside a path method is an error, elsewhere it is not', async () => {
    const path = 'src/scenes/BattleScene.js';
    const scene = source(path);
    const inPath = scene.replace(
      '  async executeCombat(attacker, defender) {\n',
      '  async executeCombat(attacker, defender) {\n    if (Math.random() < 0) return;\n',
    );
    expect(inPath).not.toBe(scene);
    expect(await rngErrors(inPath, path)).toHaveLength(1);
    const warp = scene.replace(
      /(\n {2}async executeWarp\([^)]*\) \{\n)/,
      '$1    void Math.random;\n',
    );
    expect(warp).not.toBe(scene);
    expect(await rngErrors(warp, path)).toHaveLength(1);
    // Paths not migrated yet (here: the enemy phase) are out of scope.
    const outside = scene.replace(
      '  async executeEnemyCombat(',
      '  _stray() {\n    return Math.random();\n  }\n\n  async executeEnemyCombat(',
    );
    expect(outside).not.toBe(scene);
    expect(await rngErrors(outside, path)).toEqual([]);
  });
});

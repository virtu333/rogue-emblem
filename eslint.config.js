import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

// Explicit gameplay RNG (compression plan step 3). A migrated path draws only
// from the generator it is handed. Ambient randomness (Math.random, which a
// battle still installs as its RNG for unmigrated paths) may appear in these
// modules only as `ambientRandom`, the default for callers that pass no
// generator, and is never drawn directly. tests/ExplicitRngLint.test.js holds
// this scope to the migrated path.
const AMBIENT_DRAW = {
  selector: "CallExpression[callee.name='ambientRandom']",
  message:
    'Explicit-RNG path: draw from the rng passed in; ambientRandom is only a default for callers without one.',
};
export const EXPLICIT_RNG_MODULES = [
  'src/engine/Combat.js',
  'src/engine/SkillSystem.js',
  'src/engine/AffixSystem.js',
  'src/engine/HitRoll.js',
  'src/engine/ImbueSystem.js',
  'src/engine/WeaponArtSystem.js',
  'src/engine/WeaponArtPostCombat.js',
];
// BattleScene methods on the player attack path, Confirm through resolution.
export const EXPLICIT_RNG_SCENE_METHODS = [
  'confirmForecastCombat',
  'executeCombat',
  '_playerAttackRng',
  '_commitCombatIntent',
  '_prepareCombatContext',
  '_runCombatResolution',
  '_runCombatResolutionAtSpeed',
  'buildSkillCtx',
  '_applyAccessoryPhaseCombatMods',
  '_gamblerRandom',
  '_warpAfterStrike',
  'executeWarp',
];
const sceneMethods = `MethodDefinition[key.name=/^(${EXPLICIT_RNG_SCENE_METHODS.join('|')})$/]`;
const explicitRngRules = [
  {
    files: EXPLICIT_RNG_MODULES,
    rules: {
      'no-restricted-properties': [
        'error',
        {
          object: 'Math',
          property: 'random',
          message:
            'Explicit-RNG path: take the generator as a parameter (default ambientRandom from BattleRng.js).',
        },
      ],
      'no-restricted-syntax': ['error', AMBIENT_DRAW],
    },
  },
  {
    files: ['src/scenes/BattleScene.js'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: `${sceneMethods} MemberExpression[object.name='Math'][property.name='random']`,
          message:
            'Player attack path: use the attack generator (_playerAttackRng), never Math.random.',
        },
        { ...AMBIENT_DRAW, selector: `${sceneMethods} ${AMBIENT_DRAW.selector}` },
      ],
    },
  },
];

export default [
  js.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-empty': 'warn',
      'no-useless-assignment': 'warn',
    },
  },
  {
    // Native Node simulation and Vite share this JSON import.
    files: ['src/engine/ShopEconomy.js', 'src/engine/PortraitVariants.js'],
    languageOptions: { ecmaVersion: 2025 },
  },
  ...explicitRngRules,
  {
    ignores: [
      'dist/**',
      'ios/App/App/public/**', // Generated Capacitor copy of dist, including vendor bundles.
      'node_modules/**',
      'References/**',
      'public/data/**',
      'test-results/**',
      'playwright-report/**',
      'src/data/generated/**',
      '.tmp_netlify_*',
    ],
  },
];

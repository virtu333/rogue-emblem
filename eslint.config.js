import js from '@eslint/js';
import prettierConfig from 'eslint-config-prettier';
import globals from 'globals';

export default [
  js.configs.recommended,
  prettierConfig,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        // Build stamp (vite.config.js define, src/utils/buildIdentity.js).
        __BUILD_SHA__: 'readonly',
        __BUILD_DATE__: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': 'off',
      'no-empty': 'warn',
      'no-useless-assignment': 'warn',
      'no-restricted-syntax': [
        'error',
        {
          // esbuild lowers `a?.b?.()` for the build's Chrome 87 target; inside a default
          // value the lowering leaked a temporary (`o is not defined` at the prologue's
          // end). Resolve the default in the body instead.
          selector: 'AssignmentPattern > .right CallExpression[optional=true]',
          message:
            'No optional call in a default value: the build mis-lowers it. Resolve the default in the function body.',
        },
      ],
    },
  },
  {
    // Native Node simulation and Vite share this JSON import.
    files: [
      'src/engine/ShopEconomy.js',
      'src/engine/PortraitVariants.js',
      'src/engine/SpecialCharacters.js',
      'src/engine/SpecialCharacterPolicy.js',
      'src/engine/CantoRule.js',
      'src/engine/SkillSlots.js',
      'src/engine/MetaProgressionManager.js',
      'src/utils/audioAssets.js',
    ],
    languageOptions: { ecmaVersion: 2025 },
  },
  {
    // The engine holds the game's rules as pure modules: the harness, the sims and the UI
    // all import it, so it never reaches back into UI, scenes or Phaser. The UI importing
    // the engine is the intended direction. The files listed under `ignores` predate the
    // rule; move their UI calls out rather than adding a file here.
    files: ['src/engine/**/*.js'],
    ignores: ['src/engine/Grid.js', 'src/engine/LootRewardCommands.js'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [{ name: 'phaser', message: 'src/engine/ stays free of Phaser.' }],
          patterns: [
            {
              regex: '^(\\.\\./)+(ui|scenes)/',
              message:
                'src/engine/ must not import UI or scenes. Pass the value in, or move the shared helper into src/engine/ or src/utils/.',
            },
          ],
        },
      ],
    },
  },
  {
    ignores: [
      'dist/**',
      'ios/App/App/public/**', // Generated Capacitor copy of dist, including vendor bundles.
      'android/app/src/main/assets/public/**', // The same copy in the Android project.
      'android/**/build/**',
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

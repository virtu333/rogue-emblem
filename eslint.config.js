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
      globals: { ...globals.browser, ...globals.node },
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
      'src/utils/audioAssets.js',
    ],
    languageOptions: { ecmaVersion: 2025 },
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

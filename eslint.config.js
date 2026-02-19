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
    },
  },
  {
    ignores: [
      'dist/**',
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

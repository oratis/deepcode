// ESLint flat config — DeepCode monorepo.
// Spec: docs/DEVELOPMENT_PLAN.md §0 (engineering hygiene)
//
// Keep this list minimal: code style is enforced by Prettier; ESLint catches
// correctness issues only. Type-aware rules pull from each package's tsconfig.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  {
    ignores: [
      '**/dist/**',
      '**/dist-electron/**',
      '**/node_modules/**',
      '**/target/**', // Rust/Cargo build output (generated JS in src-tauri/target)
      '**/.tsbuildinfo',
      'release-artifacts/**',
      'apps/desktop/electron/**', // requires electron types — pending M6-rest
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        process: 'readonly',
        console: 'readonly',
        Buffer: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
        fetch: 'readonly',
        crypto: 'readonly',
      },
    },
    rules: {
      // Disable rules that conflict with current pragmatic patterns:
      '@typescript-eslint/no-explicit-any': 'off', // we use `unknown` cast pattern
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-async-promise-executor': 'off', // SessionManager uses this pattern
      // Tests deliberately use any
      'no-unused-vars': 'off',
    },
  },
  {
    // Tests can be looser
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
];

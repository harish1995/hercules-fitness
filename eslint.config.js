import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

// Architecture §1.1: only `src/services` (and `src/firebase`) may touch the Firebase SDK.
// UI layers and pure domain logic must never import it, directly or via the firebase module.
const FIREBASE_IMPORT_BAN = {
  patterns: [
    {
      group: ['firebase', 'firebase/*', '@firebase/*', '**/firebase', '**/firebase/*', '**/services/firebase*'],
      message:
        'Firebase may only be imported from src/services and src/firebase. Call a service (or a hook that wraps one) instead.',
    },
  ],
};

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'node_modules', '.firebase']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    plugins: { 'react-refresh': reactRefresh },
    languageOptions: {
      ecmaVersion: 2023,
      globals: globals.browser,
    },
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
    },
  },
  {
    // Everything under src except services/ and firebase/ (incl. types, config, utils and the shared test setup, so the
    // "no Firebase in src/types" rule cannot regress). Feature tests live next to the code they test and mock
    // `../services/*`, never the SDK, so they stay covered too; only services/*.test.ts may import Firebase.
    files: [
      'src/{pages,components,layouts,routes,context,hooks,domain,constants,theme,types,config,utils,test}/**/*.{ts,tsx}',
      'src/*.{ts,tsx}',
    ],
    rules: { 'no-restricted-imports': ['error', FIREBASE_IMPORT_BAN] },
  },
  {
    // Node-side files: config and rules-emulator tests.
    files: ['vite.config.ts', 'vitest.rules.config.ts', 'tests/**/*.ts', 'scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
]);

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'outputs/**', '.wrangler/**']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['api/**/*.js', 'src/server/**/*.js', 'tests/**/*.mjs', '*.config.js', 'migrate_inventory.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['tests/**/*.mjs', 'supabase/tests/**/*.mjs'],
    extends: [js.configs.recommended],
    // Browser globals are supplied by the disposable in-memory test fixtures.
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^_', argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/worker.js', 'public/*Worker.js'],
    languageOptions: { globals: globals.worker },
  },
])

import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'coverage', '.wrangler', 'worker-configuration.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: { ...reactHooks.configs.flat.recommended.rules, ...reactRefresh.configs.vite.rules },
  },
  { files: ['src/main.tsx'], rules: { 'react-refresh/only-export-components': 'off' } },
  { files: ['worker/**/*.ts'], languageOptions: { globals: { ...globals.worker } } },
  { files: ['scripts/**/*.ts', '*.config.{js,ts}'], languageOptions: { globals: { ...globals.node } } },
  {
    files: ['test/**/*.ts', '**/*.test.{ts,tsx}'],
    languageOptions: { globals: { ...globals.worker } },
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);

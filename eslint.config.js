// @ts-check
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import { createNodeResolver, importX } from 'eslint-plugin-import-x';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/dist/**',
      '**/dist-server/**',
      '**/data/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
      '**/node_modules/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: {
          // Build configs run in Node and belong to no app's tsconfig.
          allowDefaultProject: ['apps/*/rsbuild.config.ts'],
          defaultProject: 'tsconfig.base.json',
        },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
    },
    rules: {
      eqeqeq: ['error', 'always'],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
    },
  },
  {
    // Team boundaries: a package may reach another package only through its published name
    // (in practice: a contract), never by a relative path into its source.
    plugins: { 'import-x': importX },
    settings: {
      'import-x/resolver-next': [createNodeResolver({ extensions: ['.ts', '.tsx', '.js'] })],
    },
    rules: {
      'import-x/no-relative-packages': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              regex: '^@baseline/(?!.+-contract$)',
              message: 'Only @baseline/*-contract packages may cross a team boundary.',
            },
          ],
        },
      ],
    },
  },
  {
    // Domain code is plain TypeScript: no UI, no I/O, no other team's types.
    files: ['apps/*/src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { regex: '^react(-dom)?(/|$)', message: 'Domain code must not depend on React.' },
            { regex: '^@baseline/', message: 'Contracts are mapped outside the domain.' },
          ],
        },
      ],
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: [
            {
              target: './apps/delivery/src/domain',
              from: './apps/delivery/src',
              except: ['./domain'],
              message: 'Domain code must not import application, UI or infrastructure code.',
            },
            {
              target: './apps/people/src/domain',
              from: './apps/people/src',
              except: ['./domain'],
              message: 'Domain code must not import application, UI or infrastructure code.',
            },
          ],
        },
      ],
    },
  },
  {
    // The browser bundle must never pull in the Node server that sits in the same package.
    files: ['apps/*/src/{ui,application,infrastructure}/**/*.{ts,tsx}', 'apps/*/src/*.tsx'],
    rules: {
      'import-x/no-restricted-paths': [
        'error',
        {
          zones: ['people', 'delivery'].map((app) => ({
            target: `./apps/${app}/src`,
            from: `./apps/${app}/src/server`,
            except: [],
            message: 'Front-end code must not import the Node server.',
          })),
        },
      ],
    },
  },
  {
    files: ['apps/**/*.tsx'],
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    extends: [tseslint.configs.disableTypeChecked],
  },
  {
    // ESLint knows no Node or web-platform globals without another package; only these few are used.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        AbortController: 'readonly',
        AbortSignal: 'readonly',
        URL: 'readonly',
        console: 'readonly',
        fetch: 'readonly',
      },
    },
  },
);

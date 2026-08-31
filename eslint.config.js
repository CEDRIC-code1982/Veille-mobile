import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const NO_FOR_EACH = {
  selector: "CallExpression[callee.property.name='forEach']",
  message: 'forEach() is banned by the coding conventions, use for...of instead.',
};

const NO_ENUM_KEYWORD = {
  selector: 'TSEnumDeclaration',
  message: 'The enum keyword is banned, use an "as const" object plus a type of the same name.',
};

const NO_DEFAULT_EXPORT = {
  selector: 'ExportDefaultDeclaration',
  message: 'Default exports are banned by the coding conventions, use a named export.',
};

/** Rules shared by every linted file, whatever the language. */
const commonRules = {
  curly: ['error', 'all'],
  eqeqeq: ['error', 'always'],
  'no-var': 'error',
  'prefer-const': 'error',
  'no-restricted-syntax': ['error', NO_FOR_EACH, NO_ENUM_KEYWORD, NO_DEFAULT_EXPORT],
};

/** Browser and service worker globals used by the dependency-free static site. */
const browserGlobals = {
  caches: 'readonly',
  clients: 'readonly',
  console: 'readonly',
  document: 'readonly',
  fetch: 'readonly',
  localStorage: 'readonly',
  location: 'readonly',
  navigator: 'readonly',
  Request: 'readonly',
  Response: 'readonly',
  self: 'readonly',
  URL: 'readonly',
  window: 'readonly',
};

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'data/**', 'digest/**', 'coverage/**'],
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'vitest.config.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      ...commonRules,
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/restrict-template-expressions': [
        'error',
        { allowNumber: true, allowBoolean: true },
      ],
    },
  },
  {
    // Tool configuration files are required by their own tooling to default-export.
    files: ['vitest.config.ts', 'eslint.config.js'],
    rules: {
      'no-restricted-syntax': ['error', NO_FOR_EACH, NO_ENUM_KEYWORD],
    },
  },
  {
    files: ['site/**/*.js'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'script',
      globals: browserGlobals,
    },
    rules: commonRules,
  },
  {
    files: ['eslint.config.js'],
    extends: [js.configs.recommended],
    languageOptions: { sourceType: 'module' },
  },
);

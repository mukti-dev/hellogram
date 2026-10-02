import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Clean-architecture boundaries (docs/ARCHITECTURE.md §3.2):
 * domain is pure, application depends only on domain/shared, frameworks stay at the edges.
 */
const FRAMEWORK_IMPORTS = [
  { group: ['fastify', 'fastify-*', '@fastify/*'], message: 'Fastify belongs in apps/api (routes/controllers/plugins) only.' },
  { group: ['@prisma/*', '@hellogram/db'], message: 'Database access belongs in packages/infrastructure repositories.' },
  { group: ['ioredis', 'bullmq', 'socket.io', '@socket.io/*'], message: 'Transport/queue libraries belong in infrastructure or app edges.' },
  { group: ['@hellogram/infrastructure'], message: 'Depend on ports (interfaces) from @hellogram/domain instead.' },
  { group: ['react', 'react-dom'], message: 'UI frameworks are not allowed in backend layers.' },
];

export default tseslint.config(
  { ignores: ['**/dist/**', 'apps/web/public/**', '**/node_modules/**', '**/generated/**', '**/dev-dist/**', '**/.turbo/**', '.claude/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node } },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // k6 scripts run in k6's JS runtime, not Node.
    files: ['tests/load/**/*.js'],
    languageOptions: { globals: { __ENV: 'readonly', __VU: 'readonly', __ITER: 'readonly' } },
  },
  {
    files: ['packages/domain/**/*.ts', 'packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [...FRAMEWORK_IMPORTS, { group: ['@hellogram/application'], message: 'Domain must not depend on application.' }] },
      ],
    },
  },
  {
    files: ['packages/application/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: FRAMEWORK_IMPORTS }] },
  },
  {
    files: ['apps/api/src/modules/**/*.controller.ts', 'apps/api/src/modules/**/*.routes.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [FRAMEWORK_IMPORTS[1], FRAMEWORK_IMPORTS[3]] },
      ],
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}', 'packages/ui/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@hellogram/db', '@hellogram/infrastructure', '@hellogram/application'], message: 'Frontend must not import backend layers.' }] },
      ],
    },
  },
);

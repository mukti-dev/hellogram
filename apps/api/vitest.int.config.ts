import { defineConfig } from 'vitest/config';

/** Integration tests: real Postgres (hellogram_test) + Redis from `pnpm db:up`. */
export default defineConfig({
  test: {
    include: ['test/integration/**/*.int.test.ts'],
    globalSetup: ['test/integration/global-setup.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});

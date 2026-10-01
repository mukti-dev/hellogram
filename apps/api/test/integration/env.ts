export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://hellogram:hellogram@localhost:5433/hellogram_test';
export const TEST_REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1';

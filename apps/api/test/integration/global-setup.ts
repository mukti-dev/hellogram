import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { TEST_DATABASE_URL } from './env.js';

/** Creates the test database if needed and applies all migrations. */
export default async function setup() {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.slice(1);
  const admin = new pg.Client({ connectionString: Object.assign(new URL(url), { pathname: '/postgres' }).toString() });
  await admin.connect();
  const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await admin.query(`CREATE DATABASE "${dbName}"`);
  await admin.end();

  execSync('pnpm exec prisma migrate deploy', {
    cwd: fileURLToPath(new URL('../../../../packages/db', import.meta.url)),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}

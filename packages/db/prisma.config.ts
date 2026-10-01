import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // `prisma generate` doesn't need a database; migrate/seed commands do and will fail clearly.
    url: process.env.DATABASE_URL ?? 'postgresql://unset:unset@localhost:5432/unset',
  },
});

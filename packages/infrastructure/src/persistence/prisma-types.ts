import type { Prisma, PrismaClient } from '@hellogram/db';

/** Repositories accept either the root client or a transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

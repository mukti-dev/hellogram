import { AdminService } from '@hellogram/application';
import { createPrismaClient } from '@hellogram/db';
import { systemClock } from '@hellogram/domain';
import {
  Argon2PinHasher,
  PrismaAdminRepository,
  PrismaAuditRepository,
  PrismaGrievanceRepository,
  Totp,
} from '@hellogram/infrastructure';
import type { AdminEnv } from './env.js';

export function createAdminContainer(env: AdminEnv) {
  const prisma = createPrismaClient(env.DATABASE_URL);
  const adminService = new AdminService({
    admins: new PrismaAdminRepository(prisma),
    grievances: new PrismaGrievanceRepository(prisma),
    audit: new PrismaAuditRepository(prisma),
    // argon2id — same hasher as PINs, with the same memory-hard settings.
    hasher: new Argon2PinHasher(),
    totp: new Totp(),
    clock: systemClock,
  });
  return { adminService, close: () => prisma.$disconnect() };
}

export type AdminContainer = ReturnType<typeof createAdminContainer>;

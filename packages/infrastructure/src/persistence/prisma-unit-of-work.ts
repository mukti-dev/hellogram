import type { PrismaClient } from '@hellogram/db';
import type { UnitOfWork } from '@hellogram/domain';
import type { Db } from './prisma-types.js';

/**
 * Runs work inside one Prisma interactive transaction. `makeRepos` binds the
 * repositories to the transaction client, so services never import Prisma.
 */
export class PrismaUnitOfWork<TRepos> implements UnitOfWork<TRepos> {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly makeRepos: (db: Db) => TRepos,
  ) {}

  run<T>(work: (repos: TRepos) => Promise<T>): Promise<T> {
    return this.prisma.$transaction((tx) => work(this.makeRepos(tx)));
  }
}

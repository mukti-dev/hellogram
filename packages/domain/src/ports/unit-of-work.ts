/**
 * Lets services define transaction boundaries without importing Prisma.
 * `TRepos` is the set of repositories bound to the running transaction.
 */
export interface UnitOfWork<TRepos> {
  run<T>(work: (repos: TRepos) => Promise<T>): Promise<T>;
}

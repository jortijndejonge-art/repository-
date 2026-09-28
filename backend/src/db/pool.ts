import pg from 'pg';

// Return bigint counts as numbers and keep timestamps as ISO strings.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.TIMESTAMPTZ, (v) => new Date(v).toISOString());

export const DEFAULT_DATABASE_URL = 'postgres://hockey:hockey@localhost:5432/hockey';

export function createPool(connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL) {
  return new pg.Pool({ connectionString, max: 10 });
}

export type Pool = pg.Pool;

import { getTableColumns } from 'drizzle-orm';
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import type { SQLiteTable } from 'drizzle-orm/sqlite-core';
import { getCfEnv } from '../cf';
import * as schema from './schema';

export type Db = DrizzleD1Database<typeof schema>;
/**
 * D1 has no interactive transactions, so services take the database handle
 * directly and group writes that must land together with `db.batch()`.
 */
export type Tx = Db;

const cache = new WeakMap<D1Database, Db>();

export function getDb(): Db {
  const binding = getCfEnv().DB;
  let db = cache.get(binding);
  if (!db) cache.set(binding, (db = drizzle(binding, { schema })));
  return db;
}

export { schema };

/** D1 allows 100 bound parameters per statement. */
const MAX_PARAMS = 100;

/** Multi-row insert split into statements that fit D1's parameter limit (for db.batch). */
export function insertStatements<T extends SQLiteTable>(db: Db, table: T, rows: T['$inferInsert'][], options: { onConflictDoNothing?: boolean } = {}) {
  const perStatement = Math.max(1, Math.floor(MAX_PARAMS / Object.keys(getTableColumns(table)).length));
  const statements = [];
  for (let i = 0; i < rows.length; i += perStatement) {
    const insert = db.insert(table).values(rows.slice(i, i + perStatement) as never);
    statements.push(options.onConflictDoNothing ? insert.onConflictDoNothing() : insert);
  }
  return statements;
}

export async function insertMany<T extends SQLiteTable>(db: Db, table: T, rows: T['$inferInsert'][], options: { onConflictDoNothing?: boolean } = {}): Promise<void> {
  for (const statement of insertStatements(db, table, rows, options)) await statement;
}

/** Splits ids for `inArray` so each query stays under the parameter limit. */
export function chunk<T>(items: T[], size = 90): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

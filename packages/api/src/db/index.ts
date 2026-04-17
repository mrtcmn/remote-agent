import { isLocalMode } from '../config/mode';
import { getLocalDbPath } from '../config/paths';
import { mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

// Typed as `any` because Drizzle's PG and SQLite database types have
// incompatible method signatures (insert/update/delete builders differ).
// A union type would make every db.insert()/update()/delete() call a TS error.
// At runtime, only one driver is ever loaded.
let db: any;

if (isLocalMode()) {
  const { Database } = await import('bun:sqlite');
  const sqliteSchema = await import('./schema.sqlite');
  const { drizzle } = await import('drizzle-orm/bun-sqlite');

  const dbPath = getLocalDbPath();
  await mkdir(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');

  db = drizzle(sqlite, { schema: sqliteSchema });
} else {
  const { default: postgres } = await import('postgres');
  const pgSchema = await import('./schema.pg');
  const { drizzle } = await import('drizzle-orm/postgres-js');

  const connectionString = process.env.DATABASE_URL || 'postgres://agent:agent@localhost:5432/remote_agent';
  const client = postgres(connectionString);

  db = drizzle(client, { schema: pgSchema });
}

export { db };
export * from './schema';

export {}; // Ensure this file is treated as a module

const isLocal = (process.env.RA_MODE || process.env.REMOTE_AGENT_MODE) === 'local';

if (isLocal) {
  const { migrate } = await import('drizzle-orm/bun-sqlite/migrator');
  const { drizzle } = await import('drizzle-orm/bun-sqlite');
  const { Database } = await import('bun:sqlite');
  const { dirname } = await import('node:path');
  const { mkdir } = await import('node:fs/promises');
  // Same path the server opens, so RA_HOME migrates the right database.
  const { getLocalDbPath } = await import('../config/paths');

  const dbPath = getLocalDbPath();
  await mkdir(dirname(dbPath), { recursive: true });

  const sqlite = new Database(dbPath);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  sqlite.exec('PRAGMA foreign_keys = ON;');
  const db = drizzle(sqlite);

  console.log('Running SQLite migrations...');
  migrate(db, { migrationsFolder: './drizzle-sqlite' });
  console.log('SQLite migrations complete!');

  sqlite.close();
} else {
  const { migrate } = await import('drizzle-orm/postgres-js/migrator');
  const { drizzle } = await import('drizzle-orm/postgres-js');
  const { default: postgres } = await import('postgres');

  const connectionString = process.env.DATABASE_URL || 'postgres://agent:agent@localhost:5432/remote_agent';
  const client = postgres(connectionString, { max: 1 });
  const db = drizzle(client);

  console.log('Running PostgreSQL migrations...');
  await migrate(db, { migrationsFolder: './drizzle' });
  console.log('PostgreSQL migrations complete!');

  await client.end();
}

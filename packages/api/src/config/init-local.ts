import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { getWorkspacesRoot, getSSHKeysRoot, getConfigRoot, getTemplatesRoot, getLocalDbPath } from './paths';

export async function initLocal(): Promise<void> {
  // Create directory structure
  const dirs = [
    getWorkspacesRoot(),
    getSSHKeysRoot(),
    getConfigRoot(),
    getTemplatesRoot(),
    dirname(getLocalDbPath()),
  ];

  await Promise.all(dirs.map(dir => mkdir(dir, { recursive: true })));

  // Auto-run SQLite migrations if database is new
  const dbPath = getLocalDbPath();
  const isNewDb = !existsSync(dbPath);

  if (isNewDb) {
    console.log('New local database — running migrations...');
    try {
      const { Database } = await import('bun:sqlite');
      const { drizzle } = await import('drizzle-orm/bun-sqlite');
      const { migrate } = await import('drizzle-orm/bun-sqlite/migrator');

      const sqlite = new Database(dbPath);
      sqlite.exec('PRAGMA journal_mode = WAL;');
      sqlite.exec('PRAGMA foreign_keys = ON;');
      const migrationDb = drizzle(sqlite);

      migrate(migrationDb, { migrationsFolder: './drizzle-sqlite' });
      sqlite.close();
      console.log('SQLite migrations complete.');
    } catch (err) {
      console.warn('SQLite migration failed (migrations may not be generated yet):', err);
      console.warn('Run: bun run db:generate:sqlite && bun run db:migrate:sqlite');
    }
  }

  console.log('Local directories initialized.');
}

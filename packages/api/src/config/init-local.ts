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

  // Run SQLite migrations on every start: the migrator skips the applied ones,
  // so an update with a new table works without a manual db:migrate.
  const dbPath = getLocalDbPath();
  const isNewDb = !existsSync(dbPath);

  console.log(isNewDb ? 'New local database — running migrations...' : 'Running pending SQLite migrations...');
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

  console.log('Local directories initialized.');
}

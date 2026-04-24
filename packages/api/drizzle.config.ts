import { defineConfig } from 'drizzle-kit';

const isLocal = process.env.REMOTE_AGENT_MODE === 'local';

export default defineConfig(isLocal ? {
  schema: './src/db/schema.sqlite.ts',
  out: './drizzle-sqlite',
  dialect: 'sqlite',
  dbCredentials: {
    url: process.env.SQLITE_DB_PATH || `${process.env.HOME}/remote-agent/data/local.db`,
  },
} : {
  schema: './src/db/schema.pg.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL || 'postgres://agent:agent@localhost:5432/remote_agent',
  },
});

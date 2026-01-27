import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL || 'postgres://agent:agent@localhost:5432/remote_agent';

const client = postgres(connectionString);

export const db = drizzle(client, { schema });

export * from './schema';

import { eq } from 'drizzle-orm';
import { db } from '../db';
import { appSettings } from '../db/schema';

const ORIGINS_KEY = 'allowed_origins';

class OriginsService {
  private origins: string[] = [];

  /** Load origins from DB on startup; fall back to env vars */
  async initialize() {
    const row = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, ORIGINS_KEY))
      .then((rows) => rows[0]);

    if (row) {
      this.origins = JSON.parse(row.value) as string[];
      console.log(`Origins loaded from DB (${this.origins.length})`);
    } else {
      this.origins = this.getDefaults();
      console.log(`Origins using defaults (${this.origins.length})`);
    }
  }

  /** Return current allowed origins */
  getOrigins(): string[] {
    return this.origins;
  }

  /** Check if an origin is allowed */
  isAllowed(origin: string): boolean {
    return this.origins.includes(origin);
  }

  /** Persist new origins list to DB and update cache */
  async setOrigins(origins: string[]): Promise<string[]> {
    const value = JSON.stringify(origins);

    await db
      .insert(appSettings)
      .values({ key: ORIGINS_KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, updatedAt: new Date() },
      });

    this.origins = origins;
    return this.origins;
  }

  private getDefaults(): string[] {
    const defaults: string[] = [];
    const appUrl = process.env.APP_URL;
    const corsOrigin = process.env.CORS_ORIGIN;

    if (appUrl) defaults.push(appUrl);
    if (corsOrigin && corsOrigin !== '*') {
      for (const o of corsOrigin.split(',')) {
        const trimmed = o.trim();
        if (trimmed && !defaults.includes(trimmed)) defaults.push(trimmed);
      }
    }

    // Always include common dev origins
    for (const dev of ['http://localhost:5173', 'http://localhost:5100']) {
      if (!defaults.includes(dev)) defaults.push(dev);
    }

    return defaults;
  }
}

export const originsService = new OriginsService();

import os from 'node:os';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { appSettings } from '../db/schema';

const KEY = 'machine_self_name';

/**
 * This machine's own stable name — sent when pairing with a master so the
 * secondary carries a persistent identity, instead of whatever nickname the
 * "pair with a master" form happened to collect for the *master* that turn.
 */
class MachineIdentityService {
  private name = '';

  async initialize() {
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
    this.name = rows[0]?.value || os.hostname();
  }

  get(): string {
    return this.name || os.hostname();
  }

  async set(name: string): Promise<string> {
    this.name = name;
    await db
      .insert(appSettings)
      .values({ key: KEY, value: name, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: name, updatedAt: new Date() } });
    return this.name;
  }
}

export const machineIdentity = new MachineIdentityService();

import os from 'node:os';
import { eq } from 'drizzle-orm';
import { db } from '../db';
import { appSettings } from '../db/schema';
import { getDefaultPort } from '../config/paths';

const KEY = 'direct_address';
const REDETECT_MS = 5 * 60 * 1000;

export interface StoredAddress { url: string; source: 'auto' | 'user' }
type Interfaces = Record<string, { address: string; family: string | number; internal: boolean }[] | undefined>;

/** Tailscale hands out addresses from the CGNAT range 100.64.0.0/10. */
function isTailscale(address: string): boolean {
  const [a, b] = address.split('.').map(Number);
  return a === 100 && b >= 64 && b <= 127;
}

/**
 * The address other machines can try first. A container cannot see the host's
 * Tailscale interface, so TAILSCALE_IP seeds the value there.
 */
export function detect(interfaces: Interfaces, port: number, env: Record<string, string | undefined>): string | null {
  for (const list of Object.values(interfaces)) {
    for (const i of list ?? []) {
      if (!i.internal && (i.family === 'IPv4' || i.family === 4) && isTailscale(i.address)) {
        return `http://${i.address}:${port}`;
      }
    }
  }
  const seed = env.TAILSCALE_IP?.trim();
  return seed ? `http://${seed}:${env.PORT || port}` : null;
}

export function effective(stored: StoredAddress | null, detected: string | null): string | null {
  return stored?.source === 'user' ? stored.url : detected;
}

class DirectAddress {
  private stored: StoredAddress | null = null;
  private detected: string | null = null;

  async initialize(): Promise<void> {
    const row = await db.select().from(appSettings).where(eq(appSettings.key, KEY)).then((r: { value: string }[]) => r[0]);
    try { this.stored = row ? JSON.parse(row.value) as StoredAddress : null; } catch { this.stored = null; }
    await this.redetect();
    // A laptop's Tailscale address appears some time after boot.
    setInterval(() => this.redetect().catch(() => {}), REDETECT_MS).unref();
  }

  get(): string | null {
    return effective(this.stored, this.detected);
  }

  describe(): { url: string | null; source: 'auto' | 'user'; detected: string | null } {
    return { url: this.get(), source: this.stored?.source === 'user' ? 'user' : 'auto', detected: this.detected };
  }

  /** A URL is the user's override; null returns to the detected value. */
  async set(url: string | null): Promise<void> {
    if (url) {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('The address must start with http:// or https://');
      await this.write({ url: parsed.origin, source: 'user' });
    } else {
      this.stored = null;
      await db.delete(appSettings).where(eq(appSettings.key, KEY));
      await this.redetect();
    }
  }

  private async redetect(): Promise<void> {
    this.detected = detect(os.networkInterfaces() as Interfaces, getDefaultPort(), process.env);
    if (this.stored?.source === 'user') return;
    if (this.detected && this.detected !== this.stored?.url) await this.write({ url: this.detected, source: 'auto' });
  }

  private async write(value: StoredAddress): Promise<void> {
    this.stored = value;
    const json = JSON.stringify(value);
    await db.insert(appSettings)
      .values({ key: KEY, value: json, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: json, updatedAt: new Date() } });
  }
}

export const directAddress = new DirectAddress();

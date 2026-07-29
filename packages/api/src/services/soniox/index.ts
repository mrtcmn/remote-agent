import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { appSettings } from '../../db/schema';
import { decrypt, encrypt } from '../crypto/secret-box';

const KEY = 'soniox';

/** On-disk shape: apiKey is AES-GCM encrypted (base64), like the LLM/SSH secrets. */
interface Stored {
  apiKeyEnc?: string;
}

/** Server-wide Soniox API key for browser dictation (minting temporary keys). */
class SonioxSettingsService {
  private apiKey = '';

  async initialize() {
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
    const row = rows[0];
    if (row) {
      const s = JSON.parse(row.value) as Stored;
      this.apiKey = s.apiKeyEnc ? decrypt(Buffer.from(s.apiKeyEnc, 'base64')) : '';
    }
  }

  /** Stored key wins; SONIOX_API_KEY env is a fallback so deploys can preset it. */
  get(): string {
    return this.apiKey || process.env.SONIOX_API_KEY || '';
  }

  hasKey(): boolean {
    return Boolean(this.get());
  }

  async set(apiKey: string): Promise<void> {
    this.apiKey = apiKey;
    const stored: Stored = apiKey ? { apiKeyEnc: encrypt(apiKey).toString('base64') } : {};
    const value = JSON.stringify(stored);
    await db
      .insert(appSettings)
      .values({ key: KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
  }
}

export const sonioxSettings = new SonioxSettingsService();

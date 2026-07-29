import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { appSettings } from '../../db/schema';
import { decrypt, encrypt } from '../crypto/secret-box';

const KEY = 'llm_engine';

export type LLMProvider = 'claude-code' | 'openai';

export interface LLMConfig {
  provider: LLMProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

/** On-disk shape: apiKey is AES-GCM encrypted (base64), like SSH/GitHub secrets. */
interface StoredConfig {
  provider?: LLMProvider;
  baseUrl?: string;
  model?: string;
  apiKeyEnc?: string;
}

const DEFAULT: LLMConfig = { provider: 'claude-code', baseUrl: '', apiKey: '', model: '' };

/** Server-wide engine config for notification classification/summaries + slides. */
class LLMSettingsService {
  private cfg: LLMConfig = DEFAULT;

  async initialize() {
    const rows = await db.select().from(appSettings).where(eq(appSettings.key, KEY));
    const row = rows[0];
    if (row) {
      const s = JSON.parse(row.value) as StoredConfig;
      this.cfg = {
        provider: s.provider ?? DEFAULT.provider,
        baseUrl: s.baseUrl ?? '',
        model: s.model ?? '',
        apiKey: s.apiKeyEnc ? decrypt(Buffer.from(s.apiKeyEnc, 'base64')) : '',
      };
    }
    console.log(`LLM engine: ${this.cfg.provider}${this.cfg.model ? ` (${this.cfg.model})` : ''}`);
  }

  get(): LLMConfig {
    return this.cfg;
  }

  async set(patch: Partial<LLMConfig>): Promise<LLMConfig> {
    this.cfg = { ...this.cfg, ...patch };
    const stored: StoredConfig = {
      provider: this.cfg.provider,
      baseUrl: this.cfg.baseUrl,
      model: this.cfg.model,
      ...(this.cfg.apiKey ? { apiKeyEnc: encrypt(this.cfg.apiKey).toString('base64') } : {}),
    };
    const value = JSON.stringify(stored);
    await db
      .insert(appSettings)
      .values({ key: KEY, value, updatedAt: new Date() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
    return this.cfg;
  }
}

export const llmSettings = new LLMSettingsService();

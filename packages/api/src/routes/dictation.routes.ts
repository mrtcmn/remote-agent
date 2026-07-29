import { Elysia } from 'elysia';
import { sonioxSettings } from '../services/soniox';

// Mint a short-lived Soniox key for the browser so the real key never leaves the
// server. https://soniox.com/docs/speech-to-text/guides/temporary-api-keys
const SONIOX_TEMP_KEY_URL = 'https://api.soniox.com/v1/auth/temporary-api-key';

export const dictationRoutes = new Elysia({ prefix: '/dictation' })
  .get('/token', async ({ set }) => {
    const key = sonioxSettings.get();
    if (!key) {
      set.status = 503;
      return { error: 'Dictation not configured — add a Soniox API key in Settings.' };
    }

    const res = await fetch(SONIOX_TEMP_KEY_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      // The key only has to live long enough to open the socket; the session
      // outlives it. transcribe_websocket scopes it to real-time STT.
      body: JSON.stringify({ usage_type: 'transcribe_websocket', expires_in_seconds: 120 }),
    });

    if (!res.ok) {
      set.status = 502;
      return { error: `Soniox rejected the key request (${res.status})` };
    }

    const data = (await res.json()) as { api_key: string; expires_at: string };
    return { apiKey: data.api_key, expiresAt: data.expires_at };
  });

// AES-256-GCM secret box for SSH credentials at rest.
// Master key is auto-generated on first run and stored in the config dir with
// mode 0600 — no env var required. Blob layout: iv(12) | authTag(16) | ciphertext.
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { getConfigRoot } from '../../config/paths';

const IV_LEN = 12;
const TAG_LEN = 16;

let cachedKey: Buffer | null = null;

function keyPath(): string {
  return join(getConfigRoot(), 'secret.key');
}

// ponytail: single on-disk key, no rotation. Add a keyring + version byte only if rotation is ever needed.
function loadKey(): Buffer {
  if (cachedKey) return cachedKey;
  const path = keyPath();
  if (existsSync(path)) {
    cachedKey = readFileSync(path);
  } else {
    mkdirSync(getConfigRoot(), { recursive: true });
    cachedKey = randomBytes(32);
    writeFileSync(path, cachedKey, { mode: 0o600 });
  }
  if (cachedKey.length !== 32) throw new Error('secret.key is not 32 bytes');
  return cachedKey;
}

export function encrypt(plaintext: string): Buffer {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', loadKey(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ct]);
}

export function decrypt(blob: Buffer): string {
  const iv = blob.subarray(0, IV_LEN);
  const tag = blob.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ct = blob.subarray(IV_LEN + TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', loadKey(), iv);
  decipher.setAuthTag(tag);
  return decipher.update(ct, undefined, 'utf8') + decipher.final('utf8');
}

// Self-check: `bun run src/services/crypto/secret-box.ts`
if (import.meta.main) {
  const secret = 'hunter2\n-----BEGIN KEY-----';
  const blob = encrypt(secret);
  if (decrypt(blob) !== secret) throw new Error('roundtrip failed');
  const tampered = Buffer.from(blob);
  tampered[tampered.length - 1] ^= 0xff;
  let threw = false;
  try { decrypt(tampered); } catch { threw = true; }
  if (!threw) throw new Error('GCM auth did not reject tampered blob');
  console.log('secret-box self-check OK');
}

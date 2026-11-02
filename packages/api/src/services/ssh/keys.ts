// SSH identities for the credential vault: check a key before it is stored,
// make new ones, and read the user's own from ~/.ssh. The private half only
// ever leaves here into secret-box (AES-256-GCM) — never back to the UI.
import { utils } from 'ssh2';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve, sep } from 'node:path';

export interface KeyInfo {
  type: string;
  /** authorized_keys line: "ssh-ed25519 AAAA… comment". */
  publicKey: string;
  /** SHA256:… — what `ssh-keygen -lf` and the server logs print. */
  fingerprint: string;
}

/** Parse a private key; throws a message the user can act on. */
export function inspectKey(privateKey: string, passphrase?: string): KeyInfo {
  const parsed = utils.parseKey(privateKey.trim() + '\n', passphrase || undefined);
  if (parsed instanceof Error) {
    if (/no passphrase/i.test(parsed.message)) throw new Error('This key is encrypted — enter its passphrase');
    if (/bad passphrase|integrity check/i.test(parsed.message)) throw new Error('Wrong passphrase for this key');
    throw new Error(`Not a valid private key: ${parsed.message}`);
  }
  const key = Array.isArray(parsed) ? parsed[0] : parsed;
  if (!key.isPrivateKey()) throw new Error('This is a public key — paste the private key');
  const blob = key.getPublicSSH();
  const comment = key.comment ? ` ${key.comment}` : '';
  return {
    type: key.type,
    publicKey: `${key.type} ${blob.toString('base64')}${comment}`,
    fingerprint: `SHA256:${createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`,
  };
}

/** A new ed25519 key pair, OpenSSH format, no passphrase (the vault encrypts it). */
export function generateKey(comment: string): { privateKey: string } & KeyInfo {
  const pair = utils.generateKeyPairSync('ed25519', { comment });
  return { privateKey: pair.private, ...inspectKey(pair.private) };
}

const sshDir = () => join(homedir(), '.ssh');

/** Private keys in ~/.ssh, found by their PEM/OpenSSH header — contents are not returned. */
export function listLocalIdentities(): Array<{ file: string; encrypted: boolean; publicKey: string | null }> {
  let names: string[];
  try {
    names = readdirSync(sshDir());
  } catch {
    return [];
  }
  const out: Array<{ file: string; encrypted: boolean; publicKey: string | null }> = [];
  for (const file of names) {
    const path = join(sshDir(), file);
    try {
      if (!statSync(path).isFile() || statSync(path).size > 64 * 1024) continue;
      const text = readFileSync(path, 'utf8');
      if (!/^-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(text)) continue;
      let encrypted = false;
      let publicKey: string | null = null;
      try {
        publicKey = inspectKey(text).publicKey;
      } catch (err) {
        encrypted = /passphrase/i.test((err as Error).message);
        if (!encrypted) continue;
      }
      out.push({ file, encrypted, publicKey });
    } catch {
      // unreadable file: skip
    }
  }
  return out;
}

/** Read one key from ~/.ssh by file name; refuses paths outside it. */
export function readLocalIdentity(file: string): string {
  const path = resolve(sshDir(), file);
  if (!path.startsWith(sshDir() + sep)) throw new Error('Key must be in ~/.ssh');
  return readFileSync(path, 'utf8');
}

// Self-check: `bun run src/services/ssh/keys.ts`
if (import.meta.main) {
  const made = generateKey('self-check');
  if (!made.publicKey.startsWith('ssh-ed25519 ') || !made.publicKey.endsWith(' self-check')) throw new Error('bad public key');
  if (inspectKey(made.privateKey).fingerprint !== made.fingerprint) throw new Error('fingerprint not stable');
  const locked = utils.generateKeyPairSync('ed25519', { passphrase: 'pw', cipher: 'aes256-ctr', rounds: 16 }).private;
  const throws = (fn: () => unknown, re: RegExp) => {
    try { fn(); } catch (e) { if (re.test((e as Error).message)) return; throw e; }
    throw new Error(`expected ${re}`);
  };
  throws(() => inspectKey(locked), /encrypted/);
  throws(() => inspectKey(locked, 'nope'), /Wrong passphrase/);
  inspectKey(locked, 'pw');
  throws(() => inspectKey(made.publicKey), /./);
  throws(() => readLocalIdentity('../.bashrc'), /~\/\.ssh/);
  console.log('ssh keys self-check OK');
}

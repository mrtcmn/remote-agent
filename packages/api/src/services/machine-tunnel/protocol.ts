/**
 * Frame protocol for the machine tunnel.
 *
 * A secondary holds a WebSocket open to its master; both directions multiplex
 * request/response and WS-bridge traffic over it, keyed by `id`.
 *
 * ponytail: bodies are base64 in a single frame — no chunking. API payloads are
 * small and terminal I/O uses the ws* frames instead. If large file downloads
 * ever route through here, add a `chunk` frame and stream instead.
 */

export type Frame =
  // ── request/response (master → secondary) ──
  | { t: 'req'; id: string; method: string; path: string; headers: Record<string, string>; body?: string }
  | { t: 'res'; id: string; status: number; statusText?: string; headers: Record<string, string>; body?: string }
  | { t: 'err'; id: string; message: string }
  // ── websocket bridge (master → secondary, then bidirectional per id) ──
  | { t: 'wsopen'; id: string; path: string }
  | { t: 'wsready'; id: string }
  | { t: 'wsmsg'; id: string; data: string; binary?: boolean }
  | { t: 'wsclose'; id: string; code?: number; reason?: string }
  // ── liveness (either direction) ──
  | { t: 'ping' }
  | { t: 'pong' }
  // ── secondary → master status push (replaces the HTTP heartbeat) ──
  | { t: 'heartbeat'; sessionCount: number; version?: string };

export function encodeFrame(frame: Frame): string {
  return JSON.stringify(frame);
}

/** Parse an inbound frame. Returns null for anything malformed — never throws. */
export function decodeFrame(raw: unknown): Frame | null {
  let text: string;
  if (typeof raw === 'string') text = raw;
  else if (raw instanceof ArrayBuffer) text = new TextDecoder().decode(raw);
  else if (raw && typeof raw === 'object') {
    // Elysia auto-parses JSON-looking strings into objects before the handler.
    return isFrame(raw) ? (raw as Frame) : null;
  } else return null;

  try {
    const parsed = JSON.parse(text) as unknown;
    return isFrame(parsed) ? (parsed as Frame) : null;
  } catch {
    return null;
  }
}

function isFrame(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const t = (value as { t?: unknown }).t;
  return typeof t === 'string';
}

/**
 * Bytes backed by a plain ArrayBuffer. Node's Buffer is `Uint8Array<ArrayBufferLike>`,
 * which TS will not accept as a `BodyInit` for Request/Response/fetch — so copy
 * into a real ArrayBuffer once, here, instead of casting at every call site.
 */
export type Bytes = Uint8Array<ArrayBuffer>;

export function bytesToBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

export function base64ToBytes(b64: string): Bytes {
  const buf = Buffer.from(b64, 'base64');
  const out = new Uint8Array(buf.byteLength) as Bytes;
  out.set(buf);
  return out;
}

/** Headers → plain object, dropping hop-by-hop entries that must not cross the tunnel. */
const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade', 'host',
  'content-length', 'content-encoding', 'accept-encoding',
]);

export function serializeHeaders(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out[key] = value;
  });
  return out;
}

export function deserializeHeaders(raw: Record<string, string>): Headers {
  const out = new Headers();
  for (const [key, value] of Object.entries(raw)) {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.set(key, value);
  }
  return out;
}

import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * A short-lived pass for a call on a machine's direct address, where the
 * long-lived machineToken must not travel (the hop can be plain http).
 *
 * The key is sha256(machineToken) of the secondary on one end of the call. The
 * hub stores it as `machines.token_hash`; the secondary derives it from its own
 * token. So no new secret exists, and the hub can sign for any of its machines.
 *
 * `to` is the secondary's machine id, or 'hub' when a secondary calls its hub.
 */
export interface Ticket { from: string; to: string; exp: number }

export const TICKET_TTL_MS = 10 * 60 * 1000;
export const TICKET_SCHEME = 'Ticket ';

const mac = (payload: string, key: string) => createHmac('sha256', key).update(payload).digest();

export function tokenKey(machineToken: string): string {
  return new Bun.CryptoHasher('sha256').update(machineToken).digest('hex');
}

export function signTicket(ticket: Ticket, key: string): string {
  const payload = Buffer.from(JSON.stringify(ticket)).toString('base64url');
  return `${payload}.${mac(payload, key).toString('hex')}`;
}

/** The payload, not yet trusted — only to find which key must verify it. */
export function peekTicket(raw: string): Ticket | null {
  try {
    const t = JSON.parse(Buffer.from(raw.split('.')[0], 'base64url').toString()) as Ticket;
    return typeof t.from === 'string' && typeof t.to === 'string' && typeof t.exp === 'number' ? t : null;
  } catch {
    return null;
  }
}

export function verifyTicket(raw: string, key: string, to: string, now = Date.now()): Ticket | null {
  const [payload, sig] = raw.split('.');
  if (!payload || !sig) return null;
  const expected = mac(payload, key);
  const given = Buffer.from(sig, 'hex');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const ticket = peekTicket(raw);
  if (!ticket || ticket.to !== to || ticket.exp <= now) return null;
  return ticket;
}

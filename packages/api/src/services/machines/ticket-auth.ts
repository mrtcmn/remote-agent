import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { pairedMasters } from '../../db/schema';
import { machineRegistry } from '../machine-registry';
import { peekTicket, verifyTicket, tokenKey, TICKET_SCHEME } from './ticket';

/**
 * Who a `Authorization: Ticket …` request is, or null. The answer has the same
 * shape the bearer and tunnel branches produce: the owner, and the machine id
 * the caller acts as.
 */
export async function ticketIdentity(headers: Headers): Promise<{ ownerUserId: string; machineId: string } | null> {
  const header = headers.get('authorization');
  if (!header?.startsWith(TICKET_SCHEME)) return null;
  const raw = header.slice(TICKET_SCHEME.length).trim();
  const claim = peekTicket(raw);
  if (!claim) return null;

  // A secondary of ours calls us on our direct address; it signed with its own key.
  if (claim.to === 'hub') {
    const machine = await machineRegistry.get(claim.from);
    if (!machine || !verifyTicket(raw, machine.tokenHash, 'hub')) return null;
    return { ownerUserId: machine.ownerUserId, machineId: machine.id };
  }

  // A hub we paired with, or a peer it vouches for, calls us. Our id at that
  // hub is the paired-master row id, and the key comes from our own token.
  const master = await db.query.pairedMasters.findFirst({ where: eq(pairedMasters.id, claim.to) });
  if (!master || !verifyTicket(raw, tokenKey(master.machineToken), master.id)) return null;
  return { ownerUserId: master.ownerUserId, machineId: master.id };
}

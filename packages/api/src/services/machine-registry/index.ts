import { and, eq, isNull } from 'drizzle-orm';
import { db } from '../../db';
import { machines, pairingTokens, type Machine } from '../../db/schema';

const PAIRING_TOKEN_PREFIX = 'rapt_';
const MACHINE_TOKEN_PREFIX = 'ramt_';
const PAIRING_TOKEN_TTL_MS = 15 * 60 * 1000;
const ONLINE_THRESHOLD_MS = 90 * 1000;

function hashToken(plaintext: string): string {
  return new Bun.CryptoHasher('sha256').update(plaintext).digest('hex');
}

function generateTokenBody(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Buffer.from(bytes).toString('base64url');
}

export interface MachineWithStatus extends Machine {
  online: boolean;
}

class MachineRegistryService {
  async generatePairingToken(userId: string): Promise<{ token: string; expiresAt: Date }> {
    const token = `${PAIRING_TOKEN_PREFIX}${generateTokenBody()}`;
    const expiresAt = new Date(Date.now() + PAIRING_TOKEN_TTL_MS);

    await db.insert(pairingTokens).values({
      tokenHash: hashToken(token),
      ownerUserId: userId,
      expiresAt,
    });

    return { token, expiresAt };
  }

  async consumePairingToken(
    plaintextToken: string,
    name: string,
  ): Promise<{ machineId: string; machineToken: string; ownerUserId: string } | null> {
    const tokenHash = hashToken(plaintextToken);

    return db.transaction(async (tx) => {
      const row = await tx.query.pairingTokens.findFirst({
        where: and(eq(pairingTokens.tokenHash, tokenHash), isNull(pairingTokens.consumedAt)),
      });

      if (!row) return null;
      if (row.expiresAt.getTime() < Date.now()) return null;

      await tx
        .update(pairingTokens)
        .set({ consumedAt: new Date() })
        .where(eq(pairingTokens.tokenHash, tokenHash));

      const machineId = crypto.randomUUID();
      const machineToken = `${MACHINE_TOKEN_PREFIX}${generateTokenBody()}`;

      await tx.insert(machines).values({
        id: machineId,
        ownerUserId: row.ownerUserId,
        name,
        role: 'secondary',
        tokenHash: hashToken(machineToken),
      });

      return { machineId, machineToken, ownerUserId: row.ownerUserId };
    });
  }

  async findByToken(plaintextToken: string): Promise<Machine | null> {
    const row = await db.query.machines.findFirst({
      where: eq(machines.tokenHash, hashToken(plaintextToken)),
    });
    return row ?? null;
  }

  async recordHeartbeat(
    machineId: string,
    payload: { sessionCount: number; version?: string },
  ): Promise<void> {
    await db
      .update(machines)
      .set({
        lastSeenAt: new Date(),
        sessionCount: payload.sessionCount,
        version: payload.version ?? null,
      })
      .where(eq(machines.id, machineId));
  }

  async listForUser(userId: string): Promise<MachineWithStatus[]> {
    const rows = await db.query.machines.findMany({
      where: eq(machines.ownerUserId, userId),
    });

    const cutoff = Date.now() - ONLINE_THRESHOLD_MS;
    return rows.map((m) => ({
      ...m,
      online: m.lastSeenAt != null && m.lastSeenAt.getTime() > cutoff,
    }));
  }

  async revoke(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(machines)
      .where(and(eq(machines.id, id), eq(machines.ownerUserId, userId)))
      .returning({ id: machines.id });
    return result.length > 0;
  }
}

export const machineRegistry = new MachineRegistryService();

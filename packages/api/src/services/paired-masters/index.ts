import { and, eq } from 'drizzle-orm';
import { db } from '../../db';
import { pairedMasters, type PairedMaster } from '../../db/schema';

export interface PairResult {
  ok: true;
  master: PairedMaster;
}
export interface PairError {
  ok: false;
  error: string;
}

function normalizeUrl(input: string): string {
  const trimmed = input.trim().replace(/\/+$/, '');
  return trimmed;
}

class PairedMastersService {
  async list(userId: string): Promise<PairedMaster[]> {
    return db.query.pairedMasters.findMany({
      where: eq(pairedMasters.ownerUserId, userId),
    });
  }

  async get(id: string, userId: string): Promise<PairedMaster | null> {
    const row = await db.query.pairedMasters.findFirst({
      where: and(eq(pairedMasters.id, id), eq(pairedMasters.ownerUserId, userId)),
    });
    return row ?? null;
  }

  async pair(params: {
    url: string;
    pairingToken: string;
    name: string;
    userId: string;
  }): Promise<PairResult | PairError> {
    const url = normalizeUrl(params.url);
    if (!/^https?:\/\//.test(url)) {
      return { ok: false, error: 'URL must start with http:// or https://' };
    }

    let response: Response;
    try {
      response = await fetch(`${url}/api/machines/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: params.pairingToken, name: params.name }),
      });
    } catch (err) {
      return { ok: false, error: `Could not reach master: ${(err as Error).message}` };
    }

    if (!response.ok) {
      let msg = `Master rejected pairing (HTTP ${response.status})`;
      try {
        const body = await response.json() as { error?: string };
        if (body?.error) msg = body.error;
      } catch { /* non-json */ }
      return { ok: false, error: msg };
    }

    const body = await response.json() as { machineId?: string; machineToken?: string };
    if (!body.machineId || !body.machineToken) {
      return { ok: false, error: 'Master returned malformed pairing response' };
    }

    const now = new Date();
    await db.insert(pairedMasters).values({
      id: body.machineId,
      ownerUserId: params.userId,
      url,
      name: params.name,
      machineToken: body.machineToken,
      createdAt: now,
    });

    const inserted = await this.get(body.machineId, params.userId);
    if (!inserted) {
      return { ok: false, error: 'Failed to persist pairing' };
    }
    return { ok: true, master: inserted };
  }

  async unpair(id: string, userId: string): Promise<boolean> {
    const result = await db
      .delete(pairedMasters)
      .where(and(eq(pairedMasters.id, id), eq(pairedMasters.ownerUserId, userId)))
      .returning({ id: pairedMasters.id });
    return result.length > 0;
  }

  async recordSync(
    id: string,
    outcome: { success: true } | { success: false; error: string },
  ): Promise<void> {
    await db
      .update(pairedMasters)
      .set({
        lastSyncAt: new Date(),
        lastSyncError: outcome.success ? null : outcome.error,
      })
      .where(eq(pairedMasters.id, id));
  }

  /** All paired masters, used by MasterSyncService at startup. */
  async listAll(): Promise<PairedMaster[]> {
    return db.query.pairedMasters.findMany();
  }
}

export const pairedMastersService = new PairedMastersService();

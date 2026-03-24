import { eq, desc } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db, artifacts } from '../../db';
import { unlink } from 'fs/promises';

export class ArtifactRepository {
  async create(data: {
    sessionId: string;
    terminalId?: string;
    type: 'screenshot' | 'file' | 'log';
    toolName?: string;
    filename: string;
    filepath: string;
    mimetype: string;
    size: number;
    metadata?: Record<string, unknown>;
  }) {
    const id = nanoid();

    await db.insert(artifacts).values({
      id,
      sessionId: data.sessionId,
      terminalId: data.terminalId || null,
      type: data.type,
      toolName: data.toolName || null,
      filename: data.filename,
      filepath: data.filepath,
      mimetype: data.mimetype,
      size: data.size,
      metadata: data.metadata ? JSON.stringify(data.metadata) : null,
    });

    return this.findById(id);
  }

  async findById(id: string) {
    const row = await db.query.artifacts.findFirst({
      where: eq(artifacts.id, id),
    });
    return row ? this.mapRow(row) : null;
  }

  async findBySession(sessionId: string, options?: { limit?: number; offset?: number }) {
    const rows = await db.query.artifacts.findMany({
      where: eq(artifacts.sessionId, sessionId),
      orderBy: [desc(artifacts.createdAt)],
      limit: options?.limit || 50,
      offset: options?.offset || 0,
    });
    return rows.map(r => this.mapRow(r));
  }

  async deleteById(id: string): Promise<{ success: boolean }> {
    const artifact = await this.findById(id);
    if (artifact) {
      try { await unlink(artifact.filepath); } catch { /* file may already be gone */ }
    }
    await db.delete(artifacts).where(eq(artifacts.id, id));
    return { success: true };
  }

  private mapRow(row: typeof artifacts.$inferSelect) {
    return {
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata) : null,
    };
  }
}

export const artifactRepository = new ArtifactRepository();

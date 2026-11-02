import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { nanoid } from 'nanoid';
import { db } from '../../db';
import { viewPanels, views, type View, type ViewPanel } from '../../db/schema';

export const VIEW_TOOLS = ['files', 'git', 'run', 'docker', 'env', 'flow'] as const;

export interface PanelInput {
  /** Optional: the client may pick the id so it can place the panel in its layout first. */
  id?: string;
  machineId?: string | null;
  sessionId: string;
  kind: 'terminal' | 'tool';
  terminalId?: string | null;
  tool?: string | null;
}

/** "View N" with the lowest N not taken, so deleting View 2 frees the name. */
export function nextViewName(taken: string[]): string {
  const used = new Set(taken);
  let n = 1;
  while (used.has(`View ${n}`)) n++;
  return `View ${n}`;
}

/** The distinct sessions of a view, in panel order — the sidebar shows one chip each. */
export function sessionChips(panels: Pick<ViewPanel, 'machineId' | 'sessionId'>[]) {
  const seen = new Set<string>();
  const chips: { machineId: string | null; sessionId: string }[] = [];
  for (const p of panels) {
    const key = `${p.machineId ?? 'self'}:${p.sessionId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push({ machineId: p.machineId, sessionId: p.sessionId });
  }
  return chips;
}

const panelRow = (viewId: string, p: PanelInput) => ({
  id: p.id ?? nanoid(),
  viewId,
  machineId: p.machineId && p.machineId !== 'self' ? p.machineId : null,
  sessionId: p.sessionId,
  kind: p.kind,
  terminalId: p.kind === 'terminal' ? p.terminalId ?? null : null,
  tool: p.kind === 'tool' ? p.tool ?? null : null,
});

class ViewsService {
  private async owned(id: string, userId: string): Promise<View | null> {
    const [row] = await db.select().from(views).where(and(eq(views.id, id), eq(views.userId, userId)));
    return row ?? null;
  }

  async list(userId: string) {
    const rows: View[] = await db.select().from(views).where(eq(views.userId, userId)).orderBy(asc(views.position), asc(views.createdAt));
    if (rows.length === 0) return [];
    const panels: ViewPanel[] = await db.select().from(viewPanels).where(inArray(viewPanels.viewId, rows.map((v) => v.id))).orderBy(asc(viewPanels.createdAt));
    return rows.map((v) => ({
      id: v.id,
      name: v.name,
      position: v.position,
      sessions: sessionChips(panels.filter((p) => p.viewId === v.id)),
    }));
  }

  async get(id: string, userId: string) {
    const view = await this.owned(id, userId);
    if (!view) return null;
    const panels: ViewPanel[] = await db.select().from(viewPanels).where(eq(viewPanels.viewId, id));
    return { ...view, layout: view.layout ? JSON.parse(view.layout) : null, panels };
  }

  async create(userId: string, input: { name?: string; layout?: unknown; panels: PanelInput[] }) {
    const existing: { name: string; position: number }[] = await db.select({ name: views.name, position: views.position }).from(views).where(eq(views.userId, userId));
    const id = nanoid();
    await db.insert(views).values({
      id,
      userId,
      name: input.name?.trim() || nextViewName(existing.map((v) => v.name)),
      layout: input.layout ? JSON.stringify(input.layout) : null,
      position: existing.reduce((max, v) => Math.max(max, v.position + 1), 0),
    });
    try {
      if (input.panels.length) await db.insert(viewPanels).values(input.panels.map((p) => panelRow(id, p)));
    } catch (err) {
      await db.delete(views).where(eq(views.id, id)); // no half-made view
      throw err;
    }
    return this.get(id, userId);
  }

  async update(id: string, userId: string, patch: { name?: string; layout?: unknown; position?: number }) {
    if (!(await this.owned(id, userId))) return false;
    await db.update(views).set({
      ...(patch.name !== undefined && { name: patch.name.trim() }),
      ...(patch.layout !== undefined && { layout: JSON.stringify(patch.layout) }),
      ...(patch.position !== undefined && { position: patch.position }),
      updatedAt: new Date(),
    }).where(eq(views.id, id));
    return true;
  }

  async remove(id: string, userId: string) {
    const result = await db.delete(views).where(and(eq(views.id, id), eq(views.userId, userId))).returning({ id: views.id });
    return result.length > 0;
  }

  async addPanel(viewId: string, userId: string, input: PanelInput) {
    if (!(await this.owned(viewId, userId))) return null;
    const row = panelRow(viewId, input);
    await db.insert(viewPanels).values(row);
    await db.update(views).set({ updatedAt: new Date() }).where(eq(views.id, viewId));
    return row;
  }

  /** "Start new" on an ended terminal: same panel, same place, new terminal. */
  async setPanelTerminal(viewId: string, panelId: string, userId: string, terminalId: string) {
    if (!(await this.owned(viewId, userId))) return false;
    const result = await db.update(viewPanels).set({ terminalId })
      .where(and(eq(viewPanels.id, panelId), eq(viewPanels.viewId, viewId)))
      .returning({ id: viewPanels.id });
    return result.length > 0;
  }

  async removePanel(viewId: string, panelId: string, userId: string) {
    if (!(await this.owned(viewId, userId))) return false;
    const result = await db.delete(viewPanels)
      .where(and(eq(viewPanels.id, panelId), eq(viewPanels.viewId, viewId)))
      .returning({ id: viewPanels.id });
    return result.length > 0;
  }

  /** A local session is deleted: drop its panels. The layout prunes them on the next load. */
  async removeLocalSession(sessionId: string) {
    await db.delete(viewPanels).where(and(eq(viewPanels.sessionId, sessionId), isNull(viewPanels.machineId)));
  }
}

export const viewsService = new ViewsService();

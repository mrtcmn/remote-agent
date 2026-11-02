import type { AggregatedSidebar, ViewPanel, ViewTool } from './api';

/** HTML5 drag type for a terminal or tool dragged from the sidebar into a split. */
export const PANEL_DRAG_TYPE = 'application/x-ra-panel';

export interface DragPanel {
  machineId: string; // 'self' for this machine
  sessionId: string;
  terminalId?: string;
  tool?: ViewTool;
}

export function readDragPanel(e: DragEvent | React.DragEvent): DragPanel | null {
  const raw = e.dataTransfer?.getData(PANEL_DRAG_TYPE);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DragPanel;
  } catch {
    return null;
  }
}

export type SplitZone = 'left' | 'right' | 'top' | 'bottom';

/** dockview's name for each edge. */
export const ZONE_DIRECTION = { left: 'left', right: 'right', top: 'above', bottom: 'below' } as const;

/**
 * Which edge zone the pointer is in: the outer quarter on each side, nearest edge
 * wins. The middle half is no zone — a session page has nothing to drop "into".
 */
export function zoneAt(x: number, y: number, rect: { left: number; top: number; width: number; height: number }): SplitZone | null {
  const fx = (x - rect.left) / rect.width;
  const fy = (y - rect.top) / rect.height;
  if (fx < 0 || fx > 1 || fy < 0 || fy > 1) return null;
  const edges: [SplitZone, number][] = [['left', fx], ['right', 1 - fx], ['top', fy], ['bottom', 1 - fy]];
  const [zone, dist] = edges.reduce((a, b) => (b[1] < a[1] ? b : a));
  return dist < 0.25 ? zone : null;
}

/**
 * Compare the saved layout with the panel rows. Stale: in the layout, but the row
 * is gone (its session was deleted). Missing: a row the layout has not placed yet
 * (added from the sidebar while the view was closed).
 */
export function diffPanels(layoutIds: string[], rows: Pick<ViewPanel, 'id'>[]) {
  const rowIds = new Set(rows.map((r) => r.id));
  const placed = new Set(layoutIds);
  return {
    stale: layoutIds.filter((id) => !rowIds.has(id)),
    missing: rows.filter((r) => !placed.has(r.id)).map((r) => r.id),
  };
}

export const machineKey = (machineId: string | null | undefined) => machineId || 'self';

/** A stable hue per session, so its chip has the same color in every view. */
export function sessionHue(sessionId: string): number {
  let h = 0;
  for (let i = 0; i < sessionId.length; i++) h = (h * 31 + sessionId.charCodeAt(i)) >>> 0;
  return h % 360;
}

/** Names from the sidebar aggregate: the project of a session, and the label of a terminal. */
export function sessionInfo(aggregate: AggregatedSidebar | undefined, machineId: string | null, sessionId: string) {
  const machine = aggregate?.machines.find((m) => m.machineId === machineKey(machineId));
  if (!machine) return null;
  for (const project of machine.data.projects) {
    const session = project.sessions.find((s) => s.id === sessionId);
    if (session) return { machineName: machine.machineName, projectName: project.name, session };
  }
  const session = machine.data.unassignedSessions.find((s) => s.id === sessionId);
  return session ? { machineName: machine.machineName, projectName: 'Unassigned', session } : null;
}

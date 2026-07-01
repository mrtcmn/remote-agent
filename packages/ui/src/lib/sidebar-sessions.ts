import type { SidebarData, SidebarSession } from './api';

export const ACTIVE_STATUSES = new Set(['active', 'waiting_input']);

/** A session is "active" if its effective status (live overrides stored) is active/waiting. */
export function isActiveSession(session: Pick<SidebarSession, 'status' | 'liveStatus'>): boolean {
  const effectiveStatus = session.liveStatus || session.status;
  return ACTIVE_STATUSES.has(effectiveStatus);
}

/** A sidebar session flattened out of its project group, carrying its project identity. */
export interface FlatSession extends SidebarSession {
  projectId: string | null;
  projectName: string | null;
}

export interface FlatSessions {
  active: FlatSession[];
  inactive: FlatSession[];
}

/** Newest-active-first, with a stable tiebreak on id so rows don't jitter on refetch. */
function byRecencyThenId(a: FlatSession, b: FlatSession): number {
  const at = new Date(a.lastActiveAt).getTime();
  const bt = new Date(b.lastActiveAt).getTime();
  if (bt !== at) return bt - at;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Flatten the grouped sidebar payload into a single recency-sorted list of sessions,
 * split into active (shown by default) and inactive (behind an expander). Each session
 * keeps a reference to the project it belongs to (null for unassigned sessions).
 */
export function flattenSidebarSessions(data: SidebarData | undefined): FlatSessions {
  if (!data) return { active: [], inactive: [] };

  const all: FlatSession[] = [];

  for (const project of data.projects) {
    for (const session of project.sessions) {
      all.push({ ...session, projectId: project.id, projectName: project.name });
    }
  }
  for (const session of data.unassignedSessions) {
    all.push({ ...session, projectId: null, projectName: null });
  }

  const active: FlatSession[] = [];
  const inactive: FlatSession[] = [];
  for (const session of all) {
    (isActiveSession(session) ? active : inactive).push(session);
  }

  active.sort(byRecencyThenId);
  inactive.sort(byRecencyThenId);

  return { active, inactive };
}

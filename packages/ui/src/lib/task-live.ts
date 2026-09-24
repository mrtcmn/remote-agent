import type { AggregatedSidebar, KanbanTask, NotificationRecord } from './api';

/** Mirrors MAX_VERIFY_ATTEMPTS in the API's task-loop.service.ts. */
export const MAX_VERIFY_ATTEMPTS = 3;

export type AgentActivity = 'working' | 'needs' | 'error' | 'done' | 'idle' | 'offline';

export interface SessionLive {
  agent: AgentActivity;
  diffStats: { additions: number; deletions: number } | null;
  /** The pending question, when the agent needs you. */
  question?: string;
}

const ACTIVITY: Record<string, AgentActivity> = {
  session_started: 'working',
  user_input_required: 'needs',
  permission_request: 'needs',
  error: 'error',
  task_complete: 'done',
};

/** Session id → what its agent is doing, from the sidebar data and its live notifications. */
export function sessionLiveMap(
  sidebar: AggregatedSidebar | undefined,
  notifications: NotificationRecord[],
): Map<string, SessionLive> {
  const latest = new Map<string, NotificationRecord>();
  for (const n of notifications) {
    const prev = latest.get(n.sessionId);
    if (!prev || n.createdAt > prev.createdAt) latest.set(n.sessionId, n);
  }

  const map = new Map<string, SessionLive>();
  for (const machine of sidebar?.machines ?? []) {
    const sessions = [
      ...machine.data.projects.flatMap(p => p.sessions),
      ...machine.data.unassignedSessions,
    ];
    for (const s of sessions) {
      const n = latest.get(s.id);
      const agent = n ? ACTIVITY[n.type] ?? 'idle' : s.liveStatus === 'terminated' ? 'offline' : 'idle';
      map.set(s.id, {
        agent,
        diffStats: s.diffStats,
        ...(agent === 'needs' && n ? { question: n.body } : {}),
      });
    }
  }
  return map;
}

export type CardTone = 'working' | 'needs' | 'failed' | 'passed';

/**
 * The one state a card shows. The loop outranks the session: a stuck task is
 * stuck even while its terminal sits idle.
 */
export function cardState(task: KanbanTask, live?: SessionLive): { tone: CardTone; label: string } | null {
  if (task.verifyStatus === 'stuck') return { tone: 'failed', label: 'Stuck' };
  if (task.verifyStatus === 'running') return { tone: 'working', label: 'Judging' };
  if (task.verifyStatus === 'drafting') return { tone: 'working', label: 'Writing goal' };
  if (live?.agent === 'needs') return { tone: 'needs', label: 'Needs you' };
  if (live?.agent === 'error') return { tone: 'failed', label: 'Error' };
  if (task.planStatus === 'planning') return { tone: 'working', label: 'Planning' };
  if (task.planStatus === 'executing' || live?.agent === 'working') return { tone: 'working', label: 'Working' };
  if (task.planStatus === 'failed') return { tone: 'failed', label: 'Run failed' };
  if (task.verifyStatus === 'failed') return { tone: 'failed', label: 'Verify failed' };
  if (task.verifyStatus === 'passed') return { tone: 'passed', label: 'Verified' };
  return null;
}

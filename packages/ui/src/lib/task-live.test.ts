import { describe, expect, it } from 'bun:test';
import { cardState, sessionLiveMap } from './task-live';
import type { AggregatedSidebar, KanbanTask, NotificationRecord } from './api';

const task = (over: Partial<KanbanTask>) =>
  ({ planStatus: 'none', verifyStatus: 'none', verifyAttempts: 0, ...over }) as KanbanTask;

const sidebar = (liveStatus = 'active'): AggregatedSidebar => ({
  machines: [{
    machineId: 'self', machineName: 'me', online: true,
    data: {
      projects: [{ id: 'p', name: 'p', isMultiProject: false, sessions: [
        { id: 's1', liveStatus, diffStats: { additions: 3, deletions: 1 } } as any,
      ] }],
      unassignedSessions: [],
    },
  }],
});

const notif = (type: string, createdAt: string, body = ''): NotificationRecord =>
  ({ id: createdAt, sessionId: 's1', type, body, createdAt }) as NotificationRecord;

describe('sessionLiveMap', () => {
  it('takes the newest notification per session', () => {
    const map = sessionLiveMap(sidebar(), [
      notif('session_started', '2026-01-01T00:00:00Z'),
      notif('user_input_required', '2026-01-01T00:01:00Z', 'Pick one?'),
    ]);
    expect(map.get('s1')).toEqual({ agent: 'needs', diffStats: { additions: 3, deletions: 1 }, question: 'Pick one?' });
  });

  it('a terminated session with no notification is offline', () => {
    expect(sessionLiveMap(sidebar('terminated'), []).get('s1')?.agent).toBe('offline');
  });
});

describe('cardState', () => {
  it('stuck outranks everything', () => {
    expect(cardState(task({ verifyStatus: 'stuck' }), { agent: 'needs', diffStats: null })?.label).toBe('Stuck');
  });

  it('needs you outranks working', () => {
    expect(cardState(task({ planStatus: 'executing' }), { agent: 'needs', diffStats: null })?.tone).toBe('needs');
  });

  it('shows a background run as working', () => {
    expect(cardState(task({ planStatus: 'executing' }))?.label).toBe('Working');
  });

  it('a quiet task shows nothing', () => {
    expect(cardState(task({}), { agent: 'idle', diffStats: null })).toBeNull();
  });
});

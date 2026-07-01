import { describe, expect, test } from 'bun:test';
import { flattenSidebarSessions, isActiveSession } from './sidebar-sessions';
import type { SidebarData, SidebarSession } from './api';

function makeSession(over: Partial<SidebarSession> & { id: string }): SidebarSession {
  return {
    status: 'active',
    liveStatus: '',
    branchName: 'main',
    diffStats: null,
    commentCount: 0,
    worktreeId: null,
    worktreeName: null,
    sessionType: 'git',
    services: [],
    lastActiveAt: '2026-01-01T00:00:00.000Z',
    ...over,
  };
}

function makeData(over: Partial<SidebarData>): SidebarData {
  return { projects: [], unassignedSessions: [], ...over };
}

describe('isActiveSession', () => {
  test('treats active and waiting_input as active', () => {
    expect(isActiveSession(makeSession({ id: 'a', status: 'active' }))).toBe(true);
    expect(isActiveSession(makeSession({ id: 'b', status: 'waiting_input' }))).toBe(true);
  });

  test('treats terminated and paused as inactive', () => {
    expect(isActiveSession(makeSession({ id: 'c', status: 'terminated' }))).toBe(false);
    expect(isActiveSession(makeSession({ id: 'd', status: 'paused' }))).toBe(false);
  });

  test('liveStatus overrides status', () => {
    // status says paused, but it is live -> active
    expect(isActiveSession(makeSession({ id: 'e', status: 'paused', liveStatus: 'active' }))).toBe(true);
    // status says active, but live says terminated -> inactive
    expect(isActiveSession(makeSession({ id: 'f', status: 'active', liveStatus: 'terminated' }))).toBe(false);
  });
});

describe('flattenSidebarSessions', () => {
  test('returns empty arrays when data is undefined', () => {
    expect(flattenSidebarSessions(undefined)).toEqual({ active: [], inactive: [] });
  });

  test('flattens sessions across projects and attaches project id and name', () => {
    const data = makeData({
      projects: [
        { id: 'p1', name: 'api', isMultiProject: false, sessions: [makeSession({ id: 's1' })] },
        { id: 'p2', name: 'web', isMultiProject: false, sessions: [makeSession({ id: 's2' })] },
      ],
    });

    const { active } = flattenSidebarSessions(data);

    expect(active.map((s) => s.id).sort()).toEqual(['s1', 's2']);
    const s1 = active.find((s) => s.id === 's1')!;
    expect(s1.projectId).toBe('p1');
    expect(s1.projectName).toBe('api');
  });

  test('splits active and inactive by effective status', () => {
    const data = makeData({
      projects: [
        {
          id: 'p1',
          name: 'api',
          isMultiProject: false,
          sessions: [
            makeSession({ id: 'live', status: 'active' }),
            makeSession({ id: 'dead', status: 'terminated' }),
            makeSession({ id: 'paused', status: 'paused' }),
          ],
        },
      ],
    });

    const { active, inactive } = flattenSidebarSessions(data);

    expect(active.map((s) => s.id)).toEqual(['live']);
    expect(inactive.map((s) => s.id).sort()).toEqual(['dead', 'paused']);
  });

  test('sorts active sessions by lastActiveAt descending', () => {
    const data = makeData({
      projects: [
        {
          id: 'p1',
          name: 'api',
          isMultiProject: false,
          sessions: [
            makeSession({ id: 'old', lastActiveAt: '2026-01-01T00:00:00.000Z' }),
            makeSession({ id: 'new', lastActiveAt: '2026-03-01T00:00:00.000Z' }),
            makeSession({ id: 'mid', lastActiveAt: '2026-02-01T00:00:00.000Z' }),
          ],
        },
      ],
    });

    const { active } = flattenSidebarSessions(data);
    expect(active.map((s) => s.id)).toEqual(['new', 'mid', 'old']);
  });

  test('includes unassigned sessions with null project', () => {
    const data = makeData({
      unassignedSessions: [makeSession({ id: 'u1' })],
    });

    const { active } = flattenSidebarSessions(data);
    expect(active).toHaveLength(1);
    expect(active[0].projectId).toBeNull();
    expect(active[0].projectName).toBeNull();
  });

  test('breaks lastActiveAt ties by id for stable order', () => {
    const ts = '2026-01-01T00:00:00.000Z';
    const data = makeData({
      projects: [
        {
          id: 'p1',
          name: 'api',
          isMultiProject: false,
          sessions: [
            makeSession({ id: 'bbb', lastActiveAt: ts }),
            makeSession({ id: 'aaa', lastActiveAt: ts }),
          ],
        },
      ],
    });

    const { active } = flattenSidebarSessions(data);
    expect(active.map((s) => s.id)).toEqual(['aaa', 'bbb']);
  });
});

import { describe, expect, test } from 'bun:test';
import { assembleSidebar, mergeNotifications, type MachineResult } from './merge';

type Notif = { id: string; createdAt: string };
type Sidebar = { projects: { id: string }[]; unassignedSessions: never[] };

describe('mergeNotifications', () => {
  test('flattens online machines, tags each notification with its machine', () => {
    const results: MachineResult<Notif[]>[] = [
      { machineId: 'self', machineName: 'This machine', online: true, data: [{ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }] },
      { machineId: 'm2', machineName: 'vps', online: true, data: [{ id: 'b', createdAt: '2026-01-02T00:00:00.000Z' }] },
    ];

    const result = mergeNotifications(results);

    expect(result.notifications).toHaveLength(2);
    const a = result.notifications.find((n) => n.id === 'a')!;
    expect(a.machineId).toBe('self');
    expect(a.machineName).toBe('This machine');
    expect(result.notifications.find((n) => n.id === 'b')!.machineId).toBe('m2');
  });

  test('sorts merged notifications by createdAt descending', () => {
    const results: MachineResult<Notif[]>[] = [
      {
        machineId: 'self',
        machineName: 'This machine',
        online: true,
        data: [
          { id: 'old', createdAt: '2026-01-01T00:00:00.000Z' },
          { id: 'new', createdAt: '2026-03-01T00:00:00.000Z' },
        ],
      },
      { machineId: 'm2', machineName: 'vps', online: true, data: [{ id: 'mid', createdAt: '2026-02-01T00:00:00.000Z' }] },
    ];

    expect(mergeNotifications(results).notifications.map((n) => n.id)).toEqual(['new', 'mid', 'old']);
  });

  test('offline machine contributes to machines list but no notifications', () => {
    const results: MachineResult<Notif[]>[] = [
      { machineId: 'self', machineName: 'This machine', online: true, data: [{ id: 'a', createdAt: '2026-01-01T00:00:00.000Z' }] },
      { machineId: 'm2', machineName: 'vps', online: false, error: 'unreachable', data: null },
    ];

    const result = mergeNotifications(results);

    expect(result.notifications.map((n) => n.id)).toEqual(['a']);
    expect(result.machines).toHaveLength(2);
    const vps = result.machines.find((m) => m.machineId === 'm2')!;
    expect(vps.online).toBe(false);
    expect(vps.error).toBe('unreachable');
  });
});

describe('assembleSidebar', () => {
  test('tags each machine block and preserves order', () => {
    const results: MachineResult<Sidebar>[] = [
      { machineId: 'self', machineName: 'This machine', online: true, data: { projects: [{ id: 'p1' }], unassignedSessions: [] } },
      { machineId: 'm2', machineName: 'vps', online: true, data: { projects: [{ id: 'p2' }], unassignedSessions: [] } },
    ];

    const result = assembleSidebar(results);

    expect(result.machines.map((m) => m.machineId)).toEqual(['self', 'm2']);
    expect(result.machines[0].data.projects).toEqual([{ id: 'p1' }]);
    expect(result.machines[0].online).toBe(true);
  });

  test('offline machine yields an empty SidebarData payload', () => {
    const results: MachineResult<Sidebar>[] = [
      { machineId: 'self', machineName: 'This machine', online: true, data: { projects: [{ id: 'p1' }], unassignedSessions: [] } },
      { machineId: 'm2', machineName: 'vps', online: false, error: 'unreachable', data: null },
    ];

    const result = assembleSidebar(results);

    const vps = result.machines.find((m) => m.machineId === 'm2')!;
    expect(vps.online).toBe(false);
    expect(vps.data).toEqual({ projects: [], unassignedSessions: [] });
  });
});

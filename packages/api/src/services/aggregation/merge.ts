/**
 * Pure assembly/merge helpers for cross-machine aggregation. The fan-out I/O
 * lives in ./fan-out; these functions only shape already-fetched results, so
 * they are fully unit-testable.
 */

export interface MachineResult<T> {
  machineId: string;
  machineName: string;
  online: boolean;
  error?: string;
  /** null when the machine was unreachable. */
  data: T | null;
}

export interface MachineSummary {
  machineId: string;
  machineName: string;
  online: boolean;
  error?: string;
}

type WithCreatedAt = { createdAt: string | number | Date };
export type TaggedNotification<T extends WithCreatedAt = WithCreatedAt> = T & {
  machineId: string;
  machineName: string;
};

export interface AggregatedNotifications<T extends WithCreatedAt = WithCreatedAt> {
  notifications: TaggedNotification<T>[];
  machines: MachineSummary[];
}

function summarize<T>(r: MachineResult<T>): MachineSummary {
  return { machineId: r.machineId, machineName: r.machineName, online: r.online, error: r.error };
}

/** Flatten every online machine's notifications, tag with origin machine, sort newest-first. */
export function mergeNotifications<T extends WithCreatedAt>(
  results: MachineResult<T[]>[],
): AggregatedNotifications<T> {
  const notifications: TaggedNotification<T>[] = [];
  const machines: MachineSummary[] = [];

  for (const r of results) {
    machines.push(summarize(r));
    if (r.online && r.data) {
      for (const n of r.data) {
        notifications.push({ ...n, machineId: r.machineId, machineName: r.machineName });
      }
    }
  }

  notifications.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  return { notifications, machines };
}

export interface MachineSidebar<S> extends MachineSummary {
  data: S;
}

export interface AggregatedSidebar<S> {
  machines: MachineSidebar<S>[];
}

/** Tag each machine's sidebar payload; unreachable machines get an empty payload. */
export function assembleSidebar<S extends { projects: unknown[]; unassignedSessions: unknown[] }>(
  results: MachineResult<S>[],
  emptyPayload: () => S = () => ({ projects: [], unassignedSessions: [] }) as unknown as S,
): AggregatedSidebar<S> {
  return {
    machines: results.map((r) => ({
      ...summarize(r),
      data: r.online && r.data ? r.data : emptyPayload(),
    })),
  };
}

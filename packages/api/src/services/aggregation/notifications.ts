import { notificationRepository } from '../notification';
import { fanOutToMasters } from './fan-out';
import { mergeNotifications, type AggregatedNotifications } from './merge';

type NotificationStatus = 'pending' | 'sent' | 'read' | 'resolved' | 'dismissed';

/**
 * User's notifications across self + every paired master, merged newest-first and
 * tagged with the origin machine. Shared by the REST /notifications/aggregate route
 * and the /ws/notifications snapshot so the notch mirrors all machines, not just local.
 */
export async function aggregateUserNotifications(
  userId: string,
  opts: { status?: NotificationStatus[]; limit?: number } = {},
): Promise<AggregatedNotifications> {
  const limit = opts.limit ?? 50;

  const selfNotifs = await notificationRepository.findByUser(userId, {
    status: opts.status,
    limit,
    offset: 0,
  });
  const self = { machineId: 'self', machineName: 'This machine', online: true, data: selfNotifs };

  const qs = new URLSearchParams();
  if (opts.status?.length) qs.set('status', opts.status.join(','));
  qs.set('limit', String(limit));
  const remoteRaw = await fanOutToMasters<{ notifications: typeof selfNotifs }>(
    userId,
    `/notifications?${qs.toString()}`,
  );
  const remotes = remoteRaw.map((r) => ({
    machineId: r.machineId,
    machineName: r.machineName,
    online: r.online,
    error: r.error,
    data: r.online && r.data ? r.data.notifications : null,
  }));

  const merged = mergeNotifications([self, ...remotes]);
  return { ...merged, notifications: merged.notifications.slice(0, limit) };
}

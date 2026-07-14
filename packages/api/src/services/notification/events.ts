import { EventEmitter } from 'node:events';
import type { NotificationRecord } from './types';

export interface NotificationStatusEvent {
  id: string;
  userId: string;
  status: 'pending' | 'sent' | 'read' | 'resolved' | 'dismissed';
  resolvedAction?: string;
}

/**
 * Shared emitter so the repository (DB layer) and the websocket route don't
 * import each other.
 *
 * Events:
 *  - 'created' (NotificationRecord)        — emitted by NotificationService once
 *    the final initial status is known (not emitted for debounce-dismissed dupes)
 *  - 'status'  (NotificationStatusEvent)   — emitted by the repository on every
 *    status write (resolve/dismiss/read/sent)
 */
export const notificationEvents = new EventEmitter();
notificationEvents.setMaxListeners(0);

export function emitCreated(record: NotificationRecord): void {
  notificationEvents.emit('created', record);
}

export function emitStatus(event: NotificationStatusEvent): void {
  notificationEvents.emit('status', event);
}

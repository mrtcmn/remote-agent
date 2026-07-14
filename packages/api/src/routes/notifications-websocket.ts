import { Elysia, t } from 'elysia';
import { auth } from '../auth';
import { machineRegistry } from '../services/machine-registry';
import {
  notificationRepository,
  notificationService,
  notificationEvents,
  type NotificationStatusEvent,
} from '../services/notification';
import type { NotificationRecord } from '../services/notification/types';
import { presenceManager } from '../services/presence';

// Bidirectional notification stream for native clients (macOS notch app) and
// browsers. Unlike the terminal/ssh sockets this one is user-scoped, so it
// authenticates on open: machine bearer token (header or ?token=) or the
// better-auth cookie session.
//
// server→client: snapshot | notification | resolved | dismissed | pong | error
// client→server: respond | dismiss | ping

type Socket = { send: (data: string) => void; close: () => void };

const connections = new Map<string, Set<Socket>>();
const socketUsers = new WeakMap<object, string>();

function sendToUser(userId: string, msg: unknown): void {
  const set = connections.get(userId);
  if (set) {
    const s = JSON.stringify(msg);
    set.forEach(ws => ws.send(s));
  }
}

notificationEvents.on('created', (record: NotificationRecord) => {
  sendToUser(record.userId, {
    type: 'notification',
    data: record,
    // Lets clients skip the popup when the user is already looking at the web UI
    userActive: presenceManager.isUserActive(record.userId),
  });
});

notificationEvents.on('status', (event: NotificationStatusEvent) => {
  if (event.status === 'resolved') {
    sendToUser(event.userId, { type: 'resolved', id: event.id, action: event.resolvedAction });
  } else if (event.status === 'dismissed' || event.status === 'read') {
    // 'read' means the user saw it elsewhere — remove it from live clients too
    sendToUser(event.userId, { type: 'dismissed', id: event.id });
  }
});

async function resolveUserId(request: Request | undefined, queryToken?: string): Promise<string | null> {
  const header = request?.headers.get('authorization');
  const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  const token = bearer || queryToken;

  if (token) {
    const machine = await machineRegistry.findByToken(token);
    if (machine) return machine.ownerUserId;
  }

  if (!request) return null;
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user.id ?? null;
}

export const notificationWebsocketRoutes = new Elysia()
  .ws('/ws/notifications', {
    query: t.Object({ token: t.Optional(t.String()) }),
    body: t.Object({
      type: t.String(),
      id: t.Optional(t.String()),
      action: t.Optional(t.String()),
      text: t.Optional(t.String()),
    }),

    async open(ws) {
      const userId = await resolveUserId(ws.data.request, ws.data.query.token);
      if (!userId) {
        ws.send(JSON.stringify({ type: 'error', data: { message: 'Unauthorized' } }));
        ws.close();
        return;
      }

      socketUsers.set(ws, userId);
      if (!connections.has(userId)) connections.set(userId, new Set());
      connections.get(userId)!.add(ws);

      const pending = await notificationRepository.findByUser(userId, {
        status: ['pending', 'sent'],
      });
      ws.send(JSON.stringify({ type: 'snapshot', data: pending }));
    },

    async message(ws, message) {
      const userId = socketUsers.get(ws);
      if (!userId) return;

      try {
        switch (message.type) {
          case 'respond': {
            if (!message.id || !message.action) {
              ws.send(JSON.stringify({ type: 'error', data: { message: 'respond requires id and action' } }));
              break;
            }
            const result = await notificationService.respond(userId, message.id, {
              action: message.action,
              text: message.text,
            });
            ws.send(JSON.stringify({
              type: 'respond_result',
              id: message.id,
              ok: result.ok,
              ...(result.ok ? { terminalWritten: result.terminalWritten } : { error: result.error }),
            }));
            break;
          }
          case 'dismiss': {
            if (!message.id) break;
            const notification = await notificationRepository.findById(message.id);
            if (notification && notification.userId === userId) {
              await notificationRepository.updateStatus(message.id, 'dismissed');
            }
            break;
          }
          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
        }
      } catch (error) {
        ws.send(JSON.stringify({ type: 'error', data: { message: (error as Error).message } }));
      }
    },

    close(ws) {
      const userId = socketUsers.get(ws);
      if (!userId) return;
      const set = connections.get(userId);
      if (set) {
        set.delete(ws);
        if (set.size === 0) connections.delete(userId);
      }
    },
  });

import { Elysia, t } from 'elysia';
import { auth } from '../auth';
import { getLocalUserId } from '../auth/seed';
import { isLocalMode } from '../config/mode';
import { machineRegistry } from '../services/machine-registry';
import {
  notificationRepository,
  notificationService,
  notificationEvents,
  type NotificationStatusEvent,
} from '../services/notification';
import type { NotificationRecord } from '../services/notification/types';
import { presenceManager } from '../services/presence';
import { aggregateUserNotifications } from '../services/aggregation/notifications';
import { pairedMastersService } from '../services/paired-masters';

// Forward a respond/dismiss to the paired master that owns a remote notification.
// Returns true on a 2xx from the master. machineId 'self'/undefined → not remote.
async function forwardToMaster(
  userId: string,
  machineId: string | undefined,
  path: string,
  init: { method: string; body?: unknown },
): Promise<boolean | null> {
  if (!machineId || machineId === 'self') return null; // caller handles locally
  const master = await pairedMastersService.get(machineId, userId);
  if (!master) return null;
  try {
    const res = await fetch(`${master.url}/api${path}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${master.machineToken}`,
        'content-type': 'application/json',
        'accept-encoding': 'identity',
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Bidirectional notification stream for native clients (macOS notch app) and
// browsers. Unlike the terminal/ssh sockets this one is user-scoped, so it
// authenticates on open: machine bearer token (header or ?token=) or the
// better-auth cookie session.
//
// server→client: snapshot | notification | resolved | dismissed | pong | error
// client→server: respond | dismiss | ping

type Socket = { send: (data: string) => void; close: () => void };
// Elysia hands each ws event a fresh wrapper object, so we can't key connection
// state on the wrapper. `ws.data` (the raw Bun socket's data) IS stable across
// open/message/close — carry the userId on it and key connections by it.
type WSData = { userId?: string };

const connections = new Map<string, Map<WSData, Socket>>();

function sendToUser(userId: string, msg: unknown): void {
  const conns = connections.get(userId);
  if (conns) {
    const s = JSON.stringify(msg);
    conns.forEach(ws => ws.send(s));
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

  if (request) {
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user.id) return session.user.id;
  }

  // Local mode is single-user on loopback — the embedded notch app needs no pairing.
  if (isLocalMode()) return getLocalUserId();
  return null;
}

export const notificationWebsocketRoutes = new Elysia()
  .ws('/ws/notifications', {
    query: t.Object({ token: t.Optional(t.String()) }),
    body: t.Object({
      type: t.String(),
      id: t.Optional(t.String()),
      action: t.Optional(t.String()),
      text: t.Optional(t.String()),
      // One picked value per question, in question order (multi-question prompts).
      answers: t.Optional(t.Array(t.String())),
      // Origin machine of a remote notification — respond/dismiss proxy to it.
      machineId: t.Optional(t.String()),
    }),

    async open(ws) {
      const userId = await resolveUserId(ws.data.request, ws.data.query.token);
      if (!userId) {
        ws.send(JSON.stringify({ type: 'error', data: { message: 'Unauthorized' } }));
        ws.close();
        return;
      }

      const data = ws.data as unknown as WSData;
      data.userId = userId;
      if (!connections.has(userId)) connections.set(userId, new Map());
      connections.get(userId)!.set(data, ws);

      // Aggregate across self + all paired masters so the notch mirrors every
      // machine, not just this one. Each record is tagged with its origin machine.
      const snapshot = await aggregateUserNotifications(userId, { status: ['pending', 'sent'] });
      ws.send(JSON.stringify({ type: 'snapshot', data: snapshot.notifications }));
    },

    async message(ws, message) {
      const userId = (ws.data as unknown as WSData).userId;
      if (!userId) return;

      try {
        switch (message.type) {
          case 'respond': {
            console.log(`[notify-ws] respond: id=${message.id} action=${message.action} text=${message.text ? 'yes' : 'no'} machine=${message.machineId ?? 'self'} user=${userId}`);
            if (!message.id || !message.action) {
              ws.send(JSON.stringify({ type: 'error', data: { message: 'respond requires id and action' } }));
              break;
            }
            // Remote notification → proxy the respond to its origin master, which
            // types the answer into that machine's terminal. Local → handle here.
            const forwarded = await forwardToMaster(userId, message.machineId, `/notifications/${message.id}/respond`, {
              method: 'POST',
              body: { action: message.action, text: message.text, answers: message.answers },
            });
            if (forwarded !== null) {
              ws.send(JSON.stringify({ type: 'respond_result', id: message.id, ok: forwarded, ...(forwarded ? {} : { error: 'remote_failed' }) }));
              break;
            }
            const result = await notificationService.respond(userId, message.id, {
              action: message.action,
              text: message.text,
              answers: message.answers,
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
            const forwarded = await forwardToMaster(userId, message.machineId, `/notifications/${message.id}`, {
              method: 'PATCH',
              body: { status: 'dismissed' },
            });
            if (forwarded !== null) break; // remote handled (best-effort)
            const notification = await notificationRepository.findById(message.id);
            if (notification && notification.userId === userId) {
              await notificationRepository.updateStatus(message.id, 'dismissed');
            }
            break;
          }
          case 'refresh': {
            // Client-driven re-pull so remote-machine changes surface between the
            // instant local push events (which only cover this machine).
            const snapshot = await aggregateUserNotifications(userId, { status: ['pending', 'sent'] });
            ws.send(JSON.stringify({ type: 'snapshot', data: snapshot.notifications }));
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
      const data = ws.data as unknown as WSData;
      const userId = data.userId;
      if (!userId) return;
      const conns = connections.get(userId);
      if (conns) {
        conns.delete(data);
        if (conns.size === 0) connections.delete(userId);
      }
    },
  });

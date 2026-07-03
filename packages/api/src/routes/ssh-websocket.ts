import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, claudeSessions } from '../db';
import { sshService } from '../services/ssh/ssh.service';

// One WS per SSH session; mirrors terminal-websocket.ts.
const connections = new Map<string, Set<{ send: (data: string) => void }>>();

function broadcast(sessionId: string, msg: unknown): void {
  const set = connections.get(sessionId);
  if (set) { const s = JSON.stringify(msg); set.forEach(ws => ws.send(s)); }
}

sshService.on('output', ({ sessionId, data }: { sessionId: string; data: Uint8Array }) => {
  broadcast(sessionId, { type: 'output', data: Buffer.from(data).toString('base64') });
});
sshService.on('connected', (sessionId: string, size: { cols: number; rows: number }) => {
  broadcast(sessionId, { type: 'connected', data: size });
});
sshService.on('reconnecting', (sessionId: string, info: { attempt: number; delayMs: number }) => {
  broadcast(sessionId, { type: 'reconnecting', data: info });
});
sshService.on('resized', (sessionId: string, size: { cols: number; rows: number }) => {
  broadcast(sessionId, { type: 'resized', data: size });
});
sshService.on('log', (sessionId: string, entry: { type: string; message: string | null }) => {
  broadcast(sessionId, { type: 'log', data: entry });
});
sshService.on('exit', (sessionId: string, info: { message: string | null }) => {
  broadcast(sessionId, { type: 'exit', data: info });
});

export const sshWebsocketRoutes = new Elysia()
  .ws('/ws/ssh/:sessionId', {
    body: t.Object({ type: t.String(), data: t.Optional(t.Unknown()) }),

    async open(ws) {
      const sessionId = ws.data.params.sessionId;
      const session = await db.query.claudeSessions.findFirst({ where: eq(claudeSessions.id, sessionId) });
      if (!session?.sshHostId) {
        ws.send(JSON.stringify({ type: 'error', data: { message: 'SSH session not found' } }));
        ws.close();
        return;
      }

      if (!connections.has(sessionId)) connections.set(sessionId, new Set());
      connections.get(sessionId)!.add(ws);

      const live = sshService.getInstance(sessionId);
      ws.send(JSON.stringify({ type: 'status', data: { status: live?.status ?? 'exited' } }));

      const scrollback = sshService.getRawScrollback(sessionId);
      if (scrollback?.length) {
        ws.send(JSON.stringify({ type: 'scrollback', data: Buffer.from(scrollback).toString('base64') }));
      }
    },

    async message(ws, message) {
      const sessionId = ws.data.params.sessionId;
      const { type, data } = message as { type: string; data?: unknown };
      try {
        switch (type) {
          case 'input':
            await sshService.write(sessionId, Buffer.from(data as string, 'base64').toString());
            break;
          case 'resize': {
            const { cols, rows } = data as { cols: number; rows: number };
            await sshService.resize(sessionId, cols, rows);
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
      const sessionId = ws.data.params.sessionId;
      const set = connections.get(sessionId);
      if (set) { set.delete(ws); if (set.size === 0) connections.delete(sessionId); }
    },
  });

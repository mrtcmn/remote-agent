import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, terminals } from '../db';
import { sshService } from '../services/ssh/ssh.service';

// One WS per SSH terminal; mirrors terminal-websocket.ts.
const connections = new Map<string, Set<{ send: (data: string) => void }>>();

function broadcast(terminalId: string, msg: unknown): void {
  const set = connections.get(terminalId);
  if (set) { const s = JSON.stringify(msg); set.forEach(ws => ws.send(s)); }
}

sshService.on('output', ({ terminalId, data }: { terminalId: string; data: Uint8Array }) => {
  broadcast(terminalId, { type: 'output', data: Buffer.from(data).toString('base64') });
});
sshService.on('connected', (terminalId: string, size: { cols: number; rows: number }) => {
  broadcast(terminalId, { type: 'connected', data: size });
});
sshService.on('reconnecting', (terminalId: string, info: { attempt: number; delayMs: number }) => {
  broadcast(terminalId, { type: 'reconnecting', data: info });
});
sshService.on('resized', (terminalId: string, size: { cols: number; rows: number }) => {
  broadcast(terminalId, { type: 'resized', data: size });
});
sshService.on('log', (terminalId: string, entry: { type: string; message: string | null }) => {
  broadcast(terminalId, { type: 'log', data: entry });
});
sshService.on('exit', (terminalId: string, info: { message: string | null }) => {
  broadcast(terminalId, { type: 'exit', data: info });
});

export const sshWebsocketRoutes = new Elysia()
  .ws('/ws/ssh/:terminalId', {
    body: t.Object({ type: t.String(), data: t.Optional(t.Unknown()) }),

    async open(ws) {
      const terminalId = ws.data.params.terminalId;
      const terminal = await db.query.terminals.findFirst({ where: eq(terminals.id, terminalId) });
      if (terminal?.type !== 'ssh') {
        ws.send(JSON.stringify({ type: 'error', data: { message: 'SSH terminal not found' } }));
        ws.close();
        return;
      }

      if (!connections.has(terminalId)) connections.set(terminalId, new Set());
      connections.get(terminalId)!.add(ws);

      const live = sshService.getInstance(terminalId);
      ws.send(JSON.stringify({ type: 'status', data: { status: live?.status ?? 'exited' } }));

      const scrollback = sshService.getRawScrollback(terminalId);
      if (scrollback?.length) {
        ws.send(JSON.stringify({ type: 'scrollback', data: Buffer.from(scrollback).toString('base64') }));
      }
    },

    async message(ws, message) {
      const terminalId = ws.data.params.terminalId;
      const { type, data } = message as { type: string; data?: unknown };
      try {
        switch (type) {
          case 'input':
            await sshService.write(terminalId, Buffer.from(data as string, 'base64').toString());
            break;
          case 'resize': {
            const { cols, rows } = data as { cols: number; rows: number };
            await sshService.resize(terminalId, cols, rows);
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
      const terminalId = ws.data.params.terminalId;
      const set = connections.get(terminalId);
      if (set) { set.delete(ws); if (set.size === 0) connections.delete(terminalId); }
    },
  });

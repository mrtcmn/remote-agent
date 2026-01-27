import { Elysia, t } from 'elysia';
import { eq } from 'drizzle-orm';
import { db, terminals } from '../db';
import { terminalService } from '../services/terminal';
import type { TerminalOutput } from '../services/terminal/types';

// Store WebSocket connections per terminal
const terminalConnections = new Map<string, Set<{ send: (data: string) => void }>>();

// Subscribe to terminal service events
terminalService.on('output', (output: TerminalOutput) => {
  const connections = terminalConnections.get(output.terminalId);
  if (connections) {
    // Send binary data as base64
    const base64 = Buffer.from(output.data).toString('base64');
    const message = JSON.stringify({
      type: 'output',
      data: base64,
    });
    connections.forEach(ws => ws.send(message));
  }
});

terminalService.on('exit', (terminalId: string, info: { exitCode: number; signal: string | null }) => {
  const connections = terminalConnections.get(terminalId);
  if (connections) {
    const message = JSON.stringify({
      type: 'exit',
      data: info,
    });
    connections.forEach(ws => ws.send(message));
  }
});

terminalService.on('resized', (terminalId: string, size: { cols: number; rows: number }) => {
  const connections = terminalConnections.get(terminalId);
  if (connections) {
    const message = JSON.stringify({
      type: 'resized',
      data: size,
    });
    connections.forEach(ws => ws.send(message));
  }
});

export const terminalWebsocketRoutes = new Elysia()
  .ws('/ws/terminal/:terminalId', {
    body: t.Object({
      type: t.String(),
      data: t.Optional(t.Unknown()),
    }),

    async open(ws) {
      const terminalId = ws.data.params.terminalId;

      // Verify terminal exists
      const terminal = await db.query.terminals.findFirst({
        where: eq(terminals.id, terminalId),
      });

      if (!terminal) {
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: 'Terminal not found' },
        }));
        ws.close();
        return;
      }

      // Add to terminal connections
      if (!terminalConnections.has(terminalId)) {
        terminalConnections.set(terminalId, new Set());
      }
      terminalConnections.get(terminalId)!.add(ws);

      // Send current status
      const live = terminalService.getTerminal(terminalId);
      ws.send(JSON.stringify({
        type: 'connected',
        data: {
          status: live?.status || terminal.status,
          cols: terminal.cols,
          rows: terminal.rows,
        },
      }));

      // If terminal has persisted scrollback, send it
      if (terminal.scrollback) {
        const base64 = Buffer.from(terminal.scrollback).toString('base64');
        ws.send(JSON.stringify({
          type: 'scrollback',
          data: base64,
        }));
      }
    },

    async message(ws, message) {
      const terminalId = ws.data.params.terminalId;
      const { type, data } = message as { type: string; data?: unknown };

      switch (type) {
        case 'input': {
          // Write to terminal (data is base64 encoded)
          const input = Buffer.from(data as string, 'base64').toString();
          try {
            await terminalService.write(terminalId, input);
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'error',
              data: { message: (error as Error).message },
            }));
          }
          break;
        }

        case 'resize': {
          const { cols, rows } = data as { cols: number; rows: number };
          try {
            await terminalService.resize(terminalId, cols, rows);
          } catch (error) {
            ws.send(JSON.stringify({
              type: 'error',
              data: { message: (error as Error).message },
            }));
          }
          break;
        }

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    },

    close(ws) {
      const terminalId = ws.data.params.terminalId;
      const connections = terminalConnections.get(terminalId);
      if (connections) {
        connections.delete(ws);
        if (connections.size === 0) {
          terminalConnections.delete(terminalId);
        }
      }
    },
  });

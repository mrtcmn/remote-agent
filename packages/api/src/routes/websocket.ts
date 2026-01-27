import { Elysia, t } from 'elysia';
import { claudeService } from '../services/claude';
import type { ClaudeOutput } from '../services/claude/types';

// Store WebSocket connections per session
const sessionConnections = new Map<string, Set<{ send: (data: string) => void }>>();

// Subscribe to Claude service events
claudeService.on('output', (sessionId: string, output: ClaudeOutput) => {
  const connections = sessionConnections.get(sessionId);
  if (connections) {
    const message = JSON.stringify({ type: 'output', data: output });
    connections.forEach(ws => ws.send(message));
  }
});

claudeService.on('statusChange', (sessionId: string, status: string) => {
  const connections = sessionConnections.get(sessionId);
  if (connections) {
    const message = JSON.stringify({ type: 'status', data: { status } });
    connections.forEach(ws => ws.send(message));
  }
});

claudeService.on('inputRequired', (sessionId: string, prompt: string) => {
  const connections = sessionConnections.get(sessionId);
  if (connections) {
    const message = JSON.stringify({ type: 'input_required', data: { prompt } });
    connections.forEach(ws => ws.send(message));
  }
});

claudeService.on('permissionRequired', (sessionId: string, permission: string) => {
  const connections = sessionConnections.get(sessionId);
  if (connections) {
    const message = JSON.stringify({ type: 'permission_required', data: { permission } });
    connections.forEach(ws => ws.send(message));
  }
});

claudeService.on('terminated', (sessionId: string, code: number) => {
  const connections = sessionConnections.get(sessionId);
  if (connections) {
    const message = JSON.stringify({ type: 'terminated', data: { code } });
    connections.forEach(ws => ws.send(message));
  }
});

export const websocketRoutes = new Elysia()
  .ws('/ws/session/:sessionId', {
    body: t.Object({
      type: t.String(),
      payload: t.Optional(t.Unknown()),
    }),

    open(ws) {
      const sessionId = ws.data.params.sessionId;

      // Add to session connections
      if (!sessionConnections.has(sessionId)) {
        sessionConnections.set(sessionId, new Set());
      }
      sessionConnections.get(sessionId)!.add(ws);

      // Send current session status
      const session = claudeService.getSession(sessionId);
      if (session) {
        ws.send(JSON.stringify({
          type: 'connected',
          data: { status: session.status },
        }));
      } else {
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: 'Session not found' },
        }));
      }
    },

    message(ws, message) {
      const sessionId = ws.data.params.sessionId;
      const { type, payload } = message as { type: string; payload?: unknown };

      switch (type) {
        case 'input':
          // Send user input to Claude
          const inputPayload = payload as { text: string };
          claudeService.sendMessage(sessionId, inputPayload.text).catch(err => {
            ws.send(JSON.stringify({
              type: 'error',
              data: { message: err.message },
            }));
          });
          break;

        case 'respond_permission':
          // User responded to permission request
          const permPayload = payload as { allow: boolean };
          const response = permPayload.allow ? 'y' : 'n';
          claudeService.respondToInput(sessionId, response).catch(err => {
            ws.send(JSON.stringify({
              type: 'error',
              data: { message: err.message },
            }));
          });
          break;

        case 'terminate':
          // Terminate session
          claudeService.terminateSession(sessionId).catch(err => {
            ws.send(JSON.stringify({
              type: 'error',
              data: { message: err.message },
            }));
          });
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;
      }
    },

    close(ws) {
      const sessionId = ws.data.params.sessionId;
      const connections = sessionConnections.get(sessionId);
      if (connections) {
        connections.delete(ws);
        if (connections.size === 0) {
          sessionConnections.delete(sessionId);
        }
      }
    },
  });

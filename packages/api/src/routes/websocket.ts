import { Elysia } from 'elysia';
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
    idleTimeout: 960, // 16 minutes
    perMessageDeflate: false,

    open(ws) {
      const sessionId = ws.data.params.sessionId;
      console.log(`[WebSocket] Connection opened for session: ${sessionId}`);

      // Add to session connections
      if (!sessionConnections.has(sessionId)) {
        sessionConnections.set(sessionId, new Set());
      }
      sessionConnections.get(sessionId)!.add(ws);

      // Defer sending to avoid issues with Bun WebSocket
      setTimeout(() => {
        try {
          const session = claudeService.getSession(sessionId);
          console.log(`[WebSocket] Session lookup result:`, session ? `found (status: ${session.status})` : 'not found');

          if (session) {
            // Get output history and send it
            const history = claudeService.getOutputHistory(sessionId);
            ws.send(JSON.stringify({
              type: 'connected',
              data: {
                status: session.status,
                history: history,
              },
            }));
          } else {
            ws.send(JSON.stringify({
              type: 'error',
              data: { message: 'Session not found or not running' },
            }));
          }
        } catch (error) {
          console.error('[WebSocket] Error sending initial message:', error);
        }
      }, 10);
    },

    message(ws, rawMessage) {
      const sessionId = ws.data.params.sessionId;
      console.log(`[WebSocket] Raw message received:`, rawMessage);

      let message: { type: string; payload?: unknown };
      try {
        message = typeof rawMessage === 'string' ? JSON.parse(rawMessage) : rawMessage;
      } catch {
        ws.send(JSON.stringify({ type: 'error', data: { message: 'Invalid message format' } }));
        return;
      }

      const { type, payload } = message;
      console.log(`[WebSocket] Parsed message - type: ${type}, payload:`, payload);

      switch (type) {
        case 'input':
          // Send user input to Claude
          const inputPayload = payload as { text: string };
          console.log(`[WebSocket] Sending input to Claude session ${sessionId}: "${inputPayload.text}"`);
          claudeService.sendMessage(sessionId, inputPayload.text)
            .then(() => {
              console.log(`[WebSocket] Input sent successfully to session ${sessionId}`);
            })
            .catch(err => {
              console.error(`[WebSocket] Error sending input to session ${sessionId}:`, err);
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

    close(ws, code, reason) {
      const sessionId = ws.data.params.sessionId;
      console.log(`[WebSocket] Connection closed for session: ${sessionId}, code: ${code}, reason: ${reason}`);

      const connections = sessionConnections.get(sessionId);
      if (connections) {
        connections.delete(ws);
        if (connections.size === 0) {
          sessionConnections.delete(sessionId);
        }
      }
    },
  });

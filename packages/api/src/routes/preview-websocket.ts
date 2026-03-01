import { Elysia, t } from 'elysia';
import { browserPreviewService } from '../services/browser-preview';
import type {
  BrowserPreviewFrame,
  MouseInputEvent,
  KeyInputEvent,
  ScrollInputEvent,
  ViewportPreset,
} from '../services/browser-preview';
import { VIEWPORT_PRESETS } from '../services/browser-preview';

// Store WebSocket connections per preview
const previewConnections = new Map<string, Set<{ send: (data: string) => void }>>();

// Subscribe to browser preview service events
browserPreviewService.on('frame', (frame: BrowserPreviewFrame) => {
  const connections = previewConnections.get(frame.previewId);
  if (connections) {
    const message = JSON.stringify({
      type: 'frame',
      data: {
        image: frame.data,
        width: frame.width,
        height: frame.height,
        timestamp: frame.timestamp,
      },
    });
    connections.forEach(ws => ws.send(message));
  }
});

browserPreviewService.on('stopped', (info: { previewId: string; reason: string }) => {
  const connections = previewConnections.get(info.previewId);
  if (connections) {
    const message = JSON.stringify({
      type: 'stopped',
      data: { reason: info.reason },
    });
    connections.forEach(ws => ws.send(message));
  }
});

browserPreviewService.on('navigated', (info: { previewId: string; url: string }) => {
  const connections = previewConnections.get(info.previewId);
  if (connections) {
    const message = JSON.stringify({
      type: 'navigated',
      data: { url: info.url },
    });
    connections.forEach(ws => ws.send(message));
  }
});

export const previewWebsocketRoutes = new Elysia()
  .ws('/ws/preview/:previewId', {
    body: t.Object({
      type: t.String(),
      data: t.Optional(t.Unknown()),
    }),

    async open(ws) {
      const previewId = ws.data.params.previewId;

      // Verify preview exists
      const preview = browserPreviewService.getPreview(previewId);
      if (!preview) {
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: 'Preview not found' },
        }));
        ws.close();
        return;
      }

      // Add to preview connections
      if (!previewConnections.has(previewId)) {
        previewConnections.set(previewId, new Set());
      }
      previewConnections.get(previewId)!.add(ws);

      // Send current status
      const dimensions = VIEWPORT_PRESETS[preview.viewport];
      ws.send(JSON.stringify({
        type: 'connected',
        data: {
          status: preview.status,
          viewport: preview.viewport,
          url: preview.targetUrl,
          width: dimensions.width,
          height: dimensions.height,
        },
      }));
    },

    async message(ws, message) {
      const previewId = ws.data.params.previewId;
      const { type, data } = message as { type: string; data?: unknown };

      try {
        switch (type) {
          case 'mouse': {
            const event = data as MouseInputEvent;
            await browserPreviewService.sendMouseEvent(previewId, event);
            break;
          }

          case 'key': {
            const event = data as KeyInputEvent;
            await browserPreviewService.sendKeyEvent(previewId, event);
            break;
          }

          case 'scroll': {
            const event = data as ScrollInputEvent;
            await browserPreviewService.sendScrollEvent(previewId, event);
            break;
          }

          case 'navigate': {
            const { url } = data as { url: string };
            await browserPreviewService.navigate(previewId, url);
            break;
          }

          case 'viewport': {
            const { preset } = data as { preset: ViewportPreset };
            await browserPreviewService.setViewport(previewId, preset);
            break;
          }

          case 'ping':
            ws.send(JSON.stringify({ type: 'pong' }));
            break;
        }
      } catch (error) {
        ws.send(JSON.stringify({
          type: 'error',
          data: { message: (error as Error).message },
        }));
      }
    },

    close(ws) {
      const previewId = ws.data.params.previewId;
      const connections = previewConnections.get(previewId);
      if (connections) {
        connections.delete(ws);
        if (connections.size === 0) {
          previewConnections.delete(previewId);
        }
      }
    },
  });

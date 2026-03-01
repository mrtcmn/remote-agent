import { EventEmitter } from 'events';
import type {
  IBrowserPreviewService,
  BrowserPreviewInstance,
  ViewportPreset,
} from './types';

/**
 * Stub implementation for Phase 2 CDP browser preview.
 * All methods throw "not implemented" errors.
 *
 * Future implementation will:
 * 1. Launch headless Chromium via Playwright
 * 2. Connect via CDP: page.context().newCDPSession(page)
 * 3. Start screencast: cdpSession.send('Page.startScreencast', {...})
 * 4. Emit 'frame' events with base64 JPEG data
 * 5. Stream frames via WebSocket to frontend
 */
export class BrowserPreviewService extends EventEmitter implements IBrowserPreviewService {
  async start(_options: {
    terminalId: string;
    targetUrl: string;
    viewport?: ViewportPreset;
  }): Promise<BrowserPreviewInstance> {
    throw new Error('Browser preview is not yet implemented (Phase 2)');
  }

  async stop(_previewId: string): Promise<void> {
    throw new Error('Browser preview is not yet implemented (Phase 2)');
  }

  async setViewport(_previewId: string, _viewport: ViewportPreset): Promise<void> {
    throw new Error('Browser preview is not yet implemented (Phase 2)');
  }

  getPreview(_previewId: string): BrowserPreviewInstance | undefined {
    return undefined;
  }
}

export const browserPreviewService = new BrowserPreviewService();

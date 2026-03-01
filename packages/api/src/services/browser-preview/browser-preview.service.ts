import { EventEmitter } from 'events';
import { chromium, type Browser, type Page, type CDPSession } from 'playwright';
import { nanoid } from 'nanoid';
import type {
  IBrowserPreviewService,
  BrowserPreviewInstance,
  ViewportPreset,
  MouseInputEvent,
  KeyInputEvent,
  ScrollInputEvent,
} from './types';
import { VIEWPORT_PRESETS } from './types';

interface ActivePreview {
  instance: BrowserPreviewInstance;
  page: Page;
  cdpSession: CDPSession;
}

type CDPMouseButton = 'left' | 'right' | 'middle' | 'back' | 'forward' | 'none';
type CDPMouseType = 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel';

const CDP_MOUSE_BUTTON_MAP: Record<string, CDPMouseButton> = {
  left: 'left',
  right: 'right',
  middle: 'middle',
};

const CDP_MOUSE_TYPE_MAP: Record<string, CDPMouseType> = {
  mousedown: 'mousePressed',
  mouseup: 'mouseReleased',
  mousemove: 'mouseMoved',
  click: 'mousePressed',
};

export class BrowserPreviewService extends EventEmitter implements IBrowserPreviewService {
  private browser: Browser | null = null;
  private previews = new Map<string, ActivePreview>();

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser && this.browser.isConnected()) {
      return this.browser;
    }

    console.log('[BrowserPreview] Launching Chromium...');
    this.browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
      ],
    });

    this.browser.on('disconnected', () => {
      console.log('[BrowserPreview] Browser disconnected');
      this.browser = null;
    });

    console.log('[BrowserPreview] Chromium launched');
    return this.browser;
  }

  async start(options: {
    terminalId: string;
    targetUrl: string;
    viewport?: ViewportPreset;
  }): Promise<BrowserPreviewInstance> {
    const previewId = nanoid();
    const viewport = options.viewport || 'desktop';
    const dimensions = VIEWPORT_PRESETS[viewport];

    const instance: BrowserPreviewInstance = {
      id: previewId,
      terminalId: options.terminalId,
      targetUrl: options.targetUrl,
      viewport,
      status: 'starting',
    };

    try {
      const browser = await this.ensureBrowser();
      const page = await browser.newPage();
      await page.setViewportSize({ width: dimensions.width, height: dimensions.height });

      // Navigate to target URL
      await page.goto(options.targetUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });

      // Create CDP session for screencast
      const cdpSession = await page.context().newCDPSession(page);

      const preview: ActivePreview = { instance, page, cdpSession };
      this.previews.set(previewId, preview);

      // Listen for screencast frames
      cdpSession.on('Page.screencastFrame', async (params) => {
        this.emit('frame', {
          previewId,
          data: params.data,
          timestamp: Date.now(),
          width: dimensions.width,
          height: dimensions.height,
        });

        // Acknowledge frame to continue receiving
        try {
          await cdpSession.send('Page.screencastFrameAck', { sessionId: params.sessionId });
        } catch {
          // Session may have been closed
        }
      });

      // Start screencast
      await cdpSession.send('Page.startScreencast', {
        format: 'jpeg',
        quality: 80,
        maxWidth: dimensions.width,
        maxHeight: dimensions.height,
        everyNthFrame: 1,
      });

      instance.status = 'running';
      this.emit('started', instance);
      console.log(`[BrowserPreview] Preview ${previewId} started for ${options.targetUrl}`);

      return instance;
    } catch (error) {
      instance.status = 'error';
      instance.error = (error as Error).message;
      console.error(`[BrowserPreview] Failed to start preview:`, error);
      throw error;
    }
  }

  async stop(previewId: string): Promise<void> {
    const preview = this.previews.get(previewId);
    if (!preview) {
      throw new Error(`Preview ${previewId} not found`);
    }

    try {
      await preview.cdpSession.send('Page.stopScreencast').catch(() => {});
      await preview.cdpSession.detach().catch(() => {});
      await preview.page.close().catch(() => {});
    } catch {
      // Ignore cleanup errors
    }

    preview.instance.status = 'stopped';
    this.previews.delete(previewId);
    this.emit('stopped', { previewId, reason: 'user' });
    console.log(`[BrowserPreview] Preview ${previewId} stopped`);

    // Close browser if no previews left to free RAM
    if (this.previews.size === 0 && this.browser) {
      console.log('[BrowserPreview] No active previews, closing browser');
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
  }

  async setViewport(previewId: string, viewport: ViewportPreset): Promise<void> {
    const preview = this.previews.get(previewId);
    if (!preview) {
      throw new Error(`Preview ${previewId} not found`);
    }

    const dimensions = VIEWPORT_PRESETS[viewport];
    preview.instance.viewport = viewport;

    await preview.page.setViewportSize({ width: dimensions.width, height: dimensions.height });

    // Restart screencast with new dimensions
    await preview.cdpSession.send('Page.stopScreencast').catch(() => {});
    await preview.cdpSession.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
      maxWidth: dimensions.width,
      maxHeight: dimensions.height,
      everyNthFrame: 1,
    });
  }

  async navigate(previewId: string, url: string): Promise<void> {
    const preview = this.previews.get(previewId);
    if (!preview) {
      throw new Error(`Preview ${previewId} not found`);
    }

    preview.instance.targetUrl = url;
    await preview.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    this.emit('navigated', { previewId, url });
  }

  async sendMouseEvent(previewId: string, event: MouseInputEvent): Promise<void> {
    const preview = this.previews.get(previewId);
    if (!preview) return;

    const cdpType = CDP_MOUSE_TYPE_MAP[event.type];
    if (!cdpType) return;

    const button = CDP_MOUSE_BUTTON_MAP[event.button || 'left'] || 'left';
    const clickCount = event.type === 'click' ? 1 : (event.type === 'mousedown' ? 1 : 0);

    try {
      await preview.cdpSession.send('Input.dispatchMouseEvent', {
        type: cdpType,
        x: Math.round(event.x),
        y: Math.round(event.y),
        button,
        clickCount,
      });

      // For click events, also send mouseReleased
      if (event.type === 'click') {
        await preview.cdpSession.send('Input.dispatchMouseEvent', {
          type: 'mouseReleased',
          x: Math.round(event.x),
          y: Math.round(event.y),
          button,
          clickCount: 1,
        });
      }
    } catch {
      // Ignore input dispatch errors
    }
  }

  async sendKeyEvent(previewId: string, event: KeyInputEvent): Promise<void> {
    const preview = this.previews.get(previewId);
    if (!preview) return;

    try {
      if (event.type === 'char') {
        await preview.cdpSession.send('Input.dispatchKeyEvent', {
          type: 'char',
          text: event.key,
          modifiers: event.modifiers || 0,
        });
      } else {
        const cdpType = event.type === 'keydown' ? 'keyDown' : 'keyUp';
        await preview.cdpSession.send('Input.dispatchKeyEvent', {
          type: cdpType,
          key: event.key,
          code: event.code || '',
          modifiers: event.modifiers || 0,
          windowsVirtualKeyCode: getVirtualKeyCode(event.key),
        });
      }
    } catch {
      // Ignore input dispatch errors
    }
  }

  async sendScrollEvent(previewId: string, event: ScrollInputEvent): Promise<void> {
    const preview = this.previews.get(previewId);
    if (!preview) return;

    try {
      await preview.cdpSession.send('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: Math.round(event.x),
        y: Math.round(event.y),
        deltaX: event.deltaX,
        deltaY: event.deltaY,
      });
    } catch {
      // Ignore input dispatch errors
    }
  }

  getPreview(previewId: string): BrowserPreviewInstance | undefined {
    return this.previews.get(previewId)?.instance;
  }

  getActivePreviews(): BrowserPreviewInstance[] {
    return Array.from(this.previews.values()).map(p => p.instance);
  }

  async shutdown(): Promise<void> {
    console.log('[BrowserPreview] Shutting down...');
    const previewIds = Array.from(this.previews.keys());
    for (const id of previewIds) {
      await this.stop(id).catch(() => {});
    }
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
    }
    console.log('[BrowserPreview] Shutdown complete');
  }
}

/** Map common key names to Windows virtual key codes for CDP */
function getVirtualKeyCode(key: string): number {
  const map: Record<string, number> = {
    Backspace: 8, Tab: 9, Enter: 13, Shift: 16, Control: 17, Alt: 18,
    Escape: 27, Space: 32, ' ': 32,
    ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    Delete: 46, Home: 36, End: 35, PageUp: 33, PageDown: 34,
    F1: 112, F2: 113, F3: 114, F4: 115, F5: 116, F6: 117,
    F7: 118, F8: 119, F9: 120, F10: 121, F11: 122, F12: 123,
  };

  if (map[key]) return map[key];
  // For single characters, use char code
  if (key.length === 1) return key.toUpperCase().charCodeAt(0);
  return 0;
}

export const browserPreviewService = new BrowserPreviewService();

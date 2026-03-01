export const VIEWPORT_PRESETS = {
  mobile: { width: 375, height: 667, label: 'Mobile' },
  tablet: { width: 768, height: 1024, label: 'Tablet' },
  desktop: { width: 1280, height: 720, label: 'Desktop' },
  desktop_hd: { width: 1920, height: 1080, label: 'Desktop HD' },
} as const;

export type ViewportPreset = keyof typeof VIEWPORT_PRESETS;

export interface BrowserPreviewInstance {
  id: string;
  terminalId: string; // The dev server terminal
  targetUrl: string;
  viewport: ViewportPreset;
  status: 'starting' | 'running' | 'stopped' | 'error';
  error?: string;
}

export interface BrowserPreviewFrame {
  previewId: string;
  data: string; // base64 JPEG
  timestamp: number;
  width: number;
  height: number;
}

export interface MouseInputEvent {
  type: 'mousedown' | 'mouseup' | 'mousemove' | 'click';
  x: number;
  y: number;
  button?: 'left' | 'right' | 'middle';
}

export interface KeyInputEvent {
  type: 'keydown' | 'keyup' | 'char';
  key: string;
  code?: string;
  modifiers?: number; // CDP modifier bitmask: Alt=1, Ctrl=2, Meta=4, Shift=8
}

export interface ScrollInputEvent {
  type: 'scroll';
  x: number;
  y: number;
  deltaX: number;
  deltaY: number;
}

export interface IBrowserPreviewService {
  start(options: {
    terminalId: string;
    targetUrl: string;
    viewport?: ViewportPreset;
  }): Promise<BrowserPreviewInstance>;
  stop(previewId: string): Promise<void>;
  setViewport(previewId: string, viewport: ViewportPreset): Promise<void>;
  navigate(previewId: string, url: string): Promise<void>;
  sendMouseEvent(previewId: string, event: MouseInputEvent): Promise<void>;
  sendKeyEvent(previewId: string, event: KeyInputEvent): Promise<void>;
  sendScrollEvent(previewId: string, event: ScrollInputEvent): Promise<void>;
  getPreview(previewId: string): BrowserPreviewInstance | undefined;
  getActivePreviews(): BrowserPreviewInstance[];
  shutdown(): Promise<void>;
}

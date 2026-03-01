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

export interface IBrowserPreviewService {
  start(options: {
    terminalId: string;
    targetUrl: string;
    viewport?: ViewportPreset;
  }): Promise<BrowserPreviewInstance>;
  stop(previewId: string): Promise<void>;
  setViewport(previewId: string, viewport: ViewportPreset): Promise<void>;
  getPreview(previewId: string): BrowserPreviewInstance | undefined;
}

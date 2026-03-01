import { useState, useRef, useCallback, type KeyboardEvent, type MouseEvent, type WheelEvent } from 'react';
import { Monitor, Smartphone, Tablet, MonitorUp, ChevronDown, ArrowRight, Square } from 'lucide-react';
import { useBrowserPreview } from '@/hooks/useBrowserPreview';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import type { ViewportPreset } from '@/lib/api';

interface BrowserPreviewProps {
  previewId: string;
  onStop?: () => void;
  className?: string;
}

const VIEWPORT_OPTIONS: { value: ViewportPreset; label: string; dimensions: string; icon: typeof Monitor }[] = [
  { value: 'mobile', label: 'Mobile', dimensions: '375 x 667', icon: Smartphone },
  { value: 'tablet', label: 'Tablet', dimensions: '768 x 1024', icon: Tablet },
  { value: 'desktop', label: 'Desktop', dimensions: '1280 x 720', icon: Monitor },
  { value: 'desktop_hd', label: 'Desktop HD', dimensions: '1920 x 1080', icon: MonitorUp },
];

export function BrowserPreview({ previewId, onStop, className }: BrowserPreviewProps) {
  const {
    imageSrc,
    isConnected,
    status,
    fps,
    navigate,
    setViewport,
    sendMouseEvent,
    sendKeyEvent,
    sendScrollEvent,
    scaleCoordinates,
  } = useBrowserPreview(previewId);

  const [urlInput, setUrlInput] = useState('');
  const [showViewportMenu, setShowViewportMenu] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Sync URL input with status
  if (status?.url && urlInput === '') {
    setUrlInput(status.url);
  }

  const handleNavigate = useCallback(() => {
    if (urlInput.trim()) {
      let url = urlInput.trim();
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        url = `http://${url}`;
      }
      navigate(url);
      setUrlInput(url);
    }
  }, [urlInput, navigate]);

  const handleUrlKeyDown = useCallback((e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleNavigate();
    }
  }, [handleNavigate]);

  const handleMouseEvent = useCallback((
    e: MouseEvent<HTMLImageElement>,
    type: 'mousedown' | 'mouseup' | 'mousemove' | 'click',
  ) => {
    if (!imgRef.current) return;
    const coords = scaleCoordinates(e.clientX, e.clientY, imgRef.current);
    if (!coords) return;

    const button = e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left';
    sendMouseEvent(type, coords.x, coords.y, button as 'left' | 'right' | 'middle');
  }, [scaleCoordinates, sendMouseEvent]);

  const handleWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    if (!imgRef.current) return;
    const coords = scaleCoordinates(e.clientX, e.clientY, imgRef.current);
    if (!coords) return;

    e.preventDefault();
    sendScrollEvent(coords.x, coords.y, e.deltaX, e.deltaY);
  }, [scaleCoordinates, sendScrollEvent]);

  const handleKeyDown = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    // Don't capture if focused on URL input
    if ((e.target as HTMLElement).tagName === 'INPUT') return;

    e.preventDefault();

    let modifiers = 0;
    if (e.altKey) modifiers |= 1;
    if (e.ctrlKey) modifiers |= 2;
    if (e.metaKey) modifiers |= 4;
    if (e.shiftKey) modifiers |= 8;

    sendKeyEvent('keydown', e.key, e.code, modifiers);

    // Also send char event for printable characters
    if (e.key.length === 1) {
      sendKeyEvent('char', e.key, e.code, modifiers);
    }
  }, [sendKeyEvent]);

  const handleKeyUp = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    e.preventDefault();

    let modifiers = 0;
    if (e.altKey) modifiers |= 1;
    if (e.ctrlKey) modifiers |= 2;
    if (e.metaKey) modifiers |= 4;
    if (e.shiftKey) modifiers |= 8;

    sendKeyEvent('keyup', e.key, e.code, modifiers);
  }, [sendKeyEvent]);

  const currentViewport = VIEWPORT_OPTIONS.find(v => v.value === status?.viewport) || VIEWPORT_OPTIONS[2];

  return (
    <div
      className={cn('flex flex-col h-full bg-background', className)}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      tabIndex={0}
      ref={containerRef}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 h-10 px-3 border-b bg-card/30 shrink-0">
        {/* URL Bar */}
        <div className="flex-1 flex items-center gap-1">
          <input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onKeyDown={handleUrlKeyDown}
            placeholder="Enter URL..."
            className="flex-1 h-7 px-2 rounded text-xs font-mono bg-muted/50 border border-border/50 focus:outline-none focus:ring-1 focus:ring-ring"
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            onClick={handleNavigate}
            title="Navigate"
          >
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Viewport Selector */}
        <div className="relative">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 px-2 text-xs font-mono"
            onClick={() => setShowViewportMenu(!showViewportMenu)}
          >
            <currentViewport.icon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">{currentViewport.label}</span>
            <ChevronDown className="h-3 w-3" />
          </Button>

          {showViewportMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowViewportMenu(false)} />
              <div className="absolute right-0 top-full mt-1 bg-card border rounded-md shadow-lg z-20 min-w-[180px]">
                {VIEWPORT_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    className={cn(
                      'flex items-center gap-2 w-full px-3 py-2 text-left text-xs hover:bg-accent',
                      status?.viewport === option.value && 'bg-accent',
                    )}
                    onClick={() => {
                      setViewport(option.value);
                      setShowViewportMenu(false);
                    }}
                  >
                    <option.icon className="h-3.5 w-3.5" />
                    <span className="flex-1 font-mono">{option.label}</span>
                    <span className="text-muted-foreground">{option.dimensions}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Stop Button */}
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-destructive hover:text-destructive"
          onClick={onStop}
          title="Stop preview"
        >
          <Square className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Preview Area */}
      <div
        className="flex-1 min-h-0 overflow-auto flex items-start justify-center bg-muted/20 p-2"
        onWheel={handleWheel}
      >
        {imageSrc ? (
          <img
            ref={imgRef}
            src={imageSrc}
            alt="Browser preview"
            className="max-w-full max-h-full object-contain cursor-default select-none"
            style={{ imageRendering: 'auto' }}
            draggable={false}
            onMouseDown={(e) => handleMouseEvent(e, 'mousedown')}
            onMouseUp={(e) => handleMouseEvent(e, 'mouseup')}
            onMouseMove={(e) => handleMouseEvent(e, 'mousemove')}
            onClick={(e) => handleMouseEvent(e, 'click')}
            onContextMenu={(e) => e.preventDefault()}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-muted-foreground">
            <div className="text-center">
              <Monitor className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-mono">
                {isConnected ? 'Waiting for first frame...' : 'Connecting...'}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Status Bar */}
      <div className="flex items-center gap-3 h-6 px-3 border-t bg-card/30 text-[10px] font-mono text-muted-foreground shrink-0">
        <span className="flex items-center gap-1">
          <div className={cn(
            'h-1.5 w-1.5 rounded-full',
            isConnected ? 'bg-green-500' : 'bg-red-500',
          )} />
          {isConnected ? 'Connected' : 'Disconnected'}
        </span>
        {status && (
          <>
            <span>{status.width} x {status.height}</span>
            <span>{fps} fps</span>
          </>
        )}
      </div>
    </div>
  );
}

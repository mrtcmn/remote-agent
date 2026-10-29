import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, RotateCw, SquareCode, X } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Electrobun's <electrobun-webview> element — only the members we call. */
interface WebviewTag extends HTMLElement {
  loadURL(url: string): void;
  goBack(): void;
  goForward(): void;
  reload(): void;
  toggleDevTools(): void;
  togglePassthrough(enable?: boolean): void;
  executeJavascript(js: string): void;
  on(event: string, listener: (e: CustomEvent) => void): void;
  off(event: string, listener: (e: CustomEvent) => void): void;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      'electrobun-webview': React.HTMLAttributes<HTMLElement> & {
        ref?: React.Ref<WebviewTag>;
        src?: string;
        renderer?: 'cef' | 'native';
        masks?: string;
      };
    }
  }
}

/**
 * Draws a pointer where the mouse moves or clicks, but only while
 * window.__raAgentUntil is in the future — set by the host while the agent runs
 * agent-browser (CDP input looks exactly like the user's own mouse). Built with
 * DOM calls, not innerHTML, so Trusted Types pages accept it; aria-hidden keeps it
 * out of snapshots.
 */
const CURSOR_JS = `(() => {
  if (window.__raCursor) return;
  const ns = 'http://www.w3.org/2000/svg';
  const c = document.createElement('div');
  c.setAttribute('aria-hidden', 'true');
  c.style.cssText = 'position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;opacity:0;transition:transform .2s ease-out,opacity .6s';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('width', '20'); svg.setAttribute('height', '20'); svg.setAttribute('viewBox', '0 0 24 24');
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', 'M4 2l16 10.5-7 1.5-3.5 7z');
  path.setAttribute('fill', '#0ea5e9'); path.setAttribute('stroke', 'white');
  path.setAttribute('stroke-width', '1.5'); path.setAttribute('stroke-linejoin', 'round');
  svg.append(path); c.append(svg);
  document.documentElement.append(c);
  window.__raCursor = c;
  let idle;
  const byAgent = () => (window.__raAgentUntil || 0) > Date.now();
  const show = (e) => {
    c.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
    c.style.opacity = '1';
    clearTimeout(idle);
    idle = setTimeout(() => { c.style.opacity = '0'; }, 2500);
  };
  addEventListener('mousemove', (e) => { if (byAgent()) show(e); }, true);
  addEventListener('mousedown', (e) => {
    if (!byAgent()) return;
    show(e);
    const r = document.createElement('div');
    r.setAttribute('aria-hidden', 'true');
    r.style.cssText = 'position:fixed;width:24px;height:24px;border:2px solid #0ea5e9;border-radius:50%;z-index:2147483647;pointer-events:none;transition:transform .5s,opacity .5s;left:' + (e.clientX - 12) + 'px;top:' + (e.clientY - 12) + 'px';
    document.documentElement.append(r);
    requestAnimationFrame(() => { r.style.transform = 'scale(2)'; r.style.opacity = '0'; });
    setTimeout(() => r.remove(), 600);
  }, true);
})();`;

const urlOf = (detail: unknown) => (typeof detail === 'string' ? detail : (detail as { url?: string })?.url ?? '');

/**
 * The agent's browser in the desktop app: a real Chromium (CEF) view that fills
 * the panel. agent-browser attaches to it over CDP, so the user watches the
 * exact page the agent drives — and can take over or inspect it.
 */
export function NativeBrowser({
  url,
  openedAt,
  agentUntil = 0,
  resizing,
  onClose,
}: {
  url: string;
  /** Changes on every open_browser call, so a repeat of the same URL reloads it. */
  openedAt: number;
  /** Until when the agent is driving (server clock, same machine); the cursor shows only then. */
  agentUntil?: number;
  /** While the panel edge is dragged, the native view lets the mouse through. */
  resizing: boolean;
  onClose: () => void;
}) {
  const ref = useRef<WebviewTag>(null);
  const [address, setAddress] = useState(url);
  const [initialUrl] = useState(url);
  const agentUntilRef = useRef(agentUntil);
  agentUntilRef.current = agentUntil;

  useEffect(() => {
    const view = ref.current;
    if (!view) return;
    const onNavigate = (e: CustomEvent) => {
      const next = urlOf(e.detail);
      if (next && document.activeElement?.tagName !== 'INPUT') setAddress(next);
    };
    // Each new document needs the script and the flag again.
    const onReady = () => view.executeJavascript(`window.__raAgentUntil = ${agentUntilRef.current};${CURSOR_JS}`);
    view.on('did-navigate', onNavigate);
    view.on('did-navigate-in-page', onNavigate);
    view.on('dom-ready', onReady);
    return () => {
      view.off('did-navigate', onNavigate);
      view.off('did-navigate-in-page', onNavigate);
      view.off('dom-ready', onReady);
    };
  }, []);

  // The first URL loads through the src attribute; later opens navigate.
  const firstOpen = useRef(openedAt);
  useEffect(() => {
    if (openedAt === firstOpen.current) return;
    ref.current?.loadURL(url);
    setAddress(url);
  }, [url, openedAt]);

  useEffect(() => {
    ref.current?.executeJavascript(`window.__raAgentUntil = ${agentUntil};`);
  }, [agentUntil]);

  useEffect(() => {
    ref.current?.togglePassthrough(resizing);
  }, [resizing]);

  const go = () => {
    let next = address.trim();
    if (!next) return;
    if (!/^[a-z]+:/i.test(next)) next = `http://${next}`;
    ref.current?.loadURL(next);
    setAddress(next);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      go();
      e.currentTarget.blur();
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-border px-1.5">
        <IconButton label="Back" onClick={() => ref.current?.goBack()}><ArrowLeft className="size-3.5" /></IconButton>
        <IconButton label="Forward" onClick={() => ref.current?.goForward()}><ArrowRight className="size-3.5" /></IconButton>
        <IconButton label="Reload" onClick={() => ref.current?.reload()}><RotateCw className="size-3.5" /></IconButton>
        <input
          value={address}
          onChange={(e) => setAddress(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={(e) => e.currentTarget.select()}
          spellCheck={false}
          className="mx-1 h-6 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-2 font-mono text-[11px] text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <IconButton label="Inspector" onClick={() => ref.current?.toggleDevTools()}><SquareCode className="size-3.5" /></IconButton>
        <IconButton label="Close browser" onClick={onClose}><X className="size-3.5" /></IconButton>
      </div>
      <electrobun-webview
        ref={ref}
        src={initialUrl}
        renderer="cef"
        // Dialogs drawn by the app would sit under the native view; cut them out.
        masks="[role=dialog]"
        // Inline, not classes: Electrobun's stylesheet pins the tag to 800x300,
        // and React 18 does not map className onto a custom element.
        style={{ display: 'block', width: '100%', flex: '1 1 0%', minHeight: 0 }}
      />
    </div>
  );
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-md',
        'text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground',
      )}
    >
      {children}
    </button>
  );
}

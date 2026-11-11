import { ExternalLink, X } from 'lucide-react';

/** code-server in a side panel. `src` is the API's own /code proxy, never a second port. */
export function CodePanel({ src, resizing, onClose }: { src: string; resizing: boolean; onClose: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-1 px-2 h-8 shrink-0 text-xs text-muted-foreground">
        <span className="flex-1 truncate">VS Code</span>
        <button
          aria-label="Open in a new window"
          title="Open in a new window"
          className="p-1 rounded hover:bg-accent"
          onClick={() => window.open(src, '_blank')}
        >
          <ExternalLink className="size-3.5" />
        </button>
        <button aria-label="Close VS Code" title="Close" className="p-1 rounded hover:bg-accent" onClick={onClose}>
          <X className="size-3.5" />
        </button>
      </div>
      {/* pointer-events off while dragging, or the iframe swallows the resize. */}
      <iframe
        src={src}
        title="VS Code"
        className="flex-1 w-full border-0 rounded-b-[inherit]"
        style={{ pointerEvents: resizing ? 'none' : undefined }}
        allow="clipboard-read; clipboard-write"
      />
    </div>
  );
}

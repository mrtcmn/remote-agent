import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bot, FileText, FolderGit2, GitBranch, Loader2, Maximize2, Minus, Play,
  Plus, RefreshCw, TriangleAlert, X,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Kbd } from '@/components/ui/kbd';
import { FormattedText } from '@/components/FormattedText';
import { MermaidDiagram } from '@/components/presentation/MermaidDiagram';
import { useCLIAdapters } from '@/hooks/useKanban';
import { parsePlanDoc } from '@/lib/plan-doc';
import { cn } from '@/lib/utils';
import type { CLIAdapterType, KanbanTask, PlanStatus, Project } from '@/lib/api';

const statusLabels: Record<PlanStatus, string> = {
  none: 'No plan',
  planning: 'Planning',
  ready: 'Plan ready',
  executing: 'Executing',
  done: 'Executed',
  failed: 'Failed',
};

const statusStyles: Record<PlanStatus, string> = {
  none: 'bg-muted text-muted-foreground',
  planning: 'bg-blue-500/15 text-blue-400',
  ready: 'bg-primary/15 text-primary',
  executing: 'bg-amber-500/15 text-amber-400',
  done: 'bg-green-500/15 text-green-400',
  failed: 'bg-destructive/15 text-destructive',
};

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

/**
 * Full-screen view of one diagram. A native <dialog> so Esc, the backdrop and
 * focus containment are the browser's job. Zoom widens the canvas rather than
 * transforming it, which leaves panning to the scroll container.
 */
export function DiagramLightbox({ source, onClose }: { source: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog
      ref={ref}
      className="ra-lightbox"
      onClose={onClose}
      onClick={(e) => {
        // Clicks land on the dialog itself only when they miss the content.
        if (e.target === ref.current) ref.current?.close();
      }}
      onKeyDown={(e) => {
        if (e.key === '+' || e.key === '=') setZoom((z) => clampZoom(z + 0.5));
        if (e.key === '-') setZoom((z) => clampZoom(z - 0.5));
        if (e.key === '0') setZoom(1);
      }}
    >
      <div className="flex flex-col h-full">
        <header className="flex items-center gap-2 px-3 py-2 border-b shrink-0">
          <FileText className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Architecture</h2>

          <div className="ml-auto flex items-center gap-1">
            <Button
              size="icon" variant="ghost" className="h-7 w-7"
              disabled={zoom <= MIN_ZOOM}
              onClick={() => setZoom((z) => clampZoom(z - 0.5))}
              aria-label="Zoom out"
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <button
              onClick={() => setZoom(1)}
              className="min-w-[3.5rem] text-xs tabular-nums text-muted-foreground hover:text-foreground"
              title="Reset zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <Button
              size="icon" variant="ghost" className="h-7 w-7"
              disabled={zoom >= MAX_ZOOM}
              onClick={() => setZoom((z) => clampZoom(z + 0.5))}
              aria-label="Zoom in"
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="icon" variant="ghost" className="h-7 w-7 ml-1"
              onClick={() => ref.current?.close()}
              aria-label="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {/* Scroll container: at zoom > 1 this is what pans. */}
        <div className="flex-1 overflow-auto bg-zinc-950">
          <div
            style={{ width: `${zoom * 100}%` }}
            onDoubleClick={() => setZoom((z) => (z > 1 ? 1 : 2))}
            // The holder is a flex item that shrinks to content, and mermaid
            // stamps an inline max-width on the svg. Override both, or the
            // diagram sits at 300px in a full-screen dialog and zoom does
            // nothing.
            className="mx-auto [&>div]:border-t-0 [&>div]:p-4 [&>div>div]:w-full [&_svg]:w-full [&_svg]:!max-w-none"
          >
            <MermaidDiagram
              source={source}
              fallback={
                <div className="p-4">
                  <p className="mb-2 text-xs text-amber-400">
                    This diagram did not parse. The mermaid source is below.
                  </p>
                  <pre className="overflow-x-auto text-xs font-mono text-zinc-300 whitespace-pre-wrap">
                    {source}
                  </pre>
                </div>
              }
            />
          </div>
        </div>

        <footer className="flex items-center gap-1.5 px-3 py-1.5 border-t text-[11px] text-muted-foreground shrink-0">
          Double-click to zoom
          <Kbd>+</Kbd><Kbd>−</Kbd><Kbd>0</Kbd>
          <span className="ml-1">·</span>
          <Kbd>Esc</Kbd> to close
        </footer>
      </div>
    </dialog>
  );
}

interface PlanDocumentProps {
  task: KanbanTask;
  projects: Project[];
  onPlan: () => void;
  onExecute: () => void;
  onAdapterChange: (adapterType: CLIAdapterType) => void;
  onProjectChange: (projectId: string) => void;
}

export function PlanDocument({
  task, projects, onPlan, onExecute, onAdapterChange, onProjectChange,
}: PlanDocumentProps) {
  const status = task.planStatus ?? 'none';
  const busy = status === 'planning' || status === 'executing';
  const blocks = useMemo(() => parsePlanDoc(task.planDoc || ''), [task.planDoc]);
  const { data: adapters = [] } = useCLIAdapters();
  const adapterType = task.adapterType || 'claude_code';
  const [zoomed, setZoomed] = useState<string | null>(null);

  return (
    <section className="rounded-xl border bg-card/60 overflow-hidden">
      {/* Island header */}
      <header className="flex items-center gap-2 px-3 py-2 border-b bg-background/40">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold">Plan</h3>
        <span className={cn('px-1.5 py-0.5 text-[10px] font-medium rounded', statusStyles[status])}>
          {statusLabels[status]}
        </span>

        <div className="ml-auto flex items-center gap-1">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1.5"
            disabled={busy || !task.project}
            onClick={onPlan}
          >
            {status === 'planning'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : task.planDoc ? <RefreshCw className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
            {task.planDoc ? 'Re-plan' : 'Plan with agent'}
          </Button>
          <Button
            size="sm"
            className="h-7 text-xs gap-1.5"
            disabled={busy || !task.planDoc || !task.project}
            onClick={onExecute}
          >
            {status === 'executing'
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Play className="h-3.5 w-3.5" />}
            Execute
          </Button>
        </div>
      </header>

      {/* Where the agent runs, and which agent. Both decide the outcome, so
          they belong next to the button that starts it. */}
      <div className="flex items-center gap-2 flex-wrap px-3 py-2 border-b text-xs">
        <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <select
          value={task.projectId}
          onChange={(e) => onProjectChange(e.target.value)}
          disabled={busy}
          className="h-6 px-1.5 text-[11px] font-medium rounded border bg-background cursor-pointer disabled:opacity-50"
          title="Which project the agent works in"
        >
          {!projects.some((p) => p.id === task.projectId) && (
            <option value={task.projectId}>{task.project?.name || task.projectId}</option>
          )}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        {task.project ? (
          <code className="text-[11px] text-muted-foreground truncate max-w-[220px]">
            {task.project.localPath}
          </code>
        ) : (
          <span className="text-destructive">No project — the agent cannot run.</span>
        )}

        {task.branch && (
          <span className="flex items-center gap-1 text-muted-foreground">
            <GitBranch className="h-3.5 w-3.5" />
            {task.branch}
          </span>
        )}

        <select
          value={adapterType}
          onChange={(e) => onAdapterChange(e.target.value as CLIAdapterType)}
          disabled={busy}
          className="ml-auto h-6 px-1.5 text-[11px] rounded border bg-background cursor-pointer disabled:opacity-50"
          title="Which agent runs this task"
        >
          {adapters.length === 0 && <option value={adapterType}>{adapterType}</option>}
          {adapters.map((a) => (
            <option key={a.type} value={a.type} disabled={!a.available}>
              {a.name}{a.available ? '' : ' (not installed)'}
            </option>
          ))}
        </select>
      </div>

      {/* Document */}
      <div className="p-3">
        {status === 'failed' && !task.planDoc && (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <TriangleAlert className="h-4 w-4" />
            The agent failed. Check the API log, then try again.
          </p>
        )}

        {busy && !task.planDoc && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {adapters.find((a) => a.type === adapterType)?.name || 'The agent'} is reading{' '}
            {task.project?.name ?? 'the repository'}…
          </p>
        )}

        {!busy && !task.planDoc && status !== 'failed' && (
          <p className="text-sm text-muted-foreground">
            No plan yet. The agent reads the repository and writes what it will change
            in the UI, the API, and the database.
          </p>
        )}

        {blocks.length > 0 && (
          <div className="space-y-3">
            {blocks.map((block, i) =>
              block.type === 'mermaid' ? (
                // Diagrams render on their own dark canvas — mermaid is themed dark.
                <button
                  key={i}
                  type="button"
                  onClick={() => setZoomed(block.value)}
                  aria-label="Enlarge diagram"
                  className="group relative block w-full rounded-lg border bg-zinc-950 [&>div]:border-t-0 cursor-zoom-in hover:border-primary/40 transition-colors"
                >
                  <MermaidDiagram source={block.value} />
                  <span className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded bg-black/70 text-[10px] text-white opacity-0 group-hover:opacity-100 transition-opacity">
                    <Maximize2 className="h-3 w-3" />
                    Enlarge
                  </span>
                </button>
              ) : (
                <FormattedText key={i} text={block.value} className="text-sm" />
              ),
            )}
          </div>
        )}
      </div>

      {zoomed && <DiagramLightbox source={zoomed} onClose={() => setZoomed(null)} />}
    </section>
  );
}

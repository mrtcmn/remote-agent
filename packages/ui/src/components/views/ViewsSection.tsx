import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutPanelLeft, Plus, Trash2 } from 'lucide-react';
import { api, type ViewSummary } from '@/lib/api';
import { PANEL_DRAG_TYPE, readDragPanel } from '@/lib/views';
import { SessionChip } from './ViewPanels';
import { toast } from '@/components/ui/Toaster';
import { cn } from '@/lib/utils';

/** Sidebar group, above the machines: the saved split views. */
export function ViewsSection({ onNavigate }: { onNavigate: (path: string) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { data } = useQuery({ queryKey: ['views'], queryFn: api.listViews });
  const views = data?.views ?? [];

  const create = useMutation({
    mutationFn: () => api.createView({ panels: [] }),
    onSuccess: (view) => {
      queryClient.invalidateQueries({ queryKey: ['views'] });
      navigate(`/views/${view.id}`);
    },
  });

  return (
    <div className="pb-1">
      <div className="flex w-full items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
        <LayoutPanelLeft className="size-3" />
        <span className="font-medium">Views</span>
        <button
          type="button"
          title="New view"
          onClick={() => create.mutate()}
          className="ml-auto flex size-5 items-center justify-center rounded hover:bg-secondary hover:text-foreground"
        >
          <Plus className="size-3" />
        </button>
      </div>
      <div className="px-2">
        {views.length === 0 ? (
          <p className="px-1 pb-1 text-[11px] text-muted-foreground/40">Drag a tab to the edge of a session to split it.</p>
        ) : (
          views.map((v) => <ViewRow key={v.id} view={v} onNavigate={onNavigate} />)
        )}
      </div>
    </div>
  );
}

function ViewRow({ view, onNavigate }: { view: ViewSummary; onNavigate: (path: string) => void }) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const path = `/views/${view.id}`;
  const isSelected = location.pathname === path;
  const [draft, setDraft] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [armed, setArmed] = useState(false); // delete asks for a second click

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['views'] });
    queryClient.invalidateQueries({ queryKey: ['view', view.id] });
  };
  const rename = useMutation({
    mutationFn: (name: string) => api.updateView(view.id, { name }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['views'] }),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteView(view.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['views'] });
      if (isSelected) navigate('/');
    },
  });

  const save = () => {
    const name = draft?.trim();
    setDraft(null);
    if (name && name !== view.name) rename.mutate(name);
  };

  const onDrop = async (e: React.DragEvent) => {
    setDropping(false);
    const drag = readDragPanel(e);
    if (!drag) return;
    e.preventDefault();
    try {
      await api.addViewPanel(view.id, {
        machineId: drag.machineId,
        sessionId: drag.sessionId,
        kind: drag.tool ? 'tool' : 'terminal',
        terminalId: drag.terminalId ?? null,
        tool: drag.tool ?? null,
      });
      refresh(); // an open view rebuilds and places the new panel
      toast({ title: `Added to ${view.name}` });
    } catch (err) {
      toast({ title: 'Could not add to the view', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <div
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes(PANEL_DRAG_TYPE)) return;
        e.preventDefault();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={onDrop}
      onMouseLeave={() => setArmed(false)}
      className={cn(
        'group/view flex items-center gap-2 rounded-md px-2 py-1.5 text-xs transition-colors',
        isSelected ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground',
        dropping && 'ring-1 ring-primary/60 bg-primary/10',
      )}
    >
      {draft !== null ? (
        <input
          autoFocus
          value={draft}
          maxLength={100}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save();
            if (e.key === 'Escape') setDraft(null);
          }}
          className="h-5 min-w-0 flex-1 rounded border border-input bg-transparent px-1 text-xs focus:outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={() => onNavigate(`/views/${view.id}`)}
          onDoubleClick={() => setDraft(view.name)}
          title="Open — double-click to rename"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
        >
          <span className="truncate font-medium">{rename.isPending ? rename.variables : view.name}</span>
          <span className="flex min-w-0 items-center gap-1 overflow-hidden">
            {view.sessions.slice(0, 2).map((s) => (
              <SessionChip key={`${s.machineId}:${s.sessionId}`} machineId={s.machineId} sessionId={s.sessionId} />
            ))}
            {view.sessions.length > 2 && <span className="text-[9.5px] text-muted-foreground">+{view.sessions.length - 2}</span>}
          </span>
        </button>
      )}
      <button
        type="button"
        title={armed ? 'Click again to delete the view (sessions stay)' : 'Delete view'}
        onClick={() => (armed ? remove.mutate() : setArmed(true))}
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded opacity-0 group-hover/view:opacity-100',
          armed ? 'bg-destructive/15 text-destructive opacity-100' : 'hover:bg-foreground/10',
        )}
      >
        <Trash2 className="size-3" />
      </button>
    </div>
  );
}

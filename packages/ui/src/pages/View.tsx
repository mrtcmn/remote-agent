import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DockviewReact,
  type DockviewApi,
  type DockviewDidDropEvent,
  type DockviewReadyEvent,
  type DockviewTheme,
  type Position,
} from 'dockview-react';
import 'dockview-react/dist/styles/dockview.css';
import { AlertTriangle, ExternalLink, LayoutPanelLeft, Loader2 } from 'lucide-react';
import { api, type TerminalType, type ViewDetail, type ViewPanel, type ViewTool } from '@/lib/api';
import { useActiveMachine } from '@/lib/active-machine';
import { sessionPath } from '@/lib/session-route';
import { diffPanels, machineKey, PANEL_DRAG_TYPE, readDragPanel, sessionInfo, type DragPanel } from '@/lib/views';
import { AgentLaunchButton } from '@/components/AgentLaunchButton';
import {
  AddMenu,
  SessionChip,
  TerminalPanel,
  TOOLS,
  ToolPanel,
  useAggregate,
  ViewActionsContext,
  ViewTab,
  type PanelParams,
  type ViewActions,
} from '@/components/views/ViewPanels';
import { toast } from '@/components/ui/Toaster';

const theme: DockviewTheme = { name: 'remote-agent', className: 'dockview-theme-dark dockview-theme-ra', gap: 6 };
const components = { terminal: TerminalPanel, tool: ToolPanel };
const POSITION_DIRECTION = { top: 'above', bottom: 'below', left: 'left', right: 'right', center: 'within' } as const;

/** Where the session page asked the second panel to go, when it made this view. */
export interface ViewLocationState {
  split?: 'left' | 'right' | 'above' | 'below';
  /** The panel that stays where the content was; the other one goes to `split`. */
  first?: string;
}

const toParams = (viewId: string, row: ViewPanel): PanelParams => ({
  viewId,
  machineId: machineKey(row.machineId),
  sessionId: row.sessionId,
  terminalId: row.terminalId,
  tool: row.tool,
});

const samePanel = (
  a: { sessionId: string; terminalId?: string | null; tool?: ViewTool | null },
  b: { sessionId: string; terminalId?: string | null; tool?: ViewTool | null },
) => a.sessionId === b.sessionId && (a.tool ? a.tool === b.tool : !b.tool && a.terminalId === b.terminalId);

function Watermark() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-muted-foreground">
      <LayoutPanelLeft className="size-6 opacity-50" />
      <p className="text-sm">Drag a terminal from the sidebar here.</p>
    </div>
  );
}

export function ViewPage() {
  const { id } = useParams<{ id: string }>();
  const { data: view, isError, dataUpdatedAt } = useQuery({
    queryKey: ['view', id],
    queryFn: () => api.getView(id!),
    enabled: !!id,
    staleTime: Infinity, // the dock owns the layout once it is built
  });

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <AlertTriangle className="size-8 text-muted-foreground/50" />
        <h2 className="text-sm font-medium">View not found</h2>
      </div>
    );
  }
  if (!view) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="size-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  // The dock is built once from the saved layout; a refetch (a panel added from
  // the sidebar) builds it again.
  return <ViewDock key={`${view.id}:${dataUpdatedAt}`} view={view} />;
}

function ViewDock({ view }: { view: ViewDetail }) {
  const queryClient = useQueryClient();
  const location = useLocation();
  const aggregate = useAggregate();
  // The name from the list: a rename must not rebuild the dock.
  const name = useQuery({ queryKey: ['views'], queryFn: api.listViews }).data?.views.find((v) => v.id === view.id)?.name ?? view.name;
  const dockRef = useRef<DockviewApi | null>(null);
  const [focused, setFocused] = useState<{ panelId: string; params: PanelParams } | null>(null);
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setToolbarSlot(document.getElementById('app-toolbar')), []);

  // Save the shape after each change; the rows are saved when they change.
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();
  const saveNow = useCallback(() => {
    saveTimer.current = undefined;
    const dock = dockRef.current;
    if (dock) api.updateView(view.id, { layout: dock.toJSON() }).catch(() => {});
  }, [view.id]);
  const scheduleSave = useCallback(() => {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(saveNow, 500);
  }, [saveNow]);
  // Leaving the page must not drop the last change.
  useEffect(() => () => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveNow();
    }
  }, [saveNow]);

  const terminalTitle = useCallback(
    (machineId: string, sessionId: string, terminalId?: string | null) =>
      sessionInfo(aggregate, machineId, sessionId)?.session.services?.find((s) => s.id === terminalId)?.label ?? 'Terminal',
    [aggregate],
  );

  /** Save the row first, then place it: a panel never exists without its link. */
  const place = useCallback(
    async (
      input: { machineId: string; sessionId: string; terminalId?: string; tool?: ViewTool },
      title: string,
      position?: { referencePanel?: string; referenceGroup?: DockviewDidDropEvent['group']; direction: (typeof POSITION_DIRECTION)[Position] },
      terminalType?: TerminalType,
    ) => {
      const dock = dockRef.current;
      if (!dock) return;
      // One terminal, one panel: two xterms on one pty fight over its size.
      const existing = dock.panels.find((panel) => samePanel(panel.params as PanelParams, input));
      if (existing) return existing.api.setActive();
      try {
        const row = await api.addViewPanel(view.id, {
          machineId: input.machineId,
          sessionId: input.sessionId,
          kind: input.tool ? 'tool' : 'terminal',
          terminalId: input.terminalId ?? null,
          tool: input.tool ?? null,
        });
        dock.addPanel({
          id: row.id,
          component: row.kind,
          title,
          params: { ...toParams(view.id, row), terminalType },
          position: position?.referencePanel
            ? { referencePanel: position.referencePanel, direction: position.direction }
            : position?.referenceGroup
              ? { referenceGroup: position.referenceGroup, direction: position.direction }
              : undefined,
        });
        queryClient.invalidateQueries({ queryKey: ['views'] });
      } catch (err) {
        toast({ title: 'Could not add to the view', description: (err as Error).message, variant: 'destructive' });
      }
    },
    [view.id, queryClient],
  );

  const actions = useMemo<ViewActions>(() => ({
    openTerminal: (p, near) =>
      place(p, p.title, near ? { referencePanel: near, direction: 'within' } : undefined, p.terminalType),
    openTool: (p, near) =>
      place(p, TOOLS.find((t) => t.tool === p.tool)?.label ?? p.tool, near ? { referencePanel: near, direction: 'within' } : undefined),
    removePanel: (panelId) => {
      dockRef.current?.getPanel(panelId)?.api.close();
      api.removeViewPanel(view.id, panelId)
        .then(() => queryClient.invalidateQueries({ queryKey: ['views'] }))
        .catch(() => {});
    },
  }), [place, view.id, queryClient]);

  const onReady = (event: DockviewReadyEvent) => {
    const dock = event.api;
    dockRef.current = dock;
    const fresh = !view.layout;
    if (view.layout) {
      try {
        dock.fromJSON(view.layout as Parameters<DockviewApi['fromJSON']>[0]);
      } catch {
        dock.clear(); // a broken layout: rebuild from the rows below
      }
    }

    // Older views can hold one terminal twice: keep the first panel.
    const unique = view.panels.filter((r, i) => {
      const dup = view.panels.findIndex((o) => samePanel(o, r)) !== i;
      if (dup) api.removeViewPanel(view.id, r.id).catch(() => {});
      return !dup;
    });
    const rows = new Map(unique.map((r) => [r.id, r]));
    const { stale, missing } = diffPanels(dock.panels.map((p) => p.id), unique);
    stale.forEach((pid) => dock.getPanel(pid)?.api.close());
    // The rows are the truth for what a panel shows; the layout only for where.
    for (const panel of dock.panels) {
      panel.api.updateParameters({ ...(panel.params as PanelParams), ...toParams(view.id, rows.get(panel.id)!) });
    }
    const { split = 'right', first } = (location.state as ViewLocationState | null) ?? {};
    if (first) missing.sort((a, b) => (a === first ? -1 : b === first ? 1 : 0));
    missing.forEach((pid, i) => {
      const row = rows.get(pid)!;
      const ref = dock.activePanel ?? dock.panels[dock.panels.length - 1];
      dock.addPanel({
        id: row.id,
        component: row.kind,
        title: row.kind === 'tool' ? TOOLS.find((t) => t.tool === row.tool)?.label ?? 'Tool' : terminalTitle(machineKey(row.machineId), row.sessionId, row.terminalId),
        params: toParams(view.id, row),
        // A new view: the second panel goes where it was dropped. Later rows join the active pane.
        position: ref ? { referencePanel: ref.id, direction: fresh && i === 1 ? split : 'within' } : undefined,
      });
    });

    dock.onDidLayoutChange(scheduleSave);
    dock.onDidActivePanelChange(({ panel }) => {
      if (!panel) return setFocused(null);
      const params = panel.params as PanelParams;
      setFocused({ panelId: panel.id, params });
      // Tools read the globally active machine: follow the focused pane.
      if (useActiveMachine.getState().machineId !== params.machineId) {
        const name = sessionInfo(queryClient.getQueryData(['sidebar-aggregate']), params.machineId, params.sessionId)?.machineName;
        useActiveMachine.getState().setActive({ machineId: params.machineId, name: name ?? 'Machine' });
      }
    });
    dock.onUnhandledDragOver((e) => {
      if (e.nativeEvent instanceof DragEvent && e.nativeEvent.dataTransfer?.types.includes(PANEL_DRAG_TYPE)) e.accept();
    });
  };

  const onDidDrop = (event: DockviewDidDropEvent) => {
    if (!(event.nativeEvent instanceof DragEvent)) return;
    const drag: DragPanel | null = readDragPanel(event.nativeEvent);
    if (!drag) return;
    const title = drag.tool
      ? TOOLS.find((t) => t.tool === drag.tool)?.label ?? drag.tool
      : terminalTitle(drag.machineId, drag.sessionId, drag.terminalId);
    place(drag, title, event.group ? { referenceGroup: event.group, direction: POSITION_DIRECTION[event.position] } : undefined);
  };

  const launch = async (type: TerminalType) => {
    if (!focused) return;
    const { machineId, sessionId } = focused.params;
    try {
      const t = await api.createTerminal({ sessionId, type, name: type[0].toUpperCase() + type.slice(1) }, machineId);
      queryClient.invalidateQueries({ queryKey: ['terminals', sessionId] });
      actions.openTerminal({ machineId, sessionId, terminalId: t.id, terminalType: t.type, title: t.name }, focused.panelId);
    } catch (err) {
      toast({ title: 'Could not start a terminal', description: (err as Error).message, variant: 'destructive' });
    }
  };

  return (
    <ViewActionsContext.Provider value={actions}>
      {toolbarSlot && createPortal(
        <div className="flex flex-1 min-w-0 items-stretch px-1 electrobun-webkit-app-region-no-drag">
          <div className="flex items-center gap-1.5 px-2 text-xs font-semibold text-foreground/90">
            <LayoutPanelLeft className="size-3.5 text-muted-foreground" />
            {name}
          </div>
          {focused && (
            <>
              <div className="mx-0.5 w-px self-stretch shrink-0 bg-border/70" />
              <div className="flex items-center gap-1.5 px-2">
                <SessionChip machineId={focused.params.machineId} sessionId={focused.params.sessionId} />
                <Link
                  to={sessionPath(focused.params.machineId, focused.params.sessionId)}
                  className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Open session <ExternalLink className="size-3" />
                </Link>
              </div>
              <div className="mx-0.5 w-px self-stretch shrink-0 bg-border/70" />
              <AgentLaunchButton onLaunch={launch} />
            </>
          )}
        </div>,
        toolbarSlot,
      )}
      <DockviewReact
        className="h-full"
        theme={theme}
        components={components}
        defaultTabComponent={ViewTab}
        leftHeaderActionsComponent={AddMenu}
        watermarkComponent={Watermark}
        defaultRenderer="always"
        disableFloatingGroups
        onReady={onReady}
        onDidDrop={onDidDrop}
      />
    </ViewActionsContext.Provider>
  );
}

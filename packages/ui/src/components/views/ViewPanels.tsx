import { createContext, useContext, useEffect, useReducer } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import type { IDockviewHeaderActionsProps, IDockviewPanelHeaderProps, IDockviewPanelProps } from 'dockview-react';
import {
  AlertTriangle,
  Container,
  FolderOpen,
  GitBranch,
  KeyRound,
  Loader2,
  Play,
  Plus,
  TerminalSquare,
  Unplug,
  Workflow,
} from 'lucide-react';
import { api, ApiError, type TerminalType, type ViewTool } from '@/lib/api';
import { useActiveMachine } from '@/lib/active-machine';
import { sessionPath } from '@/lib/session-route';
import { sessionHue, sessionInfo } from '@/lib/views';
import { TerminalAIIcon } from '@/components/AIModelIcon';
import { TabItem, type TabData } from '@/components/SessionTab';
import { Terminal } from '@/components/Terminal';
import { Button } from '@/components/ui/Button';
import { GitPanel } from '@/components/git';
import { FileExplorer } from '@/components/FileExplorer';
import { RunConfigPanel } from '@/components/RunConfigPanel';
import { RunFlowView } from '@/components/run-flow/RunFlowView';
import { DockerPanel } from '@/components/DockerPanel';
import { EnvEditor } from '@/components/EnvEditor';
import { toast } from '@/components/ui/Toaster';
import { cn } from '@/lib/utils';

/** What a dockview panel carries. Row fields come from view_panels; terminalType is display only. */
export interface PanelParams {
  viewId: string;
  machineId: string; // 'self' for this machine
  sessionId: string;
  terminalId?: string | null;
  tool?: ViewTool | null;
  terminalType?: TerminalType;
}

/** View-level actions the panels need: open a terminal next to a panel, remove a panel. */
export interface ViewActions {
  openTerminal: (p: { machineId: string; sessionId: string; terminalId: string; terminalType?: TerminalType; title: string }, nearPanelId?: string) => void;
  openTool: (p: { machineId: string; sessionId: string; tool: ViewTool }, nearPanelId?: string) => void;
  removePanel: (panelId: string) => void;
}

export const ViewActionsContext = createContext<ViewActions | null>(null);
const useViewActions = () => useContext(ViewActionsContext)!;

export const TOOLS: { tool: ViewTool; label: string; icon: typeof FolderOpen }[] = [
  { tool: 'files', label: 'Files', icon: FolderOpen },
  { tool: 'git', label: 'Git', icon: GitBranch },
  { tool: 'run', label: 'Run', icon: Play },
  { tool: 'flow', label: 'Flow', icon: Workflow },
  { tool: 'docker', label: 'Docker', icon: Container },
  { tool: 'env', label: 'Env', icon: KeyRound },
];

const AGENTS: { type: TerminalType; label: string }[] = [
  { type: 'claude', label: 'Claude' },
  { type: 'opencode', label: 'Opencode' },
  { type: 'kimi', label: 'Kimi' },
  { type: 'shell', label: 'Shell' },
];

/** The sidebar aggregate, read from the cache the sidebar keeps fresh. */
export function useAggregate() {
  return useQuery({ queryKey: ['sidebar-aggregate'], queryFn: api.getAggregatedSidebar, refetchInterval: 5000 }).data;
}

function Placeholder({ icon: Icon, title, children }: { icon: typeof AlertTriangle; title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <Icon className="size-6 text-muted-foreground/50" />
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}

// ─── Terminal panel ─────────────────────────────────────────────────────────

export function TerminalPanel({ params, api: panel }: IDockviewPanelProps<PanelParams>) {
  const { viewId, machineId, sessionId, terminalId } = params;
  const queryClient = useQueryClient();
  const actions = useViewActions();
  const terminals = useQuery({
    queryKey: ['terminals', sessionId],
    queryFn: () => api.getSessionTerminals(sessionId, machineId),
    refetchInterval: 15000,
    retry: 1,
  });
  const terminal = terminals.data?.find((t) => t.id === terminalId);

  useEffect(() => {
    if (terminal) panel.setTitle(terminal.name);
  }, [terminal?.name]); // eslint-disable-line react-hooks/exhaustive-deps

  // Same panel, same place, a fresh terminal — the row keeps its id.
  const startNew = useMutation({
    mutationFn: async () => {
      const t = await api.createTerminal({ sessionId, type: 'claude', name: 'Claude' }, machineId);
      await api.setViewPanelTerminal(viewId, panel.id, t.id);
      return t;
    },
    onSuccess: (t) => {
      panel.updateParameters({ ...params, terminalId: t.id, terminalType: t.type });
      panel.setTitle(t.name);
      queryClient.invalidateQueries({ queryKey: ['terminals', sessionId] });
    },
    onError: (err) => toast({ title: 'Could not start a terminal', description: (err as Error).message, variant: 'destructive' }),
  });

  // An exited terminal is ended, as on the session page: a blank xterm says nothing.
  if (terminal && terminal.status !== 'exited') {
    return (
      <div className="terminal-surface h-full min-h-0 px-2 pt-1.5" style={{ background: 'var(--code-bg, hsl(var(--island)))' }}>
        <Terminal terminalId={terminal.id} machineId={machineId} className="h-full" />
      </div>
    );
  }
  if (terminals.isLoading) return <Placeholder icon={Loader2} title="Connecting…" />;

  const remove = (
    <Button size="sm" variant="ghost" onClick={() => actions.removePanel(panel.id)}>
      Remove
    </Button>
  );
  if (terminals.isError) {
    const gone = terminals.error instanceof ApiError && terminals.error.status === 404;
    return gone
      ? <Placeholder icon={AlertTriangle} title="Session gone">{remove}</Placeholder>
      : <Placeholder icon={Unplug} title="Offline — reconnects when the machine is back" />;
  }
  return (
    <Placeholder icon={TerminalSquare} title="Terminal ended">
      <Button size="sm" onClick={() => startNew.mutate()} disabled={startNew.isPending}>
        {startNew.isPending && <Loader2 className="size-3.5 mr-1.5 animate-spin" />}
        Start new Claude
      </Button>
      {remove}
    </Placeholder>
  );
}

// ─── Tool panel ─────────────────────────────────────────────────────────────

export function ToolPanel({ params, api: panel }: IDockviewPanelProps<PanelParams>) {
  const { machineId, sessionId, tool } = params;
  const actions = useViewActions();
  const aggregate = useAggregate();
  // Tools read the globally active machine, so one from another machine waits for focus.
  const activeMachine = useActiveMachine((s) => s.machineId);
  const session = useQuery({
    queryKey: ['session', machineId, sessionId],
    queryFn: () => api.getSession(sessionId, machineId),
    enabled: activeMachine === machineId,
  });

  if (activeMachine !== machineId) {
    const name = sessionInfo(aggregate, machineId, sessionId)?.machineName ?? 'another machine';
    return (
      <button type="button" className="h-full w-full" onClick={() => panel.setActive()}>
        <Placeholder icon={Unplug} title={`On ${name} — click to load`} />
      </button>
    );
  }
  if (session.isError) {
    return <Placeholder icon={AlertTriangle} title="Session gone"><Button size="sm" variant="ghost" onClick={() => actions.removePanel(panel.id)}>Remove</Button></Placeholder>;
  }
  if (!session.data) return <Placeholder icon={Loader2} title="Loading…" />;

  const project = session.data.project;
  const open = (terminalId: string) =>
    actions.openTerminal({ machineId, sessionId, terminalId, title: 'Terminal' }, panel.id);
  const needsProject = tool === 'run' || tool === 'flow' || tool === 'env';
  if (project?.isMultiProject || (needsProject && !project)) {
    return (
      <Placeholder icon={FolderOpen} title={project ? 'Pick a project on the session page' : 'This session has no project'}>
        <Button size="sm" variant="ghost" asChild>
          <Link to={sessionPath(machineId, sessionId)}>Open session</Link>
        </Button>
      </Placeholder>
    );
  }

  switch (tool) {
    case 'files':
      return <FileExplorer sessionId={sessionId} project={project} className="h-full" />;
    case 'git':
      return <GitPanel sessionId={sessionId} project={project} projectId={project?.id} />;
    case 'run':
      return <RunConfigPanel projectId={project!.id} sessionId={sessionId} onTerminalCreated={open} />;
    case 'flow':
      return <RunFlowView projectId={project!.id} sessionId={sessionId} isMultiProject={false} onOpenTerminal={open} />;
    case 'docker':
      return <DockerPanel sessionId={sessionId} projectId={project?.id} onTerminalCreated={open} />;
    case 'env':
      return <div className="h-full overflow-y-auto p-4"><EnvEditor projectId={project!.id} /></div>;
    default:
      return null;
  }
}

// ─── Tab ────────────────────────────────────────────────────────────────────

export function ViewTab({ api: panel, params }: IDockviewPanelHeaderProps<PanelParams>) {
  const actions = useViewActions();
  const aggregate = useAggregate();
  const info = sessionInfo(aggregate, params.machineId, params.sessionId);
  // Same query as TerminalPanel, so this reads its cache: the type survives a reload.
  const terminals = useQuery({
    queryKey: ['terminals', params.sessionId],
    queryFn: () => api.getSessionTerminals(params.sessionId, params.machineId),
    enabled: !params.tool,
    refetchInterval: 15000,
  });
  const terminal = terminals.data?.find((t) => t.id === params.terminalId);
  // dockview does not re-render a tab on these changes.
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    const subs = [panel.onDidVisibilityChange(rerender), panel.onDidActiveGroupChange(rerender), panel.onDidTitleChange(rerender)];
    return () => subs.forEach((d) => d.dispose());
  }, [panel]);

  const tab: TabData = params.tool
    ? { id: panel.id, label: panel.title ?? '', type: 'tool' }
    : { id: panel.id, label: terminal?.name ?? panel.title ?? 'Terminal', type: terminal?.type ?? params.terminalType ?? 'shell' };
  const ToolIcon = TOOLS.find((t) => t.tool === params.tool)?.icon;

  return (
    // The shown tab of each pane has the active pill; panes without focus are dimmed.
    <div className={cn('flex h-full items-center', panel.isVisible && !panel.isGroupActive && 'opacity-60')}>
      <TabItem
        tab={tab}
        isActive={panel.isVisible}
        onActivate={() => panel.setActive()}
        onClose={() => actions.removePanel(panel.id)}
        icon={ToolIcon && <ToolIcon className="size-3 shrink-0 text-muted-foreground" />}
        chip={info && <span title={`${info.projectName} · ${info.machineName}`}><SessionChip machineId={params.machineId} sessionId={params.sessionId} /></span>}
      />
    </div>
  );
}

// ─── "+" of each pane: new agent for the pane's session, or a tool ─────────

export function AddMenu({ activePanel }: IDockviewHeaderActionsProps) {
  const actions = useViewActions();
  const queryClient = useQueryClient();
  const params = activePanel?.params as PanelParams | undefined;
  if (!params) return null;
  const { machineId, sessionId } = params;

  const newTerminal = async (type: TerminalType, label: string) => {
    try {
      const t = await api.createTerminal({ sessionId, type, name: label }, machineId);
      queryClient.invalidateQueries({ queryKey: ['terminals', sessionId] });
      actions.openTerminal({ machineId, sessionId, terminalId: t.id, terminalType: t.type, title: t.name }, activePanel!.id);
    } catch (err) {
      toast({ title: 'Could not start a terminal', description: (err as Error).message, variant: 'destructive' });
    }
  };

  const item = 'flex items-center gap-2 px-3 py-1.5 text-xs outline-none cursor-pointer data-[highlighted]:bg-secondary/60';
  return (
    // Right after the tabs, like the "+" of the session page.
    <div className="flex h-full items-center pl-1">
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          title="Add to this pane"
          className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground data-[state=open]:bg-secondary/80 data-[state=open]:text-foreground"
        >
          <Plus className="size-4" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={4} className="z-[100] min-w-[180px] rounded-md border border-border bg-card py-1 shadow-xl">
            {AGENTS.map((a) => (
              <DropdownMenu.Item key={a.type} className={item} onSelect={() => newTerminal(a.type, a.label)}>
                {a.type === 'shell' ? <TerminalSquare className="size-3.5" /> : <TerminalAIIcon terminalType={a.type} terminalName={a.label} size={14} />}
                New {a.label}
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            {TOOLS.map((t) => (
              <DropdownMenu.Item key={t.tool} className={item} onSelect={() => actions.openTool({ machineId, sessionId, tool: t.tool }, activePanel!.id)}>
                <t.icon className="size-3.5" />
                {t.label}
              </DropdownMenu.Item>
            ))}
            <DropdownMenu.Separator className="my-1 h-px bg-border" />
            <DropdownMenu.Item asChild className={item}>
              <Link to={sessionPath(machineId, sessionId)}>Open session</Link>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

/** The chip a tab shows, also used by the sidebar view list. */
export function SessionChip({ machineId, sessionId, className }: { machineId: string | null; sessionId: string; className?: string }) {
  const info = sessionInfo(useAggregate(), machineId, sessionId);
  const hue = sessionHue(sessionId);
  return (
    <span
      className={cn('shrink-0 rounded px-1 py-px text-[9.5px] font-semibold leading-none', className)}
      style={{ background: `hsl(${hue} 70% 55% / 0.15)`, color: `hsl(${hue} 70% 68%)` }}
    >
      {info?.projectName ?? '…'}
    </span>
  );
}

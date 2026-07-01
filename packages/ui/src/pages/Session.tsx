import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionPath } from '@/lib/session-route';
import { useActiveMachine, getActiveMachineId } from '@/lib/active-machine';
import type { AggregatedSidebar } from '@/lib/api';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  TerminalSquare,
  Terminal as TerminalIcon,
  Plus,
  Minus,
  GitBranch,
  X,
  RefreshCw,
  ChevronDown,
  FolderOpen,
  Play,
  Monitor,
  Code2,
  ExternalLink,
  ChevronsRight,
  KeyRound,
  Container,
  AlertTriangle,
  Palette,
  Type,
  Presentation,
  Workflow,
} from 'lucide-react';
import { api, type TerminalType } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Terminal } from '@/components/Terminal';
import { AIModelIcon, detectAIModel } from '@/components/AIModelIcon';
import { GitPanel } from '@/components/git';
import { FileExplorer } from '@/components/FileExplorer';
import { RunConfigPanel } from '@/components/RunConfigPanel';
import { RunFlowView } from '@/components/run-flow/RunFlowView';
import { BrowserPreview } from '@/components/BrowserPreview';
import { DockerPanel } from '@/components/DockerPanel';
import { EnvEditor } from '@/components/EnvEditor';
import {
  ToolbarRoot,
  ToolbarGroup,
  ToolbarDivider,
  ToolbarItem,
  ToolbarStatus,
} from '@/components/ui/Toolbar';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toaster';
import { useTerminalTheme } from '@/hooks/useTerminalTheme';
import { ThemeSelector } from '@/components/ThemeSelector';
import { ProjectSelector } from '@/components/ProjectSelector';
import { ReviewDrawer } from '@/components/review/ReviewDrawer';
import { OpenInEditorButton } from '@/components/OpenInEditorButton';

type ViewMode = 'terminal' | 'git' | 'files' | 'run' | 'flow' | 'preview' | 'docker' | 'env';

// ─── Tools Menu Primitives ──────────────────────────────────────────────────

function Divider() {
  return <div className="w-px self-stretch shrink-0 bg-border/70 mx-0.5" />;
}

function ToolBadge({ count }: { count: number }) {
  return (
    <span className="flex items-center justify-center min-w-[14px] h-3.5 rounded-full bg-orange-500 text-white text-[8px] font-bold leading-none px-1 shrink-0 tabular-nums">
      {count}
    </span>
  );
}

function PulseDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex size-1.5 shrink-0">
      {active && (
        <span className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-60" />
      )}
      <span
        className="relative rounded-full h-full w-full"
        style={{ backgroundColor: active ? '#10b981' : 'rgba(128,128,128,0.3)' }}
      />
    </span>
  );
}

interface ToolBtnProps {
  icon?: React.ElementType;
  customIcon?: React.ReactNode;
  label?: string;
  badge?: number;
  pill?: string;
  isActive?: boolean;
  isRunning?: boolean;
  external?: boolean;
  accentColor?: string;
  iconColor?: string;
  activeGlow?: boolean;
  onClick?: () => void;
  disabled?: boolean;
  className?: string;
}

function ToolBtn({
  icon: Icon,
  customIcon,
  label,
  badge,
  pill,
  isActive,
  isRunning,
  external,
  accentColor,
  iconColor,
  activeGlow,
  onClick,
  disabled,
  className,
}: ToolBtnProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'group relative flex items-center gap-1.5 px-2 my-[2px] self-stretch text-xs font-medium rounded-md transition-colors duration-100 shrink-0 select-none cursor-pointer active:scale-95',
        isActive
          ? 'bg-secondary/80 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {isActive && accentColor && (
        <span
          className="absolute -top-px left-1/2 -translate-x-1/2 h-px w-4/5 rounded-full pointer-events-none"
          style={{ backgroundColor: accentColor }}
        />
      )}

      {isRunning !== undefined && <PulseDot active={isRunning} />}

      {customIcon && customIcon}
      {!customIcon && Icon && (
        <Icon
          className="size-3.5 shrink-0 transition-colors"
          style={iconColor && isActive ? { color: iconColor } : undefined}
        />
      )}

      {label && <span className="leading-none tracking-tight hidden sm:inline">{label}</span>}
      {badge !== undefined && badge > 0 && <ToolBadge count={badge} />}
      {pill && (
        <span className="px-1.5 h-4 flex items-center rounded text-[10px] font-mono bg-muted/80 text-muted-foreground shrink-0 border border-border/60 leading-none hidden sm:flex">
          {pill}
        </span>
      )}

      {external && (
        <ExternalLink className="size-2.5 opacity-20 group-hover:opacity-50 transition-opacity" />
      )}
    </button>
  );
}

// ─── Tab Bar ─────────────────────────────────────────────────────────────────

interface TabData {
  id: string;
  label: string;
  type: string;
  pinned?: boolean;
  color?: string;
}

function StatusDot({ color = '#22c55e' }: { color?: string }) {
  return (
    <span
      className="size-3 rounded-full shrink-0"
      style={{
        background: `radial-gradient(circle at 35% 30%, ${color}, ${color}88)`,
        boxShadow: `0 0 5px ${color}66`,
      }}
    />
  );
}

function getTabAccent(tab: TabData): string {
  if (tab.type === 'process') return tab.color ?? '#22c55e';
  if (tab.type === 'opencode') return '#38bdf8';
  if (tab.type === 'project') return '#60a5fa';
  if (tab.type === 'shell') return '#94a3b8';
  if (tab.type === 'claude') {
    const model = detectAIModel(tab.label);
    if (model === 'gemini') return '#4285F4';
    if (model === 'openai' || model === 'codex') return '#10a37f';
    return '#D97757';
  }
  return '#94a3b8';
}

function TabItem({
  tab,
  isActive,
  onActivate,
  onClose,
  compact,
}: {
  tab: TabData;
  isActive: boolean;
  onActivate: () => void;
  onClose?: () => void;
  compact?: boolean;
}) {
  const accent = getTabAccent(tab);

  const typeIcon = tab.type === 'claude' ? (
    <AIModelIcon model={detectAIModel(tab.label)} size={13} />
  ) : tab.type === 'opencode' ? (
    <AIModelIcon model="opencode" size={13} />
  ) : tab.type === 'process' ? (
    <StatusDot color={tab.color ?? '#22c55e'} />
  ) : tab.type === 'project' ? (
    <FolderOpen className="size-3 text-muted-foreground shrink-0" />
  ) : (
    <TerminalSquare className="size-3 text-muted-foreground shrink-0" />
  );

  const activeBg = `linear-gradient(135deg, ${accent}00 0%, ${accent}0a 100%), hsl(var(--secondary))`;
  const activeBorderColor = `color-mix(in srgb, ${accent} 25%, hsl(var(--border)))`;

  return (
    <div
      onClick={onActivate}
      className={cn(
        'group relative flex items-center rounded-full select-none overflow-hidden',
        'border transition-all duration-150',
        compact ? 'gap-1 h-[26px] px-2' : 'gap-1.5 h-[28px] px-3',
        isActive
          ? 'text-foreground'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border/40 hover:bg-secondary/40'
      )}
      style={{
        maxWidth: compact ? 150 : 200,
        background: isActive ? activeBg : undefined,
        borderColor: isActive ? activeBorderColor : undefined,
      }}
    >
      {typeIcon}

      {isActive ? (
        <span
          className="text-[11px] font-medium truncate flex-1 min-w-0 leading-none select-none"
          style={{
            background: `linear-gradient(to right, color-mix(in srgb, ${accent} 70%, hsl(var(--foreground))), hsl(var(--foreground)))`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {tab.label}
        </span>
      ) : (
        <span className="text-[11px] font-medium truncate flex-1 min-w-0 leading-none">
          {tab.label}
        </span>
      )}

      {!tab.pinned && onClose && (
        <button
          className="flex items-center justify-center size-3 rounded-full bg-foreground/10 hover:bg-foreground/20 text-foreground/60 hover:text-foreground shrink-0 opacity-0 group-hover:opacity-100 transition-opacity duration-100 ml-0.5"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
          <X className="size-2" />
        </button>
      )}
    </div>
  );
}

// ─── Status Bar Metric ──────────────────────────────────────────────────────

function useSystemMetrics() {
  const { data } = useQuery({
    queryKey: ['system-stats'],
    queryFn: () => api.getSystemStats(),
    refetchInterval: 30000,
  });

  const toGB = (bytes: number) => bytes / 1024 ** 3;

  return {
    cpu: data?.cpu ?? 0,
    memUsed: data ? toGB(data.memUsed) : 0,
    memTotal: data ? Math.round(toGB(data.memTotal)) : 0,
    diskPct: data ? Math.round((data.diskUsed / data.diskTotal) * 100) : 0,
  };
}

function loadColor(pct: number): string {
  if (pct < 55) return '#34d399';
  if (pct < 80) return '#fbbf24';
  return '#f87171';
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function SessionPage() {
  const { id, machineId, terminalId: terminalIdFromRoute } = useParams<{ id: string; machineId?: string; terminalId?: string }>();
  const ownerMachine = machineId ?? 'self';
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // The owning machine is part of this session's identity (it's in the URL).
  // Project it into the global active-machine store BEFORE any child effect or
  // query fires — useLayoutEffect runs ahead of passive effects and React Query
  // fetches — so every per-session call (terminals, git, files, and the
  // terminal/preview WebSockets, all of which read the active machine) routes to
  // the machine that owns this session. This is what makes remote sessions open
  // on click, reload, back, and deep links instead of 404ing against the local API.
  useLayoutEffect(() => {
    if (getActiveMachineId() === ownerMachine) return;
    const aggregate = queryClient.getQueryData<AggregatedSidebar>(['sidebar-aggregate']);
    const name = aggregate?.machines.find((m) => m.machineId === ownerMachine)?.machineName
      ?? (ownerMachine === 'self' ? 'This machine' : 'Machine');
    useActiveMachine.getState().setActive({ machineId: ownerMachine, name });
  }, [ownerMachine, queryClient]);

  const terminalIdFromUrl = terminalIdFromRoute || searchParams.get('terminalId');
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(terminalIdFromUrl);
  const [viewMode, setViewMode] = useState<ViewMode>('terminal');

  // Sync activeTerminalId when URL changes (e.g. clicking a service in the sidebar)
  useEffect(() => {
    if (terminalIdFromUrl) {
      setActiveTerminalId(terminalIdFromUrl);
      setViewMode('terminal');
    }
  }, [terminalIdFromUrl]);
  const [showTerminalDropdown, setShowTerminalDropdown] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('http://localhost:3000');
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showReviewDrawer, setShowReviewDrawer] = useState(false);

  // Reset child project selection when navigating to a different session
  useEffect(() => {
    setSelectedProjectId(null);
  }, [id]);

  const themeBtnRef = useRef<HTMLButtonElement>(null);
  const { activeTheme, activeFont, activeFontSize, setFontSize } = useTerminalTheme();
  const { cpu, memUsed, memTotal, diskPct } = useSystemMetrics();

  const { data: session, isError: sessionFailed, error: sessionError } = useQuery({
    queryKey: ['session', ownerMachine, id],
    queryFn: () => api.getSession(id!, ownerMachine),
    enabled: !!id,
  });

  // Resolve the active project: child project if multi-project session with selection, else the session's project
  const activeProject = useMemo(() => {
    if (!session?.project) return null;
    if (session.project.isMultiProject) {
      if (!selectedProjectId) return null;
      return session.project.childLinks
        ?.find(l => l.childProjectId === selectedProjectId)
        ?.childProject ?? null;
    }
    return session.project;
  }, [session, selectedProjectId]);

  // Also reset selection if project type changes (e.g., multi-project status edited while session is open)
  useEffect(() => {
    if (!session?.project?.isMultiProject) {
      setSelectedProjectId(null);
    }
  }, [session?.project?.isMultiProject]);

  // The project ID to pass to git operations (only for child project context)
  const gitProjectId = session?.project?.isMultiProject ? activeProject?.id : undefined;

  // The alias for the selected child project (used to badge terminal names)
  const selectedAlias = useMemo(() => {
    if (!selectedProjectId || !session?.project?.childLinks) return null;
    return session.project.childLinks.find(l => l.childProjectId === selectedProjectId)?.alias ?? null;
  }, [selectedProjectId, session]);

  const { data: terminals = [], isLoading } = useQuery({
    queryKey: ['terminals', id],
    queryFn: () => api.getSessionTerminals(id!),
    refetchInterval: 15000,
    enabled: !!id,
  });

  // Disabled when no activeProject: for multi-project sessions, aggregate git status across all
  // child projects is not supported — status only shows for the selected child project.
  const { data: gitStatus } = useQuery({
    queryKey: ['session-git-status', id, gitProjectId],
    queryFn: () => api.getSessionGitStatus(id!, gitProjectId),
    refetchInterval: 10000,
    enabled: !!id && !!activeProject,
  });

  const createMutation = useMutation({
    mutationFn: (opts: { type?: TerminalType; name?: string; initialPrompt?: string } = {}) => {
      const prefix = selectedAlias ? `[${selectedAlias}] ` : '';
      const baseName = opts.name ?? (opts.type === 'claude' ? 'Claude' : opts.type === 'opencode' ? 'Opencode' : 'Shell');
      return api.createTerminal({
        sessionId: id!,
        type: opts.type || 'shell',
        name: `${prefix}${baseName}`,
        initialPrompt: opts.initialPrompt,
        // Only pass cwd for multi-project child selection; otherwise let the backend
        // resolve it (worktree path > project path > workspace).
        cwd: session?.project?.isMultiProject ? activeProject?.localPath : undefined,
      });
    },
    onSuccess: (terminal) => {
      queryClient.invalidateQueries({ queryKey: ['terminals', id] });
      setActiveTerminalId(terminal.id);
      setViewMode('terminal');
      navigate(sessionPath(ownerMachine, id!, terminal.id), { replace: true });
    },
  });

  const closeMutation = useMutation({
    mutationFn: (terminalId: string) => api.closeTerminal(terminalId),
    onSuccess: (_, closedId) => {
      queryClient.invalidateQueries({ queryKey: ['terminals', id] });
      if (activeTerminalId === closedId) {
        const remaining = terminals.filter((t) => t.id !== closedId);
        setActiveTerminalId(remaining[0]?.id || null);
      }
    },
  });

  const startPreviewMutation = useMutation({
    mutationFn: (url: string) => api.startPreview(url, id!),
    onSuccess: (data) => {
      setPreviewId(data.previewId);
      setViewMode('preview');
      setShowPreviewDialog(false);
    },
    onError: (error) => {
      toast({ title: 'Failed to start preview', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const { data: editorStatus } = useQuery({
    queryKey: ['editor-status'],
    queryFn: () => api.editorStatus(),
    staleTime: 60000,
  });

  const { data: versionInfo } = useQuery({
    queryKey: ['version'],
    queryFn: () => api.getVersion(),
    staleTime: 60_000,
  });
  const isLocalMode = versionInfo?.mode === 'local';

  const openEditorMutation = useMutation({
    mutationFn: (folder: string) => api.openEditor(folder),
    onSuccess: (data) => { window.open(data.url, '_blank'); },
    onError: (error) => {
      toast({ title: 'Failed to open editor', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const canOpenEditor = !!editorStatus?.configured && !!activeProject?.localPath;
  const canOpenLocalEditor = isLocalMode && !!activeProject?.localPath;
  const activeTerminals = useMemo(
    () => terminals.filter((t) => (t.liveStatus || t.status) === 'running'),
    [terminals]
  );

  const selectTerminal = (terminalId: string) => {
    setActiveTerminalId(terminalId);
    setViewMode('terminal');
    navigate(sessionPath(ownerMachine, id!, terminalId), { replace: true });
  };

  // Auto-select first terminal when none is active
  useEffect(() => {
    if (!activeTerminalId && activeTerminals.length > 0 && !isLoading) {
      setActiveTerminalId(activeTerminals[0].id);
    }
  }, [activeTerminalId, activeTerminals, isLoading]);

  // Redirect legacy ?terminalId= query param to path-based URL
  useEffect(() => {
    const tid = searchParams.get('terminalId');
    if (tid && terminals.length > 0 && !isLoading) {
      navigate(sessionPath(ownerMachine, id!, tid), { replace: true });
    }
  }, [searchParams, terminals, isLoading, id, ownerMachine, navigate]);

  const activeTerminal = terminals.find((t) => t.id === activeTerminalId);

  const changeCount = useMemo(() => {
    if (!gitStatus) return 0;
    return (gitStatus.modified?.length || 0) + (gitStatus.staged?.length || 0) + (gitStatus.untracked?.length || 0);
  }, [gitStatus]);

  // Build tab data from terminals
  const tabData: TabData[] = useMemo(() => {
    // Add a pinned "home" tab for the project
    const tabs: TabData[] = [];
    if (session?.project) {
      tabs.push({
        id: '__project__',
        label: session.project.name,
        type: 'project',
        pinned: true,
      });
    }
    activeTerminals.forEach((t) => {
      tabs.push({
        id: t.id,
        label: t.name,
        type: t.type,
        color: t.type === 'claude' ? '#f97316' : t.type === 'opencode' ? '#6366f1' : t.type === 'process' ? '#22c55e' : undefined,
      });
    });
    return tabs;
  }, [activeTerminals, session]);

  // Ordered tabs for DnD — syncs with tabData while preserving user-dragged order
  const [orderedTabs, setOrderedTabs] = useState<TabData[]>(tabData);
  const pointerDragRef = useRef<{ id: string; startX: number; lastX: number } | null>(null);
  useEffect(() => {
    setOrderedTabs(prev => {
      const incoming = new Map(tabData.map(t => [t.id, t]));
      const merged = prev
        .filter(t => incoming.has(t.id))
        .map(t => incoming.get(t.id)!);
      tabData.forEach(t => { if (!merged.find(m => m.id === t.id)) merged.push(t); });
      return merged;
    });
  }, [tabData]);

  const handleTabPointerDown = (e: React.PointerEvent, id: string) => {
    if (e.button !== 0) return;
    pointerDragRef.current = { id, startX: e.clientX, lastX: e.clientX };
  };
  const handleTabPointerMove = (e: React.PointerEvent, overId: string) => {
    const drag = pointerDragRef.current;
    if (!drag || Math.abs(e.clientX - drag.startX) < 6) return;
    if (drag.id === overId) { drag.lastX = e.clientX; return; }
    setOrderedTabs(prev => {
      const from = prev.findIndex(t => t.id === drag.id);
      const to = prev.findIndex(t => t.id === overId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      next.splice(to, 0, next.splice(from, 1)[0]);
      return next;
    });
  };
  const handleTabPointerUp = () => { pointerDragRef.current = null; };

  // Surface a failed session load instead of falling through to a blank shell.
  // The common case is a remote session whose owning machine is unreachable, or
  // a session that was terminated/removed.
  if (sessionFailed) {
    const status = (sessionError as { status?: number } | undefined)?.status;
    const notFound = status === 404;
    const aggregate = queryClient.getQueryData<AggregatedSidebar>(['sidebar-aggregate']);
    const machineName = aggregate?.machines.find((m) => m.machineId === ownerMachine)?.machineName
      ?? (ownerMachine === 'self' ? 'this machine' : ownerMachine);
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <AlertTriangle className="size-8 text-muted-foreground/50" />
        <h2 className="text-sm font-medium">{notFound ? 'Session not found' : 'Couldn’t load session'}</h2>
        <p className="max-w-sm text-xs text-muted-foreground">
          {notFound
            ? `This session isn’t on ${ownerMachine === 'self' ? 'this machine' : machineName} — it may have been removed, or it lives on a different machine.`
            : `Couldn’t reach ${machineName}. ${(sessionError as Error | undefined)?.message ?? ''}`}
        </p>
        <div className="mt-1 flex gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/')}>Back to dashboard</Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['session', ownerMachine, id] })}
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* ── Tools Menu Toolbar ── */}
      <div className="flex items-stretch h-9 border-b border-border bg-card overflow-hidden w-full shrink-0 electrobun-webkit-app-region-drag">
        <div
          className="flex-1 min-w-0 flex items-stretch overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          <div className="flex items-stretch px-1 electrobun-webkit-app-region-no-drag">
            {/* Nav */}
            <ToolBtn icon={ArrowLeft} onClick={() => navigate('/')} className="w-7 justify-center px-0" />
            {session?.project?.isMultiProject && session.project.childLinks && session.project.childLinks.length > 0 ? (
              <div className="flex items-center self-stretch px-1">
                <ProjectSelector
                  links={session.project.childLinks}
                  selectedProjectId={selectedProjectId}
                  onSelect={(id) => {
                    setSelectedProjectId(id);
                    // Auto-switch to terminal if clearing selection while a project-dependent panel is open
                    const projectDependentViews: ViewMode[] = ['git', 'files', 'env'];
                    if (!id && projectDependentViews.includes(viewMode)) {
                      setViewMode('terminal');
                    }
                  }}
                />
              </div>
            ) : (
              <ToolBtn
                label={session?.project?.name || 'Session'}
                className="font-semibold text-foreground/90 px-2"
              />
            )}

            <AnimatePresence initial={false}>
              {!toolsCollapsed && (
                <motion.div
                  key="tool-groups"
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                  className="flex items-stretch overflow-hidden"
                >
                  {/* AI */}
                  <Divider />
                  <div className="flex items-stretch gap-0.5">
                    <ToolBtn
                      customIcon={<AIModelIcon model="claude" size={14} />}
                      label="Claude"
                      onClick={() => createMutation.mutate({ type: 'claude' })}
                      disabled={createMutation.isPending}
                    />
                    <ToolBtn
                      customIcon={<AIModelIcon model="opencode" size={14} />}
                      label="Opencode"
                      onClick={() => createMutation.mutate({ type: 'opencode' })}
                      disabled={createMutation.isPending}
                    />
                  </div>

                  {/* Shell & Git */}
                  <Divider />
                  <div className="flex items-stretch gap-0.5">
                    <ToolBtn
                      icon={TerminalSquare}
                      label="Shell"
                      onClick={() => createMutation.mutate({ type: 'shell' })}
                      disabled={createMutation.isPending}
                    />
                    {session?.project && (
                      <ToolBtn
                        icon={GitBranch}
                        label="Git"
                        badge={changeCount}
                        pill={gitStatus?.branch}
                        isActive={viewMode === 'git'}
                        disabled={!!session?.project?.isMultiProject && !activeProject}
                        onClick={() => setViewMode(viewMode === 'git' ? 'terminal' : 'git')}
                      />
                    )}
                  </div>

                  {/* Run / Files */}
                  {session?.project && (
                    <>
                      <Divider />
                      <div className="flex items-stretch gap-0.5">
                        <ToolBtn
                          icon={Play}
                          label="Run"
                          isActive={viewMode === 'run'}
                          disabled={!!session?.project?.isMultiProject && !activeProject}
                          onClick={() => setViewMode(viewMode === 'run' ? 'terminal' : 'run')}
                        />
                        <ToolBtn
                          icon={Workflow}
                          label="Flow"
                          isActive={viewMode === 'flow'}
                          onClick={() => setViewMode(viewMode === 'flow' ? 'terminal' : 'flow')}
                        />
                        <ToolBtn
                          icon={FolderOpen}
                          label="Files"
                          isActive={viewMode === 'files'}
                          disabled={!!session?.project?.isMultiProject && !activeProject}
                          onClick={() => setViewMode(viewMode === 'files' ? 'terminal' : 'files')}
                        />
                      </div>
                    </>
                  )}

                  {/* Infra */}
                  <Divider />
                  <div className="flex items-stretch gap-0.5">
                    {session?.project && (
                      <ToolBtn
                        icon={KeyRound}
                        label="Env"
                        isActive={viewMode === 'env'}
                        disabled={!!session?.project?.isMultiProject && !activeProject}
                        onClick={() => setViewMode(viewMode === 'env' ? 'terminal' : 'env')}
                      />
                    )}
                    <ToolBtn
                      icon={Container}
                      label="Docker"
                      isActive={viewMode === 'docker'}
                      disabled={!!session?.project?.isMultiProject && !activeProject}
                      onClick={() => setViewMode(viewMode === 'docker' ? 'terminal' : 'docker')}
                    />
                    <ToolBtn
                      icon={Monitor}
                      label="Preview"
                      isActive={viewMode === 'preview'}
                      disabled={!!session?.project?.isMultiProject && !activeProject}
                      onClick={() => {
                        if (viewMode === 'preview') setViewMode('terminal');
                        else if (previewId) setViewMode('preview');
                        else setShowPreviewDialog(true);
                      }}
                    />
                  </div>

                  {/* Editor */}
                  {canOpenLocalEditor ? (
                    <>
                      <Divider />
                      <div className="flex items-stretch gap-0.5">
                        <OpenInEditorButton folder={activeProject!.localPath} />
                      </div>
                    </>
                  ) : canOpenEditor ? (
                    <>
                      <Divider />
                      <div className="flex items-stretch gap-0.5">
                        <ToolBtn
                          icon={Code2}
                          label="VS Code"
                          external
                          iconColor="#007ACC"
                          onClick={() => openEditorMutation.mutate(activeProject!.localPath)}
                          disabled={openEditorMutation.isPending}
                        />
                      </div>
                    </>
                  ) : null}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Collapse toggle */}
        <div className="shrink-0 flex items-stretch border-l border-border/60 electrobun-webkit-app-region-no-drag">
          <button
            onClick={() => setToolsCollapsed((v) => !v)}
            className="flex items-center justify-center w-8 h-full text-muted-foreground/40 hover:text-muted-foreground hover:bg-secondary/60 transition-colors"
          >
            <motion.span
              animate={{ rotate: toolsCollapsed ? 180 : 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              className="flex items-center"
            >
              <ChevronsRight className="size-3.5" />
            </motion.span>
          </button>
        </div>
      </div>

      {/* ── Tab Bar ── */}
      <div className="hidden md:flex items-center h-10 border-b border-border bg-card w-full shrink-0 electrobun-webkit-app-region-drag px-1 gap-0.5">
        <div
          className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden"
          style={{ scrollbarWidth: 'none' }}
        >
          <div className="flex items-center h-10 gap-0.5 electrobun-webkit-app-region-no-drag">
            {orderedTabs.map((tab) => (
              <div
                key={tab.id}
                className="flex items-center px-0.5 h-full shrink-0"
                onPointerDown={(e) => handleTabPointerDown(e, tab.id)}
                onPointerMove={(e) => handleTabPointerMove(e, tab.id)}
                onPointerUp={handleTabPointerUp}
              >
                <TabItem
                  tab={tab}
                  compact={orderedTabs.length > 5}
                  isActive={
                    tab.id === '__project__'
                      ? viewMode !== 'terminal'
                      : tab.id === activeTerminalId && viewMode === 'terminal'
                  }
                  onActivate={() => {
                    if (tab.id === '__project__') {
                      if (!session?.project?.isMultiProject || activeProject) {
                        setViewMode('files');
                      }
                    } else {
                      selectTerminal(tab.id);
                    }
                  }}
                  onClose={tab.pinned ? undefined : () => closeMutation.mutate(tab.id)}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Add tab */}
        <div className="w-px h-4 bg-border/60 mx-0.5 shrink-0" />
        <button
          onClick={() => createMutation.mutate({ type: 'shell' })}
          className="flex items-center justify-center size-6 rounded-full text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary/60 transition-colors shrink-0 electrobun-webkit-app-region-no-drag"
        >
          <Plus className="size-3" />
        </button>
      </div>

      {/* Mobile terminal dropdown */}
      <div className="md:hidden flex flex-col border-b bg-card/20 shrink-0">
        {session?.project?.isMultiProject && session.project.childLinks && session.project.childLinks.length > 0 && (
          <div className="px-3 pt-2">
            <ProjectSelector
              links={session.project.childLinks}
              selectedProjectId={selectedProjectId}
              onSelect={(id) => {
                setSelectedProjectId(id);
                const projectDependentViews: ViewMode[] = ['git', 'files', 'env'];
                if (!id && projectDependentViews.includes(viewMode)) setViewMode('terminal');
              }}
            />
          </div>
        )}
        <div className="flex items-center gap-2 px-3 py-2">
        <div className="relative flex-1">
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-between h-10 font-mono text-xs"
            onClick={() => setShowTerminalDropdown(!showTerminalDropdown)}
          >
            <span className="flex items-center gap-2 truncate">
              {activeTerminal ? (
                <>
                  {activeTerminal.type === 'claude' ? (
                    <AIModelIcon model={detectAIModel(activeTerminal.name)} size={14} />
                  ) : activeTerminal.type === 'opencode' ? (
                    <AIModelIcon model="opencode" size={14} />
                  ) : activeTerminal.type === 'process' ? (
                    <Play className="h-3.5 w-3.5 text-green-500" />
                  ) : (
                    <TerminalSquare className="h-3.5 w-3.5" />
                  )}
                  {activeTerminal.name}
                </>
              ) : (
                'Select terminal'
              )}
            </span>
            <ChevronDown className="h-3.5 w-3.5 ml-2 shrink-0" />
          </Button>

          {showTerminalDropdown && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-card border rounded-md shadow-lg z-20 max-h-48 overflow-y-auto">
              {activeTerminals.map((terminal) => (
                <button
                  key={terminal.id}
                  className={cn(
                    'flex items-center gap-2 w-full px-3 py-3 text-left text-sm hover:bg-accent',
                    activeTerminalId === terminal.id && 'bg-accent'
                  )}
                  onClick={() => {
                    selectTerminal(terminal.id);
                    setShowTerminalDropdown(false);
                  }}
                >
                  {terminal.type === 'claude' ? (
                    <AIModelIcon model={detectAIModel(terminal.name)} size={16} />
                  ) : terminal.type === 'opencode' ? (
                    <AIModelIcon model="opencode" size={16} />
                  ) : terminal.type === 'process' ? (
                    <Play className="h-4 w-4 text-green-500" />
                  ) : (
                    <TerminalSquare className="h-4 w-4" />
                  )}
                  <span className="flex-1 truncate font-mono text-xs">{terminal.name}</span>
                </button>
              ))}
              {activeTerminals.length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-muted-foreground">No terminals</div>
              )}
            </div>
          )}
        </div>
        </div>
      </div>

      {/* ── Content Area ── */}
      <div className="flex-1 min-h-0">
        {viewMode === 'terminal' ? (
          activeTerminal ? (
            <Terminal
              key={activeTerminal.id}
              terminalId={activeTerminal.id}
              className="h-full"
              onExit={() => { queryClient.invalidateQueries({ queryKey: ['terminals', id] }); }}
              onTitleChanged={() => { queryClient.invalidateQueries({ queryKey: ['terminals', id] }); }}
            />
          ) : (
            <EmptyState isLoading={isLoading} onCreateClaude={() => createMutation.mutate({ type: 'claude' })} />
          )
        ) : viewMode === 'git' ? (
          <GitPanel
            sessionId={id!}
            project={activeProject ?? undefined}
            projectId={gitProjectId}
            onProceed={(message) => {
              createMutation.mutate(
                { type: 'claude', name: 'Review', initialPrompt: message },
                {
                  onSuccess: () => { toast({ title: 'Claude terminal started', description: 'Review comments are being processed' }); },
                  onError: () => { toast({ title: 'Failed to create terminal', description: 'Please try again', variant: 'destructive' }); },
                }
              );
            }}
          />
        ) : viewMode === 'run' && activeProject ? (
          <RunConfigPanel
            projectId={activeProject.id}
            sessionId={id!}
            onTerminalCreated={(terminalId) => {
              queryClient.invalidateQueries({ queryKey: ['terminals', id] });
              selectTerminal(terminalId);
            }}
          />
        ) : viewMode === 'flow' && session?.project ? (
          <RunFlowView
            projectId={session.project.id}
            sessionId={id!}
            isMultiProject={!!session.project.isMultiProject}
            onOpenTerminal={(terminalId) => {
              queryClient.invalidateQueries({ queryKey: ['terminals', id] });
              selectTerminal(terminalId);
              setViewMode('terminal');
            }}
          />
        ) : viewMode === 'docker' ? (
          <DockerPanel
            sessionId={id!}
            projectId={activeProject?.id}
            onTerminalCreated={(terminalId) => {
              queryClient.invalidateQueries({ queryKey: ['terminals', id] });
              selectTerminal(terminalId);
            }}
          />
        ) : viewMode === 'env' && activeProject ? (
          <div className="p-4 overflow-y-auto h-full">
            <EnvEditor projectId={activeProject.id} />
          </div>
        ) : viewMode === 'preview' && previewId ? (
          <BrowserPreview
            previewId={previewId}
            onStop={async () => {
              try { await api.stopPreview(previewId); } catch {}
              setPreviewId(null);
              setViewMode('terminal');
            }}
            className="h-full"
          />
        ) : (
          <FileExplorer sessionId={id!} project={session?.project} selectedProjectId={selectedProjectId} className="h-full" />
        )}
      </div>

      {/* ── Status Bar ── */}
      <ToolbarRoot>
        <ToolbarGroup>
          <ToolbarStatus status="green" label="Connected" pulse />
          <ToolbarDivider />
          {gitStatus?.branch && (
            <>
              <ToolbarItem icon={GitBranch} label={gitStatus.branch} />
              <ToolbarDivider />
            </>
          )}
          {changeCount > 0 && (
            <>
              <ToolbarItem
                icon={AlertTriangle}
                label={String(changeCount)}
                className="text-yellow-600/70 hover:text-yellow-600"
              />
              <ToolbarDivider />
            </>
          )}
          <ToolbarItem
            icon={Presentation}
            label="REVIEW"
            onClick={() => setShowReviewDrawer(true)}
          />
          <ToolbarDivider />
        </ToolbarGroup>

        <ToolbarGroup align="right">
          <button className="flex items-center gap-[3px] px-2 h-full text-[10.5px] leading-none tracking-tight cursor-default hover:bg-secondary transition-colors duration-75 text-muted-foreground" style={{ fontFamily: activeFont.family }}>
            <span className="text-muted-foreground/70">cpu</span>
            <span style={{ color: loadColor(cpu), minWidth: '3ch', textAlign: 'right', display: 'inline-block' }} className="tabular-nums">{cpu}%</span>
          </button>
          <ToolbarDivider />
          <button className="flex items-center gap-[3px] px-2 h-full text-[10.5px] leading-none tracking-tight cursor-default hover:bg-secondary transition-colors duration-75 text-muted-foreground" style={{ fontFamily: activeFont.family }}>
            <span className="text-muted-foreground/70">mem</span>
            <span style={{ color: loadColor(memTotal > 0 ? (memUsed / memTotal) * 100 : 0), minWidth: '4ch', textAlign: 'right', display: 'inline-block' }} className="tabular-nums">{memUsed.toFixed(1)}</span>
            <span className="text-muted-foreground/60">/{memTotal}</span>
          </button>
          <ToolbarDivider />
          <button className="flex items-center gap-[3px] px-2 h-full text-[10.5px] leading-none tracking-tight cursor-default hover:bg-secondary transition-colors duration-75 text-muted-foreground" style={{ fontFamily: activeFont.family }}>
            <span className="text-muted-foreground/70">disk</span>
            <span style={{ color: loadColor(diskPct), minWidth: '3ch', textAlign: 'right', display: 'inline-block' }} className="tabular-nums">{diskPct}%</span>
          </button>
          <ToolbarDivider />
          <ToolbarItem icon={TerminalIcon} label="bash" />
          <ToolbarDivider />
          {/* Font size controls */}
          <div className="flex items-stretch">
            <button
              onClick={() => setFontSize(activeFontSize - 1)}
              className="flex items-center justify-center w-6 h-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors duration-75 cursor-pointer"
              title="Decrease font size"
            >
              <Minus className="size-[10px]" />
            </button>
            <span className="flex items-center px-1 h-full text-[10px] font-mono tabular-nums text-muted-foreground select-none">
              <Type className="size-[11px] mr-0.5 opacity-60" />
              {activeFontSize}
            </span>
            <button
              onClick={() => setFontSize(activeFontSize + 1)}
              className="flex items-center justify-center w-6 h-full text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors duration-75 cursor-pointer"
              title="Increase font size"
            >
              <Plus className="size-[10px]" />
            </button>
          </div>
          <ToolbarDivider />
          <div className="relative flex items-stretch">
            <button
              ref={themeBtnRef}
              onClick={() => setShowThemeSelector((v) => !v)}
              className={cn(
                'flex items-center gap-1 px-2 h-full',
                'text-[10.5px] font-mono leading-none tracking-tight',
                'text-muted-foreground hover:text-foreground hover:bg-secondary',
                'transition-colors duration-75 cursor-pointer outline-none',
                showThemeSelector && 'bg-secondary text-foreground'
              )}
            >
              <Palette className="size-[11px] shrink-0" />
              <span>{activeTheme.name}</span>
            </button>
            <ThemeSelector
              open={showThemeSelector}
              onClose={() => setShowThemeSelector(false)}
              anchorRef={themeBtnRef as React.RefObject<HTMLElement>}
            />
          </div>
        </ToolbarGroup>
      </ToolbarRoot>

      <ReviewDrawer
        open={showReviewDrawer}
        onOpenChange={setShowReviewDrawer}
        sessionId={id!}
        projectId={gitProjectId}
      />

      {/* Preview URL Dialog */}
      {showPreviewDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-card border rounded-lg shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-sm font-semibold mb-4">Start Browser Preview</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">URL to preview</label>
                <input
                  type="text"
                  value={previewUrl}
                  onChange={(e) => setPreviewUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && previewUrl.trim()) {
                      startPreviewMutation.mutate(previewUrl.trim());
                    }
                  }}
                  placeholder="http://localhost:3000"
                  className="w-full h-9 px-3 rounded-md border border-input bg-transparent text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
                  autoFocus
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="ghost" size="sm" onClick={() => setShowPreviewDialog(false)}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => { if (previewUrl.trim()) startPreviewMutation.mutate(previewUrl.trim()); }}
                  disabled={startPreviewMutation.isPending || !previewUrl.trim()}
                >
                  {startPreviewMutation.isPending ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <Monitor className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Start Preview
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function EmptyState({ isLoading, onCreateClaude }: { isLoading: boolean; onCreateClaude: () => void }) {
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center">
        <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-gradient-to-r from-orange-500/20 to-green-500/20 blur-xl rounded-full" />
        <div className="relative flex items-center gap-3 p-4">
          <AIModelIcon model="claude" size={40} />
          <div className="h-8 w-px bg-border" />
          <TerminalSquare className="h-10 w-10" />
        </div>
      </div>
      <p className="text-sm font-mono mb-4">No terminals running</p>
      <Button variant="outline" size="sm" onClick={onCreateClaude} className="gap-2 font-mono">
        <AIModelIcon model="claude" size={16} />
        Start Claude
      </Button>
    </div>
  );
}

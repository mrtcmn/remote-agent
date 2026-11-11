import { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { sessionPath } from '@/lib/session-route';
import { useActiveMachine, getActiveMachineId } from '@/lib/active-machine';
import type { AggregatedSidebar } from '@/lib/api';
import {
  TerminalSquare,
  Plus,
  Minus,
  GitBranch,
  RefreshCw,
  ChevronDown,
  FolderOpen,
  Play,
  Monitor,
  Code2,
  KeyRound,
  Container,
  AlertTriangle,
  Palette,
  Type,
  Presentation,
  Workflow,
  Cpu,
  MemoryStick,
  HardDrive,
  Send,
  Download,
  Server,
  MoreHorizontal,
  PanelRight,
} from 'lucide-react';
import { SshTerminal } from '@/components/ssh/SshTerminal';
import { FEATURE_SESSION_SSH } from '@/lib/flags';
import { api, type TerminalType, type TerminalInfo, type ViewPanelInput } from '@/lib/api';
import type { ReviewTarget } from '@/components/review/ReviewComposer';

const isAgentTerminal = (t: TerminalInfo) => t.type === 'claude' || t.type === 'opencode' || t.type === 'kimi';
import { Button } from '@/components/ui/Button';
import { Terminal, type TerminalHandle } from '@/components/Terminal';
import { AIModelIcon, detectAIModel } from '@/components/AIModelIcon';
import { AGENTS } from '@/components/AgentLaunchButton';
import { IconMenu, type MenuEntry } from '@/components/IconMenu';
import { EDITORS, defaultEditorId, openInEditor } from '@/components/EditorIcons';
import { PANEL_DRAG_TYPE, readDragPanel, zoneAt, ZONE_DIRECTION, type SplitZone } from '@/lib/views';
import type { ViewLocationState } from '@/pages/View';
import { GitPanel } from '@/components/git';
import { FileExplorer } from '@/components/FileExplorer';
import { RecentChangesBar } from '@/components/RecentChangesBar';
import { DictationBar } from '@/components/DictationBar';
import { useDictation } from '@/hooks/useDictation';
import { RunConfigPanel } from '@/components/RunConfigPanel';
import { ScriptRunnerPanel } from '@/components/ScriptRunnerPanel';
import { RunFlowView } from '@/components/run-flow/RunFlowView';
import { BrowserPreview } from '@/components/BrowserPreview';
import { NativeBrowser } from '@/components/NativeBrowser';
import { CodePanel } from '@/components/CodePanel';
import { getApiBase } from '@/lib/api-config';
import { isElectron } from '@/lib/electron';
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
import { TabItem, type TabData } from '@/components/SessionTab';
import { useDropUpload } from '@/lib/drop-upload';
import { MarqueeText } from '@/components/ui/MarqueeText';
import { toast } from '@/components/ui/Toaster';
import { useTerminalTheme } from '@/hooks/useTerminalTheme';
import { ThemeSelector } from '@/components/ThemeSelector';
import { ProjectSelector } from '@/components/ProjectSelector';
import { ReviewDrawer } from '@/components/review/ReviewDrawer';

type ViewMode = 'terminal' | 'git' | 'files' | 'run' | 'flow' | 'docker' | 'env';

function ToolBadge({ count }: { count: number }) {
  return (
    <span className="flex items-center justify-center min-w-[14px] h-3.5 rounded-full bg-orange-500 text-white text-[8px] font-bold leading-none px-1 shrink-0 tabular-nums">
      {count}
    </span>
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

// Red only past the alert threshold; otherwise inherit the bar's muted text.
function loadColor(pct: number): string | undefined {
  return pct >= 80 ? '#f87171' : undefined;
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
  const [gitOpenFile, setGitOpenFile] = useState<{ path: string } | null>(null);
  const [runnerOpen, setRunnerOpen] = useState(false);

  // Sync activeTerminalId when URL changes (e.g. clicking a service in the sidebar)
  useEffect(() => {
    if (terminalIdFromUrl) {
      setActiveTerminalId(terminalIdFromUrl);
      setViewMode('terminal');
    }
  }, [terminalIdFromUrl]);
  const [showTerminalDropdown, setShowTerminalDropdown] = useState(false);
  // The agent opens the browser with the open_browser MCP tool, so the panel
  // follows the server, not local state. The desktop app draws a real Chromium
  // view the agent drives over CDP; a plain browser tab gets the screencast.
  // ponytail: 3s poll, push it over the session socket if it ever feels slow.
  const [desktop] = useState(isElectron);
  const [browserOpen, setBrowserOpen] = useState(false);
  const { data: browsersData } = useQuery({
    queryKey: ['browsers'],
    queryFn: api.getOpenBrowsers,
    // Faster while the panel is up: it also carries when the agent is browsing.
    refetchInterval: browserOpen ? 1000 : 3000,
    enabled: desktop,
  });
  const nativeBrowser = browsersData?.browsers.find((b) => b.sessionId === id);
  const { data: previewData } = useQuery({
    queryKey: ['previews'],
    queryFn: api.getActivePreviews,
    refetchInterval: 3000,
    enabled: !desktop,
  });
  const previewId = previewData?.previews.find((p) => p.terminalId === id)?.id ?? null;
  const hasBrowser = desktop ? !!nativeBrowser : !!previewId;
  useEffect(() => {
    if (nativeBrowser || previewId) setBrowserOpen(true);
  }, [nativeBrowser?.at, previewId]);
  const [resizingBrowser, setResizingBrowser] = useState(false);
  const [browserWidth, setBrowserWidth] = useState(() => {
    try { return Number(localStorage.getItem('browserPanelWidth')) || 560; } catch { return 560; }
  });
  useEffect(() => {
    try { localStorage.setItem('browserPanelWidth', String(browserWidth)); } catch {}
  }, [browserWidth]);
  const startBrowserResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = browserWidth;
    const move = (ev: PointerEvent) =>
      setBrowserWidth(Math.round(Math.min(Math.max(startWidth + startX - ev.clientX, 320), window.innerWidth * 0.8)));
    const up = () => {
      setResizingBrowser(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    setResizingBrowser(true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  // Tool panels (git, files, ...) open beside the terminal at 2/5 of the window; width saved per panel.
  const [toolWidths, setToolWidths] = useState<Record<string, number>>(() => {
    try { return JSON.parse(localStorage.getItem('toolPanelWidths') || '{}'); } catch { return {}; }
  });
  const toolWidth = toolWidths[viewMode] ?? Math.round(window.innerWidth * 0.4);
  const startToolResize = (e: React.PointerEvent) => {
    e.preventDefault();
    const mode = viewMode, startX = e.clientX, startWidth = toolWidth;
    let latest = startWidth;
    const move = (ev: PointerEvent) => {
      latest = Math.round(Math.min(Math.max(startWidth + startX - ev.clientX, 320), window.innerWidth * 0.8));
      setToolWidths((w) => ({ ...w, [mode]: latest }));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setToolWidths((w) => {
        try { localStorage.setItem('toolPanelWidths', JSON.stringify(w)); } catch {}
        return w;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('http://localhost:3000');
  // The tools toolbar renders into the app-wide top bar (Layout's #app-toolbar).
  const [toolbarSlot, setToolbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setToolbarSlot(document.getElementById('app-toolbar'));
  }, []);

  const { data: sshHosts = [] } = useQuery({
    queryKey: ['ssh-hosts'],
    queryFn: api.getSshHosts,
    enabled: FEATURE_SESSION_SSH,
  });
  const [showThemeSelector, setShowThemeSelector] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [showReviewDrawer, setShowReviewDrawer] = useState(false);

  // Reset child project selection when navigating to a different session
  useEffect(() => {
    setSelectedProjectId(null);
  }, [id]);

  const themeBtnRef = useRef<HTMLButtonElement>(null);
  const { activeTheme, activeFontSize, setFontSize } = useTerminalTheme();
  const { cpu, memUsed, memTotal, diskPct } = useSystemMetrics();
  const upload = useDropUpload();

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
      const baseName = opts.name ?? (opts.type === 'claude' ? 'Claude' : opts.type === 'opencode' ? 'Opencode' : opts.type === 'kimi' ? 'Kimi' : 'Shell');
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
      queryClient.invalidateQueries({ queryKey: ['sidebar-aggregate'] });
      setActiveTerminalId(terminal.id);
      setViewMode('terminal');
      navigate(sessionPath(ownerMachine, id!, terminal.id), { replace: true });
    },
  });

  // An SSH host as one more tab in this session.
  const sshTabMutation = useMutation({
    mutationFn: (hostId: string) => api.connectSshHost(hostId, { sessionId: id! }),
    onSuccess: ({ terminalId }) => {
      queryClient.invalidateQueries({ queryKey: ['terminals', id] });
      queryClient.invalidateQueries({ queryKey: ['ssh-sessions'] });
      setActiveTerminalId(terminalId);
      setViewMode('terminal');
      navigate(sessionPath(ownerMachine, id!, terminalId), { replace: true });
    },
    onError: (error) => {
      toast({ title: 'SSH connect failed', description: (error as Error).message, variant: 'destructive' });
    },
  });

  // Hand off: the owner machine pushes branch + uncommitted work, the target restores it and starts an agent.
  // The UI's own machine is 'self' here but must be 'caller' to a remote owner.
  const [handoffOpen, setHandoffOpen] = useState(false);
  const handoffMutation = useMutation({
    mutationFn: (opts: { machineId: string; note?: string }) =>
      api.handoffSession(id!, {
        to: opts.machineId === 'self' && ownerMachine !== 'self' ? 'caller' : opts.machineId,
        note: opts.note,
      }, ownerMachine),
    onSuccess: (res, opts) => {
      queryClient.invalidateQueries({ queryKey: ['sidebar-aggregate'] });
      setHandoffOpen(false);
      toast({ title: 'Handed off', description: `Branch ${res.branch} continues on the new session.` });
      navigate(sessionPath(opts.machineId, res.sessionId));
    },
    onError: (err) => toast({ title: 'Handoff failed', description: (err as Error).message, variant: 'destructive' }),
  });

  const closeMutation = useMutation({
    mutationFn: (terminalId: string) => api.closeTerminal(terminalId),
    onSuccess: (_, closedId) => {
      queryClient.invalidateQueries({ queryKey: ['terminals', id] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-aggregate'] });
      if (activeTerminalId === closedId) {
        const remaining = terminals.filter((t) => t.id !== closedId);
        setActiveTerminalId(remaining[0]?.id || null);
      }
    },
  });

  const startPreviewMutation = useMutation({
    mutationFn: (url: string) => (desktop ? api.openBrowser(id!, url) : api.startPreview(url, id!)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [desktop ? 'browsers' : 'previews'] });
      setBrowserOpen(true);
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

  const [codeSrc, setCodeSrc] = useState<string | null>(null);
  const openEditorMutation = useMutation({
    mutationFn: (folder: string) => api.openEditor(folder),
    // The API serves code-server at /code; another machine's sits under /code/m/<id>.
    onSuccess: (data) => setCodeSrc(
      getApiBase() + (ownerMachine === 'self' ? data.path : data.path.replace(/^\/code/, `/code/m/${ownerMachine}`)),
    ),
    onError: (error) => {
      toast({ title: 'Failed to open editor', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const canOpenEditor = !!editorStatus?.configured && !!activeProject?.localPath;
  // A local editor cannot open a path that lives on another machine.
  const canOpenLocalEditor = isLocalMode && ownerMachine === 'self' && !!activeProject?.localPath;
  const activeTerminals = useMemo(
    // An SSH tab that dropped stays, to offer Reconnect; closing it removes it.
    () => terminals.filter((t) => t.type === 'ssh' || (t.liveStatus || t.status) === 'running'),
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

  // The running agent terminal that review comments can be typed into: the one
  // in view if it is an agent, otherwise the first running agent terminal.
  const reviewTargetTerminal = useMemo(() => {
    if (activeTerminal && isAgentTerminal(activeTerminal) && (activeTerminal.liveStatus || activeTerminal.status) === 'running') {
      return activeTerminal;
    }
    return activeTerminals.find(isAgentTerminal);
  }, [activeTerminal, activeTerminals]);

  // Sends drafted review comments (from the diff or the file viewer) to an agent.
  const sendReview = async (message: string, target: ReviewTarget) => {
    if (target === 'new') {
      createMutation.mutate(
        { type: 'claude', name: 'Review', initialPrompt: message },
        {
          onSuccess: () => { toast({ title: 'Claude terminal started', description: 'Review comments are being processed' }); },
          onError: () => { toast({ title: 'Failed to create terminal', description: 'Please try again', variant: 'destructive' }); },
        }
      );
      return;
    }
    try {
      if (target === 'current') {
        if (!reviewTargetTerminal) throw new Error('No agent terminal is running');
        // Type the review in but leave the Enter to the user, so a stray
        // send never interrupts whatever the agent is already doing.
        await api.sendTerminalInput(reviewTargetTerminal.id, message);
        selectTerminal(reviewTargetTerminal.id);
        toast({ title: 'Review sent', description: `Typed into ${reviewTargetTerminal.name} — press Enter to run it` });
        return;
      }
      const agent = (await api.getSessionTerminals(target.sessionId)).find(
        (t) => isAgentTerminal(t) && (t.liveStatus || t.status) === 'running'
      );
      if (!agent) throw new Error(`${target.label} has no running agent`);
      // Nobody watches that session, so submit it, like the MCP send_prompt:
      // bracketed paste, a beat for the TUI to take it, then Enter alone.
      await api.sendTerminalInput(agent.id, `\x1b[200~${message}\x1b[201~`);
      await new Promise((r) => setTimeout(r, 150));
      await api.sendTerminalInput(agent.id, '\r');
      toast({ title: 'Review sent', description: `Submitted to ${target.label}` });
    } catch (e) {
      toast({ title: 'Send failed', description: (e as Error).message, variant: 'destructive' });
    }
  };

  // ── Push-to-talk dictation ──
  // Hold ⌃⇧ to talk; the transcript takes over the recent-files bar and is typed
  // into the active terminal on release (you still hit Enter to send it).
  const terminalHandleRef = useRef<TerminalHandle>(null);
  const dictation = useDictation((text) => terminalHandleRef.current?.sendText(text));
  const { start: startDictation, stop: stopDictation } = dictation;
  const dictationLive = viewMode === 'terminal' && !!activeTerminal;

  useEffect(() => {
    if (!dictationLive) return;
    let charging = false; // ⌃⇧ currently held with nothing else
    const isChord = (e: KeyboardEvent) => e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Control' && e.key !== 'Shift') {
        // A real Ctrl+Shift+<key> shortcut — not a dictation hold.
        if (charging) { charging = false; stopDictation(); }
        return;
      }
      if (isChord(e) && !charging) { charging = true; startDictation(); }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if ((e.key === 'Control' || e.key === 'Shift') && charging) {
        charging = false;
        stopDictation();
      }
    };
    const onBlur = () => { if (charging) { charging = false; stopDictation(); } };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
      if (charging) stopDictation(); // don't leave the mic hot if the view switches mid-hold
    };
  }, [dictationLive, startDictation, stopDictation]);

  // Surface "not configured" / connection errors (bar is gone once we stop).
  useEffect(() => {
    if (dictation.error) {
      toast({ title: 'Dictation', description: dictation.error, variant: 'destructive' });
    }
  }, [dictation.error]);

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
        color: t.type === 'claude' ? '#f97316' : t.type === 'opencode' ? '#6366f1' : t.type === 'kimi' ? '#1783FF' : t.type === 'process' ? '#22c55e' : undefined,
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

  // ── Split: a tab (or a sidebar terminal) dropped on an edge of the content
  // makes a view with what is shown now and the dropped item side by side.
  const contentRef = useRef<HTMLDivElement>(null);
  const [splitZone, setSplitZone] = useState<SplitZone | null>(null);
  const splitZoneRef = useRef<SplitZone | null>(null);
  const showZone = (zone: SplitZone | null) => {
    splitZoneRef.current = zone;
    setSplitZone(zone);
  };

  const createSplitView = async (dropped: Omit<ViewPanelInput, 'id'>, zone: SplitZone) => {
    const tabPanel = (tabId: string): Omit<ViewPanelInput, 'id'> =>
      tabId === '__project__'
        ? { machineId: ownerMachine, sessionId: id!, kind: 'tool', tool: 'files' }
        : { machineId: ownerMachine, sessionId: id!, kind: 'terminal', terminalId: tabId };
    const same = (a: Omit<ViewPanelInput, 'id'>, b: Omit<ViewPanelInput, 'id'>) =>
      a.sessionId === b.sessionId && a.terminalId === b.terminalId && a.tool === b.tool;
    // What the content shows now; if that is the dragged tab, the next tab.
    let current: Omit<ViewPanelInput, 'id'> | null =
      activeTerminal ? tabPanel(activeTerminal.id) : null;
    if (!current || same(current, dropped)) {
      const other = orderedTabs.find((t) => !same(tabPanel(t.id), dropped));
      current = other ? tabPanel(other.id) : null;
    }
    if (!current) {
      toast({ title: 'Nothing to split with', description: 'Open a second tab first.' });
      return;
    }
    // Not crypto.randomUUID: it is missing on plain-http origins (the tailnet IP).
    const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    const first = newId();
    try {
      const view = await api.createView({ panels: [{ ...current, id: first }, { ...dropped, id: newId() }] });
      queryClient.invalidateQueries({ queryKey: ['views'] });
      const state: ViewLocationState = { split: ZONE_DIRECTION[zone], first };
      navigate(`/views/${view.id}`, { state });
    } catch (err) {
      toast({ title: 'Could not create the view', description: (err as Error).message, variant: 'destructive' });
    }
  };

  // Tab drags use pointer events (the reorder above). Capture on window, so this
  // runs before the tab's own pointerup clears the drag.
  const createSplitViewRef = useRef(createSplitView);
  createSplitViewRef.current = createSplitView;
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const el = contentRef.current;
      if (!pointerDragRef.current || !el) return;
      showZone(zoneAt(e.clientX, e.clientY, el.getBoundingClientRect()));
    };
    const up = () => {
      const drag = pointerDragRef.current;
      const zone = splitZoneRef.current;
      pointerDragRef.current = null; // a release off the tabs must end the drag too
      showZone(null);
      if (drag && zone) {
        createSplitViewRef.current(
          drag.id === '__project__'
            ? { machineId: ownerMachine, sessionId: id!, kind: 'tool', tool: 'files' }
            : { machineId: ownerMachine, sessionId: id!, kind: 'terminal', terminalId: drag.id },
          zone,
        );
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, true);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up, true);
    };
  }, [ownerMachine, id]);

  // Sidebar terminals use HTML5 drag. Capture phase: the terminal's own file
  // drop handler must not see these.
  const splitDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes(PANEL_DRAG_TYPE) || !contentRef.current) return;
    e.preventDefault();
    e.stopPropagation();
    showZone(zoneAt(e.clientX, e.clientY, contentRef.current.getBoundingClientRect()));
  };
  const splitDrop = (e: React.DragEvent) => {
    const drag = readDragPanel(e);
    const zone = splitZoneRef.current;
    showZone(null);
    if (!drag) return;
    e.preventDefault();
    e.stopPropagation();
    if (zone) {
      createSplitView({
        machineId: drag.machineId,
        sessionId: drag.sessionId,
        kind: drag.tool ? 'tool' : 'terminal',
        terminalId: drag.terminalId ?? null,
        tool: drag.tool ?? null,
      }, zone);
    }
  };

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

  // ── Top-bar menus: "+" opens a new tab, "⋯" holds every session tool ──
  const newTabEntries: MenuEntry[] = [
    ...AGENTS.map((a) => ({
      icon: <AIModelIcon model={a.type} size={14} />,
      label: a.label,
      onSelect: () => createMutation.mutate({ type: a.type }),
    })),
    'divider',
    { icon: <TerminalSquare />, label: 'Shell', onSelect: () => createMutation.mutate({ type: 'shell' }) },
    // ponytail: this machine only — SSH hosts and their secrets live in its vault.
    ...(FEATURE_SESSION_SSH && ownerMachine === 'self'
      ? [{
          icon: <Server />,
          label: 'SSH',
          empty: 'No SSH hosts yet. Add one in the sidebar.',
          sub: sshHosts.map((h) => ({
            label: h.label,
            hint: `${h.username}@${h.host}`,
            onSelect: () => sshTabMutation.mutate(h.id),
          })),
        }]
      : []),
  ];

  const needsProject = !!session?.project?.isMultiProject && !activeProject;
  const togglePanel = (mode: ViewMode) => setViewMode(viewMode === mode ? 'terminal' : mode);
  // Tool windows: icons in the right strip, like the WebStorm tool window bar.
  const panelEntries: MenuEntry[] = [
    ...(session?.project
      ? [
          { icon: <Play />, label: 'Run', active: viewMode === 'run', disabled: needsProject, onSelect: () => togglePanel('run') },
          ...(activeProject
            ? [{ icon: <PanelRight />, label: 'Runs panel', active: runnerOpen, onSelect: () => setRunnerOpen((v) => !v) }]
            : []),
          { icon: <GitBranch />, label: 'Git', active: viewMode === 'git', disabled: needsProject, onSelect: () => { setGitOpenFile(null); togglePanel('git'); } },
          { icon: <Workflow />, label: 'Flow', active: viewMode === 'flow', onSelect: () => togglePanel('flow') },
          { icon: <FolderOpen />, label: 'Files', active: viewMode === 'files', disabled: needsProject, onSelect: () => togglePanel('files') },
          { icon: <KeyRound />, label: 'Env', active: viewMode === 'env', disabled: needsProject, onSelect: () => togglePanel('env') },
        ]
      : []),
    { icon: <Container />, label: 'Docker', active: viewMode === 'docker', disabled: needsProject, onSelect: () => togglePanel('docker') },
    {
      icon: <Monitor />,
      label: 'Browser',
      active: browserOpen && hasBrowser,
      disabled: needsProject,
      onSelect: () => (hasBrowser ? setBrowserOpen((v) => !v) : setShowPreviewDialog(true)),
    },
    // Only where code-server is installed: a Docker or host machine, not the desktop app.
    ...(canOpenEditor
      ? [{
          icon: <Code2 />,
          label: 'VS Code',
          active: !!codeSrc,
          disabled: openEditorMutation.isPending,
          onSelect: () => (codeSrc ? setCodeSrc(null) : openEditorMutation.mutate(activeProject!.localPath)),
        }]
      : []),
  ];
  // Actions that are not panels stay behind "⋯" at the top of the strip.
  const moreEntries: MenuEntry[] = [
    ...(canOpenLocalEditor
      ? [{
          icon: <Code2 />,
          label: 'Open in editor',
          sub: EDITORS.map((e) => ({
            icon: <e.Icon size={14} />,
            label: e.label,
            active: e.id === defaultEditorId(),
            onSelect: () => openInEditor(e.id, activeProject!.localPath),
          })),
        }]
      : []),
    ...(session?.project?.repoUrl
      ? [
          ...(canOpenLocalEditor ? ['divider' as const] : []),
          { icon: <Send />, label: 'Hand off', disabled: handoffMutation.isPending, onSelect: () => setHandoffOpen(true) },
          ...(ownerMachine !== 'self'
            ? [{ icon: <Download />, label: 'Continue here', disabled: handoffMutation.isPending, onSelect: () => handoffMutation.mutate({ machineId: 'self' }) }]
            : []),
        ]
      : []),
  ];

  return (
    <div className="flex flex-col h-full gap-1.5">
      {handoffOpen && (
        <HandoffDialog
          ownerMachine={ownerMachine}
          pending={handoffMutation.isPending}
          onSubmit={(opts) => handoffMutation.mutate(opts)}
          onCancel={() => setHandoffOpen(false)}
        />
      )}
      {/* ── Top bar: tabs, "+" new tab, then the "⋯" tools menu on the right.
           Portaled into Layout's #app-toolbar, so the session has no toolbar row. ── */}
      {toolbarSlot && createPortal(
        <div className="flex-1 min-w-0 flex items-center gap-1 pr-1">
          {session?.project?.isMultiProject && session.project.childLinks && session.project.childLinks.length > 0 && (
            <div className="hidden md:flex items-center shrink-0 electrobun-webkit-app-region-no-drag">
              <ProjectSelector
                links={session.project.childLinks}
                selectedProjectId={selectedProjectId}
                onSelect={(id) => {
                  setSelectedProjectId(id);
                  // Leave a project-dependent panel when the selection is cleared
                  const projectDependentViews: ViewMode[] = ['git', 'files', 'env'];
                  if (!id && projectDependentViews.includes(viewMode)) setViewMode('terminal');
                }}
              />
            </div>
          )}

          <div className="hidden md:block min-w-0 overflow-x-auto overflow-y-hidden scrollbar-hide electrobun-webkit-app-region-no-drag">
            <div className="flex items-center gap-1">
              {orderedTabs.map((tab) => (
                <div
                  key={tab.id}
                  className="flex items-center shrink-0"
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
                        : tab.id === activeTerminalId
                    }
                    onActivate={() => {
                      if (tab.id === '__project__') {
                        if (!session?.project?.isMultiProject || activeProject) setViewMode('files');
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
          <IconMenu icon={<Plus className="size-4" />} title="New tab" entries={newTabEntries} />

          {/* Empty space stays a window drag region */}
          <div className="flex-1 self-stretch" />
          {/* Mobile has no right strip, so all tools stay in one menu there. */}
          <div className="md:hidden">
            <IconMenu
              icon={<MoreHorizontal className="size-4" />}
              title="Session tools"
              align="end"
              entries={[...panelEntries, 'divider', ...moreEntries]}
              active={runnerOpen || (browserOpen && hasBrowser) || !!codeSrc || ['git', 'run', 'flow', 'files', 'env', 'docker'].includes(viewMode)}
            />
          </div>
        </div>,
      toolbarSlot)}

      <div className="md:hidden shrink-0">
      {/* Mobile terminal dropdown */}
      <div className="md:hidden flex flex-col shrink-0">
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
                  ) : activeTerminal.type === 'kimi' ? (
                    <AIModelIcon model="kimi" size={14} />
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
                  ) : terminal.type === 'kimi' ? (
                    <AIModelIcon model="kimi" size={16} />
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
      </div>

      {/* ── Content Area — every tool is an island; the terminal island takes the xterm bg ── */}
      {/* Runs sits in the flow beside the content, so opening it shrinks the terminal. */}
      <div className="flex-1 min-h-0 flex gap-1.5">
      <div
        ref={contentRef}
        onDragOverCapture={splitDragOver}
        onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) showZone(null); }}
        onDropCapture={splitDrop}
        className={cn('relative flex-1 min-w-0 island shadow-[0_0_9px_-2px_rgb(0_0_0/0.2),0_0_0_1px_hsl(var(--border)/0.2)]', 'terminal-surface')}
        style={{ background: 'var(--code-bg, hsl(var(--island)))' }}
      >
        {splitZone && (
          <div
            className="pointer-events-none absolute z-30 rounded-lg border-2 border-primary/60 bg-primary/15 transition-all duration-100"
            style={{
              left: splitZone === 'right' ? '50%' : 0,
              top: splitZone === 'bottom' ? '50%' : 0,
              width: splitZone === 'left' || splitZone === 'right' ? '50%' : '100%',
              height: splitZone === 'top' || splitZone === 'bottom' ? '50%' : '100%',
            }}
          />
        )}
        {
          activeTerminal?.type === 'ssh' ? (
            <div className="h-full min-h-0 px-2 pt-1.5">
              <SshTerminal
                key={activeTerminal.id}
                terminalId={activeTerminal.id}
                className="h-full"
                onStatusChange={() => { queryClient.invalidateQueries({ queryKey: ['terminals', id] }); }}
              />
            </div>
          ) : activeTerminal ? (
            <div className="h-full min-h-0 px-2 pt-1.5">
              <Terminal
                ref={terminalHandleRef}
                key={activeTerminal.id}
                terminalId={activeTerminal.id}
                className="h-full"
                onExit={() => { queryClient.invalidateQueries({ queryKey: ['terminals', id] }); }}
                onTitleChanged={() => { queryClient.invalidateQueries({ queryKey: ['terminals', id] }); }}
              />
            </div>
          ) : (
            <EmptyState isLoading={isLoading} onCreateClaude={() => createMutation.mutate({ type: 'claude' })} />
          )
        }
      </div>

      {viewMode !== 'terminal' && (
        <div className="flex shrink-0 -ml-1.5" style={{ width: toolWidth }}>
          <div onPointerDown={startToolResize} className="group w-1.5 shrink-0 cursor-col-resize flex justify-center">
            <div className="w-px h-full bg-primary/50 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="min-w-0 flex-1 island">
            {viewMode === 'git' ? (
          <GitPanel
            sessionId={id!}
            project={activeProject ?? undefined}
            projectId={gitProjectId}
            openFile={gitOpenFile}
            currentTargetLabel={reviewTargetTerminal?.name}
            onProceed={sendReview}
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
        ) : (
          <FileExplorer sessionId={id!} project={session?.project} selectedProjectId={selectedProjectId} openFile={searchParams.get('file') ?? undefined} className="h-full" currentTargetLabel={reviewTargetTerminal?.name} onProceed={sendReview} />
            )}
          </div>
        </div>
      )}

      {runnerOpen && activeProject && (
        <ScriptRunnerPanel
          projectId={activeProject.id}
          sessionId={id!}
          onOpenTerminal={(terminalId) => {
            queryClient.invalidateQueries({ queryKey: ['terminals', id] });
            selectTerminal(terminalId);
            setViewMode('terminal');
          }}
          onClose={() => setRunnerOpen(false)}
        />
      )}

      {browserOpen && hasBrowser && (
        // -ml-1.5 puts the grab strip in the gap, on the frame, like the sidebar handle.
        <div
          className="flex shrink-0 -ml-1.5"
          style={{ width: browserWidth }}
        >
          {/* A strip beside the page, not over it: the native view sits above all HTML. */}
          <div
            onPointerDown={startBrowserResize}
            className="group w-1.5 shrink-0 cursor-col-resize flex justify-center"
          >
            <div className="w-px h-full bg-primary/50 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="min-w-0 flex-1 island">
            {nativeBrowser ? (
              <NativeBrowser
                url={nativeBrowser.url}
                openedAt={nativeBrowser.at}
                agentUntil={nativeBrowser.agentUntil}
                resizing={resizingBrowser}
                onClose={async () => {
                  try { await api.closeBrowser(id!); } catch {}
                  setBrowserOpen(false);
                  queryClient.invalidateQueries({ queryKey: ['browsers'] });
                }}
              />
            ) : previewId ? (
              <BrowserPreview
                key={previewId}
                previewId={previewId}
                onStop={async () => {
                  try { await api.stopPreview(previewId); } catch {}
                  setBrowserOpen(false);
                  queryClient.invalidateQueries({ queryKey: ['previews'] });
                }}
                className="h-full"
              />
            ) : null}
          </div>
        </div>
      )}

      {codeSrc && (
        // Same shell as the browser panel: a grab strip in the gap, then the island.
        <div className="flex shrink-0 -ml-1.5" style={{ width: browserWidth }}>
          <div
            onPointerDown={startBrowserResize}
            className="group w-1.5 shrink-0 cursor-col-resize flex justify-center"
          >
            <div className="w-px h-full bg-primary/50 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="min-w-0 flex-1 island">
            <CodePanel src={codeSrc} resizing={resizingBrowser} onClose={() => setCodeSrc(null)} />
          </div>
        </div>
      )}

      <ToolStrip panels={panelEntries} more={moreEntries} />
      </div>

      {/* ── Bottom: recent files + status bar sit on the frame, outside the islands ── */}
      <div className="shrink-0">
      {activeTerminal && (
        dictation.active ? (
          <DictationBar transcript={dictation.transcript} />
        ) : (
          <RecentChangesBar
            sessionId={id!}
            projectId={gitProjectId}
            onOpenFile={(path) => {
              setGitOpenFile({ path });
              setViewMode('git');
            }}
          />
        )
      )}
      <ToolbarRoot>
        <ToolbarGroup>
          {/* What the bar is about: the active project, or the host of an SSH tab. */}
          {(activeTerminal?.type === 'ssh' || activeProject || session?.project) && (
            <>
              <span className="flex items-center gap-1.5 px-2 h-full text-[10.5px] font-semibold leading-none tracking-tight text-foreground/90">
                {activeTerminal?.type === 'ssh'
                  ? <Server className="size-[11px] shrink-0 text-muted-foreground" />
                  : <FolderOpen className="size-[11px] shrink-0 text-muted-foreground" />}
                <MarqueeText
                  text={activeTerminal?.type === 'ssh' ? activeTerminal.name : (activeProject ?? session?.project)!.name}
                  className="max-w-[12rem] leading-none"
                />
              </span>
              <ToolbarDivider />
            </>
          )}
          <ToolbarStatus status="green" label="Connected" pulse />
          <ToolbarDivider />
          {upload.total > 0 && (
            <>
              <span className="flex items-center gap-1.5 px-2 text-[10.5px] font-medium leading-none tracking-tight text-muted-foreground">
                <RefreshCw className="size-[10px] animate-spin" />
                Uploading {Math.min(upload.done + 1, upload.total)}/{upload.total}
              </span>
              <ToolbarDivider />
            </>
          )}
          {session?.project && (
            <>
              <button
                onClick={() => { setGitOpenFile(null); setViewMode(viewMode === 'git' ? 'terminal' : 'git'); }}
                disabled={!!session?.project?.isMultiProject && !activeProject}
                className={cn(
                  'flex items-center gap-1.5 px-2 h-full text-[10.5px] font-medium leading-none tracking-tight',
                  'transition-colors duration-75 cursor-pointer outline-none disabled:opacity-50 disabled:cursor-not-allowed',
                  viewMode === 'git'
                    ? 'bg-secondary text-foreground'
                    : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
                )}
              >
                <GitBranch className="size-[11px] shrink-0" />
                <MarqueeText
                  text={gitStatus?.branch ?? 'git'}
                  className="max-w-[10rem] leading-none"
                />
                {changeCount > 0 && <ToolBadge count={changeCount} />}
              </button>
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
          <button className="flex items-center gap-[3px] px-2 h-full text-[10.5px] font-medium leading-none tracking-tight cursor-default hover:bg-secondary transition-colors duration-75 text-muted-foreground">
            <Cpu className="size-3 text-muted-foreground/70" />
            <span style={{ color: loadColor(cpu), minWidth: '3ch', textAlign: 'right', display: 'inline-block' }} className="tabular-nums">{cpu}%</span>
          </button>
          <ToolbarDivider />
          <button className="flex items-center gap-[3px] px-2 h-full text-[10.5px] font-medium leading-none tracking-tight cursor-default hover:bg-secondary transition-colors duration-75 text-muted-foreground">
            <MemoryStick className="size-3 text-muted-foreground/70" />
            <span style={{ color: loadColor(memTotal > 0 ? (memUsed / memTotal) * 100 : 0), minWidth: '4ch', textAlign: 'right', display: 'inline-block' }} className="tabular-nums">{memUsed.toFixed(1)}</span>
            <span className="text-muted-foreground/60">/{memTotal}</span>
          </button>
          <ToolbarDivider />
          <button className="flex items-center gap-[3px] px-2 h-full text-[10.5px] font-medium leading-none tracking-tight cursor-default hover:bg-secondary transition-colors duration-75 text-muted-foreground">
            <HardDrive className="size-3 text-muted-foreground/70" />
            <span style={{ color: loadColor(diskPct), minWidth: '3ch', textAlign: 'right', display: 'inline-block' }} className="tabular-nums">{diskPct}%</span>
          </button>
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
            <span className="flex items-center px-1 h-full text-[10px] font-medium tabular-nums text-muted-foreground select-none">
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
                'text-[10.5px] font-medium leading-none tracking-tight',
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
      </div>

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
            <h3 className="text-sm font-semibold mb-4">Open Browser</h3>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-muted-foreground mb-1 block">URL to open</label>
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
                  Open Browser
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

function HandoffDialog({
  ownerMachine,
  pending,
  onSubmit,
  onCancel,
}: {
  ownerMachine: string;
  pending: boolean;
  onSubmit: (opts: { machineId: string; note?: string }) => void;
  onCancel: () => void;
}) {
  const queryClient = useQueryClient();
  const machines = (queryClient.getQueryData<AggregatedSidebar>(['sidebar-aggregate'])?.machines ?? [])
    .filter((m) => m.online && m.machineId !== ownerMachine);
  const [machineId, setMachineId] = useState(machines[0]?.machineId ?? '');
  const [note, setNote] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onCancel} />
      <form
        className="relative w-full max-w-sm rounded-xl border bg-background p-4 shadow-xl animate-in zoom-in-95 space-y-3"
        onSubmit={(e) => { e.preventDefault(); if (machineId) onSubmit({ machineId, note: note.trim() || undefined }); }}
      >
        <h3 className="text-sm font-semibold">Hand off session</h3>
        <p className="text-xs text-muted-foreground">
          Pushes the branch and all uncommitted work through origin, then starts a new agent on the target.
          Git-ignored files such as .env do not move.
        </p>
        {machines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No other machine is online.</p>
        ) : (
          <select
            className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            value={machineId}
            onChange={(e) => setMachineId(e.target.value)}
          >
            {machines.map((m) => <option key={m.machineId} value={m.machineId}>{m.machineName}</option>)}
          </select>
        )}
        <textarea
          className="w-full rounded-md border bg-background px-2 py-1.5 text-sm"
          rows={3}
          placeholder="Note for the next agent (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <div className="flex justify-end gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button type="submit" size="sm" disabled={!machineId || pending}>{pending ? 'Handing off…' : 'Hand off'}</Button>
        </div>
      </form>
    </div>
  );
}

/** The right tool window bar: icon only, the name shows on hover. */
function ToolStrip({ panels, more }: { panels: MenuEntry[]; more: MenuEntry[] }) {
  return (
    <div className="hidden md:flex flex-col items-center gap-1 shrink-0 w-8 -ml-0.5">
      {more.length > 0 && (
        <>
          <IconMenu icon={<MoreHorizontal className="size-4" />} title="More" align="start" side="left" entries={more} />
          <div className="h-px w-5 bg-border/60 my-0.5" />
        </>
      )}
      {panels.map((e) =>
        e === 'divider' ? null : (
          <button
            key={e.label}
            type="button"
            aria-label={e.label}
            disabled={e.disabled}
            onClick={e.onSelect}
            className={cn(
              'group relative flex items-center justify-center size-7 rounded-md transition-colors [&>svg]:size-4',
              'text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-40 disabled:pointer-events-none',
              e.active && 'text-primary bg-primary/10 hover:text-primary hover:bg-primary/15',
            )}
          >
            {e.icon}
            {/* ponytail: CSS tooltip; the native browser view covers it while that panel is open. */}
            <span className="pointer-events-none absolute right-full mr-2 top-1/2 -translate-y-1/2 z-50 whitespace-nowrap rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-foreground shadow-lg opacity-0 group-hover:opacity-100 transition-opacity delay-300 group-hover:delay-300">
              {e.label}
            </span>
          </button>
        ),
      )}
    </div>
  );
}

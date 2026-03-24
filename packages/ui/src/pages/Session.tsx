import { useState, useMemo, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import {
  ArrowLeft,
  TerminalSquare,
  Terminal as TerminalIcon,
  Plus,
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
} from 'lucide-react';
import { api, type TerminalType } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Terminal } from '@/components/Terminal';
import { AIModelIcon, detectAIModel } from '@/components/AIModelIcon';
import { GitPanel } from '@/components/git';
import { FileExplorer } from '@/components/FileExplorer';
import { RunConfigPanel } from '@/components/RunConfigPanel';
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

type ViewMode = 'terminal' | 'git' | 'files' | 'run' | 'preview' | 'docker' | 'env';

// ─── Tools Menu Primitives ──────────────────────────────────────────────────

function Divider() {
  return <div className="w-px self-stretch shrink-0 bg-border/70 mx-0.5" />;
}

function ToolBadge({ count }: { count: number }) {
  return (
    <motion.span
      initial={{ scale: 0.4, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 500, damping: 30 }}
      className="flex items-center justify-center min-w-[14px] h-3.5 rounded-full bg-orange-500 text-white text-[8px] font-bold leading-none px-1 shrink-0 tabular-nums"
    >
      {count}
    </motion.span>
  );
}

function PulseDot({ active }: { active: boolean }) {
  const color = active ? '#10b981' : 'rgba(128,128,128,0.3)';
  return (
    <span className="relative flex size-1.5 shrink-0">
      {active && (
        <motion.span
          className="absolute inset-0 rounded-full"
          style={{ backgroundColor: color }}
          animate={{ scale: [1, 2.2, 1], opacity: [0.7, 0, 0.7] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
      <span className="relative rounded-full h-full w-full" style={{ backgroundColor: color }} />
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
  const [hovered, setHovered] = useState(false);

  return (
    <motion.button
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.1 }}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'relative flex items-center gap-1.5 px-2 my-[2px] self-stretch text-xs font-medium rounded-md transition-colors duration-100 shrink-0 select-none cursor-pointer',
        isActive
          ? 'bg-secondary/80 text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary/60',
        disabled && 'opacity-50 cursor-not-allowed',
        className
      )}
    >
      {isActive && accentColor && activeGlow && (
        <motion.span
          className="absolute inset-0 rounded-md pointer-events-none"
          style={{ backgroundColor: accentColor }}
          animate={{ opacity: [0.06, 0.12, 0.06] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {isActive && accentColor && (
        <motion.span
          layoutId="tool-indicator"
          className="absolute -top-px left-1/2 -translate-x-1/2 h-px w-4/5 rounded-full pointer-events-none"
          style={{ backgroundColor: accentColor }}
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        />
      )}

      {isRunning !== undefined && <PulseDot active={isRunning} />}

      {customIcon && customIcon}
      {!customIcon && Icon && (
        <Icon
          className="size-3.5 shrink-0 transition-colors"
          style={iconColor && (isActive || hovered) ? { color: iconColor } : undefined}
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
        <motion.span animate={{ opacity: hovered ? 0.5 : 0.2 }} transition={{ duration: 0.12 }}>
          <ExternalLink className="size-2.5" />
        </motion.span>
      )}
    </motion.button>
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
      className="size-3.5 rounded-full shrink-0 flex items-center justify-center"
      style={{ border: `2px solid ${color}`, backgroundColor: `${color}22` }}
    >
      <span className="size-[5px] rounded-full" style={{ backgroundColor: color }} />
    </span>
  );
}

function TabItem({
  tab,
  isActive,
  onActivate,
  onClose,
}: {
  tab: TabData;
  isActive: boolean;
  onActivate: () => void;
  onClose?: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const showClose = !tab.pinned && (isActive || hovered);

  const typeIcon = tab.type === 'claude' ? (
    <AIModelIcon model={detectAIModel(tab.label)} size={14} />
  ) : tab.type === 'process' ? (
    <StatusDot color="#22c55e" />
  ) : tab.type === 'project' ? (
    <FolderOpen className="size-3.5 text-muted-foreground shrink-0" />
  ) : (
    <TerminalSquare className="size-3.5 text-muted-foreground shrink-0" />
  );

  return (
    <motion.div
      layout
      initial={{ opacity: 0, filter: 'blur(2px)' }}
      animate={{ opacity: 1, filter: 'blur(0px)' }}
      exit={{ opacity: 0, filter: 'blur(2px)' }}
      transition={{ duration: 0.12 }}
      onClick={onActivate}
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      className={cn(
        'relative flex items-center gap-1.5 h-full px-3 cursor-pointer select-none shrink-0 overflow-hidden',
        'border-r border-border',
        isActive
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
      )}
      style={{ maxWidth: 180 }}
    >
      {typeIcon}

      <span className="text-xs font-medium truncate flex-1 min-w-0 leading-none">
        {tab.label}
      </span>

      <AnimatePresence>
        {showClose && (
          <motion.button
            key="close"
            initial={{ opacity: 0, width: 0, marginLeft: 0 }}
            animate={{ opacity: 1, width: 14, marginLeft: 2 }}
            exit={{ opacity: 0, width: 0, marginLeft: 0 }}
            transition={{ duration: 0.1 }}
            className="flex items-center justify-center size-3.5 rounded hover:bg-accent text-muted-foreground hover:text-foreground shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              onClose?.();
            }}
          >
            <X className="size-2.5" />
          </motion.button>
        )}
      </AnimatePresence>

      {isActive && (
        <motion.span
          layoutId="terminal-tab-underline"
          className="absolute bottom-0 left-0 right-0 h-px bg-foreground/20"
          transition={{ type: 'spring', stiffness: 400, damping: 35 }}
        />
      )}
    </motion.div>
  );
}

// ─── Status Bar Metric ──────────────────────────────────────────────────────

function useSystemMetrics() {
  const [cpu, setCpu] = useState(24);
  const [ram, setRam] = useState(6.2);
  const disk = 67;

  useEffect(() => {
    const id = setInterval(() => {
      setCpu((p) => Math.round(Math.max(3, Math.min(96, p + (Math.random() - 0.46) * 14))));
      setRam((p) => parseFloat(Math.max(2, Math.min(14.5, p + (Math.random() - 0.5) * 0.5)).toFixed(1)));
    }, 1200);
    return () => clearInterval(id);
  }, []);

  return { cpu, ram, disk };
}

function loadColor(pct: number): string {
  if (pct < 55) return '#34d399';
  if (pct < 80) return '#fbbf24';
  return '#f87171';
}

// ─── Main ────────────────────────────────────────────────────────────────────

export function SessionPage() {
  const { id, terminalId: terminalIdFromRoute } = useParams<{ id: string; terminalId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const terminalIdFromUrl = terminalIdFromRoute || searchParams.get('terminalId');
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(terminalIdFromUrl);
  const [viewMode, setViewMode] = useState<ViewMode>('terminal');
  const [showTerminalDropdown, setShowTerminalDropdown] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('http://localhost:3000');
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const { cpu, ram, disk } = useSystemMetrics();

  const { data: session } = useQuery({
    queryKey: ['session', id],
    queryFn: () => api.getSession(id!),
    enabled: !!id,
  });

  const { data: terminals = [], isLoading } = useQuery({
    queryKey: ['terminals', id],
    queryFn: () => api.getSessionTerminals(id!),
    refetchInterval: 5000,
    enabled: !!id,
  });

  const { data: gitStatus } = useQuery({
    queryKey: ['session-git-status', id],
    queryFn: () => api.getSessionGitStatus(id!),
    refetchInterval: 3000,
    enabled: !!id && !!session?.project,
  });

  const createMutation = useMutation({
    mutationFn: (opts: { type?: TerminalType; name?: string; initialPrompt?: string } = {}) =>
      api.createTerminal({
        sessionId: id!,
        type: opts.type || 'shell',
        name: opts.name,
        initialPrompt: opts.initialPrompt,
      }),
    onSuccess: (terminal) => {
      queryClient.invalidateQueries({ queryKey: ['terminals', id] });
      setActiveTerminalId(terminal.id);
      setViewMode('terminal');
      navigate(`/sessions/${id}/${terminal.id}`, { replace: true });
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

  const openEditorMutation = useMutation({
    mutationFn: (folder: string) => api.openEditor(folder),
    onSuccess: (data) => { window.open(data.url, '_blank'); },
    onError: (error) => {
      toast({ title: 'Failed to open editor', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const canOpenEditor = !!editorStatus?.configured && !!session?.project?.localPath;
  const activeTerminals = terminals.filter((t) => (t.liveStatus || t.status) === 'running');

  if (!activeTerminalId && activeTerminals.length > 0 && !isLoading) {
    setActiveTerminalId(activeTerminals[0].id);
  }

  if (searchParams.get('terminalId') && terminals.length > 0 && !isLoading) {
    const tid = searchParams.get('terminalId');
    navigate(`/sessions/${id}/${tid}`, { replace: true });
  }

  const selectTerminal = (terminalId: string) => {
    setActiveTerminalId(terminalId);
    setViewMode('terminal');
    navigate(`/sessions/${id}/${terminalId}`, { replace: true });
  };

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
        color: t.type === 'claude' ? '#f97316' : t.type === 'process' ? '#22c55e' : undefined,
      });
    });
    return tabs;
  }, [activeTerminals, session]);

  return (
    <div className="flex flex-col h-full">
      {/* ── Tools Menu Toolbar ── */}
      <div className="flex items-stretch h-9 border-b border-border bg-card overflow-hidden w-full shrink-0">
        <div
          className="flex-1 min-w-0 flex items-stretch overflow-x-auto"
          style={{ scrollbarWidth: 'none' }}
        >
          <div className="flex items-stretch px-1">
            {/* Nav */}
            <ToolBtn icon={ArrowLeft} onClick={() => navigate('/')} className="w-7 justify-center px-0" />
            <ToolBtn
              label={session?.project?.name || 'Session'}
              className="font-semibold text-foreground/90 px-2"
            />

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
                          onClick={() => setViewMode(viewMode === 'run' ? 'terminal' : 'run')}
                        />
                        <ToolBtn
                          icon={FolderOpen}
                          label="Files"
                          isActive={viewMode === 'files'}
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
                        onClick={() => setViewMode(viewMode === 'env' ? 'terminal' : 'env')}
                      />
                    )}
                    <ToolBtn
                      icon={Container}
                      label="Docker"
                      isActive={viewMode === 'docker'}
                      onClick={() => setViewMode(viewMode === 'docker' ? 'terminal' : 'docker')}
                    />
                    <ToolBtn
                      icon={Monitor}
                      label="Preview"
                      isActive={viewMode === 'preview'}
                      onClick={() => {
                        if (viewMode === 'preview') setViewMode('terminal');
                        else if (previewId) setViewMode('preview');
                        else setShowPreviewDialog(true);
                      }}
                    />
                  </div>

                  {/* Editor */}
                  {canOpenEditor && (
                    <>
                      <Divider />
                      <div className="flex items-stretch gap-0.5">
                        <ToolBtn
                          icon={Code2}
                          label="VS Code"
                          external
                          iconColor="#007ACC"
                          onClick={() => openEditorMutation.mutate(session!.project!.localPath)}
                          disabled={openEditorMutation.isPending}
                        />
                      </div>
                    </>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Collapse toggle */}
        <div className="shrink-0 flex items-stretch border-l border-border/60">
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
      <div className="hidden md:flex items-stretch h-8 border-b border-border bg-card w-full shrink-0">
        <div
          className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden"
          style={{ scrollbarWidth: 'none' }}
        >
          <div className="flex items-stretch h-full">
            <AnimatePresence initial={false}>
              {tabData.map((tab) => (
                <TabItem
                  key={tab.id}
                  tab={tab}
                  isActive={
                    tab.id === '__project__'
                      ? viewMode !== 'terminal'
                      : tab.id === activeTerminalId && viewMode === 'terminal'
                  }
                  onActivate={() => {
                    if (tab.id === '__project__') {
                      setViewMode('files');
                    } else {
                      selectTerminal(tab.id);
                    }
                  }}
                  onClose={tab.pinned ? undefined : () => closeMutation.mutate(tab.id)}
                />
              ))}
            </AnimatePresence>
          </div>
        </div>

        {/* Add tab */}
        <button
          onClick={() => createMutation.mutate({ type: 'shell' })}
          className="flex items-center justify-center w-8 h-full text-muted-foreground/50 hover:text-muted-foreground hover:bg-secondary transition-colors shrink-0 border-l border-border"
        >
          <Plus className="size-3.5" />
        </button>
      </div>

      {/* Mobile terminal dropdown */}
      <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b bg-card/20 shrink-0">
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
            project={session?.project}
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
        ) : viewMode === 'run' ? (
          <RunConfigPanel
            projectId={session!.project!.id}
            sessionId={id!}
            onTerminalCreated={(terminalId) => {
              queryClient.invalidateQueries({ queryKey: ['terminals', id] });
              selectTerminal(terminalId);
            }}
          />
        ) : viewMode === 'docker' ? (
          <DockerPanel
            sessionId={id!}
            projectId={session?.project?.id}
            onTerminalCreated={(terminalId) => {
              queryClient.invalidateQueries({ queryKey: ['terminals', id] });
              selectTerminal(terminalId);
            }}
          />
        ) : viewMode === 'env' && session?.project ? (
          <div className="p-4 overflow-y-auto h-full">
            <EnvEditor projectId={session.project.id} />
            {session.project.isMultiProject && session.project.childLinks && (
              <div className="mt-6 space-y-4">
                {session.project.childLinks.map((link: any) => (
                  <div key={link.id} className="border rounded-lg p-3">
                    <p className="text-xs font-medium text-muted-foreground mb-2">
                      {link.alias || link.childProject?.name}
                    </p>
                    <EnvEditor projectId={link.childProjectId} />
                  </div>
                ))}
              </div>
            )}
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
          <FileExplorer sessionId={id!} project={session?.project} className="h-full" />
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
        </ToolbarGroup>

        <ToolbarGroup align="right">
          <button className="flex items-center gap-[3px] px-2 h-full text-[10.5px] font-mono leading-none tracking-tight cursor-default hover:bg-secondary transition-colors duration-75 text-muted-foreground">
            <span className="text-muted-foreground/70">cpu </span>
            <span style={{ color: loadColor(cpu) }} className="tabular-nums">{cpu}%</span>
          </button>
          <ToolbarDivider />
          <button className="flex items-center gap-[3px] px-2 h-full text-[10.5px] font-mono leading-none tracking-tight cursor-default hover:bg-secondary transition-colors duration-75 text-muted-foreground">
            <span className="text-muted-foreground/70">mem </span>
            <span style={{ color: loadColor((ram / 16) * 100) }} className="tabular-nums">{ram}</span>
            <span className="text-muted-foreground/60">/16</span>
          </button>
          <ToolbarDivider />
          <button className="flex items-center gap-[3px] px-2 h-full text-[10.5px] font-mono leading-none tracking-tight cursor-default hover:bg-secondary transition-colors duration-75 text-muted-foreground">
            <span className="text-muted-foreground/70">disk </span>
            <span style={{ color: loadColor(disk) }} className="tabular-nums">{disk}%</span>
          </button>
          <ToolbarDivider />
          <ToolbarItem icon={TerminalIcon} label="bash" />
        </ToolbarGroup>
      </ToolbarRoot>

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

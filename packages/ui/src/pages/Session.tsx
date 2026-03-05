import { useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  TerminalSquare,
  Plus,
  GitBranch,
  X,
  RefreshCw,
  PanelRightClose,
  PanelRight,
  ChevronDown,
  FolderOpen,
  Trash2,
  Play,
  Monitor,
  Box,
  Settings2,
} from 'lucide-react';
import { api, type TerminalType } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Terminal } from '@/components/Terminal';
import { GitPanel } from '@/components/git';
import { FileExplorer } from '@/components/FileExplorer';
import { RunConfigPanel } from '@/components/RunConfigPanel';
import { BrowserPreview } from '@/components/BrowserPreview';
import { DockerPanel } from '@/components/DockerPanel';
import { EnvEditor } from '@/components/EnvEditor';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toaster';

type ViewMode = 'terminal' | 'git' | 'files' | 'run' | 'preview' | 'docker' | 'env';

export function SessionPage() {
  const { id, terminalId: terminalIdFromRoute } = useParams<{ id: string; terminalId?: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  // Support both route param and legacy query param
  const terminalIdFromUrl = terminalIdFromRoute || searchParams.get('terminalId');
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(terminalIdFromUrl);
  const [viewMode, setViewMode] = useState<ViewMode>('terminal');
  const [showSidebar, setShowSidebar] = useState(true);
  const [showTerminalDropdown, setShowTerminalDropdown] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [previewUrl, setPreviewUrl] = useState('http://localhost:3000');

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

  const cleanupMutation = useMutation({
    mutationFn: () => api.removeExitedTerminals(id!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['terminals', id] });
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
      toast({
        title: 'Failed to start preview',
        description: (error as Error).message,
        variant: 'destructive',
      });
    },
  });

  // Filter out exited terminals, group by type
  const activeTerminals = terminals.filter((t) => (t.liveStatus || t.status) === 'running');

  // Auto-select terminal from URL param or fall back to first running terminal
  if (!activeTerminalId && activeTerminals.length > 0 && !isLoading) {
    setActiveTerminalId(activeTerminals[0].id);
  }

  // Clean up legacy query param and migrate to route param
  if (searchParams.get('terminalId') && terminals.length > 0 && !isLoading) {
    const tid = searchParams.get('terminalId');
    navigate(`/sessions/${id}/${tid}`, { replace: true });
  }

  // Helper to update URL when switching terminals
  const selectTerminal = (terminalId: string) => {
    setActiveTerminalId(terminalId);
    navigate(`/sessions/${id}/${terminalId}`, { replace: true });
  };

  const activeTerminal = terminals.find((t) => t.id === activeTerminalId);

  // Count changes for git badge
  const changeCount = useMemo(() => {
    if (!gitStatus) return 0;
    return (gitStatus.modified?.length || 0) + (gitStatus.staged?.length || 0) + (gitStatus.untracked?.length || 0);
  }, [gitStatus]);
  const exitedCount = terminals.length - activeTerminals.length;
  const claudeTerminals = activeTerminals.filter((t) => t.type === 'claude');
  const shellTerminals = activeTerminals.filter((t) => t.type === 'shell');
  const processTerminals = activeTerminals.filter((t) => t.type === 'process');

  return (
    <div className="flex flex-col h-full">
      {/* Top Toolbar */}
      <div className="flex items-center gap-2 h-11 px-3 md:px-2 border-b bg-card/30 shrink-0">
        {/* Back + Title */}
        <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="font-mono text-sm font-medium tracking-tight truncate mr-4">
          {session?.project?.name || 'Session'}
        </h1>

        {/* Separator */}
        <div className="h-5 w-px bg-border" />

        {/* Terminal Actions */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-8 px-2.5 font-mono text-xs"
            onClick={() => createMutation.mutate({ type: 'claude' })}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Bot className="h-3.5 w-3.5 text-orange-500" />
            )}
            <span className="hidden sm:inline">Claude</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-8 px-2.5 font-mono text-xs"
            onClick={() => createMutation.mutate({ type: 'shell' })}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Plus className="h-3.5 w-3.5" />
            )}
            <span className="hidden sm:inline">Shell</span>
          </Button>
        </div>

        {/* Separator */}
        <div className="h-5 w-px bg-border" />

        {/* Git Toggle */}
        {session?.project && (
          <>
            <Button
              variant={viewMode === 'git' ? 'secondary' : 'ghost'}
              size="sm"
              className="gap-1.5 h-8 px-2.5 font-mono text-xs relative"
              onClick={() => setViewMode(viewMode === 'git' ? 'terminal' : 'git')}
            >
              <GitBranch className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Git</span>
              {changeCount > 0 && (
                <span className="absolute -top-1 -right-1 h-4 min-w-4 px-1 rounded-full bg-yellow-500 text-[10px] font-bold text-black flex items-center justify-center">
                  {changeCount > 99 ? '99+' : changeCount}
                </span>
              )}
            </Button>
            {gitStatus?.branch && (
              <span className="font-mono text-[11px] text-muted-foreground bg-accent/50 px-2 py-0.5 rounded hidden sm:inline-block">
                {gitStatus.branch}
              </span>
            )}
          </>
        )}

        {/* Run Configs Toggle */}
        {session?.project && (
          <Button
            variant={viewMode === 'run' ? 'secondary' : 'ghost'}
            size="sm"
            className="gap-1.5 h-8 px-2.5 font-mono text-xs"
            onClick={() => setViewMode(viewMode === 'run' ? 'terminal' : 'run')}
          >
            <Play className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Run</span>
          </Button>
        )}

        {/* Env Toggle */}
        {session?.project && (
          <Button
            variant={viewMode === 'env' ? 'secondary' : 'ghost'}
            size="sm"
            className="gap-1.5 h-8 px-2.5 font-mono text-xs"
            onClick={() => setViewMode(viewMode === 'env' ? 'terminal' : 'env')}
          >
            <Settings2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Env</span>
          </Button>
        )}

        {/* Docker Toggle */}
        <Button
          variant={viewMode === 'docker' ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5 h-8 px-2.5 font-mono text-xs"
          onClick={() => setViewMode(viewMode === 'docker' ? 'terminal' : 'docker')}
        >
          <Box className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Docker</span>
        </Button>

        {/* Preview Toggle */}
        <Button
          variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
          size="sm"
          className="gap-1.5 h-8 px-2.5 font-mono text-xs"
          onClick={() => {
            if (viewMode === 'preview') {
              setViewMode('terminal');
            } else if (previewId) {
              setViewMode('preview');
            } else {
              setShowPreviewDialog(true);
            }
          }}
        >
          <Monitor className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Preview</span>
        </Button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Sidebar Toggle */}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 hidden md:flex"
          onClick={() => setShowSidebar(!showSidebar)}
          title={showSidebar ? 'Hide sidebar' : 'Show sidebar'}
        >
          {showSidebar ? <PanelRightClose className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
        </Button>
      </div>

      {/* Main Content */}
      <div className="flex flex-1 min-h-0 gap-0">
        {/* Compact Vertical Sidebar - Desktop */}
        {showSidebar && (
          <div className="hidden md:flex flex-col w-12 border-r bg-card/50 shrink-0">
            {/* Claude Terminals */}
            <div className="flex flex-col items-center py-2 gap-1 border-b border-border/50">
              {claudeTerminals.map((terminal) => (
                <TerminalIconButton
                  key={terminal.id}
                  terminal={terminal}
                  isActive={activeTerminalId === terminal.id && viewMode === 'terminal'}
                  onClick={() => {
                    selectTerminal(terminal.id);
                    setViewMode('terminal');
                  }}
                  onClose={() => closeMutation.mutate(terminal.id)}
                />
              ))}
              {claudeTerminals.length === 0 && (
                <div className="w-8 h-8 rounded border border-dashed border-border/50 flex items-center justify-center opacity-30">
                  <Bot className="h-4 w-4" />
                </div>
              )}
            </div>

            {/* Shell Terminals */}
            <div className="flex-1 flex flex-col items-center py-2 gap-1 overflow-y-auto">
              {shellTerminals.map((terminal) => (
                <TerminalIconButton
                  key={terminal.id}
                  terminal={terminal}
                  isActive={activeTerminalId === terminal.id && viewMode === 'terminal'}
                  onClick={() => {
                    selectTerminal(terminal.id);
                    setViewMode('terminal');
                  }}
                  onClose={() => closeMutation.mutate(terminal.id)}
                />
              ))}
            </div>

            {/* Process Terminals */}
            {processTerminals.length > 0 && (
              <div className="flex flex-col items-center py-2 gap-1 border-t border-border/50">
                {processTerminals.map((terminal) => (
                  <TerminalIconButton
                    key={terminal.id}
                    terminal={terminal}
                    isActive={activeTerminalId === terminal.id && viewMode === 'terminal'}
                    onClick={() => {
                      selectTerminal(terminal.id);
                      setViewMode('terminal');
                    }}
                    onClose={() => closeMutation.mutate(terminal.id)}
                  />
                ))}
              </div>
            )}

            {/* Clean up exited terminals */}
            {exitedCount > 0 && (
              <div className="flex flex-col items-center py-2 border-t border-border/50">
                <button
                  onClick={() => cleanupMutation.mutate()}
                  disabled={cleanupMutation.isPending}
                  className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                    'hover:bg-destructive/20 text-muted-foreground hover:text-destructive',
                  )}
                  title={`Remove ${exitedCount} exited terminal${exitedCount !== 1 ? 's' : ''}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Files Button */}
            {session?.project && (
              <div className="flex flex-col items-center py-2 border-t border-border/50">
                <button
                  onClick={() => setViewMode(viewMode === 'files' ? 'terminal' : 'files')}
                  className={cn(
                    'w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                    'hover:bg-accent',
                    viewMode === 'files' && 'bg-primary text-primary-foreground'
                  )}
                  title="File Explorer"
                >
                  <FolderOpen className="h-4 w-4" />
                </button>
              </div>
            )}

            {/* Preview Button */}
            <div className="flex flex-col items-center py-2 border-t border-border/50">
              <button
                onClick={() => {
                  if (viewMode === 'preview') {
                    setViewMode('terminal');
                  } else if (previewId) {
                    setViewMode('preview');
                  } else {
                    setShowPreviewDialog(true);
                  }
                }}
                className={cn(
                  'w-9 h-9 rounded-lg flex items-center justify-center transition-all',
                  'hover:bg-accent',
                  viewMode === 'preview' && 'bg-primary text-primary-foreground'
                )}
                title="Browser Preview"
              >
                <Monitor className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Mobile Terminal Selector - integrated into content area */}
        {/* Content Area */}
        <div className="flex-1 flex flex-col min-w-0 relative">
          {/* Mobile terminal dropdown */}
          <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b bg-card/20 shrink-0">
            <div className="relative flex-1">
              <Button
                variant="outline"
                size="sm"
                className="w-full justify-between h-9 font-mono text-xs"
                onClick={() => setShowTerminalDropdown(!showTerminalDropdown)}
              >
                <span className="flex items-center gap-2 truncate">
                  {activeTerminal ? (
                    <>
                      {activeTerminal.type === 'claude' ? (
                        <Bot className="h-3.5 w-3.5 text-orange-500" />
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
                        'flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-accent',
                        activeTerminalId === terminal.id && 'bg-accent'
                      )}
                      onClick={() => {
                        selectTerminal(terminal.id);
                        setViewMode('terminal');
                        setShowTerminalDropdown(false);
                      }}
                    >
                      {terminal.type === 'claude' ? (
                        <Bot className="h-4 w-4 text-orange-500" />
                      ) : terminal.type === 'process' ? (
                        <Play className="h-4 w-4 text-green-500" />
                      ) : (
                        <TerminalSquare className="h-4 w-4" />
                      )}
                      <span className="flex-1 truncate font-mono text-xs">{terminal.name}</span>
                      <div
                        className={cn(
                          'h-2 w-2 rounded-full',
                          terminal.liveStatus === 'running' ? 'bg-green-500' : 'bg-muted-foreground'
                        )}
                      />
                    </button>
                  ))}
                  {activeTerminals.length === 0 && (
                    <div className="px-3 py-4 text-center text-sm text-muted-foreground">No terminals</div>
                  )}
                  {exitedCount > 0 && (
                    <button
                      className="flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-destructive/10 text-muted-foreground hover:text-destructive border-t"
                      onClick={() => {
                        cleanupMutation.mutate();
                        setShowTerminalDropdown(false);
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                      <span className="font-mono text-xs">Remove {exitedCount} exited</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Main content */}
          <div className="flex-1 min-h-0 px-2 pb-2 md:p-0">
            {viewMode === 'terminal' ? (
              activeTerminal ? (
                <Terminal
                  key={activeTerminal.id}
                  terminalId={activeTerminal.id}
                  className="h-full"
                  onExit={() => {
                    queryClient.invalidateQueries({ queryKey: ['terminals', id] });
                  }}
                  onTitleChanged={() => {
                    queryClient.invalidateQueries({ queryKey: ['terminals', id] });
                  }}
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
                    {
                      type: 'claude',
                      name: 'Review',
                      initialPrompt: message,
                    },
                    {
                      onSuccess: () => {
                        toast({
                          title: 'Claude terminal started',
                          description: 'Review comments are being processed',
                        });
                      },
                      onError: () => {
                        toast({
                          title: 'Failed to create terminal',
                          description: 'Please try again',
                          variant: 'destructive',
                        });
                      },
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
                  setViewMode('terminal');
                }}
              />
            ) : viewMode === 'docker' ? (
              <DockerPanel
                sessionId={id!}
                projectId={session?.project?.id}
                onTerminalCreated={(terminalId) => {
                  queryClient.invalidateQueries({ queryKey: ['terminals', id] });
                  selectTerminal(terminalId);
                  setViewMode('terminal');
                }}
              />
            ) : viewMode === 'env' && session?.project ? (
              <div className="p-4">
                <EnvEditor projectId={session.project.id} />
                {session.project.isMultiProject && session.project.childLinks && (
                  <div className="mt-6 space-y-4">
                    {session.project.childLinks.map((link: any) => (
                      <div key={link.id} className="border rounded-lg p-3">
                        <p className="text-xs font-medium text-muted-foreground mb-2">
                          {link.alias || link.name}
                        </p>
                        <EnvEditor projectId={link.id} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : viewMode === 'preview' && previewId ? (
              <BrowserPreview
                previewId={previewId}
                onStop={async () => {
                  try {
                    await api.stopPreview(previewId);
                  } catch {
                    // Ignore stop errors
                  }
                  setPreviewId(null);
                  setViewMode('terminal');
                }}
                className="h-full"
              />
            ) : (
              <FileExplorer sessionId={id!} project={session?.project} className="h-full" />
            )}
          </div>
        </div>
      </div>

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
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowPreviewDialog(false)}
                >
                  Cancel
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    if (previewUrl.trim()) {
                      startPreviewMutation.mutate(previewUrl.trim());
                    }
                  }}
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

interface TerminalIconButtonProps {
  terminal: {
    id: string;
    name: string;
    type: string;
    liveStatus?: string;
  };
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
}

function TerminalIconButton({ terminal, isActive, onClick, onClose }: TerminalIconButtonProps) {
  const Icon = terminal.type === 'claude' ? Bot : terminal.type === 'process' ? Play : TerminalSquare;

  return (
    <div className="group relative">
      <button
        onClick={onClick}
        className={cn(
          'w-9 h-9 rounded-lg flex items-center justify-center transition-all',
          'hover:bg-accent',
          isActive && 'bg-primary text-primary-foreground'
        )}
        title={terminal.name}
      >
        <Icon
          className={cn(
            'h-4 w-4',
            terminal.type === 'claude' && !isActive && 'text-orange-500',
            terminal.type === 'process' && !isActive && 'text-green-500',
          )}
        />
        {/* Status indicator */}
        <div
          className={cn(
            'absolute bottom-1 right-1 h-1.5 w-1.5 rounded-full',
            terminal.liveStatus === 'running' ? 'bg-green-500' : 'bg-muted-foreground'
          )}
        />
      </button>
      {/* Close button on hover */}
      <button
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className={cn(
          'absolute -top-1 -right-1 h-4 w-4 rounded-full bg-destructive text-destructive-foreground',
          'flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity',
          'hover:scale-110'
        )}
      >
        <X className="h-2.5 w-2.5" />
      </button>
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
          <Bot className="h-10 w-10 text-orange-500" />
          <div className="h-8 w-px bg-border" />
          <TerminalSquare className="h-10 w-10" />
        </div>
      </div>
      <p className="text-sm font-mono mb-4">No terminals running</p>
      <Button variant="outline" size="sm" onClick={onCreateClaude} className="gap-2 font-mono">
        <Bot className="h-4 w-4 text-orange-500" />
        Start Claude
      </Button>
    </div>
  );
}

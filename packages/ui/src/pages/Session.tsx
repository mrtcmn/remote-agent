import { useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Bot,
  TerminalSquare,
  Plus,
  GitBranch,
  RefreshCw,
  ChevronDown,
  FolderOpen,
  Trash2,
  Play,
  Monitor,
  Box,
  Settings2,
  Code2,
  ExternalLink,
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

  const { data: editorStatus } = useQuery({
    queryKey: ['editor-status'],
    queryFn: () => api.editorStatus(),
    staleTime: 60000,
  });

  const openEditorMutation = useMutation({
    mutationFn: (folder: string) => api.openEditor(folder),
    onSuccess: (data) => {
      window.open(data.url, '_blank');
    },
    onError: (error) => {
      toast({
        title: 'Failed to open editor',
        description: (error as Error).message,
        variant: 'destructive',
      });
    },
  });

  const canOpenEditor = !!editorStatus?.configured && !!session?.project?.localPath;

  // Filter out exited terminals
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

  return (
    <div className="flex flex-col h-full">
      {/* Top Toolbar */}
      <div className="flex items-center h-11 border-b bg-card/30 shrink-0">
        {/* Fixed: Back + Title */}
        <div className="flex items-center gap-1 pl-2 md:pl-2 shrink-0">
          <Button variant="ghost" size="icon" onClick={() => navigate('/')} className="shrink-0 h-9 w-9">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="font-mono text-sm font-medium tracking-tight truncate max-w-[120px] sm:max-w-none">
            {session?.project?.name || 'Session'}
          </h1>
        </div>

        {/* Scrollable toolbar area */}
        <div className="flex-1 flex items-center gap-1 px-2 overflow-x-auto mobile-scroll">
          {/* Separator */}
          <div className="h-5 w-px bg-border shrink-0" />

          {/* Group 1: Terminal Actions */}
          <div className="flex items-center gap-0.5 shrink-0 bg-accent/30 rounded-md px-1 py-0.5">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 h-8 px-2 font-mono text-xs shrink-0"
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
              className="gap-1.5 h-8 px-2 font-mono text-xs shrink-0"
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
          <div className="h-5 w-px bg-border shrink-0" />

          {/* Group 2: Git & Branch */}
          {session?.project && (
            <div className="flex items-center gap-0.5 shrink-0 bg-accent/30 rounded-md px-1 py-0.5">
              <Button
                variant={viewMode === 'git' ? 'secondary' : 'ghost'}
                size="sm"
                className="gap-1.5 h-8 px-2 font-mono text-xs relative shrink-0"
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
                <span className="font-mono text-[11px] text-muted-foreground bg-accent/50 px-2 py-0.5 rounded hidden sm:inline-block shrink-0">
                  {gitStatus.branch}
                </span>
              )}
            </div>
          )}

          {/* Separator */}
          <div className="h-5 w-px bg-border shrink-0" />

          {/* Group 3: Views - File, Preview, Code */}
          <div className="flex items-center gap-0.5 shrink-0 bg-accent/30 rounded-md px-1 py-0.5">
            {/* Files */}
            {session?.project && (
              <Button
                variant={viewMode === 'files' ? 'secondary' : 'ghost'}
                size="sm"
                className="gap-1.5 h-8 px-2 font-mono text-xs shrink-0"
                onClick={() => setViewMode(viewMode === 'files' ? 'terminal' : 'files')}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Files</span>
              </Button>
            )}

            {/* Preview */}
            <Button
              variant={viewMode === 'preview' ? 'secondary' : 'ghost'}
              size="sm"
              className="gap-1.5 h-8 px-2 font-mono text-xs shrink-0"
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

            {/* Editor */}
            {canOpenEditor && (
              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 h-8 px-2 font-mono text-xs shrink-0"
                onClick={() => openEditorMutation.mutate(session!.project!.localPath)}
                disabled={openEditorMutation.isPending}
              >
                {openEditorMutation.isPending ? (
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Code2 className="h-3.5 w-3.5" />
                )}
                <span className="hidden sm:inline">Editor</span>
                <ExternalLink className="h-3 w-3 opacity-50" />
              </Button>
            )}
          </div>

          {/* Separator */}
          <div className="h-5 w-px bg-border shrink-0" />

          {/* Group 4: Config & Infra */}
          <div className="flex items-center gap-0.5 shrink-0 bg-accent/30 rounded-md px-1 py-0.5">
            {/* Run Configs */}
            {session?.project && (
              <Button
                variant={viewMode === 'run' ? 'secondary' : 'ghost'}
                size="sm"
                className="gap-1.5 h-8 px-2 font-mono text-xs shrink-0"
                onClick={() => setViewMode(viewMode === 'run' ? 'terminal' : 'run')}
              >
                <Play className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Run</span>
              </Button>
            )}

            {/* Env */}
            {session?.project && (
              <Button
                variant={viewMode === 'env' ? 'secondary' : 'ghost'}
                size="sm"
                className="gap-1.5 h-8 px-2 font-mono text-xs shrink-0"
                onClick={() => setViewMode(viewMode === 'env' ? 'terminal' : 'env')}
              >
                <Settings2 className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Env</span>
              </Button>
            )}

            {/* Docker */}
            <Button
              variant={viewMode === 'docker' ? 'secondary' : 'ghost'}
              size="sm"
              className="gap-1.5 h-8 px-2 font-mono text-xs shrink-0"
              onClick={() => setViewMode(viewMode === 'docker' ? 'terminal' : 'docker')}
            >
              <Box className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Docker</span>
            </Button>
          </div>
        </div>

        {/* Cleanup exited terminals - fixed right */}
        {exitedCount > 0 && (
          <div className="shrink-0 pr-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 h-8 px-2 text-xs text-muted-foreground hover:text-destructive"
              onClick={() => cleanupMutation.mutate()}
              disabled={cleanupMutation.isPending}
              title={`Remove ${exitedCount} exited terminal${exitedCount !== 1 ? 's' : ''}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">{exitedCount}</span>
            </Button>
          </div>
        )}
      </div>

      {/* Main Content - no vertical sidebar, full width */}
      <div className="flex flex-1 min-h-0 gap-0">
        <div className="flex-1 flex flex-col min-w-0 relative">
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
                        'flex items-center gap-2 w-full px-3 py-3 text-left text-sm hover:bg-accent',
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
          <div className="flex-1 min-h-0 px-1 pb-1 md:p-0 safe-area-bottom">
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

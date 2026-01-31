import { useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
} from 'lucide-react';
import { api, type TerminalType } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Terminal } from '@/components/Terminal';
import { GitDiffView } from '@/components/GitDiffView';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toaster';

type ViewMode = 'terminal' | 'git';

export function SessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('terminal');
  const [showSidebar, setShowSidebar] = useState(true);
  const [showTerminalDropdown, setShowTerminalDropdown] = useState(false);

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
    mutationFn: (type: TerminalType = 'shell') => api.createTerminal({ sessionId: id!, type }),
    onSuccess: (terminal) => {
      queryClient.invalidateQueries({ queryKey: ['terminals', id] });
      setActiveTerminalId(terminal.id);
      setViewMode('terminal');
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

  // Auto-select first terminal
  if (!activeTerminalId && terminals.length > 0 && !isLoading) {
    setActiveTerminalId(terminals[0].id);
  }

  const activeTerminal = terminals.find((t) => t.id === activeTerminalId);

  // Count changes for git badge
  const changeCount = useMemo(() => {
    if (!gitStatus) return 0;
    return (gitStatus.modified?.length || 0) + (gitStatus.staged?.length || 0) + (gitStatus.untracked?.length || 0);
  }, [gitStatus]);

  // Group terminals by type
  const claudeTerminals = terminals.filter((t) => t.type === 'claude');
  const shellTerminals = terminals.filter((t) => t.type === 'shell');

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
            onClick={() => createMutation.mutate('claude')}
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
            onClick={() => createMutation.mutate('shell')}
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
        )}

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
                    setActiveTerminalId(terminal.id);
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
                    setActiveTerminalId(terminal.id);
                    setViewMode('terminal');
                  }}
                  onClose={() => closeMutation.mutate(terminal.id)}
                />
              ))}
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
                  {terminals.map((terminal) => (
                    <button
                      key={terminal.id}
                      className={cn(
                        'flex items-center gap-2 w-full px-3 py-2 text-left text-sm hover:bg-accent',
                        activeTerminalId === terminal.id && 'bg-accent'
                      )}
                      onClick={() => {
                        setActiveTerminalId(terminal.id);
                        setViewMode('terminal');
                        setShowTerminalDropdown(false);
                      }}
                    >
                      {terminal.type === 'claude' ? (
                        <Bot className="h-4 w-4 text-orange-500" />
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
                  {terminals.length === 0 && (
                    <div className="px-3 py-4 text-center text-sm text-muted-foreground">No terminals</div>
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
                />
              ) : (
                <EmptyState isLoading={isLoading} onCreateClaude={() => createMutation.mutate('claude')} />
              )
            ) : (
              <GitDiffView
                sessionId={id!}
                onProceed={(message) => {
                  navigator.clipboard.writeText(message).then(
                    () => {
                      toast({
                        title: 'Review message copied',
                        description: 'Paste into Claude terminal to proceed',
                      });
                    },
                    () => {
                      toast({
                        title: 'Failed to copy',
                        description: 'Please try again',
                        variant: 'destructive',
                      });
                    }
                  );
                }}
              />
            )}
          </div>
        </div>
      </div>
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
  const Icon = terminal.type === 'claude' ? Bot : TerminalSquare;

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
          className={cn('h-4 w-4', terminal.type === 'claude' && !isActive && 'text-orange-500')}
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

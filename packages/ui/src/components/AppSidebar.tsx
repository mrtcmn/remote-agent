import { useMemo } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  FolderGit2,
  Plus,
  LayoutGrid,
  Settings,
  Loader2,
  X,
  Sparkles,
  Bot,
  TerminalSquare,
  Play,
  GitBranch,
  LogOut,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { NewSessionModal } from '@/components/NewSessionModal';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/Avatar';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type { SidebarData, TerminalInfo } from '@/lib/api';
import { useState } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  image?: string;
  hasPin: boolean;
}

interface AppSidebarProps {
  data: SidebarData | undefined;
  isLoading: boolean;
  user: User | null;
  onLogout: () => void;
  onClose?: () => void;
}

export function AppSidebar({ data, isLoading, user, onLogout, onClose }: AppSidebarProps) {
  const location = useLocation();
  const params = useParams<{ id?: string }>();
  const currentSessionId = params.id;

  // Get the current session's project info
  const currentProject = useMemo(() => {
    if (!data || !currentSessionId) return null;
    for (const project of data.projects) {
      for (const session of project.sessions) {
        if (session.id === currentSessionId) {
          return { project, session };
        }
      }
    }
    return null;
  }, [data, currentSessionId]);

  // Fetch terminals for the current session
  const { data: terminals = [] } = useQuery({
    queryKey: ['terminals', currentSessionId],
    queryFn: () => api.getSessionTerminals(currentSessionId!),
    refetchInterval: 5000,
    enabled: !!currentSessionId,
  });

  // Fetch git status for branch name
  const { data: gitStatus } = useQuery({
    queryKey: ['session-git-status', currentSessionId],
    queryFn: () => api.getSessionGitStatus(currentSessionId!),
    refetchInterval: 5000,
    enabled: !!currentSessionId && !!currentProject,
  });

  const activeTerminals = terminals.filter(
    (t) => (t.liveStatus || t.status) === 'running'
  );
  const claudeTerminals = activeTerminals.filter((t) => t.type === 'claude');
  const shellTerminals = activeTerminals.filter((t) => t.type === 'shell');
  const processTerminals = activeTerminals.filter((t) => t.type === 'process');

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Logo section */}
      <div className="px-3 py-3 border-b border-sidebar-border flex items-center justify-between">
        <Link to="/" className="flex items-center gap-2" onClick={onClose}>
          <img src="/logo.svg" alt="Remote Agent" className="h-7 w-7" />
          <span className="font-semibold text-sm">Remote Agent</span>
        </Link>
        {onClose && (
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden h-9 w-9 shrink-0"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* Scrollable content area */}
      <div className="flex-1 overflow-y-auto py-2">
        {currentSessionId ? (
          /* Session context: show project/branch + terminals */
          <>
            {/* Project & Branch info */}
            {currentProject && (
              <div className="px-3 py-2 border-b border-sidebar-border/50 mb-2">
                <div className="flex items-center gap-2 mb-1">
                  <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-medium truncate">
                    {currentProject.project.name}
                  </span>
                </div>
                {gitStatus?.branch && (
                  <div className="flex items-center gap-1.5 ml-5.5">
                    <GitBranch className="h-3 w-3 text-primary/70" />
                    <span className="text-[11px] font-mono text-primary/70 truncate">
                      {gitStatus.branch}
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Terminal listings */}
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : activeTerminals.length === 0 ? (
              <div className="px-3 py-6 text-center">
                <p className="text-xs text-muted-foreground">No running terminals</p>
              </div>
            ) : (
              <>
                {/* Claude Code Terminals */}
                {claudeTerminals.length > 0 && (
                  <TerminalGroup
                    label="Claude Code"
                    terminals={claudeTerminals}
                    icon={<Bot className="h-3 w-3" />}
                    sessionId={currentSessionId}
                  />
                )}

                {/* Shell Terminals */}
                {shellTerminals.length > 0 && (
                  <TerminalGroup
                    label="Shells"
                    terminals={shellTerminals}
                    icon={<TerminalSquare className="h-3 w-3" />}
                    sessionId={currentSessionId}
                  />
                )}

                {/* Process Terminals */}
                {processTerminals.length > 0 && (
                  <TerminalGroup
                    label="Processes"
                    terminals={processTerminals}
                    icon={<Play className="h-3 w-3" />}
                    sessionId={currentSessionId}
                  />
                )}
              </>
            )}
          </>
        ) : (
          /* Dashboard context: show quick info */
          <div className="px-3 py-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="space-y-1">
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
                  Projects
                </div>
                {data?.projects.map((project) => (
                  <div
                    key={project.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-sidebar-foreground/80"
                  >
                    <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="truncate">{project.name}</span>
                    {project.sessions.length > 0 && (
                      <span className="ml-auto text-[10px] text-muted-foreground bg-sidebar-accent px-1.5 py-0.5 rounded-full">
                        {project.sessions.length}
                      </span>
                    )}
                  </div>
                ))}
                {(!data?.projects || data.projects.length === 0) && (
                  <p className="text-xs text-muted-foreground text-center py-4">No projects yet</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Bottom actions */}
      <div className="border-t border-sidebar-border p-2 space-y-0.5">
        <NewSessionButton onCreated={onClose} />
        <Link to="/kanban" onClick={onClose}>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'w-full justify-start gap-2 h-8 text-sidebar-foreground hover:bg-sidebar-accent',
              location.pathname === '/kanban' && 'bg-sidebar-accent'
            )}
          >
            <LayoutGrid className="h-4 w-4" />
            Kanban
          </Button>
        </Link>
        <Link to="/projects" onClick={onClose}>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'w-full justify-start gap-2 h-8 text-sidebar-foreground hover:bg-sidebar-accent',
              location.pathname === '/projects' && 'bg-sidebar-accent'
            )}
          >
            <FolderGit2 className="h-4 w-4" />
            Projects
          </Button>
        </Link>
        <Link to="/skills" onClick={onClose}>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'w-full justify-start gap-2 h-8 text-sidebar-foreground hover:bg-sidebar-accent',
              location.pathname === '/skills' && 'bg-sidebar-accent'
            )}
          >
            <Sparkles className="h-4 w-4" />
            Skills
          </Button>
        </Link>
        <Link to="/settings" onClick={onClose}>
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'w-full justify-start gap-2 h-8 text-sidebar-foreground hover:bg-sidebar-accent',
              location.pathname === '/settings' && 'bg-sidebar-accent'
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Button>
        </Link>
      </div>

      {/* User avatar - last item */}
      {user && (
        <div className="border-t border-sidebar-border px-3 py-2.5 flex items-center gap-2">
          <Avatar className="h-7 w-7 shrink-0">
            <AvatarImage src={user.image} alt={user.name} />
            <AvatarFallback className="text-xs bg-sidebar-accent">
              {user.name?.charAt(0).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate text-sidebar-foreground">{user.name}</p>
            <p className="text-[10px] text-muted-foreground truncate">{user.email}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onLogout}
            className="h-7 w-7 shrink-0 text-muted-foreground hover:text-sidebar-foreground"
          >
            <LogOut className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );
}

/* ── Terminal Group ── */

function TerminalGroup({
  label,
  terminals,
  icon,
  sessionId,
}: {
  label: string;
  terminals: TerminalInfo[];
  icon: React.ReactNode;
  sessionId: string;
}) {
  const params = useParams<{ terminalId?: string }>();

  return (
    <div className="mb-1">
      <div className="flex items-center gap-1.5 px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
        {icon}
        {label}
        <span className="ml-auto text-[10px] opacity-60">{terminals.length}</span>
      </div>
      <div className="px-1">
        {terminals.map((terminal) => {
          const isActive = params.terminalId === terminal.id;
          return (
            <Link
              key={terminal.id}
              to={`/sessions/${sessionId}/${terminal.id}`}
              className={cn(
                'flex items-center gap-2 w-full px-3 py-1.5 rounded-sm transition-colors',
                'hover:bg-sidebar-accent',
                isActive && 'bg-primary/15 border-l-2 border-primary'
              )}
            >
              <div
                className={cn(
                  'h-1.5 w-1.5 rounded-full shrink-0',
                  terminal.liveStatus === 'running' ? 'bg-green-500' : 'bg-muted-foreground'
                )}
              />
              <span className="text-xs font-mono truncate text-sidebar-foreground">
                {terminal.name}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ── New Session Button ── */

function NewSessionButton({ onCreated }: { onCreated?: () => void }) {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 h-8 text-sidebar-foreground hover:bg-sidebar-accent"
        onClick={() => setModalOpen(true)}
      >
        <Plus className="h-4 w-4" />
        New Session
      </Button>
      <NewSessionModal open={modalOpen} onClose={() => { setModalOpen(false); onCreated?.(); }} />
    </>
  );
}

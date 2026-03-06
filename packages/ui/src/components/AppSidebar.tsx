import { useMemo, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  FolderGit2,
  ChevronRight,
  Plus,
  LayoutGrid,
  Settings,
  Layers,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { SessionRow } from '@/components/SessionRow';
import { NewSessionModal } from '@/components/NewSessionModal';
import { cn } from '@/lib/utils';
import type { SidebarData, SidebarProject, SidebarSession } from '@/lib/api';

const ACTIVE_STATUSES = new Set(['active', 'waiting_input', 'paused']);

function isActiveSession(session: SidebarSession): boolean {
  // Use liveStatus (which accounts for stale sessions) over stored status
  const effectiveStatus = session.liveStatus || session.status;
  return ACTIVE_STATUSES.has(effectiveStatus);
}

interface AppSidebarProps {
  data: SidebarData | undefined;
  isLoading: boolean;
}

export function AppSidebar({ data, isLoading }: AppSidebarProps) {
  const location = useLocation();

  // Filter projects and sessions to only show non-terminated (active) sessions
  const { activeProjects, activeUnassigned, hasAnySessions } = useMemo(() => {
    if (!data) return { activeProjects: [], activeUnassigned: [], hasAnySessions: false };

    const filteredProjects = data.projects
      .map((project) => ({
        ...project,
        sessions: project.sessions.filter(isActiveSession),
      }))
      .filter((project) => project.sessions.length > 0);

    const filteredUnassigned = data.unassignedSessions.filter(isActiveSession);

    return {
      activeProjects: filteredProjects,
      activeUnassigned: filteredUnassigned,
      hasAnySessions: filteredProjects.length > 0 || filteredUnassigned.length > 0,
    };
  }, [data]);

  return (
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Logo section */}
      <div className="px-3 py-3 border-b border-sidebar-border">
        <Link to="/" className="flex items-center gap-2">
          <img src="/logo.svg" alt="Remote Agent" className="h-7 w-7" />
          <span className="font-semibold text-sm">Remote Agent</span>
        </Link>
      </div>

      {/* Scrollable project tree */}
      <div className="flex-1 overflow-y-auto py-2">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : !hasAnySessions ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-muted-foreground">No active sessions</p>
          </div>
        ) : (
          <>
            {/* Active Sessions label */}
            <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Active Sessions
            </div>

            {activeProjects.map((project) => (
              <ProjectGroup key={project.id} project={project} />
            ))}

            {/* Unassigned sessions (filtered to active only) */}
            {activeUnassigned.length > 0 && (
              <div className="mt-2">
                <div className="px-3 py-1 text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                  Unassigned
                </div>
                <div className="px-1">
                  {activeUnassigned.map((session) => (
                    <SessionRow key={session.id} session={session} />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom actions */}
      <div className="border-t border-sidebar-border p-2 space-y-0.5">
        <NewSessionButton />
        <Link to="/kanban">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent',
              location.pathname === '/kanban' && 'bg-sidebar-accent'
            )}
          >
            <LayoutGrid className="h-4 w-4" />
            Kanban
          </Button>
        </Link>
        <Link to="/projects">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent',
              location.pathname === '/projects' && 'bg-sidebar-accent'
            )}
          >
            <FolderGit2 className="h-4 w-4" />
            Projects
          </Button>
        </Link>
        <Link to="/settings">
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              'w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent',
              location.pathname === '/settings' && 'bg-sidebar-accent'
            )}
          >
            <Settings className="h-4 w-4" />
            Settings
          </Button>
        </Link>
      </div>
    </div>
  );
}

function ProjectGroup({ project }: { project: SidebarProject }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="mb-1">
      {/* Project header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 hover:bg-sidebar-accent transition-colors text-left"
      >
        <ChevronRight
          className={cn(
            'h-3 w-3 text-muted-foreground transition-transform shrink-0',
            expanded && 'rotate-90'
          )}
        />
        <FolderGit2 className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium truncate flex-1">{project.name}</span>
        {project.isMultiProject && (
          <Layers className="h-3 w-3 text-primary/60 shrink-0" />
        )}
        {project.sessions.length > 0 && (
          <span className="text-[10px] text-muted-foreground shrink-0">
            {project.sessions.length}
          </span>
        )}
      </button>

      {/* Sessions (pre-filtered to active only) */}
      {expanded && (
        <div className="pl-2">
          {project.sessions.map((session) => (
            <SessionRow key={session.id} session={session} />
          ))}
        </div>
      )}
    </div>
  );
}

function NewSessionButton() {
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="w-full justify-start gap-2 text-sidebar-foreground hover:bg-sidebar-accent"
        onClick={() => setModalOpen(true)}
      >
        <Plus className="h-4 w-4" />
        New Session
      </Button>
      <NewSessionModal open={modalOpen} onClose={() => setModalOpen(false)} />
    </>
  );
}

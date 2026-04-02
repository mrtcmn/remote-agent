import { useCallback, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import {
  Layers,
  Plus,
  ChevronDown,
  LayoutGrid,
  ListTodo,
  Settings,
  Sparkles,
  Plug,
  FolderGit2,
  Loader2,
  X,
  GripVertical,
  GitBranch,
  Bot,
  TerminalSquare,
  Container,
  Code,
  Play,
} from 'lucide-react';
import { NewSessionModal } from '@/components/NewSessionModal';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import type { SidebarData, SidebarProject, SidebarSession, SessionService } from '@/lib/api';

const ACTIVE_STATUSES = new Set(['active', 'waiting_input', 'paused']);

function isActiveSession(session: SidebarSession): boolean {
  const effectiveStatus = session.liveStatus || session.status;
  return ACTIVE_STATUSES.has(effectiveStatus);
}

const PALETTE = ['#3b82f6', '#f59e0b', '#10b981', '#a78bfa', '#f472b6', '#fb923c', '#34d399'];
function projectColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ─── Status colors ───────────────────────────────────────────────────────────

const statusDotClass: Record<string, string> = {
  active: 'bg-blue-500',
  waiting_input: 'bg-orange-500 animate-pulse',
  paused: 'bg-gray-500',
  terminated: 'bg-red-500',
};

// ─── Service config ─────────────────────────────────────────────────────────

const serviceConfig: Record<string, { dot: string; icon: typeof Bot }> = {
  claude: { dot: 'bg-blue-500', icon: Bot },
  shell: { dot: 'bg-emerald-500', icon: TerminalSquare },
  process: { dot: 'bg-purple-500', icon: Play },
  docker: { dot: 'bg-cyan-500', icon: Container },
  codeServer: { dot: 'bg-emerald-500', icon: Code },
};

// ─── DiffStat ────────────────────────────────────────────────────────────────

function DiffStat({ additions, deletions }: { additions: number; deletions: number }) {
  if (additions === 0 && deletions === 0) return null;
  return (
    <span className="flex flex-col items-end gap-px font-mono text-[9px] leading-none shrink-0 tabular-nums">
      {additions > 0 && <span className="text-emerald-400">+{additions}</span>}
      {deletions > 0 && <span className="text-red-400">-{deletions}</span>}
    </span>
  );
}

// ─── ServiceRow ─────────────────────────────────────────────────────────────

function ServiceRow({
  sessionId,
  service,
  onNavigate,
}: {
  sessionId: string;
  service: SessionService;
  onNavigate: (path: string) => void;
}) {
  const config = serviceConfig[service.type] || serviceConfig.shell;
  const Icon = config.icon;

  const handleClick = () => {
    if (service.type === 'codeServer' && service.url) {
      window.open(service.url, '_blank');
    } else if (service.type === 'docker') {
      onNavigate(`/sessions/${sessionId}`);
    } else {
      onNavigate(`/sessions/${sessionId}/${service.id}`);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-center gap-1.5 pl-7 pr-2 py-0.5 rounded text-left text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', config.dot)} />
      <Icon className="size-2.5 shrink-0" />
      <span className="text-[10px] truncate">{service.label}</span>
    </button>
  );
}

// ─── SessionRow ──────────────────────────────────────────────────────────────

function SessionRow({
  session,
  isSelected,
  onSelect,
}: {
  session: SidebarSession;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const effectiveStatus = session.liveStatus || session.status;
  const dotClass = statusDotClass[effectiveStatus] || 'bg-gray-500';
  const Icon = session.sessionType === 'worktree' ? Layers : GitBranch;

  return (
    <motion.button
      layout
      onClick={onSelect}
      whileTap={{ scale: 0.98 }}
      transition={{ duration: 0.12 }}
      className={cn(
        'group/session w-full flex items-start gap-2 pl-3 pr-2 py-1.5 rounded-md text-left relative',
        isSelected
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
      )}
    >
      <AnimatePresence>
        {isSelected && (
          <motion.span
            layoutId="session-indicator"
            className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-foreground/30"
            initial={{ opacity: 0, scaleY: 0.5 }}
            animate={{ opacity: 1, scaleY: 1 }}
            exit={{ opacity: 0, scaleY: 0.5 }}
            transition={{ type: 'spring', stiffness: 500, damping: 40 }}
          />
        )}
      </AnimatePresence>

      <div className="relative mt-0.5 shrink-0">
        <Icon
          className={cn(
            'transition-colors',
            session.sessionType === 'worktree' ? 'size-2.5' : 'size-3',
            isSelected ? 'text-foreground/60' : 'text-muted-foreground/40 group-hover/session:text-muted-foreground'
          )}
        />
        <span className={cn('absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full', dotClass)} />
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-1.5">
          <span className="text-xs font-medium truncate leading-snug">
            {session.worktreeName || session.branchName || session.id.slice(0, 8)}
          </span>
          {session.diffStats && (
            <DiffStat additions={session.diffStats.additions} deletions={session.diffStats.deletions} />
          )}
        </div>
        <span className="block text-[10px] leading-snug font-mono truncate text-muted-foreground/50 mt-0.5">
          {session.branchName || session.id.slice(0, 8)}
        </span>
      </div>
    </motion.button>
  );
}

// ─── ProjectGroup ────────────────────────────────────────────────────────────

function ProjectGroup({
  project,
  activeSessionId,
  onSelectSession,
  onAdd,
  onNavigate,
  onDragStart,
  onDragOver,
  onDrop,
  isDragOver,
}: {
  project: SidebarProject;
  activeSessionId: string | null;
  onSelectSession: (id: string) => void;
  onAdd: () => void;
  onNavigate: (path: string) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
  isDragOver: boolean;
}) {
  const [expanded, setExpanded] = useState(true);
  const color = projectColor(project.id);
  const initial = project.name.charAt(0).toUpperCase();

  return (
    <div
      className={cn('space-y-0.5 rounded-md transition-colors', isDragOver && 'bg-secondary/60')}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div
        role="button"
        onClick={() => setExpanded((v) => !v)}
        className="group/ws flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-secondary cursor-pointer select-none"
      >
        <span
          draggable
          onDragStart={onDragStart}
          onClick={(e) => e.stopPropagation()}
          className="flex items-center shrink-0 cursor-grab active:cursor-grabbing opacity-0 group-hover/ws:opacity-100 transition-opacity"
        >
          <GripVertical className="size-3 text-muted-foreground/40" />
        </span>
        <span
          className="size-4 rounded flex items-center justify-center text-[9px] font-bold leading-none shrink-0"
          style={{ backgroundColor: color + '33', border: `1px solid ${color}44`, color }}
        >
          {initial}
        </span>
        <span className="flex-1 text-xs font-medium text-muted-foreground group-hover/ws:text-foreground truncate transition-colors">
          {project.name}
        </span>
        {project.isMultiProject && (
          <Layers className="size-2.5 text-muted-foreground/40 shrink-0" />
        )}
        <span className="text-[10px] text-muted-foreground/40 font-mono shrink-0">
          ({project.sessions.length})
        </span>
        <button
          className="opacity-0 group-hover/ws:opacity-100 transition-opacity p-0.5 rounded hover:bg-border text-muted-foreground/50 hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            onAdd();
          }}
        >
          <Plus className="size-2.5" />
        </button>
        <motion.span
          animate={{ rotate: expanded ? 0 : -90 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          className="flex items-center shrink-0"
        >
          <ChevronDown className="size-2.5 text-muted-foreground/30" />
        </motion.span>
      </div>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <motion.div
              className="space-y-0.5"
              initial="hidden"
              animate="visible"
              variants={{
                hidden: {},
                visible: {
                  transition: { staggerChildren: 0.03, delayChildren: 0.04 },
                },
              }}
            >
              {project.sessions.map((session) => (
                <motion.div
                  key={session.id}
                  variants={{
                    hidden: { opacity: 0, y: -3 },
                    visible: { opacity: 1, y: 0 },
                  }}
                  transition={{ duration: 0.15, ease: 'easeOut' }}
                >
                  <SessionRow
                    session={session}
                    isSelected={session.id === activeSessionId}
                    onSelect={() => onSelectSession(session.id)}
                  />
                  {session.services?.length > 0 && (
                    <div className="space-y-px">
                      {session.services.map((service) => (
                        <ServiceRow
                          key={service.id}
                          sessionId={session.id}
                          service={service}
                          onNavigate={onNavigate}
                        />
                      ))}
                    </div>
                  )}
                </motion.div>
              ))}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

interface AppSidebarProps {
  data: SidebarData | undefined;
  isLoading: boolean;
  onClose?: () => void;
}

export function AppSidebar({ data, isLoading, onClose }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useParams();
  const [newSessionModalOpen, setNewSessionModalOpen] = useState(false);
  const [newSessionProjectId, setNewSessionProjectId] = useState<string | null>(null);
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dragOverProjectId, setDragOverProjectId] = useState<string | null>(null);
  const [localProjectOrder, setLocalProjectOrder] = useState<string[] | null>(null);

  const activeSessionId = params.id || null;
  const activeTab = location.pathname === '/kanban' ? 'tasks' : 'workspaces';

  const { activeProjects, activeUnassigned } = useMemo(() => {
    if (!data) return { activeProjects: [], activeUnassigned: [] };

    const filteredProjects = data.projects
      .map((project) => ({
        ...project,
        sessions: project.sessions.filter(isActiveSession),
      }))
      .filter((project) => project.sessions.length > 0);

    // Apply local drag order if set
    const ordered = localProjectOrder
      ? [...filteredProjects].sort((a, b) => {
          const ai = localProjectOrder.indexOf(a.id);
          const bi = localProjectOrder.indexOf(b.id);
          return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
        })
      : filteredProjects;

    const filteredUnassigned = data.unassignedSessions.filter(isActiveSession);

    return {
      activeProjects: ordered,
      activeUnassigned: filteredUnassigned,
    };
  }, [data, localProjectOrder]);

  const handleNavigate = useCallback((path: string) => {
    navigate(path);
    onClose?.();
  }, [navigate, onClose]);

  const handleProjectAdd = (projectId: string) => {
    setNewSessionProjectId(projectId);
    setNewSessionModalOpen(true);
  };

  const handleSelectSession = (sessionId: string) => {
    navigate(`/sessions/${sessionId}`);
    onClose?.();
  };

  const handleProjectDragStart = useCallback((e: React.DragEvent, projectId: string) => {
    setDraggedProjectId(projectId);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', projectId);
    if (e.currentTarget instanceof HTMLElement) {
      e.currentTarget.style.opacity = '0.5';
    }
  }, []);

  const handleProjectDragOver = useCallback((e: React.DragEvent, projectId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedProjectId && draggedProjectId !== projectId) {
      setDragOverProjectId(projectId);
    }
  }, [draggedProjectId]);

  const handleProjectDrop = useCallback((e: React.DragEvent, targetProjectId: string) => {
    e.preventDefault();
    setDragOverProjectId(null);

    if (!draggedProjectId || draggedProjectId === targetProjectId) return;

    // Compute new order
    const currentOrder = activeProjects.map((p) => p.id);
    const fromIndex = currentOrder.indexOf(draggedProjectId);
    const toIndex = currentOrder.indexOf(targetProjectId);
    if (fromIndex === -1 || toIndex === -1) return;

    const newOrder = [...currentOrder];
    newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, draggedProjectId);

    setLocalProjectOrder(newOrder);
    setDraggedProjectId(null);

    // Include all project IDs (not just active ones) preserving relative order for non-visible ones
    const allProjectIds = data?.projects.map((p) => p.id) || [];
    const fullOrder = [...newOrder];
    for (const id of allProjectIds) {
      if (!fullOrder.includes(id)) fullOrder.push(id);
    }
    api.reorderProjects(fullOrder).catch(() => setLocalProjectOrder(null));
  }, [draggedProjectId, activeProjects, data]);

  return (
    <div className="flex flex-col h-full bg-card text-foreground">
      {/* Electron: traffic light spacer + drag region */}
      <div className="hidden electron-titlebar h-[38px] shrink-0 app-drag" />
      {/* Top nav tabs with sliding pill */}
      <div className="flex items-center gap-0.5 px-2 pt-3 pb-2 shrink-0">
        {(['workspaces', 'tasks'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => {
              if (tab === 'tasks') {
                navigate('/kanban');
              } else {
                navigate('/');
              }
              onClose?.();
            }}
            className={cn(
              'relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium capitalize transition-colors duration-150',
              activeTab === tab
                ? 'text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
            )}
          >
            {activeTab === tab && (
              <motion.span
                layoutId="sidebar-tab-pill"
                className="absolute inset-0 rounded-md bg-secondary"
                transition={{ type: 'spring', stiffness: 400, damping: 35 }}
              />
            )}
            <span className="relative z-10 flex items-center gap-1.5">
              {tab === 'workspaces' ? <img src="/logo.png" alt="" className="size-3.5 rounded-sm" /> : <ListTodo className="size-3.5" />}
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </span>
          </button>
        ))}

        {onClose && (
          <button
            onClick={onClose}
            className="ml-auto md:hidden p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* New Session button */}
      <div className="px-2 pb-2 shrink-0">
        <motion.button
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.12 }}
          onClick={() => setNewSessionModalOpen(true)}
          className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Plus className="size-3.5" />
            New Session
          </span>
        </motion.button>
      </div>

      <div className="h-px bg-border mb-2 shrink-0" />

      {/* Project list */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : activeProjects.length === 0 && activeUnassigned.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-muted-foreground">No active sessions</p>
          </div>
        ) : (
          <div className="py-1">
            {activeProjects.map((project, i) => (
              <div key={project.id}>
                {i > 0 && <div className="h-px bg-border my-1" />}
                <div className="px-1">
                  <ProjectGroup
                    project={project}
                    activeSessionId={activeSessionId}
                    onSelectSession={handleSelectSession}
                    onAdd={() => handleProjectAdd(project.id)}
                    onNavigate={handleNavigate}
                    onDragStart={(e) => handleProjectDragStart(e, project.id)}
                    onDragOver={(e) => handleProjectDragOver(e, project.id)}
                    onDrop={(e) => handleProjectDrop(e, project.id)}
                    isDragOver={dragOverProjectId === project.id}
                  />
                </div>
              </div>
            ))}

            {activeUnassigned.length > 0 && (
              <>
                {activeProjects.length > 0 && <div className="h-px bg-border my-1" />}
                <div className="px-1">
                  <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-muted-foreground/40 font-medium">
                    Unassigned
                  </div>
                  <div className="space-y-0.5">
                    {activeUnassigned.map((session) => (
                      <div key={session.id}>
                        <SessionRow
                          session={session}
                          isSelected={session.id === activeSessionId}
                          onSelect={() => handleSelectSession(session.id)}
                        />
                        {session.services?.length > 0 && (
                          <div className="space-y-px">
                            {session.services.map((service) => (
                              <ServiceRow
                                key={service.id}
                                sessionId={session.id}
                                service={service}
                                onNavigate={handleNavigate}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div className="shrink-0 border-t border-border">
        {[
          { to: '/kanban', icon: LayoutGrid, label: 'Kanban' },
          { to: '/projects', icon: FolderGit2, label: 'Projects' },
          { to: '/skills', icon: Sparkles, label: 'Skills' },
          { to: '/mcp-servers', icon: Plug, label: 'MCP Servers' },
          { to: '/settings', icon: Settings, label: 'Settings' },
        ].map((item) => (
          <Link key={item.to} to={item.to} onClick={onClose}>
            <motion.button
              whileTap={{ scale: 0.99 }}
              transition={{ duration: 0.12 }}
              className={cn(
                'w-full flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors',
                location.pathname === item.to && 'text-foreground bg-secondary'
              )}
            >
              <item.icon className="size-3.5" />
              {item.label}
            </motion.button>
          </Link>
        ))}
      </div>

      <NewSessionModal
        open={newSessionModalOpen}
        onClose={() => {
          setNewSessionModalOpen(false);
          setNewSessionProjectId(null);
        }}
        preselectedProjectId={newSessionProjectId}
      />
    </div>
  );
}

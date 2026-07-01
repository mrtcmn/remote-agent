import { useCallback, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
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
  GitBranch,
  Bot,
  TerminalSquare,
  Container,
  Code,
  Play,
  Laptop,
  Server,
} from 'lucide-react';
import { NewSessionModal } from '@/components/NewSessionModal';
import { AIModelIcon, detectAIModel } from '@/components/AIModelIcon';
import { cn } from '@/lib/utils';
import type { SidebarSession, SessionService, AggregatedSidebar, MachineSidebar } from '@/lib/api';
import { flattenSidebarSessions, type FlatSession } from '@/lib/sidebar-sessions';
import { sessionPath, sessionIdFromPath } from '@/lib/session-route';
import { useActiveMachine } from '@/lib/active-machine';

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
      {additions > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>}
      {deletions > 0 && <span className="text-red-600 dark:text-red-400">-{deletions}</span>}
    </span>
  );
}

// ─── ServiceRow ─────────────────────────────────────────────────────────────

function ServiceRow({
  sessionId,
  machineId,
  service,
  onNavigate,
}: {
  sessionId: string;
  machineId: string;
  service: SessionService;
  onNavigate: (path: string) => void;
}) {
  const config = serviceConfig[service.type] || serviceConfig.shell;
  const Icon = config.icon;
  // Claude terminals use the brand AI icon resolved from the terminal title —
  // same `detectAIModel(name)` mechanism the top tab bar uses, so a Codex /
  // Gemini / OpenAI session shows the right brand instead of a generic bot.
  const isAi = service.type === 'claude';

  const handleClick = () => {
    if (service.type === 'codeServer' && service.url) {
      window.open(service.url, '_blank');
    } else if (service.type === 'docker') {
      onNavigate(sessionPath(machineId, sessionId));
    } else {
      onNavigate(sessionPath(machineId, sessionId, service.id));
    }
  };

  return (
    <button
      onClick={handleClick}
      className="w-full flex items-center gap-1.5 pl-7 pr-2 py-0.5 rounded text-left text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/50 transition-colors"
      title={service.label}
    >
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', config.dot)} />
      {isAi ? (
        <AIModelIcon model={detectAIModel(service.label)} size={10} className="shrink-0" />
      ) : (
        <Icon className="size-2.5 shrink-0" />
      )}
      <span className="text-[12px] font-semibold truncate">{service.label}</span>
    </button>
  );
}

// ─── SessionRow ──────────────────────────────────────────────────────────────

function SessionRow({
  session,
  isSelected,
  onSelect,
  projectName,
  projectColor,
}: {
  session: SidebarSession;
  isSelected: boolean;
  onSelect: () => void;
  projectName?: string | null;
  projectColor?: string | null;
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
          <span className="flex items-center gap-1 min-w-0 text-xs font-medium leading-snug">
            {projectName && projectColor && (
              <>
                <span
                  className="size-3.5 rounded inline-flex items-center justify-center text-[8px] font-bold leading-none shrink-0"
                  style={{ backgroundColor: projectColor + '33', border: `1px solid ${projectColor}44`, color: projectColor }}
                  title={projectName}
                >
                  {projectName.charAt(0).toUpperCase()}
                </span>
                <span className="shrink-0 max-w-[64px] truncate text-muted-foreground/70">{projectName}</span>
                <span className="text-muted-foreground/30 shrink-0">·</span>
              </>
            )}
            <span className="truncate">
              {session.worktreeName || session.branchName || session.id.slice(0, 8)}
            </span>
          </span>
          {session.diffStats && (
            <DiffStat additions={session.diffStats.additions} deletions={session.diffStats.deletions} />
          )}
        </div>
      </div>
    </motion.button>
  );
}

// ─── SessionEntry (row + its service sub-rows) ────────────────────────────────

function SessionEntry({
  session,
  machineId,
  projectName,
  projectColor,
  isSelected,
  onSelect,
  onNavigate,
}: {
  session: SidebarSession;
  machineId: string;
  projectName?: string | null;
  projectColor?: string | null;
  isSelected: boolean;
  onSelect: () => void;
  onNavigate: (path: string) => void;
}) {
  return (
    <div>
      <SessionRow
        session={session}
        projectName={projectName}
        projectColor={projectColor}
        isSelected={isSelected}
        onSelect={onSelect}
      />
      {session.services?.length > 0 && (
        <div className="space-y-px">
          {session.services.map((service) => (
            <ServiceRow key={service.id} sessionId={session.id} machineId={machineId} service={service} onNavigate={onNavigate} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── MachineSection (one machine's sessions, collapsible) ─────────────────────

function MachineSection({
  machine,
  activeSessionId,
  onSelectSession,
  onNavigate,
}: {
  machine: MachineSidebar;
  activeSessionId: string | null;
  onSelectSession: (sessionId: string, machine: MachineSidebar) => void;
  onNavigate: (path: string) => void;
}) {
  const isSelf = machine.machineId === 'self';
  const [expanded, setExpanded] = useState(machine.online);
  const [showInactive, setShowInactive] = useState(false);
  const { active, inactive } = useMemo(() => flattenSidebarSessions(machine.data), [machine.data]);

  const renderEntry = (session: FlatSession) => (
    <SessionEntry
      key={session.id}
      session={session}
      machineId={machine.machineId}
      projectName={session.projectName}
      projectColor={session.projectId ? projectColor(session.projectId) : null}
      isSelected={session.id === activeSessionId}
      onSelect={() => onSelectSession(session.id, machine)}
      onNavigate={onNavigate}
    />
  );

  return (
    <div className="px-1">
      <div
        role="button"
        onClick={() => setExpanded((v) => !v)}
        className="group/ms flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-secondary cursor-pointer select-none"
      >
        {isSelf ? (
          <Laptop className="size-3.5 text-muted-foreground shrink-0" />
        ) : (
          <Server className="size-3.5 text-muted-foreground shrink-0" />
        )}
        <span className="flex-1 text-xs font-medium text-muted-foreground group-hover/ms:text-foreground truncate transition-colors">
          {machine.machineName}
        </span>
        <span
          className={cn('w-1.5 h-1.5 rounded-full shrink-0', machine.online ? 'bg-emerald-500' : 'bg-muted-foreground/40')}
          title={machine.online ? 'online' : machine.error || 'offline'}
        />
        {machine.online && (
          <span className="text-[12px] font-semibold text-muted-foreground/40 font-mono shrink-0">
            ({active.length})
          </span>
        )}
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
            {!machine.online ? (
              <p className="px-3 py-2 text-[11px] text-muted-foreground/50">
                {machine.error ? `Unreachable — ${machine.error}` : 'Unreachable'}
              </p>
            ) : active.length === 0 && inactive.length === 0 ? (
              <p className="px-3 py-2 text-[11px] text-muted-foreground/40">No sessions</p>
            ) : (
              <div className="space-y-0.5 pb-1">
                {active.map(renderEntry)}
                {inactive.length > 0 && (
                  <>
                    <button
                      onClick={() => setShowInactive((v) => !v)}
                      className="w-full flex items-center gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium text-muted-foreground/60 hover:text-foreground hover:bg-secondary transition-colors"
                    >
                      <motion.span
                        animate={{ rotate: showInactive ? 0 : -90 }}
                        transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
                        className="flex items-center shrink-0"
                      >
                        <ChevronDown className="size-3" />
                      </motion.span>
                      {showInactive ? 'Hide' : 'Show'} {inactive.length} inactive
                    </button>
                    {showInactive && inactive.map(renderEntry)}
                  </>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Main ────────────────────────────────────────────────────────────────────

interface AppSidebarProps {
  data: AggregatedSidebar | undefined;
  isLoading: boolean;
  onClose?: () => void;
}

export function AppSidebar({ data, isLoading, onClose }: AppSidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const setActiveMachine = useActiveMachine((s) => s.setActive);
  const [newSessionModalOpen, setNewSessionModalOpen] = useState(false);

  // The sidebar renders outside the session route, so the route params aren't
  // available here — derive the active session id from the pathname instead.
  const activeSessionId = sessionIdFromPath(location.pathname);
  const activeTab = location.pathname === '/kanban' ? 'tasks' : 'workspaces';

  const handleNavigate = useCallback((path: string) => {
    navigate(path);
    onClose?.();
  }, [navigate, onClose]);

  // Opening a session targets its machine so every per-session action (terminals,
  // git, files) proxies to the right machine via the existing X-Machine-Id path.
  const handleSelectSession = useCallback((sessionId: string, machine: MachineSidebar) => {
    setActiveMachine({ machineId: machine.machineId, name: machine.machineName });
    navigate(sessionPath(machine.machineId, sessionId));
    onClose?.();
  }, [navigate, onClose, setActiveMachine]);

  const machines = data?.machines ?? [];

  return (
    <div className="flex flex-col h-full bg-card text-foreground">
      {/* Electron: traffic light spacer + drag region */}
      <div className="hidden electron-titlebar h-[44px] shrink-0 electrobun-webkit-app-region-drag" />
      {/* Top nav tabs with sliding pill — right side is a drag handle */}
      <div className="flex items-center gap-0.5 px-2 pt-3 pb-2 shrink-0 electrobun-webkit-app-region-drag">
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
              'relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium capitalize transition-colors duration-150 electrobun-webkit-app-region-no-drag',
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
            className="ml-auto md:hidden p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary electrobun-webkit-app-region-no-drag"
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

      {/* Sessions header */}
      <div className="flex items-center px-3 pb-1 shrink-0">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-semibold">
          Sessions
        </span>
      </div>

      {/* Machine-grouped session list */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 flex flex-col">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : machines.length === 0 ? (
          <div className="px-3 py-8 text-center">
            <p className="text-xs text-muted-foreground">No sessions</p>
          </div>
        ) : (
          <div className="py-1 space-y-1">
            {machines.map((machine) => (
              <MachineSection
                key={machine.machineId}
                machine={machine}
                activeSessionId={activeSessionId}
                onSelectSession={handleSelectSession}
                onNavigate={handleNavigate}
              />
            ))}
          </div>
        )}
        {/* Empty space below sessions is a window drag handle */}
        <div className="flex-1 min-h-[48px] electrobun-webkit-app-region-drag" />
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
        onClose={() => setNewSessionModalOpen(false)}
        preselectedProjectId={null}
      />
    </div>
  );
}

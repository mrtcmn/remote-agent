import { useCallback, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
import { SshHostsSection } from '@/components/ssh/SshHostsSection';
import { AIModelIcon, detectAIModel } from '@/components/AIModelIcon';
import { FormattedText } from '@/components/FormattedText';
import { cn } from '@/lib/utils';
import { FEATURE_SECTION_TASKS, FEATURE_SESSION_SSH } from '@/lib/flags';
import {
  api,
  type SidebarSession,
  type SessionService,
  type AggregatedSidebar,
  type MachineSidebar,
  type AggregatedNotification,
  type NotificationRecord,
  type NotificationOption,
  type NotificationAction,
} from '@/lib/api';
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

// ─── Notification review ──────────────────────────────────────────────────────

type RespondInput = { action: string; text?: string; answers?: string[] };
type RespondFn = (notification: AggregatedNotification, input: RespondInput) => void;

/** A pending notification is "needs you" (amber) for input/permission, "error" (red), else null. */
function notifKind(n: NotificationRecord): 'needs' | 'error' | null {
  if (n.type === 'error') return 'error';
  if (n.type === 'user_input_required' || n.type === 'permission_request') return 'needs';
  return null;
}

const DANGER_LABELS = /^(deny|cancel|no|reject|abort|stop|skip|ignore|decline|refuse|delete|remove|destroy|revoke|disallow|forbid|block)/i;
const PRIMARY_LABELS = /^(approve|yes|allow|confirm|proceed|accept|ok|continue|grant|permit|enable)/i;

function getChoiceVariant(label: string): 'primary' | 'secondary' | 'danger' {
  if (DANGER_LABELS.test(label.trim())) return 'danger';
  if (PRIMARY_LABELS.test(label.trim())) return 'primary';
  return 'secondary';
}

/** Prefer metadata.options (first-question actions), fall back to raw actions. */
function buildChoices(notification: NotificationRecord): { id: string; label: string; variant: 'primary' | 'secondary' | 'danger' }[] | null {
  const options = notification.metadata?.options as NotificationOption[] | undefined;
  const actions = notification.actions as NotificationAction[] | undefined;
  if (options && options.length > 0) {
    return options.map((opt) => ({ id: opt.value, label: opt.label, variant: opt.isDefault ? 'primary' : getChoiceVariant(opt.label) }));
  }
  if (actions && actions.length > 0) {
    // open/view navigate and reply is the freeform field — none are real choices.
    const real = actions.filter((a) => !['open', 'reply', 'view'].includes(a.action));
    if (real.length > 0) return real.map((act) => ({ id: act.action, label: act.label, variant: getChoiceVariant(act.label) }));
  }
  return null;
}

/** A completed task can still carry an optional follow-up question ("what's next?"). */
function hasFollowup(n: NotificationRecord): boolean {
  return n.type === 'task_complete' && (!!buildChoices(n) || !!n.metadata?.freeformAllowed);
}

const choiceClass = (variant: 'primary' | 'secondary' | 'danger', selected: boolean) =>
  cn(
    'px-2 py-0.5 rounded-md text-[11px] font-medium border transition-colors max-w-full truncate',
    selected
      ? 'bg-foreground text-background border-foreground'
      : variant === 'primary'
      ? 'border-foreground/60 text-foreground hover:bg-foreground hover:text-background'
      : variant === 'danger'
      ? 'border-red-500/40 text-red-500 hover:bg-red-500/10'
      : 'border-foreground/20 text-muted-foreground hover:text-foreground hover:border-foreground/40 hover:bg-secondary/60'
  );

/** Inline review shown under a session/terminal row for a pending notification. */
function NotifReview({ notification, onRespond, onOpen }: { notification: AggregatedNotification; onRespond: RespondFn; onOpen: () => void }) {
  const questions = notification.metadata?.questions;
  const isMulti = !!questions && questions.length > 1;
  const freeform = !!notification.metadata?.freeformAllowed;
  const [picks, setPicks] = useState<(string | null)[]>(() => (questions ? questions.map(() => null) : []));
  const [text, setText] = useState('');

  const body = notification.body ? (
    <FormattedText
      text={notification.body}
      className="text-[11px] text-muted-foreground leading-relaxed border-l-2 border-foreground/20 pl-2"
    />
  ) : null;

  // Always offer a way into the terminal — this is the answer when we couldn't parse
  // real choices ("respond in the terminal") rather than fabricating approve/deny.
  const openLink = (
    <button onClick={onOpen} className="text-[10px] text-muted-foreground hover:text-foreground underline underline-offset-2">
      Open terminal ↗
    </button>
  );

  if (isMulti) {
    const allPicked = picks.every(Boolean);
    return (
      <div className="pl-7 pr-2 pb-1.5 pt-0.5 space-y-2" onClick={(e) => e.stopPropagation()}>
        {body}
        {questions!.map((q, qi) => (
          <div key={qi} className="space-y-1">
            <p className="text-[11px] font-medium text-foreground/80">{q.header || q.question}</p>
            <div className="flex flex-wrap gap-1">
              {q.options.map((o) => (
                <button
                  key={o.value}
                  onClick={() => setPicks((p) => { const c = [...p]; c[qi] = o.value; return c; })}
                  className={choiceClass(getChoiceVariant(o.label), picks[qi] === o.value)}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        <button
          disabled={!allPicked}
          onClick={() => onRespond(notification, { action: picks[0] as string, answers: picks as string[] })}
          className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-foreground text-background hover:opacity-90 transition-opacity disabled:opacity-30 disabled:cursor-not-allowed"
        >
          Submit
        </button>
        {openLink}
      </div>
    );
  }

  const choices = buildChoices(notification);
  const isDone = notification.type === 'task_complete';
  return (
    <div className="pl-7 pr-2 pb-1.5 pt-0.5 space-y-2" onClick={(e) => e.stopPropagation()}>
      {body}
      {isDone && (choices || freeform) && (
        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">What's next?</p>
      )}
      {choices && choices.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {choices.map((c) => (
            <button key={c.id} onClick={() => onRespond(notification, { action: c.id })} className={choiceClass(c.variant, false)}>
              {c.label}
            </button>
          ))}
        </div>
      )}
      {freeform && (
        <form
          onSubmit={(e) => { e.preventDefault(); if (text.trim()) onRespond(notification, { action: 'reply', text }); }}
          className="flex gap-1"
        >
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Reply…"
            className="flex-1 min-w-0 px-2 py-1 rounded-md text-[11px] bg-secondary/60 border border-border focus:outline-none focus:border-foreground/40"
          />
          <button
            type="submit"
            disabled={!text.trim()}
            className="px-2 py-1 rounded-md text-[11px] font-medium border border-foreground/20 text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-30"
          >
            Send
          </button>
        </form>
      )}
      {openLink}
    </div>
  );
}

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
  notification,
  onRespond,
  onNavigate,
}: {
  sessionId: string;
  machineId: string;
  service: SessionService;
  notification?: AggregatedNotification;
  onRespond: RespondFn;
  onNavigate: (path: string) => void;
}) {
  const config = serviceConfig[service.type] || serviceConfig.shell;
  const Icon = config.icon;
  // Claude terminals use the brand AI icon resolved from the terminal title —
  // same `detectAIModel(name)` mechanism the top tab bar uses, so a Codex /
  // Gemini / OpenAI session shows the right brand instead of a generic bot.
  const isAi = service.type === 'claude';
  const kind = notification ? notifKind(notification) : null;
  // A row takes over (shows review) when it needs the user (needs-you / error) OR
  // when it's a completed task with an optional follow-up ("what's next?"). A plain
  // working/done record just tints the dot — no hijack, no fabricated buttons.
  const followup = notification ? hasFollowup(notification) : false;
  const showReview = kind !== null || followup;
  const [expanded, setExpanded] = useState(true);

  const navigate = () => {
    if (service.type === 'codeServer' && service.url) {
      window.open(service.url, '_blank');
    } else if (service.type === 'docker') {
      onNavigate(sessionPath(machineId, sessionId));
    } else {
      onNavigate(sessionPath(machineId, sessionId, service.id));
    }
  };

  const dot =
    kind === 'needs' ? 'bg-amber-500 animate-pulse' : kind === 'error' ? 'bg-red-500' : config.dot;

  return (
    <div>
      <button
        onClick={() => (showReview ? setExpanded((v) => !v) : navigate())}
        className={cn(
          'w-full flex items-center gap-1.5 pl-7 pr-2 py-0.5 rounded text-left transition-colors',
          showReview ? 'text-foreground hover:bg-secondary/50' : 'text-muted-foreground/60 hover:text-muted-foreground hover:bg-secondary/50'
        )}
        title={service.label}
      >
        <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dot)} />
        {isAi ? (
          <AIModelIcon model={detectAIModel(service.label)} size={10} className="shrink-0" />
        ) : (
          <Icon className="size-2.5 shrink-0" />
        )}
        <span className="text-[12px] font-semibold truncate">{service.label}</span>
        {kind && (
          <span className={cn('ml-auto shrink-0 text-[9px] font-semibold uppercase tracking-wide', kind === 'error' ? 'text-red-500' : 'text-amber-500')}>
            {kind === 'error' ? 'error' : 'needs you'}
          </span>
        )}
      </button>
      {showReview && expanded && <NotifReview notification={notification!} onRespond={onRespond} onOpen={navigate} />}
    </div>
  );
}

// ─── SessionRow ──────────────────────────────────────────────────────────────

function SessionRow({
  session,
  isSelected,
  onSelect,
  projectName,
  projectColor,
  notifKind,
}: {
  session: SidebarSession;
  isSelected: boolean;
  onSelect: () => void;
  projectName?: string | null;
  projectColor?: string | null;
  notifKind?: 'needs' | 'error' | null;
}) {
  const effectiveStatus = session.liveStatus || session.status;
  // A pending notification on any of this session's terminals overrides the dot:
  // amber pulse when it needs the user, red on error, else the live status.
  const dotClass =
    notifKind === 'needs'
      ? 'bg-amber-500 animate-pulse'
      : notifKind === 'error'
      ? 'bg-red-500'
      : statusDotClass[effectiveStatus] || 'bg-gray-500';
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
  notifByKey,
  sessionNotifs,
  onRespond,
}: {
  session: SidebarSession;
  machineId: string;
  projectName?: string | null;
  projectColor?: string | null;
  isSelected: boolean;
  onSelect: () => void;
  onNavigate: (path: string) => void;
  notifByKey: Map<string, AggregatedNotification>;
  sessionNotifs: AggregatedNotification[];
  onRespond: RespondFn;
}) {
  // Session-level notifications with no terminal row of their own (their terminal
  // isn't among the rendered services) — surface them under the session row.
  const serviceIds = new Set(session.services?.map((s) => s.id) ?? []);
  const orphanNotifs = sessionNotifs.filter((n) => !n.terminalId || !serviceIds.has(n.terminalId));

  // Aggregate dot: error wins, then needs-you, else fall through to live status.
  const aggKind = sessionNotifs.some((n) => notifKind(n) === 'error')
    ? 'error'
    : sessionNotifs.some((n) => notifKind(n) === 'needs')
    ? 'needs'
    : null;

  return (
    <div>
      <SessionRow
        session={session}
        projectName={projectName}
        projectColor={projectColor}
        isSelected={isSelected}
        onSelect={onSelect}
        notifKind={aggKind}
      />
      {orphanNotifs.filter((n) => notifKind(n) !== null || hasFollowup(n)).map((n) => (
        <NotifReview
          key={n.id}
          notification={n}
          onRespond={onRespond}
          onOpen={() => onNavigate(sessionPath(machineId, session.id))}
        />
      ))}
      {session.services?.length > 0 && (
        <div className="space-y-px">
          {session.services.map((service) => (
            <ServiceRow
              key={service.id}
              sessionId={session.id}
              machineId={machineId}
              service={service}
              notification={notifByKey.get(service.id)}
              onRespond={onRespond}
              onNavigate={onNavigate}
            />
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
  notifByKey,
  notifsBySession,
  onRespond,
}: {
  machine: MachineSidebar;
  activeSessionId: string | null;
  onSelectSession: (sessionId: string, machine: MachineSidebar) => void;
  onNavigate: (path: string) => void;
  notifByKey: Map<string, AggregatedNotification>;
  notifsBySession: Map<string, AggregatedNotification[]>;
  onRespond: RespondFn;
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
      notifByKey={notifByKey}
      sessionNotifs={notifsBySession.get(session.id) ?? []}
      onRespond={onRespond}
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
  const queryClient = useQueryClient();
  const setActiveMachine = useActiveMachine((s) => s.setActive);
  const [newSessionModalOpen, setNewSessionModalOpen] = useState(false);

  // Pending review items, folded into the session rows below. Keyed 'notifications'
  // so the FCM NotificationListener's invalidation refreshes it too.
  const { data: notifData } = useQuery({
    queryKey: ['notifications', 'sidebar'],
    queryFn: () => api.getAggregatedNotifications({ status: 'pending,sent', limit: 50 }),
    refetchInterval: 5000,
  });

  const respondMutation = useMutation({
    mutationFn: ({ notification, input }: { notification: AggregatedNotification; input: RespondInput }) =>
      api.respondToNotification(notification.id, input.action, input.text, notification.machineId, input.answers),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-aggregate'] });
    },
  });
  const handleRespond = useCallback<RespondFn>(
    (notification, input) => respondMutation.mutate({ notification, input }),
    [respondMutation],
  );

  // Index by terminalId (fallback sessionId) for row placement, plus a per-session
  // bucket for the aggregate session dot.
  const { notifByKey, notifsBySession } = useMemo(() => {
    const byKey = new Map<string, AggregatedNotification>();
    const bySession = new Map<string, AggregatedNotification[]>();
    for (const n of notifData?.notifications ?? []) {
      byKey.set(n.terminalId ?? n.sessionId, n);
      const list = bySession.get(n.sessionId) ?? [];
      list.push(n);
      bySession.set(n.sessionId, list);
    }
    return { notifByKey: byKey, notifsBySession: bySession };
  }, [notifData]);

  // The sidebar renders outside the session route, so the route params aren't
  // available here — derive the active session id from the pathname instead.
  const activeSessionId = sessionIdFromPath(location.pathname);
  const activeTab = location.pathname === '/kanban' ? 'tasks' : 'workspaces';
  // Only worth a tab bar when there's more than one destination to switch between.
  const tabs = (['workspaces', 'tasks'] as const).filter((tab) => tab !== 'tasks' || FEATURE_SECTION_TASKS);

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
      {/* Top nav tabs with sliding pill — right side is a drag handle.
          Hidden entirely when there's nothing to show, so New Session sits
          vertically centered at the top instead of under an empty strip. */}
      {(tabs.length > 1 || onClose) && (
      <div className="flex items-center gap-0.5 px-2 pt-3 pb-2 shrink-0 electrobun-webkit-app-region-drag">
        {tabs.length > 1 && tabs.map((tab) => (
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
      )}

      {/* New Session button */}
      <div className="px-2 py-2 shrink-0">
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
                notifByKey={notifByKey}
                notifsBySession={notifsBySession}
                onRespond={handleRespond}
              />
            ))}
          </div>
        )}

        {FEATURE_SESSION_SSH && (
          <>
            <div className="h-px bg-border my-2 shrink-0" />
            <SshHostsSection onNavigate={handleNavigate} />
          </>
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
        ].filter((item) => item.to !== '/kanban' || FEATURE_SECTION_TASKS).map((item) => (
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

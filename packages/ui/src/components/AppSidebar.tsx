import * as React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus,
  ChevronDown,
  ListTodo,
  Settings,
  Sparkles,
  Plug,
  FolderGit2,
  LayoutGrid,
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
  Search,
} from 'lucide-react';
import { SshHostsSection } from '@/components/ssh/SshHostsSection';
import { TerminalAIIcon } from '@/components/AIModelIcon';
import { FormattedText } from '@/components/FormattedText';
import { cn } from '@/lib/utils';
import { FEATURE_SECTION_TASKS, FEATURE_SESSION_SSH } from '@/lib/flags';
import { openCommandBar } from '@/components/CommandBar';
import { Kbd } from '@/components/ui/kbd';
import { CloudOrb } from '@/components/ui/cloud-orb';
import { Ellipsis } from '@/components/ui/ellipsis';
import {
  api,
  type SidebarSession,
  type SidebarProject,
  type SessionService,
  type AggregatedSidebar,
  type MachineSidebar,
  type AggregatedNotification,
  type NotificationRecord,
  type NotificationOption,
  type NotificationAction,
} from '@/lib/api';
import { isVisibleSession, byRecency } from '@/lib/sidebar-sessions';
import { sessionPath, sessionIdFromPath, terminalIdFromPath } from '@/lib/session-route';
import { useActiveMachine } from '@/lib/active-machine';

// ─── Service config ─────────────────────────────────────────────────────────

const serviceConfig: Record<string, { dot: string; icon: typeof Bot }> = {
  claude: { dot: 'bg-blue-500', icon: Bot },
  opencode: { dot: 'bg-blue-500', icon: Bot },
  kimi: { dot: 'bg-blue-500', icon: Bot },
  shell: { dot: 'bg-emerald-500', icon: TerminalSquare },
  process: { dot: 'bg-purple-500', icon: Play },
  docker: { dot: 'bg-cyan-500', icon: Container },
  codeServer: { dot: 'bg-emerald-500', icon: Code },
};

// The design's three rails. A session is what you talk to (claude, opencode, a
// shell), a run is a process it spawned, a service is a container it started.
// A checkout has exactly one branch, so the branch belongs on the workspace
// header — it never earns a rail of its own.
const KIND_LABEL = {
  session: 'session',
  run: 'run',
  service: 'service',
} as const;

type ItemKind = keyof typeof KIND_LABEL;

const KINDS = ['session', 'run', 'service'] as const;

/** The agent CLIs. Each one has its own brand mark. */
const AGENT_CLIS = new Set(['claude', 'opencode', 'kimi']);
/** Those plus a plain shell — the things you talk to. */
const AGENT_TYPES = new Set([...AGENT_CLIS, 'shell']);

function serviceKind(service: SessionService): ItemKind {
  if (AGENT_TYPES.has(service.type)) return 'session';
  if (service.type === 'process') return 'run';
  return 'service'; // docker containers and code-server
}

/** "http://localhost:5173" → "5173". Anything unparseable drops out. */
function servicePort(service: SessionService): string | null {
  if (!service.url) return null;
  try {
    const port = new URL(service.url).port;
    return port || null;
  } catch {
    return null;
  }
}

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
      <div className="pl-5 pr-2 pb-1.5 pt-0.5 space-y-2" onClick={(e) => e.stopPropagation()}>
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
    <div className="pl-5 pr-2 pb-1.5 pt-0.5 space-y-2" onClick={(e) => e.stopPropagation()}>
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

// ─── Kind rail (vertical label + gradient rail + selection glow) ──────────────

function KindGroup({
  kind,
  selectedId,
  children,
}: {
  kind: ItemKind;
  selectedId?: string | null;
  children: React.ReactNode;
}) {
  const railRef = useRef<HTMLSpanElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [glow, setGlow] = useState<{ top: number; height: number } | null>(null);

  React.useLayoutEffect(() => {
    const list = listRef.current;
    const rail = railRef.current;
    if (!list || !rail) return;

    const measure = () => {
      const selected = list.querySelector('[data-selected]') as HTMLElement | null;
      if (!selected) {
        setGlow(null);
        return;
      }
      const railRect = rail.getBoundingClientRect();
      const selRect = selected.getBoundingClientRect();
      setGlow({ top: selRect.top - railRect.top, height: selRect.height });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    ro.observe(rail);
    const selected = list.querySelector('[data-selected]') as HTMLElement | null;
    if (selected) ro.observe(selected);
    return () => ro.disconnect();
  }, [selectedId, children]);

  return (
    <div className="flex items-stretch min-w-0">
      <span className="shrink-0 self-start pt-1.5 pl-0.5 text-[8px] font-semibold uppercase tracking-[0.14em] leading-none text-muted-foreground/40 select-none [writing-mode:vertical-rl] rotate-180">
        {KIND_LABEL[kind]}
      </span>
      <span ref={railRef} className="relative w-px shrink-0 self-stretch mx-0.5 overflow-visible">
        <span
          className="absolute inset-0"
          style={{ background: 'linear-gradient(to bottom, hsl(var(--foreground) / 0.32), transparent)' }}
        />
        <AnimatePresence>
          {glow && (
            <motion.span
              key="kind-glow"
              className="absolute left-1/2 z-10 w-0.5 -translate-x-1/2 pointer-events-none"
              initial={{ opacity: 0, top: glow.top, height: glow.height }}
              animate={{ opacity: 1, top: glow.top, height: glow.height }}
              exit={{ opacity: 0 }}
              transition={{ type: 'spring', stiffness: 500, damping: 40 }}
              style={{
                background: 'hsl(var(--foreground))',
                boxShadow: 'var(--glow-rail)',
                maskImage: 'linear-gradient(to bottom, transparent, #000 16%, #000 84%, transparent)',
                WebkitMaskImage: 'linear-gradient(to bottom, transparent, #000 16%, #000 84%, transparent)',
              }}
            />
          )}
        </AnimatePresence>
      </span>
      <div ref={listRef} className="flex-1 min-w-0 space-y-0.5">
        {children}
      </div>
    </div>
  );
}

// ─── Diff visuals ────────────────────────────────────────────────────────────

function diffBoxKinds(added: number, removed: number): Array<'add' | 'del' | 'empty'> {
  const total = added + removed;
  if (total === 0) return Array.from({ length: 5 }, () => 'empty' as const);
  if (removed === 0) return Array.from({ length: 5 }, () => 'add' as const);
  if (added === 0) return Array.from({ length: 5 }, () => 'del' as const);
  const addN = Math.min(4, Math.max(1, Math.round((added / total) * 5)));
  return [
    ...Array.from({ length: addN }, () => 'add' as const),
    ...Array.from({ length: 5 - addN }, () => 'del' as const),
  ];
}

function GitBoxes({ added, removed, className }: { added: number; removed: number; className?: string }) {
  return (
    <span className={cn('flex items-center gap-px', className)} aria-hidden>
      {diffBoxKinds(added, removed).map((kind, i) => (
        <motion.span
          key={`${kind}-${i}`}
          initial={{ opacity: 0, scale: 0.55 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.16, delay: i * 0.028, ease: [0.4, 0, 0.2, 1] }}
          className={cn(
            'size-2 rounded-[2px] shrink-0',
            kind === 'add' && 'bg-emerald-500',
            kind === 'empty' && 'bg-foreground/[0.12]',
            kind === 'del' && 'bg-red-500/80'
          )}
          style={
            kind === 'del'
              ? {
                  backgroundImage:
                    'repeating-linear-gradient(-45deg, transparent 0 1.2px, rgba(255,255,255,0.42) 1.2px 2.2px)',
                }
              : undefined
          }
        />
      ))}
    </span>
  );
}

function DiffNums({ added, removed }: { added: number; removed: number }) {
  if (added === 0 && removed === 0) return null;
  return (
    <span className="flex items-center gap-1 font-mono text-[9px] leading-none shrink-0 tabular-nums">
      {added > 0 && <span className="text-emerald-600 dark:text-emerald-400">+{added}</span>}
      {removed > 0 && <span className="text-red-600 dark:text-red-400">-{removed}</span>}
    </span>
  );
}

/** Workspace header right side: branch + diff, collapsing to a session count. */
function WorkspaceGit({
  count,
  added,
  removed,
  branch,
  compact,
}: {
  count: number;
  added: number;
  removed: number;
  branch?: string | null;
  compact: boolean;
}) {
  return (
    <div className="flex flex-col items-end gap-0.5 shrink-0 min-w-0 max-w-[58%]">
      <AnimatePresence initial={false} mode="popLayout">
        {!compact && branch && (
          <motion.span
            key="branch"
            className="flex items-center gap-0.5 overflow-hidden max-w-full font-mono text-[10px] leading-none text-muted-foreground"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
          >
            <GitBranch className="size-2.5 shrink-0" />
            <Ellipsis className="min-w-0">{branch}</Ellipsis>
          </motion.span>
        )}
      </AnimatePresence>
      <div className="flex items-center gap-1">
        <AnimatePresence initial={false}>
          {!compact && (
            <motion.span
              key="nums"
              className="flex items-center overflow-hidden"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              exit={{ opacity: 0, width: 0 }}
              transition={{ duration: 0.16, ease: [0.4, 0, 0.2, 1] }}
            >
              <DiffNums added={added} removed={removed} />
            </motion.span>
          )}
        </AnimatePresence>
        <GitBoxes added={added} removed={removed} />
        {compact && (
          <motion.span
            key="n"
            className="font-mono text-[9px] tabular-nums text-muted-foreground/50 whitespace-nowrap"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.16 }}
          >
            {count} {count === 1 ? 'session' : 'sessions'}
          </motion.span>
        )}
      </div>
    </div>
  );
}

// ─── Rows ────────────────────────────────────────────────────────────────────

const rowClass = (isSelected: boolean, nested: boolean) =>
  cn(
    'group/session w-full flex items-center gap-2 pr-2 py-1.5 rounded-r-md text-left relative overflow-hidden isolate',
    nested ? 'pl-2' : 'pl-3',
    isSelected
      ? 'rounded-l-none text-foreground'
      : 'rounded-l-md text-muted-foreground hover:bg-secondary hover:text-foreground'
  );

function SelectionWash({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.span
          key="glow"
          className="absolute inset-0 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
          style={{ background: 'var(--glow-wash)' }}
        />
      )}
    </AnimatePresence>
  );
}

function ServiceRow({
  sessionId,
  machineId,
  service,
  isSelected,
  notification,
  onSelect,
  onRespond,
  onNavigate,
}: {
  sessionId: string;
  machineId: string;
  service: SessionService;
  isSelected: boolean;
  notification?: AggregatedNotification;
  onSelect: () => void;
  onRespond: RespondFn;
  onNavigate: (path: string) => void;
}) {
  const config = serviceConfig[service.type] || serviceConfig.shell;
  const Icon = config.icon;
  // Agent terminals use the brand icon the top tab bar uses, so a Kimi,
  // OpenCode, Codex or Gemini session shows its own mark, not a generic bot.
  const isAgent = AGENT_CLIS.has(service.type);
  const kind = notification ? notifKind(notification) : null;
  // A row takes over (shows review) when it needs the user (needs-you / error) OR
  // when it's a completed task with an optional follow-up ("what's next?"). A plain
  // working/done record just tints the dot — no hijack, no fabricated buttons.
  const followup = notification ? hasFollowup(notification) : false;
  const showReview = kind !== null || followup;
  const [expanded, setExpanded] = useState(true);
  const port = servicePort(service);

  const navigate = () => {
    onSelect();
    if (service.type === 'codeServer' && service.url) {
      window.open(service.url, '_blank');
    } else if (service.type === 'docker') {
      onNavigate(sessionPath(machineId, sessionId));
    } else {
      onNavigate(sessionPath(machineId, sessionId, service.id));
    }
  };

  const dot = kind === 'needs' ? 'bg-amber-500 animate-pulse' : kind === 'error' ? 'bg-red-500' : config.dot;

  return (
    <div>
      <motion.button
        layout
        onClick={() => (showReview ? setExpanded((v) => !v) : navigate())}
        whileTap={{ scale: 0.98 }}
        transition={{ duration: 0.12 }}
        className={rowClass(isSelected, true)}
        data-selected={isSelected ? '' : undefined}
        title={service.label}
      >
        <SelectionWash show={isSelected} />
        <span className={cn('relative z-10 w-1.5 h-1.5 rounded-full shrink-0', dot)} />
        {isAgent ? (
          <TerminalAIIcon
            terminalType={service.type}
            terminalName={service.label}
            size={12}
            className="relative z-10 shrink-0"
          />
        ) : (
          <Icon
            className={cn(
              'size-3 relative z-10 shrink-0 transition-colors',
              isSelected ? 'text-foreground/60' : 'text-muted-foreground/40 group-hover/session:text-muted-foreground'
            )}
          />
        )}
        <div className="flex-1 min-w-0 relative z-10 flex items-center gap-1.5">
          <Ellipsis className="flex-1 text-xs font-medium leading-snug">{service.label}</Ellipsis>
          {kind ? (
            <span
              className={cn(
                'shrink-0 text-[9px] font-semibold uppercase tracking-wide',
                kind === 'error' ? 'text-red-500' : 'text-amber-500'
              )}
            >
              {kind === 'error' ? 'error' : 'needs you'}
            </span>
          ) : port ? (
            <span className="font-mono text-[9px] text-muted-foreground/40 tabular-nums shrink-0">{port}</span>
          ) : service.image ? (
            <span className="font-mono text-[9px] text-muted-foreground/40 shrink-0 max-w-[45%] truncate">{service.image}</span>
          ) : null}
        </div>
      </motion.button>
      {showReview && expanded && <NotifReview notification={notification!} onRespond={onRespond} onOpen={navigate} />}
    </div>
  );
}

// ─── Workspace (a project inside a machine) ──────────────────────────────────

interface Workspace {
  id: string;
  name: string;
  sessions: SidebarSession[];
}

function WorkspaceGroup({
  workspace,
  machine,
  activeSessionId,
  activeTerminalId,
  onActivateMachine,
  onNavigate,
  notifByKey,
  notifsBySession,
  onRespond,
}: {
  workspace: Workspace;
  machine: MachineSidebar;
  activeSessionId: string | null;
  activeTerminalId: string | null;
  onActivateMachine: (machine: MachineSidebar) => void;
  onNavigate: (path: string) => void;
  notifByKey: Map<string, AggregatedNotification>;
  notifsBySession: Map<string, AggregatedNotification[]>;
  onRespond: RespondFn;
}) {
  const [expanded, setExpanded] = useState(true);
  const sessions = workspace.sessions;

  const added = sessions.reduce((n, s) => n + (s.diffStats?.additions ?? 0), 0);
  const removed = sessions.reduce((n, s) => n + (s.diffStats?.deletions ?? 0), 0);
  const branch = sessions.find((s) => s.sessionType === 'git')?.branchName ?? sessions[0]?.branchName;

  // Rows are the things you can open. A session's own branch already shows on
  // the header above, so the sessions of a workspace contribute their terminals,
  // runs and containers straight into the three rails.
  const rows = useMemo(() => {
    const out: Record<ItemKind, Array<{ session: SidebarSession; service: SessionService }>> = {
      session: [],
      run: [],
      service: [],
    };
    for (const session of sessions) {
      for (const service of session.services ?? []) out[serviceKind(service)].push({ session, service });
    }
    return out;
  }, [sessions]);

  // Opening a session with no terminal in the URL lands on its first terminal,
  // so that row is the selected one.
  const isSelected = (session: SidebarSession, service: SessionService) => {
    if (session.id !== activeSessionId) return false;
    if (activeTerminalId) return service.id === activeTerminalId;
    return rows.session.find((r) => r.session.id === session.id)?.service.id === service.id;
  };

  // Notifications whose terminal has no row of its own still need somewhere to
  // land, so they hang under the session rail.
  const orphanNotifs = sessions.flatMap((session) => {
    const ids = new Set(session.services?.map((s) => s.id) ?? []);
    return (notifsBySession.get(session.id) ?? [])
      .filter((n) => (!n.terminalId || !ids.has(n.terminalId)) && (notifKind(n) !== null || hasFollowup(n)))
      .map((n) => (
        <NotifReview
          key={n.id}
          notification={n}
          onRespond={onRespond}
          onOpen={() => onNavigate(sessionPath(machine.machineId, session.id))}
        />
      ));
  });

  return (
    <div className="space-y-0.5">
      <div
        role="button"
        onClick={() => setExpanded((v) => !v)}
        className="group/ws flex items-center gap-2 px-2 py-0.5 rounded-md hover:bg-secondary cursor-pointer select-none"
      >
        <CloudOrb aria-hidden name={workspace.name} seed={workspace.id} size={28} />
        <Ellipsis className="flex-1 text-xs font-medium text-muted-foreground group-hover/ws:text-foreground transition-colors">
          {workspace.name}
        </Ellipsis>
        <WorkspaceGit
          count={sessions.length}
          added={added}
          removed={removed}
          branch={branch}
          compact={!expanded}
        />
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
            <div className="space-y-1">
              {KINDS.map((kind) => {
                const items = rows[kind];
                const extra = kind === 'session' ? orphanNotifs : [];
                if (items.length === 0 && extra.length === 0) return null;
                return (
                  <KindGroup key={kind} kind={kind} selectedId={activeTerminalId ?? activeSessionId}>
                    {items.map(({ session, service }) => (
                      <ServiceRow
                        key={service.id}
                        sessionId={session.id}
                        machineId={machine.machineId}
                        service={service}
                        isSelected={isSelected(session, service)}
                        notification={notifByKey.get(service.id)}
                        onSelect={() => onActivateMachine(machine)}
                        onRespond={onRespond}
                        onNavigate={onNavigate}
                      />
                    ))}
                    {extra}
                  </KindGroup>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Machine fold ────────────────────────────────────────────────────────────

const foldHeaderClass =
  'w-full flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors';

function MachineSection({
  machine,
  activeSessionId,
  activeTerminalId,
  onActivateMachine,
  onNavigate,
  notifByKey,
  notifsBySession,
  onRespond,
}: {
  machine: MachineSidebar;
  activeSessionId: string | null;
  activeTerminalId: string | null;
  onActivateMachine: (machine: MachineSidebar) => void;
  onNavigate: (path: string) => void;
  notifByKey: Map<string, AggregatedNotification>;
  notifsBySession: Map<string, AggregatedNotification[]>;
  onRespond: RespondFn;
}) {
  const [open, setOpen] = useState(machine.online);
  const Icon = machine.machineId === 'self' ? Laptop : Server;

  // Unassigned sessions still need a home, so they get their own workspace card.
  // A project whose branches all dropped out has nothing to show, so it goes too.
  const workspaces: Workspace[] = useMemo(() => {
    const now = Date.now();
    // The branch you are looking at always stays, even once it goes quiet —
    // otherwise the open session disappears out from under the selection.
    const keep = (list: SidebarSession[]) =>
      list.filter((s) => s.id === activeSessionId || isVisibleSession(s, now)).sort(byRecency);

    const out: Workspace[] = [];
    for (const p of (machine.data?.projects ?? []) as SidebarProject[]) {
      const sessions = keep(p.sessions);
      if (sessions.length > 0) out.push({ id: p.id, name: p.name, sessions });
    }
    const loose = keep(machine.data?.unassignedSessions ?? []);
    if (loose.length > 0) out.push({ id: `${machine.machineId}-unassigned`, name: 'Unassigned', sessions: loose });
    return out;
  }, [machine, activeSessionId]);

  return (
    <div>
      <button onClick={() => setOpen((v) => !v)} className={foldHeaderClass}>
        <motion.span
          animate={{ rotate: open ? 0 : -90 }}
          transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
          className="flex items-center"
        >
          <ChevronDown className="size-3" />
        </motion.span>
        <Icon className="size-3" />
        <span className="font-medium truncate">{machine.machineName}</span>
        <span
          className={cn('w-1.5 h-1.5 rounded-full shrink-0', machine.online ? 'bg-emerald-500' : 'bg-muted-foreground/40')}
          title={machine.online ? 'online' : machine.error || 'offline'}
        />
        <span className="ml-auto font-mono text-[10px]">{workspaces.length}</span>
      </button>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
            className="px-2 pb-1"
          >
            {!machine.online ? (
              <p className="px-1 py-2 text-[11px] text-muted-foreground/50">
                {machine.error ? `Unreachable — ${machine.error}` : 'Unreachable'}
              </p>
            ) : workspaces.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-muted-foreground/40">No sessions</p>
            ) : (
              workspaces.map((ws, i) => (
                <React.Fragment key={ws.id}>
                  {i > 0 && <div className="h-px bg-border my-0.5" />}
                  <WorkspaceGroup
                    workspace={ws}
                    machine={machine}
                    activeSessionId={activeSessionId}
                    activeTerminalId={activeTerminalId}
                    onActivateMachine={onActivateMachine}
                    onNavigate={onNavigate}
                    notifByKey={notifByKey}
                    notifsBySession={notifsBySession}
                    onRespond={onRespond}
                  />
                </React.Fragment>
              ))
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
  const activeTerminalId = terminalIdFromPath(location.pathname);
  const activeTab = location.pathname === '/kanban' ? 'tasks' : 'workspaces';
  // Only worth a tab bar when there's more than one destination to switch between.
  const tabs = (['workspaces', 'tasks'] as const).filter((tab) => tab !== 'tasks' || FEATURE_SECTION_TASKS);

  const handleNavigate = useCallback((path: string) => {
    navigate(path);
    onClose?.();
  }, [navigate, onClose]);

  // Opening a row targets its machine so every per-session action (terminals,
  // git, files) proxies to the right machine via the existing X-Machine-Id path.
  // The row itself routes, so this only moves the pointer.
  const handleActivateMachine = useCallback((machine: MachineSidebar) => {
    setActiveMachine({ machineId: machine.machineId, name: machine.machineName });
  }, [setActiveMachine]);

  const machines = data?.machines ?? [];

  // Fade the list where it runs past its box, top and bottom, only when there is
  // something scrolled out of view on that side.
  const listRef = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ top: false, bottom: false });

  useEffect(() => {
    const vp = listRef.current;
    if (!vp) return;
    const check = () => {
      setEdge({
        top: vp.scrollTop > 6,
        bottom: vp.scrollHeight - vp.scrollTop - vp.clientHeight > 6,
      });
    };
    check();
    vp.addEventListener('scroll', check, { passive: true });
    const ro = new ResizeObserver(check);
    ro.observe(vp);
    const inner = vp.firstElementChild;
    if (inner) ro.observe(inner);
    return () => {
      vp.removeEventListener('scroll', check);
      ro.disconnect();
    };
  }, []);

  const maskImage =
    edge.top && edge.bottom
      ? 'linear-gradient(to bottom, transparent, #000 2.5rem, #000 calc(100% - 2.5rem), transparent)'
      : edge.bottom
        ? 'linear-gradient(to bottom, #000 calc(100% - 2.5rem), transparent)'
        : edge.top
          ? 'linear-gradient(to bottom, transparent, #000 2.5rem)'
          : undefined;

  return (
    <div className="flex flex-col h-full bg-card text-foreground">
      {/* Top nav tabs with sliding pill — right side is a drag handle.
          Hidden entirely when there's nothing to show, so Search sits
          vertically centered at the top instead of under an empty strip. */}
      {(tabs.length > 1 || onClose) && (
        <div className="flex items-center gap-0.5 px-2 pt-3 pb-2 shrink-0 electrobun-webkit-app-region-drag">
          {tabs.length > 1 && tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => {
                navigate(tab === 'tasks' ? '/kanban' : '/');
                onClose?.();
              }}
              className={cn(
                'relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium capitalize transition-colors duration-150 electrobun-webkit-app-region-no-drag',
                activeTab === tab
                  ? 'text-accent-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary'
              )}
            >
              {activeTab === tab && (
                <motion.span
                  layoutId="sidebar-tab-pill"
                  className="absolute inset-0 rounded-md bg-accent"
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

      {/* Command palette entry */}
      <div className="px-2 pt-2 shrink-0">
        <motion.button
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.12 }}
          onClick={() => openCommandBar()}
          className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors electrobun-webkit-app-region-no-drag"
        >
          <span className="flex items-center gap-1.5">
            <Search className="size-3.5" />
            Search…
          </span>
          <Kbd>⌘K</Kbd>
        </motion.button>
      </div>

      {/* New Session button */}
      <div className="px-2 pb-2 pt-1 shrink-0">
        <motion.button
          whileTap={{ scale: 0.98 }}
          transition={{ duration: 0.12 }}
          onClick={() => openCommandBar('create session ')}
          className="w-full flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-secondary transition-colors"
        >
          <span className="flex items-center gap-1.5">
            <Plus className="size-3.5" />
            New Session
          </span>
          <Kbd>⌘N</Kbd>
        </motion.button>
      </div>

      <div className="h-px bg-border mb-2 shrink-0" />

      {/* Machine-grouped workspace list */}
      <div
        ref={listRef}
        className="relative flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar-hide"
        style={{ maskImage, WebkitMaskImage: maskImage }}
      >
        <div className="pb-8 flex flex-col min-h-full">
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : machines.length === 0 ? (
            <div className="px-3 py-8 text-center">
              <p className="text-xs text-muted-foreground">No sessions</p>
            </div>
          ) : (
            machines.map((machine) => (
              <MachineSection
                key={machine.machineId}
                machine={machine}
                activeSessionId={activeSessionId}
                activeTerminalId={activeTerminalId}
                onActivateMachine={handleActivateMachine}
                onNavigate={handleNavigate}
                notifByKey={notifByKey}
                notifsBySession={notifsBySession}
                onRespond={handleRespond}
              />
            ))
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
    </div>
  );
}

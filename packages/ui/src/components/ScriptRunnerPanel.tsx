import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { Play, Square, RotateCw, Loader2, X } from 'lucide-react';
import { Ellipsis } from '@/components/ui/ellipsis';
import { useRunConfigs } from '@/hooks/useRunConfigs';
import { api, type RunConfig } from '@/lib/api';
import { toast } from '@/components/ui/Toaster';
import { cn } from '@/lib/utils';

// ─── Look ────────────────────────────────────────────────────────────────────

type ActionTone = 'start' | 'restart' | 'stop' | 'enlarge';

const SNAP = { duration: 0.14, ease: [0.16, 1, 0.3, 1] as const };
const PLAY_GREEN = '#5ecf8a';
const TAIL_LINES = 12;

const ACTION_CLASS: Record<ActionTone, string> = {
  start: 'text-emerald-400/80 hover:text-emerald-300 hover:bg-emerald-500/15',
  restart: 'text-muted-foreground hover:text-foreground hover:bg-secondary',
  stop: 'text-red-400/70 hover:text-red-300 hover:bg-red-500/15',
  enlarge: 'text-muted-foreground hover:text-foreground hover:bg-secondary',
};

const GLOW_GREEN = { background: 'var(--glow-ok-wash)' };
const GLOW_WHITE = { background: 'var(--glow-wash)' };
const RAIL_SHADOW_GREEN = 'var(--glow-ok-rail)';
const RAIL_SHADOW_WHITE = 'var(--glow-rail)';

/** Log tone, guessed from the line itself — the tail arrives as plain text. */
function toneOf(text: string): string {
  if (/\b(error|failed|fatal|exception|ERR!)\b/i.test(text)) return 'text-red-400';
  if (/\b(ready|success|listening|compiled|pass|started|done)\b/i.test(text)) return 'text-emerald-300/90';
  if (text.startsWith('$') || /^\s*(at|warn)\b/i.test(text)) return 'text-foreground/55';
  return 'text-foreground/85';
}

function EnlargeIcon({ shrink }: { shrink?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5"
    >
      {shrink ? (
        <>
          <rect width="18" height="18" x="3" y="3" rx="2" />
          <rect width="8" height="8" x="8" y="8" rx="1.5" />
        </>
      ) : (
        <>
          <rect width="14" height="14" x="8" y="8" rx="2" />
          <rect width="14" height="14" x="2" y="2" rx="2" />
        </>
      )}
    </svg>
  );
}

function IconBtn({
  label,
  tone,
  onClick,
  children,
}: {
  label: string;
  tone: ActionTone;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <motion.button
      type="button"
      aria-label={label}
      title={label}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.1 }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn('flex items-center justify-center size-4 rounded shrink-0', ACTION_CLASS[tone])}
    >
      {children}
    </motion.button>
  );
}

// ─── Row ─────────────────────────────────────────────────────────────────────

function ScriptRow({
  config,
  pending,
  onStart,
  onStop,
  onRestart,
  onOpenTerminal,
}: {
  config: RunConfig;
  pending: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onOpenTerminal: (terminalId: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [pinned, setPinned] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);

  const running = config.isRunning;
  const open = hovered || pinned;
  const terminalId = config.activeTerminalId;

  // The websocket belongs to xterm; a row only needs the tail, so it polls the
  // plain-text endpoint while it is open and stops the moment it closes.
  const { data } = useQuery({
    queryKey: ['terminal-output', terminalId],
    queryFn: () => api.getTerminalOutput(terminalId!, TAIL_LINES),
    enabled: open && !!terminalId,
    refetchInterval: 1500,
  });

  const logs = (data?.output ?? '').split('\n').filter((l) => l.trim() !== '').slice(-TAIL_LINES);

  useEffect(() => {
    if (!open) return;
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [open, logs.length]);

  return (
    <motion.div
      layout
      onHoverStart={() => setHovered(true)}
      onHoverEnd={() => setHovered(false)}
      onClick={() => setPinned((v) => !v)}
      className="relative border-b border-border last:border-b-0 overflow-hidden isolate cursor-pointer"
    >
      <AnimatePresence>
        {open && (
          <>
            <motion.span
              key="glow"
              className="absolute inset-0 pointer-events-none"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
              style={running ? GLOW_GREEN : GLOW_WHITE}
            />
            <motion.span
              className={cn(
                'absolute inset-y-0 left-0 w-0.5 pointer-events-none',
                running ? 'bg-[#5ecf8a]' : 'bg-foreground'
              )}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
              style={{ boxShadow: running ? RAIL_SHADOW_GREEN : RAIL_SHADOW_WHITE }}
            />
          </>
        )}
      </AnimatePresence>

      <div
        className={cn(
          'relative z-10 flex items-center gap-1 h-8 px-2.5 select-none overflow-hidden',
          open || running ? 'text-foreground' : 'text-muted-foreground'
        )}
      >
        <Play
          className={cn('size-3.5 shrink-0', running ? 'fill-current' : 'text-muted-foreground/40')}
          style={running ? { color: PLAY_GREEN } : undefined}
        />

        <Ellipsis className="text-xs font-medium flex-1 leading-none">{config.name}</Ellipsis>

        <AnimatePresence>
          {open && (
            <motion.span
              key="actions"
              initial={{ y: 10, opacity: 0 }}
              animate={{ y: 0, opacity: 1, transition: { ...SNAP, delay: 0.03 } }}
              exit={{ y: 10, opacity: 0, transition: SNAP }}
              className="flex items-center gap-px shrink-0"
            >
              {pending ? (
                <span className="flex items-center justify-center size-4">
                  <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
                </span>
              ) : running ? (
                <>
                  <IconBtn label="Restart" tone="restart" onClick={onRestart}>
                    <RotateCw className="size-3.5" />
                  </IconBtn>
                  <IconBtn label="Stop" tone="stop" onClick={onStop}>
                    <Square className="size-3.5" />
                  </IconBtn>
                </>
              ) : (
                <IconBtn label="Start" tone="start" onClick={onStart}>
                  <Play className="size-3.5" />
                </IconBtn>
              )}
              {terminalId && (
                <IconBtn label="Open run tab" tone="enlarge" onClick={() => onOpenTerminal(terminalId)}>
                  <EnlargeIcon />
                </IconBtn>
              )}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 120, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SNAP}
            className="overflow-hidden"
          >
            <motion.div
              initial={{ filter: 'blur(8px)', scale: 0.96 }}
              animate={{ filter: 'blur(0px)', scale: 1 }}
              exit={{ filter: 'blur(6px)', scale: 0.98 }}
              transition={SNAP}
              className="origin-top px-2.5 pb-2"
            >
              <div
                ref={scroller}
                className="h-28 overflow-auto font-mono text-[10px] leading-relaxed"
                style={{ scrollbarWidth: 'none' }}
              >
                {logs.length === 0 && (
                  <div className="text-foreground/40">
                    {terminalId ? 'waiting for output…' : 'not started'}
                  </div>
                )}
                {logs.map((log, i) => (
                  <div key={i} className={cn('whitespace-pre-wrap break-all', toneOf(log))}>
                    {log}
                  </div>
                ))}
                {running && (
                  <motion.span
                    className="inline-block w-1.5 h-2.5 bg-foreground/70 align-middle mt-0.5"
                    animate={{ opacity: [1, 0.15, 1] }}
                    transition={{ duration: 0.9, repeat: Infinity, ease: 'easeInOut' }}
                  />
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ─── Panel ───────────────────────────────────────────────────────────────────

/**
 * The runs of a project, a column beside the terminal. Each row drives a real
 * `process` terminal — the same spawn path the app uses for anything else it
 * starts — so "open run tab" just selects that terminal.
 */
export function ScriptRunnerPanel({
  projectId,
  sessionId,
  onOpenTerminal,
  onClose,
}: {
  projectId: string;
  sessionId: string;
  onOpenTerminal: (terminalId: string) => void;
  onClose: () => void;
}) {
  const { runConfigs, isLoading, start, stop, restart } = useRunConfigs(projectId);
  const [pendingId, setPendingId] = useState<string | null>(null);

  // Most recently started first; never-run configs keep their configured order
  // at the bottom. A running config has the newest start, so it floats up too.
  const ordered = useMemo(
    () =>
      [...runConfigs].sort(
        (a, b) => Date.parse(b.lastRunAt ?? '') - Date.parse(a.lastRunAt ?? '') || a.position - b.position
      ),
    [runConfigs]
  );

  const act = async (id: string, run: () => Promise<unknown>, failed: string) => {
    setPendingId(id);
    try {
      await run();
    } catch (error) {
      toast({ title: failed, description: (error as Error).message, variant: 'destructive' });
    } finally {
      setPendingId(null);
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="w-72 shrink-0 self-start max-h-full flex flex-col overflow-hidden rounded-lg border border-border bg-card"
    >
      <div className="flex items-center gap-1 h-8 px-2.5 shrink-0 border-b border-border">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
          Runs
        </span>
        <button
          onClick={onClose}
          aria-label="Close runs"
          className="ml-auto flex items-center justify-center size-4 rounded text-muted-foreground/50 hover:text-foreground hover:bg-secondary"
        >
          <X className="size-3" />
        </button>
      </div>

      <div className="overflow-y-auto scrollbar-hide">
        {isLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="size-4 animate-spin text-muted-foreground" />
          </div>
        ) : runConfigs.length === 0 ? (
          <p className="px-2.5 py-4 text-[11px] text-muted-foreground/60">
            No runs yet. Add them from the Run tab.
          </p>
        ) : (
          ordered.map((config) => (
            <ScriptRow
              key={config.id}
              config={config}
              pending={pendingId === config.id}
              onStart={() => act(config.id, () => start({ id: config.id, sessionId }), 'Start failed')}
              onStop={() => act(config.id, () => stop(config.id), 'Stop failed')}
              onRestart={() => act(config.id, () => restart({ id: config.id, sessionId }), 'Restart failed')}
              onOpenTerminal={onOpenTerminal}
            />
          ))
        )}
      </div>
    </div>
  );
}

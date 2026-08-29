import { useState, useRef, useEffect } from 'react';
import { Send, ChevronUp, Loader2, MessageSquare, Terminal, Sparkles, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type ReviewTarget = 'current' | 'new';

interface ReviewComposerProps {
  pendingCount: number;
  /** Name of the live agent terminal, or undefined when none is running. */
  currentTargetLabel?: string;
  isPending?: boolean;
  onSend: (target: ReviewTarget, note: string) => void;
}

/**
 * The bar under the diff that sends the drafted review comments to an agent.
 * The split button chooses between the open terminal and a fresh Claude session.
 */
export function ReviewComposer({
  pendingCount,
  currentTargetLabel,
  isPending,
  onSend,
}: ReviewComposerProps) {
  const [note, setNote] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [target, setTarget] = useState<ReviewTarget>(currentTargetLabel ? 'current' : 'new');
  const menuRef = useRef<HTMLDivElement>(null);

  // Fall back to a new session as soon as the open terminal goes away.
  useEffect(() => {
    if (!currentTargetLabel) setTarget('new');
  }, [currentTargetLabel]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    if (menuOpen) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  if (pendingCount === 0) return null;

  const send = () => onSend(target, note.trim());
  const targetName = target === 'current' ? currentTargetLabel ?? 'terminal' : 'new Claude session';

  const options: { id: ReviewTarget; label: string; hint: string; icon: typeof Terminal; disabled: boolean }[] = [
    {
      id: 'current',
      label: currentTargetLabel ? `Open session — ${currentTargetLabel}` : 'Open session',
      hint: currentTargetLabel ? 'Types the review into the running agent' : 'No agent terminal is running',
      icon: Terminal,
      disabled: !currentTargetLabel,
    },
    {
      id: 'new',
      label: 'New Claude session',
      hint: 'Starts a fresh terminal with the review as its prompt',
      icon: Sparkles,
      disabled: false,
    },
  ];

  return (
    <div className="border-t border-border/60 bg-card/60 backdrop-blur-sm px-3 py-2 shrink-0">
      <div className="flex items-center gap-2 mb-2">
        <MessageSquare className="h-3.5 w-3.5 text-sky-400" />
        <span className="text-xs font-medium text-foreground">
          {pendingCount} {pendingCount === 1 ? 'comment' : 'comments'} ready
        </span>
        <span className="text-[11px] text-muted-foreground truncate">→ {targetName}</span>
      </div>

      <div className="flex items-end gap-2">
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send();
          }}
          placeholder="Extra instructions (optional)…"
          rows={1}
          className="flex-1 min-h-[32px] max-h-24 rounded-md border border-input bg-background px-2 py-1.5 text-xs resize-y focus:outline-none focus:ring-1 focus:ring-ring placeholder:text-muted-foreground"
        />

        <div className="relative flex shrink-0" ref={menuRef}>
          <button
            onClick={send}
            disabled={isPending}
            className="flex items-center gap-1.5 h-8 rounded-l-md bg-primary px-2.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            Send
          </button>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            disabled={isPending}
            className="flex items-center h-8 rounded-r-md bg-primary px-1.5 text-primary-foreground border-l border-primary-foreground/20 hover:bg-primary/90 disabled:opacity-50"
            title="Choose where to send"
          >
            <ChevronUp className={cn('h-3.5 w-3.5 transition-transform', menuOpen && 'rotate-180')} />
          </button>

          {menuOpen && (
            <div className="absolute bottom-full right-0 mb-1 w-72 rounded-lg border border-border bg-card shadow-xl overflow-hidden z-40">
              {options.map((option) => (
                <button
                  key={option.id}
                  disabled={option.disabled}
                  onClick={() => {
                    setTarget(option.id);
                    setMenuOpen(false);
                  }}
                  className={cn(
                    'flex items-start gap-2 w-full px-3 py-2 text-left hover:bg-accent transition-colors',
                    option.disabled && 'opacity-40 cursor-not-allowed hover:bg-transparent'
                  )}
                >
                  <option.icon className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="text-xs font-medium truncate">{option.label}</div>
                    <div className="text-[11px] text-muted-foreground">{option.hint}</div>
                  </div>
                  {target === option.id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

import type { ReactNode } from 'react';
import { FolderOpen, Server, TerminalSquare, X } from 'lucide-react';
import { AIModelIcon, detectAIModel } from '@/components/AIModelIcon';
import { cn } from '@/lib/utils';

// The session page's top tab: a pill. Split views use the same one for each pane.

export interface TabData {
  id: string;
  label: string;
  type: string;
  pinned?: boolean;
  color?: string;
}

function StatusDot({ color = '#22c55e' }: { color?: string }) {
  return (
    <span
      className="size-3 rounded-full shrink-0"
      style={{
        background: `radial-gradient(circle at 35% 30%, ${color}, ${color}88)`,
        boxShadow: `0 0 5px ${color}66`,
      }}
    />
  );
}

export function getTabAccent(tab: TabData): string {
  if (tab.type === 'process') return tab.color ?? '#22c55e';
  if (tab.type === 'opencode') return '#38bdf8';
  if (tab.type === 'kimi') return '#1783FF';
  if (tab.type === 'project') return '#60a5fa';
  if (tab.type === 'shell') return '#94a3b8';
  if (tab.type === 'ssh') return '#a78bfa';
  if (tab.type === 'claude') {
    const model = detectAIModel(tab.label);
    if (model === 'gemini') return '#4285F4';
    if (model === 'openai' || model === 'codex') return '#10a37f';
    return '#D97757';
  }
  return '#94a3b8';
}

export function TabItem({
  tab,
  isActive,
  onActivate,
  onClose,
  compact,
  chip,
  icon,
}: {
  tab: TabData;
  isActive: boolean;
  onActivate: () => void;
  onClose?: () => void;
  compact?: boolean;
  /** Shown before the label: the session chip of a split view tab. */
  chip?: ReactNode;
  /** Replaces the icon of the tab type. */
  icon?: ReactNode;
}) {
  const accent = getTabAccent(tab);

  const typeIcon = tab.type === 'claude' ? (
    <AIModelIcon model={detectAIModel(tab.label)} size={13} />
  ) : tab.type === 'opencode' ? (
    <AIModelIcon model="opencode" size={13} />
  ) : tab.type === 'kimi' ? (
    <AIModelIcon model="kimi" size={13} />
  ) : tab.type === 'process' ? (
    <StatusDot color={tab.color ?? '#22c55e'} />
  ) : tab.type === 'project' ? (
    <FolderOpen className="size-3 text-muted-foreground shrink-0" />
  ) : tab.type === 'ssh' ? (
    <Server className="size-3 text-muted-foreground shrink-0" />
  ) : (
    <TerminalSquare className="size-3 text-muted-foreground shrink-0" />
  );

  // Active: secondary pulled toward gray (desaturated) with a faint accent tint and a
  // half-transparent accent border.
  const activeBg = `linear-gradient(135deg, ${accent}00 0%, ${accent}08 100%), color-mix(in oklab, hsl(var(--secondary)) 80%, gray)`;
  const activeBorderColor = `color-mix(in srgb, color-mix(in srgb, ${accent} 20%, hsl(var(--border))) 45%, transparent)`;

  return (
    <div
      onClick={onActivate}
      className={cn(
        'group relative flex items-center rounded-[8px] select-none overflow-hidden',
        'border transition-colors duration-150',
        compact ? 'gap-1 h-[26px] px-2' : 'gap-1.5 h-[28px] px-3',
        isActive
          ? 'text-foreground'
          // foreground/4%: a hair lighter on dark themes, a hair darker on light ones
          : 'border-transparent bg-foreground/[0.04] text-muted-foreground hover:text-foreground hover:bg-foreground/[0.07]'
      )}
      style={{
        maxWidth: compact ? 150 : 200,
        background: isActive ? activeBg : undefined,
        borderColor: isActive ? activeBorderColor : undefined,
      }}
    >
      {icon ?? typeIcon}
      {chip}

      {isActive ? (
        <span
          className="text-[11px] font-medium truncate flex-1 min-w-0 leading-4 select-none"
          style={{
            // backgroundImage, not the background shorthand: a re-render with a new
            // accent would reset the clip and paint a solid box.
            backgroundImage: `linear-gradient(to right, color-mix(in srgb, ${accent} 70%, hsl(var(--foreground))), hsl(var(--foreground)))`,
            WebkitBackgroundClip: 'text',
            backgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {tab.label}
        </span>
      ) : (
        <span className="text-[11px] font-medium truncate flex-1 min-w-0 leading-4">
          {tab.label}
        </span>
      )}

      {!tab.pinned && onClose && (
        <button
          // display:none until hover, so the label's ellipsis uses that space
          className="hidden group-hover:flex items-center justify-center size-3 rounded-full bg-foreground/10 hover:bg-foreground/20 text-foreground/60 hover:text-foreground shrink-0 ml-0.5"
          onClick={(e) => { e.stopPropagation(); onClose(); }}
        >
          <X className="size-2" />
        </button>
      )}
    </div>
  );
}


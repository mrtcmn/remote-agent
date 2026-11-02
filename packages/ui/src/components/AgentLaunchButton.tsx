import { useState } from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronDown } from 'lucide-react';
import { AIModelIcon } from '@/components/AIModelIcon';
import { cn } from '@/lib/utils';

export const AGENTS = [
  { type: 'claude', label: 'Claude' },
  { type: 'opencode', label: 'Opencode' },
  { type: 'kimi', label: 'Kimi' },
] as const;

export type AgentType = (typeof AGENTS)[number]['type'];

const STORAGE_KEY = 'session.defaultAgent';

function readDefault(): AgentType {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (AGENTS.some((a) => a.type === v)) return v as AgentType;
  } catch {
    /* localStorage may throw in private mode */
  }
  return 'claude';
}

/** Split button: left half launches the default agent, caret picks another (and makes it the default). */
export function AgentLaunchButton({
  onLaunch,
  disabled,
}: {
  onLaunch: (type: AgentType) => void;
  disabled?: boolean;
}) {
  const [defaultType, setDefaultType] = useState(readDefault);
  const current = AGENTS.find((a) => a.type === defaultType)!;

  function pick(type: AgentType) {
    setDefaultType(type);
    try {
      localStorage.setItem(STORAGE_KEY, type);
    } catch {
      /* ignore */
    }
    onLaunch(type);
  }

  const half =
    'flex items-center my-[2px] text-xs font-medium select-none cursor-pointer shrink-0 transition-colors duration-100 text-muted-foreground hover:text-foreground hover:bg-secondary/60 disabled:opacity-50 disabled:cursor-not-allowed';

  return (
    <div className="flex items-stretch">
      <button
        type="button"
        onClick={() => onLaunch(current.type)}
        disabled={disabled}
        title={`New ${current.label} tab`}
        className={cn(half, 'gap-1.5 pl-2 pr-1.5 rounded-l-md active:scale-95')}
      >
        <AIModelIcon model={current.type} size={14} />
        {current.label}
      </button>
      <div className="w-px self-stretch my-[6px] bg-border/70 shrink-0" />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          disabled={disabled}
          title="Choose agent"
          className={cn(half, 'group px-1.5 rounded-r-md data-[state=open]:bg-secondary/60 data-[state=open]:text-foreground')}
        >
          <ChevronDown className="size-3 transition-transform group-data-[state=open]:rotate-180" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            className="z-[100] min-w-[180px] rounded-md border border-border bg-card shadow-xl py-1"
          >
            {AGENTS.map((a) => (
              <DropdownMenu.Item
                key={a.type}
                onSelect={() => pick(a.type)}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-foreground/90 outline-none cursor-pointer data-[highlighted]:bg-secondary/60"
              >
                <AIModelIcon model={a.type} size={14} />
                <span className="flex-1">{a.label}</span>
                {a.type === defaultType && <Check className="size-3 text-emerald-400" />}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

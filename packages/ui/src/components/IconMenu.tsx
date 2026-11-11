import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export type MenuEntry =
  | 'divider'
  | {
      icon?: React.ReactNode;
      label: string;
      hint?: string;
      onSelect?: () => void;
      active?: boolean;
      disabled?: boolean;
      /** Opens a submenu instead of acting. */
      sub?: MenuEntry[];
      /** Text shown when `sub` is empty. */
      empty?: string;
    };

const contentCls =
  'z-[100] min-w-[200px] max-h-[70vh] overflow-y-auto rounded-md border border-border bg-card shadow-xl py-1';
const itemCls =
  'flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-foreground/90 outline-none cursor-pointer select-none data-[highlighted]:bg-secondary/60 data-[state=open]:bg-secondary/60 data-[disabled]:opacity-40 data-[disabled]:cursor-not-allowed';

function Entries({ entries }: { entries: MenuEntry[] }) {
  return (
    <>
      {entries.map((e, i) => {
        if (e === 'divider') return <DropdownMenu.Separator key={i} className="my-1 h-px bg-border/60" />;
        const body = (
          <>
            <span className="flex size-3.5 items-center justify-center shrink-0 [&>svg]:size-3.5">{e.icon}</span>
            <span className="flex-1 min-w-0 truncate">{e.label}</span>
            {e.hint && <span className="text-[10px] font-mono text-muted-foreground">{e.hint}</span>}
            {e.active && <Check className="size-3 text-emerald-400" />}
          </>
        );
        if (e.sub) {
          return (
            <DropdownMenu.Sub key={i}>
              <DropdownMenu.SubTrigger disabled={e.disabled} className={itemCls}>
                {body}
                <ChevronRight className="size-3 text-muted-foreground" />
              </DropdownMenu.SubTrigger>
              <DropdownMenu.Portal>
                <DropdownMenu.SubContent sideOffset={4} className={contentCls}>
                  {e.sub.length === 0 && e.empty && (
                    <div className="px-3 py-1.5 text-xs text-muted-foreground">{e.empty}</div>
                  )}
                  <Entries entries={e.sub} />
                </DropdownMenu.SubContent>
              </DropdownMenu.Portal>
            </DropdownMenu.Sub>
          );
        }
        return (
          <DropdownMenu.Item key={i} disabled={e.disabled} onSelect={e.onSelect} className={itemCls}>
            {body}
          </DropdownMenu.Item>
        );
      })}
    </>
  );
}

/** An icon-only button that opens a menu. Used by the session top bar ("+" and "⋯"). */
export function IconMenu({
  icon,
  title,
  entries,
  align = 'start',
  side = 'bottom',
  active,
}: {
  icon: React.ReactNode;
  title: string;
  entries: MenuEntry[];
  align?: 'start' | 'end';
  side?: 'bottom' | 'left';
  /** Highlights the trigger while one of its panels is open. */
  active?: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger
        title={title}
        aria-label={title}
        className={cn(
          'flex items-center justify-center size-7 rounded-md shrink-0 transition-colors electrobun-webkit-app-region-no-drag',
          'text-muted-foreground hover:text-foreground hover:bg-secondary/60 data-[state=open]:bg-secondary/80 data-[state=open]:text-foreground',
          active && 'text-foreground bg-secondary/60',
        )}
      >
        {icon}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side={side} align={align} sideOffset={4} className={contentCls}>
          <Entries entries={entries} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

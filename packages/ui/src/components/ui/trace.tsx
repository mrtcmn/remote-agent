import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

// Port of shadcn's Trace (https://ui.shadcn.com/docs/components/base/trace) to
// Tailwind 3. ponytail: the collapsible is a context + button instead of
// @radix-ui/react-collapsible — same API, no new dependency.

function Trace({ className, ...props }: React.ComponentProps<'div'>) {
  return <div data-slot="trace" className={cn('flex w-full min-w-0 flex-col gap-1.5', className)} {...props} />;
}

function TraceLine({
  className,
  status,
  ...props
}: React.ComponentProps<'span'> & { status?: 'running' | 'error' | 'pending' }) {
  return (
    <span
      data-slot="trace-line"
      data-status={status}
      className={cn(
        'group/trace-line flex w-fit max-w-full min-w-0 items-center gap-2 text-xs text-muted-foreground transition-colors',
        'data-[status=error]:text-destructive data-[status=pending]:opacity-60',
        className
      )}
      {...props}
    />
  );
}

function TraceIcon({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="trace-icon"
      aria-hidden="true"
      className={cn('flex size-3.5 shrink-0 items-center justify-center [&_svg]:pointer-events-none [&_svg]:size-3.5', className)}
      {...props}
    />
  );
}

function TraceTitle({ className, ...props }: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="trace-title"
      className={cn('min-w-0 truncate group-data-[status=running]/trace-line:trace-shimmer', className)}
      {...props}
    />
  );
}

function TraceDescription({ className, ...props }: React.ComponentProps<'span'>) {
  return <span data-slot="trace-description" className={cn('shrink-0 text-muted-foreground/70 tabular-nums', className)} {...props} />;
}

const CollapsibleCtx = React.createContext<{ open: boolean; setOpen: (o: boolean) => void }>({ open: false, setOpen: () => {} });

function TraceCollapsible({
  className,
  open: openProp,
  defaultOpen = false,
  onOpenChange,
  ...props
}: Omit<React.ComponentProps<'div'>, 'onChange'> & {
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [inner, setInner] = React.useState(defaultOpen);
  const open = openProp ?? inner;
  const setOpen = (o: boolean) => {
    setInner(o);
    onOpenChange?.(o);
  };
  return (
    <CollapsibleCtx.Provider value={{ open, setOpen }}>
      <div data-slot="trace-collapsible" data-state={open ? 'open' : 'closed'} className={cn('flex w-full min-w-0 flex-col', className)} {...props} />
    </CollapsibleCtx.Provider>
  );
}

function TraceCollapsibleTrigger({ className, children, ...props }: React.ComponentProps<'button'>) {
  const { open, setOpen } = React.useContext(CollapsibleCtx);
  return (
    <button
      type="button"
      data-slot="trace-collapsible-trigger"
      aria-expanded={open}
      onClick={() => setOpen(!open)}
      className={cn(
        'group/trigger flex w-fit max-w-full min-w-0 items-center gap-1 rounded-md text-left text-muted-foreground outline-none',
        'hover:text-foreground [&:hover_[data-slot=trace-line]]:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
        className
      )}
      {...props}
    >
      {children}
      <TraceIcon className="transition-transform group-aria-expanded/trigger:rotate-90">
        <ChevronRight />
      </TraceIcon>
    </button>
  );
}

function TraceCollapsibleContent({ className, children, ...props }: React.ComponentProps<'div'>) {
  const { open } = React.useContext(CollapsibleCtx);
  if (!open) return null;
  return (
    <div
      data-slot="trace-collapsible-content"
      className={cn('mt-1.5 mb-1 ml-[7px] min-w-0 border-l border-border pl-3 pr-1 text-xs leading-relaxed break-words text-muted-foreground', className)}
      {...props}
    >
      {children}
    </div>
  );
}

export {
  Trace,
  TraceLine,
  TraceIcon,
  TraceTitle,
  TraceDescription,
  TraceCollapsible,
  TraceCollapsibleTrigger,
  TraceCollapsibleContent,
};

import * as React from 'react';
import { cn } from '@/lib/utils';

function ToolbarRoot({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="toolbar"
      className={cn(
        'flex items-stretch w-full select-none shrink-0',
        'bg-card border-t border-border',
        className
      )}
      style={{ height: 28 }}
      {...props}
    >
      {children}
    </div>
  );
}

function ToolbarGroup({
  className,
  align = 'left',
  children,
  ...props
}: React.ComponentProps<'div'> & { align?: 'left' | 'right' }) {
  return (
    <div
      data-slot="toolbar-group"
      className={cn('flex items-stretch', align === 'right' && 'ml-auto', className)}
      {...props}
    >
      {children}
    </div>
  );
}

function ToolbarDivider({ className }: { className?: string }) {
  return (
    <div
      data-slot="toolbar-divider"
      className={cn('w-px my-[5px] bg-border shrink-0', className)}
    />
  );
}

function ToolbarItem({
  icon: Icon,
  label,
  value,
  className,
  children,
  ...props
}: React.ComponentProps<'button'> & {
  icon?: React.ElementType;
  label?: React.ReactNode;
  value?: React.ReactNode;
}) {
  return (
    <button
      data-slot="toolbar-item"
      className={cn(
        'flex items-center gap-1 px-2 h-full',
        'text-[10.5px] font-mono leading-none tracking-tight',
        'text-muted-foreground hover:text-foreground hover:bg-secondary',
        'transition-colors duration-75 cursor-default outline-none',
        className
      )}
      {...props}
    >
      {Icon && <Icon className="size-[11px] shrink-0" />}
      {label !== undefined && <span>{label}</span>}
      {value !== undefined && <span className="text-muted-foreground/50">{value}</span>}
      {children}
    </button>
  );
}

type StatusVariant = 'green' | 'yellow' | 'red' | 'blue' | 'gray';

const STATUS_DOT: Record<StatusVariant, string> = {
  green: 'bg-emerald-400 shadow-[0_0_4px_theme(colors.emerald.400)]',
  yellow: 'bg-yellow-400 shadow-[0_0_4px_theme(colors.yellow.400)]',
  red: 'bg-red-400 shadow-[0_0_4px_theme(colors.red.400)]',
  blue: 'bg-blue-400 shadow-[0_0_4px_theme(colors.blue.400)]',
  gray: 'bg-foreground/30',
};

function ToolbarStatus({
  status = 'gray',
  label,
  pulse,
  className,
  ...props
}: React.ComponentProps<'button'> & {
  status?: StatusVariant;
  label?: string;
  pulse?: boolean;
}) {
  return (
    <button
      data-slot="toolbar-status"
      className={cn(
        'flex items-center gap-1.5 px-2 h-full',
        'text-[10.5px] font-mono leading-none tracking-tight',
        'text-muted-foreground hover:text-foreground hover:bg-secondary',
        'transition-colors duration-75 cursor-default outline-none',
        className
      )}
      {...props}
    >
      <span className="relative flex size-[6px] shrink-0">
        {pulse && (
          <span
            className={cn(
              'animate-ping absolute inline-flex h-full w-full rounded-full opacity-50',
              STATUS_DOT[status].split(' ')[0]
            )}
          />
        )}
        <span className={cn('relative inline-flex rounded-full size-[6px]', STATUS_DOT[status])} />
      </span>
      {label && <span>{label}</span>}
    </button>
  );
}

export { ToolbarRoot, ToolbarGroup, ToolbarDivider, ToolbarItem, ToolbarStatus };
export type { StatusVariant };

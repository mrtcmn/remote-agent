import type { ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A settings group: heading and description sit above, the controls live in one card below. */
export function SettingsSection({
  icon: Icon,
  title,
  description,
  className,
  children,
}: {
  icon: ComponentType<{ className?: string }>;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-start gap-3 px-1">
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-border/60 bg-gradient-to-b from-secondary to-card text-muted-foreground shadow-sm">
          <Icon className="size-4" />
        </div>
        <div className="min-w-0 pt-0.5">
          <h2 className="text-[15px] font-semibold leading-tight tracking-tight">{title}</h2>
          {description && (
            <div className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{description}</div>
          )}
        </div>
      </div>
      <div
        className={cn(
          'rounded-xl border border-border/70 bg-gradient-to-b from-card to-card/70 p-5 shadow-sm',
          className,
        )}
      >
        {children}
      </div>
    </section>
  );
}

/** One line in a section: what it is on the left, the control on the right. */
export function SettingsRow({
  label,
  description,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 border-b border-border/60 py-4 first:pt-0 last:border-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description && <div className="mt-0.5 text-[13px] text-muted-foreground">{description}</div>}
      </div>
      {children && <div className="flex shrink-0 items-center gap-2 sm:justify-end">{children}</div>}
    </div>
  );
}

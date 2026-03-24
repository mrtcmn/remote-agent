import { cn } from '@/lib/utils';

interface SlideSkeletonProps {
  title?: string;
  fileCount?: number;
  className?: string;
}

export function SlideSkeleton({ title, fileCount = 2, className }: SlideSkeletonProps) {
  return (
    <div className={cn('rounded-lg border border-border bg-card p-6 space-y-4', className)}>
      {/* Title */}
      {title ? (
        <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      ) : (
        <div className="h-6 w-2/3 rounded bg-muted animate-pulse" />
      )}

      {/* File chips */}
      <div className="flex gap-2 flex-wrap">
        {Array.from({ length: fileCount }).map((_, i) => (
          <div key={i} className="h-5 w-32 rounded-full bg-muted animate-pulse" />
        ))}
      </div>

      {/* Narrative placeholder */}
      <div className="space-y-2">
        <div className="h-4 w-full rounded bg-muted animate-pulse" />
        <div className="h-4 w-5/6 rounded bg-muted animate-pulse" />
        <div className="h-4 w-3/4 rounded bg-muted animate-pulse" />
      </div>

      {/* Diff placeholder */}
      <div className="rounded border border-border bg-muted/50 p-4 space-y-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-3.5 rounded bg-muted animate-pulse" style={{ width: `${60 + Math.random() * 35}%` }} />
        ))}
      </div>
    </div>
  );
}

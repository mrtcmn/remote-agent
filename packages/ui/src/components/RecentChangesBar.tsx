import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';

interface RecentChangesBarProps {
  sessionId: string;
  projectId?: string;
  onOpenFile: (path: string) => void;
}

const STATUS_DOT: Record<string, string> = {
  staged: 'bg-green-500',
  modified: 'bg-yellow-500',
  untracked: 'bg-blue-400',
};

// Recently-touched changed files, newest-first. Own query key ('recent') so the
// plain git-status poll used elsewhere stays plain; only this bar pays the mtime cost.
export function RecentChangesBar({ sessionId, projectId, onOpenFile }: RecentChangesBarProps) {
  const { data } = useQuery({
    queryKey: ['session-git-status', sessionId, projectId, 'recent'],
    queryFn: () => api.getSessionGitStatus(sessionId, projectId, true),
    refetchInterval: 3000,
  });

  const recent = data?.recent ?? [];
  if (recent.length === 0) return null;

  return (
    <div className="h-8 shrink-0 flex items-center gap-1 px-2 border-t bg-card/30 overflow-x-auto">
      {recent.map((f) => (
        <button
          key={f.path}
          onClick={() => onOpenFile(f.path)}
          title={f.path}
          className={cn(
            'flex items-center gap-1.5 shrink-0 px-2 py-0.5 rounded text-xs font-mono',
            'text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors'
          )}
        >
          <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', STATUS_DOT[f.status])} />
          <span className="truncate max-w-[14rem]">{f.path.split('/').pop()}</span>
        </button>
      ))}
    </div>
  );
}

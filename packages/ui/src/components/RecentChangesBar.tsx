import { useQuery } from '@tanstack/react-query';
import { History } from 'lucide-react';
import { api, type RecentChange } from '@/lib/api';
import { MarqueeText } from '@/components/ui/MarqueeText';

interface RecentChangesBarProps {
  sessionId: string;
  projectId?: string;
  onOpenFile: (path: string) => void;
}

function timeAgo(ms: number): string {
  const m = Math.floor((Date.now() - ms) / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function FileChip({ file, onOpen }: { file: RecentChange; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      title={file.path}
      className="flex flex-col items-start justify-center shrink-0 px-1.5 py-0.5 rounded text-left text-muted-foreground hover:text-foreground hover:bg-accent/50 transition-colors"
    >
      <MarqueeText
        text={file.path.split('/').pop() ?? file.path}
        className="max-w-[8rem] text-[9px] font-mono leading-tight"
      />
      <span className="text-[8px] leading-tight text-muted-foreground/60">{timeAgo(file.mtimeMs)}</span>
    </button>
  );
}

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
    <div className="h-8 shrink-0 flex items-center gap-0.5 px-2 border-b border-border overflow-x-auto scrollbar-hide">
      <span className="flex items-center gap-1 pr-2 mr-0.5 border-r border-border/60 text-[8px] font-semibold uppercase tracking-wider text-muted-foreground/60 shrink-0">
        <History className="size-2.5" />
        Recent
      </span>
      {recent.map((f) => (
        <FileChip key={f.path} file={f} onOpen={() => onOpenFile(f.path)} />
      ))}
    </div>
  );
}

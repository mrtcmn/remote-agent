import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Loader2,
  GitCommit,
  GitMerge,
  ChevronDown,
  ChevronRight,
  Tag,
} from 'lucide-react';
import { api, type GitLogEntry } from '@/lib/api';
import { cn } from '@/lib/utils';

interface GitLogTabProps {
  sessionId: string;
  projectId?: string;
}

export function GitLogTab({ sessionId, projectId }: GitLogTabProps) {
  const [expandedCommit, setExpandedCommit] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['session-git-log', sessionId, projectId],
    queryFn: () => api.getSessionGitLog(sessionId, 50, projectId),
    refetchInterval: 10000,
  });

  const commits = data?.commits || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (commits.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <GitCommit className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-xs font-mono">No commits yet</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="divide-y divide-border/30">
        {commits.map((commit) => (
          <CommitRow
            key={commit.hash}
            commit={commit}
            isExpanded={expandedCommit === commit.hash}
            onToggle={() => setExpandedCommit(expandedCommit === commit.hash ? null : commit.hash)}
          />
        ))}
      </div>
    </div>
  );
}

function CommitRow({
  commit, isExpanded, onToggle,
}: {
  commit: GitLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const isMerge = commit.parents.length > 1;
  const relativeDate = getRelativeDate(commit.date);

  const refBadges = commit.refs.map((ref) => {
    if (ref.startsWith('HEAD -> ')) {
      return { label: ref.replace('HEAD -> ', ''), type: 'head' as const };
    }
    if (ref === 'HEAD') {
      return { label: 'HEAD', type: 'head' as const };
    }
    if (ref.startsWith('tag: ')) {
      return { label: ref.replace('tag: ', ''), type: 'tag' as const };
    }
    if (ref.startsWith('origin/')) {
      return { label: ref, type: 'remote' as const };
    }
    return { label: ref, type: 'branch' as const };
  });

  return (
    <div>
      <button
        onClick={onToggle}
        className="flex items-start gap-2 w-full px-4 py-2.5 text-left hover:bg-accent/30 transition-colors"
      >
        <div className="pt-0.5 shrink-0">
          {isMerge ? (
            <GitMerge className="h-3.5 w-3.5 text-purple-400" />
          ) : (
            <GitCommit className="h-3.5 w-3.5 text-muted-foreground" />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-[11px] text-primary/70 shrink-0">{commit.shortHash}</span>
            {refBadges.map((badge, i) => (
              <span key={i} className={cn(
                'text-[10px] font-semibold px-1.5 py-0.5 rounded',
                badge.type === 'head' && 'bg-green-500/20 text-green-400',
                badge.type === 'tag' && 'bg-yellow-500/20 text-yellow-400',
                badge.type === 'remote' && 'bg-blue-500/20 text-blue-400',
                badge.type === 'branch' && 'bg-purple-500/20 text-purple-400',
              )}>
                {badge.type === 'tag' && <Tag className="h-2.5 w-2.5 inline mr-0.5" />}
                {badge.label}
              </span>
            ))}
          </div>
          <p className="text-xs text-foreground mt-0.5 truncate">{commit.message}</p>
          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-muted-foreground">
            <span>{commit.author}</span>
            <span>·</span>
            <span>{relativeDate}</span>
          </div>
        </div>

        <div className="pt-1 shrink-0">
          {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        </div>
      </button>

      {isExpanded && (
        <div className="px-4 pb-3 pl-10 space-y-1.5">
          <div className="text-[10px] text-muted-foreground font-mono space-y-0.5">
            <p><span className="text-muted-foreground/60">commit</span> <span className="text-foreground/80">{commit.hash}</span></p>
            {isMerge && (
              <p><span className="text-muted-foreground/60">merge</span> <span className="text-foreground/80">{commit.parents.map(p => p.substring(0, 7)).join(' ')}</span></p>
            )}
            <p><span className="text-muted-foreground/60">author</span> <span className="text-foreground/80">{commit.author}</span></p>
            <p><span className="text-muted-foreground/60">date</span> <span className="text-foreground/80">{new Date(commit.date).toLocaleString()}</span></p>
          </div>
        </div>
      )}
    </div>
  );
}

function getRelativeDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  return date.toLocaleDateString();
}

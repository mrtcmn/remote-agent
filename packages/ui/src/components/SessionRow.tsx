import { useNavigate, useParams } from 'react-router-dom';
import { MessageCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { SidebarSession } from '@/lib/api';

interface SessionRowProps {
  session: SidebarSession;
}

const statusColors: Record<string, string> = {
  active: 'bg-blue-500',
  waiting_input: 'border border-orange-500 bg-transparent',
  paused: 'bg-gray-500',
  terminated: 'bg-red-500',
};

export function SessionRow({ session }: SessionRowProps) {
  const navigate = useNavigate();
  const params = useParams();
  const isSelected = params.id === session.id;

  const displayName = session.branchName || session.id.slice(0, 8);
  const dotClass = statusColors[session.liveStatus] || statusColors[session.status] || 'bg-gray-500';

  return (
    <button
      onClick={() => navigate(`/sessions/${session.id}`)}
      className={cn(
        'w-full text-left px-3 py-2.5 md:py-1.5 rounded-sm transition-colors group',
        'hover:bg-sidebar-accent active:bg-sidebar-accent',
        isSelected && 'bg-primary/15 border-l-2 border-primary'
      )}
    >
      {/* Line 1: Status dot + branch name */}
      <div className="flex items-center gap-2 min-w-0">
        <span className={cn('w-2 h-2 rounded-full shrink-0', dotClass)} />
        <span className="text-xs font-mono truncate text-sidebar-foreground">
          {displayName}
        </span>
      </div>

      {/* Line 2: Diff stats + comment count */}
      {(session.diffStats || session.commentCount > 0) && (
        <div className="flex items-center gap-2 ml-4 mt-0.5 text-[10px] font-mono">
          {session.diffStats && (
            <>
              <span className="text-green-500">+{session.diffStats.additions}</span>
              <span className="text-red-500">-{session.diffStats.deletions}</span>
            </>
          )}
          {session.commentCount > 0 && (
            <span className="flex items-center gap-0.5 text-muted-foreground">
              <MessageCircle className="h-2.5 w-2.5" />
              {session.commentCount}
            </span>
          )}
        </div>
      )}
    </button>
  );
}

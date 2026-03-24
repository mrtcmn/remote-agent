import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GitBranch,
  ArrowDown,
  ArrowUp,
  RefreshCw,
  ChevronDown,
  Check,
  Loader2,
  Presentation,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toaster';

interface GitToolbarProps {
  sessionId: string;
  onReview?: () => void;
}

export function GitToolbar({ sessionId, onReview }: GitToolbarProps) {
  const queryClient = useQueryClient();
  const [showBranchDropdown, setShowBranchDropdown] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { data: gitStatus } = useQuery({
    queryKey: ['session-git-status', sessionId],
    queryFn: () => api.getSessionGitStatus(sessionId),
    refetchInterval: 3000,
  });

  const { data: branches } = useQuery({
    queryKey: ['session-git-branches', sessionId],
    queryFn: () => api.getSessionGitBranches(sessionId),
    enabled: showBranchDropdown,
  });

  const invalidateGit = () => {
    queryClient.invalidateQueries({ queryKey: ['session-git-status', sessionId] });
    queryClient.invalidateQueries({ queryKey: ['session-git-log', sessionId] });
    queryClient.invalidateQueries({ queryKey: ['session-git-branches', sessionId] });
  };

  const checkoutMutation = useMutation({
    mutationFn: (branch: string) => api.gitCheckout(sessionId, branch),
    onSuccess: () => {
      invalidateGit();
      setShowBranchDropdown(false);
      toast({ title: 'Branch switched' });
    },
    onError: (e) => toast({ title: 'Checkout failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const pullMutation = useMutation({
    mutationFn: () => api.gitSessionPull(sessionId),
    onSuccess: () => {
      invalidateGit();
      toast({ title: 'Pulled successfully' });
    },
    onError: (e) => toast({ title: 'Pull failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const pushMutation = useMutation({
    mutationFn: () => api.gitSessionPush(sessionId),
    onSuccess: () => {
      invalidateGit();
      toast({ title: 'Pushed successfully' });
    },
    onError: (e) => toast({ title: 'Push failed', description: (e as Error).message, variant: 'destructive' }),
  });

  const fetchMutation = useMutation({
    mutationFn: () => api.gitSessionFetch(sessionId),
    onSuccess: () => {
      invalidateGit();
      toast({ title: 'Fetched successfully' });
    },
    onError: (e) => toast({ title: 'Fetch failed', description: (e as Error).message, variant: 'destructive' }),
  });

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowBranchDropdown(false);
      }
    };
    if (showBranchDropdown) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showBranchDropdown]);

  const isAnyPending = pullMutation.isPending || pushMutation.isPending || fetchMutation.isPending || checkoutMutation.isPending;

  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b bg-card/30 shrink-0">
      <div className="relative" ref={dropdownRef}>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5 h-8 font-mono text-xs"
          onClick={() => setShowBranchDropdown(!showBranchDropdown)}
          disabled={checkoutMutation.isPending}
        >
          <GitBranch className="h-3.5 w-3.5" />
          <span className="max-w-32 truncate">{gitStatus?.branch || '...'}</span>
          <ChevronDown className="h-3 w-3" />
        </Button>

        {showBranchDropdown && (
          <div className="absolute top-full left-0 mt-1 w-64 bg-card border rounded-md shadow-lg z-30 max-h-64 overflow-y-auto">
            <div className="px-3 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b">
              Local Branches
            </div>
            {branches?.local.map((branch) => (
              <button
                key={branch}
                className={cn(
                  'flex items-center gap-2 w-full px-3 py-1.5 text-left text-xs font-mono hover:bg-accent',
                  branch === branches.current && 'bg-accent/50'
                )}
                onClick={() => {
                  if (branch !== branches.current) {
                    checkoutMutation.mutate(branch);
                  }
                }}
              >
                {branch === branches.current ? (
                  <Check className="h-3 w-3 text-green-500 shrink-0" />
                ) : (
                  <div className="w-3" />
                )}
                <span className="truncate">{branch}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {gitStatus && (gitStatus.ahead > 0 || gitStatus.behind > 0) && (
        <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
          {gitStatus.ahead > 0 && (
            <span className="flex items-center gap-0.5">
              <ArrowUp className="h-3 w-3" />
              {gitStatus.ahead}
            </span>
          )}
          {gitStatus.behind > 0 && (
            <span className="flex items-center gap-0.5">
              <ArrowDown className="h-3 w-3" />
              {gitStatus.behind}
            </span>
          )}
        </div>
      )}

      <div className="flex-1" />

      {onReview && (
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 h-8 px-2.5 text-xs"
          onClick={onReview}
          title="Review changes"
        >
          <Presentation className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Review</span>
        </Button>
      )}

      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 h-8 px-2.5 text-xs"
        onClick={() => pullMutation.mutate()}
        disabled={isAnyPending}
        title="Pull"
      >
        {pullMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowDown className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">Pull</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 h-8 px-2.5 text-xs"
        onClick={() => pushMutation.mutate()}
        disabled={isAnyPending}
        title="Push"
      >
        {pushMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">Push</span>
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 h-8 px-2.5 text-xs"
        onClick={() => fetchMutation.mutate()}
        disabled={isAnyPending}
        title="Fetch"
      >
        {fetchMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        <span className="hidden sm:inline">Fetch</span>
      </Button>
    </div>
  );
}

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Loader2,
  GitBranch,
  Check,
  ArrowRight,
  Globe,
} from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toaster';

interface GitBranchesTabProps {
  sessionId: string;
  projectId?: string;
}

export function GitBranchesTab({ sessionId, projectId }: GitBranchesTabProps) {
  const queryClient = useQueryClient();

  const { data: branches, isLoading } = useQuery({
    queryKey: ['session-git-branches', sessionId, projectId],
    queryFn: () => api.getSessionGitBranches(sessionId, projectId),
    refetchInterval: 10000,
  });

  const checkoutMutation = useMutation({
    mutationFn: (branch: string) => api.gitCheckout(sessionId, branch, undefined, projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['session-git-status', sessionId, projectId] });
      queryClient.invalidateQueries({ queryKey: ['session-git-branches', sessionId, projectId] });
      queryClient.invalidateQueries({ queryKey: ['session-git-log', sessionId, projectId] });
      toast({ title: 'Branch switched' });
    },
    onError: (e) => toast({ title: 'Checkout failed', description: (e as Error).message, variant: 'destructive' }),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!branches) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground">
        <GitBranch className="h-8 w-8 mb-2 opacity-30" />
        <p className="text-xs font-mono">No branches found</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      {/* Local Branches */}
      <div>
        <div className="px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b bg-card/20">
          Local Branches ({branches.local.length})
        </div>
        <div className="divide-y divide-border/20">
          {branches.local.map((branch) => {
            const isCurrent = branch === branches.current;
            return (
              <div key={branch} className={cn(
                'flex items-center gap-3 px-4 py-2.5 text-sm group',
                isCurrent && 'bg-accent/20'
              )}>
                <GitBranch className={cn('h-3.5 w-3.5 shrink-0', isCurrent ? 'text-green-500' : 'text-muted-foreground')} />
                <span className={cn('flex-1 font-mono text-xs truncate', isCurrent && 'font-semibold')}>
                  {branch}
                </span>
                {isCurrent ? (
                  <span className="flex items-center gap-1 text-[10px] text-green-500">
                    <Check className="h-3 w-3" />current
                  </span>
                ) : (
                  <Button variant="ghost" size="sm"
                    className="h-6 text-[10px] px-2 opacity-0 group-hover:opacity-100"
                    onClick={() => checkoutMutation.mutate(branch)}
                    disabled={checkoutMutation.isPending}>
                    <ArrowRight className="h-3 w-3 mr-1" />Checkout
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Remote Branches */}
      {branches.remote.length > 0 && (
        <div>
          <div className="px-4 py-2 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-t bg-card/20">
            Remote Branches ({branches.remote.length})
          </div>
          <div className="divide-y divide-border/20">
            {branches.remote.map((branch) => (
              <div key={branch} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                <Globe className="h-3.5 w-3.5 shrink-0 text-blue-400" />
                <span className="flex-1 font-mono text-xs truncate text-muted-foreground">{branch}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

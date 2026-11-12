import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpCircle, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toaster';

/**
 * The update button of one machine. It asks that machine itself, through the
 * machine proxy, so it shows nothing for a machine too old to have the endpoint.
 */
export function UpdateControl({ machineId, showVersion = false }: { machineId: string; showVersion?: boolean }) {
  const queryClient = useQueryClient();
  const [showLog, setShowLog] = useState(false);
  // The app restarts in the middle of an update, so some polls fail; keep the button busy through them.
  const [started, setStarted] = useState(false);

  const { data } = useQuery({
    queryKey: ['update-status', machineId],
    queryFn: () => api.getUpdateStatus(machineId),
    refetchInterval: (q) => (started || q.state.data?.state === 'running' ? 3_000 : 60_000),
    retry: false,
  });

  const start = useMutation({
    mutationFn: () => api.startUpdate(machineId),
    onSuccess: () => {
      setStarted(true);
      setShowLog(true);
      queryClient.invalidateQueries({ queryKey: ['update-status', machineId] });
    },
    onError: (err) => toast({ title: 'Update not started', description: (err as Error).message, variant: 'destructive' }),
  });

  const running = !!data && (data.state === 'running'
    || (started && data.updateAvailable && data.state !== 'failed' && data.state !== 'rolled-back'));
  useEffect(() => {
    if (!started || running || !data) return;
    setStarted(false);
    queryClient.invalidateQueries({ queryKey: ['machines'] });
    queryClient.invalidateQueries({ queryKey: ['network-map'] });
    queryClient.invalidateQueries({ queryKey: ['version'] });
  }, [started, running, data, queryClient]);

  if (!data) return null;
  const problem = data.state === 'failed' || data.state === 'rolled-back';

  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="flex items-center gap-2">
        {showVersion && <span className="text-xs text-muted-foreground">v{data.current}</span>}
        {running ? (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Updating…
          </span>
        ) : data.updateAvailable && data.kind !== 'none' ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={start.isPending}
            onClick={() => {
              if (window.confirm(`Update this machine to ${data.latest}? The app restarts, and its open sessions stop.`)) start.mutate();
            }}
          >
            <ArrowUpCircle className="h-3.5 w-3.5 mr-1" />
            Update to {data.latest}
          </Button>
        ) : data.updateAvailable ? (
          <span className="text-xs text-muted-foreground" title="This install cannot replace itself.">
            {data.latest} is available. Update the app on that machine.
          </span>
        ) : showVersion ? (
          <span className="text-xs text-muted-foreground">up to date</span>
        ) : null}
        {(running || problem) && (
          <button type="button" className="text-xs underline text-muted-foreground" onClick={() => setShowLog((v) => !v)}>
            {showLog ? 'hide log' : 'log'}
          </button>
        )}
      </div>
      {problem && data.updateAvailable && (
        <span className="text-xs text-destructive max-w-xs text-right">
          {data.state === 'rolled-back' ? 'The update failed. The old version runs again.' : 'The update failed.'} {data.detail}
        </span>
      )}
      {showLog && data.log.length > 0 && (
        <pre className="max-h-40 w-80 overflow-auto rounded bg-background border p-2 text-[10px] leading-snug text-left whitespace-pre-wrap">
          {data.log.join('\n')}
        </pre>
      )}
    </div>
  );
}

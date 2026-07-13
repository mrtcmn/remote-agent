import { useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Server, Unplug, RefreshCw, AlertTriangle } from 'lucide-react';
import { api } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { SshTerminal } from '@/components/ssh/SshTerminal';
import { type SshStatus } from '@/hooks/useSshTerminal';
import { toast } from '@/components/ui/Toaster';
import { cn } from '@/lib/utils';

// Session-style page for one SSH connection (/ssh/:sessionId). Hosts live in
// the app sidebar; this page is just the terminal plus a slim toolbar.
export function SshSessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [liveStatus, setLiveStatus] = useState<SshStatus>('connecting');
  const [reconnecting, setReconnecting] = useState(false);

  const { data: session, isError } = useQuery({
    queryKey: ['ssh-session', sessionId],
    queryFn: () => api.getSshSession(sessionId!),
    enabled: !!sessionId,
    retry: false,
  });

  const invalidateSessions = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['ssh-sessions'] });
  }, [queryClient]);

  const reconnect = async () => {
    if (!session) return;
    setReconnecting(true);
    try {
      const { sessionId: newId } = await api.connectSshHost(session.hostId);
      invalidateSessions();
      navigate(`/ssh/${newId}`, { replace: true });
    } catch (err) {
      toast({ title: 'Reconnect failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setReconnecting(false);
    }
  };

  const disconnect = async () => {
    if (!sessionId) return;
    await api.stopSshSession(sessionId).catch(() => {});
    invalidateSessions();
    navigate('/');
  };

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
        <AlertTriangle className="size-8 text-muted-foreground/50" />
        <h2 className="text-sm font-medium">SSH session not found</h2>
        <p className="max-w-sm text-xs text-muted-foreground">
          It may have ended or the server restarted. Reconnect from the SSH list in the sidebar.
        </p>
        <Button variant="outline" size="sm" onClick={() => navigate('/')}>Back to dashboard</Button>
      </div>
    );
  }

  const host = session?.host;
  const ended = liveStatus === 'closed' || session?.status === 'exited';

  return (
    <div className="flex flex-col h-full">
      {/* ── Toolbar — mirrors the session page header ── */}
      <div className="flex items-center h-9 border-b border-border bg-card w-full shrink-0 px-1 electrobun-webkit-app-region-drag">
        <button
          onClick={() => navigate('/')}
          className="flex items-center justify-center w-7 self-stretch my-[2px] rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors electrobun-webkit-app-region-no-drag"
        >
          <ArrowLeft className="size-3.5" />
        </button>
        <div className="flex items-center gap-1.5 px-2 min-w-0">
          <Server className="size-3.5 text-muted-foreground shrink-0" />
          <span className="text-xs font-semibold text-foreground/90 truncate">{host?.label ?? 'SSH'}</span>
          {host && (
            <span className="text-[11px] font-mono text-muted-foreground/60 truncate hidden sm:inline">
              {host.username}@{host.host}:{host.port}
            </span>
          )}
        </div>
        <span
          className={cn(
            'ml-1 w-1.5 h-1.5 rounded-full shrink-0',
            liveStatus === 'connected' && 'bg-emerald-500',
            (liveStatus === 'connecting' || liveStatus === 'reconnecting') && 'bg-yellow-500 animate-pulse',
            liveStatus === 'closed' && 'bg-muted-foreground/40'
          )}
        />
        <div className="ml-auto flex items-center electrobun-webkit-app-region-no-drag">
          {ended ? (
            <button
              onClick={reconnect}
              disabled={reconnecting || !session}
              className="flex items-center gap-1.5 px-2 my-[2px] self-stretch text-xs font-medium rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-50"
            >
              <RefreshCw className={cn('size-3.5', reconnecting && 'animate-spin')} />
              <span className="hidden sm:inline">Reconnect</span>
            </button>
          ) : (
            <button
              onClick={disconnect}
              className="flex items-center gap-1.5 px-2 my-[2px] self-stretch text-xs font-medium rounded-md text-muted-foreground hover:text-destructive hover:bg-secondary/60 transition-colors"
            >
              <Unplug className="size-3.5" />
              <span className="hidden sm:inline">Disconnect</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Terminal ── */}
      <div className="flex-1 min-h-0 relative">
        {sessionId && <SshTerminal key={sessionId} sessionId={sessionId} onStatusChange={setLiveStatus} />}
        {ended && (
          <div className="absolute inset-0 grid place-items-center bg-background/70 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-3">
              <Unplug className="size-8 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">Session ended</p>
              <Button size="sm" onClick={reconnect} disabled={reconnecting || !session} className="gap-1.5">
                <RefreshCw className={cn('size-3.5', reconnecting && 'animate-spin')} />
                Reconnect
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

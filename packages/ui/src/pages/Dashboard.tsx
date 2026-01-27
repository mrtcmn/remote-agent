import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, Terminal, Play, Square, Clock, Loader2 } from 'lucide-react';
import { api, type Session } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toaster';
import { formatRelativeTime, cn } from '@/lib/utils';

const statusColors: Record<string, string> = {
  active: 'bg-green-500',
  running: 'bg-green-500',
  waiting_input: 'bg-yellow-500 animate-pulse',
  paused: 'bg-gray-500',
  terminated: 'bg-red-500',
  idle: 'bg-blue-500',
};

export function DashboardPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: sessions, isLoading } = useQuery({
    queryKey: ['sessions'],
    queryFn: api.getSessions,
    refetchInterval: 5000,
  });

  const createSessionMutation = useMutation({
    mutationFn: api.createSession,
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      navigate(`/sessions/${session.id}`);
    },
    onError: (error) => {
      toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const terminateMutation = useMutation({
    mutationFn: api.terminateSession,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      toast({ title: 'Session terminated' });
    },
  });

  const activeSessions = sessions?.filter((s) => s.status !== 'terminated') || [];
  const recentSessions = sessions?.filter((s) => s.status === 'terminated').slice(0, 5) || [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sessions</h1>
          <p className="text-muted-foreground">Manage your Claude Code sessions</p>
        </div>
        <Button
          onClick={() => createSessionMutation.mutate({})}
          disabled={createSessionMutation.isPending}
          className="gap-2"
        >
          {createSessionMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Plus className="h-4 w-4" />
          )}
          <span className="hidden sm:inline">New Session</span>
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {/* Active Sessions */}
          {activeSessions.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Active</h2>
              <div className="grid gap-3">
                {activeSessions.map((session) => (
                  <SessionCard
                    key={session.id}
                    session={session}
                    onOpen={() => navigate(`/sessions/${session.id}`)}
                    onTerminate={() => terminateMutation.mutate(session.id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {activeSessions.length === 0 && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12">
                <Terminal className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="font-semibold mb-2">No active sessions</h3>
                <p className="text-muted-foreground text-center mb-4">
                  Start a new session to begin coding with Claude
                </p>
                <Button onClick={() => createSessionMutation.mutate({})}>
                  <Plus className="h-4 w-4 mr-2" />
                  New Session
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Recent Sessions */}
          {recentSessions.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-lg font-semibold">Recent</h2>
              <div className="grid gap-2">
                {recentSessions.map((session) => (
                  <div
                    key={session.id}
                    className="flex items-center gap-3 p-3 rounded-lg border bg-card text-sm"
                  >
                    <div className={cn('h-2 w-2 rounded-full', statusColors[session.status])} />
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium">
                        {session.project?.name || 'Workspace Session'}
                      </p>
                      <p className="text-muted-foreground text-xs">
                        {formatRelativeTime(session.lastActiveAt)}
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => navigate(`/sessions/${session.id}`)}
                    >
                      View
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SessionCard({
  session,
  onOpen,
  onTerminate,
}: {
  session: Session;
  onOpen: () => void;
  onTerminate: () => void;
}) {
  const status = session.liveStatus || session.status;

  return (
    <Card className="cursor-pointer hover:border-primary/50 transition-colors" onClick={onOpen}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={cn('h-2.5 w-2.5 rounded-full', statusColors[status])} />
            <CardTitle className="text-base">
              {session.project?.name || 'Workspace Session'}
            </CardTitle>
          </div>
          <div className="flex items-center gap-1">
            <Button size="icon" variant="ghost" onClick={(e) => { e.stopPropagation(); onOpen(); }}>
              <Play className="h-4 w-4" />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={(e) => {
                e.stopPropagation();
                onTerminate();
              }}
            >
              <Square className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardDescription className="flex items-center gap-2">
          <Clock className="h-3 w-3" />
          {formatRelativeTime(session.lastActiveAt)}
          {status === 'waiting_input' && (
            <span className="text-yellow-500 font-medium">Waiting for input</span>
          )}
        </CardDescription>
      </CardHeader>
      {session.lastMessage && (
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground truncate">{session.lastMessage}</p>
        </CardContent>
      )}
    </Card>
  );
}

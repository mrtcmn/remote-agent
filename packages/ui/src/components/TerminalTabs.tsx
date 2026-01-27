import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X, TerminalSquare, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { Terminal } from './Terminal';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface TerminalTabsProps {
  sessionId: string;
  className?: string;
}

export function TerminalTabs({ sessionId, className }: TerminalTabsProps) {
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const { data: terminals = [], isLoading } = useQuery({
    queryKey: ['terminals', sessionId],
    queryFn: () => api.getSessionTerminals(sessionId),
    refetchInterval: 5000,
  });

  const createMutation = useMutation({
    mutationFn: () => api.createTerminal({ sessionId }),
    onSuccess: (terminal) => {
      queryClient.invalidateQueries({ queryKey: ['terminals', sessionId] });
      setActiveTerminalId(terminal.id);
    },
  });

  const closeMutation = useMutation({
    mutationFn: (id: string) => api.closeTerminal(id),
    onSuccess: (_, closedId) => {
      queryClient.invalidateQueries({ queryKey: ['terminals', sessionId] });
      if (activeTerminalId === closedId) {
        const remaining = terminals.filter(t => t.id !== closedId);
        setActiveTerminalId(remaining[0]?.id || null);
      }
    },
  });

  // Auto-select first terminal
  if (!activeTerminalId && terminals.length > 0 && !isLoading) {
    setActiveTerminalId(terminals[0].id);
  }

  const activeTerminal = terminals.find(t => t.id === activeTerminalId);

  return (
    <div className={cn('flex h-full', className)}>
      {/* Vertical tabs sidebar */}
      <div className="w-48 border-r bg-muted/30 flex flex-col">
        <div className="p-2 border-b">
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <Plus className="h-4 w-4" />
            )}
            New Terminal
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {terminals.map((terminal) => (
            <div
              key={terminal.id}
              className={cn(
                'group flex items-center gap-2 px-3 py-2 rounded-md cursor-pointer transition-colors',
                activeTerminalId === terminal.id
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted'
              )}
              onClick={() => setActiveTerminalId(terminal.id)}
            >
              <TerminalSquare className="h-4 w-4 shrink-0" />
              <span className="flex-1 truncate text-sm">{terminal.name}</span>
              <div
                className={cn(
                  'h-2 w-2 rounded-full shrink-0',
                  terminal.liveStatus === 'running' ? 'bg-green-500' : 'bg-gray-500'
                )}
              />
              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  'h-5 w-5 opacity-0 group-hover:opacity-100',
                  activeTerminalId === terminal.id && 'text-primary-foreground hover:text-primary-foreground'
                )}
                onClick={(e) => {
                  e.stopPropagation();
                  closeMutation.mutate(terminal.id);
                }}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          ))}

          {terminals.length === 0 && !isLoading && (
            <div className="text-center text-muted-foreground text-sm py-8">
              No terminals yet
            </div>
          )}
        </div>
      </div>

      {/* Terminal content */}
      <div className="flex-1 p-4">
        {activeTerminal ? (
          <Terminal
            key={activeTerminal.id}
            terminalId={activeTerminal.id}
            className="h-full"
            onExit={() => {
              queryClient.invalidateQueries({ queryKey: ['terminals', sessionId] });
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-muted-foreground">
            {isLoading ? (
              <RefreshCw className="h-6 w-6 animate-spin" />
            ) : (
              <div className="text-center">
                <TerminalSquare className="h-12 w-12 mx-auto mb-4 opacity-50" />
                <p>Create a terminal to get started</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

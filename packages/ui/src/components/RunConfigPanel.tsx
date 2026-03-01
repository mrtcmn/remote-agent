import { useState } from 'react';
import {
  Play,
  Square,
  RotateCw,
  Plus,
  Trash2,
  Wand2,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CreateRunConfigModal } from '@/components/CreateRunConfigModal';
import { useRunConfigs } from '@/hooks/useRunConfigs';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toaster';
import type { RunConfig, RunConfigAdapterType } from '@/lib/api';

interface RunConfigPanelProps {
  projectId: string;
  sessionId: string;
  onTerminalCreated?: (terminalId: string) => void;
}

export function RunConfigPanel({ projectId, sessionId, onTerminalCreated }: RunConfigPanelProps) {
  const {
    runConfigs,
    isLoading,
    scripts,
    create,
    remove,
    start,
    stop,
    restart,
  } = useRunConfigs(projectId);

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [actionPending, setActionPending] = useState<string | null>(null);

  const handleCreate = async (data: {
    name: string;
    adapterType: RunConfigAdapterType;
    command: Record<string, unknown>;
    autoRestart: boolean;
  }) => {
    try {
      await create({ ...data, projectId });
      setShowCreateModal(false);
      toast({ title: 'Run config created', description: data.name });
    } catch (error) {
      toast({
        title: 'Failed to create',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleAutoDetect = async () => {
    if (scripts.length === 0) {
      toast({ title: 'No scripts found', description: 'No package.json scripts detected' });
      return;
    }

    let created = 0;
    const existingNames = new Set(runConfigs.map((c) => c.name));

    for (const script of scripts) {
      if (existingNames.has(script.name)) continue;
      try {
        await create({
          projectId,
          name: script.name,
          adapterType: 'npm_script',
          command: { script: script.name },
        });
        created++;
      } catch {
        // skip
      }
    }

    toast({
      title: 'Auto-detect complete',
      description: `Added ${created} script${created !== 1 ? 's' : ''}`,
    });
  };

  const handleStart = async (config: RunConfig) => {
    setActionPending(config.id);
    try {
      const result = await start({ id: config.id, sessionId });
      onTerminalCreated?.(result.terminalId);
      toast({ title: 'Started', description: config.name });
    } catch (error) {
      toast({
        title: 'Failed to start',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setActionPending(null);
    }
  };

  const handleStop = async (config: RunConfig) => {
    setActionPending(config.id);
    try {
      await stop(config.id);
      toast({ title: 'Stopped', description: config.name });
    } catch (error) {
      toast({
        title: 'Failed to stop',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setActionPending(null);
    }
  };

  const handleRestart = async (config: RunConfig) => {
    setActionPending(config.id);
    try {
      const result = await restart({ id: config.id, sessionId });
      onTerminalCreated?.(result.terminalId);
      toast({ title: 'Restarted', description: config.name });
    } catch (error) {
      toast({
        title: 'Failed to restart',
        description: (error as Error).message,
        variant: 'destructive',
      });
    } finally {
      setActionPending(null);
    }
  };

  const handleDelete = async (config: RunConfig) => {
    try {
      await remove(config.id);
      toast({ title: 'Deleted', description: config.name });
    } catch (error) {
      toast({
        title: 'Failed to delete',
        description: (error as Error).message,
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="font-semibold text-sm">Run Configurations</h2>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 px-2 text-xs"
            onClick={handleAutoDetect}
            title="Auto-detect package.json scripts"
          >
            <Wand2 className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Detect</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 px-2 text-xs"
            onClick={() => setShowCreateModal(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">New</span>
          </Button>
        </div>
      </div>

      {/* Config list */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground text-sm">
            Loading...
          </div>
        ) : runConfigs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <Play className="h-8 w-8 mb-3 opacity-30" />
            <p className="text-sm mb-1">No run configurations</p>
            <p className="text-xs">Create one or auto-detect from package.json</p>
          </div>
        ) : (
          <div className="divide-y">
            {runConfigs.map((config) => (
              <RunConfigItem
                key={config.id}
                config={config}
                isPending={actionPending === config.id}
                onStart={() => handleStart(config)}
                onStop={() => handleStop(config)}
                onRestart={() => handleRestart(config)}
                onDelete={() => handleDelete(config)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Create modal */}
      {showCreateModal && (
        <CreateRunConfigModal
          scripts={scripts}
          onClose={() => setShowCreateModal(false)}
          onCreate={handleCreate}
        />
      )}
    </div>
  );
}

interface RunConfigItemProps {
  config: RunConfig;
  isPending: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onDelete: () => void;
}

function RunConfigItem({ config, isPending, onStart, onStop, onRestart, onDelete }: RunConfigItemProps) {
  const adapterLabel = config.adapterType === 'npm_script' ? 'npm' : 'cmd';
  const commandPreview =
    config.adapterType === 'npm_script'
      ? `bun run ${(config.command as Record<string, string>).script || ''}`
      : (config.command as Record<string, string>).command || '';

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-accent/50 group">
      {/* Status indicator */}
      <div
        className={cn(
          'h-2 w-2 rounded-full shrink-0',
          config.isRunning ? 'bg-green-500' : 'bg-muted-foreground/30'
        )}
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{config.name}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono">
            {adapterLabel}
          </span>
          {config.autoRestart && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-500 font-mono">
              auto
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate font-mono">{commandPreview}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        {config.isRunning ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={onRestart}
              disabled={isPending}
              title="Restart"
            >
              <RotateCw className={cn('h-3.5 w-3.5', isPending && 'animate-spin')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={onStop}
              disabled={isPending}
              title="Stop"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-green-500 hover:text-green-500"
              onClick={onStart}
              disabled={isPending}
              title="Start"
            >
              <Play className={cn('h-3.5 w-3.5', isPending && 'animate-pulse')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={onDelete}
              disabled={isPending}
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

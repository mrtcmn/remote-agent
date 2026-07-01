import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { Play, Square, RotateCw, FastForward, Terminal as TerminalIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import type { RunConfig } from '@/lib/api';

export interface RunFlowNodeData {
  runConfig: RunConfig | undefined;
  projectLabel: string;
  isRunning: boolean;
  activeTerminalId: string | null;
  hasDownstream: boolean;
  onStart: () => void;
  onStartDownstream: () => void;
  onStop: () => void;
  onRestart: () => void;
  onOpenTerminal: (terminalId: string) => void;
  isBusy: boolean;
}

function RunFlowNodeCardImpl({ data, selected }: NodeProps) {
  const d = data as unknown as RunFlowNodeData;
  const config = d.runConfig;
  const adapterLabel =
    config?.adapterType === 'npm_script'
      ? 'npm'
      : config?.adapterType === 'browser_preview'
      ? 'preview'
      : 'cmd';
  const commandPreview = config
    ? config.adapterType === 'npm_script'
      ? `bun run ${(config.command as Record<string, string>).script || ''}`
      : (config.command as Record<string, string>).command || ''
    : 'Missing run config';

  return (
    <div
      className={cn(
        'min-w-[220px] rounded-md border bg-card text-card-foreground shadow-sm transition-colors',
        selected ? 'border-primary ring-1 ring-primary/30' : 'border-border',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-2 !w-2 !bg-muted-foreground/60" />

      <div className="px-3 py-2 border-b border-border/60 flex items-center gap-2">
        <div
          className={cn(
            'h-2 w-2 rounded-full shrink-0',
            d.isRunning ? 'bg-green-500 animate-pulse' : 'bg-muted-foreground/30',
          )}
        />
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate">{config?.name ?? 'Unknown'}</div>
          <div className="text-[10px] text-muted-foreground truncate">
            {d.projectLabel} · {adapterLabel}
          </div>
        </div>
      </div>

      <div className="px-3 py-2 text-xs font-mono text-muted-foreground truncate">
        {commandPreview}
      </div>

      <div className="px-2 pb-2 flex items-center gap-1">
        {d.isRunning ? (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7"
              onClick={d.onRestart}
              disabled={d.isBusy}
              title="Restart"
            >
              <RotateCw className={cn('h-3.5 w-3.5', d.isBusy && 'animate-spin')} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-destructive hover:text-destructive"
              onClick={d.onStop}
              disabled={d.isBusy}
              title="Stop"
            >
              <Square className="h-3.5 w-3.5" />
            </Button>
            {d.activeTerminalId && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 ml-auto"
                onClick={() => d.onOpenTerminal(d.activeTerminalId!)}
                title="Open terminal"
              >
                <TerminalIcon className="h-3.5 w-3.5" />
              </Button>
            )}
          </>
        ) : (
          <>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 text-green-500 hover:text-green-500"
              onClick={d.onStart}
              disabled={d.isBusy || !config}
              title="Start this node"
            >
              <Play className={cn('h-3.5 w-3.5', d.isBusy && 'animate-pulse')} />
            </Button>
            {d.hasDownstream && (
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-green-500 hover:text-green-500"
                onClick={d.onStartDownstream}
                disabled={d.isBusy || !config}
                title="Start this node and everything connected downstream"
              >
                <FastForward className={cn('h-3.5 w-3.5', d.isBusy && 'animate-pulse')} />
              </Button>
            )}
          </>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="!h-2 !w-2 !bg-muted-foreground/60" />
    </div>
  );
}

export const RunFlowNodeCard = memo(RunFlowNodeCardImpl);

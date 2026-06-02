import { GripVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { RunConfig } from '@/lib/api';

export interface PaletteGroup {
  projectId: string;
  label: string;
  configs: RunConfig[];
}

interface Props {
  groups: PaletteGroup[];
  placedRunConfigIds: Set<string>;
  isLoading?: boolean;
}

export function RunFlowPalette({ groups, placedRunConfigIds, isLoading }: Props) {
  const onDragStart = (e: React.DragEvent, runConfigId: string) => {
    e.dataTransfer.setData('application/run-config-id', runConfigId);
    e.dataTransfer.effectAllowed = 'move';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        Loading…
      </div>
    );
  }

  const total = groups.reduce((acc, g) => acc + g.configs.length, 0);
  if (total === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-4 text-center text-xs text-muted-foreground">
        <p className="mb-1">No run configurations yet.</p>
        <p>Create some in the Run panel, then drag them onto the canvas.</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto py-2">
      {groups.map((group) => (
        <div key={group.projectId} className="mb-3">
          <div className="px-3 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            {group.label}
          </div>
          <div className="flex flex-col">
            {group.configs.map((config) => {
              const placed = placedRunConfigIds.has(config.id);
              return (
                <div
                  key={config.id}
                  draggable={!placed}
                  onDragStart={(e) => onDragStart(e, config.id)}
                  className={cn(
                    'flex items-center gap-2 px-3 py-1.5 text-xs select-none',
                    placed
                      ? 'opacity-50 cursor-not-allowed'
                      : 'cursor-grab hover:bg-accent active:cursor-grabbing',
                  )}
                  title={placed ? 'Already on the canvas' : 'Drag to add to flow'}
                >
                  <GripVertical className="h-3 w-3 text-muted-foreground/60 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{config.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate font-mono">
                      {config.adapterType === 'npm_script'
                        ? `bun run ${(config.command as Record<string, string>).script}`
                        : (config.command as Record<string, string>).command}
                    </div>
                  </div>
                  {config.isRunning && (
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

import { useState } from 'react';
import {
  Play,
  Square,
  RotateCw,
  Trash2,
  FileText,
  Box,
  Plus,
  ChevronDown,
  ChevronRight,
  ArrowUpFromLine,
  ArrowDownToLine,
  Hammer,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useDocker } from '@/hooks/useDocker';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/Toaster';
import { api } from '@/lib/api';
import type { DockerContainer, DockerFile } from '@/lib/api';

interface DockerPanelProps {
  sessionId: string;
  projectId?: string;
  onTerminalCreated?: (terminalId: string) => void;
}

export function DockerPanel({ sessionId, projectId, onTerminalCreated }: DockerPanelProps) {
  const {
    containers,
    dockerFiles,
    isAvailable,
    isLoadingContainers,
    start,
    stop,
    restart,
    remove,
    viewLogs,
    run,
    composeUp,
    composeDown,
    isRunning,
  } = useDocker(projectId);

  const [actionPending, setActionPending] = useState<string | null>(null);
  const [showRunForm, setShowRunForm] = useState(false);
  const [showContainers, setShowContainers] = useState(true);
  const [showFiles, setShowFiles] = useState(true);

  // Quick Run form state
  const [runImage, setRunImage] = useState('');
  const [runName, setRunName] = useState('');
  const [runPorts, setRunPorts] = useState('');

  if (!isAvailable) {
    return (
      <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8">
        <Box className="h-10 w-10 mb-3 opacity-30" />
        <p className="text-sm mb-1">Docker not available</p>
        <p className="text-xs">Mount /var/run/docker.sock to enable</p>
      </div>
    );
  }

  const handleAction = async (id: string, action: () => Promise<unknown>, label: string) => {
    setActionPending(id);
    try {
      await action();
      toast({ title: label, description: 'Success' });
    } catch (error) {
      toast({ title: `Failed: ${label}`, description: (error as Error).message, variant: 'destructive' });
    } finally {
      setActionPending(null);
    }
  };

  const handleViewLogs = async (container: DockerContainer) => {
    setActionPending(container.id);
    try {
      const result = await viewLogs({ containerId: container.id, sessionId });
      onTerminalCreated?.(result.terminalId);
    } catch (error) {
      toast({ title: 'Failed to open logs', description: (error as Error).message, variant: 'destructive' });
    } finally {
      setActionPending(null);
    }
  };

  const handleRun = async () => {
    if (!runImage.trim()) return;
    try {
      const ports = runPorts.trim() ? runPorts.split(',').map((p) => p.trim()) : undefined;
      await run({ image: runImage.trim(), name: runName.trim() || undefined, ports });
      toast({ title: 'Container started', description: runImage });
      setShowRunForm(false);
      setRunImage('');
      setRunName('');
      setRunPorts('');
    } catch (error) {
      toast({ title: 'Failed to run', description: (error as Error).message, variant: 'destructive' });
    }
  };

  const handleComposeUp = async (file: DockerFile) => {
    handleAction(file.path, () => composeUp(file.path), `Compose Up: ${file.name}`);
  };

  const handleComposeDown = async (file: DockerFile) => {
    handleAction(file.path, () => composeDown(file.path), `Compose Down: ${file.name}`);
  };

  const dockerfileFiles = dockerFiles.filter((f) => f.type === 'dockerfile');
  const composeFiles = dockerFiles.filter((f) => f.type === 'compose');

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b shrink-0">
        <h2 className="font-semibold text-sm">Docker</h2>
        <Button
          variant="ghost"
          size="sm"
          className="gap-1.5 h-7 px-2 text-xs"
          onClick={() => setShowRunForm(!showRunForm)}
        >
          <Plus className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Run</span>
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Quick Run Form */}
        {showRunForm && (
          <div className="px-4 py-3 border-b space-y-2">
            <input
              type="text"
              value={runImage}
              onChange={(e) => setRunImage(e.target.value)}
              placeholder="Image (e.g. redis:alpine)"
              className="w-full h-8 px-2 rounded border border-input bg-transparent text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && handleRun()}
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={runName}
                onChange={(e) => setRunName(e.target.value)}
                placeholder="Name (optional)"
                className="flex-1 h-8 px-2 rounded border border-input bg-transparent text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
              <input
                type="text"
                value={runPorts}
                onChange={(e) => setRunPorts(e.target.value)}
                placeholder="Ports (e.g. 6379:6379)"
                className="flex-1 h-8 px-2 rounded border border-input bg-transparent text-sm font-mono focus:outline-none focus:ring-1 focus:ring-ring"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setShowRunForm(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleRun} disabled={!runImage.trim() || isRunning}>
                {isRunning ? <RotateCw className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <Play className="h-3.5 w-3.5 mr-1.5" />}
                Run
              </Button>
            </div>
          </div>
        )}

        {/* Containers Section */}
        <div>
          <button
            onClick={() => setShowContainers(!showContainers)}
            className="flex items-center gap-2 w-full px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent/50 uppercase tracking-wider"
          >
            {showContainers ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            Containers ({containers.length})
          </button>
          {showContainers && (
            isLoadingContainers ? (
              <div className="px-4 py-4 text-sm text-muted-foreground text-center">Loading...</div>
            ) : containers.length === 0 ? (
              <div className="px-4 py-4 text-sm text-muted-foreground text-center">No containers</div>
            ) : (
              <div className="divide-y">
                {containers.map((container) => (
                  <ContainerItem
                    key={container.id}
                    container={container}
                    isPending={actionPending === container.id}
                    onStart={() => handleAction(container.id, () => start(container.id), `Started ${container.names}`)}
                    onStop={() => handleAction(container.id, () => stop(container.id), `Stopped ${container.names}`)}
                    onRestart={() => handleAction(container.id, () => restart(container.id), `Restarted ${container.names}`)}
                    onRemove={() => handleAction(container.id, () => remove({ id: container.id, force: true }), `Removed ${container.names}`)}
                    onViewLogs={() => handleViewLogs(container)}
                  />
                ))}
              </div>
            )
          )}
        </div>

        {/* Detected Files Section */}
        {projectId && (dockerfileFiles.length > 0 || composeFiles.length > 0) && (
          <div>
            <button
              onClick={() => setShowFiles(!showFiles)}
              className="flex items-center gap-2 w-full px-4 py-2 text-xs font-semibold text-muted-foreground hover:bg-accent/50 uppercase tracking-wider"
            >
              {showFiles ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Detected Files ({dockerFiles.length})
            </button>
            {showFiles && (
              <div className="divide-y">
                {dockerfileFiles.map((file) => (
                  <div key={file.path} className="flex items-center gap-2 px-4 py-2.5 hover:bg-accent/50 group">
                    <FileText className="h-4 w-4 text-blue-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-mono truncate block">{file.path}</span>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs gap-1"
                      onClick={() => handleAction(file.path, () => api.dockerBuild(file.path, '.'), `Build: ${file.name}`)}
                      disabled={actionPending === file.path}
                    >
                      <Hammer className="h-3 w-3" />
                      Build
                    </Button>
                  </div>
                ))}
                {composeFiles.map((file) => (
                  <div key={file.path} className="flex items-center gap-2 px-4 py-2.5 hover:bg-accent/50 group">
                    <FileText className="h-4 w-4 text-purple-500 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-mono truncate block">{file.path}</span>
                    </div>
                    <div className="flex gap-0.5">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1 text-green-500 hover:text-green-500"
                        onClick={() => handleComposeUp(file)}
                        disabled={actionPending === file.path}
                      >
                        <ArrowUpFromLine className="h-3 w-3" />
                        Up
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive"
                        onClick={() => handleComposeDown(file)}
                        disabled={actionPending === file.path}
                      >
                        <ArrowDownToLine className="h-3 w-3" />
                        Down
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface ContainerItemProps {
  container: DockerContainer;
  isPending: boolean;
  onStart: () => void;
  onStop: () => void;
  onRestart: () => void;
  onRemove: () => void;
  onViewLogs: () => void;
}

function ContainerItem({ container, isPending, onStart, onStop, onRestart, onRemove, onViewLogs }: ContainerItemProps) {
  const isRunning = container.state === 'running';
  const isPaused = container.state === 'paused';

  return (
    <div className="flex items-center gap-2 px-4 py-2.5 hover:bg-accent/50 group">
      {/* Status */}
      <div
        className={cn(
          'h-2 w-2 rounded-full shrink-0',
          isRunning ? 'bg-green-500' : isPaused ? 'bg-yellow-500' : 'bg-muted-foreground/30'
        )}
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate">{container.names}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-mono truncate max-w-32">
            {container.image}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground truncate">{container.status}</p>
          {container.ports && (
            <p className="text-xs text-muted-foreground font-mono truncate">{container.ports}</p>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-0.5 shrink-0">
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7"
          onClick={onViewLogs}
          disabled={isPending}
          title="View Logs"
        >
          <FileText className="h-3.5 w-3.5" />
        </Button>
        {isRunning ? (
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
              onClick={onRemove}
              disabled={isPending}
              title="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

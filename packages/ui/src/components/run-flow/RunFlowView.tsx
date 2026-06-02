import { useMemo, useState } from 'react';
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query';
import { Play, Square, MoveLeft, Plus } from 'lucide-react';
import { CreateConfigInFlow } from './CreateConfigInFlow';
import { Button } from '@/components/ui/Button';
import { toast } from '@/components/ui/Toaster';
import { api, type RunConfig } from '@/lib/api';
import { useRunFlowList, useRunFlow } from '@/hooks/useRunFlow';
import { useRunConfigs } from '@/hooks/useRunConfigs';
import { RunFlowCanvas } from './RunFlowCanvas';
import { RunFlowPalette, type PaletteGroup } from './RunFlowPalette';

interface Props {
  projectId: string;
  sessionId: string;
  isMultiProject: boolean;
  onOpenTerminal: (terminalId: string) => void;
}

export function RunFlowView({ projectId, sessionId, isMultiProject, onOpenTerminal }: Props) {
  const queryClient = useQueryClient();
  const { flows, isLoading: flowsLoading } = useRunFlowList(projectId);
  const flowId = flows[0]?.id; // Phase 1: single default flow
  const { flow, status, update, runAll, stopAll, isRunning, isStopping } = useRunFlow(flowId);

  const createFlowMutation = useMutation({
    mutationFn: () => api.createRunFlow({ projectId, name: 'Default' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['runFlows', projectId] });
    },
    onError: (err) => {
      toast({
        title: 'Failed to create flow',
        description: (err as Error).message,
        variant: 'destructive',
      });
    },
  });

  // Resolve which projects can contribute run configs:
  // - single project: just this project
  // - multi-project: every child project linked to this one
  const { data: links } = useQuery({
    queryKey: ['projectLinks', projectId],
    queryFn: () => api.getProjectLinks(projectId),
    enabled: isMultiProject,
  });

  const sourceProjectIds: string[] = useMemo(() => {
    if (!isMultiProject) return [projectId];
    return (links ?? []).map((l) => l.childProjectId);
  }, [isMultiProject, projectId, links]);

  // Fetch run configs for all contributing projects.
  const ownConfigs = useRunConfigs(isMultiProject ? undefined : projectId);
  const childQueries = useQuery({
    queryKey: ['runConfigs', 'multi', projectId, sourceProjectIds],
    queryFn: async () => {
      if (!isMultiProject) return [] as Array<RunConfig & { _projectLabel: string }>;
      const out: Array<RunConfig & { _projectLabel: string }> = [];
      for (const link of links ?? []) {
        const configs = await api.getRunConfigs(link.childProjectId);
        for (const c of configs) {
          out.push({ ...c, _projectLabel: link.alias });
        }
      }
      return out;
    },
    enabled: isMultiProject && !!links,
    refetchInterval: 5000,
  });

  const allConfigs: Array<RunConfig & { _projectLabel?: string }> = useMemo(() => {
    return isMultiProject ? childQueries.data ?? [] : ownConfigs.runConfigs;
  }, [isMultiProject, childQueries.data, ownConfigs.runConfigs]);

  const runConfigsById = useMemo(() => {
    const map = new Map<string, RunConfig>();
    for (const c of allConfigs) map.set(c.id, c);
    return map;
  }, [allConfigs]);

  const projectLabelByConfigId = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of allConfigs) {
      map.set(c.id, (c as RunConfig & { _projectLabel?: string })._projectLabel || 'project');
    }
    return map;
  }, [allConfigs]);

  const paletteGroups: PaletteGroup[] = useMemo(() => {
    if (isMultiProject) {
      const groups = new Map<string, PaletteGroup>();
      for (const c of allConfigs as Array<RunConfig & { _projectLabel?: string }>) {
        const key = c.projectId;
        if (!groups.has(key)) {
          groups.set(key, { projectId: key, label: c._projectLabel ?? 'project', configs: [] });
        }
        groups.get(key)!.configs.push(c);
      }
      return Array.from(groups.values());
    }
    return [{ projectId, label: 'this project', configs: allConfigs }];
  }, [isMultiProject, allConfigs, projectId]);

  const statusByNode = useMemo(() => {
    const map = new Map<string, (typeof status)[number]>();
    for (const s of status) map.set(s.nodeId, s);
    return map;
  }, [status]);

  const placedRunConfigIds = useMemo(() => {
    return new Set((flow?.nodes ?? []).map((n) => n.runConfigId));
  }, [flow]);

  const [busyConfigId, setBusyConfigId] = useState<string | null>(null);
  const [showCreateConfig, setShowCreateConfig] = useState(false);

  const { data: parentProject } = useQuery({
    queryKey: ['project', projectId],
    queryFn: () => api.getProject(projectId),
    enabled: !!projectId,
  });

  const handleAddRunConfig = async (runConfigId: string, position: { x: number; y: number }) => {
    if (!flow) return;
    if (placedRunConfigIds.has(runConfigId)) {
      toast({ title: 'Already on canvas', description: 'This run config is already in the flow.' });
      return;
    }
    const nextNodes = [
      ...flow.nodes.map((n) => ({
        id: n.id,
        runConfigId: n.runConfigId,
        x: n.x,
        y: n.y,
      })),
      // No id → server assigns one; we refetch via React Query invalidation.
      { runConfigId, x: Math.round(position.x), y: Math.round(position.y) },
    ];
    try {
      await update({ nodes: nextNodes });
    } catch (err) {
      toast({
        title: 'Failed to add node',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handlePersist = (patch: Parameters<typeof update>[0]) => {
    update(patch).catch((err) => {
      // Persistence errors are non-fatal — log a quiet toast so the user knows.
      // eslint-disable-next-line no-console
      console.error('[RunFlow] persist failed', err);
      toast({
        title: 'Failed to save flow',
        description: (err as Error).message,
        variant: 'destructive',
      });
    });
  };

  const handleStartOne = async (runConfigId: string) => {
    setBusyConfigId(runConfigId);
    try {
      const result = await api.startRunConfig(runConfigId, sessionId);
      queryClient.invalidateQueries({ queryKey: ['runFlow', flowId] });
      queryClient.invalidateQueries({ queryKey: ['runConfigs'] });
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
      onOpenTerminal(result.terminalId);
    } catch (err) {
      toast({
        title: 'Failed to start',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setBusyConfigId(null);
    }
  };

  const handleStopOne = async (runConfigId: string) => {
    setBusyConfigId(runConfigId);
    try {
      await api.stopRunConfig(runConfigId);
      queryClient.invalidateQueries({ queryKey: ['runFlow', flowId] });
      queryClient.invalidateQueries({ queryKey: ['runConfigs'] });
    } catch (err) {
      toast({
        title: 'Failed to stop',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setBusyConfigId(null);
    }
  };

  const handleStartDownstream = async (nodeId: string) => {
    if (!flowId) return;
    setBusyConfigId(nodeId);
    try {
      const result = await api.runFlowFromNode(flowId, nodeId, sessionId);
      queryClient.invalidateQueries({ queryKey: ['runFlow', flowId] });
      queryClient.invalidateQueries({ queryKey: ['runConfigs'] });
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
      toast({
        title: 'Started',
        description: `Started ${result.started.length} connected node(s)`,
      });
      if (result.started[0]) onOpenTerminal(result.started[0].terminalId);
    } catch (err) {
      toast({
        title: 'Failed to run downstream',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setBusyConfigId(null);
    }
  };

  const handleRestartOne = async (runConfigId: string) => {
    setBusyConfigId(runConfigId);
    try {
      const result = await api.restartRunConfig(runConfigId, sessionId);
      queryClient.invalidateQueries({ queryKey: ['runFlow', flowId] });
      queryClient.invalidateQueries({ queryKey: ['runConfigs'] });
      queryClient.invalidateQueries({ queryKey: ['terminals'] });
      onOpenTerminal(result.terminalId);
    } catch (err) {
      toast({
        title: 'Failed to restart',
        description: (err as Error).message,
        variant: 'destructive',
      });
    } finally {
      setBusyConfigId(null);
    }
  };

  const handleRunAll = async () => {
    if (!flow) return;
    try {
      await runAll(sessionId);
      toast({ title: 'Flow started', description: `Started ${flow.nodes.length} node(s)` });
    } catch (err) {
      toast({
        title: 'Failed to run flow',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const handleStopAll = async () => {
    try {
      await stopAll();
      toast({ title: 'Flow stopped' });
    } catch (err) {
      toast({
        title: 'Failed to stop',
        description: (err as Error).message,
        variant: 'destructive',
      });
    }
  };

  const isEmpty = !flowsLoading && (!flow || flow.nodes.length === 0);

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 border-b shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="font-semibold text-sm">Run Flow</h2>
          {flow && (
            <span className="text-xs text-muted-foreground">· {flow.name}</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 px-2 text-xs"
            onClick={handleRunAll}
            disabled={isRunning || isEmpty}
          >
            <Play className="h-3.5 w-3.5 text-green-500" />
            Run all
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 h-7 px-2 text-xs"
            onClick={handleStopAll}
            disabled={isStopping || isEmpty}
          >
            <Square className="h-3.5 w-3.5 text-destructive" />
            Stop all
          </Button>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <aside className="w-64 border-r bg-card/30 shrink-0 flex flex-col overflow-hidden">
          <div className="px-3 py-1.5 border-b flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">
              Run configs
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 h-6 px-1.5 text-xs"
              onClick={() => setShowCreateConfig(true)}
              title="Create a new run config"
            >
              <Plus className="h-3 w-3" />
              New
            </Button>
          </div>
          <div className="flex-1 min-h-0">
            <RunFlowPalette
              groups={paletteGroups}
              placedRunConfigIds={placedRunConfigIds}
              isLoading={
                isMultiProject ? childQueries.isLoading : ownConfigs.isLoading
              }
            />
          </div>
        </aside>

        <div className="flex-1 min-w-0 relative">
          {flowsLoading ? (
            <div className="flex items-center justify-center h-full text-sm text-muted-foreground">
              Loading flow…
            </div>
          ) : !flow ? (
            <div className="flex flex-col items-center justify-center h-full px-6 text-center gap-3">
              <p className="text-sm text-muted-foreground max-w-sm">
                No flow exists for this project yet. Create one to start
                wiring up your runs.
              </p>
              <Button
                size="sm"
                onClick={() => createFlowMutation.mutate()}
                disabled={createFlowMutation.isPending}
                className="gap-1.5"
              >
                <Plus className="h-3.5 w-3.5" />
                Create flow
              </Button>
            </div>
          ) : (
            <>
              <RunFlowCanvas
                flow={flow}
                statusByNode={statusByNode}
                runConfigsById={runConfigsById}
                projectLabelByConfigId={projectLabelByConfigId}
                onPersist={handlePersist}
                onAddRunConfig={handleAddRunConfig}
                onStart={handleStartOne}
                onStartDownstream={handleStartDownstream}
                onStop={handleStopOne}
                onRestart={handleRestartOne}
                onOpenTerminal={onOpenTerminal}
                busyConfigId={busyConfigId}
              />
              {flow.nodes.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                  <div className="pointer-events-auto rounded-md border bg-card/95 backdrop-blur px-4 py-3 shadow-md text-center max-w-xs">
                    {allConfigs.length === 0 ? (
                      <>
                        <p className="text-sm font-medium mb-1">
                          No run configs yet
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Open the <span className="font-semibold">Run</span> panel
                          (the play icon on the sidebar) to create some, then
                          come back here to drag them onto the canvas.
                        </p>
                      </>
                    ) : (
                      <div className="flex items-start gap-2 text-left">
                        <MoveLeft className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                        <p className="text-xs text-muted-foreground">
                          Drag a run config from the left panel onto the canvas
                          to add your first node.
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {showCreateConfig && (
        <CreateConfigInFlow
          flowProjectId={projectId}
          isMultiProject={isMultiProject}
          links={links}
          parentProject={parentProject}
          onClose={() => setShowCreateConfig(false)}
        />
      )}
    </div>
  );
}

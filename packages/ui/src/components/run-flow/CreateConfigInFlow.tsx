import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CreateRunConfigModal } from '@/components/CreateRunConfigModal';
import { toast } from '@/components/ui/Toaster';
import { api, type Project, type ProjectLink, type RunConfigAdapterType } from '@/lib/api';

interface Props {
  flowProjectId: string;
  isMultiProject: boolean;
  links: ProjectLink[] | undefined;
  parentProject: Project | undefined;
  onClose: () => void;
}

// Two-step flow for creating a run config from the Flow view:
// 1. (Multi-project only) pick which project the config belongs to.
// 2. Reuse the existing CreateRunConfigModal scoped to that project.
export function CreateConfigInFlow({
  flowProjectId,
  isMultiProject,
  links,
  parentProject,
  onClose,
}: Props) {
  const queryClient = useQueryClient();

  const projectOptions = useMemo(() => {
    const items: Array<{ id: string; label: string }> = [];
    if (parentProject) {
      items.push({ id: parentProject.id, label: `${parentProject.name} (workspace)` });
    }
    for (const link of links ?? []) {
      if (link.childProject) {
        items.push({
          id: link.childProjectId,
          label: `${link.alias} · ${link.childProject.name}`,
        });
      } else {
        items.push({ id: link.childProjectId, label: link.alias });
      }
    }
    return items;
  }, [parentProject, links]);

  const [targetProjectId, setTargetProjectId] = useState<string | null>(
    isMultiProject ? null : flowProjectId,
  );

  // Auto-pick the only option if there's one.
  useEffect(() => {
    if (isMultiProject && targetProjectId === null && projectOptions.length === 1) {
      setTargetProjectId(projectOptions[0].id);
    }
  }, [isMultiProject, targetProjectId, projectOptions]);

  const { data: scriptsData } = useQuery({
    queryKey: ['runConfigs', 'scripts', targetProjectId],
    queryFn: () => api.discoverScripts(targetProjectId!),
    enabled: !!targetProjectId,
  });

  if (isMultiProject && targetProjectId === null) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center">
        <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
        <div className="relative w-full max-w-sm bg-background rounded-xl border shadow-xl p-5 mx-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold">Pick a project</h2>
            <Button variant="ghost" size="icon" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground mb-3">
            Which project will the new run config belong to?
          </p>
          <div className="flex flex-col gap-1">
            {projectOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className="text-left px-3 py-2 text-sm rounded-md border hover:bg-accent transition-colors"
                onClick={() => setTargetProjectId(opt.id)}
              >
                {opt.label}
              </button>
            ))}
            {projectOptions.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">
                No projects available.
              </p>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (!targetProjectId) return null;

  return (
    <CreateRunConfigModal
      scripts={scriptsData?.scripts ?? []}
      onClose={onClose}
      onCreate={async (data: {
        name: string;
        adapterType: RunConfigAdapterType;
        command: Record<string, unknown>;
        autoRestart: boolean;
      }) => {
        try {
          await api.createRunConfig({
            projectId: targetProjectId,
            ...data,
          });
          queryClient.invalidateQueries({ queryKey: ['runConfigs'] });
          queryClient.invalidateQueries({ queryKey: ['runConfigs', 'multi', flowProjectId] });
          toast({ title: 'Run config created', description: data.name });
          onClose();
        } catch (err) {
          toast({
            title: 'Failed to create',
            description: (err as Error).message,
            variant: 'destructive',
          });
        }
      }}
    />
  );
}

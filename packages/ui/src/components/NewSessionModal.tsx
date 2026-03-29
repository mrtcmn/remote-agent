import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { FolderGit2, Layers, Loader2, X } from 'lucide-react';
import { api, type Project } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/utils';

interface NewSessionModalProps {
  open: boolean;
  onClose: () => void;
  preselectedProjectId?: string | null;
}

export function NewSessionModal({ open, onClose, preselectedProjectId }: NewSessionModalProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Sync preselected project when modal opens
  useEffect(() => {
    if (open && preselectedProjectId) {
      setSelectedProjectId(preselectedProjectId);
    }
  }, [open, preselectedProjectId]);

  const { data: projects, isLoading: projectsLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: (projectId?: string) => api.createSession(projectId),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['sidebar-data'] });
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      onClose();
      navigate(`/sessions/${session.id}`);
    },
  });

  // Reset selection when modal opens
  useEffect(() => {
    if (open) {
      setSelectedProjectId(null);
      createMutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Handle Escape key
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !createMutation.isPending) {
        onClose();
      }
    },
    [onClose, createMutation.isPending]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyDown);
      return () => document.removeEventListener('keydown', handleKeyDown);
    }
  }, [open, handleKeyDown]);

  // Prevent body scrolling when modal is open
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
      return () => {
        document.body.style.overflow = '';
      };
    }
  }, [open]);

  if (!open) return null;

  const handleCreate = () => {
    createMutation.mutate(selectedProjectId ?? undefined);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !createMutation.isPending) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg mx-4 bg-background border border-border rounded-lg shadow-lg">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border">
          <h2 className="text-lg font-semibold">New Session</h2>
          <button
            onClick={onClose}
            disabled={createMutation.isPending}
            className="text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <p className="text-sm text-muted-foreground mb-3">
            Select a project for this session, or create a workspace session without a project.
          </p>

          <div className="space-y-1 max-h-64 overflow-y-auto">
            {/* No Project option */}
            <button
              onClick={() => setSelectedProjectId(null)}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors',
                selectedProjectId === null
                  ? 'bg-primary/10 border border-primary/30'
                  : 'hover:bg-accent border border-transparent'
              )}
            >
              <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                <FolderGit2 className="h-4 w-4 text-muted-foreground" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">No Project</p>
                <p className="text-xs text-muted-foreground">Workspace session</p>
              </div>
            </button>

            {/* Loading state */}
            {projectsLoading && (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            )}

            {/* Projects list */}
            {projects?.map((project: Project) => (
              <button
                key={project.id}
                onClick={() => setSelectedProjectId(project.id)}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-left transition-colors',
                  selectedProjectId === project.id
                    ? 'bg-primary/10 border border-primary/30'
                    : 'hover:bg-accent border border-transparent'
                )}
              >
                <div className="h-8 w-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <FolderGit2 className="h-4 w-4 text-muted-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium truncate">{project.name}</p>
                    {project.isMultiProject && (
                      <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary shrink-0">
                        <Layers className="h-3 w-3" />
                        Multi
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    {project.repoUrl || 'local'}
                  </p>
                </div>
              </button>
            ))}

            {/* Empty state */}
            {!projectsLoading && projects?.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No projects found. Create a project first, or start a workspace session.
              </p>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-border">
          <Button
            variant="outline"
            onClick={onClose}
            disabled={createMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Creating...
              </>
            ) : (
              'Create Session'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

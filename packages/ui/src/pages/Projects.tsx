import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderGit2, GitBranch, RefreshCw, Loader2, Terminal, Key } from 'lucide-react';
import { api, type Project, type SSHKey } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toaster';
import { formatRelativeTime } from '@/lib/utils';

export function ProjectsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const queryClient = useQueryClient();

  const { data: projects, isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: api.getProjects,
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Projects</h1>
          <p className="text-muted-foreground">Manage your git repositories</p>
        </div>
        <Button onClick={() => setShowCreate(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Add Project</span>
        </Button>
      </div>

      {showCreate && (
        <CreateProjectForm
          onClose={() => setShowCreate(false)}
          onSuccess={() => {
            setShowCreate(false);
            queryClient.invalidateQueries({ queryKey: ['projects'] });
          }}
        />
      )}

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : projects?.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <FolderGit2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-2">No projects yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Clone a repository or create a new project
            </p>
            <Button onClick={() => setShowCreate(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Add Project
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {projects?.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      )}
    </div>
  );
}

function CreateProjectForm({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [sshKeyId, setSshKeyId] = useState('');

  const { data: sshKeys } = useQuery({
    queryKey: ['ssh-keys'],
    queryFn: api.getSSHKeys,
  });

  const createMutation = useMutation({
    mutationFn: api.createProject,
    onSuccess: () => {
      toast({ title: 'Project created' });
      onSuccess();
    },
    onError: (error) => {
      toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      name,
      repoUrl: repoUrl || undefined,
      branch: branch || undefined,
      sshKeyId: sshKeyId || undefined,
    });
  };

  // Show SSH key selector when URL looks like an SSH URL
  const isSSHUrl = repoUrl.startsWith('git@') || repoUrl.includes('ssh://');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Project</CardTitle>
        <CardDescription>Clone a repository or create an empty project</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-sm font-medium">Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
              required
            />
          </div>
          <div>
            <label className="text-sm font-medium">Repository URL (optional)</label>
            <Input
              value={repoUrl}
              onChange={(e) => setRepoUrl(e.target.value)}
              placeholder="git@github.com:user/repo.git"
            />
          </div>
          {isSSHUrl && (
            <div>
              <label className="text-sm font-medium flex items-center gap-1">
                <Key className="h-3 w-3" />
                SSH Key
              </label>
              {sshKeys && sshKeys.length > 0 ? (
                <select
                  value={sshKeyId}
                  onChange={(e) => setSshKeyId(e.target.value)}
                  className="w-full h-10 rounded-md border bg-transparent px-3 py-2 text-sm"
                >
                  <option value="">Default (first available)</option>
                  {sshKeys.map((key: SSHKey) => (
                    <option key={key.id} value={key.id}>
                      {key.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="text-sm text-muted-foreground py-2">
                  No SSH keys configured. Add one in Settings.
                </p>
              )}
            </div>
          )}
          <div>
            <label className="text-sm font-medium">Branch (optional)</label>
            <Input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              placeholder="main"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const openSessionMutation = useMutation({
    mutationFn: () => api.createSession(project.id),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      navigate(`/sessions/${session.id}`);
    },
    onError: (error) => {
      toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const fetchMutation = useMutation({
    mutationFn: () => api.gitFetch(project.id),
    onSuccess: () => {
      toast({ title: 'Fetched latest changes' });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (error) => {
      toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const pullMutation = useMutation({
    mutationFn: () => api.gitPull(project.id),
    onSuccess: () => {
      toast({ title: 'Pulled latest changes' });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
    onError: (error) => {
      toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <FolderGit2 className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">{project.name}</CardTitle>
          </div>
        </div>
        <CardDescription>
          {project.repoUrl || project.localPath}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {project.git && (
          <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
            <div className="flex items-center gap-1">
              <GitBranch className="h-4 w-4" />
              {project.git.branch}
            </div>
            {project.git.ahead > 0 && (
              <span className="text-green-500">+{project.git.ahead}</span>
            )}
            {project.git.behind > 0 && (
              <span className="text-red-500">-{project.git.behind}</span>
            )}
            {project.git.modified.length > 0 && (
              <span className="text-yellow-500">{project.git.modified.length} modified</span>
            )}
          </div>
        )}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => openSessionMutation.mutate()}
            disabled={openSessionMutation.isPending}
            className="gap-1"
          >
            {openSessionMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Terminal className="h-4 w-4" />
            )}
            Open
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchMutation.mutate()}
            disabled={fetchMutation.isPending}
          >
            {fetchMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => pullMutation.mutate()}
            disabled={pullMutation.isPending}
          >
            Pull
          </Button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Updated {formatRelativeTime(project.updatedAt)}
        </p>
      </CardContent>
    </Card>
  );
}

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderGit2, GitBranch, RefreshCw, Loader2, Terminal, Key, Layers, Check, Trash2, Github, Search, Lock } from 'lucide-react';
import { api, type Project, type SSHKey } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useGitHubApps, useGitHubAppInstallations, useInstallationRepos } from '@/hooks/useGitHubApps';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toaster';
import { formatRelativeTime } from '@/lib/utils';

export function ProjectsPage() {
  const [showCreate, setShowCreate] = useState(false);
  const [showMultiCreate, setShowMultiCreate] = useState(false);
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
        <div className="flex gap-2">
          <Button
            variant="outline"
            onClick={() => setShowMultiCreate(true)}
            className="gap-2"
          >
            <Layers className="h-4 w-4" />
            <span className="hidden sm:inline">Multi-Project</span>
          </Button>
          <Button onClick={() => setShowCreate(true)} className="gap-2">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add Project</span>
          </Button>
        </div>
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

      {showMultiCreate && projects && (
        <CreateMultiProjectForm
          projects={projects.filter(p => !p.isMultiProject)}
          onClose={() => setShowMultiCreate(false)}
          onSuccess={() => {
            setShowMultiCreate(false);
            queryClient.invalidateQueries({ queryKey: ['projects'] });
            queryClient.invalidateQueries({ queryKey: ['sidebar-data'] });
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
  const { data: githubApps } = useGitHubApps();
  const hasGitHubApps = githubApps && githubApps.length > 0;
  const [tab, setTab] = useState<'github' | 'ssh'>(hasGitHubApps ? 'github' : 'ssh');

  // Switch tab when data loads
  const activeTab = hasGitHubApps ? tab : 'ssh';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Add Project</CardTitle>
        <CardDescription>Clone a repository or create an empty project</CardDescription>
      </CardHeader>
      <CardContent>
        {hasGitHubApps && (
          <div className="flex gap-1 mb-4 p-1 bg-muted rounded-md">
            <button
              onClick={() => setTab('github')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                activeTab === 'github' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Github className="h-4 w-4" />
              GitHub
            </button>
            <button
              onClick={() => setTab('ssh')}
              className={`flex-1 flex items-center justify-center gap-2 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                activeTab === 'ssh' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <Key className="h-4 w-4" />
              SSH / URL
            </button>
          </div>
        )}

        {activeTab === 'github' ? (
          <GitHubRepoForm onClose={onClose} onSuccess={onSuccess} />
        ) : (
          <SSHProjectForm onClose={onClose} onSuccess={onSuccess} />
        )}
      </CardContent>
    </Card>
  );
}

function GitHubRepoForm({
  onClose,
  onSuccess,
}: {
  onClose: () => void;
  onSuccess: () => void;
}) {
  const { data: apps } = useGitHubApps();
  const [selectedAppId, setSelectedAppId] = useState<string>('');
  const [selectedInstallationId, setSelectedInstallationId] = useState<string>('');
  const [selectedRepo, setSelectedRepo] = useState<string>('');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [repoSearch, setRepoSearch] = useState('');

  const appId = selectedAppId || apps?.[0]?.id;
  const { data: installations } = useGitHubAppInstallations(appId);
  const installationId = selectedInstallationId || installations?.[0]?.id;
  const { data: repos, isLoading: loadingRepos } = useInstallationRepos(installationId);

  const filteredRepos = repos?.filter(r =>
    !repoSearch || r.full_name.toLowerCase().includes(repoSearch.toLowerCase())
  );

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

  const handleSelectRepo = (fullName: string, defaultBranch: string) => {
    setSelectedRepo(fullName);
    const repoName = fullName.split('/').pop() || fullName;
    setName(repoName);
    setBranch(defaultBranch);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!installationId || !selectedRepo) return;
    createMutation.mutate({
      name,
      githubAppInstallationId: installationId,
      githubRepoFullName: selectedRepo,
      branch: branch || undefined,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {apps && apps.length > 1 && (
        <div>
          <label className="text-sm font-medium">GitHub App</label>
          <select
            value={appId}
            onChange={(e) => { setSelectedAppId(e.target.value); setSelectedInstallationId(''); setSelectedRepo(''); }}
            className="w-full h-10 rounded-md border bg-transparent px-3 py-2 text-sm"
          >
            {apps.map(a => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </div>
      )}

      {installations && installations.length > 1 && (
        <div>
          <label className="text-sm font-medium">Account / Organization</label>
          <select
            value={installationId}
            onChange={(e) => { setSelectedInstallationId(e.target.value); setSelectedRepo(''); }}
            className="w-full h-10 rounded-md border bg-transparent px-3 py-2 text-sm"
          >
            {installations.map(i => (
              <option key={i.id} value={i.id}>{i.accountLogin}</option>
            ))}
          </select>
        </div>
      )}

      {installations && installations.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No installations found. Install the GitHub App on your account/org from Settings first.
        </p>
      )}

      {installationId && (
        <div>
          <label className="text-sm font-medium">Repository</label>
          <div className="relative mb-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={repoSearch}
              onChange={(e) => setRepoSearch(e.target.value)}
              placeholder="Search repositories..."
              className="pl-9"
            />
          </div>
          <div className="border rounded-md max-h-48 overflow-y-auto">
            {loadingRepos ? (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : filteredRepos && filteredRepos.length > 0 ? (
              filteredRepos.map(repo => (
                <button
                  key={repo.id}
                  type="button"
                  onClick={() => handleSelectRepo(repo.full_name, repo.default_branch)}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-accent transition-colors ${
                    selectedRepo === repo.full_name ? 'bg-primary/10' : ''
                  }`}
                >
                  {repo.private && <Lock className="h-3 w-3 text-muted-foreground shrink-0" />}
                  <span className="flex-1 truncate">{repo.full_name}</span>
                  {selectedRepo === repo.full_name && <Check className="h-4 w-4 text-primary shrink-0" />}
                </button>
              ))
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">No repositories found</p>
            )}
          </div>
        </div>
      )}

      {selectedRepo && (
        <>
          <div>
            <label className="text-sm font-medium">Project Name</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} required />
          </div>
          <div>
            <label className="text-sm font-medium">Branch</label>
            <Input value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
          </div>
        </>
      )}

      <div className="flex gap-2 justify-end">
        <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
        <Button type="submit" disabled={createMutation.isPending || !selectedRepo || !name}>
          {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Clone
        </Button>
      </div>
    </form>
  );
}

function SSHProjectForm({
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

  const isSSHUrl = repoUrl.startsWith('git@') || repoUrl.includes('ssh://');

  return (
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
  );
}

function CreateMultiProjectForm({
  projects,
  onClose,
  onSuccess,
}: {
  projects: Project[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState('');
  const [selectedProjects, setSelectedProjects] = useState<
    Map<string, string>
  >(new Map()); // projectId -> alias

  const toggleProject = (project: Project) => {
    setSelectedProjects(prev => {
      const next = new Map(prev);
      if (next.has(project.id)) {
        next.delete(project.id);
      } else {
        // Auto-suggest alias from project name
        const alias = project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        next.set(project.id, alias);
      }
      return next;
    });
  };

  const updateAlias = (projectId: string, alias: string) => {
    setSelectedProjects(prev => {
      const next = new Map(prev);
      next.set(projectId, alias);
      return next;
    });
  };

  const createMutation = useMutation({
    mutationFn: () =>
      api.createMultiProject({
        name,
        links: Array.from(selectedProjects.entries()).map(([projectId, alias]) => ({
          projectId,
          alias,
        })),
      }),
    onSuccess: () => {
      toast({ title: 'Multi-project workspace created' });
      onSuccess();
    },
    onError: (error) => {
      toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const canSubmit = name.trim() && selectedProjects.size >= 2;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          <CardTitle>Create Multi-Project Workspace</CardTitle>
        </div>
        <CardDescription>
          Combine multiple repositories into a single workspace with symlinked directories
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div>
            <label className="text-sm font-medium">Workspace Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="fullstack-app"
            />
          </div>

          <div>
            <label className="text-sm font-medium mb-2 block">
              Select Projects (min 2)
            </label>
            <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md p-2">
              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  No single projects available. Create projects first.
                </p>
              ) : (
                projects.map(project => {
                  const isSelected = selectedProjects.has(project.id);
                  const alias = selectedProjects.get(project.id) || '';

                  return (
                    <div key={project.id} className="space-y-1">
                      <button
                        type="button"
                        onClick={() => toggleProject(project)}
                        className={`flex items-center gap-2 w-full px-3 py-2 rounded text-left text-sm transition-colors ${
                          isSelected
                            ? 'bg-primary/10 border border-primary/30'
                            : 'hover:bg-accent border border-transparent'
                        }`}
                      >
                        <div className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${
                          isSelected ? 'bg-primary border-primary' : 'border-muted-foreground/30'
                        }`}>
                          {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                        </div>
                        <FolderGit2 className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{project.name}</span>
                      </button>

                      {isSelected && (
                        <div className="ml-9">
                          <Input
                            value={alias}
                            onChange={(e) => updateAlias(project.id, e.target.value)}
                            placeholder="directory alias"
                            className="h-8 text-xs"
                          />
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
            {selectedProjects.size > 0 && selectedProjects.size < 2 && (
              <p className="text-xs text-destructive mt-1">Select at least 2 projects</p>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={!canSubmit || createMutation.isPending}
            >
              {createMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Workspace
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePin, setDeletePin] = useState('');

  const deleteMutation = useMutation({
    mutationFn: () => api.deleteProject(project.id, deletePin),
    onSuccess: () => {
      toast({ title: 'Project deleted' });
      setShowDeleteConfirm(false);
      setDeletePin('');
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-data'] });
    },
    onError: (error) => {
      toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const openSessionMutation = useMutation({
    mutationFn: () => api.createSession(project.id),
    onSuccess: (session) => {
      queryClient.invalidateQueries({ queryKey: ['sessions'] });
      queryClient.invalidateQueries({ queryKey: ['sidebar-data'] });
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
            {project.isMultiProject && (
              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-primary/10 text-primary border border-primary/20">
                Multi
              </span>
            )}
          </div>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => setShowDeleteConfirm(true)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
        <CardDescription>
          {project.isMultiProject
            ? `${project.childLinks?.length || 0} linked projects`
            : project.repoUrl || project.localPath}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {project.isMultiProject && project.childLinks && (
          <div className="flex flex-wrap gap-1 mb-3">
            {project.childLinks.map(link => (
              <span
                key={link.id}
                className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-accent text-accent-foreground"
              >
                {link.alias}
              </span>
            ))}
          </div>
        )}
        {!project.isMultiProject && project.git && (
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
          {!project.isMultiProject && (
            <>
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
            </>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Updated {formatRelativeTime(project.updatedAt)}
        </p>
        {showDeleteConfirm && (
          <div className="mt-3 p-3 border border-destructive/30 rounded-md bg-destructive/5 space-y-2">
            <p className="text-sm font-medium text-destructive">Delete "{project.name}"?</p>
            <p className="text-xs text-muted-foreground">This will permanently remove the project and its files.</p>
            {user?.hasPin ? (
              <Input
                type="password"
                inputMode="numeric"
                pattern="[0-9]*"
                value={deletePin}
                onChange={(e) => setDeletePin(e.target.value.replace(/\D/g, ''))}
                maxLength={8}
                placeholder="Enter PIN to confirm"
                className="h-8 text-sm"
              />
            ) : null}
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="destructive"
                onClick={() => deleteMutation.mutate()}
                disabled={deleteMutation.isPending || (user?.hasPin && !deletePin)}
              >
                {deleteMutation.isPending && <Loader2 className="h-3 w-3 mr-1 animate-spin" />}
                Delete
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => { setShowDeleteConfirm(false); setDeletePin(''); }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

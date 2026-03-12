import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Download,
  Trash2,
  Loader2,
  Package,
  TrendingUp,
  Link2,
  Check,
  Sparkles,
  LayoutGrid,
  List,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { InstalledSkill, RegistrySkill } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toaster';
import { cn } from '@/lib/utils';

type ViewMode = 'grid' | 'list';
type Tab = 'browse' | 'installed';

export function SkillsPage() {
  const [tab, setTab] = useState<Tab>('browse');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [installRepo, setInstallRepo] = useState('');
  const [showInstallForm, setShowInstallForm] = useState(false);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" />
            Skills Manager
          </h1>
          <p className="text-muted-foreground text-sm">
            Discover, install, and manage AI agent skills
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={showInstallForm ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowInstallForm(!showInstallForm)}
          >
            <Download className="h-4 w-4 mr-1" />
            Install from URL
          </Button>
        </div>
      </div>

      {/* Install from URL form */}
      {showInstallForm && (
        <InstallFromUrlCard
          installRepo={installRepo}
          setInstallRepo={setInstallRepo}
          onClose={() => setShowInstallForm(false)}
        />
      )}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b">
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            tab === 'browse'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setTab('browse')}
        >
          <div className="flex items-center gap-1.5">
            <TrendingUp className="h-4 w-4" />
            Browse & Search
          </div>
        </button>
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            tab === 'installed'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setTab('installed')}
        >
          <div className="flex items-center gap-1.5">
            <Package className="h-4 w-4" />
            Installed
          </div>
        </button>
      </div>

      {/* Search bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={tab === 'browse' ? 'Search skills registry...' : 'Filter installed skills...'}
            className="pl-9"
          />
        </div>
        <div className="flex items-center border rounded-md">
          <button
            className={cn(
              'p-2 transition-colors',
              viewMode === 'grid' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setViewMode('grid')}
          >
            <LayoutGrid className="h-4 w-4" />
          </button>
          <button
            className={cn(
              'p-2 transition-colors',
              viewMode === 'list' ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'
            )}
            onClick={() => setViewMode('list')}
          >
            <List className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Content */}
      {tab === 'browse' ? (
        <BrowseTab query={debouncedQuery} viewMode={viewMode} />
      ) : (
        <InstalledTab filter={searchQuery} viewMode={viewMode} />
      )}
    </div>
  );
}

// ─── Install from URL Card ──────────────────────────────────────────────────

function InstallFromUrlCard({
  installRepo,
  setInstallRepo,
  onClose,
}: {
  installRepo: string;
  setInstallRepo: (v: string) => void;
  onClose: () => void;
}) {
  const [skillName, setSkillName] = useState('');
  const queryClient = useQueryClient();

  const installMutation = useMutation({
    mutationFn: () => api.installSkill(installRepo, skillName || undefined, true),
    onSuccess: (data) => {
      toast({ title: 'Skill installed', description: `Installed: ${data.installed?.join(', ') || data.output || 'success'}` });
      queryClient.invalidateQueries({ queryKey: ['installed-skills'] });
      setInstallRepo('');
      setSkillName('');
      onClose();
    },
    onError: (error) => {
      toast({ title: 'Install failed', description: (error as Error).message, variant: 'destructive' });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Install from Repository</CardTitle>
        <CardDescription>
          Enter a GitHub repo (e.g., <code className="text-xs bg-muted px-1 py-0.5 rounded">vercel-labs/agent-skills</code>) or full git URL.
          Uses symlinks for shared installation across all agents.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={installRepo}
            onChange={(e) => setInstallRepo(e.target.value)}
            placeholder="owner/repo or https://github.com/..."
            className="flex-1 font-mono text-sm"
          />
          <Input
            value={skillName}
            onChange={(e) => setSkillName(e.target.value)}
            placeholder="Skill name (optional)"
            className="sm:w-48"
          />
          <Button
            onClick={() => installMutation.mutate()}
            disabled={!installRepo.trim() || installMutation.isPending}
          >
            {installMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Download className="h-4 w-4 mr-1" />
            )}
            Install
          </Button>
        </div>
        {installMutation.isPending && (
          <p className="text-xs text-muted-foreground mt-2">
            Cloning repository and creating symlinks... (uses <code className="bg-muted px-1 rounded">-y</code> flag)
          </p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Browse Tab ─────────────────────────────────────────────────────────────

function BrowseTab({ query, viewMode }: { query: string; viewMode: ViewMode }) {
  const { data: searchData, isLoading: isSearching } = useQuery({
    queryKey: ['skills-search', query],
    queryFn: () => (query ? api.searchSkills(query) : api.getTrendingSkills()),
    staleTime: 30000,
  });

  const { data: installedData } = useQuery({
    queryKey: ['installed-skills'],
    queryFn: api.getInstalledSkills,
  });

  const installedNames = new Set(installedData?.skills?.map((s) => s.name) || []);
  const skills = (searchData as { skills?: RegistrySkill[] })?.skills || [];

  if (isSearching) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="text-center py-16">
        <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">
          {query ? `No skills found for "${query}"` : 'No trending skills available'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Try a different search or install directly from a repository URL
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">
        {query ? `Search results for "${query}"` : 'Trending & Popular Skills'} — {skills.length} results
      </p>
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {skills.map((skill) => (
            <RegistrySkillCard
              key={`${skill.repo}-${skill.name}`}
              skill={skill}
              isInstalled={installedNames.has(skill.name)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {skills.map((skill) => (
            <RegistrySkillRow
              key={`${skill.repo}-${skill.name}`}
              skill={skill}
              isInstalled={installedNames.has(skill.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Installed Tab ──────────────────────────────────────────────────────────

function InstalledTab({ filter, viewMode }: { filter: string; viewMode: ViewMode }) {
  const { data, isLoading } = useQuery({
    queryKey: ['installed-skills'],
    queryFn: api.getInstalledSkills,
  });

  const skills = data?.skills || [];
  const filtered = filter
    ? skills.filter(
        (s) => s.name.toLowerCase().includes(filter.toLowerCase()) || s.description.toLowerCase().includes(filter.toLowerCase())
      )
    : skills;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (skills.length === 0) {
    return (
      <div className="text-center py-16">
        <Package className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No skills installed yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Browse the registry or install from a repository URL
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">
        {filtered.length} skill{filtered.length !== 1 ? 's' : ''} installed
      </p>
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((skill) => (
            <InstalledSkillCard key={skill.name} skill={skill} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((skill) => (
            <InstalledSkillRow key={skill.name} skill={skill} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Registry Skill Card (Grid) ────────────────────────────────────────────

function RegistrySkillCard({ skill, isInstalled }: { skill: RegistrySkill; isInstalled: boolean }) {
  const queryClient = useQueryClient();

  const installMutation = useMutation({
    mutationFn: () => api.installSkill(skill.repo, skill.name, true),
    onSuccess: () => {
      toast({ title: `Installed "${skill.name}"` });
      queryClient.invalidateQueries({ queryKey: ['installed-skills'] });
    },
    onError: (error) => {
      toast({ title: 'Install failed', description: (error as Error).message, variant: 'destructive' });
    },
  });

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm truncate">{skill.name}</CardTitle>
            <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{skill.repo}</p>
          </div>
          {isInstalled ? (
            <span className="shrink-0 flex items-center gap-1 text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
              <Check className="h-3 w-3" />
              Installed
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="shrink-0 h-7 text-xs"
              onClick={() => installMutation.mutate()}
              disabled={installMutation.isPending}
            >
              {installMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Download className="h-3 w-3 mr-1" />
              )}
              Install
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="flex-1 pb-3">
        <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
      </CardContent>
      <div className="px-4 md:px-6 pb-3 flex items-center gap-3 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <Download className="h-3 w-3" />
          {formatInstalls(skill.installs)}
        </span>
        {skill.trending && skill.trending > 0 && (
          <span className="flex items-center gap-1 text-orange-500">
            <TrendingUp className="h-3 w-3" />
            {skill.trending}
          </span>
        )}
      </div>
    </Card>
  );
}

// ─── Registry Skill Row (List) ─────────────────────────────────────────────

function RegistrySkillRow({ skill, isInstalled }: { skill: RegistrySkill; isInstalled: boolean }) {
  const queryClient = useQueryClient();

  const installMutation = useMutation({
    mutationFn: () => api.installSkill(skill.repo, skill.name, true),
    onSuccess: () => {
      toast({ title: `Installed "${skill.name}"` });
      queryClient.invalidateQueries({ queryKey: ['installed-skills'] });
    },
    onError: (error) => {
      toast({ title: 'Install failed', description: (error as Error).message, variant: 'destructive' });
    },
  });

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{skill.name}</span>
          <span className="text-xs text-muted-foreground font-mono">{skill.repo}</span>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{skill.description}</p>
      </div>
      <div className="flex items-center gap-3 shrink-0">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Download className="h-3 w-3" />
          {formatInstalls(skill.installs)}
        </span>
        {isInstalled ? (
          <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">
            <Check className="h-3 w-3" />
            Installed
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => installMutation.mutate()}
            disabled={installMutation.isPending}
          >
            {installMutation.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Download className="h-3 w-3 mr-1" />
            )}
            Install
          </Button>
        )}
      </div>
    </div>
  );
}

// ─── Installed Skill Card (Grid) ───────────────────────────────────────────

function InstalledSkillCard({ skill }: { skill: InstalledSkill }) {
  const queryClient = useQueryClient();

  const uninstallMutation = useMutation({
    mutationFn: () => api.uninstallSkill(skill.name),
    onSuccess: () => {
      toast({ title: `Removed "${skill.name}"` });
      queryClient.invalidateQueries({ queryKey: ['installed-skills'] });
    },
    onError: (error) => {
      toast({ title: 'Uninstall failed', description: (error as Error).message, variant: 'destructive' });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-sm truncate">{skill.name}</CardTitle>
            {skill.source && (
              <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{skill.source}</p>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            onClick={() => uninstallMutation.mutate()}
            disabled={uninstallMutation.isPending}
          >
            {uninstallMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="pb-3">
        <p className="text-xs text-muted-foreground line-clamp-2">{skill.description}</p>
        <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
          {skill.isSymlink && (
            <span className="flex items-center gap-1 text-primary/70">
              <Link2 className="h-3 w-3" />
              Symlinked
            </span>
          )}
          {skill.license && (
            <span>{skill.license}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Installed Skill Row (List) ────────────────────────────────────────────

function InstalledSkillRow({ skill }: { skill: InstalledSkill }) {
  const queryClient = useQueryClient();

  const uninstallMutation = useMutation({
    mutationFn: () => api.uninstallSkill(skill.name),
    onSuccess: () => {
      toast({ title: `Removed "${skill.name}"` });
      queryClient.invalidateQueries({ queryKey: ['installed-skills'] });
    },
    onError: (error) => {
      toast({ title: 'Uninstall failed', description: (error as Error).message, variant: 'destructive' });
    },
  });

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{skill.name}</span>
          {skill.isSymlink && (
            <span className="flex items-center gap-1 text-xs text-primary/70">
              <Link2 className="h-3 w-3" />
              symlink
            </span>
          )}
          {skill.license && (
            <span className="text-xs text-muted-foreground">{skill.license}</span>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">{skill.description}</p>
        <p className="text-[10px] text-muted-foreground/60 font-mono truncate mt-0.5">{skill.path}</p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0 h-8 text-muted-foreground hover:text-destructive"
        onClick={() => uninstallMutation.mutate()}
        disabled={uninstallMutation.isPending}
      >
        {uninstallMutation.isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatInstalls(count: number): string {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(0)}K`;
  return String(count);
}

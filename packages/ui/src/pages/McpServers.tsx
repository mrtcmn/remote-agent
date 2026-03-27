import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Search,
  Download,
  Trash2,
  Loader2,
  Plug,
  TrendingUp,
  Check,
  LayoutGrid,
  List,
  Plus,
  Save,
  RotateCcw,
  Pencil,
  X,
  Eye,
  EyeOff,
  ExternalLink,
  FileCode,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { McpRegistryServer, McpInstalledServer, McpEnvVar } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toaster';
import { cn } from '@/lib/utils';

type ViewMode = 'grid' | 'list';
type Tab = 'browse' | 'installed' | 'config';

export function McpServersPage() {
  const [tab, setTab] = useState<Tab>('browse');
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [viewMode, setViewMode] = useState<ViewMode>('grid');
  const [showAddCustom, setShowAddCustom] = useState(false);

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
            <Plug className="h-6 w-6 text-primary" />
            MCP Servers
          </h1>
          <p className="text-muted-foreground text-sm">
            Discover, install, and manage Model Context Protocol servers
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant={showAddCustom ? 'default' : 'outline'}
            size="sm"
            onClick={() => setShowAddCustom(!showAddCustom)}
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Custom
          </Button>
        </div>
      </div>

      {/* Add Custom Server form */}
      {showAddCustom && (
        <AddCustomServerCard onClose={() => setShowAddCustom(false)} />
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
            <Plug className="h-4 w-4" />
            Installed
          </div>
        </button>
        <button
          className={cn(
            'px-4 py-2 text-sm font-medium border-b-2 transition-colors',
            tab === 'config'
              ? 'border-primary text-primary'
              : 'border-transparent text-muted-foreground hover:text-foreground'
          )}
          onClick={() => setTab('config')}
        >
          <div className="flex items-center gap-1.5">
            <FileCode className="h-4 w-4" />
            Config
          </div>
        </button>
      </div>

      {/* Search bar (not shown on config tab) */}
      {tab !== 'config' && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={tab === 'browse' ? 'Search MCP registry...' : 'Filter installed servers...'}
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
      )}

      {/* Content */}
      {tab === 'browse' ? (
        <BrowseTab query={debouncedQuery} viewMode={viewMode} />
      ) : tab === 'installed' ? (
        <InstalledTab filter={searchQuery} viewMode={viewMode} />
      ) : (
        <ConfigTab />
      )}
    </div>
  );
}

// ─── Add Custom Server Card ─────────────────────────────────────────────────

function AddCustomServerCard({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [command, setCommand] = useState('');
  const [args, setArgs] = useState('');
  const [envPairs, setEnvPairs] = useState<{ key: string; value: string }[]>([]);
  const queryClient = useQueryClient();

  const addMutation = useMutation({
    mutationFn: () => {
      const parsedArgs = args.trim() ? args.split(/\s+/) : [];
      const env: Record<string, string> = {};
      for (const pair of envPairs) {
        if (pair.key.trim()) env[pair.key.trim()] = pair.value;
      }
      return api.addCustomMcpServer(name, command, parsedArgs, Object.keys(env).length > 0 ? env : undefined);
    },
    onSuccess: () => {
      toast({ title: `Added "${name}"` });
      queryClient.invalidateQueries({ queryKey: ['installed-mcp'] });
      onClose();
    },
    onError: (error) => {
      toast({ title: 'Failed to add server', description: (error as Error).message, variant: 'destructive' });
    },
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Add Custom MCP Server</CardTitle>
        <CardDescription>
          Add a local or custom MCP server by specifying the command and arguments.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Server name (e.g., my-server)"
            className="sm:w-48"
          />
          <Input
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            placeholder="Command (e.g., npx, uvx, node)"
            className="sm:w-48"
          />
          <Input
            value={args}
            onChange={(e) => setArgs(e.target.value)}
            placeholder="Args (space-separated)"
            className="flex-1 font-mono text-sm"
          />
        </div>

        {/* Env vars */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Environment Variables</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs"
              onClick={() => setEnvPairs([...envPairs, { key: '', value: '' }])}
            >
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          </div>
          {envPairs.map((pair, i) => (
            <div key={i} className="flex gap-2">
              <Input
                value={pair.key}
                onChange={(e) => {
                  const updated = [...envPairs];
                  updated[i] = { ...pair, key: e.target.value };
                  setEnvPairs(updated);
                }}
                placeholder="KEY"
                className="font-mono text-sm w-40"
              />
              <Input
                value={pair.value}
                onChange={(e) => {
                  const updated = [...envPairs];
                  updated[i] = { ...pair, value: e.target.value };
                  setEnvPairs(updated);
                }}
                placeholder="value"
                className="flex-1 font-mono text-sm"
              />
              <Button
                variant="ghost"
                size="sm"
                className="h-9 w-9 p-0"
                onClick={() => setEnvPairs(envPairs.filter((_, j) => j !== i))}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
          <Button
            size="sm"
            onClick={() => addMutation.mutate()}
            disabled={!name.trim() || !command.trim() || addMutation.isPending}
          >
            {addMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
            Add Server
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Browse Tab ──────────────────────────────────────────────────────────────

function BrowseTab({ query, viewMode }: { query: string; viewMode: ViewMode }) {
  const { data, isLoading } = useQuery({
    queryKey: ['mcp-search', query],
    queryFn: () => api.searchMcpServers(query),
    staleTime: 30000,
  });

  const { data: installedData } = useQuery({
    queryKey: ['installed-mcp'],
    queryFn: api.getInstalledMcpServers,
  });

  const installedNames = new Set(installedData?.servers?.map((s) => s.name) || []);
  const servers = data?.servers || [];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="text-center py-16">
        <Search className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">
          {query ? `No servers found for "${query}"` : 'No servers available'}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Try a different search or add a custom server
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">
        {query ? `Search results for "${query}"` : 'MCP Servers'} — {servers.length} results
      </p>
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {servers.map((server) => (
            <RegistryServerCard
              key={server.name}
              server={server}
              isInstalled={installedNames.has(server.name)}
            />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {servers.map((server) => (
            <RegistryServerRow
              key={server.name}
              server={server}
              isInstalled={installedNames.has(server.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Install Modal ───────────────────────────────────────────────────────────

function InstallModal({
  server,
  onClose,
}: {
  server: McpRegistryServer;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const shortName = server.name.split('/').pop() || server.name;
  const [configName, setConfigName] = useState(shortName);
  const [envValues, setEnvValues] = useState<Record<string, string>>(() => {
    const defaults: Record<string, string> = {};
    for (const ev of server.envVars || []) {
      defaults[ev.name] = ev.default || '';
    }
    return defaults;
  });
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});

  const installMutation = useMutation({
    mutationFn: () => {
      const envVars: Record<string, string> = {};
      for (const [key, value] of Object.entries(envValues)) {
        if (value.trim()) envVars[key] = value.trim();
      }
      return api.installMcpServer(
        server,
        configName,
        Object.keys(envVars).length > 0 ? envVars : undefined,
      );
    },
    onSuccess: () => {
      toast({ title: `Installed "${configName}"` });
      queryClient.invalidateQueries({ queryKey: ['installed-mcp'] });
      onClose();
    },
    onError: (error) => {
      toast({ title: 'Install failed', description: (error as Error).message, variant: 'destructive' });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card border rounded-lg shadow-lg w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-lg font-semibold">{server.title || server.name}</h2>
              <p className="text-sm text-muted-foreground mt-1">{server.description}</p>
            </div>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Server info */}
          <div className="flex flex-wrap gap-2 text-xs">
            {server.registryType && (
              <span className="px-2 py-0.5 bg-accent rounded-full">{server.registryType}</span>
            )}
            {server.version && (
              <span className="px-2 py-0.5 bg-accent rounded-full">v{server.version}</span>
            )}
            {server.repoUrl && (
              <a
                href={server.repoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 px-2 py-0.5 bg-accent rounded-full hover:bg-accent/80"
              >
                <ExternalLink className="h-3 w-3" /> Repo
              </a>
            )}
          </div>

          {/* Config name */}
          <div>
            <label className="text-sm font-medium">Config Name</label>
            <Input
              value={configName}
              onChange={(e) => setConfigName(e.target.value)}
              placeholder="Server name in config"
              className="mt-1 font-mono text-sm"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              This will be the key in mcpServers config
            </p>
          </div>

          {/* Environment Variables */}
          {server.envVars && server.envVars.length > 0 && (
            <div className="space-y-3">
              <label className="text-sm font-medium">Environment Variables</label>
              {server.envVars.map((ev: McpEnvVar) => (
                <div key={ev.name}>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-mono flex-shrink-0">
                      {ev.name}
                      {ev.isRequired && <span className="text-destructive ml-0.5">*</span>}
                    </label>
                    {ev.isSecret && (
                      <button
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => setShowSecrets({ ...showSecrets, [ev.name]: !showSecrets[ev.name] })}
                      >
                        {showSecrets[ev.name] ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      </button>
                    )}
                  </div>
                  <Input
                    type={ev.isSecret && !showSecrets[ev.name] ? 'password' : 'text'}
                    value={envValues[ev.name] || ''}
                    onChange={(e) => setEnvValues({ ...envValues, [ev.name]: e.target.value })}
                    placeholder={ev.placeholder || ev.description || ev.name}
                    className="mt-1 font-mono text-sm"
                  />
                  {ev.description && (
                    <p className="text-[10px] text-muted-foreground mt-0.5">{ev.description}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => installMutation.mutate()}
              disabled={!configName.trim() || installMutation.isPending}
            >
              {installMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Download className="h-4 w-4 mr-1" />
              )}
              Install
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Registry Server Card (Grid) ────────────────────────────────────────────

function RegistryServerCard({ server, isInstalled }: { server: McpRegistryServer; isInstalled: boolean }) {
  const [showInstall, setShowInstall] = useState(false);

  return (
    <>
      <Card className="flex flex-col">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm truncate">{server.title || server.name}</CardTitle>
              <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{server.name}</p>
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
                onClick={() => setShowInstall(true)}
              >
                <Download className="h-3 w-3 mr-1" />
                Install
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="flex-1 pb-3">
          <p className="text-xs text-muted-foreground line-clamp-2">{server.description}</p>
        </CardContent>
        <div className="px-4 md:px-6 pb-3 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
          {server.registryType && (
            <span className="px-1.5 py-0.5 bg-accent rounded text-[10px]">{server.registryType}</span>
          )}
          {server.version && (
            <span className="text-[10px]">v{server.version}</span>
          )}
          {server.envVars && server.envVars.length > 0 && (
            <span className="text-[10px]">{server.envVars.length} env var{server.envVars.length !== 1 ? 's' : ''}</span>
          )}
        </div>
      </Card>
      {showInstall && (
        <InstallModal server={server} onClose={() => setShowInstall(false)} />
      )}
    </>
  );
}

// ─── Registry Server Row (List) ─────────────────────────────────────────────

function RegistryServerRow({ server, isInstalled }: { server: McpRegistryServer; isInstalled: boolean }) {
  const [showInstall, setShowInstall] = useState(false);

  return (
    <>
      <div className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{server.title || server.name}</span>
            {server.registryType && (
              <span className="px-1.5 py-0.5 bg-accent rounded text-[10px]">{server.registryType}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground truncate mt-0.5">{server.description}</p>
          <p className="text-[10px] text-muted-foreground/60 font-mono truncate mt-0.5">{server.name}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
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
              onClick={() => setShowInstall(true)}
            >
              <Download className="h-3 w-3 mr-1" />
              Install
            </Button>
          )}
        </div>
      </div>
      {showInstall && (
        <InstallModal server={server} onClose={() => setShowInstall(false)} />
      )}
    </>
  );
}

// ─── Installed Tab ───────────────────────────────────────────────────────────

function InstalledTab({ filter, viewMode }: { filter: string; viewMode: ViewMode }) {
  const { data, isLoading } = useQuery({
    queryKey: ['installed-mcp'],
    queryFn: api.getInstalledMcpServers,
  });

  const servers = data?.servers || [];
  const filtered = filter
    ? servers.filter(
        (s) => s.name.toLowerCase().includes(filter.toLowerCase()) || s.command.toLowerCase().includes(filter.toLowerCase())
      )
    : servers;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (servers.length === 0) {
    return (
      <div className="text-center py-16">
        <Plug className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-muted-foreground">No MCP servers installed yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Browse the registry or add a custom server
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground mb-3">
        {filtered.length} server{filtered.length !== 1 ? 's' : ''} installed
      </p>
      {viewMode === 'grid' ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((server) => (
            <InstalledServerCard key={server.name} server={server} />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((server) => (
            <InstalledServerRow key={server.name} server={server} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Installed Server Card (Grid) ───────────────────────────────────────────

function InstalledServerCard({ server }: { server: McpInstalledServer }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const uninstallMutation = useMutation({
    mutationFn: () => api.uninstallMcpServer(server.name),
    onSuccess: () => {
      toast({ title: `Removed "${server.name}"` });
      queryClient.invalidateQueries({ queryKey: ['installed-mcp'] });
    },
    onError: (error) => {
      toast({ title: 'Remove failed', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const envCount = server.env ? Object.keys(server.env).length : 0;

  return (
    <>
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <CardTitle className="text-sm truncate">{server.name}</CardTitle>
              <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
                {server.command} {server.args.join(' ')}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                onClick={() => setEditing(true)}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
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
          </div>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {envCount > 0 && (
              <span>{envCount} env var{envCount !== 1 ? 's' : ''}</span>
            )}
            {server.args.length > 0 && (
              <span>{server.args.length} arg{server.args.length !== 1 ? 's' : ''}</span>
            )}
          </div>
        </CardContent>
      </Card>
      {editing && (
        <EditServerModal server={server} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

// ─── Installed Server Row (List) ────────────────────────────────────────────

function InstalledServerRow({ server }: { server: McpInstalledServer }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);

  const uninstallMutation = useMutation({
    mutationFn: () => api.uninstallMcpServer(server.name),
    onSuccess: () => {
      toast({ title: `Removed "${server.name}"` });
      queryClient.invalidateQueries({ queryKey: ['installed-mcp'] });
    },
    onError: (error) => {
      toast({ title: 'Remove failed', description: (error as Error).message, variant: 'destructive' });
    },
  });

  return (
    <>
      <div className="flex items-center gap-3 p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{server.name}</span>
            {server.env && Object.keys(server.env).length > 0 && (
              <span className="text-xs text-muted-foreground">
                {Object.keys(server.env).length} env var{Object.keys(server.env).length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">
            {server.command} {server.args.join(' ')}
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-muted-foreground hover:text-foreground"
            onClick={() => setEditing(true)}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 text-muted-foreground hover:text-destructive"
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
      </div>
      {editing && (
        <EditServerModal server={server} onClose={() => setEditing(false)} />
      )}
    </>
  );
}

// ─── Edit Server Modal ──────────────────────────────────────────────────────

function EditServerModal({
  server,
  onClose,
}: {
  server: McpInstalledServer;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [command, setCommand] = useState(server.command);
  const [args, setArgs] = useState(server.args.join(' '));
  const [envPairs, setEnvPairs] = useState<{ key: string; value: string }[]>(() => {
    if (!server.env) return [];
    return Object.entries(server.env).map(([key, value]) => ({ key, value }));
  });

  const updateMutation = useMutation({
    mutationFn: () => {
      const parsedArgs = args.trim() ? args.split(/\s+/) : [];
      const env: Record<string, string> = {};
      for (const pair of envPairs) {
        if (pair.key.trim()) env[pair.key.trim()] = pair.value;
      }
      return api.updateMcpServer(server.name, {
        command,
        args: parsedArgs,
        env: Object.keys(env).length > 0 ? env : undefined,
      });
    },
    onSuccess: () => {
      toast({ title: `Updated "${server.name}"` });
      queryClient.invalidateQueries({ queryKey: ['installed-mcp'] });
      onClose();
    },
    onError: (error) => {
      toast({ title: 'Update failed', description: (error as Error).message, variant: 'destructive' });
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div className="bg-card border rounded-lg shadow-lg w-full max-w-lg mx-4 max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between">
            <h2 className="text-lg font-semibold">Edit: {server.name}</h2>
            <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={onClose}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div>
            <label className="text-sm font-medium">Command</label>
            <Input
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              className="mt-1 font-mono text-sm"
            />
          </div>

          <div>
            <label className="text-sm font-medium">Arguments</label>
            <Input
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="Space-separated arguments"
              className="mt-1 font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">Environment Variables</label>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 text-xs"
                onClick={() => setEnvPairs([...envPairs, { key: '', value: '' }])}
              >
                <Plus className="h-3 w-3 mr-1" /> Add
              </Button>
            </div>
            {envPairs.map((pair, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={pair.key}
                  onChange={(e) => {
                    const updated = [...envPairs];
                    updated[i] = { ...pair, key: e.target.value };
                    setEnvPairs(updated);
                  }}
                  placeholder="KEY"
                  className="font-mono text-sm w-40"
                />
                <Input
                  value={pair.value}
                  onChange={(e) => {
                    const updated = [...envPairs];
                    updated[i] = { ...pair, value: e.target.value };
                    setEnvPairs(updated);
                  }}
                  placeholder="value"
                  className="flex-1 font-mono text-sm"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 w-9 p-0"
                  onClick={() => setEnvPairs(envPairs.filter((_, j) => j !== i))}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button
              onClick={() => updateMutation.mutate()}
              disabled={!command.trim() || updateMutation.isPending}
            >
              {updateMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
              ) : (
                <Save className="h-4 w-4 mr-1" />
              )}
              Save
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Config Tab (Raw JSON Editor) ───────────────────────────────────────────

function ConfigTab() {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['mcp-config'],
    queryFn: api.getMcpRawConfig,
  });

  const [editedJson, setEditedJson] = useState('');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data?.config && !initialized) {
      setEditedJson(JSON.stringify(data.config, null, 2));
      setInitialized(true);
    }
  }, [data, initialized]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const parsed = JSON.parse(editedJson);
      return api.setMcpRawConfig(parsed);
    },
    onSuccess: () => {
      toast({ title: 'Config saved' });
      queryClient.invalidateQueries({ queryKey: ['mcp-config'] });
      queryClient.invalidateQueries({ queryKey: ['installed-mcp'] });
    },
    onError: (error) => {
      toast({ title: 'Save failed', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const handleJsonChange = (value: string) => {
    setEditedJson(value);
    try {
      JSON.parse(value);
      setJsonError(null);
    } catch (e) {
      setJsonError((e as Error).message);
    }
  };

  const handleReset = () => {
    if (data?.config) {
      setEditedJson(JSON.stringify(data.config, null, 2));
      setJsonError(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-medium">Raw mcpServers Configuration</p>
          <p className="text-xs text-muted-foreground">
            Edit the mcpServers section of .claude/settings.json directly
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleReset}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => saveMutation.mutate()}
            disabled={!!jsonError || saveMutation.isPending}
          >
            {saveMutation.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
            ) : (
              <Save className="h-3.5 w-3.5 mr-1" />
            )}
            Save
          </Button>
        </div>
      </div>
      <textarea
        value={editedJson}
        onChange={(e) => handleJsonChange(e.target.value)}
        className={cn(
          'w-full h-96 p-4 font-mono text-sm rounded-lg border bg-background resize-y',
          'focus:outline-none focus:ring-2 focus:ring-ring',
          jsonError ? 'border-destructive' : 'border-input'
        )}
        spellCheck={false}
      />
      {jsonError && (
        <p className="text-xs text-destructive">{jsonError}</p>
      )}
    </div>
  );
}

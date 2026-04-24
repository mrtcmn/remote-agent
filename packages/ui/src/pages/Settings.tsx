import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { Bell, Key, Lock, Smartphone, Loader2, Check, Send, BellOff, BellRing, AlertCircle, RotateCcw, RefreshCw, ExternalLink, Package, Trash2, Globe, Plus, X, Github, Star, ChevronDown, ChevronRight, Building2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { useVersion } from '@/hooks/useVersion';
import { useGitHubApps, useGitHubAppInstallations, useDeleteGitHubApp, useSetDefaultGitHubApp, useSyncInstallations } from '@/hooks/useGitHubApps';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toaster';
import { MachinesSection } from '@/components/MachinesSection';

export function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account and preferences</p>
      </div>

      <VersionSection />
      <PasswordSection />
      <PinSection hasPin={user?.hasPin || false} />
      <MachinesSection />
      <OriginsSection />
      <GitHubAppsSection />
      <NotificationSection />
      <SSHKeysSection />
      <TroubleshootSection />
    </div>
  );
}

function VersionSection() {
  const { version, isLoading, forceCheck } = useVersion();
  const [isChecking, setIsChecking] = useState(false);

  const handleCheckNow = async () => {
    setIsChecking(true);
    try {
      await forceCheck();
      toast({ title: 'Version check complete' });
    } catch {
      toast({ title: 'Failed to check for updates', variant: 'destructive' });
    } finally {
      setIsChecking(false);
    }
  };

  const formatLastChecked = (isoString: string | null) => {
    if (!isoString) return 'Never';
    const date = new Date(isoString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    return date.toLocaleDateString();
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Package className="h-5 w-5" />
          <CardTitle>Version</CardTitle>
        </div>
        <CardDescription>
          Application version and update information
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>Checking version...</span>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Current version</span>
                <span className="font-mono text-sm">{version?.current || 'Unknown'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Latest version</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm">{version?.latest || 'Unknown'}</span>
                  {version?.updateAvailable && (
                    <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded">
                      Update available
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Last checked</span>
                <span className="text-sm">{formatLastChecked(version?.lastChecked || null)}</span>
              </div>
            </div>

            {version?.updateAvailable && (
              <div className="p-3 rounded-lg bg-primary/10 border border-primary/20">
                <p className="text-sm mb-2">
                  To upgrade, run the following command on your server:
                </p>
                <code className="block bg-muted p-2 rounded text-xs font-mono">
                  ./upgrade.sh
                </code>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleCheckNow}
                disabled={isChecking}
              >
                {isChecking ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4 mr-2" />
                )}
                Check Now
              </Button>
              {version?.releaseUrl && (
                <Button variant="outline" size="sm" asChild>
                  <a href={version.releaseUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="h-4 w-4 mr-2" />
                    View Changelog
                  </a>
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function PasswordSection() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const changeMutation = useMutation({
    mutationFn: api.changePassword,
    onSuccess: () => {
      toast({ title: 'Password changed successfully' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    },
    onError: (error) => {
      toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      toast({ title: 'Error', description: 'New passwords do not match', variant: 'destructive' });
      return;
    }
    if (newPassword.length < 6) {
      toast({ title: 'Error', description: 'Password must be at least 6 characters', variant: 'destructive' });
      return;
    }
    changeMutation.mutate({ currentPassword, newPassword });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Lock className="h-5 w-5" />
          <CardTitle>Password</CardTitle>
        </div>
        <CardDescription>
          Change your account password
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4 max-w-xs">
          <div>
            <label className="text-sm font-medium">Current Password</label>
            <Input
              type="password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              placeholder="Enter current password"
            />
          </div>
          <div>
            <label className="text-sm font-medium">New Password</label>
            <Input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Enter new password"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Confirm New Password</label>
            <Input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Confirm new password"
            />
          </div>
          <Button type="submit" disabled={!currentPassword || !newPassword || !confirmPassword || changeMutation.isPending}>
            {changeMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Change Password
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function PinSection({ hasPin }: { hasPin: boolean }) {
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const { setPin: setPinFn } = useAuth();
  const queryClient = useQueryClient();

  const handleSetPin = (e: React.FormEvent) => {
    e.preventDefault();
    if (pin !== confirmPin) {
      toast({ title: 'Error', description: 'PINs do not match', variant: 'destructive' });
      return;
    }
    if (pin.length < 4 || pin.length > 8) {
      toast({ title: 'Error', description: 'PIN must be 4-8 digits', variant: 'destructive' });
      return;
    }
    setPinFn(
      { pin, password },
      {
        onSuccess: () => {
          toast({ title: 'PIN set successfully' });
          setPassword('');
          setPin('');
          setConfirmPin('');
          queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
        },
        onError: (error: unknown) => {
          toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
        },
      },
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          <CardTitle>Security PIN</CardTitle>
        </div>
        <CardDescription>
          {hasPin
            ? 'Your PIN is set. Required for sensitive operations like deleting projects and SSH keys.'
            : 'Set a PIN for extra security on sensitive operations.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSetPin} className="space-y-4 max-w-xs">
          <div>
            <label className="text-sm font-medium">Current Password</label>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Enter your password"
            />
          </div>
          <div>
            <label className="text-sm font-medium">
              {hasPin ? 'New PIN' : 'PIN'} (4-8 digits)
            </label>
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              maxLength={8}
              placeholder="Enter PIN"
            />
          </div>
          <div>
            <label className="text-sm font-medium">Confirm PIN</label>
            <Input
              type="password"
              inputMode="numeric"
              pattern="[0-9]*"
              value={confirmPin}
              onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
              maxLength={8}
              placeholder="Confirm PIN"
            />
          </div>
          <Button type="submit" disabled={!password || !pin || !confirmPin}>
            {hasPin ? 'Update PIN' : 'Set PIN'}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function OriginsSection() {
  const [newOrigin, setNewOrigin] = useState('');
  const [error, setError] = useState('');
  const queryClient = useQueryClient();

  const { data } = useQuery({
    queryKey: ['origins'],
    queryFn: api.getOrigins,
  });

  const updateMutation = useMutation({
    mutationFn: api.updateOrigins,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['origins'] });
      toast({ title: 'Origins updated' });
    },
    onError: (err) => {
      toast({ title: 'Error', description: (err as Error).message, variant: 'destructive' });
    },
  });

  const origins = data?.origins ?? [];

  const validateOrigin = (value: string): string | null => {
    if (!value) return 'Origin is required';
    try {
      const url = new URL(value);
      if (url.origin !== value) {
        return 'Use origin format (e.g. https://example.com) without trailing paths';
      }
    } catch {
      return 'Invalid URL format';
    }
    if (origins.includes(value)) return 'Origin already exists';
    return null;
  };

  const handleAdd = () => {
    const validationError = validateOrigin(newOrigin.trim());
    if (validationError) {
      setError(validationError);
      return;
    }
    setError('');
    updateMutation.mutate([...origins, newOrigin.trim()]);
    setNewOrigin('');
  };

  const handleRemove = (origin: string) => {
    updateMutation.mutate(origins.filter((o) => o !== origin));
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Globe className="h-5 w-5" />
          <CardTitle>Allowed Origins</CardTitle>
        </div>
        <CardDescription>
          Manage CORS and trusted origins. Changes take effect immediately without a server restart.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {origins.length === 0 ? (
          <p className="text-sm text-muted-foreground">No origins configured.</p>
        ) : (
          <div className="space-y-2">
            {origins.map((origin) => (
              <div
                key={origin}
                className="flex items-center gap-2 text-sm p-2 rounded bg-secondary"
              >
                <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
                <span className="flex-1 font-mono text-xs break-all">{origin}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => handleRemove(origin)}
                  disabled={updateMutation.isPending}
                >
                  {updateMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <X className="h-4 w-4" />
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <div className="flex-1">
            <Input
              value={newOrigin}
              onChange={(e) => {
                setNewOrigin(e.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              placeholder="https://example.com"
              className="font-mono text-sm"
            />
            {error && <p className="text-xs text-destructive mt-1">{error}</p>}
          </div>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!newOrigin.trim() || updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            Add
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function GitHubAppsSection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data: apps, isLoading } = useGitHubApps();
  const deleteApp = useDeleteGitHubApp();
  const setDefault = useSetDefaultGitHubApp();
  const [orgName, setOrgName] = useState('');
  const [showOrgInput, setShowOrgInput] = useState(false);
  const [expandedApps, setExpandedApps] = useState<Set<string>>(new Set());
  const [deletePin, setDeletePin] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Handle callback query params
  useEffect(() => {
    if (searchParams.get('github-app') === 'created') {
      toast({ title: 'GitHub App created successfully' });
      searchParams.delete('github-app');
      setSearchParams(searchParams, { replace: true });
    }
    if (searchParams.get('installation') === 'added') {
      toast({ title: 'GitHub App installed successfully' });
      searchParams.delete('installation');
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const handleCreateApp = async () => {
    try {
      const { manifest, actionUrl } = await api.getGitHubAppManifest(orgName || undefined);
      const form = document.createElement('form');
      form.method = 'POST';
      form.action = actionUrl;
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'manifest';
      input.value = JSON.stringify(manifest);
      form.appendChild(input);
      document.body.appendChild(form);
      form.submit();
    } catch (error) {
      toast({ title: 'Failed to create GitHub App', variant: 'destructive' });
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteApp.mutateAsync({ id, pin: deletePin || undefined });
      setDeletingId(null);
      setDeletePin('');
      toast({ title: 'GitHub App deleted' });
    } catch (error) {
      toast({ title: (error as Error).message, variant: 'destructive' });
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedApps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Github className="h-5 w-5" />
          GitHub Apps
        </CardTitle>
        <CardDescription>
          Connect GitHub Apps for OAuth login and repository access.
          Each app provides authentication and access to private repositories.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading...
          </div>
        ) : (
          <>
            {apps && apps.length > 0 && (
              <div className="space-y-3">
                {apps.map(app => (
                  <GitHubAppItem
                    key={app.id}
                    app={app}
                    expanded={expandedApps.has(app.id)}
                    onToggle={() => toggleExpand(app.id)}
                    onSetDefault={() => setDefault.mutateAsync(app.id).then(() => toast({ title: 'Default app updated' }))}
                    onDelete={() => setDeletingId(app.id)}
                    deleting={deletingId === app.id}
                    deletePin={deletePin}
                    onDeletePinChange={setDeletePin}
                    onDeleteConfirm={() => handleDelete(app.id)}
                    onDeleteCancel={() => { setDeletingId(null); setDeletePin(''); }}
                  />
                ))}
              </div>
            )}

            {apps?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No GitHub Apps configured. Create one to enable GitHub OAuth login and repo access.
              </p>
            )}

            <div className="border-t pt-4 space-y-3">
              {showOrgInput && (
                <div className="flex gap-2 items-center">
                  <Building2 className="h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Organization name (optional)"
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    className="flex-1"
                  />
                  <Button variant="ghost" size="sm" onClick={() => { setShowOrgInput(false); setOrgName(''); }}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <div className="flex gap-2">
                <Button onClick={handleCreateApp} className="gap-2">
                  <Github className="h-4 w-4" />
                  Create GitHub App
                </Button>
                {!showOrgInput && (
                  <Button variant="outline" size="sm" onClick={() => setShowOrgInput(true)}>
                    For an organization?
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function GitHubAppItem({
  app,
  expanded,
  onToggle,
  onSetDefault,
  onDelete,
  deleting,
  deletePin,
  onDeletePinChange,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  app: { id: string; name: string; appSlug: string; htmlUrl: string; isDefault: boolean; createdAt: string };
  expanded: boolean;
  onToggle: () => void;
  onSetDefault: () => void;
  onDelete: () => void;
  deleting: boolean;
  deletePin: string;
  onDeletePinChange: (v: string) => void;
  onDeleteConfirm: () => void;
  onDeleteCancel: () => void;
}) {
  const { data: installations, isLoading } = useGitHubAppInstallations(expanded ? app.id : undefined);
  const syncInstallations = useSyncInstallations();

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button onClick={onToggle} className="text-muted-foreground hover:text-foreground">
            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          </button>
          <Github className="h-4 w-4" />
          <span className="font-medium text-sm">{app.name}</span>
          {app.isDefault && (
            <span className="text-xs bg-primary/10 text-primary px-2 py-0.5 rounded-full">Default</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {!app.isDefault && (
            <Button variant="ghost" size="sm" onClick={onSetDefault} title="Set as default for login">
              <Star className="h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => window.open(`https://github.com/apps/${app.appSlug}/installations/new`, '_blank')}
            title="Install on GitHub"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} title="Delete">
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>

      {deleting && (
        <div className="flex gap-2 items-center bg-destructive/5 rounded p-2">
          <Input
            type="password"
            placeholder="Enter PIN to confirm"
            value={deletePin}
            onChange={(e) => onDeletePinChange(e.target.value)}
            className="flex-1 h-8"
          />
          <Button variant="destructive" size="sm" onClick={onDeleteConfirm}>Delete</Button>
          <Button variant="ghost" size="sm" onClick={onDeleteCancel}>Cancel</Button>
        </div>
      )}

      {expanded && (
        <div className="pl-6 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground font-medium">Installations</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => syncInstallations.mutate(app.id)}
              disabled={syncInstallations.isPending}
              className="h-6 px-2 text-xs"
            >
              {syncInstallations.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin mr-1" />
              ) : (
                <RefreshCw className="h-3 w-3 mr-1" />
              )}
              Sync
            </Button>
          </div>

          {isLoading ? (
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading...
            </div>
          ) : installations && installations.length > 0 ? (
            <div className="space-y-1">
              {installations.map(inst => (
                <div key={inst.id} className="flex items-center gap-2 text-xs text-muted-foreground">
                  {inst.accountType === 'Organization' ? (
                    <Building2 className="h-3 w-3" />
                  ) : (
                    <Github className="h-3 w-3" />
                  )}
                  <span>{inst.accountLogin}</span>
                  <span className="text-muted-foreground/60">
                    ({inst.repositorySelection === 'all' ? 'all repos' : 'selected repos'})
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              No installations yet.{' '}
              <button
                onClick={() => window.open(`https://github.com/apps/${app.appSlug}/installations/new`, '_blank')}
                className="text-primary hover:underline"
              >
                Install on GitHub
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationSection() {
  const queryClient = useQueryClient();
  const { status, isConfigured, enableNotifications, isEnabling } = useNotifications();

  const { data: prefs } = useQuery({
    queryKey: ['notification-prefs'],
    queryFn: api.getPreferences,
  });

  const { data: devices } = useQuery({
    queryKey: ['devices'],
    queryFn: api.getDevices,
  });

  const updateMutation = useMutation({
    mutationFn: api.updatePreferences,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['notification-prefs'] });
      toast({ title: 'Preferences updated' });
    },
  });

  const testMutation = useMutation({
    mutationFn: api.testNotification,
    onSuccess: (result: { success: boolean }) => {
      if (result.success) {
        toast({ title: 'Test notification sent' });
      } else {
        toast({ title: 'No devices to notify', variant: 'destructive' });
      }
    },
  });

  const togglePref = (key: 'notifyOnInput' | 'notifyOnError' | 'notifyOnComplete') => {
    if (!prefs) return;
    updateMutation.mutate({ [key]: !prefs[key] });
  };

  const handleEnableNotifications = async () => {
    try {
      await enableNotifications();
      queryClient.invalidateQueries({ queryKey: ['devices'] });
    } catch {
      // Error already handled in hook
    }
  };

  // Render status-specific UI
  const renderNotificationStatus = () => {
    switch (status) {
      case 'unsupported':
        return (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
            <BellOff className="h-5 w-5" />
            <span className="text-sm">Push notifications are not supported in this browser</span>
          </div>
        );

      case 'unconfigured':
        return (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
            <AlertCircle className="h-5 w-5" />
            <span className="text-sm">Push notifications are not configured on the server</span>
          </div>
        );

      case 'denied':
        return (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive">
            <BellOff className="h-5 w-5" />
            <div className="text-sm">
              <p className="font-medium">Notifications blocked</p>
              <p className="text-muted-foreground">Please enable notifications in your browser settings</p>
            </div>
          </div>
        );

      case 'default':
      case 'granted':
        return (
          <Button
            onClick={handleEnableNotifications}
            disabled={isEnabling}
            className="w-full sm:w-auto"
          >
            {isEnabling ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <BellRing className="h-4 w-4 mr-2" />
            )}
            Enable Push Notifications
          </Button>
        );

      case 'registered':
        return (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 text-green-600 dark:text-green-400">
            <Check className="h-5 w-5" />
            <span className="text-sm">Push notifications enabled on this device</span>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          <CardTitle>Notifications</CardTitle>
        </div>
        <CardDescription>
          Get notified when Claude needs your attention
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Enable notifications section */}
        <div className="space-y-3">
          <h4 className="font-medium text-sm">This Device</h4>
          {renderNotificationStatus()}
        </div>

        {/* Preferences section - only show if configured */}
        {isConfigured && (
          <div className="space-y-3">
            <h4 className="font-medium text-sm">Notify me when:</h4>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={prefs?.notifyOnInput ?? true}
                onChange={() => togglePref('notifyOnInput')}
                className="rounded"
              />
              <span className="text-sm">Input is required</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={prefs?.notifyOnError ?? true}
                onChange={() => togglePref('notifyOnError')}
                className="rounded"
              />
              <span className="text-sm">An error occurs</span>
            </label>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={prefs?.notifyOnComplete ?? true}
                onChange={() => togglePref('notifyOnComplete')}
                className="rounded"
              />
              <span className="text-sm">Task completes</span>
            </label>
          </div>
        )}

        {/* Registered devices */}
        <div>
          <h4 className="font-medium text-sm mb-2">Registered Devices ({devices?.length || 0})</h4>
          {devices?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No devices registered yet.
            </p>
          ) : (
            <div className="space-y-2">
              {devices?.map((device) => (
                <div key={device.id} className="flex items-center gap-2 text-sm">
                  <Smartphone className="h-4 w-4 text-muted-foreground" />
                  <span>{device.deviceName || device.platform}</span>
                  <Check className="h-4 w-4 text-green-500" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Test notification button - only show if devices exist */}
        {devices && devices.length > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => testMutation.mutate()}
            disabled={testMutation.isPending}
          >
            {testMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <Send className="h-4 w-4 mr-2" />
            )}
            Send Test Notification
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function SSHKeysSection() {
  const [showAdd, setShowAdd] = useState(false);
  const [name, setName] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [deletingKeyId, setDeletingKeyId] = useState<string | null>(null);
  const [deletePin, setDeletePin] = useState('');

  const queryClient = useQueryClient();

  const { data: keys } = useQuery({
    queryKey: ['ssh-keys'],
    queryFn: api.getSSHKeys,
  });

  const addMutation = useMutation({
    mutationFn: api.addSSHKey,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
      setShowAdd(false);
      setName('');
      setPrivateKey('');
      toast({ title: 'SSH key added' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: ({ id, pin }: { id: string; pin: string }) => api.deleteSSHKey(id, pin),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ssh-keys'] });
      setDeletingKeyId(null);
      setDeletePin('');
      toast({ title: 'SSH key removed' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
    },
  });

  const handleDelete = (keyId: string) => {
    if (deletingKeyId === keyId && deletePin) {
      deleteMutation.mutate({ id: keyId, pin: deletePin });
    } else {
      setDeletingKeyId(keyId);
      setDeletePin('');
    }
  };

  const cancelDelete = () => {
    setDeletingKeyId(null);
    setDeletePin('');
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Key className="h-5 w-5" />
          <CardTitle>SSH Keys</CardTitle>
        </div>
        <CardDescription>
          Manage SSH keys for git operations
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {keys?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No SSH keys added yet.
          </p>
        ) : (
          <div className="space-y-2">
            {keys?.map((key) => (
              <div key={key.id} className="space-y-2">
                <div className="flex items-center gap-2 text-sm p-2 rounded bg-secondary">
                  <Key className="h-4 w-4 text-muted-foreground" />
                  <span className="flex-1">{key.name}</span>
                  <span className="text-muted-foreground text-xs">
                    {key.publicKey.substring(0, 20)}...
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                    onClick={() => handleDelete(key.id)}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending && deletingKeyId === key.id ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                  </Button>
                </div>
                {deletingKeyId === key.id && (
                  <div className="flex items-center gap-2 pl-2">
                    <Input
                      type="password"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={deletePin}
                      onChange={(e) => setDeletePin(e.target.value.replace(/\D/g, ''))}
                      placeholder="Enter PIN to confirm"
                      className="h-8 w-40 text-sm"
                      maxLength={8}
                    />
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-8"
                      onClick={() => handleDelete(key.id)}
                      disabled={!deletePin || deleteMutation.isPending}
                    >
                      Remove
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8"
                      onClick={cancelDelete}
                    >
                      Cancel
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {showAdd ? (
          <div className="space-y-3 pt-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Key name (e.g., github)"
            />
            <textarea
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              placeholder="Paste private key here..."
              className="w-full h-32 rounded-md border bg-transparent px-3 py-2 text-sm font-mono"
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => addMutation.mutate({ name, privateKey })}
                disabled={!privateKey || addMutation.isPending}
              >
                {addMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                Add Key
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowAdd(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button variant="outline" size="sm" onClick={() => setShowAdd(true)}>
            Add SSH Key
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

function TroubleshootSection() {
  const pairMutation = useMutation({
    mutationFn: () => api.pairWorkspace({}),
    onSuccess: () => {
      toast({ title: 'Workspace paired', description: 'Your workspace has been prepared successfully' });
    },
    onError: (error) => {
      toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
    },
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <RotateCcw className="h-5 w-5" />
          <CardTitle>Troubleshoot</CardTitle>
        </div>
        <CardDescription>
          Tools to help fix issues with your workspace
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            If you're experiencing issues with hooks, settings, or workspace configuration,
            pairing will reset your workspace to a clean state.
          </p>
          <Button
            variant="outline"
            onClick={() => pairMutation.mutate()}
            disabled={pairMutation.isPending}
          >
            {pairMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RotateCcw className="h-4 w-4 mr-2" />
            )}
            Pair Workspace
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

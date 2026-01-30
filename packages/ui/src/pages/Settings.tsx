import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Key, Smartphone, Loader2, Check, Send, BellOff, BellRing, AlertCircle, RotateCcw, RefreshCw, ExternalLink, Package } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useNotifications } from '@/hooks/useNotifications';
import { useVersion } from '@/hooks/useVersion';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toaster';

export function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your account and preferences</p>
      </div>

      <VersionSection />
      <PinSection hasPin={user?.hasPin || false} />
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

function PinSection({ hasPin }: { hasPin: boolean }) {
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
    setPinFn(pin, {
      onSuccess: () => {
        toast({ title: 'PIN set successfully' });
        setPin('');
        setConfirmPin('');
        queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
      },
      onError: (error: unknown) => {
        toast({ title: 'Error', description: (error as Error).message, variant: 'destructive' });
      },
    });
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
            ? 'Your PIN is set. Required for sensitive operations.'
            : 'Set a PIN for extra security on sensitive operations.'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSetPin} className="space-y-4 max-w-xs">
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
          <Button type="submit" disabled={!pin || !confirmPin}>
            {hasPin ? 'Update PIN' : 'Set PIN'}
          </Button>
        </form>
      </CardContent>
    </Card>
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
              <div key={key.id} className="flex items-center gap-2 text-sm p-2 rounded bg-secondary">
                <Key className="h-4 w-4 text-muted-foreground" />
                <span className="flex-1">{key.name}</span>
                <span className="text-muted-foreground text-xs">
                  {key.publicKey.substring(0, 20)}...
                </span>
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

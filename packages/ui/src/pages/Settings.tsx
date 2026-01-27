import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Bell, Key, Smartphone, Loader2, Check, Send } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
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

      <PinSection hasPin={user?.hasPin || false} />
      <NotificationSection />
      <SSHKeysSection />
    </div>
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

        <div>
          <h4 className="font-medium text-sm mb-2">Registered Devices ({devices?.length || 0})</h4>
          {devices?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No devices registered. Enable push notifications in your browser.
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

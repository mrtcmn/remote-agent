import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Copy,
  Loader2,
  Monitor,
  Plus,
  Server,
  Trash2,
  Unplug,
  Check,
  AlertTriangle,
} from 'lucide-react';
import { api, type MachineSummary, type PairedMasterSummary } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/Card';
import { toast } from '@/components/ui/Toaster';

export function MachinesSection() {
  return (
    <>
      <PairedMastersCard />
      <PairingTokensCard />
    </>
  );
}

// ─── Pairing tokens + list of paired secondaries (this machine is master) ──

function PairingTokensCard() {
  const queryClient = useQueryClient();
  const [activeToken, setActiveToken] = useState<{
    token: string;
    expiresAt: string;
    masterUrl: string;
  } | null>(null);

  const { data: machinesData, isLoading } = useQuery({
    queryKey: ['machines'],
    queryFn: api.listMachines,
    refetchInterval: 15_000,
  });
  const machines = machinesData?.machines ?? [];

  const createTokenMutation = useMutation({
    mutationFn: api.createPairingToken,
    onSuccess: (data) => {
      setActiveToken(data);
    },
    onError: (err) =>
      toast({ title: 'Failed to create token', description: (err as Error).message, variant: 'destructive' }),
  });

  const revokeMutation = useMutation({
    mutationFn: api.revokeMachine,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['machines'] });
      toast({ title: 'Machine unpaired' });
    },
    onError: (err) =>
      toast({ title: 'Unpair failed', description: (err as Error).message, variant: 'destructive' }),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Server className="h-5 w-5" />
          <CardTitle>Paired secondaries</CardTitle>
        </div>
        <CardDescription>
          Machines that have paired with this one. Generate a token, then paste it on the
          other machine (Settings → Paired masters).
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => createTokenMutation.mutate()}
            disabled={createTokenMutation.isPending}
          >
            {createTokenMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            Generate pairing token
          </Button>
        </div>

        {activeToken && (
          <PairingTokenCard
            token={activeToken.token}
            expiresAt={activeToken.expiresAt}
            masterUrl={activeToken.masterUrl}
            onDismiss={() => setActiveToken(null)}
          />
        )}

        {isLoading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : machines.length === 0 ? (
          <p className="text-sm text-muted-foreground">No paired secondaries.</p>
        ) : (
          <div className="space-y-2">
            {machines.map((m) => (
              <MachineRow
                key={m.id}
                machine={m}
                onUnpair={() => revokeMutation.mutate(m.id)}
                busy={revokeMutation.isPending && revokeMutation.variables === m.id}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PairingTokenCard({
  token,
  expiresAt,
  masterUrl,
  onDismiss,
}: {
  token: string;
  expiresAt: string;
  masterUrl: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, new Date(expiresAt).getTime() - Date.now()),
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const ms = Math.max(0, new Date(expiresAt).getTime() - Date.now());
      setRemainingMs(ms);
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAt]);

  const mins = Math.floor(remainingMs / 60_000);
  const secs = Math.floor((remainingMs % 60_000) / 1000);
  const expired = remainingMs === 0;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({ title: 'Clipboard unavailable', variant: 'destructive' });
    }
  };

  return (
    <div className="rounded-lg border p-3 space-y-3 bg-secondary/30">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium">
          {expired ? 'Token expired' : `Expires in ${mins}:${secs.toString().padStart(2, '0')}`}
        </div>
        <Button variant="ghost" size="sm" onClick={onDismiss}>
          Done
        </Button>
      </div>
      <LabeledCopyField label="Master URL" value={masterUrl || window.location.origin} onCopy={copy} />
      <LabeledCopyField label="Pairing token" value={token} onCopy={copy} disabled={expired} />
      {copied && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Check className="h-3 w-3" /> copied
        </div>
      )}
    </div>
  );
}

function LabeledCopyField({
  label,
  value,
  onCopy,
  disabled,
}: {
  label: string;
  value: string;
  onCopy: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1">
      <div className="text-xs text-muted-foreground uppercase tracking-wide">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 font-mono text-xs break-all p-2 rounded bg-background border">
          {value}
        </code>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onCopy(value)}
          disabled={disabled}
          title="Copy"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

function MachineRow({
  machine,
  onUnpair,
  busy,
}: {
  machine: MachineSummary;
  onUnpair: () => void;
  busy: boolean;
}) {
  const lastSeen = useRelativeTime(machine.lastSeenAt);
  return (
    <div className="flex items-center gap-3 p-2 rounded bg-secondary text-sm">
      <StatusDot online={machine.online} />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{machine.name}</div>
        <div className="text-xs text-muted-foreground truncate">
          {machine.online ? 'Online' : 'Offline'}
          {' · '}
          {machine.sessionCount} {machine.sessionCount === 1 ? 'session' : 'sessions'}
          {machine.version ? ` · v${machine.version}` : ''}
          {lastSeen ? ` · last seen ${lastSeen}` : ''}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
        onClick={onUnpair}
        disabled={busy}
        title="Unpair"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

// ─── Paired masters (this machine is secondary) ───────────────────────────

function PairedMastersCard() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['paired-masters'],
    queryFn: api.listPairedMasters,
    refetchInterval: 15_000,
  });
  const masters = data?.masters ?? [];

  const pairMutation = useMutation({
    mutationFn: api.pairMaster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paired-masters'] });
      setName('');
      setUrl('');
      setToken('');
      toast({ title: 'Paired with master' });
    },
    onError: (err) =>
      toast({ title: 'Pairing failed', description: (err as Error).message, variant: 'destructive' }),
  });

  const unpairMutation = useMutation({
    mutationFn: api.unpairMaster,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['paired-masters'] });
      toast({ title: 'Unpaired' });
    },
    onError: (err) =>
      toast({ title: 'Unpair failed', description: (err as Error).message, variant: 'destructive' }),
  });

  const submit = () => {
    if (!name.trim() || !url.trim() || !token.trim()) return;
    pairMutation.mutate({ name: name.trim(), url: url.trim(), token: token.trim() });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Monitor className="h-5 w-5" />
          <CardTitle>Paired masters</CardTitle>
        </div>
        <CardDescription>
          Remote machines this one is paired with. Paste the URL + pairing token from another
          machine&rsquo;s Settings → Paired secondaries.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : masters.length === 0 ? (
          <p className="text-sm text-muted-foreground">Not paired with any master.</p>
        ) : (
          <div className="space-y-2">
            {masters.map((m) => (
              <PairedMasterRow
                key={m.id}
                master={m}
                onUnpair={() => unpairMutation.mutate(m.id)}
                busy={unpairMutation.isPending && unpairMutation.variables === m.id}
              />
            ))}
          </div>
        )}

        <div className="space-y-2 pt-2 border-t">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">
            Pair with a master
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nickname (e.g. Prod)"
            />
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://master.example.com"
              className="font-mono text-xs"
            />
            <Input
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="rapt_…"
              className="font-mono text-xs"
            />
          </div>
          <Button
            size="sm"
            onClick={submit}
            disabled={!name || !url || !token || pairMutation.isPending}
          >
            {pairMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Plus className="h-4 w-4 mr-1" />
            )}
            Pair
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function PairedMasterRow({
  master,
  onUnpair,
  busy,
}: {
  master: PairedMasterSummary;
  onUnpair: () => void;
  busy: boolean;
}) {
  const lastSync = useRelativeTime(master.lastSyncAt);
  const healthy = !master.lastSyncError && master.lastSyncAt;

  return (
    <div className="flex items-center gap-3 p-2 rounded bg-secondary text-sm">
      <StatusDot online={Boolean(healthy)} />
      <div className="flex-1 min-w-0">
        <div className="font-medium truncate">{master.name}</div>
        <div className="text-xs text-muted-foreground truncate font-mono">{master.url}</div>
        <div className="text-xs text-muted-foreground truncate flex items-center gap-1">
          {master.lastSyncError ? (
            <>
              <AlertTriangle className="h-3 w-3 text-destructive" />
              <span className="text-destructive">{master.lastSyncError}</span>
            </>
          ) : lastSync ? (
            <>Synced {lastSync}</>
          ) : (
            <>Syncing…</>
          )}
        </div>
      </div>
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
        onClick={onUnpair}
        disabled={busy}
        title="Unpair"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
      </Button>
    </div>
  );
}

// ─── shared helpers ────────────────────────────────────────────────────────

function StatusDot({ online }: { online: boolean }) {
  return (
    <span
      className={`h-2 w-2 rounded-full shrink-0 ${online ? 'bg-green-500' : 'bg-muted-foreground/50'}`}
      title={online ? 'Online' : 'Offline'}
    />
  );
}

function useRelativeTime(iso: string | null): string | null {
  return useMemo(() => {
    if (!iso) return null;
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 30_000) return 'just now';
    if (diff < 60 * 60_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 24 * 60 * 60_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return `${Math.floor(diff / 86_400_000)}d ago`;
  }, [iso]);
}

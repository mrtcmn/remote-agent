import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, FolderPlus, ScrollText, Pencil, Trash2, X, Plus, Server, Loader2 } from 'lucide-react';
import { api, type SshHost, type SshGroup, type SshCredential, type SshLogEvent, type SshHostInput } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toaster';
import { cn } from '@/lib/utils';

// Sidebar section listing SSH hosts. Clicking a host reattaches to its live
// session if one exists, otherwise dials a new one, then routes to /ssh/:sessionId.
export function SshHostsSection({ onNavigate }: { onNavigate: (path: string) => void }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [editingHost, setEditingHost] = useState<SshHost | 'new' | null>(null);
  const [credOpen, setCredOpen] = useState(false);
  const [logsFor, setLogsFor] = useState<SshHost | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);

  const { data: hosts = [] } = useQuery({ queryKey: ['ssh-hosts'], queryFn: api.getSshHosts });
  const { data: groups = [] } = useQuery({ queryKey: ['ssh-groups'], queryFn: api.getSshGroups });
  const { data: creds = [] } = useQuery({ queryKey: ['ssh-credentials'], queryFn: api.getSshCredentials });
  const { data: activeSessions = [] } = useQuery({
    queryKey: ['ssh-sessions'],
    queryFn: api.getSshSessions,
    refetchInterval: 10000,
  });

  const reload = () => {
    queryClient.invalidateQueries({ queryKey: ['ssh-hosts'] });
    queryClient.invalidateQueries({ queryKey: ['ssh-groups'] });
    queryClient.invalidateQueries({ queryKey: ['ssh-credentials'] });
  };

  const connect = async (host: SshHost) => {
    const live = activeSessions.find((s) => s.hostId === host.id && s.status !== 'exited');
    if (live) { onNavigate(`/ssh/${live.sessionId}`); return; }
    setConnectingId(host.id);
    try {
      const { sessionId } = await api.connectSshHost(host.id);
      queryClient.invalidateQueries({ queryKey: ['ssh-sessions'] });
      onNavigate(`/ssh/${sessionId}`);
    } catch (err) {
      toast({ title: 'SSH connect failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setConnectingId(null);
    }
  };

  const sessionByHost = new Map(activeSessions.filter((s) => s.status !== 'exited').map((s) => [s.hostId, s]));
  const grouped = new Map<string | null, SshHost[]>();
  for (const h of hosts) {
    const key = h.groupId ?? null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(h);
  }

  return (
    <div className="px-1">
      <div className="flex items-center px-2 pb-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/40 font-semibold">SSH</span>
        <div className="ml-auto flex gap-0.5">
          <button title="Credentials" onClick={() => setCredOpen(true)} className="p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-secondary transition-colors"><KeyRound className="size-3" /></button>
          <button title="New group" onClick={async () => { const name = prompt('Group name'); if (name) { await api.createSshGroup({ name }); reload(); } }} className="p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-secondary transition-colors"><FolderPlus className="size-3" /></button>
          <button title="New host" onClick={() => setEditingHost('new')} className="p-1 rounded text-muted-foreground/50 hover:text-foreground hover:bg-secondary transition-colors"><Plus className="size-3.5" /></button>
        </div>
      </div>

      {hosts.length === 0 && (
        <p className="px-3 py-2 text-[11px] text-muted-foreground/40">No hosts — add one with +</p>
      )}
      {[...grouped.entries()].map(([groupId, groupHosts]) => (
        <div key={groupId ?? 'ungrouped'}>
          {groupId && (
            <div className="px-3 pt-1.5 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/50">
              {groups.find((g) => g.id === groupId)?.name ?? 'Group'}
            </div>
          )}
          {groupHosts.map((h) => {
            const live = sessionByHost.get(h.id);
            const isSelected = !!live && location.pathname === `/ssh/${live.sessionId}`;
            return (
              <div
                key={h.id}
                className={cn(
                  'group/host flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-md cursor-pointer',
                  isSelected ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'
                )}
                onClick={() => void connect(h)}
              >
                <div className="relative shrink-0">
                  <Server className="size-3 text-muted-foreground/40" />
                  <span className={cn(
                    'absolute -bottom-0.5 -right-0.5 w-1.5 h-1.5 rounded-full',
                    connectingId === h.id ? 'bg-yellow-500 animate-pulse' : live ? 'bg-emerald-500' : 'bg-muted-foreground/30'
                  )} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium truncate leading-snug">{h.label}</div>
                  <div className="text-[10px] text-muted-foreground/60 truncate">{h.username}@{h.host}:{h.port}</div>
                </div>
                {connectingId === h.id && <Loader2 className="size-3 animate-spin shrink-0" />}
                <div className="hidden group-hover/host:flex gap-0.5 shrink-0">
                  <button title="Logs" onClick={(e) => { e.stopPropagation(); setLogsFor(h); }} className="p-1 rounded hover:bg-background"><ScrollText className="size-3" /></button>
                  <button title="Edit" onClick={(e) => { e.stopPropagation(); setEditingHost(h); }} className="p-1 rounded hover:bg-background"><Pencil className="size-3" /></button>
                  <button title="Delete" onClick={async (e) => { e.stopPropagation(); if (confirm(`Delete ${h.label}?`)) { await api.deleteSshHost(h.id); reload(); } }} className="p-1 rounded hover:bg-background text-destructive"><Trash2 className="size-3" /></button>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {editingHost && (
        <HostEditor host={editingHost === 'new' ? null : editingHost} groups={groups} creds={creds}
          onClose={() => setEditingHost(null)} onSaved={() => { setEditingHost(null); reload(); }} />
      )}
      {credOpen && <CredentialVault creds={creds} onClose={() => setCredOpen(false)} onChanged={reload} />}
      {logsFor && <LogDrawer host={logsFor} onClose={() => setLogsFor(null)} />}
    </div>
  );
}

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <Dialog.Root open onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/50 z-50" />
        <Dialog.Content className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] max-w-[92vw] max-h-[85vh] overflow-y-auto rounded-lg border border-border bg-card p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="font-medium">{title}</Dialog.Title>
            <Dialog.Close className="p-1 rounded hover:bg-accent"><X className="size-4" /></Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function HostEditor({ host, groups, creds, onClose, onSaved }: {
  host: SshHost | null; groups: SshGroup[]; creds: SshCredential[]; onClose: () => void; onSaved: () => void;
}) {
  const [f, setF] = useState<SshHostInput>({
    label: host?.label ?? '', host: host?.host ?? '', port: host?.port ?? 22, username: host?.username ?? '',
    authType: host?.authType ?? 'password', credentialId: host?.credentialId ?? undefined,
    groupId: host?.groupId ?? undefined, tags: host?.tags ? JSON.parse(host.tags) : [],
  });
  const [saving, setSaving] = useState(false);
  const set = (p: Partial<SshHostInput>) => setF((s) => ({ ...s, ...p }));

  const save = async () => {
    setSaving(true);
    try {
      if (host) await api.updateSshHost(host.id, f);
      else await api.createSshHost(f);
      onSaved();
    } finally { setSaving(false); }
  };

  return (
    <Modal title={host ? 'Edit host' : 'New host'} onClose={onClose}>
      <div className="space-y-3">
        <Input placeholder="Label" value={f.label} onChange={(e) => set({ label: e.target.value })} />
        <div className="flex gap-2">
          <Input placeholder="Host / IP" value={f.host} onChange={(e) => set({ host: e.target.value })} className="flex-1" />
          <Input type="number" placeholder="Port" value={f.port} onChange={(e) => set({ port: Number(e.target.value) })} className="w-20" />
        </div>
        <Input placeholder="Username" value={f.username} onChange={(e) => set({ username: e.target.value })} />
        <div className="flex gap-2">
          <select value={f.authType} onChange={(e) => set({ authType: e.target.value as SshHostInput['authType'] })}
            className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm">
            <option value="password">Password</option>
            <option value="key">Private key</option>
            <option value="agent">SSH agent</option>
          </select>
          {f.authType !== 'agent' && (
            <select value={f.credentialId ?? ''} onChange={(e) => set({ credentialId: e.target.value || undefined })}
              className="flex-1 h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option value="">Credential…</option>
              {creds.filter((c) => c.type === f.authType).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          )}
        </div>
        <select value={f.groupId ?? ''} onChange={(e) => set({ groupId: e.target.value || undefined })}
          className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="">No group</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>
        <Button onClick={save} disabled={saving || !f.label || !f.host || !f.username} className="w-full">
          {saving ? 'Saving…' : host ? 'Save' : 'Create'}
        </Button>
      </div>
    </Modal>
  );
}

function CredentialVault({ creds, onClose, onChanged }: { creds: SshCredential[]; onClose: () => void; onChanged: () => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<'password' | 'key'>('password');
  const [secret, setSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');

  const add = async () => {
    await api.createSshCredential({ name, type, ...(type === 'password' ? { password: secret } : { privateKey: secret, passphrase: passphrase || undefined }) });
    setName(''); setSecret(''); setPassphrase(''); onChanged();
  };

  return (
    <Modal title="Credentials" onClose={onClose}>
      <div className="space-y-2 mb-4">
        {creds.length === 0 && <p className="text-xs text-muted-foreground">No credentials stored.</p>}
        {creds.map((c) => (
          <div key={c.id} className="flex items-center gap-2 text-sm py-1">
            <KeyRound className="size-3.5 text-muted-foreground" />
            <span className="flex-1 truncate">{c.name}</span>
            <span className="text-[10px] uppercase text-muted-foreground">{c.type}</span>
            <button onClick={async () => { await api.deleteSshCredential(c.id); onChanged(); }} className="text-destructive"><Trash2 className="size-3.5" /></button>
          </div>
        ))}
      </div>
      <div className="space-y-3 border-t border-border pt-4">
        <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <select value={type} onChange={(e) => setType(e.target.value as 'password' | 'key')} className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm">
          <option value="password">Password</option>
          <option value="key">Private key</option>
        </select>
        {type === 'password'
          ? <Input type="password" placeholder="Password" value={secret} onChange={(e) => setSecret(e.target.value)} />
          : <>
              <textarea placeholder="-----BEGIN PRIVATE KEY-----" value={secret} onChange={(e) => setSecret(e.target.value)}
                className="w-full h-24 rounded-md border border-input bg-background p-2 text-xs font-mono" />
              <Input type="password" placeholder="Passphrase (optional)" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
            </>}
        <Button onClick={add} disabled={!name || !secret} className="w-full">Add credential</Button>
      </div>
    </Modal>
  );
}

const LOG_COLOR: Record<SshLogEvent['type'], string> = {
  connect: 'text-emerald-400', disconnect: 'text-muted-foreground',
  retry: 'text-primary', auth_fail: 'text-destructive', error: 'text-destructive',
};

function LogDrawer({ host, onClose }: { host: SshHost; onClose: () => void }) {
  const { data: logs = [] } = useQuery({ queryKey: ['ssh-logs', host.id], queryFn: () => api.getSshHostLogs(host.id) });
  return (
    <Modal title={`Logs — ${host.label}`} onClose={onClose}>
      <div className="space-y-1 font-mono text-xs">
        {logs.length === 0 && <p className="text-muted-foreground">No events yet.</p>}
        {logs.map((l) => (
          <div key={l.id} className="flex gap-2">
            <span className="text-muted-foreground shrink-0">{new Date(l.createdAt).toLocaleTimeString()}</span>
            <span className={cn('shrink-0 w-20', LOG_COLOR[l.type])}>{l.type}</span>
            <span className="truncate">{l.message}</span>
          </div>
        ))}
      </div>
    </Modal>
  );
}

import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'motion/react';
import { KeyRound, FolderPlus, ScrollText, Pencil, Trash2, X, Plus, Server, Loader2, ChevronDown } from 'lucide-react';
import { api, type SshHost, type SshGroup, type SshCredential, type SshLogEvent, type SshHostInput } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { toast } from '@/components/ui/Toaster';
import { cn } from '@/lib/utils';
import { sessionPath } from '@/lib/session-route';

// Sidebar section: the live SSH connections, like sessions. Saved hosts are in
// the "+" dialog; a host click reuses its live connection or dials a new one.
export function SshHostsSection({ onNavigate }: { onNavigate: (path: string) => void }) {
  const location = useLocation();
  const queryClient = useQueryClient();
  const [editingHost, setEditingHost] = useState<SshHost | 'new' | null>(null);
  const [credOpen, setCredOpen] = useState(false);
  const [logsFor, setLogsFor] = useState<SshHost | null>(null);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Folded or open, kept across reloads like a preference.
  const [open, setOpenRaw] = useState(() => localStorage.getItem('sidebar.ssh.open') !== '0');
  const setOpen = (f: (v: boolean) => boolean) =>
    setOpenRaw((v) => { const n = f(v); localStorage.setItem('sidebar.ssh.open', n ? '1' : '0'); return n; });

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

  // A host opens in the normal session page, like any shell. A live
  // connection is reused — its own session, or a tab in another one.
  const connect = async (host: SshHost) => {
    const live = activeSessions.find((s) => s.hostId === host.id && s.status !== 'exited');
    if (live) { onNavigate(sessionPath('self', live.sessionId, live.terminalId)); return; }
    setConnectingId(host.id);
    try {
      const { sessionId, terminalId } = await api.connectSshHost(host.id);
      queryClient.invalidateQueries({ queryKey: ['ssh-sessions'] });
      onNavigate(sessionPath('self', sessionId, terminalId));
    } catch (err) {
      toast({ title: 'SSH connect failed', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setConnectingId(null);
    }
  };

  const live = activeSessions.filter((s) => s.status !== 'exited');
  const sessionByHost = new Map(live.map((s) => [s.hostId, s]));
  const grouped = new Map<string | null, SshHost[]>();
  for (const h of hosts) {
    const key = h.groupId ?? null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(h);
  }
  const iconBtn = 'flex size-5 items-center justify-center rounded hover:bg-secondary hover:text-foreground';

  return (
    <div>
      {/* Same fold as a machine section; only live connections are listed. */}
      <div className="flex items-center">
        <button onClick={() => setOpen((v) => !v)} className="flex-1 min-w-0 flex items-center gap-1.5 pl-3 py-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
          <motion.span animate={{ rotate: open ? 0 : -90 }} transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }} className="flex items-center">
            <ChevronDown className="size-3" />
          </motion.span>
          <Server className="size-3" />
          <span className="font-medium">SSH</span>
          <span className="ml-auto font-mono text-[10px]">{live.length}</span>
        </button>
        <div className="flex items-center gap-0.5 pl-1.5 pr-2 text-muted-foreground">
          <button title="Keys and passwords" onClick={() => setCredOpen(true)} className={iconBtn}><KeyRound className="size-3" /></button>
          <button title="Connect to a host" onClick={() => setPickerOpen(true)} className={iconBtn}><Plus className="size-3" /></button>
        </div>
      </div>

      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: [0.4, 0, 0.2, 1] }}
            style={{ overflow: 'hidden' }}
            className="px-2 pb-1"
          >
            {live.length === 0 ? (
              <p className="px-1 py-2 text-[11px] text-muted-foreground/40">No connections</p>
            ) : live.map((c) => {
              const h = hosts.find((x) => x.id === c.hostId);
              const path = sessionPath('self', c.sessionId, c.terminalId);
              const selected = location.pathname === path;
              return (
                <div
                  key={c.terminalId}
                  onClick={() => onNavigate(path)}
                  className={cn(
                    'group/conn flex items-center gap-2 pl-2 pr-1.5 py-1.5 rounded-md cursor-pointer',
                    selected ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                  )}
                >
                  <span
                    title={c.status === 'running' ? 'Connected' : 'Connecting'}
                    className={cn('size-1.5 rounded-full shrink-0', c.status === 'running' ? 'bg-emerald-500' : 'bg-yellow-500 animate-pulse')}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate leading-snug">{h?.label ?? 'SSH'}</div>
                    {h && <div className="text-[10px] text-muted-foreground/60 truncate">{h.username}@{h.host}{c.standalone ? '' : ' · tab in a session'}</div>}
                  </div>
                  <button
                    title="Disconnect"
                    onClick={async (e) => {
                      e.stopPropagation();
                      await api.stopSshTerminal(c.terminalId).catch(() => {});
                      queryClient.invalidateQueries({ queryKey: ['ssh-sessions'] });
                    }}
                    className="hidden group-hover/conn:flex size-4 items-center justify-center rounded hover:bg-background shrink-0"
                  >
                    <X className="size-3" />
                  </button>
                </div>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>

      {pickerOpen && (
        <Modal title="Connect to a host" onClose={() => setPickerOpen(false)}>
          {hosts.length === 0 && <p className="py-2 text-xs text-muted-foreground">No hosts yet.</p>}
          {[...grouped.entries()].map(([groupId, groupHosts]) => (
            <div key={groupId ?? 'ungrouped'}>
              {groupId && (
                <div className="px-2 pt-2 pb-0.5 text-[10px] uppercase tracking-wide text-muted-foreground/50">
                  {groups.find((g) => g.id === groupId)?.name ?? 'Group'}
                </div>
              )}
              {groupHosts.map((h) => (
                <div
                  key={h.id}
                  className="group/host flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-muted-foreground hover:bg-secondary hover:text-foreground"
                  onClick={() => { setPickerOpen(false); void connect(h); }}
                >
                  <Server className="size-3.5 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium truncate leading-snug">{h.label}</div>
                    <div className="text-[10px] text-muted-foreground/60 truncate">{h.username}@{h.host}:{h.port}</div>
                  </div>
                  {sessionByHost.has(h.id) && <span className="text-[10px] text-emerald-500 shrink-0">connected</span>}
                  <div className="hidden group-hover/host:flex gap-0.5 shrink-0">
                    <button title="Logs" onClick={(e) => { e.stopPropagation(); setLogsFor(h); }} className="p-1 rounded hover:bg-background"><ScrollText className="size-3" /></button>
                    <button title="Edit" onClick={(e) => { e.stopPropagation(); setEditingHost(h); }} className="p-1 rounded hover:bg-background"><Pencil className="size-3" /></button>
                    <button title="Delete" onClick={async (e) => { e.stopPropagation(); if (confirm(`Delete ${h.label}?`)) { await api.deleteSshHost(h.id); reload(); } }} className="p-1 rounded hover:bg-background text-destructive"><Trash2 className="size-3" /></button>
                  </div>
                </div>
              ))}
            </div>
          ))}
          <div className="flex gap-2 mt-4">
            <Button size="sm" onClick={() => setEditingHost('new')}><Plus className="size-3.5 mr-1" />New host</Button>
            <Button size="sm" variant="ghost" onClick={async () => { const name = prompt('Group name'); if (name) { await api.createSshGroup({ name }); reload(); } }}>
              <FolderPlus className="size-3.5 mr-1" />New group
            </Button>
          </div>
        </Modal>
      )}
      {connectingId && (
        <p className="flex items-center gap-1.5 px-4 pb-1 text-[11px] text-muted-foreground">
          <Loader2 className="size-3 animate-spin" />Connecting…
        </p>
      )}
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

type VaultMode = 'password' | 'paste' | 'generate' | 'import';

// Secrets go in, never out: the server encrypts them (AES-256-GCM) and only
// ever returns a key's public half, for the server's authorized_keys.
function CredentialVault({ creds, onClose, onChanged }: { creds: SshCredential[]; onClose: () => void; onChanged: () => void }) {
  const [mode, setMode] = useState<VaultMode>('generate');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [file, setFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const { data: localKeys = [] } = useQuery({
    queryKey: ['ssh-local-keys'], queryFn: api.getLocalSshKeys, enabled: mode === 'import', retry: false,
  });
  const picked = localKeys.find((k) => k.file === file);

  const add = async () => {
    setBusy(true);
    try {
      const made = mode === 'password' ? await api.createSshCredential({ name, type: 'password', password: secret })
        : mode === 'paste' ? await api.createSshCredential({ name, type: 'key', privateKey: secret, passphrase: passphrase || undefined })
        : mode === 'generate' ? await api.generateSshKey(name)
        : await api.importSshKey({ file, name: name || file, passphrase: passphrase || undefined });
      setName(''); setSecret(''); setPassphrase(''); setFile('');
      if (made.publicKey) setShown(made.id); // show the new key's public half at once
      onChanged();
    } catch (err) {
      toast({ title: 'Could not add credential', description: (err as Error).message, variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  const ready = mode === 'import' ? !!file && (!picked?.encrypted || !!passphrase)
    : mode === 'generate' ? !!name
    : !!name && !!secret;

  return (
    <Modal title="Credentials" onClose={onClose}>
      <div className="space-y-1 mb-4">
        {creds.length === 0 && <p className="text-xs text-muted-foreground">No credentials stored.</p>}
        {creds.map((c) => (
          <div key={c.id} className="text-sm py-1">
            <div className="flex items-center gap-2">
              <KeyRound className="size-3.5 text-muted-foreground" />
              <span className="flex-1 truncate">{c.name}</span>
              {c.publicKey && (
                <button onClick={() => setShown(shown === c.id ? null : c.id)} className="text-[10px] text-muted-foreground hover:text-foreground">
                  {shown === c.id ? 'hide' : 'public key'}
                </button>
              )}
              <span className="text-[10px] uppercase text-muted-foreground">{c.type}</span>
              <button aria-label={`Delete ${c.name}`} onClick={async () => { await api.deleteSshCredential(c.id); onChanged(); }} className="text-destructive"><Trash2 className="size-3.5" /></button>
            </div>
            {shown === c.id && c.publicKey && (
              <div className="mt-1.5 space-y-1">
                <textarea readOnly value={c.publicKey} onFocus={(e) => e.currentTarget.select()}
                  className="w-full h-16 rounded-md border border-input bg-background p-2 text-[10px] font-mono break-all" />
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                  <span className="flex-1 truncate font-mono">{c.fingerprint}</span>
                  <button onClick={() => { void navigator.clipboard.writeText(c.publicKey!); toast({ title: 'Public key copied' }); }} className="hover:text-foreground">copy</button>
                </div>
                <p className="text-[10px] text-muted-foreground">Add this line to <code>~/.ssh/authorized_keys</code> on the server.</p>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="space-y-3 border-t border-border pt-4">
        <div className="grid grid-cols-4 gap-1 rounded-md bg-secondary/50 p-0.5 text-xs">
          {([['generate', 'Generate'], ['import', '~/.ssh'], ['paste', 'Paste key'], ['password', 'Password']] as const).map(([m, label]) => (
            <button key={m} onClick={() => setMode(m)}
              className={cn('rounded px-2 py-1', mode === m ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
              {label}
            </button>
          ))}
        </div>
        {mode === 'import' ? (
          <>
            <select value={file} onChange={(e) => setFile(e.target.value)} className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm">
              <option value="">{localKeys.length ? 'Pick a key from ~/.ssh…' : 'No private keys found in ~/.ssh'}</option>
              {localKeys.map((k) => <option key={k.file} value={k.file}>{k.file}{k.encrypted ? ' (passphrase)' : ''}</option>)}
            </select>
            <Input placeholder={file ? `Name (default: ${file})` : 'Name'} value={name} onChange={(e) => setName(e.target.value)} />
            {picked?.encrypted && <Input type="password" placeholder="Passphrase" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />}
          </>
        ) : (
          <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        )}
        {mode === 'generate' && <p className="text-xs text-muted-foreground">Makes a new ed25519 key. Its public key shows here to put on the server.</p>}
        {mode === 'password' && <Input type="password" placeholder="Password" value={secret} onChange={(e) => setSecret(e.target.value)} />}
        {mode === 'paste' && (
          <>
            <textarea placeholder="-----BEGIN OPENSSH PRIVATE KEY-----" value={secret} onChange={(e) => setSecret(e.target.value)}
              className="w-full h-24 rounded-md border border-input bg-background p-2 text-xs font-mono" />
            <Input type="password" placeholder="Passphrase (if the key has one)" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} />
          </>
        )}
        <Button onClick={add} disabled={!ready || busy} className="w-full gap-1.5">
          {busy && <Loader2 className="size-3.5 animate-spin" />}
          {mode === 'generate' ? 'Generate key' : mode === 'import' ? 'Import key' : 'Add credential'}
        </Button>
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

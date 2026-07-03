import { useEffect, useState, useCallback } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Server, Plus, KeyRound, FolderPlus, ScrollText, Pencil, Trash2, X, Terminal as TermIcon } from 'lucide-react';
import { api, type SshHost, type SshGroup, type SshCredential, type SshLogEvent, type SshHostInput } from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { SshTerminal } from '@/components/ssh/SshTerminal';
import { cn } from '@/lib/utils';

interface OpenSession { sessionId: string; host: SshHost; }

export function SshPage() {
  const [hosts, setHosts] = useState<SshHost[]>([]);
  const [groups, setGroups] = useState<SshGroup[]>([]);
  const [creds, setCreds] = useState<SshCredential[]>([]);
  const [sessions, setSessions] = useState<OpenSession[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [editingHost, setEditingHost] = useState<SshHost | 'new' | null>(null);
  const [credOpen, setCredOpen] = useState(false);
  const [logsFor, setLogsFor] = useState<SshHost | null>(null);

  const reload = useCallback(async () => {
    const [h, g, c] = await Promise.all([api.getSshHosts(), api.getSshGroups(), api.getSshCredentials()]);
    setHosts(h); setGroups(g); setCreds(c);
  }, []);
  useEffect(() => { void reload(); }, [reload]);

  const connect = useCallback(async (host: SshHost) => {
    const existing = sessions.find((s) => s.host.id === host.id);
    if (existing) { setActive(existing.sessionId); return; }
    const { sessionId } = await api.connectSshHost(host.id);
    setSessions((s) => [...s, { sessionId, host }]);
    setActive(sessionId);
  }, [sessions]);

  const closeSession = useCallback(async (sessionId: string) => {
    await api.stopSshSession(sessionId).catch(() => {});
    setSessions((s) => s.filter((x) => x.sessionId !== sessionId));
    setActive((a) => (a === sessionId ? null : a));
  }, []);

  const connectedHostIds = new Set(sessions.map((s) => s.host.id));
  const grouped = new Map<string | null, SshHost[]>();
  for (const h of hosts) {
    const key = h.groupId ?? null;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(h);
  }

  return (
    <div className="flex h-full">
      {/* ── Host tree ─────────────────────────────────────────── */}
      <aside className="w-72 shrink-0 border-r border-border bg-sidebar flex flex-col">
        <header className="flex items-center gap-2 px-3 h-12 border-b border-border">
          <Server className="size-4 text-primary" />
          <span className="font-medium text-sm">SSH Hosts</span>
          <div className="ml-auto flex gap-1">
            <button title="New credential" onClick={() => setCredOpen(true)} className="p-1.5 rounded hover:bg-accent"><KeyRound className="size-3.5" /></button>
            <button title="New group" onClick={async () => { const name = prompt('Group name'); if (name) { await api.createSshGroup({ name }); void reload(); } }} className="p-1.5 rounded hover:bg-accent"><FolderPlus className="size-3.5" /></button>
            <button title="New host" onClick={() => setEditingHost('new')} className="p-1.5 rounded hover:bg-accent"><Plus className="size-4" /></button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto py-1">
          {hosts.length === 0 && <p className="px-3 py-6 text-xs text-muted-foreground text-center">No hosts yet. Add one with +</p>}
          {[...grouped.entries()].map(([groupId, groupHosts]) => (
            <div key={groupId ?? 'ungrouped'} className="mb-1">
              {groupId && <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wide text-muted-foreground">{groups.find((g) => g.id === groupId)?.name ?? 'Group'}</div>}
              {groupHosts.map((h) => (
                <HostRow key={h.id} host={h} connected={connectedHostIds.has(h.id)}
                  onConnect={() => connect(h)} onEdit={() => setEditingHost(h)} onLogs={() => setLogsFor(h)}
                  onDelete={async () => { if (confirm(`Delete ${h.label}?`)) { await api.deleteSshHost(h.id); void reload(); } }} />
              ))}
            </div>
          ))}
        </div>
      </aside>

      {/* ── Terminal area ─────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {sessions.length > 0 && (
          <div className="flex items-center gap-1 h-10 px-2 border-b border-border overflow-x-auto">
            {sessions.map((s) => (
              <div key={s.sessionId}
                className={cn('flex items-center gap-2 px-3 h-7 rounded-md text-xs cursor-pointer whitespace-nowrap',
                  active === s.sessionId ? 'bg-accent text-foreground' : 'text-muted-foreground hover:bg-accent/50')}
                onClick={() => setActive(s.sessionId)}>
                <span className="size-1.5 rounded-full bg-primary" />
                {s.host.label}
                <button onClick={(e) => { e.stopPropagation(); void closeSession(s.sessionId); }} className="hover:text-destructive"><X className="size-3" /></button>
              </div>
            ))}
          </div>
        )}
        <div className="flex-1 min-h-0">
          {active ? (
            <SshTerminal key={active} sessionId={active} />
          ) : (
            <div className="h-full grid place-items-center text-muted-foreground">
              <div className="flex flex-col items-center gap-2">
                <TermIcon className="size-8 opacity-40" />
                <p className="text-sm">Select a host to connect</p>
              </div>
            </div>
          )}
        </div>
      </main>

      {editingHost && (
        <HostEditor host={editingHost === 'new' ? null : editingHost} groups={groups} creds={creds}
          onClose={() => setEditingHost(null)} onSaved={() => { setEditingHost(null); void reload(); }} />
      )}
      {credOpen && <CredentialVault creds={creds} onClose={() => setCredOpen(false)} onChanged={reload} />}
      {logsFor && <LogDrawer host={logsFor} onClose={() => setLogsFor(null)} />}
    </div>
  );
}

function HostRow({ host, connected, onConnect, onEdit, onLogs, onDelete }: {
  host: SshHost; connected: boolean; onConnect: () => void; onEdit: () => void; onLogs: () => void; onDelete: () => void;
}) {
  return (
    <div className="group flex items-center gap-2 px-3 py-1.5 hover:bg-accent cursor-pointer" onDoubleClick={onConnect}>
      <span className={cn('size-2 rounded-full shrink-0', connected ? 'bg-primary shadow-[0_0_6px] shadow-primary' : 'bg-muted-foreground/40')} />
      <button className="flex-1 min-w-0 text-left" onClick={onConnect}>
        <div className="text-sm truncate">{host.label}</div>
        <div className="text-[11px] text-muted-foreground truncate">{host.username}@{host.host}:{host.port}</div>
      </button>
      <div className="hidden group-hover:flex gap-0.5">
        <button title="Logs" onClick={onLogs} className="p-1 rounded hover:bg-background"><ScrollText className="size-3.5" /></button>
        <button title="Edit" onClick={onEdit} className="p-1 rounded hover:bg-background"><Pencil className="size-3.5" /></button>
        <button title="Delete" onClick={onDelete} className="p-1 rounded hover:bg-background text-destructive"><Trash2 className="size-3.5" /></button>
      </div>
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
  const [logs, setLogs] = useState<SshLogEvent[]>([]);
  useEffect(() => { void api.getSshHostLogs(host.id).then(setLogs); }, [host.id]);
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

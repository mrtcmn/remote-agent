import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Laptop, Server, Wifi, WifiOff } from 'lucide-react';
import { api, type PairedMasterSummary } from '@/lib/api';
import { useActiveMachine } from '@/lib/active-machine';
import { cn } from '@/lib/utils';

export function MachineSwitcher() {
  const { machineId, name, setActive, reset } = useActiveMachine();
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const rootRef = useRef<HTMLDivElement>(null);

  const { data } = useQuery({
    queryKey: ['paired-masters'],
    queryFn: api.listPairedMasters,
    refetchInterval: 15_000,
  });
  const masters = data?.masters ?? [];

  // Close when clicking outside.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // If the currently active machine was unpaired, fall back to self.
  useEffect(() => {
    if (machineId === 'self') return;
    if (!data) return;
    if (!masters.find((m) => m.id === machineId)) reset();
  }, [data, masters, machineId, reset]);

  const isRemote = machineId !== 'self';
  const activeMaster = isRemote ? masters.find((m) => m.id === machineId) : null;

  const pick = (item: { machineId: string; name: string }) => {
    setActive(item);
    setOpen(false);
    // Remote context changed — bust server-sourced caches.
    queryClient.invalidateQueries();
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-xs transition-colors',
          isRemote
            ? 'bg-primary/10 text-primary hover:bg-primary/15'
            : 'text-muted-foreground hover:text-foreground hover:bg-secondary',
        )}
        title={isRemote ? `Controlling ${name}` : 'Local machine'}
      >
        {isRemote ? (
          <Server className="size-3.5 shrink-0" />
        ) : (
          <Laptop className="size-3.5 shrink-0" />
        )}
        <span className="flex-1 text-left truncate">{name}</span>
        {activeMaster && <StatusIcon master={activeMaster} />}
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </button>

      {open && (
        <div className="absolute z-20 left-0 right-0 top-full mt-1 rounded-md border bg-card shadow-lg overflow-hidden">
          <MenuItem
            icon={<Laptop className="size-3.5" />}
            label="This machine"
            selected={!isRemote}
            onClick={() => pick({ machineId: 'self', name: 'This machine' })}
          />
          {masters.length > 0 && <div className="h-px bg-border" />}
          {masters.map((m) => (
            <MenuItem
              key={m.id}
              icon={<Server className="size-3.5" />}
              label={m.name}
              hint={m.url}
              selected={m.id === machineId}
              onClick={() => pick({ machineId: m.id, name: m.name })}
              right={<StatusIcon master={m} />}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  icon,
  label,
  hint,
  selected,
  onClick,
  right,
}: {
  icon: React.ReactNode;
  label: string;
  hint?: string;
  selected: boolean;
  onClick: () => void;
  right?: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full flex items-center gap-2 px-2.5 py-1.5 text-xs text-left hover:bg-secondary',
        selected && 'bg-secondary/60',
      )}
    >
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="truncate font-medium">{label}</div>
        {hint && <div className="truncate text-[10px] text-muted-foreground font-mono">{hint}</div>}
      </div>
      {right}
      {selected && <Check className="size-3 shrink-0 text-primary" />}
    </button>
  );
}

function StatusIcon({ master }: { master: PairedMasterSummary }) {
  const healthy = !master.lastSyncError && master.lastSyncAt;
  return healthy ? (
    <Wifi className="size-3 text-green-500 shrink-0" />
  ) : (
    <WifiOff className="size-3 text-muted-foreground shrink-0" />
  );
}

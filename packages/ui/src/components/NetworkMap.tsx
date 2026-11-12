import { useQuery } from '@tanstack/react-query';
import { Network } from 'lucide-react';
import { api, type NetworkNode, type NetworkPath } from '@/lib/api';
import { SettingsSection } from '@/components/ui/SettingsSection';

const PATH: Record<NetworkPath, { label: string; color: string; dash?: string }> = {
  address: { label: 'Direct address', color: '#22c55e' },
  url: { label: 'Public URL', color: '#3b82f6' },
  tunnel: { label: 'Tunnel', color: '#f59e0b' },
  relay: { label: 'Relay through the hub', color: '#a855f7', dash: '5 4' },
};

const W = 640;
const H = 300;
const CX = W / 2;
const CY = H / 2;

/** Machines on an ellipse around this one. */
function place(index: number, count: number): { x: number; y: number } {
  const angle = (index / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2 + (count === 2 ? Math.PI / 2 : 0);
  return { x: CX + Math.cos(angle) * 220, y: CY + Math.sin(angle) * 105 };
}

export function NetworkMap() {
  const { data } = useQuery({
    queryKey: ['network-map'],
    queryFn: api.getNetworkMap,
    refetchInterval: 10_000,
  });
  if (!data || data.nodes.length === 0) return null;

  const pos = new Map(data.nodes.map((n, i) => [n.id, place(i, data.nodes.length)]));

  return (
    <SettingsSection
      icon={Network}
      title="Network"
      description="How this machine reaches the others. The numbers are the response times of the last check."
    >
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-foreground" role="img" aria-label="Network map">
        {data.nodes.map((n) => {
          const to = pos.get(n.id)!;
          // A relayed call leaves the hub, not this machine.
          const from = (n.path === 'relay' && n.via && pos.get(n.via)) || { x: CX, y: CY };
          const style = PATH[n.path];
          const mx = (from.x + to.x) / 2;
          const my = (from.y + to.y) / 2;
          return (
            <g key={`line-${n.id}`} opacity={n.online ? 1 : 0.35}>
              <line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke={n.online ? style.color : 'currentColor'} strokeWidth={2} strokeDasharray={n.online ? style.dash : '2 4'} />
              <text x={mx} y={my - 6} textAnchor="middle" fontSize={10} fill="currentColor" opacity={0.75}>
                {n.online ? `${n.ms} ms` : 'offline'}
              </text>
            </g>
          );
        })}
        <Box x={CX} y={CY} name={data.self.name} sub={`this machine · v${data.self.version}`} online />
        {data.nodes.map((n) => {
          const p = pos.get(n.id)!;
          return <Box key={n.id} x={p.x} y={p.y} name={n.name} sub={subtitle(n)} online={n.online} />;
        })}
      </svg>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {(Object.keys(PATH) as NetworkPath[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5" style={{ background: PATH[k].color }} />
            {PATH[k].label}
          </span>
        ))}
      </div>
    </SettingsSection>
  );
}

function subtitle(n: NetworkNode): string {
  const parts = [n.path === 'address' && n.host ? n.host : PATH[n.path].label.toLowerCase()];
  if (n.version) parts.push(`v${n.version}`);
  return parts.join(' · ');
}

function Box({ x, y, name, sub, online }: { x: number; y: number; name: string; sub: string; online: boolean }) {
  const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);
  return (
    <g opacity={online ? 1 : 0.5}>
      <rect x={x - 80} y={y - 21} width={160} height={42} rx={8} className="fill-secondary stroke-border" strokeWidth={1} />
      <circle cx={x - 66} cy={y - 6} r={3.5} fill={online ? '#22c55e' : '#737373'} />
      <text x={x - 56} y={y - 2} fontSize={12} fontWeight={600} fill="currentColor">{clip(name, 19)}</text>
      <text x={x - 66} y={y + 13} fontSize={9.5} fill="currentColor" opacity={0.65}>{clip(sub, 30)}</text>
    </g>
  );
}

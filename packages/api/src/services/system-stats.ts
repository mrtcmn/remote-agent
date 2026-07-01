import { spawn } from 'bun';
import { cpus, totalmem, freemem } from 'os';

/** Same shape as docker's ContainerStats / the UI's SystemStats. */
export interface SystemStats {
  cpu: number;       // percentage 0-100 (all cores)
  memUsed: number;   // bytes
  memTotal: number;  // bytes
  diskUsed: number;  // bytes
  diskTotal: number; // bytes
}

function cpuSnapshot(): { idle: number; total: number } {
  let idle = 0;
  let total = 0;
  for (const cpu of cpus()) {
    for (const v of Object.values(cpu.times)) total += v;
    idle += cpu.times.idle;
  }
  return { idle, total };
}

/**
 * Instantaneous CPU usage (0-100) across all cores. `os` only exposes
 * cumulative tick counters, so we sample twice over `sampleMs` and take the
 * delta — load averages (os.loadavg) aren't a 0-100 percentage.
 */
async function getCpuPercent(sampleMs = 150): Promise<number> {
  const a = cpuSnapshot();
  await new Promise((r) => setTimeout(r, sampleMs));
  const b = cpuSnapshot();
  const idleDelta = b.idle - a.idle;
  const totalDelta = b.total - a.total;
  if (totalDelta <= 0) return 0;
  const used = (1 - idleDelta / totalDelta) * 100;
  return Math.max(0, Math.min(100, Math.round(used)));
}

/**
 * Disk usage of `/` in bytes via POSIX `df -Pk` (works on macOS and Linux;
 * note GNU-only flags like `-B1` are not portable to macOS). Returns zeros if
 * df is unavailable rather than throwing, so a stats poll never 500s on it.
 */
async function getDiskBytes(): Promise<{ used: number; total: number }> {
  try {
    const proc = spawn(['df', '-Pk', '/'], { stdout: 'pipe', stderr: 'ignore' });
    const out = await new Response(proc.stdout).text();
    await proc.exited;
    const line = out.trim().split('\n')[1] ?? '';
    const cols = line.split(/\s+/);
    const blocks = parseInt(cols[1], 10) || 0; // 1024-byte blocks
    const used = parseInt(cols[2], 10) || 0;
    return { used: used * 1024, total: blocks * 1024 };
  } catch {
    return { used: 0, total: 0 };
  }
}

/**
 * Host system stats from the machine the API runs on — no Docker required.
 * Used in local mode, where `docker stats` isn't available (the Mac itself).
 */
export async function getLocalSystemStats(): Promise<SystemStats> {
  const [cpu, disk] = await Promise.all([getCpuPercent(), getDiskBytes()]);
  const memTotal = totalmem();
  const memUsed = Math.max(0, memTotal - freemem());
  return { cpu, memUsed, memTotal, diskUsed: disk.used, diskTotal: disk.total };
}

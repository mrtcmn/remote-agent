import { spawn } from 'bun';

export interface DockerContainer {
  id: string;
  names: string;
  image: string;
  status: string;
  state: string;
  ports: string;
  createdAt: string;
}

export interface ContainerStats {
  cpu: number;       // percentage 0-100
  memUsed: number;   // bytes
  memTotal: number;  // bytes
  diskUsed: number;  // bytes
  diskTotal: number; // bytes
}

export interface DockerFile {
  path: string;
  type: 'dockerfile' | 'compose';
  name: string;
}

const DOCKERFILE_PATTERN = /^Dockerfile(\..+)?$/i;
const COMPOSE_PATTERN = /^(docker-)?compose(\..+)?\.(yml|yaml)$/i;

class DockerService {
  /**
   * Run a docker CLI command and return stdout.
   * Throws on non-zero exit.
   */
  private async exec(args: string[]): Promise<string> {
    const proc = spawn(['docker', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const stdout = await new Response(proc.stdout).text();
    const stderr = await new Response(proc.stderr).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(stderr.trim() || `docker ${args[0]} failed with exit code ${exitCode}`);
    }

    return stdout.trim();
  }

  async listContainers(): Promise<DockerContainer[]> {
    const format = '{{json .}}';
    const output = await this.exec(['ps', '-a', '--format', format]);
    if (!output) return [];

    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const raw = JSON.parse(line);
        return {
          id: raw.ID,
          names: raw.Names,
          image: raw.Image,
          status: raw.Status,
          state: raw.State,
          ports: raw.Ports,
          createdAt: raw.CreatedAt,
        };
      });
  }

  async startContainer(id: string): Promise<void> {
    await this.exec(['start', id]);
  }

  async stopContainer(id: string): Promise<void> {
    await this.exec(['stop', id]);
  }

  async restartContainer(id: string): Promise<void> {
    await this.exec(['restart', id]);
  }

  async removeContainer(id: string, force = false): Promise<void> {
    const args = ['rm'];
    if (force) args.push('-f');
    args.push(id);
    await this.exec(args);
  }

  getLogsCommand(containerId: string): string[] {
    return ['docker', 'logs', '--tail', '200', '-f', containerId];
  }

  async buildImage(dockerfilePath: string, contextDir: string, tag?: string): Promise<string> {
    const args = ['build', '-f', dockerfilePath];
    if (tag) args.push('-t', tag);
    args.push(contextDir);
    return this.exec(args);
  }

  async runContainer(opts: {
    image: string;
    name?: string;
    ports?: string[];
    env?: Record<string, string>;
    detach?: boolean;
  }): Promise<string> {
    const args = ['run'];
    if (opts.detach !== false) args.push('-d');
    if (opts.name) args.push('--name', opts.name);
    if (opts.ports) {
      for (const port of opts.ports) {
        args.push('-p', port);
      }
    }
    if (opts.env) {
      for (const [key, val] of Object.entries(opts.env)) {
        args.push('-e', `${key}=${val}`);
      }
    }
    args.push(opts.image);
    return this.exec(args);
  }

  async composeUp(composePath: string): Promise<string> {
    return this.exec(['compose', '-f', composePath, 'up', '-d']);
  }

  async composeDown(composePath: string): Promise<string> {
    return this.exec(['compose', '-f', composePath, 'down']);
  }

  async composePs(composePath: string): Promise<DockerContainer[]> {
    const format = '{{json .}}';
    const output = await this.exec(['compose', '-f', composePath, 'ps', '--format', format]);
    if (!output) return [];

    return output
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const raw = JSON.parse(line);
        return {
          id: raw.ID,
          names: raw.Name || raw.Names,
          image: raw.Image,
          status: raw.Status,
          state: raw.State,
          ports: raw.Ports || raw.Publishers || '',
          createdAt: raw.CreatedAt || '',
        };
      });
  }

  async detectFiles(projectPath: string, maxDepth = 3): Promise<DockerFile[]> {
    const { readdir } = await import('fs/promises');
    const { join, relative } = await import('path');
    const results: DockerFile[] = [];

    const scan = async (dir: string, depth: number) => {
      if (depth > maxDepth) return;
      try {
        const entries = await readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (['node_modules', '.git', 'dist', 'build', '.next', 'vendor'].includes(entry.name)) continue;
            await scan(join(dir, entry.name), depth + 1);
          } else if (entry.isFile()) {
            if (DOCKERFILE_PATTERN.test(entry.name)) {
              results.push({
                path: relative(projectPath, join(dir, entry.name)),
                type: 'dockerfile',
                name: entry.name,
              });
            } else if (COMPOSE_PATTERN.test(entry.name)) {
              results.push({
                path: relative(projectPath, join(dir, entry.name)),
                type: 'compose',
                name: entry.name,
              });
            }
          }
        }
      } catch {
        // Permission denied or other fs error — skip
      }
    };

    await scan(projectPath, 0);
    return results;
  }

  async getHostStats(): Promise<ContainerStats> {
    const containerId = (await import('os')).hostname();

    // CPU & memory from docker stats
    const statsOut = await this.exec([
      'stats', '--no-stream', '--format',
      '{{.CPUPerc}}\t{{.MemUsage}}',
      containerId,
    ]);

    // Parse "2.34%\t1.5GiB / 16GiB"
    const [cpuRaw, memRaw] = statsOut.split('\t');
    const cpu = parseFloat(cpuRaw.replace('%', '')) || 0;

    const memParts = memRaw.split('/').map((s) => s.trim());
    const parseBytes = (s: string): number => {
      const match = s.match(/([\d.]+)\s*(GiB|MiB|KiB|B)/i);
      if (!match) return 0;
      const val = parseFloat(match[1]);
      const unit = match[2].toLowerCase();
      if (unit === 'gib') return val * 1024 ** 3;
      if (unit === 'mib') return val * 1024 ** 2;
      if (unit === 'kib') return val * 1024;
      return val;
    };
    const memUsed = parseBytes(memParts[0]);
    const memTotal = parseBytes(memParts[1]);

    // Disk from df
    const proc = spawn(['df', '-B1', '/'], { stdout: 'pipe', stderr: 'pipe' });
    const dfOut = await new Response(proc.stdout).text();
    await proc.exited;
    const dfLine = dfOut.trim().split('\n')[1];
    const dfCols = dfLine.split(/\s+/);
    const diskTotal = parseInt(dfCols[1], 10) || 0;
    const diskUsed = parseInt(dfCols[2], 10) || 0;

    return { cpu: Math.round(cpu), memUsed, memTotal, diskUsed, diskTotal };
  }

  async isAvailable(): Promise<boolean> {
    try {
      await this.exec(['info', '--format', '{{.ServerVersion}}']);
      return true;
    } catch {
      return false;
    }
  }
}

export const dockerService = new DockerService();

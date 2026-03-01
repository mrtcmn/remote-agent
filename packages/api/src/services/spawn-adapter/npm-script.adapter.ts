import { readFile } from 'fs/promises';
import { join } from 'path';
import { BaseSpawnAdapter } from './base.adapter';
import type { SpawnAdapterType, ResolvedCommand } from './types';

export interface DiscoveredScript {
  name: string;
  command: string;
}

export class NpmScriptAdapter extends BaseSpawnAdapter {
  readonly name = 'npm Script';
  readonly type: SpawnAdapterType = 'npm_script';

  resolveCommand(config: Record<string, unknown>, projectPath: string): ResolvedCommand {
    const script = config.script as string;
    if (!script) {
      throw new Error('npm_script adapter requires a "script" field');
    }

    return {
      command: ['bun', 'run', script],
      cwd: projectPath,
    };
  }

  async isAvailable(projectPath: string): Promise<boolean> {
    try {
      const pkgPath = join(projectPath, 'package.json');
      await readFile(pkgPath, 'utf-8');
      return true;
    } catch {
      return false;
    }
  }

  static async discoverScripts(projectPath: string): Promise<DiscoveredScript[]> {
    try {
      const pkgPath = join(projectPath, 'package.json');
      const content = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(content);
      const scripts = pkg.scripts || {};

      return Object.entries(scripts).map(([name, command]) => ({
        name,
        command: command as string,
      }));
    } catch {
      return [];
    }
  }
}

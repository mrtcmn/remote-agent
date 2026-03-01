import { BaseSpawnAdapter } from './base.adapter';
import type { SpawnAdapterType, ResolvedCommand } from './types';

export class CustomCommandAdapter extends BaseSpawnAdapter {
  readonly name = 'Custom Command';
  readonly type: SpawnAdapterType = 'custom_command';

  resolveCommand(config: Record<string, unknown>, projectPath: string): ResolvedCommand {
    const command = config.command as string;
    if (!command) {
      throw new Error('custom_command adapter requires a "command" field');
    }

    // Split command string into args, respecting the shell
    return {
      command: ['bash', '-c', command],
      cwd: projectPath,
    };
  }
}

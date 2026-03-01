import type { SpawnAdapter, SpawnAdapterType, ResolvedCommand } from './types';

export abstract class BaseSpawnAdapter implements SpawnAdapter {
  abstract readonly name: string;
  abstract readonly type: SpawnAdapterType;

  abstract resolveCommand(config: Record<string, unknown>, projectPath: string): ResolvedCommand;

  async isAvailable(_projectPath: string): Promise<boolean> {
    return true;
  }
}

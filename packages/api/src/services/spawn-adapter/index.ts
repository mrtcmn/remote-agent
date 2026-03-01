import type { SpawnAdapter, SpawnAdapterRegistry } from './types';
import { NpmScriptAdapter } from './npm-script.adapter';
import { CustomCommandAdapter } from './custom-command.adapter';

export type { SpawnAdapter, SpawnAdapterType, ResolvedCommand, SpawnAdapterRegistry } from './types';
export { BaseSpawnAdapter } from './base.adapter';
export { NpmScriptAdapter } from './npm-script.adapter';
export { CustomCommandAdapter } from './custom-command.adapter';

class SpawnAdapterRegistryImpl implements SpawnAdapterRegistry {
  private adapters = new Map<string, SpawnAdapter>();

  register(adapter: SpawnAdapter): void {
    this.adapters.set(adapter.type, adapter);
    console.log(`[spawn-adapter] Registered adapter: ${adapter.name} (${adapter.type})`);
  }

  get(type: string): SpawnAdapter | undefined {
    return this.adapters.get(type);
  }

  getAll(): SpawnAdapter[] {
    return Array.from(this.adapters.values());
  }
}

export const spawnAdapterRegistry = new SpawnAdapterRegistryImpl();
spawnAdapterRegistry.register(new NpmScriptAdapter());
spawnAdapterRegistry.register(new CustomCommandAdapter());

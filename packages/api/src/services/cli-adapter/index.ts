import type { CLIAdapter, CLIAdapterRegistry } from './types';
import { ClaudeCodeAdapter } from './claude-code.adapter';
import { GeminiCLIAdapter } from './gemini-cli.adapter';

export type { CLIAdapter, CLISessionConfig, CLISessionResult, CLIAdapterRegistry } from './types';
export { BaseCLIAdapter } from './base.adapter';
export { ClaudeCodeAdapter } from './claude-code.adapter';
export { GeminiCLIAdapter } from './gemini-cli.adapter';

class CLIAdapterRegistryImpl implements CLIAdapterRegistry {
  private adapters = new Map<string, CLIAdapter>();

  register(adapter: CLIAdapter): void {
    this.adapters.set(adapter.type, adapter);
    console.log(`[cli-adapter] Registered adapter: ${adapter.name} (${adapter.type})`);
  }

  get(type: string): CLIAdapter | undefined {
    return this.adapters.get(type);
  }

  getAll(): CLIAdapter[] {
    return Array.from(this.adapters.values());
  }

  async getAvailable(): Promise<CLIAdapter[]> {
    const results: CLIAdapter[] = [];
    for (const adapter of this.adapters.values()) {
      if (await adapter.isAvailable()) {
        results.push(adapter);
      }
    }
    return results;
  }
}

// Singleton registry with default adapters
export const cliAdapterRegistry = new CLIAdapterRegistryImpl();
cliAdapterRegistry.register(new ClaudeCodeAdapter());
cliAdapterRegistry.register(new GeminiCLIAdapter());

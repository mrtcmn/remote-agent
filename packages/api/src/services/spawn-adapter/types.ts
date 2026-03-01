export type SpawnAdapterType = 'npm_script' | 'custom_command' | 'browser_preview';

export interface ResolvedCommand {
  command: string[];
  cwd?: string;
  env?: Record<string, string>;
}

export interface SpawnAdapter {
  readonly name: string;
  readonly type: SpawnAdapterType;

  resolveCommand(config: Record<string, unknown>, projectPath: string): ResolvedCommand;
  isAvailable(projectPath: string): Promise<boolean>;
}

export interface SpawnAdapterRegistry {
  register(adapter: SpawnAdapter): void;
  get(type: string): SpawnAdapter | undefined;
  getAll(): SpawnAdapter[];
}

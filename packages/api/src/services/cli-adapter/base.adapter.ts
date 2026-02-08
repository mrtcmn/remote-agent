import type { CLIAdapter, CLISessionConfig, CLISessionResult } from './types';

export abstract class BaseCLIAdapter implements CLIAdapter {
  abstract readonly name: string;
  abstract readonly type: 'claude_code' | 'gemini_cli' | 'custom';

  abstract startSession(config: CLISessionConfig): Promise<CLISessionResult>;
  abstract getOutput(sessionId: string): Promise<string>;

  async isAvailable(): Promise<boolean> {
    return false;
  }

  async initialize(): Promise<void> {}
  async shutdown(): Promise<void> {}

  protected buildEnv(config: CLISessionConfig): Record<string, string> {
    return {
      ...process.env as Record<string, string>,
      ...(config.env || {}),
    };
  }
}

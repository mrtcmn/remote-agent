export interface CLISessionConfig {
  projectPath: string;
  branch?: string;
  prompt: string;
  resume?: string; // session ID to resume
  maxTurns?: number;
  allowedTools?: string[];
  env?: Record<string, string>;
}

export interface CLISessionResult {
  sessionId: string;
  success: boolean;
  output: string;
  exitCode: number;
  costUsd?: number;
  duration?: number;
}

export interface CLIAdapter {
  readonly name: string;
  readonly type: 'claude_code' | 'gemini_cli' | 'custom';

  startSession(config: CLISessionConfig): Promise<CLISessionResult>;
  getOutput(sessionId: string): Promise<string>;
  isAvailable(): Promise<boolean>;
  initialize?(): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface CLIAdapterRegistry {
  register(adapter: CLIAdapter): void;
  get(type: string): CLIAdapter | undefined;
  getAll(): CLIAdapter[];
  getAvailable(): Promise<CLIAdapter[]>;
}

import { BaseCLIAdapter } from './base.adapter';
import type { CLISessionConfig, CLISessionResult } from './types';

export class GeminiCLIAdapter extends BaseCLIAdapter {
  readonly name = 'Gemini CLI';
  readonly type = 'gemini_cli' as const;

  private sessions = new Map<string, { output: string }>();

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(['gemini', '--version'], { stdout: 'pipe', stderr: 'pipe' });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async startSession(config: CLISessionConfig): Promise<CLISessionResult> {
    const sessionId = crypto.randomUUID();

    try {
      // Gemini CLI uses different args - adapt here
      const args = this.buildArgs(config);
      const proc = Bun.spawn(['gemini', ...args], {
        cwd: config.projectPath,
        stdout: 'pipe',
        stderr: 'pipe',
        env: this.buildEnv(config),
      });

      const output = await new Response(proc.stdout).text();
      const stderr = await new Response(proc.stderr).text();
      const exitCode = await proc.exited;

      const fullOutput = output + (stderr ? `\n--- stderr ---\n${stderr}` : '');
      this.sessions.set(sessionId, { output: fullOutput });

      return {
        sessionId,
        success: exitCode === 0,
        output: fullOutput,
        exitCode,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.sessions.set(sessionId, { output: `Error: ${errorMsg}` });
      return {
        sessionId,
        success: false,
        output: `Error: ${errorMsg}`,
        exitCode: 1,
      };
    }
  }

  async getOutput(sessionId: string): Promise<string> {
    return this.sessions.get(sessionId)?.output || '';
  }

  private buildArgs(config: CLISessionConfig): string[] {
    // Gemini CLI argument format - adapt when actual CLI is available
    const args: string[] = [];
    args.push(config.prompt);
    return args;
  }
}

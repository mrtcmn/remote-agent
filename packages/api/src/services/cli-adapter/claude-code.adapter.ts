import { BaseCLIAdapter } from './base.adapter';
import type { CLISessionConfig, CLISessionResult } from './types';

export class ClaudeCodeAdapter extends BaseCLIAdapter {
  readonly name = 'Claude Code';
  readonly type = 'claude_code' as const;

  private sessions = new Map<string, { output: string; process?: unknown }>();

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(['claude', '--version'], { stdout: 'pipe', stderr: 'pipe' });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async startSession(config: CLISessionConfig): Promise<CLISessionResult> {
    const sessionId = crypto.randomUUID();
    const args = this.buildArgs(config);

    try {
      const proc = Bun.spawn(['claude', ...args], {
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

      // Try to parse JSON output for cost info
      let costUsd: number | undefined;
      try {
        const parsed = JSON.parse(output);
        if (parsed.cost_usd) costUsd = parsed.cost_usd;
      } catch {
        // Not JSON output, that's fine
      }

      return {
        sessionId,
        success: exitCode === 0,
        output: fullOutput,
        exitCode,
        costUsd,
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
    const args: string[] = ['--print', '--output-format', 'json'];

    if (config.resume) {
      args.push('--resume', config.resume);
    }

    if (config.maxTurns) {
      args.push('--max-turns', String(config.maxTurns));
    }

    if (config.allowedTools?.length) {
      args.push('--allowedTools', config.allowedTools.join(','));
    }

    // The prompt goes last
    args.push(config.prompt);

    return args;
  }
}

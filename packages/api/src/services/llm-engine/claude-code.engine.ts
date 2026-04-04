import type { LLMEngine, LLMRequest, LLMResponse } from './types';

export class ClaudeCodeEngine implements LLMEngine {
  readonly name = 'claude-code';

  private getClaudePath(): string {
    return process.env.CLAUDE_BIN_PATH || 'claude';
  }

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn([this.getClaudePath(), '--version'], { stdout: 'pipe', stderr: 'pipe' });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const output = await this.run(request);
    return this.parseResponse(output);
  }

  async completeJSON<T>(request: LLMRequest): Promise<LLMResponse<T>> {
    const output = await this.run(request);
    return this.parseJSONResponse<T>(output);
  }

  private async run(request: LLMRequest): Promise<string> {
    const args = [this.getClaudePath(), '--print', '--output-format', 'json'];

    if (request.systemPrompt) {
      args.push('--system-prompt', request.systemPrompt);
    }

    console.log('[LLMEngine] Spawning claude with args:', args.join(' '));
    console.log('[LLMEngine] Prompt length:', request.prompt.length, 'chars');
    console.log('[LLMEngine] System prompt length:', request.systemPrompt?.length ?? 0, 'chars');

    const proc = Bun.spawn(args, {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: new TextEncoder().encode(request.prompt),
      env: {
        ...(process.env as Record<string, string>),
        REMOTE_AGENT_CLASSIFIER: '1',
      },
    });

    // Read stdout and stderr in parallel to avoid pipe deadlocks
    const [output, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;

    console.log('[LLMEngine] Exit code:', exitCode);
    console.log('[LLMEngine] Stdout length:', output.length, 'chars');
    if (stderr) console.log('[LLMEngine] Stderr:', stderr);
    if (output) {
      try {
        const parsed = JSON.parse(output);
        console.log('[LLMEngine] Result:', JSON.stringify(parsed, null, 2));
      } catch {
        console.log('[LLMEngine] Stdout (raw):', output);
      }
    }

    if (exitCode !== 0) {
      // If Claude completed successfully (is_error: false), don't treat non-zero exit as failure
      // — hooks or post-processing can cause non-zero exit even on success
      try {
        const parsed = JSON.parse(output);
        if (parsed.is_error === false) {
          return output;
        }
        const detail = parsed.result || parsed.subtype || stderr.trim() || JSON.stringify(parsed);
        throw new Error(`Claude Code exited with code ${exitCode}: ${detail}`);
      } catch (e) {
        if (e instanceof SyntaxError) {
          throw new Error(`Claude Code exited with code ${exitCode}: ${stderr.trim() || output.trim()}`);
        }
        throw e;
      }
    }

    return output;
  }

  private parseResponse(output: string): LLMResponse {
    try {
      const parsed = JSON.parse(output);
      return {
        content: parsed.result || output,
        usage: parsed.cost_usd ? { inputTokens: 0, outputTokens: 0, costUsd: parsed.cost_usd } : undefined,
      };
    } catch {
      return { content: output.trim() };
    }
  }

  private parseJSONResponse<T>(output: string): LLMResponse<T> {
    try {
      const parsed = JSON.parse(output);
      const content = parsed.result || output;

      let structured: T | undefined;
      try {
        const jsonStr = content.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();
        structured = JSON.parse(jsonStr);
      } catch {
        try {
          structured = JSON.parse(content);
        } catch {
          // not parseable as JSON
        }
      }

      return {
        content,
        structured,
        usage: parsed.cost_usd ? { inputTokens: 0, outputTokens: 0, costUsd: parsed.cost_usd } : undefined,
      };
    } catch {
      return { content: output.trim() };
    }
  }
}

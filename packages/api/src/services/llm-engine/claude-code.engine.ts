import type { LLMEngine, LLMRequest, LLMResponse } from './types';

export class ClaudeCodeEngine implements LLMEngine {
  readonly name = 'claude-code';

  async isAvailable(): Promise<boolean> {
    try {
      const proc = Bun.spawn(['claude', '--version'], { stdout: 'pipe', stderr: 'pipe' });
      await proc.exited;
      return proc.exitCode === 0;
    } catch {
      return false;
    }
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const args = this.buildArgs(request);

    const proc = Bun.spawn(['claude', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env as Record<string, string>,
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Claude Code exited with code ${exitCode}: ${stderr}`);
    }

    return this.parseResponse(output);
  }

  async completeJSON<T>(request: LLMRequest): Promise<LLMResponse<T>> {
    const args = this.buildArgs(request, true);

    const proc = Bun.spawn(['claude', ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
      env: process.env as Record<string, string>,
    });

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Claude Code exited with code ${exitCode}: ${stderr}`);
    }

    return this.parseJSONResponse<T>(output);
  }

  private buildArgs(request: LLMRequest, jsonOutput = false): string[] {
    const args: string[] = ['--print', '--output-format', 'json', '--max-turns', '1'];

    if (request.systemPrompt) {
      args.push('--system-prompt', request.systemPrompt);
    }

    if (jsonOutput && request.jsonSchema) {
      args.push('--output-format', 'json');
    }

    // No tool use for classification — fast and cheap
    args.push('--allowedTools', '');

    // Prompt goes last
    args.push(request.prompt);

    return args;
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

      // Try to extract JSON from the result text
      let structured: T | undefined;
      try {
        // Result might be raw JSON or wrapped in markdown code blocks
        const jsonStr = content.replace(/^```json?\n?/m, '').replace(/\n?```$/m, '').trim();
        structured = JSON.parse(jsonStr);
      } catch {
        // If result itself isn't JSON, try the whole content
        try {
          structured = JSON.parse(content);
        } catch {
          // Not parseable as JSON
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

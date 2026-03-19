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
    const output = await this.run(request);
    return this.parseResponse(output);
  }

  async completeJSON<T>(request: LLMRequest): Promise<LLMResponse<T>> {
    const output = await this.run(request);
    return this.parseJSONResponse<T>(output);
  }

  private async run(request: LLMRequest): Promise<string> {
    // Build the full input: system prompt (if any) + user prompt, passed via stdin
    // This avoids OS arg-length limits and quoting issues with long prompts
    const stdinParts: string[] = [];
    if (request.systemPrompt) {
      stdinParts.push(`<system>\n${request.systemPrompt}\n</system>\n\n`);
    }
    stdinParts.push(request.prompt);
    const stdin = stdinParts.join('');

    const proc = Bun.spawn(
      ['claude', '--print', '--output-format', 'json', '--max-turns', '1'],
      {
        stdout: 'pipe',
        stderr: 'pipe',
        stdin: new TextEncoder().encode(stdin),
        env: process.env as Record<string, string>,
      }
    );

    const output = await new Response(proc.stdout).text();
    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(`Claude Code exited with code ${exitCode}: ${stderr}`);
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

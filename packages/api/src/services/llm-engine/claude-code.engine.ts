import type { LLMEngine, LLMRequest, LLMResponse } from './types';

export class ClaudeCodeEngine implements LLMEngine {
  readonly name = 'claude-code';

  private getClaudePath(): string {
    return process.env.CLAUDE_BIN_PATH || 'claude';
  }

  /**
   * Model used for notification classification/summarization. Defaults to
   * Haiku — it's the fastest model and the task (classify + 100-char summary)
   * is light, so latency matters far more than reasoning depth. Pass an alias
   * ("haiku"/"sonnet"/"opus") or a full model id; the alias resolves to the
   * latest model in that family. Override with CLASSIFIER_MODEL if needed.
   */
  private getModel(): string {
    return process.env.CLASSIFIER_MODEL || 'haiku';
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
    const args = [this.getClaudePath(), '--print', '--output-format', 'json', '--model', this.getModel()];

    if (request.systemPrompt) {
      args.push('--system-prompt', request.systemPrompt);
    }

    console.log('[LLMEngine] Spawning claude with args:', args.join(' '));
    console.log('[LLMEngine] Prompt length:', request.prompt.length, 'chars');
    console.log('[LLMEngine] System prompt length:', request.systemPrompt?.length ?? 0, 'chars');
    // Presence of this line in logs = the thinking-disabled engine build is live.
    console.log(`[LLMEngine] thinking=OFF maxOutputTokens=${request.maxTokens ?? 'default'}`);

    const proc = Bun.spawn(args, {
      stdout: 'pipe',
      stderr: 'pipe',
      stdin: new TextEncoder().encode(request.prompt),
      env: {
        ...(process.env as Record<string, string>),
        REMOTE_AGENT_CLASSIFIER: '1',
        // Disable extended thinking for these mechanical haiku calls. Thinking is
        // what blows the classifier up to ~660 output tokens (the JSON itself is
        // only ~120); turning it off is the real token/cost/latency win. It also
        // lets CLAUDE_CODE_MAX_OUTPUT_TOKENS go low without tripping the API rule
        // that max_tokens must be ≥ the thinking budget (1024).
        MAX_THINKING_TOKENS: '0',
        // Optional output ceiling. NOTE: in --print mode this is a loose backstop,
        // not a precise clamp — actual brevity comes from the system prompt + the
        // char slice in the classifier. Only set when a caller passes maxTokens.
        ...(request.maxTokens ? { CLAUDE_CODE_MAX_OUTPUT_TOKENS: String(request.maxTokens) } : {}),
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

      // The model may wrap the JSON in ``` fences (with or without a language
      // tag) or add stray prose. Try a direct parse first, then fall back to
      // extracting the outermost {...} object from the text.
      let structured: T | undefined;
      try {
        structured = JSON.parse(content);
      } catch {
        const match = typeof content === 'string' ? content.match(/\{[\s\S]*\}/) : null;
        if (match) {
          try {
            structured = JSON.parse(match[0]);
          } catch {
            // not parseable as JSON
          }
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

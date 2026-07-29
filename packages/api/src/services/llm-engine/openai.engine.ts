import type { LLMEngine, LLMRequest, LLMResponse } from './types';

export interface OpenAIEngineConfig {
  /** Base URL up to and including /v1 (no trailing /chat/completions). */
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Any OpenAI-compatible /chat/completions endpoint (OpenAI, Cerebras, Groq,
 * together, local vLLM, …). Uses global fetch — no SDK dependency.
 */
export class OpenAICompatibleEngine implements LLMEngine {
  readonly name = 'openai';

  constructor(private cfg: OpenAIEngineConfig) {}

  async isAvailable(): Promise<boolean> {
    return Boolean(this.cfg.baseUrl && this.cfg.apiKey && this.cfg.model);
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    return this.chat(request, false);
  }

  async completeJSON<T>(request: LLMRequest): Promise<LLMResponse<T>> {
    const res = await this.chat(request, true);
    return { ...res, structured: extractJSON<T>(res.content) };
  }

  private async chat(request: LLMRequest, json: boolean): Promise<LLMResponse> {
    const messages: Array<{ role: string; content: string }> = [];
    if (request.systemPrompt) messages.push({ role: 'system', content: request.systemPrompt });
    messages.push({ role: 'user', content: request.prompt });

    const body: Record<string, unknown> = {
      model: this.cfg.model,
      messages,
      temperature: request.temperature ?? 0,
      max_tokens: request.maxTokens ?? 1024,
    };
    // json_object mode only when the prompt actually says "json" — OpenAI rejects
    // the flag otherwise, and providers that don't support it just ignore it.
    // The extractJSON fallback covers models that emit fenced/wrapped JSON anyway.
    if (json && /json/i.test((request.systemPrompt ?? '') + request.prompt)) {
      body.response_format = { type: 'json_object' };
    }

    const url = `${this.cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`OpenAI-compatible engine ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }

    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    const u = data.usage;
    return {
      content,
      usage: u ? { inputTokens: u.prompt_tokens ?? 0, outputTokens: u.completion_tokens ?? 0 } : undefined,
    };
  }
}

/** Parse JSON from a model reply, tolerating ``` fences and surrounding prose. */
export function extractJSON<T>(content: string): T | undefined {
  try {
    return JSON.parse(content) as T;
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]) as T;
      } catch {
        // not parseable
      }
    }
    return undefined;
  }
}

export interface LLMRequest {
  prompt: string;
  systemPrompt?: string;
  maxTokens?: number;
  temperature?: number;
  jsonSchema?: Record<string, unknown>;
}

export interface LLMResponse<T = unknown> {
  content: string;
  structured?: T;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    costUsd?: number;
  };
}

export interface LLMEngine {
  readonly name: string;

  /**
   * Send a prompt and get a text response
   */
  complete(request: LLMRequest): Promise<LLMResponse>;

  /**
   * Send a prompt and get a structured JSON response
   */
  completeJSON<T>(request: LLMRequest): Promise<LLMResponse<T>>;

  /**
   * Check if the engine is available and configured
   */
  isAvailable(): Promise<boolean>;
}

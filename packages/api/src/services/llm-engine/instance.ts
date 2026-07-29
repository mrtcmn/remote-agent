import { ClaudeCodeEngine } from './claude-code.engine';
import { llmSettings } from './llm-settings';
import { OpenAICompatibleEngine } from './openai.engine';
import type { LLMEngine } from './types';

const claudeCode = new ClaudeCodeEngine();

/** Pick the engine per call so settings changes apply without a restart. */
function active(): LLMEngine {
  const c = llmSettings.get();
  if (c.provider === 'openai' && c.baseUrl && c.apiKey && c.model) {
    return new OpenAICompatibleEngine({ baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model });
  }
  return claudeCode;
}

export const llmEngine: LLMEngine = {
  get name() {
    return active().name;
  },
  complete: (r) => active().complete(r),
  completeJSON: (r) => active().completeJSON(r),
  isAvailable: () => active().isAvailable(),
};

import { ClaudeCodeEngine } from './claude-code.engine';
import type { LLMEngine } from './types';

export const llmEngine: LLMEngine = new ClaudeCodeEngine();

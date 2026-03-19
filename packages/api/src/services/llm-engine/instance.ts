import { ClaudeCodeEngine } from './claude-code.engine';
import type { LLMEngine } from './types';

// Default engine — can be swapped for other implementations later
export const llmEngine: LLMEngine = new ClaudeCodeEngine();

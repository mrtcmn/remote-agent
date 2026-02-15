import type { CLISessionResult } from '../cli-adapter';

export interface FlowExecutionContext {
  flowId: string;
  taskId: string;
  projectPath: string;
  branch?: string;
  adapterType: string;
  adapterConfig?: Record<string, any>;
  prompt: string;
}

export interface FlowExecutionResult {
  success: boolean;
  sessionResult?: CLISessionResult;
  error?: string;
  nextTaskIds?: string[];
}

export interface ExecutionStrategy {
  readonly name: string;
  canHandle(context: FlowExecutionContext): boolean;
  execute(context: FlowExecutionContext): Promise<FlowExecutionResult>;
}

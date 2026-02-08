import type { ExecutionStrategy, FlowExecutionContext, FlowExecutionResult } from '../types';

export class ManualStrategy implements ExecutionStrategy {
  readonly name = 'manual';

  canHandle(context: FlowExecutionContext): boolean {
    // Manual strategy just marks tasks as ready, doesn't auto-execute
    return true;
  }

  async execute(context: FlowExecutionContext): Promise<FlowExecutionResult> {
    // Manual strategy doesn't execute anything, just signals readiness
    return {
      success: true,
      nextTaskIds: [], // Will be populated by the flow engine
    };
  }
}

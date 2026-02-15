import type { ExecutionStrategy, FlowExecutionContext, FlowExecutionResult } from '../types';
import { cliAdapterRegistry } from '../../cli-adapter';

export class AutoCLIStrategy implements ExecutionStrategy {
  readonly name = 'auto-cli';

  canHandle(context: FlowExecutionContext): boolean {
    const adapter = cliAdapterRegistry.get(context.adapterType);
    return !!adapter;
  }

  async execute(context: FlowExecutionContext): Promise<FlowExecutionResult> {
    const adapter = cliAdapterRegistry.get(context.adapterType);
    if (!adapter) {
      return {
        success: false,
        error: `No adapter found for type: ${context.adapterType}`,
      };
    }

    const isAvailable = await adapter.isAvailable();
    if (!isAvailable) {
      return {
        success: false,
        error: `Adapter ${adapter.name} is not available on this system`,
      };
    }

    try {
      const sessionResult = await adapter.startSession({
        projectPath: context.projectPath,
        branch: context.branch,
        prompt: context.prompt,
        ...(context.adapterConfig || {}),
      });

      return {
        success: sessionResult.success,
        sessionResult,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }
}

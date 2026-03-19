import type { ArtifactAdapter, ArtifactInput, ArtifactResult } from './types';
import { ScreenshotAdapter } from './adapters';

export class ArtifactService {
  private adapters: ArtifactAdapter[] = [];

  constructor() {
    this.registerAdapter(new ScreenshotAdapter());
  }

  registerAdapter(adapter: ArtifactAdapter): void {
    this.adapters.push(adapter);
  }

  async processToolOutput(input: ArtifactInput): Promise<ArtifactResult | null> {
    for (const adapter of this.adapters) {
      if (adapter.matches(input.toolName)) {
        try {
          const result = await adapter.process(input);
          if (result) {
            console.log(`[ArtifactService] ${adapter.name} captured artifact: ${result.id}`);
            return result;
          }
        } catch (error) {
          console.error(`[ArtifactService] Error in ${adapter.name} adapter:`, error);
        }
      }
    }
    return null;
  }
}

export const artifactService = new ArtifactService();

export interface ArtifactInput {
  sessionId: string;
  terminalId?: string;
  toolName: string;
  toolInput: Record<string, unknown>;
  toolResult: string;
}

export interface ArtifactResult {
  id: string;
  type: string;
  filename: string;
  filepath: string;
}

export interface ArtifactAdapter {
  readonly name: string;
  matches(toolName: string): boolean;
  process(input: ArtifactInput): Promise<ArtifactResult | null>;
}

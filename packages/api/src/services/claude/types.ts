import type { Subprocess } from 'bun';

export type SessionStatus = 'starting' | 'running' | 'waiting_input' | 'idle' | 'terminated' | 'error';

export interface ClaudeSession {
  id: string;
  userId: string;
  projectPath: string;
  process: Subprocess | null;
  status: SessionStatus;
  claudeSessionId?: string; // For resuming
  createdAt: Date;
  lastActiveAt: Date;
}

export interface CreateSessionOptions {
  sessionId: string;
  userId: string;
  projectPath: string;
  skills?: string[];
  hooks?: string;
  resume?: string; // Resume session ID
  model?: string;
}

export interface ClaudeOutput {
  type: 'text' | 'tool_call' | 'tool_result' | 'error' | 'system' | 'input_request' | 'permission_request';
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface SessionEventHandler {
  onOutput: (sessionId: string, output: ClaudeOutput) => void;
  onStatusChange: (sessionId: string, status: SessionStatus) => void;
  onInputRequired: (sessionId: string, prompt: string) => void;
  onPermissionRequired: (sessionId: string, permission: string) => void;
  onError: (sessionId: string, error: Error) => void;
  onTerminate: (sessionId: string) => void;
}
